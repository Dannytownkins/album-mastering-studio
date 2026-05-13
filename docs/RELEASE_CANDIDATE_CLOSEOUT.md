# Release Candidate Closeout Checklist

Last updated: 2026-05-13

This checklist is the manual closeout path for the active goal. It does not replace the automated release-readiness trace. Use it when the user is present and can judge the sound.

## Current Evidence Baseline

- Current app-code release trace: `test-output\release-readiness-8c6b5a0-full\release-readiness.json`.
- App-code commit covered by that trace: `8c6b5a0ecb5c13bcdaf8efaeb29812f487f63ff0`.
- Latest branch head may include docs-only handoff commits after that trace.
- Automated result: 23 passed, 0 failed, 0 skipped.
- Remaining blockers: human listening approval, Live Preview scope acceptance, native Open/Save-As dialog coverage or waiver.

## Track Master Listening Pass

Use `C:\Users\Daniel Kinsner\Downloads\Lay the Money on the Desk (1).mp3` unless the user chooses a better real track.

1. Launch the packaged desktop app.
2. Add or drag/drop the audio file.
3. Analyze.
4. Confirm waveform, metrics, Universal/safe settings, and export checks surface correctly.
5. Audition Original.
6. Audition Live Preview and confirm its approximate-labeling is acceptable for directional control moves.
7. Run Update Preview or Render Region for a release-faithful preview.
8. Audition Mastered, Original/Mastered switching, loop/region behavior, and Volume Match off/on.
9. Export Master.
10. Review exported WAV, codec previews when enabled, dashboard, and quality warnings.
11. In the Listening Pass panel, check the steps actually heard and set Approved after listening only if the rendered preview/export, codec preview, or album WAV sound is acceptable. Live Preview is directional only.
12. Save Receipt and Save Listening Packet beside the render.

Required evidence:

- `listening-review.json`
- `listening-handoff.json`
- `listening-handoff.html`
- Notes stating approve/reject and any concrete sound problems.

## Album Master Listening Pass

Use a true multi-song set if available. If only one MP3 is available, the existing automated album smokes remain workflow evidence but not musical approval.

1. Add multiple real tracks.
2. Analyze all.
3. Reorder tracks and review roles/story.
4. Confirm generated transitions remain off unless explicitly enabled.
5. Preview at least one boundary.
6. Export individual masters and a continuous album WAV.
7. Audition the continuous album WAV and boundary areas.
8. Review dashboard, codec previews when enabled, and quality warnings.
9. Record approval or concrete problems in the Listening Pass notes.
10. Save Receipt and Save Listening Packet beside the render.

Required evidence:

- Album render output folder.
- Album `manifest.json` and dashboard.
- `listening-review.json`
- `listening-handoff.json`
- Notes stating approve/reject and exact boundary or level issues.

## Native Project Dialog Check

This is the manual check for the remaining OS file-picker blocker. It is separate from the direct Project path field, which is already covered by `test:tauri-project-persistence`.

1. Launch the packaged desktop app.
2. Add or drag/drop one audio file and run Analyze so the session has state worth saving.
3. Use the visible Project Save As action or `Ctrl+Shift+S`.
4. Confirm a native Windows Save dialog appears, starts in a sensible folder, filters to `.ams.json`, and can save a project file without freezing the app.
5. Change an obvious project value after saving, such as album title or one track title.
6. Use the visible Open Project action or `Ctrl+O`.
7. Confirm a native Windows Open dialog appears, starts near the saved project path or output folder, filters to `.ams.json`, and can reopen the saved project.
8. Confirm the saved value is restored and the app remains responsive.
9. Repeat Save As once and cancel the dialog; confirm cancel does not change the current project path or hang the app.

Required evidence:

- Saved `.ams.json` path.
- Notes stating whether Save As, Open, and cancel behaved correctly.
- Any crash/hang, missing dialog, wrong start folder, bad file filter, or path-restoration issue.

## Explicit Decisions Needed

These are product decisions, not automation tasks:

- Accept Live Preview as an approximate, clearly labeled directional audition while Update Preview, Render Region, and Export Master remain release-faithful.
- Accept direct Project path Load/Save plus improved Open dialog default path as sufficient for this private release, or complete the manual native Project Dialog Check above before completion.
- Decide whether the reference screenshot should drive a separate UI polish pass after the stability closeout.
