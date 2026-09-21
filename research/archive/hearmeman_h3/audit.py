import concurrent.futures
import json
import pathlib
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
REPOS = {
    'template': ('Hearmeman24/comfyui-minimax', '41be57ddc95b0612a47ff2b19b2508b1fb368a57'),
    'runtime': ('Hearmeman24/comfyui-runtime', '0ea1f919c5b8102e7ab9cadf322995b480fd2e4e'),
}

def get(url):
    return urllib.request.urlopen(url, timeout=40).read()

def snapshot(item):
    name, (repo, ref) = item
    tree = json.loads(get(f'https://api.github.com/repos/{repo}/git/trees/{ref}?recursive=1'))
    paths = [x['path'] for x in tree['tree'] if x['type'] == 'blob']
    def fetch(path):
        dest = ROOT / name / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(get(f'https://raw.githubusercontent.com/{repo}/{ref}/' + urllib.parse.quote(path)))
        return path
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        result = list(pool.map(fetch, paths))
    return {'repo': repo, 'revision': ref, 'files': len(result)}

if __name__ == '__main__':
    ROOT.mkdir(parents=True, exist_ok=True)
    result = dict((key, snapshot((key, val))) for key, val in REPOS.items())
    (ROOT / 'snapshot.json').write_text(json.dumps(result, indent=2), encoding='utf8')
    print(json.dumps(result, indent=2))
