# Offline test: load only the shutdown function and stub local state/API.
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'seed-vast.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors.Message -join '; ')}
$function=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Safe-Shutdown'},$true)
Invoke-Expression $function.Extent.Text
function App-Config { @{paths=@{config='test-only'}} }
function Get-Content { '{"worker_instance_id":"expected-worker","endpoint":"http://127.0.0.1:18080"}' }
$script:calls=0
function Local-Api { $script:calls++; @{safe_to_terminate=$true} }
$script:state=@{paired_worker='wrong-worker'}
$blocked=$false
try {Safe-Shutdown}catch{$blocked=$true}
if(!$blocked -or $script:calls -ne 0){throw 'A different worker must be rejected before touching its queue.'}
$script:state=@{paired_worker='expected-worker'}
Safe-Shutdown
if($script:calls -ne 2){throw 'Shutdown must pause and obtain fresh safety confirmation.'}
Write-Output 'Shutdown identity/safety tests passed.'
$apiFunction=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Api'},$true)
Invoke-Expression $apiFunction.Extent.Text
$apiRoot='https://example.invalid';$work='test-only'
function Unprotect-Text {'fake-test-key'}
function Invoke-RestMethod {
 param($Method,$Uri,$Headers,$TimeoutSec,$MaximumRedirection,$ContentType,$Body)
 if($Uri -ne 'https://example.invalid/test/' -or $Method -ne 'POST' -or !$Headers.Authorization.StartsWith('Bearer ') -or $MaximumRedirection -ne 0){throw 'Request arguments were not forwarded correctly.'}
 if(($Body|ConvertFrom-Json).value -ne 42){throw 'Request body was lost.'}
 @{success=$true}
}
$r=Api POST '/test/' @{value=42}
if(!$r.success){throw 'API result was lost.'}
Write-Output 'API argument-forwarding test passed (mock transport; no network).'
