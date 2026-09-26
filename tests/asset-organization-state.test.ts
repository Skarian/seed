import {afterEach, beforeEach, expect, it, vi} from 'vitest';

let state:typeof import('../web/hooks/use-asset-organization.js');
let events:EventTarget;
beforeEach(async()=>{
  vi.resetModules();events=new EventTarget();vi.stubGlobal('window',events);
  state=await import('../web/hooks/use-asset-organization.js');
});
afterEach(()=>vi.unstubAllGlobals());

it('an older asset/list read cannot undo a successful favorite or membership write',()=>{
  const started=state.getOrganizationEpoch();
  state.publishOrganizationChange({id:'asset',favorite:true});
  state.publishOrganizationChange({id:'asset',collection_ids:['landscapes']});
  expect(state.reconcileOrganization({id:'asset',favorite:false,collection_ids:[]},started)).toEqual({id:'asset',favorite:true,collection_ids:['landscapes']});
  expect(state.reconcileOrganization({id:'other',favorite:false,collection_ids:[]},started)).toEqual({id:'other',favorite:false,collection_ids:[]});
});

it('a fresh read accepts another device’s change, synchronizes mounted controls and preserves protection from older snapshots',()=>{
  state.publishOrganizationChange({id:'asset',favorite:true,collection_ids:['landscapes']});
  const started=state.getOrganizationEpoch(),read=vi.fn(),mutation=vi.fn(),reload=vi.fn();
  events.addEventListener('seed:asset-organization-read',read);
  events.addEventListener(state.ORGANIZATION_CHANGED,mutation);
  events.addEventListener('seed:library-changed',reload);
  const fresh={id:'asset',favorite:false,collection_ids:['portraits']};
  expect(state.reconcileOrganization(fresh,started)).toEqual(fresh);
  expect(read).toHaveBeenCalledTimes(1);
  expect((read.mock.calls[0]![0] as CustomEvent).detail).toEqual(fresh);
  expect(mutation).not.toHaveBeenCalled();expect(reload).not.toHaveBeenCalled();
  // An older preview's initial prop is a snapshot, not a new authoritative read.
  expect(state.reconcileOrganization({id:'asset',favorite:true,collection_ids:['landscapes']},0)).toEqual(fresh);
  expect(state.reconcileOrganization(fresh,started)).toEqual(fresh);
  expect(read).toHaveBeenCalledTimes(1);
});

it('tracks favorite and collection writes separately when a read overlaps only one mutation',()=>{
  state.publishOrganizationChange({id:'asset',favorite:true});
  const started=state.getOrganizationEpoch();
  state.publishOrganizationChange({id:'asset',collection_ids:['new']});
  expect(state.reconcileOrganization({id:'asset',favorite:false,collection_ids:['old']},started)).toEqual({id:'asset',favorite:false,collection_ids:['new']});
  state.publishOrganizationChange({id:'asset',favorite:true});
  expect(state.reconcileOrganization({id:'asset',favorite:false,collection_ids:[]},started)).toEqual({id:'asset',favorite:true,collection_ids:['new']});
});

it('ignores collection ordering and incomplete read payloads without discarding known state',()=>{
  state.publishOrganizationChange({id:'asset',favorite:true,collection_ids:['a','b']});
  const started=state.getOrganizationEpoch(),read=vi.fn();events.addEventListener('seed:asset-organization-read',read);
  state.reconcileOrganization({id:'asset',collection_ids:['b','a']},started);
  state.reconcileOrganization({id:'asset'},started);
  expect(read).not.toHaveBeenCalled();
  expect(state.reconcileOrganization({id:'asset'},0)).toEqual({id:'asset',favorite:true,collection_ids:['a','b']});
});
