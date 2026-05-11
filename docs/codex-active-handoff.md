# Codex Active Handoff

Last updated: 2026-05-11

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
e9b3b5e Add Tauri desktop shell
```

Current working tree is intentionally dirty with the standalone Tauri packaging, playback hardening, and interlude-cache patch. The user asked to test, commit, and push after this pass.

Known modified/added files at this update include:

- `.gitignore`
- `AGENTS.md`
- `README.md`
- `docs/progress.md`
- `docs/codex-active-handoff.md`
- `desktop/` source/config/lockfiles/tests
- `desktop/engine/engine_entry.py`
- `desktop/scripts/prepare-sidecars.ps1`
- `src/album_mastering_studio/pipeline.py`
- `tests/test_pipeline.py`

Generated Tauri folders are intentionally ignored:

- `desktop/node_modules/`
- `desktop/dist/`
- `desktop/src-tauri/target/`

The current Tauri build artifacts exist locally but are ignored:

```text
desktop\src-tauri\target\release\album-mastering-studio.exe
desktop\src-tauri\target\release\bundle\msi\Album Mastering Studio_0.1.0_x64_en-US.msi
desktop\src-tauri\target\release\bundle\nsis\Album Mastering Studio_0.1.0_x64-setup.exe
```

The release build now also bundles ignored sidecar resources generated from source:

```text
desktop\src-tauri\resources\engine\album-master-engine.exe
desktop\src-tauri\resources\ffmpeg\ffmpeg.exe
desktop\src-tauri\resources\ffmpeg\ffprobe.exe
```

## Current Tauri Desktop Pass

The user asked for a real Tauri shell and then approved installing prerequisites. Rustup and Visual Studio Build Tools were installed locally, and the Tauri build now succeeds.

What exists now:

- `desktop/` Tauri 2 app using React + Vite + Tailwind + TypeScript.
- Rust backend invokes the existing Python CLI, not DSP code in Rust.
- Backend commands: `repo_root`, `default_output_dir`, `read_json`, `write_project`, `open_path`, `cancel_cli`, `run_cli`, and `prepare_playback_file`.
- `run_cli` sets `PYTHONPATH` to the repo `src/`, streams stdout/stderr/status to the frontend, and stores one active child process so cancel can kill it.
- Frontend supports drag/drop audio import, row reordering by drag, remove, inline rename, analyze with waveform thumbnails, preset/delivery/arc/transition/fine-tune controls, open/save `.ams.json`, render full album, render tracks/transitions only, cancel, embedded dashboard, output folder open, and HTML5 audio playback for source/master/album/reference/transitions.
- Keyboard shortcuts implemented in the webview: Ctrl+O, Ctrl+S, Ctrl+R, Space for play/pause, Delete to remove selected track.
- CLI now has `analyze --waveform-bins` and `render`/`render-project --json-events` for waveform thumbnails and stage-level render progress.
- CLI render/init-project now have `--reference-track` parity.
- Release builds now call the bundled `album-master-engine.exe` sidecar instead of `python -m ...`.
- Release builds bundle FFmpeg/FFprobe resources and inject that folder into the engine subprocess `PATH`.
- Playback is now FFmpeg-normalized before the webview receives it: `prepare_playback_file` creates a cached 16-bit stereo 48 kHz WAV for source/master/album/reference/transition playback.
- Tauri now has explicit source/master A/B compare mode that switches A Source and B Master at the same playhead position.
- Full-album assembly now reuses the already-rendered interlude arrays instead of synthesizing every interlude a second time for `album_sequence.wav`.

Important honest caveats:

- The installer now bundles the frozen Python engine and FFmpeg/FFprobe. The repo/Python fallback still exists only for development/debugging.
- The sidecar engine is PyInstaller onefile, so each CLI invocation has some startup/extraction overhead. If that becomes annoying, convert the sidecar to PyInstaller onedir.
- Progress is stage-level JSON from Python, not a detailed ETA from inside FFmpeg.
- The Tauri shell has header buttons and shortcuts but not a native OS menubar yet.
- Still not exposed in Tauri: single-track audition render, iteration pass diff/A-B, live arc-plan preview, per-track tuning values.

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
  - Adds a Listen / Apply State panel that marks current settings as pending, previewing, rendering, applied, canceled, or errored.
  - Adds quick preset buttons for common mastering directions.
  - Adds selected-track master preview rendering, A/B compare playback, full-album playback, rendered-transition playback, a playback progress bar, and a selected-track waveform playhead.
  - A/B Compare automatically renders the selected master preview first when no current master exists.
  - Warns when Play Master or A/B Compare is using an older preview/render while current settings are pending.
  - Invalidates stale render pointers after track add/remove/reorder so old output cannot masquerade as the current album.
  - Render completion logs now call out master count, transition count, continuous album WAV path, and transition folder.
- `loudness.py`
  - Uses `pyloudnorm` when installed, with the local LUFS approximation retained as a fallback.
- `dashboard.py`
  - Shows reference-track analysis when a reference is selected.
  - Shows delivery profile, release metadata, normalization preview, codec QC, cue outputs, and richer metering.

## Current Status

The Tauri shell is now buildable and is the primary app surface. The older Tk app remains in the repo as a fallback and has several of the earlier bug/UX fixes, but new desktop product work should start in `desktop/` unless the user specifically asks for the Tk launcher.

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
python -m album_mastering_studio.cli smoke --output test-output\codex-final-solid-smoke
cd desktop
npm run build:sidecars
npm run build
npm run test:integration
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
```

