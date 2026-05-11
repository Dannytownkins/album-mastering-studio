# Codex Active Handoff

Last updated: 2026-05-10

## Mission

This repo is a private Windows PC album-mastering studio, not a toy normalizer. The user wants to open the app and run it end to end on real songs. Treat workflow, listening, and DSP trust as product requirements.

Core path:

1. Load and reorder songs.
2. Analyze tracks and show the useful analysis in the app.
3. Choose mastering direction, album arc, and fine-tuning.
4. Generate transitions with rationale.
5. Render a continuous album WAV and individual masters.
6. Produce manifest/report/dashboard.
7. Let the user inspect and listen without leaving the workflow when practical.

## User Instruction To Preserve

The user explicitly said the "intentional scoped choices are real as well" because the screenshot reviewer is a project partner who knows the mission. Do not dismiss UX or workflow critiques as merely scoped out. Re-check the screenshot critiques in the conversation before continuing.

The user also asked to "create a loop" like this handoff until every real bug, self-criticism, and low-quality pass is defeated. Keep this document current before any compaction or handoff. The loop is:

1. Re-read the latest screenshots and this file.
2. Verify each criticism against the current code before accepting it.
3. Fix confirmed defects by rebuilding the weak implementation, not by layering cosmetic code over it.
4. Add a regression test when the defect is behaviorally testable.
5. Run compile, unit tests, smoke, app instantiate, and artifact inspection before saying a pass is ready.
6. Update this file and `docs/progress.md` with fixed items and remaining honest gaps.

## Current Git State

Last pushed commit:

```text
3174074 Build album mastering studio workflow
```

Current working tree is intentionally dirty with an in-progress review-fix patch. Do not commit until verification is green.

Known modified/new files at handoff time:

- `AGENTS.md`
- `README.md`
- `src/album_mastering_studio/app.py`
- `src/album_mastering_studio/audio_io.py`
- `src/album_mastering_studio/dashboard.py`
- `src/album_mastering_studio/interludes.py`
- `src/album_mastering_studio/iteration.py`
- `src/album_mastering_studio/loudness.py`
- `src/album_mastering_studio/mastering.py`
- `src/album_mastering_studio/pipeline.py`
- `src/album_mastering_studio/scoring.py`
- `src/album_mastering_studio/smoke.py`
- `src/album_mastering_studio/standards.py`
- `tests/test_pipeline.py`
- `pyproject.toml`
- `src/album_mastering_studio/constants.py`
- `docs/progress.md`
- `docs/research-implementation-notes.md`
- this file

## Screenshot Critiques To Re-Check

The conversation includes numbered screenshots #1 through #12. Re-read them before making final calls. The main buckets:

- Critical DSP correctness:
  - BPM-from-root-frequency bug in rhythmic/pulsed transitions.
  - Tanh limiter is not a limiter.
  - Per-sample Python compressor/envelope bottleneck.
  - LUFS/true-peak approximations overstated as trusted numbers.
  - Interlude levels too quiet relative to album.
  - Misnamed or weak crossfade/hard-cut/breath-gap behavior.
- Iteration/scoring:
  - Threshold limbo zone.
  - Preset flip to `velvet-museum`.
  - Scoring only reading first track preset.
  - Rationale score grading word count/prose existence, not correctness.
  - Iteration has no "did this help" regression check.
- App/workflow:
  - No waveform/analysis display beyond table basics.
  - No in-app playback/listen loop.
  - No open/save project from GUI.
  - No progress indicator/cancel.
  - No shortcuts, track counter, clear log, reset tuning.
  - Raw slider floats and unclear units.
  - `os.startfile` Windows-only helper.
  - FFmpeg preflight missing.
  - Output folder timestamp/collision and path confusion.
  - Render/preview behavior creates too many folders.
  - No smoke button in GUI.

## Already Patched In This Dirty Tree

These have code changes started and should be preserved unless found broken:

