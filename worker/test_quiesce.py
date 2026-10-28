"""Exact pinned queue/worker loops, CPU stubs only; no GPU imports."""
import ast
import asyncio
import copy
import heapq
import importlib.util
import json
import logging
import sys
import threading
import types
import uuid
from pathlib import Path
from types import SimpleNamespace as NS
from typing import NamedTuple
import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from worker import spool
from worker.local_revision import digest, check

ROOT = Path(__file__).resolve().parents[1]
PINS = json.loads((ROOT/'worker/local-runtime.json').read_text())['roles']


@pytest.fixture
def module(monkeypatch):
    package = types.ModuleType('quiesce_fixture')
    package.__path__ = []
    monkeypatch.setitem(sys.modules, package.__name__, package)
    monkeypatch.setitem(sys.modules, package.__name__+'.spool', spool)
    spec = importlib.util.spec_from_file_location(package.__name__+'.quiesce', ROOT/'worker/comfy_seed/quiesce.py')
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def definition(path, name):
    node = next(node for node in ast.parse(path.read_text(encoding='utf-8-sig')).body
                if isinstance(node, (ast.ClassDef, ast.FunctionDef)) and node.name == name)
    return compile('from __future__ import annotations\n'+ast.unparse(node), str(path), 'exec')


def fixture(role):
    source = ROOT/'tests/fixtures/comfy-pinned'/role
    for file, expected in PINS[role]['quiesce']['files'].items(): assert digest(source/file) == expected
    env = {'threading': threading, 'heapq': heapq, 'copy': copy, 'NamedTuple': NamedTuple,
           'MAXIMUM_HISTORY_SIZE': 100, 'nodes': NS(interrupt_processing=lambda: None)}
    exec(definition(source/'execution.py', 'PromptQueue'), env)
    server = NS(queue_updated=lambda: None, client_id=None, app=web.Application(), routes=web.RouteTableDef())
    server.prompt_queue = env['PromptQueue'](server)
    return source, env, server


class EndFixture(BaseException): pass


def start_worker(role, env, source, server, events, execute=None):
    release, parked, waiting = (threading.Event() for _ in range(3))
    errors = []
    native_wait = server.prompt_queue.not_empty.wait
    def wait(timeout=None):
        waiting.set()
        return native_wait(timeout)
    server.prompt_queue.not_empty.wait = wait
    def end():
        parked.set()
        release.wait(3)
        raise EndFixture()
    executor = NS(reset=lambda: events.append('reset'), execute=execute, history_result={}, success=False, status_messages=[])
    assets = NS(queue_output_scan=lambda: None, resume_background_scan=lambda: None,
                pause_background_scan=lambda: None, is_disabled=lambda: True, pause=lambda: None, resume=lambda: None)
    env.update(args=NS(cache_classic=False, cache_none=True, cache_lru=0),
        comfy=NS(model_management=NS(total_ram=1024, unload_all_models=lambda: events.append('unload'),
                                    soft_empty_cache=lambda: events.append('soft_empty_cache'))),
        execution=NS(CacheType=NS(RAM_PRESSURE=1, CLASSIC=2, LRU=3, NONE=4), PromptQueue=env['PromptQueue'],
                     PromptExecutor=lambda *args, **kwargs: executor),
        gc=NS(collect=lambda: events.append('loop_gc')), time=NS(perf_counter=lambda: 20), logging=logging,
        hook_breaker_ac10a0=NS(restore_functions=lambda: events.append('restore')), asset_seeder=assets)
    exec(definition(source/'main.py', 'prompt_worker'), env)
    def work():
        try: env['prompt_worker'](*( (server.prompt_queue, server, assets) if role == 'image' else (server.prompt_queue, server)))
        except EndFixture: pass
        except BaseException as error:
            errors.append(error)
            parked.set()
    thread = threading.Thread(target=work, daemon=True)
    return thread, end, release, parked, waiting, errors


def revision(): return {'supported': True, 'reasons': [], 'pins_digest': 'fixture'}


