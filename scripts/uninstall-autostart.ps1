$ErrorActionPreference = 'Stop'
$taskName = 'ChatGPT Local Supervisor Bridge'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $bridgeRoot 'runtime\tunnel.pid'

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$tunnel = $null
if (Test-Path -LiteralPath $pidPath) {
  $savedPid = [int](Get-Content -LiteralPath $pidPath -Raw)
  $tunnel = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
}
if (-not $tunnel) {
  $tunnel = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'tunnel-client.exe' -and $_.CommandLine -like "*$bridgeRoot*"
  } | Select-Object -First 1
}
if ($tunnel -and $tunnel.CommandLine -like "*$bridgeRoot*") {
  Get-CimInstance Win32_Process | Where-Object {
    $_.ParentProcessId -eq $tunnel.ProcessId -and $_.CommandLine -like "*$bridgeRoot*"
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $tunnel.ProcessId -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $pidPath -ErrorAction SilentlyContinue
Write-Output 'Autostart task removed. Project files and protected key were kept.'
