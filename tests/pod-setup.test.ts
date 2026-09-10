import { expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prepareStorage, resolvePaths } from '../server/storage.js';
import { deploymentSettings, podEnvironment, preflightModels, setupPod, type Provider } from '../server/pod-setup.js';
import models from '../worker/models.json' with { type: 'json' };
function fixture() {
  mkdirSync('.local/tests', { recursive: true });
  const paths = resolvePaths(mkdtempSync(path.resolve('.local/tests/pod-setup-'))); prepareStorage(paths);
  const existing = { id: 'fixture-volume', name: 'models', size: 150, dataCenter: 'EU-TEST-1', type: 'STANDARD' };
  writeFileSync(path.join(paths.config, 'credentials.json'), JSON.stringify({huggingFaceToken:'fixture-hf'}));
  const template = {id:'fixture-template',name:'seed',public:false};
  const provider: Provider = { templates:vi.fn(async()=>[template]), createTemplate:vi.fn(), updateTemplate:vi.fn(async()=>template), volumes: vi.fn(async () => [existing]), datacenters: vi.fn(async () => [{ id: 'EU-TEST-1', name: 'Fixture', networkVolumeTypes: ['STANDARD'] }]), createVolume: vi.fn(), storageRate: vi.fn(async () => 0.07) };
  return { paths, provider, existing, say: vi.fn() };
}
test('reuse persists secrets and selected volume without creating paid resources or leaking secrets', async () => {
  const { paths, provider, say } = fixture();
  await setupPod(paths, { say }, provider); const before = deploymentSettings(paths);
  await setupPod(paths, { say }, provider); expect(deploymentSettings(paths)).toEqual(before);
  expect(provider.createVolume).not.toHaveBeenCalled(); expect(provider.storageRate).not.toHaveBeenCalled();
  expect(say.mock.calls.flat().join('\n')).not.toContain(before.pairingSecret);
  writeFileSync(path.join(paths.config, 'credentials.json'), JSON.stringify({ runpodApiKey: 'must-not-reach-worker', huggingFaceToken: 'fixture-hf', civitaiApiToken: 'fixture-civitai' }));
  expect(podEnvironment(paths)).toEqual({ HF_TOKEN: 'fixture-hf', CIVITAI_API_TOKEN: 'fixture-civitai', SEED_PAIRING_SECRET: before.pairingSecret, JUPYTER_TOKEN: before.jupyterToken });
});
test('lost creation response reconciles the intent and never repeats the POST', async () => {
  const { paths, provider, existing, say } = fixture();
  let created: typeof existing | undefined;
  provider.volumes = vi.fn(async () => created ? [created] : []);
  provider.createVolume = vi.fn(async intent => { created = { ...intent, id: 'created-volume' }; throw new Error('response lost'); });
  const question = vi.fn().mockResolvedValueOnce('EU-TEST-1').mockResolvedValueOnce('150').mockResolvedValueOnce('yes');
  await expect(setupPod(paths, { say, question, create: true }, provider)).rejects.toThrow('response lost');
  expect(say.mock.calls.flat().join('\n')).toContain('$10.50/month');
  await setupPod(paths, { say }, provider);
  expect(provider.createVolume).toHaveBeenCalledTimes(1); expect(deploymentSettings(paths).volumeId).toBe('created-volume');
});
test('missing saved volume and unresolved create never silently allocate another', async () => {
  const { paths, provider, say } = fixture(); await setupPod(paths, { say }, provider);
  provider.volumes = vi.fn(async () => []);
  await expect(setupPod(paths, { say }, provider)).rejects.toThrow('saved volume is missing');
  writeFileSync(path.join(paths.config, 'pod-volume-intent.json'), JSON.stringify({ name: 'unknown', size: 150, dataCenter: 'EU-TEST-1', type: 'STANDARD' }));
  await expect(setupPod(paths, { say, create: true }, provider)).rejects.toThrow('unresolved');
  expect(provider.createVolume).not.toHaveBeenCalled();
});
test('selecting an unrelated volume cannot erase an in-flight creation intent', async () => {
  const { paths, provider, existing, say } = fixture();
  const intent = { name: 'seed-in-flight', size: 150, dataCenter: 'EU-TEST-1', type: 'STANDARD' };
  const file = path.join(paths.config, 'pod-volume-intent.json');
  provider.volumes = vi.fn(async () => { writeFileSync(file, JSON.stringify(intent)); return [existing]; });
  await setupPod(paths, { say, volumeId: existing.id }, provider);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(intent);
  await expect(setupPod(paths, { say, create: true }, provider)).rejects.toThrow('unresolved');
  expect(provider.createVolume).not.toHaveBeenCalled();
});
test('declining paid storage and invalid settings preserve resources and configuration', async () => {
  const { paths, provider, say } = fixture();
  const question = vi.fn().mockResolvedValueOnce('EU-TEST-1').mockResolvedValueOnce('').mockResolvedValueOnce('no');
  await expect(setupPod(paths, { say, question, create: true }, provider)).rejects.toThrow('cancelled');
  expect(provider.createVolume).not.toHaveBeenCalled();
  const file = path.join(paths.config, 'pod-deployment.json'); writeFileSync(file, '{broken');
  expect(() => deploymentSettings(paths)).toThrow('Cannot read'); expect(readFileSync(file, 'utf8')).toBe('{broken');
});
test('model preflight checks pinned size/digest without following credential-bearing redirects', async () => {
  const { paths } = fixture();
  writeFileSync(path.join(paths.config, 'credentials.json'), JSON.stringify({ huggingFaceToken: 'fixture-hf' }));
  const request = vi.fn(async (url, init) => {
    expect(init.method).toBe('HEAD'); expect(init.redirect).toBe('manual');
    const model = models.find(item => item.url === url)!;
    return new Response(null, { status: 302, headers: { 'x-linked-size': String(model.size), 'x-linked-etag': '"' + model.sha256 + '"' } });
  });
  expect((await preflightModels(paths, request)).files).toBe(models.length);
  await expect(preflightModels(paths, vi.fn(async () => new Response(null, { status: 401 })))).rejects.toThrow('access/integrity');
});