- Added `constants.py` with `MAX_TRACKS`, `DEFAULT_SAMPLE_RATE`, and `DEFAULT_RENDER_SUBDIR`.
- `audio_io.py`
  - Added FFmpeg/FFprobe preflight helper.
  - Added subprocess timeout.
  - Split `.ogg` to `libvorbis` and `.opus` to `libopus`.
  - Writes dithered 24-bit/16-bit PCM WAVs directly by default; 32-bit float is explicit.
- `standards.py`
  - Added delivery profile shortcuts from the two research reports: streaming universal, AES album mode, Apple/AAC check, YouTube/video, Amazon/speaker-safe, CD 16/44.1, vinyl premaster, and loud-rock reference.
- `analysis.py`
  - Added short-term loudness maximum and LRA-style loudness range proxy fields.
- `mastering.py`
  - Replaced tanh ceiling path with a local oversampled lookahead gain limiter. It no longer uses centered lookahead or whole-song true-peak trim.
  - Replaced the centered compressor attack detector with causal attack/release filtering.
  - Vectorized `_one_pole`.
  - Added `target_lufs` to `MasterResult`.
  - Edge head/tail treatment windows are shortened on very short tracks to avoid overlap/double-processing.
- `interludes.py`
  - Added onset/envelope autocorrelation tempo estimation.
  - Rhythmic/pulsed styles now use estimated tempo, not median root frequency.
  - `crossfade` is now actual equal-power overlap of adjacent audio.
  - `hard-cut` returns silence instead of quiet noise.
  - Interlude target LUFS can be passed in.
  - Root estimation handles mono arrays.
  - Oscillator phase accumulation uses float64.
- `pipeline.py`
  - Uses constants.
  - Passes style-aware relative interlude target loudness based on neighboring tracks.
  - Passes the user/project ceiling through interlude limiting.
  - Uses sample-rate-aware limiter for edge shaping.
  - Adds warning when LUFS match hits the clamp and misses target.
  - Adds optional reference-track analysis to manifests.
  - Adds delivery profile, bit depth, codec QC, metadata, cue sheet, and normalization-preview data to manifests.
  - Writes `album_sequence.cue` and `album_sequence.cue.json` for continuous album renders.
  - Writes AAC and Opus round-trip codec QC preview files when enabled.
  - Accepts `"inherit"` project transition styles and resolves them at render time.
  - Updates edge-shaped `applied_gain_db` after the post-edge limiter.
- `scoring.py`
  - Preset identity averages across tracks, not only track 1.
  - Rationale score uses presence/length threshold, not a strict 10-word count.
  - Album audio loading failures degrade to missing album stats instead of failing score generation.
  - Three-track arc shape uses Spearman rank correlation.
- `iteration.py`
  - Removed `sequence_continuity` and `decision_rationales` from `_needs_iteration` thresholds.
  - No longer flips preset to `velvet-museum`; small warmth/air adjustment keeps user preset.
- `tests/test_pipeline.py`
  - Added tempo regression test.
  - Adjusted hard-cut expectation.
  - Added assertions for cue outputs, codec preview records, 24-bit WAV sample width, metadata preservation, and richer loudness fields.
- `app.py`
  - Added project Open/Save menu and actions.
  - Added FFmpeg preflight.
  - Added progress bar, status, clear log, track counter, reset tuning, smoke button.
  - Added better track analysis columns.
  - Added cross-platform `_open_path`.
  - Added safer output run folder naming.
  - Added `inherit` transition override semantics so explicit `auto` is not overwritten by global style.
  - Added playback and waveform UI.
  - Added reference-track picker.
  - Added target profile shortcuts for common LUFS/ceiling targets.
  - Added cooperative Cancel button and active-task close warning.
  - Saves open track/transition editor fields before render/save/reorder.
  - Preserves `tweak_lufs` through GUI save/load via LU Offset.
  - Uses Tk multi-pattern audio file filters for Windows.
  - Warns when oversized projects/transitions are truncated to the current 8-track cap.
  - Caches decoded playback WAVs and deletes the playback temp folder on close.
  - Validates output folder writability before render/preview.
  - Adds a dark early-2000s-clean-cyberpunk theme with styled menus, tables, waveform canvas, log severity colors, and clearer primary/secondary/destructive button hierarchy.
  - Adds release metadata fields, per-track artist/ISRC fields, delivery profile, bit-depth, and codec QC controls.
