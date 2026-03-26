$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$outLog = Join-Path $repoRoot 'logs\cpa.out.log'
$errLog = Join-Path $repoRoot 'logs\cpa.err.log'
$pidFile = Join-Path $repoRoot 'state\cpa.pid'

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outLog) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pidFile) | Out-Null

if (Test-Path $pidFile) {
  $existingPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  if ($existingPid) {
    $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($existingProcess) {
      [pscustomobject]@{
        started = $false
        pid = $existingProcess.Id
        status = 'already_running'
        stdout = $outLog
        stderr = $errLog
      }
      exit 0
    }
  }
}

$process = Start-Process `
  -FilePath $nodeExe `
  -ArgumentList 'dist/index.js' `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Set-Content -Path $pidFile -Value $process.Id -NoNewline

[pscustomobject]@{
  started = $true
  pid = $process.Id
  status = 'started'
  stdout = $outLog
  stderr = $errLog
}
