$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$excluded = @('\.git\', '\runtime\', '\vendor\')
$personalPatterns = @(
  ('杜' + '佳珊'),
  ('沈' + '嘟嘟'),
  ('memory' + '-server'),
  ('commercial' + '-product'),
  ('H:' + '\')
)
$findings = @()

Get-ChildItem -LiteralPath $bridgeRoot -Recurse -File | ForEach-Object {
  $file = $_
  if ($excluded | Where-Object { $file.FullName -like "*$_*" }) { return }
  $text = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
  if ($null -eq $text) { return }
  if ($text -match 'sk-[A-Za-z0-9_-]{20,}') { $findings += "$($file.FullName): possible API key" }
  if ($text -match 'tunnel_[A-Za-z0-9_-]{20,}') { $findings += "$($file.FullName): possible tunnel ID" }
  foreach ($pattern in $personalPatterns) {
    if ($text.Contains($pattern)) { $findings += "$($file.FullName): private marker" }
  }
}

if ($findings.Count) {
  $findings | ForEach-Object { Write-Error $_ }
  exit 1
}
Write-Output 'Public-source scan passed: no credential-shaped or private deployment markers found.'