- `loudness.py`
  - Uses `pyloudnorm` when installed, with the local LUFS approximation retained as a fallback.
- `dashboard.py`
  - Shows reference-track analysis when a reference is selected.
  - Shows delivery profile, release metadata, normalization preview, codec QC, cue outputs, and richer metering.

## Current Status

The app patch has been completed enough to instantiate and pass smoke. The playback/waveform handlers named below have been implemented:

- `_play_selected_master`
- `_stop_playback`
- `_play_last_preview`
- waveform drawing/update helpers
- analysis worker waveform capture

The two deep-research reports were read and converted into `docs/research-implementation-notes.md`. Implemented now: delivery profiles, integer/dithered WAV exports, codec QC, cue sheets, metadata, normalization preview, and richer metering. Deferred deliberately: JUCE/C++ rewrite, plugin hosting, Demucs/stem separation, cloud AI transition providers, full Essentia/madmom key/tempo stack, real metadata container tagging, and full reference matching.

If another instance resumes this, run verification before assuming the tree is still clean:

```powershell
python -m compileall -q src tests
```

first. If compile/instantiate fails, fix `app.py` before touching deeper DSP.

## Verification Required Before Claiming Ready

Run all of these fresh:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-research-smoke
```

Then instantiate the app:

```powershell
@'
import tkinter as tk
from album_mastering_studio.app import MasteringStudioApp
root = tk.Tk()
root.withdraw()
app = MasteringStudioApp(root)
root.update_idletasks()
root.destroy()
print('app instantiate ok')
'@ | python -
```

Also inspect the 8-track smoke manifest for:

- 8 mastered tracks
- 7 transitions
- `album_sequence.wav`
- `dashboard.html`
- `album_sequence.cue`
- `album_sequence.cue.json`
- codec preview records/files when enabled
- no NaN/inf
- no unexpected true-peak warnings after limiter patch

Latest verified run in this thread:

```text
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-research-smoke
hidden Tk app instantiation
```

Result:

- 13 unit tests passed.
- Smoke passed in `test-output\codex-research-smoke`.
- App instantiated.
- 8-track render: 8 masters, 7 interludes, album WAV, cue sheet, cue JSON, 2 codec preview files, dashboard, scorecard.
- 8-track warnings: 0.
- Album true peak proxy: -1.14 dBFS.
- Album integrated loudness: -14.29 LUFS.
- Album WAV: stereo 48 kHz, 24-bit PCM (`sample_width` 3).
- Delivery profile in 8-track smoke: `streaming-universal`.
- Interlude LUFS in smoke ranged about -20.0 to -14.9 LUFS, now style/context-relative instead of fixed quiet.
- Reference render/dashboard support was verified earlier in the thread and remains covered by project/render paths, but it was not separately re-run in this last research pass.

## Likely Next Product Fixes After Current Patch

Prioritize these before handing back "ready to run":

1. Real A/B transport and timeline playback for source/master/transition/album.
2. Hard cancellation or resumable render checkpoints if long real-song renders are painful.
3. Actual reference-track matching, not just reference analysis/reporting.
4. Optional LLM critique/provider surfacing in the GUI.
5. Minimum-phase EQ/filtering pass to remove remaining `filtfilt`/`sosfiltfilt` mastering/interlude artifacts.
6. Character classifier cleanup: filename hints should be weak evidence, and `return_acoustic` should be album-role metadata rather than only a hard label.
7. Split `app.py` into project state, track pane, render controls, playback, and project I/O once behavior stabilizes.
8. Commit/push only after the user asks or after explicit approval.

## Important Product Judgment

Do not over-focus on making the first local DSP chain academically perfect. But do fix claims that make the tool untrustworthy: limiter behavior, tempo gating, visible metering/analysis, playback loop, project save/load, and warning/report honesty.
