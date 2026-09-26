"""Early seed worker connection service. No provider control-plane access."""
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
import uuid
from collections import deque
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import ClientSession, ClientTimeout, web
from worker.profile import identity, installed_loras

PREPARATION = web.AppKey('preparation', dict)
HTTP = web.AppKey('http', ClientSession)


def atomic_json(file, value):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with open(temp, 'x', encoding='utf-8') as handle:
            os.chmod(temp, 0o600)
            json.dump(value, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, file)
        if os.name != 'nt':
            fd = os.open(file.parent, os.O_RDONLY)
            try: os.fsync(fd)
            finally: os.close(fd)
    finally:
        temp.unlink(missing_ok=True)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def error(status, code, message):
    return web.json_response({'error': {'code': code, 'message': message, 'retryable': status >= 500}, 'request_id': str(uuid.uuid4())}, status=status)


def create_app(workspace, runtime, pairing_secret, public_url, comfy_url='http://127.0.0.1:8188', development=False, clock=time.time, managed_preparation=False):
    if len(pairing_secret) < 24:
        raise ValueError('Pairing secret must have at least 24 characters.')
    origin = public_url.rstrip('/')
    parsed = urlsplit(origin)
    if parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise ValueError('Worker public URL must be an origin.')
    if parsed.scheme != 'https' and not (development and parsed.scheme == 'http' and parsed.hostname == '127.0.0.1'):
        raise ValueError('Worker public URL must use HTTPS.')
    workspace, runtime = Path(workspace), Path(runtime)
    workspace.mkdir(parents=True, exist_ok=True)
    runtime.mkdir(parents=True, exist_ok=True)
    identity_file = workspace / '.seed/workspace.json'
    if not identity_file.exists():
        atomic_json(identity_file, {'workspace_id': str(uuid.uuid4())})
    workspace_id = json.loads(identity_file.read_text())['workspace_id']
    instance_file = runtime / 'identity.json'
    if not instance_file.exists():
        atomic_json(instance_file, {'worker_instance_id': str(uuid.uuid4()), 'engine_ever_started': False})
    instance_id = json.loads(instance_file.read_text())['worker_instance_id']
    verifier_file = runtime / 'credential.json'
    bearer_hash = json.loads(verifier_file.read_text())['verifier'] if verifier_file.exists() else None
    sessions = {}
    failures = deque(maxlen=20)
    code = None
    preparation = {'phase': 'waiting', 'error': None}

    @web.middleware
    async def security(request, handler):
        try:
            response = await handler(request)
        except (json.JSONDecodeError, UnicodeDecodeError, TypeError, ValueError):
            response = error(400, 'invalid_request', 'Check the request and try again.')
        except web.HTTPException as exc:
            response = error(exc.status, 'invalid_request', 'This request is not available.')
        except Exception as exc:
            logging.getLogger('seed.worker').error('Worker request failed: %s', type(exc).__name__)
            response = error(500, 'worker_error', 'Worker operation failed; inspect local worker logs.')
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
        return response

    app = web.Application(middlewares=[security], client_max_size=1024*1024)
    app[PREPARATION] = preparation

    def authenticated(request, allow_cookie=False):
        auth = request.headers.get('Authorization', '')
        if bearer_hash and auth.startswith('Bearer ') and hmac.compare_digest(digest(auth[7:]), bearer_hash):
            return True
        token = request.cookies.get('seed_unlock', '')
        return allow_cookie and sessions.get(digest(token), 0) > clock()

    def same_origin(request):
        return request.headers.get('Origin') == origin

    async def unlock(request):
        if not same_origin(request):
            return error(403, 'invalid_origin', 'Use this worker connection page.')
        now = clock()
        if sum(t > now - 60 for t in failures) >= 5:
            return error(429, 'try_later', 'Wait a minute before trying again.')
        body = await request.json()
        candidate = body.get('pairing_secret', '') if isinstance(body, dict) else ''
        if not isinstance(candidate, str) or not hmac.compare_digest(digest(candidate), digest(pairing_secret)):
            failures.append(now)
            return error(401, 'invalid_secret', 'Pairing secret is incorrect.')
        for key, expiry in list(sessions.items()):
            if expiry <= now:
                del sessions[key]
        if len(sessions) >= 32:
            return error(429, 'try_later', 'Too many active connection pages.')
        token = secrets.token_urlsafe(32)
        sessions[digest(token)] = now + 900
        response = web.json_response({'unlocked': True})
        response.set_cookie('seed_unlock', token, secure=not development, httponly=True, samesite='Strict', path='/worker/v1', max_age=900)
        return response

    async def mint(request):
        nonlocal code
        if not same_origin(request) or not authenticated(request, True):
            return error(401, 'unlock_required', 'Unlock this connection page first.')
        if await request.json() != {}:
            return error(400, 'invalid_request', 'No fields expected.')
        token = secrets.token_urlsafe(32)
        expiry = int(clock() + 300)
        code = {'verifier': digest(token), 'expires_at': expiry}
        payload = {'version': 1, 'endpoint': origin, 'exchange_token': token, 'expires_at': expiry}
        encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(',', ':')).encode()).decode().rstrip('=')
        return web.json_response({'connection_code': 'studio1.' + encoded, 'expires_at': expiry})

    async def exchange(request):
        nonlocal code, bearer_hash
        body = await request.json()
        token = body.get('exchange_token', '') if isinstance(body, dict) else ''
        if not isinstance(token, str) or not code or code['expires_at'] <= clock() or not hmac.compare_digest(digest(token), code['verifier']):
            return error(401, 'invalid_connection_code', 'Create a fresh connection code.')
        # No await between validation, atomic persistence and consume: one exchange wins.
        credential = secrets.token_urlsafe(32)
        verifier = digest(credential)
        atomic_json(verifier_file, {'verifier': verifier})
        bearer_hash, code = verifier, None
        return web.json_response({**identity(), 'worker_credential': credential, 'worker_instance_id': instance_id, 'workspace_id': workspace_id, 'protocol_version': 2})

    async def status(request):
        if not authenticated(request, True):
            return error(401, 'authentication_required', 'Pair with this worker first.')
        state, engine_session_id, active = 'preparing', None, None
        activity = None
        try:
            async with app[HTTP].get(comfy_url + '/studio/session', allow_redirects=False) as reply:
                session = await reply.json()
                if reply.status != 200 or session.get('workspace_id') != workspace_id or session.get('protocol_version') != 2:
                    raise ValueError('Engine identity mismatch')
            async with app[HTTP].get(comfy_url + '/queue', allow_redirects=False) as reply:
                queue = await reply.json()
                if reply.status != 200 or not isinstance(queue.get('queue_running'), list) or not isinstance(queue.get('queue_pending'), list):
                    raise ValueError('Unknown queue')
            async with app[HTTP].get(comfy_url + '/studio/session', allow_redirects=False) as reply:
                confirmed = await reply.json()
                if reply.status != 200 or any(confirmed.get(key) != session.get(key) for key in ('workspace_id', 'engine_session_id', 'protocol_version')):
                    raise ValueError('Engine restarted during probe')
            engine_session_id = str(uuid.UUID(session['engine_session_id']))
            state = 'busy' if queue['queue_running'] or queue['queue_pending'] else 'ready'
            active = queue['queue_running'][0][1] if queue['queue_running'] else None
            event = confirmed.get('execution_activity') or {}
            if active and event.get('prompt_id') == active:
                activity = {'phase': event.get('phase')}
                progress = confirmed.get('sampling_progress') or {}
                if event.get('phase') == 'editing' and progress.get('prompt_id') == active:
                    activity['percent'] = progress.get('percent')
        except Exception:
            state, engine_session_id, active = 'preparing', None, None
        return web.json_response({**identity(), 'installed_loras': installed_loras(workspace), 'worker_instance_id': instance_id, 'workspace_id': workspace_id,
            'engine_session_id': engine_session_id, 'state': state, 'observed_at': clock(), 'preparation': dict(preparation),
            'active_prompt_id': active, 'execution_activity': activity, 'pending_output_count': None, 'unresolved_job_count': None})

    async def static(request):
        name = request.match_info.get('name', 'index.html')
        if name not in ['index.html', 'page.js', 'page.css']:
            raise web.HTTPNotFound()
        return web.FileResponse(Path(__file__).parent / 'static' / name)

    async def http_session(app):
        async with ClientSession(timeout=ClientTimeout(total=3)) as session:
            app[HTTP] = session
            yield
    app.cleanup_ctx.append(http_session)
    app.router.add_get('/', static)
    app.router.add_get('/static/{name}', static)
    app.router.add_post('/worker/v1/unlock', unlock)
    app.router.add_post('/worker/v1/pairing-codes', mint)
    app.router.add_post('/worker/v1/exchange', exchange)
    app.router.add_get('/worker/v1/status', status)
    manager = None
    if managed_preparation:
        from worker.preparation import install as install_preparation
        manager = install_preparation(app, workspace, runtime, authenticated)
        from worker.uploads import install as install_uploads
        install_uploads(app, manager, authenticated)
    from worker.jobs import install
    install(app, workspace, comfy_url, authenticated, manager)
    return app
