[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$OutputRoot = "",
  [string]$RealSongPath = "",
  [switch]$IncludeRealSongSmokes,
  [switch]$IncludeInstallerSmokes,
  [switch]$SkipTauriBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$DesktopRoot = Join-Path $RepoRoot "desktop"
$StartedAt = Get-Date
$Commit = (& git -C $RepoRoot rev-parse HEAD).Trim()
$ShortCommit = (& git -C $RepoRoot rev-parse --short HEAD).Trim()
$Branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD).Trim()

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $RepoRoot ("test-output\release-readiness-{0}-{1}" -f $ShortCommit, $StartedAt.ToString("yyyyMMdd-HHmmss"))
} elseif (-not [System.IO.Path]::IsPathRooted($OutputRoot)) {
  $OutputRoot = Join-Path $RepoRoot $OutputRoot
}

if ($OutputRoot -match "\s" -and -not $OutputRoot.Contains($RepoRoot)) {
  throw "OutputRoot appears to be an unquoted partial path: $OutputRoot"
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$TracePath = Join-Path $OutputRoot "release-readiness.json"
$script:Steps = New-Object System.Collections.Generic.List[object]

function Get-DirtyStatus {
  $lines = & git -C $RepoRoot status --porcelain
  if ($null -eq $lines) {
    return @()
  }
  return @($lines | ForEach-Object { [string]$_ })
}

$DirtyBefore = @()
$DirtyBefore += Get-DirtyStatus
$UseRealSongSmokes = $IncludeRealSongSmokes.IsPresent -or -not [string]::IsNullOrWhiteSpace($RealSongPath)
$ResolvedRealSongPath = $null

if ($UseRealSongSmokes) {
  if ($RealSongPath -match "\s" -and -not (Test-Path -LiteralPath $RealSongPath)) {
    throw "RealSongPath appears to be an unquoted partial path: $RealSongPath"
  }
  if ([string]::IsNullOrWhiteSpace($RealSongPath)) {
    throw "Provide -RealSongPath when using -IncludeRealSongSmokes."
  }
  $ResolvedRealSongPath = (Resolve-Path -LiteralPath $RealSongPath).Path
  $env:AMS_REAL_SONG_PATH = $ResolvedRealSongPath
}

function Save-Trace {
  $dirtyAfter = @()
  $dirtyAfter += Get-DirtyStatus
  $stepsSnapshot = @()
  $stepsSnapshot += $script:Steps

  $trace = [pscustomobject]@{
    schema_version = 1
    generated_at = (Get-Date).ToString("o")
    started_at = $StartedAt.ToString("o")
    repo_root = $RepoRoot
    desktop_root = $DesktopRoot
    branch = $Branch
    commit = $Commit
    short_commit = $ShortCommit
    dirty_before = $DirtyBefore
    dirty_after = $dirtyAfter
    options = [pscustomobject]@{
      include_real_song_smokes = $UseRealSongSmokes
      real_song_path = $ResolvedRealSongPath
      include_installer_smokes = $IncludeInstallerSmokes.IsPresent
      skip_tauri_build = $SkipTauriBuild.IsPresent
    }
    output_root = $OutputRoot
    steps = $stepsSnapshot
  }
  $trace | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $TracePath -Encoding UTF8
}

function Add-SkippedStep {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Reason
  )
  $script:Steps.Add([pscustomobject]@{
    name = $Name
    status = "skipped"
    reason = $Reason
    started_at = $null
    ended_at = $null
    duration_seconds = 0
    log_path = $null
    exit_code = $null
  }) | Out-Null
  Save-Trace
}

function Invoke-ReadinessStep {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  $stepNumber = $script:Steps.Count + 1
  $safeName = $Name -replace "[^A-Za-z0-9._-]", "-"
  $logPath = Join-Path $OutputRoot ("{0:00}-{1}.log" -f $stepNumber, $safeName)
  $start = Get-Date
  $status = "passed"
  $errorMessage = $null
  $exitCode = 0

  Write-Host ("==> {0}" -f $Name)
  Push-Location -LiteralPath $WorkingDirectory
  try {
    $global:LASTEXITCODE = 0
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      & $Command *>&1 | Tee-Object -FilePath $logPath
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    $exitCode = if ($null -eq $global:LASTEXITCODE) { 0 } else { $global:LASTEXITCODE }
    if ($exitCode -ne 0) {
      throw ("Command exited with code {0}" -f $exitCode)
    }
  } catch {
    $status = "failed"
    $errorMessage = $_.Exception.Message
  } finally {
    Pop-Location
    $end = Get-Date
    $step = [pscustomobject]@{
      name = $Name
      status = $status
      started_at = $start.ToString("o")
      ended_at = $end.ToString("o")
      duration_seconds = [Math]::Round(($end - $start).TotalSeconds, 3)
      log_path = $logPath
      exit_code = $exitCode
      error = $errorMessage
    }
    $script:Steps.Add($step) | Out-Null
    Save-Trace
  }

  if ($status -ne "passed") {
    throw ("Release-readiness step failed: {0}. See {1}" -f $Name, $logPath)
  }
}

