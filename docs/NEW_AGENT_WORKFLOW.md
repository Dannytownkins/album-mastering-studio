# New Agent Workflow

Last updated: 2026-05-13

Use this when a fresh Codex or Claude instance picks up the repo, especially on a different Windows machine. The goal is to avoid replaying the same 33-hour hardening loop.

## First Rule

Do not rerun the broad release-readiness loop just because the goal is still active. The current next step is manual user testing unless the user reports a concrete failure, asks for a specific verification, or asks for UI polish.

## Read Order

Read these first:

1. `AGENTS.md`
2. `docs\OFFICE_BUILD_HANDOFF.md`
3. `docs\MANUAL_LISTENING_TEST_GUIDE.md`
4. `docs\GOAL_AUDIT.md`
5. `docs\RELEASE_CANDIDATE_CLOSEOUT.md`
6. `docs\codex-active-handoff.md`
7. `docs\progress.md`

`docs\progress.md` is long. Start at the top and only dig deeper when you need exact historical evidence.

## Current State Summary

- Track Master is the first workflow to protect.
- Album Master remains important but should not block Track Master manual testing.
- Current broad release evidence passed before the office handoff: `25 passed`, `0 failed`, `0 skipped`.
- The repo intentionally ignores generated artifacts under `test-output\`, `outputs\`, `desktop\src-tauri\target\`, and `desktop\src-tauri\resources\`.
- If those artifacts are missing on a new machine, do not assume a regression. Rebuild or rerun only the targeted piece you need.
- Remaining blockers are human listening approval and Live Preview scope acceptance or deeper parity.

## Initial Commands

Start every new session with:

```powershell
git status --short --branch
git log --oneline -5
```

If the tree is dirty, inspect before editing:

```powershell
git diff --stat
git diff --name-status
```

Do not revert user changes unless the user explicitly requests it.

## Test Inventory

Core Python:

- `python -m compileall -q src tests`
- `python -m unittest discover -s tests`
- `python -m album_mastering_studio.cli smoke --output test-output\smoke`

Desktop build and CLI contract:

- `cd desktop; npm run build`
- `cd desktop; npm run test:integration`

Release package and launch:

- `cd desktop; npm run tauri:build`
- `cd desktop; npm run test:tauri-sidecar-startup`
- `cd desktop; npm run test:tauri-release`

Track Master-focused smoke tests:

- `cd desktop; npm run test:tauri-track-preview-ui`
- `cd desktop; npm run test:tauri-release-track-codec-qc`
- `cd desktop; npm run test:tauri-real-song-codec-qc`
- `cd desktop; npm run test:tauri-real-song-listening-packet`
- `cd desktop; npm run test:listening-handoff-browser-audio`
- `cd desktop; npm run test:tauri-real-song-region-preview`
- `cd desktop; npm run test:tauri-real-song-native-ui`

Album Master smoke tests:

- `cd desktop; npm run test:tauri-release-album-state`
- `cd desktop; npm run test:tauri-release-album-codec-qc`
- `cd desktop; npm run test:tauri-real-song-album-playback`
- `cd desktop; npm run test:tauri-real-song-album-codec-qc`

State, safety, and packaging:

- `cd desktop; npm run test:tauri-release-session-safety`
- `cd desktop; npm run test:tauri-project-persistence`
- `cd desktop; npm run test:tauri-nsis`
- `cd desktop; npm run test:tauri-msi`

Full release runner:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release-readiness.ps1 -RealSongPath "C:\path\to\real-song.mp3" -IncludeInstallerSmokes -OutputRoot "test-output\release-readiness-office"
```

Use the full runner only after a meaningful app/build/test change or before packaging for someone else.

## Useful Environment Variables

- `AMS_REAL_SONG_PATH`: local real song for real-song smokes.
- `AMS_REAL_SONG_ALBUM_PATHS`: JSON array or path-delimited list for multi-song album smokes.
- `AMS_TAURI_RELEASE_EXE`: override release EXE path for Tauri smokes.
- `AMS_LISTENING_HANDOFF_HTML`: specific handoff HTML for browser-audio smoke.
- `AMS_BROWSER_EXE`: Chrome or Edge path for handoff browser smoke.
- `TAURI_CDP_PORT`: WebView/CDP port when running against an existing app or avoiding collisions.
- `ALBUM_MASTER_PYTHON`: Python executable for CLI contract tests.

## Workflow Loop

Use this loop instead of broad wandering:

1. Identify whether the user reported a concrete failure, gave manual listening results, or asked for UI polish.
2. If there is a concrete failure, reproduce only that path with the smallest targeted smoke or manual run.
3. Inspect the relevant source before editing.
4. Make the smallest root-cause fix.
5. Run focused verification for that fix.
6. Update `docs\progress.md` and, if state changes materially, `docs\codex-active-handoff.md`.
7. Commit and push when the branch is clean.

## When To Stop

Stop and hand back to the user when:

- the next required evidence is subjective listening approval,
- the user has not reported a concrete failure,
- a proposed next step would only rerun already passing release tests,
- or the change would start broad UI redesign before Track Master manual feedback is known.

## Completion Rules

Do not mark the active goal complete until:

- Track Master has real user listening approval,
- Live Preview directional-only scope is accepted or deeper parity is implemented,
- Album Master has at least a light manual pass or documented waiver,
- the repo is clean and pushed,
- and `docs\GOAL_AUDIT.md` no longer lists open blockers.
