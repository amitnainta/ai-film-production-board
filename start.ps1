<#
.SYNOPSIS
  Start the production board on this computer and open it in the browser.

.DESCRIPTION
  Runs the local board server (local\server.js) in the background on
  http://localhost:5070 (or -Port / $env:PORT). Data is kept in data\board and
  data\assets. Its PID is kept in renders\server.pid so stop.ps1 can end it.
  Render the queue with .\render.ps1.

.EXAMPLE
  .\start.ps1
  .\start.ps1 -Port 5071 -NoBrowser
#>
param(
  [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 5070 }),
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Renders = Join-Path $Root "renders"
$PidFile = Join-Path $Renders "server.pid"
$Log = Join-Path $Renders "server.log"
$ErrLog = Join-Path $Renders "server.err.log"
$Url = "http://localhost:$Port"

function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

New-Item -ItemType Directory -Force $Renders | Out-Null

if (Test-Path $PidFile) {
  $old = Get-Content $PidFile -ErrorAction SilentlyContinue
  if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
    Write-Host "Board is already running (PID $old): $Url" -ForegroundColor Yellow
    if (-not $NoBrowser) { Start-Process $Url }
    exit 0
  }
  Remove-Item $PidFile -Force
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js 20+ is not on the PATH." }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  Fail "Port $Port is already in use. Check C:\Users\amitn\MyAIprojects\ports.md, or pass -Port <n>."
}

# One-time: the server's only dependency (the Anthropic SDK for the Claude buttons)
if (-not (Test-Path (Join-Path $Root "local\node_modules\@anthropic-ai\sdk"))) {
  Write-Host "Installing the board server's dependencies (one time)..."
  & npm install --prefix (Join-Path $Root "local") --no-audit --no-fund | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
}

if (-not $env:ANTHROPIC_API_KEY -and -not $env:ANTHROPIC_AUTH_TOKEN) {
  Write-Host "ANTHROPIC_API_KEY isn't set: the board works, but the Claude buttons ('Break into shots', 'Suggest prompts') stay hidden. See $Url/help#keys" -ForegroundColor Yellow
}

$env:PORT = "$Port"
$proc = Start-Process -FilePath "node" -ArgumentList "`"$(Join-Path $Root 'local\server.js')`"" -WorkingDirectory $Root `
  -RedirectStandardOutput $Log -RedirectStandardError $ErrLog -WindowStyle Hidden -PassThru
Set-Content -Path $PidFile -Value $proc.Id

# Wait until it answers
$up = $false
for ($i = 0; $i -lt 40 -and -not $up; $i++) {
  Start-Sleep -Milliseconds 250
  if ($proc.HasExited) { break }
  try { Invoke-WebRequest "http://127.0.0.1:$Port/api/config" -Headers @{ Host = "localhost" } -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true } catch {}
}
if (-not $up) {
  if (-not $proc.HasExited) { taskkill /PID $proc.Id /T /F | Out-Null }
  Get-Content $ErrLog -ErrorAction SilentlyContinue | Select-Object -Last 15 | Out-Host
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  Fail "The board server didn't start. Logs: $Log, $ErrLog"
}

Write-Host "Production board running (PID $($proc.Id)): $Url" -ForegroundColor Green
Write-Host "  Help:    $Url/help"
Write-Host "  Data:    $(Join-Path $Root 'data')"
Write-Host "  Render:  .\render.ps1   (rough cut: .\render.ps1 -Assemble)"
Write-Host "  Stop:    .\stop.ps1"
if (-not $NoBrowser) { Start-Process $Url }
