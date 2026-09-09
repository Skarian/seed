"""Refresh handoff pointers after deployment validation."""
import pathlib, json
p = pathlib.Path(__file__).parent
c = json.loads((p/'configuration.json').read_text())
pod = c['podId']
guide = '''# Your ComfyUI setup

Use [LEAN-SETUP.md](LEAN-SETUP.md) for Start/Connect/Stop, GPU-unavailable recovery, replacements and future changes. It supersedes the older deployment plans.

- Saved template: **Neil ComfyUI - H3 Krea Qwen** (`7522irqo4q`).
- Current saved pod: **neil-comfyui-replacement** (`s1bsc8hbjh0vqx`). See [live handoff status](STATUS.md).
- Storage: **neil-h3-models**, **150 GB**, EUR-IS-1, mounted at `/workspace`.
- [Runpod controls](https://console.runpod.io/pods?id=s1bsc8hbjh0vqx)
- [ComfyUI, when running](https://s1bsc8hbjh0vqx-8080.proxy.runpod.net/)
- [Jupyter administration, when running](https://s1bsc8hbjh0vqx-8888.proxy.runpod.net/lab)

Sign in using the existing Jupyter token. Use Runpod's Connect button after replacing a pod because its URL changes.

Workflow guides: [Krea 2](KREA2-START-HERE.md), [Qwen Rapid](QWEN-RAPID-START-HERE.md).

For H3, open **Workflows → Neil H3** and select a Turbo 8 preset. Defaults are 1344×768, 124 frames at 24 fps with audio. For image/reference workflows, choose your image in Load Image. Reference prompts identify the first image as `<Picture 1>`. The Standard 20 presets take longer. Auto Prompt variants under the upstream MiniMax H3 folder require a separate OpenRouter key.

Models, uploads, outputs, workflows and settings live under `/workspace/ComfyUI`. Keep personal workflow variants in the Neil folders; upstream refreshes some of its example/troubleshooting files at startup.

Earlier H3 measurements and deployment history are preserved in [START-HERE-HISTORY.md](START-HERE-HISTORY.md); its old pod URLs, storage figures and operating instructions are historical.
'''
old=p/'START-HERE.md'
if not (p/'START-HERE-HISTORY.md').exists(): (p/'START-HERE-HISTORY.md').write_text(old.read_text(),encoding='utf-8')
old.write_text(guide,encoding='utf-8')
k=p/'KREA2-START-HERE.md'; text=k.read_text()
text='# Krea 2: installed and tested\n\nUse [START-HERE.md](START-HERE.md) for the current pod, login and startup instructions.\n\n'+text[text.index("In ComfyUI's Workflows sidebar"):]
k.write_text(text,encoding='utf-8')
q=p/'QWEN-RAPID-START-HERE.md'; text=q.read_text().replace('ComfyUI: https://uuwayipczbkwcd-8080.proxy.runpod.net/','Use [START-HERE.md](START-HERE.md) for the current pod, login and startup instructions.')
q.write_text(text,encoding='utf-8')
for path in [p/'COMFYUI-DEPLOYMENT-PLAN.md',p/'COMFYUI-DEPLOYMENT-PLAN-v2.md',p.parent/'LATEST-PLAN.md']:
    text=path.read_text()
    target='deployment/LEAN-SETUP.md' if path.parent==p.parent else 'LEAN-SETUP.md'
    marker=f'> Historical planning document. The implemented lean setup and current operating instructions are in [{target}]({target}).\n\n'
    if not text.startswith(marker):path.write_text(marker+text,encoding='utf-8')
c['notes']='Attach existing volume f7vnixgws1 at /workspace. Use LEAN-SETUP.md. Only one pod may run against this workspace. Existing Jupyter token protects 8080 and 8888; raw ComfyUI stays on loopback.'
(p/'configuration.json').write_text(json.dumps(c,indent=2)+'\n')
