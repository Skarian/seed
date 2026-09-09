import pathlib, json, remote
pod=json.loads((pathlib.Path(__file__).parent/'configuration.json').read_text())['podId']
remote.execute("from pathlib import Path; print(Path("+repr('/workspace/comfyui_'+pod+'_nohup.log')+").read_text()[-4000:])")
