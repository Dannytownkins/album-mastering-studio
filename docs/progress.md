# Progress Notes

## 2026-05-10

### Partner Review Fix Pass

- Treated the screenshot review as product requirements, including previously scoped UX items.
- Added a durable active handoff at `docs/codex-active-handoff.md` for compaction/resume safety.
- Replaced the tanh ceiling saturator with a simple lookahead gain limiter plus true-peak-proxy trim.
- Vectorized the linked compressor envelope and `_one_pole` smoothing path.
- Fixed rhythmic and pulsed transition timing to use onset-envelope tempo estimation instead of root frequency.
- Changed `crossfade` to use real adjacent-audio equal-power overlap.
- Changed `hard-cut` to render silence instead of quiet noise.
- Made interlude loudness relative to neighboring mastered tracks instead of a fixed -23 LUFS target.
- Added FFmpeg/FFprobe preflight and subprocess timeout handling.
- Split OGG and Opus export codec mappings.
- Added shared constants for track limit and default sample rate.
- Improved iteration behavior so it no longer flips the user's preset to `velvet-museum`.
- Updated scoring so preset identity considers all tracks and rationale scoring is less word-count brittle.
- Added GUI project open/save, smoke check, reset tuning, progress bar/status, track counter, clear log, shortcuts, safer output folders, and cross-platform file opening.
- Added source/master/transition-preview playback controls with a Windows `winsound` path and fallback file opening.
- Added selected-track waveform and analysis summary after analyze.
- Added optional `pyloudnorm` LUFS measurement path with the existing local approximation retained as a fallback.
- Added reference-track selection in the desktop app and reference analysis in the manifest/dashboard.
- Added desktop target profile shortcuts for common streaming/platform-style LUFS targets.
- Made open track/transition editor fields save into the project before render/save/reorder operations, reducing the "forgot to click Apply" trap.
- Added a cancel request button and close-warning path. This is a cooperative stop request, not a hard worker kill.
- Added a reference-track smoke render check after the main smoke run.

### Critique Loop 2

The next Claude critique found several real regressions or still-weak patches. Confirmed issues fixed in this loop:

- Rebuilt `limit_ceiling` again so it no longer uses a centered max window or whole-song true-peak trim. It now limits on an oversampled local lookahead pass, holds gain locally for release, and only trims local sample-domain overs.
- Replaced the compressor sidechain's centered max-filter attack with causal attack/release filtering.
- Made transition LUFS targets style-aware instead of always `adjacent - 6 LU` with a fixed `[-24, -16]` clamp.
- Passed the user's project ceiling through interlude leveling instead of hard-capping interludes at `-3 dBFS`.
- Suppressed "almost silent" warnings for intentional `hard-cut` transitions.
- Preserved `"inherit"` transition semantics in project JSON while resolving it only at render time.
- Preserved `tweak_lufs` through GUI project save/load by adding an LU Offset field.
- Fixed the Windows file dialog audio filter to use Tk's multi-pattern tuple form.
- Added project-load warnings when oversized projects/transitions are truncated to the current 8-track product cap.
- Cached decoded playback WAVs by path, modified time, and sample rate, and cleaned the playback temp folder on app close.
- Validated that the output folder is writable before starting render/preview work.
- Wrote WAV outputs directly instead of temp-WAV-to-FFmpeg-to-WAV round trips.
- Made FFmpeg timeout configurable through `ALBUM_MASTER_FFMPEG_TIMEOUT`, defaulting to 900 seconds.
- Fixed mono root-estimation input handling and used float64 oscillator phase accumulation for synthesized interludes.
- Avoided overlapping head/tail edge treatment on very short tracks by proportionally shortening the edge windows.
- Updated edge-shaped `applied_gain_db` after the post-edge limiter changes audio level.
- Made score/dashboard failures non-fatal after a successful GUI render.
- Made scorecard album-audio loading failures degrade to missing album stats instead of failing the whole score.
- Switched three-track arc-shape scoring to Spearman rank correlation.

Additional regression tests added:

