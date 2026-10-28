"""Controlled process-tree mutations at the Job enumeration boundary."""
from worker.local_members import Members
from worker.test_local_members import API


def test_known_parent_exits_after_enumeration_and_leaves_live_child():
    api=API();members=Members('job',api=api)
    assert not members.observe()['complete']
    def enumerate_then_spawn(job):
        listed=api.listed[:]
        api.processes[1]['alive']=False
        api.processes[2]={'created':'200','alive':True,'in_job':True}
        api.listed=[2]
        return listed
    api.pids=enumerate_then_spawn
    assert not members.observe()['complete']


def test_previously_unobserved_child_spawns_grandchild_then_exits_after_enumeration():
    api=API();members=Members('job',api=api)
    assert not members.observe()['complete']
    api.processes[1]['alive']=False
    api.processes[2]={'created':'200','alive':True,'in_job':True}
    api.listed=[2]
    def enumerate_then_spawn(job):
        listed=api.listed[:]
        api.processes.pop(2,None)
        api.processes[3]={'created':'300','alive':True,'in_job':True}
        api.listed=[3]
        return listed
    api.pids=enumerate_then_spawn
    assert not members.observe()['complete']
