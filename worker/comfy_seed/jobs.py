"""Session-checked native Comfy submission and terminal-history persistence."""
import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path
from aiohttp import web
import execution
import folder_paths
from .spool import atomic, job_directory, read_record
from .telemetry import Measurement


def install(server, workspace, workspace_id, engine_id):
    lock = asyncio.Lock()
    original_done = server.prompt_queue.task_done
    measurements = {}
    original_send = getattr(server, 'send_sync', None)
    if original_send:
        def send(event, data, sid=None):
            if event == 'execution_start' and isinstance(data, dict):
                job_id = data.get('prompt_id')
                try:
                    directory = job_directory(workspace, job_id)
                    if read_record(directory) and job_id not in measurements:
                        measurements[job_id] = Measurement(directory)
                except Exception:
                    logging.exception('seed telemetry unavailable')
            return original_send(event, data, sid)
        server.send_sync = send

    def verified_preset(candidate):
        if not candidate: return None
        digest = candidate['sha256']
        if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest) or candidate['filename'] != 'seed-' + digest + '.safetensors': raise ValueError('Preset is not immutable')
        receipt = Path(workspace) / '.seed/presets/assets' / (digest + '.json')
        proof = json.loads(receipt.read_text())
        file = Path(folder_paths.get_full_path('loras', candidate['filename']))
        stat = file.stat()
        if proof != {'sha256': digest, 'size': stat.st_size, 'mtime_ns': stat.st_mtime_ns}: raise ValueError('Preset file changed')
        return candidate

    @server.routes.get('/studio/capabilities')
    async def capabilities(request):
        required = {'diffusion_models': 'krea2_turbo_int8_convrot.safetensors', 'text_encoders': 'qwen3vl_4b_fp8_scaled.safetensors', 'vae': 'qwen_image_vae.safetensors'}
        ready = all(name in folder_paths.get_filename_list(category) for category, name in required.items())
        preset = None
        file = Path(workspace) / '.seed/presets/active.json'
        if file.exists():
            value = json.loads(file.read_text())
            candidate = value.get('nsfw')
            try:
                if verified_preset(candidate): preset = {**candidate, 'revision': value['revision']}
            except (ValueError, OSError, TypeError, KeyError): pass
        video_presets = {}
        if file.exists():
            value = json.loads(file.read_text())
            for route in ('fl','ref'):
                try:
                    candidate = verified_preset(value.get('video_' + route))
                    if candidate: video_presets[route] = {**candidate, 'revision': candidate['sha256'] + '-' + str(candidate['strength_model'])}
                except (ValueError, OSError, TypeError, KeyError): pass
        video_required = {'diffusion_models': ['minimax_h3_fl2va_pruned_int8_convrot.safetensors','minimax_h3_ref2va_pruned_int8_convrot.safetensors'], 'text_encoders':['qwen3vl_32b_minimax_h3_int8_convrot.safetensors'], 'vae':['minimax_h3_video_vae_fp16.safetensors','minimax_h3_audio_vae_fp32.safetensors'], 'loras':['minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors','minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors']}
        video_ready = all(all(name in folder_paths.get_filename_list(category) for name in names) for category,names in video_required.items())
        return web.json_response({'video': {'ready': video_ready, 'nsfw': video_presets}, 'protocol_version': 1, 'workspace_id': workspace_id, 'engine_session_id': engine_id,
            'revision': 'seed-media-v2:' + (preset['revision'] if preset else 'base') + ':' + ':'.join(p['revision'] for p in video_presets.values()), 'ready': ready, 'nsfw': preset})

    def terminal(item_id, history_result, status, process_item=None):
        # Capture the job while native execution still owns it.
        with server.prompt_queue.mutex:
            prompt = server.prompt_queue.currently_running[item_id]
            job_id = prompt[3].get('seed_job_id')
        measurement = measurements.pop(job_id, None)
        if measurement:
            try: measurement.finish()
            except Exception: logging.exception('seed telemetry finalization unavailable')
        original_done(item_id, history_result, status, process_item)
        if not job_id: return
        try:
            directory = job_directory(workspace, job_id)
            record = read_record(directory)
            if not record or record['submission']['engine_session_id'] != engine_id: return
            success = status is not None and status.status_str == 'success' and status.completed
            outputs = []
            if success:
                root = Path(folder_paths.get_output_directory()).resolve()
                expected = root / 'seed' / job_id
                is_video = record['submission']['graph'].get('14', {}).get('class_type') == 'SeedVideoSave'
                node_id, field, suffix, mime = ('14','videos','.mp4','video/mp4') if is_video else ('9','images','.png','image/png')
                for entry in history_result.get('outputs', {}).get(node_id, {}).get(field, []):
                    file = (root / entry.get('subfolder', '') / entry['filename']).resolve()
                    if entry.get('type') != 'output' or not file.is_relative_to(expected) or file.suffix != suffix:
                        raise ValueError('Unexpected output')
                    with open(file, 'r+b') as handle:
                        os.fsync(handle.fileno())
                        digest = hashlib.file_digest(handle, 'sha256').hexdigest()
                    if os.name != 'nt':
                        fd = os.open(file.parent, os.O_RDONLY)
                        try: os.fsync(fd)
                        finally: os.close(fd)
                    outputs.append({'id': str(len(outputs)), 'path': str(file.relative_to(root)), 'size': file.stat().st_size, 'sha256': digest, 'mime_type': mime})
                if len(outputs) != 1: raise ValueError('Incomplete output set')
            atomic(directory / 'manifest.json', {'job_id': job_id, 'workspace_id': workspace_id, 'engine_session_id': engine_id, 'prompt_id': job_id,
                'state': 'completed' if success else 'cancelled' if (directory / 'cancel.json').exists() else 'failed', 'outputs': outputs,
                'error': None if success else 'Generation stopped before producing a complete image.'})
        except Exception:
            # A missing terminal record is ambiguous, never falsely successful.
            logging.exception('seed could not persist terminal output record')
    server.prompt_queue.task_done = terminal

    def guard(request):
        if request.headers.get('X-Studio-Engine-Session') != engine_id:
            raise web.HTTPConflict(text=json.dumps({'error': 'Engine session changed before acceptance', 'accepted': False}), content_type='application/json')

    @server.routes.post('/studio/prompt')
    async def submit(request):
        guard(request)
        body = await request.json()
        job_id = body['prompt_id']; graph = body['prompt']
        directory = job_directory(workspace, job_id)
        digest = hashlib.sha256(json.dumps(graph, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        async with lock:
            existing = read_record(directory)
            if existing:
                if existing['submission']['graph_digest'] != digest: raise web.HTTPConflict()
                return web.json_response({'prompt_id': job_id, 'already_recorded': True})
            try:
                preset = verified_preset(body.get('preset'))
                adapter = '18' if graph.get('14', {}).get('class_type') == 'SeedVideoSave' else '10'
                if (adapter in graph) != bool(preset) or (preset and (graph[adapter]['inputs']['lora_name'] != preset['filename'] or graph[adapter]['inputs']['strength_model'] != preset['strength_model'])):
                    raise ValueError('Preset does not match graph')
            except (ValueError, OSError, TypeError, KeyError):
                return web.json_response({'error': 'Pinned LoRA is unavailable or changed', 'accepted': False}, status=422)
            # Use native validation/queue, with the second readiness check after validation awaits.
            valid = await execution.validate_prompt(job_id, graph, None)
            if not valid[0]: return web.json_response({'error': 'Workflow validation failed', 'accepted': False, 'node_errors': valid[3]}, status=422)
            running, pending = server.prompt_queue.get_current_queue()
            if running or pending: return web.json_response({'error': 'Engine queue is not empty', 'accepted': False}, status=409)
            video = graph.get('14', {}).get('class_type') == 'SeedVideoSave'
            output = graph.get('14' if video else '9', {})
            if output.get('class_type') != ('SeedVideoSave' if video else 'SaveImage') or output.get('inputs', {}).get('filename_prefix') != 'seed/' + job_id + ('/video' if video else '/image'):
                raise web.HTTPBadRequest()
            atomic(directory / 'submission.json', {'job_id': job_id, 'workspace_id': workspace_id, 'engine_session_id': engine_id, 'graph_digest': digest, 'graph': graph})
            number = server.number; server.number += 1
            server.prompt_queue.put((number, job_id, graph, {'seed_job_id': job_id}, valid[2], {}))
            return web.json_response({'prompt_id': job_id})

    @server.routes.post('/studio/cancel')
    async def cancel(request):
        guard(request)
        job_id = (await request.json())['job_id']
        directory = job_directory(workspace, job_id)
        record = read_record(directory)
        if not record or record['submission']['engine_session_id'] != engine_id: raise web.HTTPConflict()
        if 'manifest' in record: return web.json_response({'cancel_requested': False})
        atomic(directory / 'cancel.json', {'requested': True})
        queue = server.prompt_queue
        removed = queue.delete_queue_item(lambda item: item[1] == job_id)
        if removed:
            atomic(directory / 'manifest.json', {'job_id': job_id, 'workspace_id': workspace_id, 'engine_session_id': engine_id, 'prompt_id': job_id, 'state': 'cancelled', 'outputs': [], 'error': None})
        else: queue.interrupt_if_running(job_id)
        return web.json_response({'cancel_requested': True})
