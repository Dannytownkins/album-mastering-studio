param(
    [string]$Python = ""
)

$ErrorActionPreference = "Stop"

$DesktopRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent $DesktopRoot
$VenvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$EngineEntry = Join-Path $DesktopRoot "engine\engine_entry.py"
$ResourcesRoot = Join-Path $DesktopRoot "src-tauri\resources"
$EngineDir = Join-Path $ResourcesRoot "engine"
$FfmpegDir = Join-Path $ResourcesRoot "ffmpeg"
$BuildRoot = Join-Path $DesktopRoot "build"
$PyInstallerWork = Join-Path $BuildRoot "pyinstaller-work"
$PyInstallerSpec = Join-Path $BuildRoot "pyinstaller-spec"

if (-not $Python) {
    if (Test-Path $VenvPython) {
        $Python = $VenvPython
    } else {
        if (Get-Command py -ErrorAction SilentlyContinue) {
            py -3 -m venv (Join-Path $RepoRoot ".venv")
        } else {
            python -m venv (Join-Path $RepoRoot ".venv")
        }
        $Python = $VenvPython
    }
}

& $Python -m pip install -e $RepoRoot pyinstaller | Write-Host

New-Item -ItemType Directory -Force -Path $EngineDir, $FfmpegDir, $PyInstallerWork, $PyInstallerSpec | Out-Null

& $Python -m PyInstaller `
    --clean `
    --noconfirm `
    --onefile `
    --name album-master-engine `
    --paths (Join-Path $RepoRoot "src") `
    --distpath $EngineDir `
    --workpath $PyInstallerWork `
    --specpath $PyInstallerSpec `
    $EngineEntry

function Copy-AudioTool {
    param([string]$Name)
    $Command = Get-Command $Name -ErrorAction Stop | Select-Object -First 1
    if (-not $Command.Source -or -not (Test-Path $Command.Source)) {
        throw "Could not resolve $Name on PATH."
    }
    Copy-Item -LiteralPath $Command.Source -Destination (Join-Path $FfmpegDir $Name) -Force
}

Copy-AudioTool "ffmpeg.exe"
Copy-AudioTool "ffprobe.exe"

& (Join-Path $EngineDir "album-master-engine.exe") --help | Out-Null
& (Join-Path $FfmpegDir "ffmpeg.exe") -version | Out-Null
& (Join-Path $FfmpegDir "ffprobe.exe") -version | Out-Null

Write-Host "Prepared sidecars:"
Write-Host "  $EngineDir\album-master-engine.exe"
Write-Host "  $FfmpegDir\ffmpeg.exe"
Write-Host "  $FfmpegDir\ffprobe.exe"
