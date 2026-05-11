# Album Mastering Studio

An opinionated local mastering tool for albums, not isolated songs.

Album Mastering Studio takes a sequence of tracks, plans an emotional album arc, masters each track into that arc, and generates musical interludes from the surrounding audio. The interludes are not silence and not stock crossfades: they are synthesized from adjacent track roots, tails, heads, brightness, and energy.

The taste presets are intentionally specific. `3am-kitchen-floor` is warm, close, and private. `radio-brittle` is bright, forward, and sharp. Those are not labels on the same chain; they change loudness targets, EQ contour, stereo width, compression behavior, transient shape, saturation, and preferred transition language.

The main use case is a complete record: for example, an eight-track sequence that starts acoustic/indie-folk, crosses into djent/heavy material, and returns to acoustic intimacy. The tool does not force those songs to one LUFS number. It infers or accepts track character, plans the album journey, masters each track for its position, and shapes the tail/head of hard genre shifts inside the mastering chain before the generated interlude is even added.

## What It Does

- Imports WAV, AIFF, FLAC, MP3, M4A/AAC, OGG, and Opus through FFmpeg.
- Analyzes integrated LUFS, short-term loudness maximum, LRA-style loudness range proxy, true peak, dynamics, spectral balance, stereo image, transient density, and energy density.
- Can analyze an optional reference track and include it in the render manifest/dashboard for comparison.
- Infers broad track character: `acoustic_folk`, `transition`, `heavy_djent`, and `return_acoustic`.
- Masters tracks with LUFS-style targeting, ceiling limiting, compression, high-pass cleanup, taste EQ, transient shaping, stereo width, and saturation.
- Plans album-level emotional arcs instead of flattening every track to the same loudness.
- Applies position-aware mastering moves, so acoustic tracks breathe, heavy tracks get controlled density, and return/acoustic tracks come back inward.
- Shapes outgoing tails and incoming heads for acoustic-to-heavy and heavy-to-acoustic handoffs.
- Generates interludes from neighboring track audio using estimated root movement, filtered tail/head texture, harmonic pads, noise air, tape color, swells, and rhythmic gates.
- Creates editable `.ams.json` album project files with track order, titles, character overrides, arc settings, and per-transition controls.
- Renders transition previews so you can audition the important seams without re-rendering the whole album.
- Exports dithered 24-bit or 16-bit WAV masters instead of defaulting to 32-bit float delivery files.
- Ships a Tauri desktop shell in `desktop/` that uses the Python CLI as the engine contract, with the Tkinter app retained as a fallback launcher.
- Adds delivery profiles for streaming, AES album-mode, Apple/AAC checking, YouTube/video, Amazon/speaker-safe, CD 16/44.1, vinyl premaster, and loud-rock references.
- Writes sample-accurate cue files for the continuous album WAV and runs AAC/Opus codec QC previews when enabled.
- Stores release metadata such as artist, album artist, genre, year, UPC, per-track artist, and ISRC in project files, manifests, and dashboards.
- Scores its own renders from the actual album WAV plus manifest data, with optional LLM critique when API credentials are available.
- Iterates projects over bounded render/score passes, applies at most one improvement per pass, and logs the decision.
- Exports a standalone HTML dashboard/report with album arc, track roles, transition rationales, and scorecard.

## Requirements

- Python 3.11+
- FFmpeg and FFprobe on `PATH`
- Python packages: `numpy`, `scipy`, `pyloudnorm`
- For building the Tauri shell: Node.js/npm, Rust/Cargo, and Visual Studio Build Tools with the C++ desktop toolchain.

## Windows Quick Start