If touching the Tk fallback, also instantiate it:

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
python -m album_mastering_studio.cli smoke --output test-output\codex-final-solid-smoke
cd desktop
npm run build:sidecars
npm run build
npm run test:integration
npm run tauri:build through VsDevCmd
sidecar engine smoke
bundled FFmpeg playback conversion
built Tauri exe launch smoke
```

Result:

- Python compile passed.
- 15 unit tests passed.
- Smoke passed in `test-output\codex-final-solid-smoke`.
- Frozen engine sidecar smoke passed in `test-output\sidecar-postbuild-smoke-2`.
- Bundled FFmpeg converted an album WAV to a browser-safe playback WAV.
- Desktop TypeScript/Vite build passed.
- Desktop integration test passed, including waveform analysis, render-project, manifest creation, and JSON progress events.
- Tauri release build passed with bundled engine/FFmpeg resources.
- Built Tauri app stayed alive for a 5-second launch smoke.
- 8-track artifact audit: 8 tracks, 7 interludes, 15 sequence/cue items, continuous album duration exactly matches all sequence items, finite samples, album peak `0.824321`, 0 manifest warnings, dashboard and scorecard present.
- Built artifacts: `album-mastering-studio.exe`, MSI installer, and NSIS setup EXE under `desktop\src-tauri\target\release`.
- Installer sizes at this verification: NSIS setup EXE `142.8 MB`, MSI `169.3 MB`.

## Likely Next Product Fixes After Current Patch

Prioritize these before handing back "ready to run":

1. Real-world Tauri run on the user's actual Crooked Hymns tracks: drag, reorder, analyze, render, play album, play transitions, inspect embedded dashboard.
2. Native Tauri menubar and better About dialog. Header actions and shortcuts exist, but not a real OS menubar yet.
3. Single-track audition render in Tauri so a selected song can be rendered quickly without waiting for all tracks.
4. Live arc/transition plan preview after analyze, before render.
5. Iteration pass diff/A-B in Tauri for `iterate-project` outputs.
6. Actual reference-track matching, not just reference analysis/reporting.
7. Minimum-phase EQ/filtering pass to remove remaining `filtfilt`/`sosfiltfilt` mastering/interlude artifacts.
8. Character classifier cleanup: filename hints should be weak evidence, and `return_acoustic` should be album-role metadata rather than only a hard label.
9. Split the old `app.py` only if the Tk fallback will keep receiving product work; otherwise keep new UI work in `desktop/`.
10. Commit/push only after the user asks or after explicit approval.

## Important Product Judgment

Do not over-focus on making the first local DSP chain academically perfect. But do fix claims that make the tool untrustworthy: limiter behavior, tempo gating, visible metering/analysis, playback loop, project save/load, and warning/report honesty.
