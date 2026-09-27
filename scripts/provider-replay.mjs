// Recorded response replay with explicit fault injection. Not a marketplace
// simulator: allocation, visibility and response loss are controlled test state.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';

const recorded = name => JSON.parse(readFileSync(new URL(`../tests/fixtures/provider-synthetic/${name}.json`, import.meta.url), 'utf8'));
export async function providerReplay({directory, provider, checkpoint, boundary}) {
  mkdirSync(directory,{recursive:true});
  const state = {rentals:{},audit:[]}; let held=false;
  const record=(operation,details={})=>{
    state.audit.push({at:new Date().toISOString(),operation,...details});
    writeFileSync(path.join(directory,'provider-state.json'),JSON.stringify(state,null,2));
  };
  const respond=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const interrupt=(res,operation)=>{
    if(checkpoint!==operation||held)return false;
    held=true;record('response-held',{checkpoint:operation});boundary(operation);
    // The child is killed while this actual HTTP response remains unfinished.
    res.on('close',()=>record('response-connection-closed',{checkpoint:operation}));return true;
  };
  const server=createServer(async(req,res)=>{
    try {
      assert.equal(req.headers.authorization,'Bearer fixture-key');
      const url=new URL(req.url,'http://127.0.0.1');
      const name=url.pathname.split('/')[1],route=url.pathname.slice(name.length+1);
      let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<65536);}
      const body=raw?JSON.parse(raw):undefined;
      record('http',{provider:name,method:req.method,path:route});
      if(route==='/catalog/gpus')return respond(res,{gpus:name===provider?recorded('runpod-image-catalog').response.gpus:[]});
      if(route==='/api/v0/bundles/')return respond(res,{offers:name===provider?recorded('vast-image-catalog').response.offers:[]});
      assert.equal(name,provider,'Unexpected provider mutation or inventory read');
      const create=name==='runpod'?req.method==='POST'&&route==='/pods':req.method==='PUT'&&route==='/api/v0/asks/1001/';
      if(create){
        const label=body.name??body.label;
        assert.match(label,/^seed-[a-f0-9-]{36}$/);assert.equal(Object.keys(state.rentals).length,0,'Duplicate rental');
        assert.match(body.image,/@sha256:[a-f0-9]{64}$/);assert.ok(body.disk>0);
        assert.equal(body.env.SEED_SSH_PUBLIC_KEY,body.env.PUBLIC_KEY);assert.equal(body.env.SEED_START_SSH,'1');
        assert.equal(body.env.SEED_WORKER_CLASS,'image');assert.ok(body.env.SEED_PAIRING_SECRET);
        if(name==='runpod'){assert.equal(body.gpu.count,1);assert.deepEqual(body.ports,['22/tcp']);assert.equal(body.cloud,'SECURE');}
        else {assert.equal(body.runtype,'args');assert.deepEqual(body.args,['/opt/venv/bin/python','-m','worker.entrypoint']);assert.equal(body.env['-p 22:22'],'1');}
        const captured=recorded(name+'-ready').response;
        const resource=structuredClone(name==='vast'?captured.instances:captured);
        resource.id=name==='vast'?100001:'fixture-rental';resource[name==='vast'?'label':'name']=label;
        resource.image=body.image;if(name==='vast')resource.image_uuid=body.image;
        if(name==='runpod')resource.createdAt=new Date().toISOString();
        state.rentals[String(resource.id)]=resource;record('create',{id:String(resource.id),label});
        if(interrupt(res,'create'))return;
        return respond(res,name==='vast'?recorded('vast-created').response:resource,name==='vast'?200:201);
      }
      if(req.method==='GET'&&(route==='/pods'||route==='/api/v1/instances/'))
        return respond(res,name==='vast'?{instances:Object.values(state.rentals)}:{pods:Object.values(state.rentals)});
      const match=route.match(name==='vast'?/^\/api\/v0\/instances\/(\d+)\/(ssh\/)?$/:/^\/pods\/([^/]+)$/);
      assert.ok(match,'Unrecorded provider route: '+req.method+' '+route);
      const resource=state.rentals[match[1]];
      if(req.method==='GET'){
        if(!resource){const gone=recorded(name+'-deleted');return respond(res,gone.response,gone.status);}
        return respond(res,name==='vast'?{instances:resource}:resource);
      }
      if(req.method==='POST'&&match[2]==='ssh/')return respond(res,recorded('vast-ssh').response);
      assert.equal(req.method,'DELETE');assert.ok(resource,'Duplicate delete');
      delete state.rentals[match[1]];record('destroy',{id:match[1]});
      if(interrupt(res,'destroy'))return;
      // Success bodies are deliberately empty: deletion is established by the
      // subsequent recorded absence response, never by this acknowledgement.
      res.writeHead(204);res.end();
    }catch(error){record('violation',{message:error.message});respond(res,{error:error.message},500);}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {origin:`http://127.0.0.1:${server.address().port}`,state,
    close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
