import importlib.util
import io
import hashlib
from pathlib import Path
import pytest
spec=importlib.util.spec_from_file_location('receiver',Path(__file__).parents[1]/'skills/seed/scripts/model_receiver.py')
receiver=importlib.util.module_from_spec(spec);spec.loader.exec_module(receiver)

def asset(data=b'model'):
    return dict(path='vae/test.safetensors',sha256=hashlib.sha256(data).hexdigest(),size=len(data))

def test_interrupted_transfer_resumes_and_only_promotes_verified(tmp_path):
    item=asset(); target,part=receiver.locations(tmp_path,item)
    with pytest.raises(ValueError,match='Interrupted'):
        receiver.receive(tmp_path,item,0,io.BytesIO(b'mo'))
    assert not target.exists() and part.read_bytes()==b'mo'
    assert receiver.probe(tmp_path,[item])[0]['offset']==2
    receiver.receive(tmp_path,item,2,io.BytesIO(b'del'))
    assert target.read_bytes()==b'model' and not part.exists()
    assert receiver.probe(tmp_path,[item])[0]['ready']

def test_corrupt_transfer_preserves_existing_target(tmp_path):
    item=asset();target,_=receiver.locations(tmp_path,item);target.parent.mkdir(parents=True);target.write_bytes(b'old')
    with pytest.raises(ValueError,match='hash mismatch'):
        receiver.receive(tmp_path,item,0,io.BytesIO(b'wrong'))
    assert target.read_bytes()==b'old'

def test_rejects_path_escape(tmp_path):
    item=asset();item['path']='../outside'
    with pytest.raises(ValueError): receiver.locations(tmp_path,item)
