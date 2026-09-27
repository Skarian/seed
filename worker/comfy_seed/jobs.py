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
from .adapters import validate_adapters, validate_video_profile
from worker.profile import hardware_capabilities, identity, installed_loras, worker_class


def video_capabilities():
    required = {'diffusion_models': ['minimax_h3_fl2va_pruned_int8_convrot.safetensors', 'minimax_h3_ref2va_pruned_int8_convrot.safetensors'], 'text_encoders': ['qwen3vl_32b_minimax_h3_int8_convrot.safetensors'], 'vae': ['minimax_h3_video_vae_fp16.safetensors', 'minimax_h3_audio_vae_fp32.safetensors']}
    base = all(all(name in folder_paths.get_filename_list(category) for name in names) for category, names in required.items())
    native = False
    try:
        import nodes
        import torch
        import comfy_kitchen as ck
        from comfy.ldm.modules import attention
        native = (all(name in nodes.NODE_CLASS_MAPPINGS for name in ('ModelAttentionBackend', 'BlockSparseAttention', 'MiniMaxH3SigmaShift'))
                  and attention.COMFY_KITCHEN_INT8_ATTENTION_IS_AVAILABLE
                  and torch.cuda.is_available() and ck.sol_attn_is_available(torch.device('cuda')))
    except (ImportError, AttributeError, RuntimeError):
        pass
    return {'ready': base, 'quality': {'high': bool(base and native)}, 'native_export': True, 'profile_revision': 'h3-quality-v1'}


