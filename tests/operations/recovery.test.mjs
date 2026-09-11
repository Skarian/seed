import test from 'node:test';
import assert from 'node:assert/strict';
import { SeedVast } from '../../operations/vast.mjs';
import { waitFor } from '../../operations/wait.mjs';
import {requestJson} from '../../operations/common.mjs';

test('provider errors retain diagnosis and redact submitted secrets and signed URLs',async()=>{
 await assert.rejects(requestJson('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer private-test-key'},body:{env:{SEED_PAIRING_SECRET:'private-pairing-value'}},fetcher:async()=>new Response(JSON.stringify({detail:'Invalid disk field. private-test-key private-pairing-value https://example.com?token=secret',errors:[{field:'disk',value:'must not echo'}]}),{status:422,headers:{'retry-after':'5'}})}),error=>{
  assert.match(error.message,/Invalid disk/);
  assert.ok(!error.message.includes('private-test'));
  assert.ok(!error.message.includes('private-pairing'));
  assert.ok(!error.message.includes('?token'));
  assert.deepEqual(error.provider.fields,['disk']);return true;
 });
});

test('uncertain rental requires two separated absence observations', async () => {
  const app = new SeedVast('.');
  app.state = { destroyed: false };
  app.instances = async () => [];
  app.saveState = async () => {};
  assert.equal((await app.reconcile()).reconciled, false);
  assert.equal((await app.reconcile()).reconciled, false);
  assert.equal(app.state.destroyed, false);
  app.state.absent_since = new Date(Date.now() - 31000).toISOString();
  assert.equal((await app.reconcile()).reconciled, true);
  assert.equal(app.state.destroyed, true);
});

test('uncertain rental never clears state while an unidentified instance exists', async () => {
  const app = new SeedVast('.');
  app.state = { destroyed: false, absent_since: new Date(0).toISOString() };
  app.instances = async () => [{ id: 123 }];
  app.saveState = async () => {};
  await assert.rejects(app.reconcile(), /Uncertain rental/);
  assert.equal(app.state.destroyed, false);
  assert.equal(app.state.absent_since, undefined);
});

test('startup wait succeeds after delay and bounds an unavailable worker', async () => {
  let time = 0, calls = 0;
  const options = { timeout: 10, interval: 5, sleep: async n => { time += n; }, now: () => time, say: () => {} };
  assert.equal(await waitFor(async () => ++calls === 2 ? 'ready' : null, options), 'ready');
  time = 0;
  await assert.rejects(waitFor(async () => null, options), /timed out/);
  assert.equal(time, 10);
});
