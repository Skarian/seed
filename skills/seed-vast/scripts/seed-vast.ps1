#requires -Version 7.0
[CmdletBinding()]
param(
 [Parameter(Position=0,Mandatory)][ValidateSet('doctor','setup','offers','rent','status','boot','connect','preparation','stop','destroy','billing')][string]$Action,
 [string]$Repo=(Get-Location).Path,
 [long]$OfferId,
 [double]$MaxHourly,
 [int]$DiskGB=180,
 [string[]]$GpuNames=@('RTX PRO 6000 WS','RTX PRO 6000 S')
)
$ErrorActionPreference='Stop'
if (!$IsWindows) {throw 'This helper currently supports Windows hosts only.'}
$Repo=(Resolve-Path -LiteralPath $Repo).Path
$work=Join-Path $Repo '.local/seed-vast'
$stateFile=Join-Path $work 'state.json'
$keyFile=Join-Path $work 'ssh-key'
$knownHosts=Join-Path $work 'known-hosts'
$apiRoot='https://console.vast.ai'
$image='ghcr.io/skarian/seed-worker@sha256:f7f4453a199ae43aacfdfcd62f089b31cd42f3967e0dc5f3f2bb3bfd4977d054'
$state=$null
if(Test-Path $stateFile){$state=Get-Content $stateFile -Raw|ConvertFrom-Json -AsHashtable}

function Protect-Text([string]$Value,[string]$File) {
 [IO.File]::WriteAllText($File,($Value|ConvertTo-SecureString -AsPlainText -Force|ConvertFrom-SecureString))
}
function Unprotect-Text([string]$File) {
 $secure=(Get-Content $File -Raw).Trim()|ConvertTo-SecureString
 $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
 try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
}
function Save-State { [IO.File]::WriteAllText($stateFile,($script:state|ConvertTo-Json -Depth 8)) }
function Api([string]$Method,[string]$Route,$Body=$null) {
 $token=if($env:VAST_API_KEY){$env:VAST_API_KEY.Trim()}else{Unprotect-Text (Join-Path $work 'api-key.dpapi')}
 try {
  $callArgs=@{Method=$Method;Uri=$apiRoot+$Route;Headers=@{Authorization='Bearer '+$token};TimeoutSec=45;MaximumRedirection=0}
  if($null -ne $Body){$callArgs.ContentType='application/json';$callArgs.Body=$Body|ConvertTo-Json -Depth 12 -Compress}
  Invoke-RestMethod @callArgs
 } catch {throw "Vast $Method $Route failed (HTTP $([int]$_.Exception.Response.StatusCode)); inspect state before retrying a mutation."}
 finally {$token=$null}
}
function Instances {
 $items=@();$route='/api/v1/instances/?limit=100'
 do {$r=Api GET $route;$items+=@($r.instances);$route='/api/v1/instances/?limit=100&after_token='+[uri]::EscapeDataString([string]$r.next_token)}while($r.next_token)
 return $items
}
function Current {
 if(!$script:state.instance_id -or $script:state.destroyed){throw 'No retained instance in this checkout. Inspect status/offers first.'}
 $r=Api GET "/api/v0/instances/$($script:state.instance_id)/"
 if(!$r.instances -or $r.instances.id -ne $script:state.instance_id){throw 'Saved Vast instance not found.'}
 return $r.instances
}
function App-Config {
 $code="import {resolvePaths} from './dist/server/storage.js';import {settings} from './dist/server/settings.js';const p=resolvePaths();console.log(JSON.stringify({paths:p,settings:settings(p)}));"
 Push-Location $Repo
 try {$raw=& node --input-type=module -e $code;if($LASTEXITCODE){throw 'Build Seed first.'};return ($raw|ConvertFrom-Json)}finally{Pop-Location}
}
function Local-Api([string]$Method,[string]$Route,$Body=$null) {
 $c=App-Config;$origin="http://$($c.settings.host):$($c.settings.port)"
 $callArgs=@{Uri=$origin+$Route;Method=$Method;Headers=@{Origin=$origin};TimeoutSec=10}
 if($null -ne $Body){$callArgs.ContentType='application/json';$callArgs.Body=$Body|ConvertTo-Json -Depth 6 -Compress}
 Invoke-RestMethod @callArgs
}
function No-Local-Work {
 $s=Local-Api GET '/api/v1/studio'
 if($s.queue.active -or $s.queue.waiting -or $s.outputs.pending){throw 'Finish or cancel local jobs and save outputs before changing the worker.'}
}
function Safe-Shutdown {
 $c=App-Config
 $connection=Get-Content (Join-Path $c.paths.config 'worker-connection.json') -Raw|ConvertFrom-Json
 if(!$script:state.paired_worker -or $connection.worker_instance_id -ne $script:state.paired_worker -or $connection.endpoint -ne 'http://127.0.0.1:18080'){
  throw 'Seed is not paired to this recorded worker. Reconnect before stopping or deleting a running instance.'
 }
 $null=Local-Api POST '/api/v1/queue/pause' @{}
 for($i=0;$i -lt 30;$i++){
  $s=Local-Api GET '/api/v1/studio'
  if($s.safe_to_terminate -eq $true){return}
  Start-Sleep -Milliseconds 500
 }
 throw 'No fresh safe-shutdown confirmation. Reconnect and reconcile before removing the worker.'
}
function Ssh-Args($instance) {
 $port=$instance.ports.'22/tcp'[0].HostPort
 if(!$port -or !$instance.public_ipaddr){throw 'Direct SSH is not ready; inspect status before retrying.'}
 @('-i',$keyFile,'-p',"$port",'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=15','-o','StrictHostKeyChecking=accept-new','-o',"UserKnownHostsFile=$knownHosts", "root@$($instance.public_ipaddr)")
}
function Stop-Tunnel {
 if($script:state.tunnel_pid){
  $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($script:state.tunnel_pid)"
  if($p -and $p.Name -eq 'ssh.exe' -and $p.CommandLine.Contains($keyFile)){Stop-Process -Id $p.ProcessId}
  $script:state.Remove('tunnel_pid');Save-State
 }
}
function Restore-App {
 if($script:state.app_managed){
  & node (Join-Path $Repo 'dist/server/cli.js') stop
  if($LASTEXITCODE){throw 'Could not stop the skill launcher.'}
  $c=App-Config;$file=Join-Path $c.paths.config 'worker-connection.json'
  $backup=Join-Path $work 'previous-connection.dpapi'
  if(Test-Path $backup){[IO.File]::WriteAllText($file,(Unprotect-Text $backup))}
  elseif(Test-Path $file){Remove-Item -LiteralPath $file}
  & node (Join-Path $Repo 'dist/server/cli.js') start --quiet
  if($LASTEXITCODE){throw 'Normal Seed restart failed; inspect the local app log.'}
  $script:state.app_managed=$false;Save-State
 }
 Stop-Tunnel
}

