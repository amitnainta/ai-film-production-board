<#
.SYNOPSIS
  Stop the local board server and any running render or assembly.

.DESCRIPTION
  Ends each process and its whole process tree (including any ffmpeg). Jobs
  already submitted to a provider keep running on the provider's side and may
  still be billed; their results are not downloaded.

.EXAMPLE
  .\stop.ps1           # stop everything
  .\stop.ps1 -Worker   # stop only the render/assembly
  .\stop.ps1 -Server   # stop only the board server
#>
param([switch]$Worker, [switch]$Server)
if (-not $Worker -and -not $Server) { $Worker = $true; $Server = $true }

$Renders = Join-Path $PSScriptRoot "renders"

function Stop-FromPidFile($file, $label) {
  if (-not (Test-Path $file)) { Write-Host "$label is not running."; return }
  $id = Get-Content $file -ErrorAction SilentlyContinue | Select-Object -First 1
  $proc = if ($id) { Get-Process -Id $id -ErrorAction SilentlyContinue }
  if ($proc -and $proc.ProcessName -eq "node") {
    taskkill /PID $id /T /F | Out-Null
    Write-Host "Stopped $label (PID $id)." -ForegroundColor Green
  } else {
    Write-Host "$label had already exited (PID $id)."
  }
  Remove-Item $file -Force -ErrorAction SilentlyContinue
}

if ($Worker) { Stop-FromPidFile (Join-Path $Renders "worker.pid") "Render worker" }
if ($Server) { Stop-FromPidFile (Join-Path $Renders "server.pid") "Board server" }