@pytest.mark.asyncio
@pytest.mark.parametrize('role',['image','video'])
@pytest.mark.parametrize('escalated', [False, True])
async def test_repeated_interrupt_covers_execute_reset_and_completion_precedes_park(module,tmp_path,role,escalated):
    source,env,server=fixture(role)
    events=[]
    started,reset,allow_reset,interrupted=(threading.Event() for _ in range(4))
    def execute(*args):
        started.set()
        assert allow_reset.wait(2)
        interrupted.clear() # Native execute resets an interrupt sent too early.
        reset.set()
        assert interrupted.wait(2)
        events.append('execute_finished')
    thread,end,release,parked,_,errors=start_worker(role,env,source,server,events,execute)
    native_done=server.prompt_queue.task_done
    def done(*args,**kwargs):
        events.append('terminal_record')
        native_done(*args,**kwargs)
        events.append('queue_done')
    server.prompt_queue.task_done=done
    def interrupt(): events.append('interrupt');interrupted.set()
    drain=module.Drain(server,tmp_path,'workspace','session',revision(),NS(is_initialized=lambda:False),interrupt,
        collect=lambda:events.append('barrier_gc'),wait_forever=end)
    job=str(uuid.uuid4())
    server.prompt_queue.put((0,job,{}, {'seed_job_id':job},[],{}))
    thread.start()
    task=None
    try:
        assert await asyncio.to_thread(started.wait,1)
        if escalated:
            drain.begin('stop', cancel_running=False)
            await drain.interrupt_until_parked()
            assert not interrupted.is_set()
        drain.begin('stop', cancel_running=True)
        task=asyncio.create_task(drain.interrupt_until_parked())
        await asyncio.sleep(0)
        assert interrupted.is_set()
        allow_reset.set()
        assert await asyncio.to_thread(reset.wait,1)
        assert await asyncio.to_thread(parked.wait,2)
        assert not errors
        assert events.count('interrupt')>=2
        assert events.index('terminal_record')<events.index('queue_done')<events.index('barrier_gc')
        assert drain.snapshot()['state']=='parked'
        assert drain.snapshot()['cancel_running'] is True
        assert (tmp_path/'.seed/spool/jobs'/job/'cancel.json').exists()
    finally:
        allow_reset.set();interrupted.set();release.set();thread.join(2)
        if task:
            task.cancel()
            try: await task
            except asyncio.CancelledError: pass


def test_dead_worker_does_not_report_parked(module,tmp_path):
    _,_,server=fixture('image')
    drain=module.Drain(server,tmp_path,'workspace','session',revision(),None,lambda:None)
    thread=threading.Thread(target=lambda:None);thread.start();thread.join()
    drain.worker=thread;drain.begin('stop')
    assert drain.snapshot()['state']=='worker_dead'


@pytest.mark.asyncio
@pytest.mark.parametrize('role',['image','video'])
async def test_service_drain_finishes_running_prompt_without_cancelling_it(module,tmp_path,role):
    source,env,server=fixture(role)
    events=[];started,finish=threading.Event(),threading.Event()
    def execute(*args):
        started.set();assert finish.wait(2);events.append('finished')
    thread,end,release,parked,_,errors=start_worker(role,env,source,server,events,execute)
    drain=module.Drain(server,tmp_path,'workspace','session',revision(),NS(is_initialized=lambda:False),
        lambda:events.append('interrupt'),collect=lambda:None,wait_forever=end)
    job=str(uuid.uuid4());server.prompt_queue.put((0,job,{}, {'seed_job_id':job},[],{}))
    thread.start()
    try:
        assert await asyncio.to_thread(started.wait,1)
        drain.begin('service-stop',cancel_running=False)
        await drain.interrupt_until_parked()
        assert not (tmp_path/'.seed/spool/jobs'/job/'cancel.json').exists()
        assert 'interrupt' not in events and not parked.is_set()
        finish.set();assert await asyncio.to_thread(parked.wait,1)
        assert not errors and events[0]=='finished'
        assert drain.snapshot()['state']=='parked'
    finally:
        finish.set();release.set();thread.join(2)


@pytest.mark.parametrize('role', ['image', 'video'])
@pytest.mark.parametrize('result', ['ok', 'not_initialized', 'failed'])
def test_exact_idle_cleanup_barrier_and_free_mutex(module, tmp_path, role, result):
    source, env, server = fixture(role)
    events = []
    thread, end, release, parked, waiting, errors = start_worker(role, env, source, server, events)
    syncing, finish_sync = threading.Event(), threading.Event()
    def sync(device):
        events.append('sync'+str(device))
        syncing.set()
        assert finish_sync.wait(2)
        if result == 'failed': raise RuntimeError('private sentinel exception')
    def write(path, value):
        events.append('ack')
        spool.atomic(path, value)
    drain = module.Drain(server, tmp_path, 'workspace', 'session', revision(),
        NS(is_initialized=lambda: result != 'not_initialized', device_count=lambda: 2, synchronize=sync), lambda: None,
        collect=lambda: events.append('barrier_gc'), writer=write, wait_forever=end)
    thread.start()
    try:
        assert waiting.wait(1)
        with server.prompt_queue.mutex:
            server.prompt_queue.set_flag('free_memory', True)
            drain.begin('stop')
        if result != 'not_initialized':
            assert syncing.wait(1)
            assert drain.state == 'synchronizing'
            assert server.prompt_queue.mutex.acquire(timeout=.1)
            server.prompt_queue.mutex.release()
        finish_sync.set()
        assert parked.wait(1)
        assert not errors
        assert server.prompt_queue.mutex.acquire(timeout=.1)
        server.prompt_queue.mutex.release()
        assert events[:6] == ['unload','reset','loop_gc','soft_empty_cache','restore','barrier_gc']
        assert events[-1] == 'ack'
        assert events[6:-1] == ([] if result == 'not_initialized' else ['sync0'] if result == 'failed' else ['sync0','sync1'])
        value = drain.snapshot()
        assert value['state'] == ('sync_failed' if result == 'failed' else 'parked')
        assert value['prepared'] and value['ack_durable']
        assert 'private sentinel' not in json.dumps(value)
        with pytest.raises(module.AdmissionClosed): server.prompt_queue.put((1,))
        server.prompt_queue.set_flag('free_memory', True)
        assert not server.prompt_queue.get_flags()
    finally:
        finish_sync.set(); release.set(); thread.join(2)
        assert not thread.is_alive()


