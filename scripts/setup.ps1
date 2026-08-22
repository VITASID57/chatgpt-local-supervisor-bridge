param(
  [string]$TunnelClientPath = '',
  [string]$TunnelId = '',
  [ValidateRange(1024, 65535)]
  [int]$HealthPort = 20822
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $bridgeRoot 'runtime'
$vendorRoot = Join-Path $bridgeRoot 'vendor'
$clientTarget = Join-Path $vendorRoot 'tunnel-client.exe'
$configPath = Join-Path $bridgeRoot 'config.json'
$configExample = Join-Path $bridgeRoot 'config.example.json'
$profilePath = Join-Path $bridgeRoot 'profile.yaml'
$secretPath = Join-Path $runtimeRoot 'control-plane-key.dpapi'

New-Item -ItemType Directory -Path $runtimeRoot, $vendorRoot -Force | Out-Null

if ($TunnelClientPath) {
  $resolvedClient = (Resolve-Path -LiteralPath $TunnelClientPath).Path
  Copy-Item -LiteralPath $resolvedClient -Destination $clientTarget -Force
}
if (-not (Test-Path -LiteralPath $clientTarget)) {
  throw 'tunnel-client.exe is missing. Download the current Windows release from https://github.com/openai/tunnel-client/releases/latest and place it in vendor\tunnel-client.exe, or pass -TunnelClientPath.'
}

if (-not (Test-Path -LiteralPath $configPath)) {
  Copy-Item -LiteralPath $configExample -Destination $configPath
  Write-Output 'Created config.json from the safe example. Edit project roots and denyRoots before normal use.'
}

if (-not $TunnelId) {
  $TunnelId = Read-Host 'Paste your OpenAI Secure MCP Tunnel ID'
}
if ($TunnelId -notmatch '^tunnel_[A-Za-z0-9_-]+$') { throw 'Tunnel ID must start with tunnel_.' }

Write-Host 'Paste the restricted runtime API key. The input is hidden and is saved with Windows DPAPI.'
$secureKey = Read-Host -AsSecureString
$encrypted = ConvertFrom-SecureString $secureKey
[System.IO.File]::WriteAllText($secretPath, $encrypted, [System.Text.UTF8Encoding]::new($false))

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction SilentlyContinue }
if (-not $nodeCommand) { throw 'Node.js 20 or later was not found on PATH.' }

function ConvertTo-YamlSingleQuoted([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

$nodePath = $nodeCommand.Source.Replace('\', '/')
$serverPath = (Join-Path $bridgeRoot 'server.mjs').Replace('\', '/')
$healthUrlPath = (Join-Path $runtimeRoot 'health-url.txt').Replace('\', '/')
$logPath = (Join-Path $runtimeRoot 'tunnel.log').Replace('\', '/')
$mcpCommand = '"' + $nodePath + '" "' + $serverPath + '"'

$profile = @"
config_version: 1
control_plane:
  base_url: "https://api.openai.com"
  tunnel_id: $(ConvertTo-YamlSingleQuoted $TunnelId)
  api_key: "env:CONTROL_PLANE_API_KEY"
health:
  listen_addr: "127.0.0.1:$HealthPort"
  url_file: $(ConvertTo-YamlSingleQuoted $healthUrlPath)
admin_ui:
  open_browser: false
log:
  level: info
  format: json
  file: $(ConvertTo-YamlSingleQuoted $logPath)
mcp:
  commands:
    - channel: main
      command: $(ConvertTo-YamlSingleQuoted $mcpCommand)
"@
[System.IO.File]::WriteAllText($profilePath, $profile, [System.Text.UTF8Encoding]::new($false))

Write-Output 'Setup files created.'
Write-Output 'Next: edit config.json, run scripts\start-tunnel.ps1 -Mode doctor, then run scripts\start-tunnel.ps1.'
