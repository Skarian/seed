import importlib.util
import io
import hashlib
from pathlib import Path
import pytest
spec=importlib.util.spec_from_file_location('receiver',Path(__file__).parents[1]/'operations/model_receiver.py')
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

def test_direct_download_verifies_and_redacts_failures(tmp_path):
    item={**asset(), 'url':'https://huggingface.co/owner/repo/resolve/'+'a'*40+'/model.safetensors'}
    def download(item, stage, token):
        assert token == 'private-fixture'
        result=stage/'model.safetensors'; result.write_bytes(b'model'); return result
    result=receiver.direct_download(tmp_path,item,'private-fixture',download)
    assert result['ready']
    assert receiver.probe(tmp_path,[item])[0]['ready']
    assert not any(b'private-fixture' in p.read_bytes() for p in tmp_path.rglob('*') if p.is_file())
    other={**item,'path':'vae/other.safetensors'}
    def failure(*args): raise RuntimeError('private-fixture https://example.com/?token=private-fixture')
    result=receiver.direct_download(tmp_path,other,'private-fixture',failure)
    assert result['ready'] is False and 'private-fixture' not in str(result)


def test_direct_download_rejects_corruption_and_sources(tmp_path):
    item={**asset(),'url':'https://civitai.com/api/download/models/123?fileId=456'}
    def corrupt(item,stage,token):
        f=stage/'civitai.part';f.write_bytes(b'wrong');return f
    assert receiver.direct_download(tmp_path,item,'',corrupt)['ready'] is False
    assert not receiver.locations(tmp_path,item)[0].exists()
    item['url']='https://elsewhere.example/model'
    assert receiver.direct_download(tmp_path,item,'',corrupt)['ready'] is False

def test_civitai_redirect_does_not_forward_token(tmp_path,monkeypatch):
    import urllib.request
    import urllib.error
    from email.message import Message
    headers=Message();headers['Location']='https://cdn.example/model?signature=temporary'
    requests=[]
    class Response(io.BytesIO):
        status=200
        headers={}
    class Opener:
        def open(self,request,timeout):
            requests.append(request)
            if len(requests)==1: raise urllib.error.HTTPError(request.full_url,302,'redirect',headers,None)
            return Response(b'model')
    monkeypatch.setattr(urllib.request,'build_opener',lambda *args:Opener())
    item={**asset(),'url':'https://civitai.com/api/download/models/123?fileId=456'}
    file=receiver.civitai_fetch(item,tmp_path,'secret-fixture')
    assert file.read_bytes()==b'model'
    assert requests[0].get_header('Authorization')=='Bearer secret-fixture'
    assert requests[1].get_header('Authorization') is None