@pytest.mark.parametrize('fault', ['none', 'cancel', 'terminal', 'ack'])
def test_pending_persistence_precedes_ack_and_faults_are_metadata(module, tmp_path, fault):
    _, _, server = fixture('image')
    job = str(uuid.uuid4())
    server.prompt_queue.put((0, job, {'private': 'SENTINEL'}, {'seed_job_id': job}, [], {}))
    entered, unblock, parked, release = (threading.Event() for _ in range(4))
    def writer(path, value):
        if path.name == 'cancel.json':
            entered.set(); assert unblock.wait(2)
            if fault == 'cancel': raise OSError('SENTINEL')
        if path.name == 'stop-ack.json' and fault == 'ack': raise OSError('SENTINEL')
        spool.atomic(path, value)
    def park_wait(): parked.set(); release.wait(2)
    drain = module.Drain(server, tmp_path, 'workspace', 'session', revision(), NS(is_initialized=lambda: False),
        lambda: None, collect=lambda: None, writer=writer, wait_forever=park_wait)
    server.seed_terminal_error = {'message': 'SENTINEL'} if fault == 'terminal' else None
    begin = threading.Thread(target=lambda: drain.begin('stop'))
    def barrier():
        try: drain.park()
        except RuntimeError: pass
    worker = threading.Thread(target=barrier)
    try:
        begin.start(); assert entered.wait(1)
        drain.worker = worker; worker.start()
        assert not parked.wait(.05) and drain.state != 'parked'
        unblock.set(); assert parked.wait(1)
        value = drain.snapshot()
        assert value['state'] == 'parked'
        allowed={'engine_session_id','stop_id','pid','state','phases','worker_alive','running_job_id',
                 'sync','cancel_running','prepared','faults','ack_durable','revision'}
        assert set(value)==allowed
        if fault!='ack':
            saved=json.loads((tmp_path/'.seed/engine/session/stop-ack.json').read_text())
            assert set(saved)==allowed
            assert set(saved['revision'])=={'supported','reasons','pins_digest'}
            assert set(saved['sync'])=={'result'}
            assert all(set(item)<={'kind','job_id'} for item in saved['faults'])
        assert value['ack_durable'] is (fault != 'ack')
        assert [x['kind'] for x in value['faults']] == ([] if fault in ('none','ack') else [fault+'_persistence'])
        assert 'SENTINEL' not in json.dumps(value)
        if fault != 'cancel':
            assert json.loads((tmp_path/'.seed/spool/jobs'/job/'manifest.json').read_text())['state'] == 'cancelled'
    finally:
        unblock.set(); release.set(); begin.join(2); worker.join(2)


@pytest.mark.asyncio
@pytest.mark.parametrize('supported', [True, False])
async def test_endpoint_fence_aliases_identity_and_idempotence(module, tmp_path, supported):
    _, _, server = fixture('image')
    original_get = server.prompt_queue.get
    rev = {**revision(), 'supported': supported}
    drain = module.Drain(server, tmp_path, 'workspace', 'session', rev, None, lambda: None)
    drain.install_routes()
    if not supported: assert server.prompt_queue.get == original_get
    calls = []
    async def handler(request): calls.append(request.path); return web.json_response({})
    for route in ('/prompt','/free','/studio/prompt','/system_stats','/studio/capabilities'):
        method = 'GET' if route in ('/system_stats','/studio/capabilities') else 'POST'
        for prefix in ('', '/api'):
            if method == 'GET': server.app.router.add_get(prefix+route, handler)
            else: server.app.router.add_post(prefix+route, handler)
    server.app.add_routes(server.routes)
    client = TestClient(TestServer(server.app)); await client.start_server()
    try:
        assert (await client.post('/studio/quiesce', json={'stop_id':'stop'})).status == 409
        headers = {'X-Studio-Engine-Session':'session'}
        value = await client.post('/studio/quiesce', json={'stop_id':'stop'}, headers=headers)
        assert value.status == 200
        assert (await client.post('/studio/quiesce', json={'stop_id':'stop'}, headers=headers)).status == 200
        if supported: assert (await client.post('/studio/quiesce', json={'stop_id':'different'}, headers=headers)).status == 409
        for route in ('/prompt','/free','/studio/prompt','/system_stats','/studio/capabilities'):
            for prefix in ('', '/api'):
                response = await client.request('GET' if route in ('/system_stats','/studio/capabilities') else 'POST', prefix+route)
                assert response.status == 409
                if route in ('/system_stats','/studio/capabilities'):
                    assert (await client.head(prefix+route)).status == 409
        assert not calls
    finally: await client.close()