try {
 switch($Action){
  doctor {
   $tools=@{};foreach($name in @('node','ssh','scp','ssh-keygen')){$tools[$name]=[bool](Get-Command $name -ErrorAction SilentlyContinue)}
   $built=Test-Path (Join-Path $Repo 'dist/server/http.js')
   $credentials=@{};if($built -and $tools.node){$c=App-Config;$file=Join-Path $c.paths.config 'credentials.json';if(Test-Path $file){$saved=Get-Content $file -Raw|ConvertFrom-Json;$credentials=@{hf=[bool]($env:HF_TOKEN -or $saved.huggingFaceToken);civitai=[bool]($env:CIVITAI_API_TOKEN -or $saved.civitaiApiToken)}}}
   @{tools=$tools;built=$built;node_version=if($tools.node){& node --version}else{$null};vast_key=[bool]($env:VAST_API_KEY -or (Test-Path (Join-Path $work 'api-key.dpapi')));credentials=$credentials;state_present=[bool]$state}|ConvertTo-Json -Depth 5
  }
  setup {
   $null=New-Item -ItemType Directory -Path $work -Force
   $file=Join-Path $work 'api-key.dpapi'
   if(!(Test-Path $file)){
    $old=Join-Path $Repo '.local/vast-api-key.dpapi'
    if($env:VAST_API_KEY){Protect-Text $env:VAST_API_KEY.Trim() $file}
    elseif(Test-Path $old){Protect-Text (Unprotect-Text $old) $file}
    else {$secret=Read-Host 'Vast API key' -AsSecureString;[IO.File]::WriteAllText($file,($secret|ConvertFrom-SecureString))}
   }
   $u=Api GET '/api/v0/users/current/';@{authenticated=$true;credit=$u.credit}|ConvertTo-Json
  }
  offers {
   if($DiskGB -lt 120){throw 'Choose enough disk for the approximately 100 GB manifest and working space.'}
   $q=@{verified=@{eq=$true};external=@{eq=$false};rentable=@{eq=$true};rented=@{eq=$false};num_gpus=@{eq=1};gpu_name=@{in=$GpuNames};gpu_ram=@{gte=90000};cpu_ram=@{gte=96000};cuda_max_good=@{gte=13.0};direct_port_count=@{gte=1};disk_space=@{gte=$DiskGB};reliability2=@{gte=0.99};type='on-demand';allocated_storage=$DiskGB;order=,(@('dph_total','asc'));limit=20}
   $r=Api POST '/api/v0/bundles/' $q
   $null=New-Item -ItemType Directory -Path $work -Force
   $r.offers|ConvertTo-Json -Depth 12|Set-Content (Join-Path $work 'offers.json')
   $r.offers|Select-Object id,machine_id,gpu_name,gpu_ram,gpu_max_power,cpu_ram,geolocation,dph_total,storage_cost,inet_down,inet_down_cost,inet_up_cost,reliability2|ConvertTo-Json -Depth 5
  }
  rent {
   if(!$OfferId -or ![double]::IsFinite($MaxHourly) -or $MaxHourly -le 0){throw 'Specify an approved OfferId and finite positive MaxHourly.'}
   if($state -and !$state.destroyed){throw 'A saved rental or uncertain attempt exists. Inspect it before creating another.'}
   $existing=Instances
   if(@($existing|Where-Object {$_.cur_state -eq 'running' -or $_.actual_status -in @('running','loading','created')}).Count){throw 'An active Vast instance already exists.'}
   $cached=@(Get-Content (Join-Path $work 'offers.json') -Raw|ConvertFrom-Json)|Where-Object id -eq $OfferId
   if(!$cached){throw 'Run offers and choose a returned offer first.'}
   $r=Api POST '/api/v0/bundles/' @{machine_id=@{eq=$cached.machine_id};rentable=@{eq=$true};rented=@{eq=$false};num_gpus=@{eq=1};type='on-demand';allocated_storage=$DiskGB;limit=100}
   $offer=@($r.offers)|Where-Object id -eq $OfferId
   if(!$offer -or $offer.num_gpus -ne 1 -or $null -eq $offer.dph_total -or ![double]::IsFinite($offer.dph_total) -or $offer.dph_total -lt 0 -or $offer.dph_total -gt $MaxHourly -or $offer.gpu_name -ne $cached.gpu_name){throw 'Offer disappeared, changed hardware or exceeds approved price; choose again.'}
   if(!(Test-Path $keyFile)){& ssh-keygen -q -t ed25519 -f $keyFile -N "" -C seed-vast-agent;if($LASTEXITCODE){throw 'SSH key generation failed.'}}
   $pub=(Get-Content "$keyFile.pub" -Raw).Trim()
   $null=Api POST '/api/v0/ssh/' @{ssh_key=$pub}
   $script:state=@{offer_id=$OfferId;machine_id=$offer.machine_id;hourly=$offer.dph_total;disk_gb=$DiskGB;image=$image;attempt_at=[DateTimeOffset]::UtcNow.ToString('o');destroyed=$false};Save-State
   $r=Api PUT "/api/v0/asks/$OfferId/" @{client_id='me';image=$image;disk=$DiskGB;label='seed-agent';runtype='ssh_direc ssh_proxy';onstart='echo Seed ready for private configuration';cancel_unavail=$true;env=@{}}
   if(!$r.success -or !$r.new_contract){throw 'No confirmed contract ID. Inspect instances; do not retry rent blindly.'}
   $script:state.instance_id=$r.new_contract;Save-State
   @{instance_id=$r.new_contract;hourly=$offer.dph_total;disk_gb=$DiskGB}|ConvertTo-Json
  }
  status {
   (Instances)|Select-Object id,label,actual_status,cur_state,gpu_name,dph_total|ConvertTo-Json
   if($state.instance_id -and !$state.destroyed){$i=Current;$i|Select-Object id,actual_status,cur_state,status_msg,ssh_host,ssh_port,public_ipaddr,ports|ConvertTo-Json -Depth 5}
   try {Local-Api GET '/api/v1/studio'|ConvertTo-Json -Depth 6}catch{Write-Output 'Local Seed status unavailable.'}
  }
  boot {
   $i=Current;if($i.actual_status -ne 'running'){throw 'Wait for the instance to be running before boot.'}
   $c=App-Config;$creds=Get-Content (Join-Path $c.paths.config 'credentials.json') -Raw|ConvertFrom-Json
   $secretFile=Join-Path $work "worker-$($state.instance_id).dpapi"
   if(!(Test-Path $secretFile)){Protect-Text (@{SEED_PAIRING_SECRET=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32));JUPYTER_TOKEN=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))}|ConvertTo-Json -Compress) $secretFile}
   $payload=Unprotect-Text $secretFile|ConvertFrom-Json -AsHashtable
   $payload.HF_TOKEN=if($env:HF_TOKEN){$env:HF_TOKEN}else{$creds.huggingFaceToken}
   if(!$payload.HF_TOKEN){throw 'HF_TOKEN is required.'}
   $ct=if($env:CIVITAI_API_TOKEN){$env:CIVITAI_API_TOKEN}else{$creds.civitaiApiToken};if($ct){$payload.CIVITAI_API_TOKEN=$ct}
   $null=Api POST "/api/v0/instances/$($state.instance_id)/ssh/" @{ssh_key=(Get-Content "$keyFile.pub" -Raw).Trim()}
   $callArgs=Ssh-Args $i
   Get-Content (Join-Path $PSScriptRoot 'worker.py') -Raw|& ssh @callArgs 'umask 077; cat > /root/seed-agent-worker.py'
   if($LASTEXITCODE){throw 'SSH not ready or helper transfer failed. Retry boot after checking access.'}
   $payload|ConvertTo-Json -Compress|& ssh @callArgs '/opt/venv/bin/python /root/seed-agent-worker.py boot'
   if($LASTEXITCODE){throw 'Worker boot failed. Inspect private worker logs.'}
   $payload=$null;$creds=$null;$ct=$null
  }
  connect {
   $i=Current;if($i.actual_status -ne 'running'){throw 'The instance is not running.'}
   No-Local-Work
   Stop-Tunnel
   foreach($port in @(18080,18888)){if(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue){throw "Local tunnel port $port is already occupied."}}
   $callArgs=Ssh-Args $i;$target=$callArgs[-1];$callArgs=$callArgs[0..($callArgs.Length-2)]
   $callArgs+=@('-N','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-L','127.0.0.1:18080:127.0.0.1:8080','-L','127.0.0.1:18888:127.0.0.1:8888',$target)
   $quoted=($callArgs|ForEach-Object {'"'+$_.Replace('"','\"')+'"'}) -join ' '
   $p=Start-Process (Get-Command ssh).Source -ArgumentList $quoted -WindowStyle Hidden -RedirectStandardError (Join-Path $work 'tunnel.log') -PassThru
   $script:state.tunnel_pid=$p.Id;Save-State
   $root='http://127.0.0.1:18080';$ready=$false
   for($n=0;$n -lt 15;$n++){try{$null=Invoke-WebRequest $root -TimeoutSec 2;$ready=$true;break}catch{Start-Sleep -Seconds 1}}
   if(!$ready){Stop-Tunnel;throw 'Tunnel/worker is not ready. Run status and boot diagnostics.'}
   $c=App-Config
   if(!$state.app_managed){
    $file=Join-Path $c.paths.config 'worker-connection.json';$backup=Join-Path $work 'previous-connection.dpapi'
    if(Test-Path $file){Protect-Text (Get-Content $file -Raw) $backup}elseif(Test-Path $backup){Remove-Item -LiteralPath $backup}
    & node (Join-Path $Repo 'dist/server/cli.js') stop;if($LASTEXITCODE){throw 'Could not stop Seed.'}
    $script:state.app_managed=$true;Save-State
   }else{& node (Join-Path $Repo 'dist/server/cli.js') stop;if($LASTEXITCODE){throw 'Could not stop the skill launcher.'}}
   $launch='"'+(Join-Path $PSScriptRoot 'studio.mjs')+'" "'+$Repo+'"'
   $null=Start-Process (Get-Command node).Source -ArgumentList $launch -WorkingDirectory $Repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $work 'app.log') -RedirectStandardError (Join-Path $work 'app-error.log') -PassThru
   $ready=$false;for($n=0;$n -lt 15;$n++){try{$null=Local-Api GET '/api/v1/health';$ready=$true;break}catch{Start-Sleep -Milliseconds 500}}
   if(!$ready){throw 'Skill launcher did not start; inspect app-error.log.'}
   $secret=Unprotect-Text (Join-Path $work "worker-$($state.instance_id).dpapi")|ConvertFrom-Json
   $null=Invoke-RestMethod "$root/worker/v1/unlock" -Method Post -ContentType application/json -Headers @{Origin=$root} -Body (@{pairing_secret=$secret.SEED_PAIRING_SECRET}|ConvertTo-Json) -SessionVariable session
   $pair=Invoke-RestMethod "$root/worker/v1/pairing-codes" -Method Post -ContentType application/json -Headers @{Origin=$root} -Body '{}' -WebSession $session
   $null=Local-Api PUT '/api/v1/connection' @{connection_code=$pair.connection_code}
   $connected=Get-Content (Join-Path $c.paths.config 'worker-connection.json') -Raw|ConvertFrom-Json
   $script:state.paired_worker=$connected.worker_instance_id;Save-State
   $secret=$null;$pair=$null
   @{connected=$true;url="http://$($c.settings.host):$($c.settings.port)";queue='paused; resume when ready'}|ConvertTo-Json
  }
  preparation {$i=Current;$callArgs=Ssh-Args $i;& ssh @callArgs '/opt/venv/bin/python /root/seed-agent-worker.py preparation';if($LASTEXITCODE){throw 'Preparation measurement failed.'}}
  {$_ -in 'stop','destroy'} {
   $i=Current
   if($i.cur_state -eq 'running' -or $i.actual_status -eq 'running'){Safe-Shutdown}else{No-Local-Work}
   if($Action -eq 'destroy'){$r=Api DELETE "/api/v0/instances/$($state.instance_id)/" @{};if(!$r.success){throw 'Destroy was not confirmed.'};$script:state.destroyed=$true;Save-State}
   else{$r=Api PUT "/api/v0/instances/$($state.instance_id)/" @{state='stopped'};if(!$r.success){throw 'Stop was not confirmed.'}}
   Restore-App
   for($n=0;$n -lt 15;$n++){
    $found=@(Instances)|Where-Object id -eq $state.instance_id
    if(($Action -eq 'destroy' -and !$found) -or ($Action -eq 'stop' -and $found.actual_status -eq 'exited')){Write-Output "Confirmed $Action for instance $($state.instance_id).";break}
    Start-Sleep -Seconds 2
   }
   if($n -eq 15){throw 'Operation accepted but final provider state is not yet confirmed.'}
  }
  billing {
   $u=Api GET '/api/v0/users/current/';@{credit=$u.credit;balance=$u.balance}|ConvertTo-Json
   if($state.instance_id){
    $from=([DateTimeOffset]$state.attempt_at).UtcDateTime.Date
    $filter=@{day=@{gte=([DateTimeOffset]$from).ToUnixTimeSeconds();lte=[DateTimeOffset]::UtcNow.AddDays(1).ToUnixTimeSeconds()}}|ConvertTo-Json -Depth 4 -Compress
    $route='/api/v0/charges/?limit=100&select_filters='+[uri]::EscapeDataString($filter)
    do{$r=Api GET $route;$r.results|Where-Object source -eq "instance-$($state.instance_id)"|ConvertTo-Json -Depth 10;$route='/api/v0/charges/?limit=100&select_filters='+[uri]::EscapeDataString($filter)+'&after_token='+[uri]::EscapeDataString([string]$r.next_token)}while($r.next_token)
   }
  }
 }
} catch {
 # Do not return raw HTTP responses, account records, SSH payloads or token values.
 Write-Error ("seed-vast $Action failed: " + $_.Exception.Message)
 exit 1
}
