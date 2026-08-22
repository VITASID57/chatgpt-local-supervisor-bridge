param(
  [ValidateSet('run', 'doctor')]
  [string]$Mode = 'run'
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path $bridgeRoot 'runtime\control-plane-key.dpapi'
$profilePath = Join-Path $bridgeRoot 'profile.yaml'
$clientPath = Join-Path $bridgeRoot 'vendor\tunnel-client.exe'
$pidPath = Join-Path $bridgeRoot 'runtime\tunnel.pid'

if (-not (Test-Path -LiteralPath $clientPath)) { throw 'vendor\tunnel-client.exe is missing. Run setup.ps1 first.' }
if (-not (Test-Path -LiteralPath $secretPath)) { throw 'Protected runtime key is missing. Run setup.ps1 first.' }
if (-not (Test-Path -LiteralPath $profilePath)) { throw 'profile.yaml is missing. Run setup.ps1 first.' }

$secure = ConvertTo-SecureString (Get-Content -LiteralPath $secretPath -Raw)
$credential = [System.Management.Automation.PSCredential]::new('runtime', $secure)
$env:CONTROL_PLANE_API_KEY = $credential.GetNetworkCredential().Password
try {
  if ($Mode -eq 'doctor') {
    & $clientPath doctor --profile-file $profilePath --explain
  } else {
    & $clientPath run --profile-file $profilePath --pid.file $pidPath
  }
} finally {
  Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
}