$VsDevCmd = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"

try {
  Invoke-ReadinessStep "python-compile" $RepoRoot { & python -m compileall -q src tests }
  Invoke-ReadinessStep "python-unittest" $RepoRoot { & python -m unittest discover -s tests }
  Invoke-ReadinessStep "python-cli-smoke" $RepoRoot { & python -m album_mastering_studio.cli smoke --output (Join-Path $OutputRoot "cli-smoke") }
  Invoke-ReadinessStep "desktop-build" $DesktopRoot { & npm.cmd run build }
  Invoke-ReadinessStep "desktop-integration" $DesktopRoot { & npm.cmd run test:integration }

  if ($SkipTauriBuild.IsPresent) {
    Add-SkippedStep "desktop-tauri-build" "Skipped by -SkipTauriBuild."
  } else {
    if (-not (Test-Path -LiteralPath $VsDevCmd)) {
      throw "Visual Studio Build Tools command prompt not found at $VsDevCmd"
    }
    $tauriBuildCommand = ('"{0}" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build' -f $VsDevCmd)
    Invoke-ReadinessStep "desktop-tauri-build" $DesktopRoot { & cmd.exe /c $tauriBuildCommand }
  }

  Invoke-ReadinessStep "tauri-sidecar-startup" $DesktopRoot { & npm.cmd run test:tauri-sidecar-startup }
  Invoke-ReadinessStep "tauri-release-launch" $DesktopRoot { & npm.cmd run test:tauri-release }
  Invoke-ReadinessStep "tauri-track-preview-ui" $DesktopRoot { & npm.cmd run test:tauri-track-preview-ui }
  Invoke-ReadinessStep "tauri-release-album-state" $DesktopRoot { & npm.cmd run test:tauri-release-album-state }
  Invoke-ReadinessStep "tauri-release-album-codec-qc" $DesktopRoot { & npm.cmd run test:tauri-release-album-codec-qc }
  Invoke-ReadinessStep "tauri-release-track-codec-qc" $DesktopRoot { & npm.cmd run test:tauri-release-track-codec-qc }
  Invoke-ReadinessStep "tauri-release-session-safety" $DesktopRoot { & npm.cmd run test:tauri-release-session-safety }
  Invoke-ReadinessStep "tauri-project-persistence" $DesktopRoot { & npm.cmd run test:tauri-project-persistence }

  if ($UseRealSongSmokes) {
    Invoke-ReadinessStep "tauri-real-song-codec-qc" $DesktopRoot { & npm.cmd run test:tauri-real-song-codec-qc }
    Invoke-ReadinessStep "tauri-real-song-region-preview" $DesktopRoot { & npm.cmd run test:tauri-real-song-region-preview }
    Invoke-ReadinessStep "tauri-real-song-native-ui" $DesktopRoot { & npm.cmd run test:tauri-real-song-native-ui }
    Invoke-ReadinessStep "tauri-real-song-album-playback" $DesktopRoot { & npm.cmd run test:tauri-real-song-album-playback }
    Invoke-ReadinessStep "tauri-real-song-album-codec-qc" $DesktopRoot { & npm.cmd run test:tauri-real-song-album-codec-qc }
  } else {
    Add-SkippedStep "tauri-real-song-smokes" "Skipped because no -RealSongPath was provided."
  }

  if ($IncludeInstallerSmokes.IsPresent) {
    Invoke-ReadinessStep "tauri-nsis-installed-app" $DesktopRoot { & npm.cmd run test:tauri-nsis }
    Invoke-ReadinessStep "tauri-msi-package" $DesktopRoot { & npm.cmd run test:tauri-msi }
  } else {
    Add-SkippedStep "tauri-installer-smokes" "Skipped by default. Pass -IncludeInstallerSmokes to run NSIS and MSI smokes."
  }

  Invoke-ReadinessStep "git-diff-check" $RepoRoot { & git diff --check }
  Save-Trace
  Write-Host ("Release readiness trace written to {0}" -f $TracePath)
} catch {
  Save-Trace
  Write-Error -Message $_.Exception.Message -ErrorAction Continue
  exit 1
}