- Single-spike limiter protection does not globally attenuate an otherwise quiet song.
- Project `tweak_lufs` survives render and `inherit` transition style resolves to the global style.
- Intentional hard-cut silence does not emit an "almost silent" warning.

Verification:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-loop-smoke
```

Results:

- Compile passed.
- Unit tests passed: 13 tests.
- Smoke passed.
- Hidden Tk app instantiation passed.
- Eight-track smoke render produced 8 masters, 7 interludes, `album_sequence.wav`, `manifest.json`, `scorecard.json`, and `dashboard.html`.
- Eight-track smoke warnings: 0.
- Eight-track album true-peak proxy: -1.14 dBFS.
- Interlude LUFS now tracks style/context more closely; smoke interludes landed around `-20.0` to `-14.9` LUFS instead of a fixed quiet value.

Verification:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-review-smoke-reference-pass
```

Results:

- Compile passed.
- Unit tests passed: 10 tests.
- Smoke passed.
- Hidden Tk app instantiation passed.
- Eight-track smoke render produced 8 masters, 7 interludes, `album_sequence.wav`, `manifest.json`, `scorecard.json`, and `dashboard.html`.
- Eight-track smoke warnings: 0.
- Eight-track album true-peak proxy: -1.05 dBFS.
- Reference-track render check wrote reference analysis to `manifest.json` and `dashboard.html`.

Remaining partner-review items:

- Cancel is cooperative. It can skip post-render scoring/dashboard if requested late, but it does not hard-kill FFmpeg or interrupt the core render mid-file.
- Reference-track support is analysis/reporting only. It does not yet automatically match tonal balance or loudness to the reference.
- In-app playback is intentionally basic and Windows-first; no transport timeline or A/B compare yet.
- LUFS uses `pyloudnorm` when installed, but this local environment did not have it installed during verification, so the fallback path was used here.
- Mastering EQ/interlude filters still use zero-phase `filtfilt`/`sosfiltfilt` in several places; this is a known DSP quality target for a future minimum-phase pass.
- Character inference still uses filename hints and positional return-acoustic logic. Overrides make it controllable, but the classifier is not yet a robust genre model.
- The app is still a large single Tk class; the loop is prioritizing correctness and first-run workflow before splitting presentation/project/playback modules.

### Dark UI / Product Feel Pass

- Reworked the Tk desktop app into a dark, clean cyberpunk-style interface with restrained green/amber/red hierarchy.
- Added a styled app header, dark input/menu/tree/log surfaces, zebra-striped tables, themed waveform canvas, and clearer primary/secondary/destructive button treatment.
- Kept interaction behavior direct and stable: no animated or hover-heavy effects, just better visual priority and readability.
- Added log severity color so warnings/errors/completions separate visually during longer renders.
- Fixed a Tk runtime issue where the global `Segoe UI` font string was parsed incorrectly because of the space in the font family name.

Verification:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-ui-smoke
```

Results:

- Compile passed.
- Hidden Tk app instantiation passed.
- Unit tests passed: 13 tests.
- Smoke passed.
- Eight-track smoke render produced 8 masters, 7 interludes, `album_sequence.wav`, `manifest.json`, `scorecard.json`, and `dashboard.html`.
- Eight-track smoke warnings: 0.

### Deep Research Implementation Pass

- Read both local research reports and captured the implementation decisions in `docs/research-implementation-notes.md`.
- Treated overlapping report guidance as product direction where it fit the personal/offline scope: album-mode loudness, delivery profiles, integer PCM output, dither, codec QC, cue sheets, metadata, and richer metering.
- Added `standards.py` with delivery profiles for streaming universal, AES album mode, Apple/AAC check, YouTube/video, Amazon/speaker-safe, CD 16/44.1, vinyl premaster, and loud-rock reference renders.
- Added GUI/CLI settings for delivery profile, bit depth, and codec QC preview.
- Changed WAV writing to deterministic dithered 24-bit or 16-bit PCM by default, with 32-bit float available only when selected.
- Added short-term loudness maximum and LRA-style loudness range proxy to track, reference, interlude, album, and codec-preview analysis.
- Added sample-accurate `album_sequence.cue` and `album_sequence.cue.json` outputs for continuous album renders.
- Added local AAC and Opus round-trip codec QC preview files and warnings.
- Added release metadata fields for artist, album artist, genre, year, UPC, per-track artist, and ISRC in the GUI, project JSON, manifest, and dashboard.
- Updated README and AGENTS with the delivery/metadata/cue/codec workflow.
- Added regression assertions for cue files, codec preview records, 24-bit WAV sample width, metadata preservation, and richer loudness fields.

Verification:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-research-smoke
```

