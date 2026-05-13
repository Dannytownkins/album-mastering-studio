# Office Build Handoff

Last updated: 2026-05-13

This is the practical handoff for building or testing Album Mastering Studio on a different Windows machine. It is meant to be read before the long progress log.

## Current State

- Source of truth: `master` in Git.
- Current phase: manual user testing, not more unattended hardening loops.
- Primary app to test after a release build: `desktop\src-tauri\target\release\album-mastering-studio.exe`.
- Current release evidence on the original machine: `test-output\release-readiness-fe808df-live-preview-scope-decision\release-readiness.json` passed `25 passed`, `0 failed`, `0 skipped`.
- That `test-output` evidence is ignored by Git and may not exist on the office machine unless copied separately.

## What Git Contains

Git contains the source, docs, test harnesses, and build scripts needed to continue:

- Python engine: `src\album_mastering_studio\`
- Python tests: `tests\test_pipeline.py`
- Tauri desktop app: `desktop\`
- Desktop smoke tests: `desktop\tests\`
- Sidecar build script: `desktop\scripts\prepare-sidecars.ps1`
- Release-readiness runner: `scripts\release-readiness.ps1`
- Active handoff docs:
  - `docs\codex-active-handoff.md`
  - `docs\progress.md`
  - `docs\GOAL_AUDIT.md`
  - `docs\RELEASE_CANDIDATE_CLOSEOUT.md`
  - `docs\MANUAL_LISTENING_TEST_GUIDE.md`
  - `docs\NEW_AGENT_WORKFLOW.md`

Git does not contain generated local state:

- `.venv\`
- `desktop\node_modules\`
- `desktop\dist\`
- `desktop\src-tauri\resources\`
- `desktop\src-tauri\target\`
- `outputs\`
- `test-output\`
- `private-audio-fixtures\`

Those are intentionally ignored.

## Office Machine Prerequisites

Install or verify these before building:

- Git
- Python 3.11 or newer
- Node.js and npm
- Rust toolchain for Windows MSVC
- Visual Studio 2022 Build Tools with the C++ desktop build tools
- FFmpeg and FFprobe on `PATH`
- WebView2 Runtime, usually already present on modern Windows

Quick checks:

```powershell
git --version
py -3.11 --version
python --version
node --version
npm --version
rustc --version
cargo --version
ffmpeg -version
ffprobe -version
```

If `py -3.11` is not available but `python --version` is 3.11 or newer, use `python` in the setup commands.

## Clone And Install

```powershell
git clone https://github.com/Dannytownkins/album-mastering-studio.git
cd album-mastering-studio
git checkout master
git pull --ff-only

py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e .

cd desktop
npm ci
```

If PowerShell blocks activation, use:

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e .
```

## Build The Release App

From the repo root:

```powershell
cd desktop
npm run tauri:build
```

`npm run tauri:build` runs `npm run build` and `npm run build:sidecars` through Tauri's `beforeBuildCommand`. The sidecar step:

- installs the Python package and PyInstaller into the local venv
- builds `desktop\src-tauri\resources\engine\album-master-engine.exe`
- copies `ffmpeg.exe` and `ffprobe.exe` into `desktop\src-tauri\resources\ffmpeg\`

Expected release outputs:

```text
desktop\src-tauri\target\release\album-mastering-studio.exe
desktop\src-tauri\target\release\bundle\nsis\Album Mastering Studio_0.1.0_x64-setup.exe
desktop\src-tauri\target\release\bundle\msi\Album Mastering Studio_0.1.0_x64_en-US.msi
```

If the build cannot find `ffmpeg.exe` or `ffprobe.exe`, fix `PATH` first rather than editing the app.

## Run The App

For manual testing after build:

```powershell
.\src-tauri\target\release\album-mastering-studio.exe
```

For development:

```powershell
npm run tauri:dev
```

## Minimal Verification On A New Machine

Do not start with the full 25-step release loop. Start small:

```powershell
cd ..
python -m compileall -q src tests
python -m unittest discover -s tests

cd desktop
npm run build
npm run test:integration
npm run tauri:build
```

Then run the manual Track Master test in `docs\MANUAL_LISTENING_TEST_GUIDE.md`.

## Full Release Trace Only When Needed

Use the full runner only after meaningful code/build changes, before sharing an installer, or when investigating a specific regression:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release-readiness.ps1 -RealSongPath "C:\path\to\real-song.mp3" -IncludeInstallerSmokes -OutputRoot "test-output\release-readiness-office"
```

Notes:

- `-RealSongPath` must be a local office-machine audio file.
- Real-song smokes use `AMS_REAL_SONG_PATH` internally.
- Multi-song Album Master smoke can use `AMS_REAL_SONG_ALBUM_PATHS` if needed.
- Results are written under ignored `test-output\`.

## Known State Before Office Testing

- Track Master is the priority workflow.
- The app supports MP3/lossy input and must not modify the source file.
- Volume Match should be off by default and affect monitoring only.
- Generated transitions should remain off by default.
- Live Preview is directional-only. It is useful for fast control feedback, but Update Preview, Render Region, codec preview, and Export Master are the release-faithful paths.
- The remaining release-candidate gates are user listening approval and explicit acceptance or rejection of Live Preview's directional-only scope.
