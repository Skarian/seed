// Enrollment authority stays on the PC. Workers receive a single-use key only.
import {readJson} from './common.mjs';
import path from 'node:path';

export async function enrollmentKey(paths,{fetcher=fetch,env=process.env}={}) {
  const saved=await readJson(path.join(paths.config,'credentials.json'),{});
  const id=env.TAILSCALE_CLIENT_ID||saved.tailscaleClientId;
  const secret=env.TAILSCALE_CLIENT_SECRET||saved.tailscaleClientSecret;
  if(!id||!secret)throw Error('Tailscale enrollment is not configured. Configure the PC-held worker-tag OAuth credential first.');
  const response=await fetcher('https://api.tailscale.com/api/v2/oauth/token',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    body:new URLSearchParams({client_id:id,client_secret:secret,grant_type:'client_credentials',scope:'auth_keys',tags:'tag:seed-worker'}),
  });
  if(!response.ok)throw Error(`Tailscale enrollment authentication failed (HTTP ${response.status}).`);
  const token=await response.json();
  if(typeof token.access_token!=='string')throw Error('Tailscale returned no access token.');
  const created=await fetcher('https://api.tailscale.com/api/v2/tailnet/-/keys',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},
    body:JSON.stringify({capabilities:{devices:{create:{reusable:false,ephemeral:true,preauthorized:true,tags:['tag:seed-worker']}}},expirySeconds:600,description:'Seed worker enrollment'}),
  });
  if(!created.ok)throw Error(`Tailscale could not issue a worker key (HTTP ${created.status}).`);
  const result=await created.json();
  if(typeof result.key!=='string'||!result.key.startsWith('tskey-auth-'))throw Error('Tailscale returned an invalid worker key.');
  return result.key;
}

export function tailscaleOrigin(address) {
  const parts=String(address).split('.').map(Number);
  if(parts.length!==4||parts.some(x=>!Number.isInteger(x)||x<0||x>255)||parts[0]!==100||parts[1]<64||parts[1]>127)
    throw Error('Worker did not report a valid Tailscale IPv4 address.');
  return `http://${parts.join('.')}:8080`;
}
