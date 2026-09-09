"""Remove the two App-mode prototypes from the sidebar, retaining a backup."""
import remote

remote.execute('''from pathlib import Path
import shutil, json
source=Path('/workspace/ComfyUI/user/default/workflows/Neil Krea 2')
backup=Path('/workspace/h3-deployment/retired-app-prototypes')
backup.mkdir(parents=True,exist_ok=True)
names=['TEST - App mode prototype.json','TEST - Verified App prototype.app.json']
for name in names:
    src=source/name
    dst=backup/name
    if src.exists():
        if dst.exists():
            raise RuntimeError('Backup already exists; inspect before replacing: '+name)
        shutil.move(str(src),str(dst))
    assert not src.exists() and dst.is_file(), name
    print('Removed from workflows; backup retained:',name)
apps=Path('/workspace/ComfyUI/user/default/workflows/Krea Apps')
print('Retained Krea apps:',json.dumps(sorted(p.name for p in apps.glob('*.json'))))
''')
