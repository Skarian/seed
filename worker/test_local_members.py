import pytest
from worker.local_members import Members, prior_members
from worker.local_supervisor import parse_command


class API:
    def __init__(self):
        self.processes = {1: {'created': '100', 'alive': True, 'in_job': True}}
        self.listed = [1]
        self.denied = set()
        self.closed = []
        self.fail_list = False

    def pids(self, job):
        if self.fail_list: raise OSError('fixture query failure')
        return self.listed[:]

    def open(self, pid):
        if pid in self.denied: raise OSError('fixture access denied')
        if pid not in self.processes: return None
        return (pid, self.processes[pid]['created'])

    def close(self, handle): self.closed.append(handle)
    def created(self, handle): return handle[1]
    def contains(self, job, handle): return self.processes[handle[0]]['in_job']
    def signaled(self, handle, timeout=0):
        process = self.processes.get(handle[0])
        return process is None or process['created'] != handle[1] or not process['alive']


def test_every_member_must_exit_and_late_members_are_observed():
    api = API()
    recorded = []
    members = Members('job', recorded.append, api)
    assert not members.observe()['complete']
    api.processes[1]['alive'] = False
    api.processes[2] = {'created': '200', 'alive': True, 'in_job': True}
    api.listed = [2]
    assert not members.observe()['complete']
    assert recorded == [{'pid': 1, 'created': '100'}, {'pid': 2, 'created': '200'}]
    api.processes[2]['alive'] = False
    assert members.observe()['complete']
    assert members.snapshot() == recorded
    members.close()
    assert api.closed[-2:] == [(1, '100'), (2, '200')]


@pytest.mark.parametrize('failure', ['open', 'enumerate'])
def test_access_or_enumeration_failure_never_confirms_exit(failure):
    api = API()
    if failure == 'open': api.denied.add(1)
    else: api.fail_list = True
    outcome = Members('job', api=api).observe()
    assert outcome['unresolved'] and not outcome['complete']


def test_unrecorded_member_is_retried_after_journal_failure():
    api, calls = API(), []
    def record(member):
        calls.append(member)
        if len(calls) == 1: raise OSError('fixture full disk')
    members = Members('job', record, api)
    assert members.observe()['unresolved']
    api.processes[1]['alive'] = False
    assert members.observe()['complete']
    assert len(calls) == 2


def test_reused_pid_outside_job_requires_a_clean_followup_enumeration():
    api = API()
    members = Members('job', api=api)
    assert not members.observe()['complete']
    api.processes[1] = {'created': '900', 'alive': True, 'in_job': False}
    assert not members.observe()['complete']
    api.listed = []
    assert members.observe()['complete']
    assert members.snapshot() == [{'pid': 1, 'created': '100'}]
    assert (1, '900') in api.closed


def test_access_denied_pid_remains_unresolved_after_job_list_omits_it():
    api=API();api.denied.add(1)
    members=Members('job',api=api)
    assert members.observe()['unresolved']
    api.listed=[]
    assert members.observe()['unresolved']
    assert not members.observe()['complete']
    api.denied.clear();api.processes.clear()
    assert members.observe()['complete']


def test_unknown_identities_survive_recovery_and_are_durably_cleared():
    api=API();api.denied.add(1);saved=[]
    members=Members('job',api=api,on_unresolved=lambda pids:saved.append(pids))
    assert members.observe()['unresolved']
    assert saved[0][0]['pid']==1 and saved[0][0]['created'] is None
    assert saved[0][0]['first_seen'].isdecimal()
    api.denied.clear()
    assert prior_members([{'pid':1,'created':None}],api)['gone'] is False
    api.processes[1]['alive']=False;api.listed=[]
    # Resolving a carried-over PID absent from the fresh list needs no retry.
    assert members.observe()['complete'] and saved[-1]==[]
    assert prior_members([{'pid':1,'created':None}],api)['gone'] is True


@pytest.mark.parametrize('state,expected', [('alive', False), ('gone', True), ('reused', True), ('signaled', True), ('denied', False)])
def test_prior_identity_check(state, expected):
    api = API()
    if state == 'gone': api.processes.clear()
    if state == 'reused': api.processes[1]['created'] = '900'
    if state == 'signaled': api.processes[1]['alive'] = False
    if state == 'denied': api.denied.add(1)
    result = prior_members([{'pid': 1, 'created': '100'}], api)
    assert result['gone'] is expected
    assert result['members'][0]['state'] == ('gone' if expected else 'unknown' if state == 'denied' else 'alive')


@pytest.mark.parametrize('first_seen', ['500', '900', '950'])
def test_unresolved_identity_is_not_released_by_wall_clock_order(first_seen):
    api=API()
    api.processes[1]['created']='900'
    outcome=prior_members([{'pid':1,'created':None,'first_seen':first_seen}],api)
    assert not outcome['gone'] and outcome['members'][0]['state']=='unknown'


def test_live_exact_identity_stays_owned_in_the_same_boot():
    api=API();api.boot_id=lambda:22
    assert not prior_members([{'pid':1,'created':'100'}],api,prior_boot=22)['gone']


def test_live_exact_identity_overrides_a_higher_boot_counter():
    api=API();api.boot_id=lambda:23
    outcome=prior_members([{'pid':1,'created':'100'}],api,prior_boot=22)
    assert not outcome['gone'] and outcome['members'][0]['state']=='alive'
    assert api.closed==[(1,'100')]


def test_reused_exact_identity_resolves_with_a_higher_boot_counter():
    api=API();api.boot_id=lambda:23
    outcome=prior_members([{'pid':1,'created':'99'}],api,prior_boot=22)
    assert outcome['gone'] and outcome['members'][0]['state']=='gone'
    assert api.closed==[(1,'100')]


@pytest.mark.parametrize('boot,expected', [(22,'unknown'), (23,'gone')])
def test_inaccessible_identity_needs_a_later_boot_to_resolve(boot,expected):
    api=API();api.boot_id=lambda:boot;api.denied.add(1)
    outcome=prior_members([{'pid':1,'created':'100'}],api,prior_boot=22)
    assert outcome['members'][0]['state']==expected
    assert outcome['gone']==(expected=='gone')


def test_legacy_pid_can_be_resolved_after_a_later_boot():
    api=API();api.boot_id=lambda:23
    outcome=prior_members([{'pid':1,'created':None}],api,prior_boot=22)
    assert outcome['gone'] and outcome['rebooted']


@pytest.mark.parametrize('boot', [None, 21, 22])
def test_missing_equal_or_reset_boot_counter_does_not_clear_legacy_identity(boot):
    api=API();api.boot_id=lambda:boot
    outcome=prior_members([{'pid':1,'created':None}],api,prior_boot=22)
    assert not outcome['gone'] and not outcome['rebooted']


def test_legacy_stop_is_honestly_labeled_forced():
    assert parse_command('stop\n') == {'op': 'terminate', 'stop_id': None, 'mode': 'forced', 'reason': 'legacy_stop'}
    assert parse_command('{"op":"terminate","stop_id":"fixture","mode":"quiesced","reason":"idle"}')['mode'] == 'quiesced'
    with pytest.raises(ValueError): parse_command('{"op":"terminate","stop_id":"fixture","mode":"quiesced","reason":"arbitrary private text"}')