def output_spec(graph, job_id):
    node = graph.get('14', {})
    kind = node.get('class_type')
    if kind == 'SeedVideoSave':
        result, prefix = ('14', 'videos', '.mp4', 'video/mp4', 1), '/video'
    else:
        node = graph.get('9', {})
        if node.get('class_type') != 'SaveImage': raise ValueError('Invalid output')
        result, prefix = ('9', 'images', '.png', 'image/png', 1), '/image'
    if node.get('inputs', {}).get('filename_prefix') != 'seed/' + job_id + prefix:
        raise ValueError('Invalid output location')
    return result


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

    @server.routes.get('/studio/capabilities')
    async def capabilities(request):
        required = {'diffusion_models': 'krea2_turbo_int8_convrot.safetensors', 'text_encoders': 'qwen3vl_4b_fp8_scaled.safetensors', 'vae': 'qwen_image_vae.safetensors'}
        image_ready = all(name in folder_paths.get_filename_list(category) for category, name in required.items())
        video = video_capabilities()
        role = worker_class()
        hardware = hardware_capabilities(role)
        model_ready = image_ready if role == 'image' else video['ready'] and video['quality']['high'] if role == 'video' else False
        import nodes
        qwen_ready = role == 'image' and all(name in folder_paths.get_filename_list(category) for category,name in {
            'diffusion_models':'qwen_image_2.1_int8_convrot.safetensors', 'text_encoders':'qwen3vl_8b_int8_convrot.safetensors', 'vae':'qwen_image_2.1_vae_bf16.safetensors'}.items()) and all(n in nodes.NODE_CLASS_MAPPINGS for n in ('TextEncodeQwenImage21','QwenImage21Cache','SeedLoadEditImage'))
        return web.json_response({**identity(), 'workspace_id': workspace_id, 'engine_session_id': engine_id,
            'workflows': (['text-to-image'] + (['image-to-image'] if qwen_ready else [])) if role == 'image' else ['text-to-video','reference-to-video'],
            'ready': bool(hardware['ready'] and model_ready), 'hardware': hardware,
            'installed_loras': installed_loras(workspace),
            'video': {'ready': hardware['ready'] and role == 'video' and video['ready'], 'quality': {'high': hardware['ready'] and role == 'video' and video['quality']['high']},
                      'native_export': True, 'profile_revision': 'h3-quality-v1'},
            'revision': 'seed-pool-v1'})

    def terminal(item_id, history_result, status, process_item=None):
        # Capture the job while native execution still owns it.
        with server.prompt_queue.mutex:
            prompt = server.prompt_queue.currently_running[item_id]
            job_id = prompt[3].get('seed_job_id')
        measurement = measurements.pop(job_id, None)
        if measurement:
            try: measurement.finish(getattr(status, 'messages', []) or [])
            except Exception: logging.exception('seed telemetry finalization unavailable')
        original_done(item_id, history_result, status, process_item)
        if not job_id: return
        try:
            directory = job_directory(workspace, job_id)
            record = read_record(directory)
            if not record or record['submission']['engine_session_id'] != engine_id: return
            success = status is not None and status.status_str == 'success' and status.completed and not (directory / 'cancel.json').exists()
            outputs = []
            if success:
                root = Path(folder_paths.get_output_directory()).resolve()
                expected = root / 'seed' / job_id
                node_id, field, suffix, mime, count = output_spec(record['submission']['graph'], job_id)
                seen = set()
                for entry in history_result.get('outputs', {}).get(node_id, {}).get(field, []):
                    file = (root / entry.get('subfolder', '') / entry['filename']).resolve()
                    if entry.get('type') != 'output' or not file.is_relative_to(expected) or file.suffix != suffix or file in seen:
                        raise ValueError('Unexpected output')
                    seen.add(file)
                    with open(file, 'r+b') as handle:
                        os.fsync(handle.fileno())
                        digest = hashlib.file_digest(handle, 'sha256').hexdigest()
                    if os.name != 'nt':
                        fd = os.open(file.parent, os.O_RDONLY)
                        try: os.fsync(fd)
                        finally: os.close(fd)
                    outputs.append({'id': str(len(outputs)), 'path': str(file.relative_to(root)), 'size': file.stat().st_size, 'sha256': digest, 'mime_type': mime})
                if len(outputs) != count: raise ValueError('Incomplete output set')
            atomic(directory / 'manifest.json', {'job_id': job_id, 'workspace_id': workspace_id, 'engine_session_id': engine_id, 'prompt_id': job_id,
                'state': 'completed' if success else 'cancelled' if (directory / 'cancel.json').exists() else 'failed', 'outputs': outputs,
                'error': None if success else 'Generation stopped before producing a complete output.'})
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
        digest = hashlib.sha256(json.dumps({'graph': graph, 'route': body.get('route'), 'loras': body.get('loras', []), 'video_profile': body.get('video_profile')}, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        async with lock:
            existing = read_record(directory)
            if existing:
                if existing['submission']['graph_digest'] != digest: raise web.HTTPConflict()
                return web.json_response({'prompt_id': job_id, 'already_recorded': True})
            try:
                route = body.get('route', 'fl' if '14' in graph else 'image')
                if (route in ('image','image-edit')) != ('14' not in graph):
                    raise ValueError('Workflow route does not match output graph')
                if 'preset' in body:
                    raise ValueError('Legacy presets are not supported')
                model = validate_adapters(workspace, graph, body.get('loras', []), route)
                if route not in ('image','image-edit'):
                    validate_video_profile(graph, body.get('video_profile'), model)
                elif body.get('video_profile') is not None:
                    raise ValueError('Video profile on image worker')
                elif graph.get('7', {}).get('class_type') == 'KSampler' and graph['7']['inputs'].get('model') != model:
                    raise ValueError('Image sampler does not use the selected adapter chain')
            except (ValueError, OSError, TypeError, KeyError):
                return web.json_response({'error': 'Selected adapters or workflow profile are unavailable or changed', 'accepted': False}, status=422)
            # Use native validation/queue, with the second readiness check after validation awaits.
            valid = await execution.validate_prompt(job_id, graph, None)
            if not valid[0]: return web.json_response({'error': 'Workflow validation failed', 'accepted': False, 'node_errors': valid[3]}, status=422)
            running, pending = server.prompt_queue.get_current_queue()
            if running or pending: return web.json_response({'error': 'Engine queue is not empty', 'accepted': False}, status=409)
            try: output_spec(graph, job_id)
            except (ValueError, KeyError, TypeError): raise web.HTTPBadRequest()
            atomic(directory / 'submission.json', {'job_id': job_id, 'workspace_id': workspace_id, 'engine_session_id': engine_id, 'graph_digest': digest, 'graph': graph, 'route': route, 'loras': body.get('loras', []), **({'video_profile': body['video_profile']} if body.get('video_profile') else {})})
            number = server.number; server.number += 1
            server.prompt_queue.put((number, job_id, graph, {'seed_job_id': job_id, 'client_id': job_id}, valid[2], {}))
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
