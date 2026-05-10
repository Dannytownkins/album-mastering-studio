# Progress Notes

## 2026-05-10

### What Works

- Python CLI package renders album projects locally through FFmpeg/FFprobe.
- Tkinter desktop launcher starts on Windows and exposes the core workflow:
  - add/remove/reorder up to 8 songs
  - analyze source files
  - choose global preset and album arc
  - set target LUFS, ceiling proxy, brightness, bass, presence, air, warmth, compression, limiter, and stereo width
  - set global transition length/style
  - override selected track character/preset
  - override selected transition style/duration/enabled state
  - render full album or individual mastered tracks only
  - preview a selected transition
  - open output folder or dashboard
- Required user-facing preset names are available alongside the original creative presets.
- Transition generator now supports additional practical local styles: crossfade, filtered-fade, reverse-swell, noise-riser, sub-drop, tape-stop, breath-gap, ring-out, pulsed-swell, drone-pad, and hard-cut marker.
- Manifest now records output paths, album analysis, per-track warnings, interlude analysis, aggregate warnings, selected presets, ceiling proxy, and tuning settings.
- Dashboard shows warnings and output paths in addition to arc, tracks, transitions, scorecard, and decision log.
- `album-master smoke` creates synthetic 1-track, 2-track, and 8-track renders and verifies key artifacts.

### Verification Run

Commands run from repo root:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
python -m album_mastering_studio.cli smoke --output test-output\codex-smoke
```

Results:

- Compile passed.
- Unit tests passed: 9 tests.
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

- GUI is workflow-complete but plain; no waveform view or playback transport yet.
- LUFS and true peak remain local approximations.
- Tempo/key/chroma are not full musicology features; transition roots are estimated from local spectra.
- Per-transition preview renders a file, but there is no in-app audio player.
- The app does not yet save/load arbitrary `.ams.json` projects from the UI, though it writes the project used for every render.

### Next Move

- Add project open/save buttons in the GUI.
- Add waveform thumbnails or at least source/master duration bars.
- Add cue sheet/metadata export for album sequencing.
- Add reference-track matching once the core workflow has been used on real songs.
