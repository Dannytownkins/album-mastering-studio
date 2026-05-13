# UI Workflow Explainer

Last updated: 2026-05-13

This explains the current Track Master workflow and the confusing transport/control row. It is documentation for the current app, not a claim that the UI is final.

## Intended Track Master Flow

1. Add a song.
2. Analyze it.
3. Play Original to confirm the source loads.
4. Optionally turn on Live Preview and move a few controls for fast directional feedback.
5. Click Update Preview to render the current settings through the export engine.
6. Play Mastered.
7. Use Original/Mastered or Native A/B for comparison.
8. Toggle Volume Match only for fair monitoring.
9. Export Master.
10. Listen to the exported WAV before approving.

## Button Meanings

### Original

Loads the selected source file into the normal in-app player. This is the quickest basic playback check.

### Update Preview

Renders the selected track with the current mastering settings through the Python/export engine, then prepares that rendered preview for auditioning. This is the main release-faithful preview path.

Expected behavior: it can take time because it renders audio. It should show progress and must not permanently freeze the app.

### Render Region

Renders only the selected waveform region, or a short window near the playhead if no region is selected. Use this for quick checks on a loud chorus, problem transient, or ending.

### Native Preview

Renders a bounded preview through the current Rust first-control native preview model and plays it through the native Windows audio path. It is useful for checking the native transport path, but it is not the final export engine.

### Mastered

Loads the latest rendered preview/master for the selected track into the normal in-app player. If there is no current rendered master, this button is disabled.

### Reference

Loads the selected reference track, unprocessed, for comparison. It does not affect export settings.

### Live Preview

Turns on fast Web Audio control feedback while listening to the source. It responds quickly to the first-layer controls, but it is directional-only. It does not prove final export sound.

Use Live Preview to decide whether a direction is worth rendering. Use Update Preview or Export Master to judge the actual master.

### Original / Mastered Toggle

This is the normal in-app A/B switch. It prepares source and mastered files and swaps between them while preserving a sensible playhead position.

### Native A/B

Runs a short native Windows audio loop alternating source and master. It is a native transport check and a fast comparison aid, not a full live-DSP parity mode.

### Pause / Resume

Pauses or resumes the active native playback path. It is enabled only when native playback is active.

### Volume Match

Adjusts monitoring loudness for fair comparison. It should not change exported file level.

### Offline Preview Status

This status shows whether Live Preview is off, armed, or active. It is not a command button.

## Current Stability Fix

The app now tracks playback preparation separately from long render/export work. While playback prep is running, related transport buttons are disabled so repeated clicks do not stack multiple FFmpeg/native prep jobs.

The Tauri playback prep commands now run their FFmpeg conversion work on a blocking worker task instead of directly inside the command body. This is a small responsiveness fix aimed at the "not responding for several seconds, then recovers" symptom.

## What Still Needs User Judgment

- Whether playback starts quickly enough on real office-machine files.
- Whether Live Preview's directional-only behavior is acceptable.
- Whether the row needs UI redesign after Track Master stability is confirmed.
