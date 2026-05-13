# LOOK HERE - Dan Handoff

Last updated: 2026-05-13

## Current Status

This repo is ready for manual testing, not final release approval.

The latest pass was a one-hour-bounded stabilization and handoff pass after the app felt non-responsive during clicking. It intentionally avoided broad UI redesign and avoided the full release-readiness loop.

Commit for this pass: `cce08dd Stabilize playback prep handoff`.

## What Changed In This Pass

- Playback prep now has its own `playbackBusy` guard in `desktop/src/App.tsx`.
- Transport/prep buttons are disabled while playback prep is running, so repeated clicks should not stack multiple FFmpeg/native prep jobs.
- `prepare_playback_file` and `prepare_playback_file_info` in `desktop/src-tauri/src/lib.rs` now run playback conversion through `tauri::async_runtime::spawn_blocking`.
- Added `docs/UI_WORKFLOW_EXPLAINER.md` to explain the current button row and intended Track Master workflow.
- Added this handoff file so the office-machine/new-instance state is easy to spot.

## Focused Verification

- `cargo fmt`
- `cd desktop; npm run build`
- `cd desktop\src-tauri; cargo check`
- `cd desktop; npm run tauri:build`

The release EXE was rebuilt after the stability change. The full release-readiness loop was intentionally not rerun.

## What To Test First

Launch:

```text
desktop\src-tauri\target\release\album-mastering-studio.exe
```

Then test one song:

1. Add a real song.
2. Analyze.
3. Click Original.
4. Click Play.
5. Click Update Preview.
6. Click Mastered.
7. Click Play.
8. Toggle Original/Mastered.
9. Toggle Volume Match.
10. Export Master.

## What To Watch For

- Does the app still show Windows "not responding"?
- Do button clicks show immediate status feedback?
- Does playback prep still take around 15 seconds on first click?
- Does a second click during prep get ignored/disabled instead of stacking work?
- Does Play start once prep is complete?
- Does exported audio sound usable?

## Do Not Do This Next

- Do not rerun the full release-readiness suite unless a concrete failure needs it.
- Do not start broad UI redesign before Track Master manual testing.
- Do not mark the goal complete until there is user listening approval.

## If Picking Up At Work

Start with:

- `docs/OFFICE_BUILD_HANDOFF.md`
- `docs/MANUAL_LISTENING_TEST_GUIDE.md`
- `docs/NEW_AGENT_WORKFLOW.md`
- `docs/UI_WORKFLOW_EXPLAINER.md`

The generated `test-output` folders and release binaries are ignored by Git, so the office machine may need to rebuild.
