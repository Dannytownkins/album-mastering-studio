# Manual Listening Test Guide

Last updated: 2026-05-13

Use this guide when testing whether the app is ready for real personal use. This is not another automated smoke test. The point is to decide whether Track Master is stable, responsive, and listenable enough to move into UI polish.

## Start Here

Use the release app:

```text
desktop\src-tauri\target\release\album-mastering-studio.exe
```

Use one real song first. WAV, MP3, AAC, FLAC, and other FFmpeg-readable formats should be acceptable. Start with a copy if you are nervous, but the app is expected not to modify the input file.

## Track Master Pass

1. Launch the app.
2. Add one real song with the Add button. Drag/drop can also be checked, but do not let drag/drop block the basic Add path.
3. Confirm Track Master mode is active.
4. Click Analyze.
5. Confirm the waveform, metrics, suggested settings, and export controls populate.
6. Confirm Volume Match is off by default.
7. Click Original, then Play.
8. Note whether playback starts promptly. Anything that feels frozen, silent, or takes several seconds should be treated as a bug.
9. Adjust one or two simple controls, such as Intensity, Low, Mid, High, Width, or preset.
10. Use Live Preview only as a directional check. It does not prove export parity.
11. Click Update Preview.
12. Click Mastered, then Play.
13. Toggle Original/Mastered while playing and confirm the playhead position remains sensible.
14. Toggle Volume Match on and off. It should help monitoring comparison, not change export level.
15. Select a short region and use Render Region if you want to check a problem section.
16. Export Master.
17. Confirm the output WAV exists and export checks or warnings are visible.
18. Listen to the exported WAV outside the app or through the app.

## What To Listen For

Pass-level expectations:

- Playback starts without a long wait or app freeze.
- Original and Mastered both play reliably.
- Mastered is not just louder; it should feel controlled and usable.
- Volume Match makes comparisons fairer without changing exported loudness.
- Exported WAV does not clip, distort, click, drop out, or end unexpectedly.
- The app remains responsive through analyze, preview, playback, and export.

Sound issues worth recording:

- Harshness or brittle high end.
- Muffled or dull tone.
- Low-end loss, boom, or pumping.
- Over-compression, flattened transients, or audible limiter strain.
- Stereo image collapse or strange phase behavior.
- Vocal or lead elements moving backward too much.
- Clicks, pops, dropouts, glitches, or bad fades.
- Mastered playback sounding materially different from exported WAV in a bad way.

Live Preview decision:

- Accept it only if it is useful as fast directional feedback while clearly not being the final sound.
- Reject it if the difference between Live Preview and Update Preview/Export is misleading enough to make control decisions unreliable.

## Album Master Light Pass

Only do this after the one-song Track Master pass feels usable.

1. Add two or more real songs.
2. Analyze all.
3. Reorder tracks.
4. Confirm generated transitions are off unless you explicitly enable them.
5. Export separate track masters.
6. If available, export the album WAV.
7. Listen to the first 30 seconds of each track, transitions or boundaries, and any obvious level jumps.
8. Record exact problems, especially track-to-track loudness jumps, strange transition behavior, or export failures.

## Pass/Fail Notes Template

```text
Date:
Machine:
App commit or build:
Song(s):

Track Master:
- Add/import:
- Analyze:
- Original playback:
- Live Preview:
- Update Preview:
- Mastered playback:
- Original/Mastered toggle:
- Volume Match:
- Region/loop:
- Export:
- External listen:

Sound notes:

Live Preview scope:
- Accept directional-only? yes/no
- Why:

Album Master:
- Tested? yes/no
- Notes:

Decision:
- Ready for UI polish:
- Blocking bugs:
```

## Stop Conditions

Stop and report a concrete bug if any of these happen:

- App crashes, hangs, or becomes unresponsive.
- Play button does not start audio after a reasonable wait.
- Analyze or export never finishes.
- Original/Mastered toggle loses state or plays the wrong file.
- Exported file is missing, silent, clipped, truncated, or obviously corrupted.
- Source audio file is changed or overwritten.