Results:

- Compile passed.
- Hidden Tk app instantiation passed.
- Unit tests passed: 13 tests.
- Smoke passed.
- Eight-track smoke render produced 8 masters, 7 interludes, `album_sequence.wav`, `album_sequence.cue`, `album_sequence.cue.json`, `manifest.json`, `scorecard.json`, `dashboard.html`, and 2 codec preview files.
- Eight-track smoke warnings: 0.
- Eight-track album WAV is stereo 48 kHz, 24-bit PCM (`sample_width` 3), with true-peak proxy about `-1.14 dBFS` and integrated loudness about `-14.29 LUFS`.

### What Works

- Python CLI package renders album projects locally through FFmpeg/FFprobe.
- Tkinter desktop launcher starts on Windows and exposes the core workflow:
  - add/remove/reorder up to 8 songs
  - analyze source files
  - choose global preset and album arc
  - set delivery profile, target LUFS, ceiling proxy, sample rate, bit depth, codec QC preview, brightness, bass, presence, air, warmth, compression, limiter, and stereo width
  - enter album artist/release metadata and per-track artist/ISRC metadata
  - select a reference track for analysis/reporting
  - set global transition length/style
  - override selected track character/preset
  - override selected transition style/duration/enabled state
  - render full album or individual mastered tracks only
  - preview a selected transition
  - open output folder or dashboard
  - use a dark desktop UI with visible table, waveform, action, status, and log hierarchy
- Required user-facing preset names are available alongside the original creative presets.
- Transition generator now supports additional practical local styles: crossfade, filtered-fade, reverse-swell, noise-riser, sub-drop, tape-stop, breath-gap, ring-out, pulsed-swell, drone-pad, and hard-cut marker.
- Manifest now records output paths, album analysis, per-track warnings, interlude analysis, aggregate warnings, selected presets, delivery profile, metadata, normalization preview, codec QC, cue paths, ceiling proxy, and tuning settings.
- Dashboard shows delivery settings, metadata, codec QC, warnings, reference analysis, and output paths in addition to arc, tracks, transitions, scorecard, and decision log.
- `album-master smoke` creates synthetic 1-track, 2-track, and 8-track renders and verifies key artifacts, cue files, and codec preview records.

### Verification Run

Commands run from repo root:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-smoke
```

Results:

- Compile passed.
- Unit tests passed: 10 tests.
- Smoke passed.
- Hidden Tk app instantiation passed.
- Eight-track smoke render produced:
  - 8 mastered WAV files
  - 7 transition WAV files
  - `album_sequence.wav`
  - `manifest.json`
  - `scorecard.json`
  - `dashboard.html`
  - 0 render warnings

### Weak Spots

- GUI is workflow-complete and dark themed, but waveform and playback are still basic rather than DAW-like.
- True peak remains a local oversampling proxy, and LUFS falls back to the local approximation when `pyloudnorm` is not installed.
- Tempo/key/chroma are not full musicology features; transition roots are estimated from local spectra.
- Reference matching is not automatic yet; the app only analyzes/reports the reference track.
- Cancellation is not a hard kill for an already-running render operation.

### Next Move

- Add A/B comparison between source, master, transition preview, and album sequence.
- Add real transport/A-B playback with level matching between source, master, transition preview, and album sequence.
- Add actual reference-track matching once the core workflow has been used on real songs.
