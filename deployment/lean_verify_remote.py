"""Read-only replacement validation, run through remote.py."""
import pathlib, json, subprocess, tarfile
root = pathlib.Path('/workspace/ComfyUI')
backup = pathlib.Path('/workspace/h3-deployment/before-lean-startup.tar.gz')
unchanged = 0
changed = []
with tarfile.open(backup) as archive:
    for member in archive.getmembers():
        if not member.isfile() or '__pycache__' in member.name:
            continue
        path = pathlib.Path('/workspace') / member.name
        if path.is_file() and path.read_bytes() == archive.extractfile(member).read():
            unchanged += 1
        else:
            changed.append(member.name)
print(json.dumps({'backupFilesUnchanged': unchanged, 'changedSinceBackup': changed,
 'workflowFolders': [p.name for p in (root/'user/default/workflows').iterdir()],
 'models': [{'path':str(p.relative_to(root)), 'bytes':p.stat().st_size} for p in (root/'models').rglob('*.safetensors')],
 'comfyCommit': subprocess.check_output(['git','-C','/ComfyUI','rev-parse','HEAD'],text=True).strip()}, indent=2))