From PowerShell in this repo:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e .
ffmpeg -version
ffprobe -version
```

## Desktop App

The primary app surface is now the Tauri desktop shell in `desktop/`. It keeps all DSP in Python and invokes:

```powershell
python -m album_mastering_studio.cli ...
```

The current Windows build artifacts are produced at:

```text
desktop\src-tauri\target\release\album-mastering-studio.exe
desktop\src-tauri\target\release\bundle\msi\Album Mastering Studio_0.1.0_x64_en-US.msi
desktop\src-tauri\target\release\bundle\nsis\Album Mastering Studio_0.1.0_x64-setup.exe
```

For this personal-workstation build, the installed shell expects this repo checkout and Python environment to remain available. The Rust backend sets `PYTHONPATH` to the repo's `src/` folder when it launches the CLI. Set `ALBUM_MASTER_PYTHON` if you want it to use a specific interpreter.

From `desktop/`:

```powershell
npm install
npm run tauri:dev
```

Build the Windows app/installer:

```powershell
& cmd.exe /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 && set "PATH=%USERPROFILE%\.cargo\bin;%PATH%" && npm run tauri:build'
```

What the Tauri shell currently supports:

- drag-and-drop audio files into an 8-track list
- reorder by dragging rows, remove tracks, and rename inline
- analyze tracks through the CLI and draw waveform thumbnails in canvas
- choose preset, delivery profile, album arc, transition style, and fine-tuning controls
- open/save `.ams.json` projects
- render full album or tracks/transitions only
- stream JSON progress events from the Python CLI, with a cancel button that kills the active Python subprocess
- play source, mastered track, album sequence, reference, and rendered transition files through an HTML5 audio transport with seek
- embed the rendered `dashboard.html` inside the app
- open the output folder or standalone dashboard

## Tk Fallback

The original local Tk desktop app remains available:

```powershell
album-master app
```

or:

```powershell
album-master-studio
```

The app is a dark Windows-friendly launcher: add up to 8 songs, reorder them, optionally enter release metadata, choose a reference track, analyze, choose a preset and album arc, pick a delivery profile or manual LUFS/ceiling/sample-rate/bit-depth settings, adjust fine-tuning controls, set transition defaults or per-transition overrides, preview/listen where practical, render the album, then open the output folder or dashboard report.

The main listening loop is visible in the app: after changing presets or sliders, the Listen / Apply State panel marks the settings as pending. Use `Preview Master` to render the selected song with current settings, `A/B Compare` to hear original/mastered/original/mastered from an audible section, and `Auto Master Album (Full WAV + Transitions)` to write the final continuous album plus transition files. If no selected-song master exists yet, A/B Compare renders that preview first and then starts playback. Playback shows a time/progress bar, and source/master playback draws a playhead on the selected track waveform.

Core render outputs:

- `masters/`: individual mastered WAVs or selected export format
- `interludes/`: generated transition files
- `album_sequence.wav`: continuous album master when full album render is selected
- `album_sequence.cue` and `album_sequence.cue.json`: sample-accurate cue points for the continuous album
- `codec_previews/`: AAC and Opus round-trip QC renders when codec preview is enabled
- `manifest.json`: inputs, settings, analysis, warnings, output paths, and transition rationales
- `scorecard.json`: local render-health score when run through the app or `score-render`
- `dashboard.html`: readable report when run through the app or `export-dashboard`

## Quick Render

```powershell
album-master render .\raw-tracks --output .\outputs\album-v1 --preset album-cohesion-cinematic --delivery-profile streaming-universal --arc cinematic --interlude-style auto --interlude-duration 8 --album-wav
album-master score-render .\outputs\album-v1\manifest.json --scorer local
album-master export-dashboard .\outputs\album-v1\manifest.json --output .\outputs\album-v1\dashboard.html
```

The output folder contains:

- `masters/`: mastered track files
- `interludes/`: musical transitions between tracks
- `album_sequence.wav`: continuous album render when `--album-wav` is used
- `album_sequence.cue` / `album_sequence.cue.json`: cue sheet and JSON split map for the continuous album
- `codec_previews/`: AAC/Opus lossy round-trip QC previews when enabled
- `manifest.json`: settings, album story, arc plan, character inference, track analysis, render paths, per-track/per-transition rationales, edge-mastering moves, preset metadata

## Project Workflow

Create an editable album project:

```powershell
album-master init-project .\raw-tracks --project .\album.ams.json --title "Album Draft" --artist "Dan" --album-artist "Dan" --genre "Folk Metal" --year 2026 --preset velvet-museum --delivery-profile aes-album-mode --arc cinematic --interlude-style auto --interlude-duration 8 --album-wav
```

Edit `album.ams.json` to adjust track titles, order, inferred/assigned character, and transition controls:

```json
{
  "tracks": [
    {
      "path": "raw-tracks/04_djent_arrival.wav",
      "title": "The Door Gives Way",
      "character": "heavy_djent",
      "artist": "Dan",
      "isrc": "USXXX2600001"
    }
  ],
  "transitions": [
    {
      "after_track": 3,
      "duration_seconds": 9.0,
      "style": "auto",
      "enabled": true
    }
  ]
}
```

Use `character: "auto"` to infer from audio and filename. Use `acoustic_folk`, `transition`, `heavy_djent`, or `return_acoustic` when you want to assign the role yourself.

Render the project:

```powershell
album-master render-project .\album.ams.json --output .\outputs\album-v1
```

Preview one transition:

```powershell
album-master preview-transition .\album.ams.json --after-track 1 --output .\outputs\previews\01-to-02.wav --tail-seconds 12 --head-seconds 12
```

Score a render:

```powershell
album-master score-render .\outputs\album-v1\manifest.json --scorer local
```

Export the HTML report:

```powershell
album-master export-dashboard .\outputs\album-v1\manifest.json --output .\outputs\album-v1\dashboard.html
```

Iterate automatically:

```powershell
album-master iterate-project .\album.ams.json --output .\outputs\iteration-1 --passes 2 --scorer auto
```

`--scorer auto` uses the local scorer by default. If `OPENAI_API_KEY` and `ALBUM_MASTER_LLM_MODEL` are set, it also asks an LLM for a concise mastering-director critique.

## Taste Presets

- `streaming`: Streaming / Transparent; balanced translation with clean headroom.
- `acoustic-natural`: Acoustic / Natural; lower-pressure mastering for intimate songs.
- `heavy-rock-metal`: Heavy Rock / Metal; forward guitars and controlled density.
- `djent-modern-metal`: Djent / Modern Metal; tight low end, pick definition, modern pressure.
- `warm-glue`: Warm Glue; saturation and softened edges for record-wide cohesion.
- `bright-air`: Bright / Air; lifted top and wider image.
- `dark-smooth`: Dark / Smooth; rounded presence and less-fatiguing top.
- `loud-aggressive`: Loud / Aggressive; dense and assertive with ceiling protection.
- `album-cohesion-cinematic`: Album Cohesion / Cinematic; polished whole-record glue.
- `3am-kitchen-floor`: warm low shelf, softened presence, narrower image, lower loudness target, gentle compression, tape-biased transitions.
- `radio-brittle`: lean low end, low-mid cut, aggressive presence and air, higher density, wider sides, rhythmic transition bias.
- `velvet-museum`: polished weight, controlled low mids, wide image, refined top, swell-biased transitions.
- `gentle`: lower-pressure master that preserves crest factor.
- `loud`: dense, forward, ceiling-aware.

Fine-tuning controls:

```powershell
--target-lufs -13.5
--ceiling-dbfs -1.0
--tweak-lufs -0.5
--tweak-brightness-db 0.4
--tweak-warmth 0.02
--tweak-low-end-db 0.4
--tweak-air-db 0.8
--tweak-presence-db -0.5
--tweak-width 0.04
--tweak-intensity 0.1
--tweak-limiter 0.2
```

The desktop app includes delivery profile shortcuts that set practical LUFS, ceiling, sample-rate, bit-depth, output-format, and codec-preview defaults. They are shortcuts, not laws: you can still override the manual controls after choosing one.

Delivery profiles:

- `streaming-universal`: practical -14 LUFS / -1 dBTP private streaming baseline.
- `aes-album-mode`: album-oriented profile that preserves relative track intent.
- `apple-aac-check`: conservative Apple/Sound Check-style reference with AAC clipping preview.
- `youtube-video`: 48 kHz / 24-bit video-oriented delivery.
- `amazon-alexa-safe`: -2 dBTP safety ceiling for lossy/speaker playback.
- `cd-16`: 16-bit / 44.1 kHz WAV with final-stage dither.
- `vinyl-premaster`: relaxed -18 LUFS / -3 dB headroom premaster.
- `loud-rock`: competitive loud-rock reference that reports expected normalization penalty.

The desktop `LU Offset` field is the same album-wide offset used by the iteration command. It is saved in `.ams.json` projects and is meant for small whole-album loudness moves after the preset and arc have done the broad shaping.

## Album Arcs

- `cinematic`: invitation, climb, centerpiece, release, afterglow.
- `afterhours`: starts present and slowly moves inward.
- `club-peak`: functional energy ramp with an obvious high point.
- `fever-dream`: unstable, uneven, and intentionally strange.

Use `--arc-intensity` to control how strongly track targets move around the preset's base loudness.

## Interlude Styles

- `auto`: chooses a transition style from the adjacent tracks and album arc.
- `ambient`: harmonic pad, filtered tail/head texture, and light air.
- `tape`: warmer, darker transition with saturation and slow wobble.
- `swell`: reversed transition texture with a longer lift into the next track.
- `rhythmic`: pulsed pad movement derived from the estimated transition root.
- `minimal`: quieter connective tissue that preserves more space.
- `crossfade`: clean source-derived overlap without extra drama.
- `filtered-fade`: filtered tail/head fade for tonal handoffs.
- `reverse-swell`: riser-style reverse texture into the next entrance.
- `noise-riser`: cymbal/noise-style lift without external samples.
- `sub-drop`: local sine/sub impact gesture.
- `tape-stop`: slowdown-style filtered gesture.
- `breath-gap`: quiet air/breath space between songs.
- `ring-out`: preserves and decays the outgoing tail.
- `pulsed-swell`: rhythm-gated swell from the estimated root.
- `drone-pad`: root-aware harmonic pad.
- `hard-cut`: nearly empty marker when a real cut is better than a forced wash.

## Mastering Science

The chain is deliberately transparent:

1. Decode to stereo float audio through FFmpeg.
2. Analyze duration, sample peak, true peak estimate, RMS, integrated LUFS-style loudness, short-term loudness maximum, LRA-style loudness range proxy, crest factor, dynamic range proxy, stereo image, spectral centroid, spectral balance, transient density, and energy density.
3. Infer track character across the whole sequence, including return/acoustic after the heavy center.
4. Plan album-level target loudness, track role, mastering bias, transition style, transition duration, and hard-handoff edge treatments.
5. Remove DC and apply a protective high-pass.
6. Apply taste EQ plus album-position EQ moves: low shelf, low-mid bell, presence bell, and air shelf.
7. Apply linked stereo compression with track-position intensity.
8. Shape transients according to preset taste and track role.
9. Add controlled saturation.
10. Adjust stereo width through mid/side processing.
11. Match the planned album-arc LUFS target.
12. Apply tail/head edge treatment for the adjacent transitions.
13. Apply ceiling limiting, dither when writing integer-depth WAV, write the selected output format, and optionally run AAC/Opus codec QC previews.
14. Write manifest, dashboard, and sample-accurate cue sheet data for the continuous album.

## Transition Planning

`auto` transition planning distinguishes `acoustic_to_heavy`, `heavy_to_heavy`, `heavy_to_acoustic`, `acoustic_to_acoustic`, and textural bridge cases. Genre shifts get longer, more opinionated interludes and mastering-chain preparation:

- Acoustic to heavy: the acoustic tail is weighted and darkened, the heavy head is eased in, and the interlude tends rhythmic.
- Heavy to acoustic: the heavy tail narrows and softens, the acoustic head warms inward, and the interlude tends swell or tape.
- Heavy to heavy: the gap tightens momentum without washing out the center of the record.
- Acoustic to acoustic: the gap stays musical but restrained, usually tape, ambient, or minimal.

Every rendered transition in `manifest.json` includes the handoff type, interlude style, duration, tail treatment, head treatment, and a one-sentence rationale.

## Scoring And Iteration

The deterministic local scorer evaluates album arc, interlude cohesion, translation safety, preset identity, sequence continuity, genre-shift handling, and decision rationales. Optional LLM scoring is additive only: if credentials are missing, the local score still works.

`iterate-project` halts on convergence or after the requested maximum passes. Between passes it applies one safe improvement, such as increasing arc intensity, lengthening auto transitions, lowering loudness for true-peak safety, or switching to a stronger preset identity. Each pass records the decision in `iteration_summary.json`.

The LUFS implementation is approximate and tested for consistency inside this tool; validate critical releases with a trusted external meter before distribution.

## Tests

```powershell
python -m unittest discover -s tests
python -m compileall -q src tests
album-master smoke --output .\test-output\smoke
cd desktop
npm run build
npm run test:integration
```

The test suite includes an eight-track synthetic album that exercises the acoustic -> heavy/djent -> acoustic return workflow end to end, including render, interludes, full album WAV, transition preview, scorecard, dashboard, cue sheets, codec QC preview records, and narrative rationales. The smoke command also verifies 1-track, 2-track, and 8-track renders, individual mastered tracks, transition files, manifest/report artifacts, finite samples, and basic ceiling safety.

## Troubleshooting

- `Required audio tool is missing: ffmpeg`: install FFmpeg and make sure `ffmpeg -version` works in the same PowerShell session.
- `Required audio tool is missing: ffprobe`: FFprobe ships with FFmpeg; add the FFmpeg `bin` folder to `PATH`.
- The app opens but render fails immediately: run `album-master analyze .\path\to\song.wav` to confirm decode works outside the GUI.
- MP3/M4A/Opus export fails: your FFmpeg build may not include that encoder. Use WAV or FLAC.
- Codec QC warnings mean the rendered WAV survived, but the AAC/Opus round trip may clip or exceed the selected ceiling. Lower the ceiling or loudness target and rerender.
- A track reports clipping or ceiling warnings: the render still completed, but inspect the source and output before trusting the loudness setting.
- Long FFmpeg exports can raise a timeout; set `ALBUM_MASTER_FFMPEG_TIMEOUT` to a larger number of seconds before rendering.
- LUFS and true peak are local approximations. For a real release, validate the final WAV in a trusted external meter.
