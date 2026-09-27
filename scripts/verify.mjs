import {spawnSync} from 'node:child_process';
for(const task of ['build','typecheck','test']){
 const result=spawnSync(process.execPath,[process.env.npm_execpath,'run',task],{stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
}
const secrets=spawnSync(process.execPath,['scripts/check-secrets.mjs'],{stdio:'inherit',windowsHide:true});
if(secrets.error)throw secrets.error;if(secrets.status!==0)process.exit(secrets.status??1);
const publication=spawnSync(process.execPath,['scripts/check-publication.mjs'],{stdio:'inherit',windowsHide:true});
if(publication.error)throw publication.error;if(publication.status!==0)process.exit(publication.status??1);
