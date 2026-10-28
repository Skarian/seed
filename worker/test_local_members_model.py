"""Exhaustive CPU model check of Members.observe completion (no real processes).
World rules: a PID is reusable only after its process is dead and every handle is
closed; spawns require a live parent; the Job list holds live members (optionally
also dead-but-undeleted ones). An external change fires after the k-th API call."""
import itertools
import pytest
import worker.local_members as lm

class World:
    def __init__(self, zombie_listing=False):
        self.procs, self.refs, self.calls, self.events, self.zombie_listing = {}, {}, 0, [], zombie_listing
    def add(self, pid, created, alive=True, in_job=True): self.procs[pid] = {'created': created, 'alive': alive, 'in_job': in_job}
    def collect(self, pid):
        p = self.procs.get(pid)
        if p and not p['alive'] and self.refs.get((pid, p['created']), 0) == 0: del self.procs[pid]
    def spawn(self, parent, child, created):
        p = self.procs.get(parent)
        if p and p['alive'] and p['in_job'] and child not in self.procs: self.add(child, created)
    def exit(self, pid):
        if pid in self.procs: self.procs[pid]['alive'] = False; self.collect(pid)
    def kill_all(self):
        for pid in list(self.procs):
            if self.procs[pid]['in_job']: self.procs[pid]['alive'] = False; self.collect(pid)
    def hold(self, pid):
        p = self.procs[pid]; key = (pid, p['created']); self.refs[key] = self.refs.get(key, 0) + 1   # external handle keeps a zombie
    def reuse(self, pid, created):
        if pid not in self.procs: self.add(pid, created, in_job=False)
    def step(self):
        self.calls += 1
        for k, action in self.events:
            if k == self.calls: action()
    # API used by Members
    def pids(self, job):
        out = [pid for pid, p in self.procs.items() if p['in_job'] and (p['alive'] or self.zombie_listing)]; self.step(); return out
    def open(self, pid):
        p = self.procs.get(pid); out = None
        if p: out = (pid, p['created']); self.refs[out] = self.refs.get(out, 0) + 1
        self.step(); return out
    def close(self, h):
        self.refs[h] -= 1; self.collect(h[0])
    def created(self, h): return h[1]
    def contains(self, job, h):
        p = self.procs.get(h[0]); out = bool(p and p['created'] == h[1] and p['in_job']); self.step(); return out
    def signaled(self, h, timeout=0):
        p = self.procs.get(h[0]); out = not (p and p['created'] == h[1] and p['alive']); self.step(); return out
    def live_members(self): return sorted(pid for pid, p in self.procs.items() if p['alive'] and p['in_job'])

def scenario(name, setup, schedules, zombie):
    def run(observe, ks):
        w = World(zombie); members = lm.Members('job', api=w); setup(w, members, observe)
        w.calls = 0; w.events = schedules(w, ks)
        horizon = max(ks) + 2
        for _ in range(60):                                   # phase A: run through the schedule
            out = observe(members)
            if out['complete'] and w.live_members(): return 'UNSOUND'
            if w.calls > horizon: break
        w.kill_all()                                          # phase B: TerminateJobObject, then must converge
        for _ in range(4):
            out = observe(members)
            if out['complete']: return 'UNSOUND' if w.live_members() else 'ok'
        return 'LIVELOCK'
    return name, run

def recorded_then(setup_fn):
    def setup(w, members, observe):
        setup_fn(w, members, observe)
    return setup

def s1_setup(w, m, observe): w.add(1, '100'); observe(m)                       # P known, alive
def s2_setup(w, m, observe): w.add(1, '100'); observe(m); w.exit(1); w.add(2, '200')  # R known dead, U unknown alive
def s7_setup(w, m, observe): w.add(1, '100'); observe(m); w.exit(1); w.add(2, '200'); w.hold(2)   # U externally held
def s6_setup(w, m, observe): w.add(1, '100'); observe(m); w.add(2, '200')       # P known alive, U unknown alive
SC = []
for z in (False, True):
    tag = ' +zombie-list' if z else ''
    SC.append((scenario('S1 known P spawns C, exits' + tag, s1_setup, lambda w, ks: [(ks[0], lambda: (w.spawn(1, 2, '200'), w.exit(1)))], z), 1))
    SC.append((scenario('S2 unknown U spawns G, exits (parent counterexample)' + tag, s2_setup, lambda w, ks: [(ks[0], lambda: (w.spawn(2, 3, '300'), w.exit(2)))], z), 1))
    SC.append((scenario('S3 chain U->V->W' + tag, s2_setup, lambda w, ks: [(ks[0], lambda: (w.spawn(2, 3, '300'), w.exit(2))), (ks[1], lambda: (w.spawn(3, 4, '400'), w.exit(3)))], z), 2))
    SC.append((scenario('S4 unknown U exits, PID reused by outsider' + tag, s2_setup, lambda w, ks: [(ks[0], lambda: (w.exit(2), w.reuse(2, '900'))), (ks[0] + 3, lambda: w.exit(2) if w.procs.get(2, {}).get('in_job') is False else None)], z), 1))
    SC.append((scenario('S7 externally held U spawns G, exits (zombie stays)' + tag, s7_setup, lambda w, ks: [(ks[0], lambda: (w.spawn(2, 3, '300'), w.exit(2)))], z), 1))
    SC.append((scenario('S6 two spawners' + tag, s6_setup, lambda w, ks: [(ks[0], lambda: (w.spawn(1, 3, '300'), w.exit(1))), (ks[1], lambda: (w.spawn(2, 4, '400'), w.exit(2)))], z), 2))

def finisher(run):
    # After the schedule, kill whatever remains (as TerminateJobObject would) and require convergence.
    return run


@pytest.mark.parametrize('scenario_arity', SC)
def test_member_interleavings_are_sound_and_converge(scenario_arity):
    (name, run), arity = scenario_arity
    for ks in itertools.product(range(1, 26), repeat=arity):
        if arity == 2 and ks[1] <= ks[0]:
            continue
        assert run(lm.Members.observe, ks) == 'ok', (name, ks)