test('private template is reused and contains worker credentials but never the RunPod API key', async () => {
  const {paths,provider,say}=fixture();
  await setupPod(paths,{say},provider);await setupPod(paths,{say},provider);
  expect(provider.createTemplate).not.toHaveBeenCalled();
  expect(provider.updateTemplate).toHaveBeenCalledTimes(2);
  const config=vi.mocked(provider.updateTemplate).mock.calls[0]![1];
  expect(config).toMatchObject({name:'seed',public:false,ports:['8080/http','8888/http']});
  expect(config.env.HF_TOKEN).toBe('fixture-hf');
  expect(config.env).not.toHaveProperty('RUNPOD_API_KEY');
  expect(deploymentSettings(paths).templateId).toBe('fixture-template');
  expect(say.mock.calls.flat().join('\n')).not.toContain('fixture-hf');
});

test('uncertain template creation reconciles by private name instead of creating duplicates', async () => {
  const {paths,provider,say}=fixture();let created=false;
  provider.templates=vi.fn(async()=>created?[{id:'new-private',name:'seed',public:false}]:[]);
  provider.createTemplate=vi.fn(async()=>{created=true;throw Error('response lost');});
  provider.updateTemplate=vi.fn(async()=>({id:'new-private',name:'seed',public:false}));
  await expect(setupPod(paths,{say},provider)).rejects.toThrow('response lost');
  await setupPod(paths,{say},provider);
  expect(provider.createTemplate).toHaveBeenCalledTimes(1);
  expect(deploymentSettings(paths).templateId).toBe('new-private');
});
