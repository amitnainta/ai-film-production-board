<#
.SYNOPSIS
  Render the local board's queue (or build the rough cut) in the background.

.DESCRIPTION
  Reads the board straight from data\board and data\assets: no export needed.
  Runs `doctor` and `plan`, shows the cost plan and asks before spending. The
  render then runs in the background and writes keyframes, takes, voice files
  and errors back to the board, which updates live. PID in renders\worker.pid;
  .\stop.ps1 -Worker ends it.

.EXAMPLE
  .\render.ps1                   # render the queue
  .\render.ps1 -Assemble         # rough cut + Resolve/EDL/SRT in renders\cut
  .\render.ps1 -Only SC01-SH02   # one shot
#>
param(
  [switch]$Assemble,       # build the rough cut instead of rendering
  [string]$Music,          # assemble: music bed
  [string[]]$Only,         # limit to these shots, e.g. SC01-SH02
  [switch]$Yes             # skip the spend confirmation prompt
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Cli = Join-Path $Root "worker\src\cli.js"
$Render = Join-Path $Root "local\render.js"
$Board = Join-Path $Root "data\board"
$Inputs = Join-Path $Root "data\assets"
$Renders = Join-Path $Root "renders"
$PidFile = Join-Path $Renders "worker.pid"
$Log = Join-Path $Renders "worker.log"
$ErrLog = Join-Path $Renders "worker.err.log"

function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

if (Test-Path $PidFile) {
  $old = Get-Content $PidFile -ErrorAction SilentlyContinue
  if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
    Fail "A render is already running (PID $old). Run .\stop.ps1 -Worker first, or follow $Log."
  }
  Remove-Item $PidFile -Force
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js 20+ is not on the PATH." }
if (-not (Test-Path $Board)) { Fail "The local board has no data yet. Run .\start.ps1 and add some shots first." }
if (-not $env:FFMPEG_PATH) {
  $ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($ff) { $env:FFMPEG_PATH = $ff.Source }
  elseif ($Assemble) { Fail "ffmpeg not found. Install it (winget install Gyan.FFmpeg) or set FFMPEG_PATH." }
}

$Config = Join-Path $Root "config\pipeline.json"
if (-not (Test-Path $Config)) {
  Copy-Item (Join-Path $Root "config\pipeline.example.json") $Config
  Write-Host "Created config\pipeline.json from the example. Check model ids, voice ids and prices." -ForegroundColor Yellow
}
New-Item -ItemType Directory -Force $Renders | Out-Null

$common = @("--board", $Board, "--inputs", $Inputs)
foreach ($s in $Only) { $common += @("--only", $s) }

if ($Assemble) {
  $script = $Cli
  $cliArgs = @("assemble") + $common
  if ($Music) { $cliArgs += @("--music", (Resolve-Path $Music).Path) }
} else {
  Write-Host "== doctor" -ForegroundColor Cyan
  & node $Cli doctor @common
  Write-Host ""
  Write-Host "== plan" -ForegroundColor Cyan
  $plan = & node $Cli plan @common 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Write-Host $plan; Fail "Plan failed." }
  Write-Host $plan
  if ($plan -match "No jobs to run" -and $plan -notmatch "skip ") { Write-Host "Nothing queued; not starting a render."; exit 0 }
  if ($plan -notmatch "No jobs to run" -and -not $Yes) {
    $answer = Read-Host "Render these jobs? This may spend money (y/N)"
    if ($answer -notmatch '^(y|yes)$') { Write-Host "Cancelled."; exit 0 }
  }
  $script = $Render
  $cliArgs = @("--confirm") + $common
}

# Quote args for Start-Process (paths may contain spaces)
$argLine = (@($script) + $cliArgs | ForEach-Object { '"' + $_ + '"' }) -join " "
$proc = Start-Process -FilePath "node" -ArgumentList $argLine -WorkingDirectory $Root `
  -RedirectStandardOutput $Log -RedirectStandardError $ErrLog -WindowStyle Hidden -PassThru
Set-Content -Path $PidFile -Value $proc.Id

$what = if ($Assemble) { "Rough-cut assembly" } else { "Render" }
Write-Host "$what started (PID $($proc.Id)). The board updates as results land." -ForegroundColor Green
Write-Host "  Follow it:  Get-Content `"$Log`" -Wait"
Write-Host "  Stop it:    .\stop.ps1 -Worker"
