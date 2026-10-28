import copy
import json
from pathlib import Path
from types import SimpleNamespace as NS
import pytest
from worker.local_revision import FILES, check, inspect_disk


@pytest.fixture
def installation(tmp_path):
    source, site = tmp_path/'source', tmp_path/'site'
    for file in FILES.values():
        target = source/file; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('# synthetic pinned source\n')
    (site/'torch').mkdir(parents=True)
    (site/'comfy_aimdo').mkdir(parents=True)
    (site/'torch/version.py').write_text("__version__='fixture'\ngit_version='commit'\n")
    (site/'comfy_aimdo/_version.py').write_text("__version__=version='fixture'\n__commit_id__=commit_id='commit'\n")
    (site/'comfy_aimdo/aimdo.dll').write_bytes(b'CPU fixture, not a library')
    pins = inspect_disk(source, site)
    modules = {name: NS(__file__=str(source/file)) for name, file in FILES.items()}
    modules.update({'torch':NS(__file__=str(site/'torch/__init__.py'),__version__='fixture',version=NS(git_version='commit')),
        'comfy_aimdo._version':NS(__file__=str(site/'comfy_aimdo/_version.py'),__version__='fixture',__commit_id__='commit'),
        'comfy_aimdo.control':NS(lib=NS(_name=str(site/'comfy_aimdo/aimdo.dll')))})
    return source, site, pins, modules


def test_supported_disk_and_loaded_revisions(installation):
    source, site, pins, modules = installation
    disk, loaded = check(pins,source,site), check(pins,source,site,modules)
    assert disk == loaded and disk['supported']
    assert len(disk['pins_digest']) == 64


@pytest.mark.parametrize('field', ['schema', *('files.'+file for file in FILES.values()),
    'torch.version','torch.git_version','aimdo.version','aimdo.commit_id','aimdo.dll_sha256'])
def test_every_pin_mismatch_is_unsupported(installation, field):
    source, site, pins, modules = installation
    wrong = copy.deepcopy(pins)
    if field == 'schema': wrong['schema'] = 2
    else:
        group, name = field.split('.',1)
        wrong[group][name] = 'mismatch'
    assert not check(wrong,source,site,modules)['supported']


@pytest.mark.parametrize('name', [*FILES,'torch','comfy_aimdo._version','comfy_aimdo.control'])
def test_loaded_module_path_mismatch_is_unsupported(installation, name):
    source, site, pins, modules = installation
    if name == 'comfy_aimdo.control': modules[name].lib._name = str(site/'other.dll')
    else: modules[name].__file__ = str(site/'other.py')
    assert not check(pins,source,site,modules)['supported']


def test_missing_or_malformed_revision_fails_closed(installation):
    source, site, pins, modules = installation
    (site/'torch/version.py').write_text('invalid python #')
    result=check(pins,source,site,modules)
    assert not result['supported'] and result['reasons'] == ['revision_check_failed']
