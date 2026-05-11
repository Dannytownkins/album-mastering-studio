# Album Mastering Studio

An opinionated local mastering tool for albums, not isolated songs.

Album Mastering Studio takes a sequence of tracks, plans an emotional album arc, masters each track into that arc, and generates musical interludes from the surrounding audio. The interludes are not silence and not stock crossfades: they are synthesized from adjacent track roots, tails, heads, brightness, and energy.

The taste presets are intentionally specific. `3am-kitchen-floor` is warm, close, and private. `radio-brittle` is bright, forward, and sharp. Those are not labels on the same chain; they change loudness targets, EQ contour, stereo width, compression behavior, transient shape, saturation, and preferred transition language.

The main use case is a complete record: for example, an eight-track sequence that starts acoustic/indie-folk, crosses into djent/heavy material, and returns to acoustic intimacy. The tool does not force those songs to one LUFS number. It infers or accepts track character, plans the album journey, masters each track for its position, and shapes the tail/head of hard genre shifts inside the mastering chain before the generated interlude is even added.

## What It Does

- Imports WAV, AIFF, FLAC, MP3, M4A/AAC, OGG, and Opus through FFmpeg.
- Analyzes loudness, true peak, dynamics, spectral balance, stereo image, transient density, and energy density.
- Can analyze an optional reference track and include it in the render manifest/dashboard for comparison.
- Infers broad track character: `acoustic_folk`, `transition`, `heavy_djent`, and `return_acoustic`.
- Masters tracks with LUFS-style targeting, ceiling limiting, compression, high-pass cleanup, taste EQ, transient shaping, stereo width, and saturation.
- Plans album-level emotional arcs instead of flattening every track to the same loudness.
- Applies position-aware mastering moves, so acoustic tracks breathe, heavy tracks get controlled density, and return/acoustic tracks come back inward.
- Shapes outgoing tails and incoming heads for acoustic-to-heavy and heavy-to-acoustic handoffs.
- Generates interludes from neighboring track audio using estimated root movement, filtered tail/head texture, harmonic pads, noise air, tape color, swells, and rhythmic gates.
- Creates editable `.ams.json` album project files with track order, titles, character overrides, arc settings, and per-transition controls.
- Renders transition previews so you can audition the important seams without re-rendering the whole album.
- Scores its own renders from the actual album WAV plus manifest data, with optional LLM critique when API credentials are available.
- Iterates projects over bounded render/score passes, applies at most one improvement per pass, and logs the decision.
- Exports a standalone HTML dashboard/report with album arc, track roles, transition rationales, and scorecard.

## Requirements

- Python 3.11+
- FFmpeg and FFprobe on `PATH`
- Python packages: `numpy`, `scipy`, `pyloudnorm`

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

Launch the local desktop app:

```powershell
album-master app
```

or:

```powershell
album-master-studio
```

The app is a plain Windows-friendly launcher: add up to 8 songs, reorder them, optionally choose a reference track, analyze, choose a preset and album arc, pick a target profile or manual LUFS/ceiling, adjust fine-tuning controls, set transition defaults or per-transition overrides, preview/listen where practical, render the album, then open the output folder or dashboard report.

Core render outputs:

- `masters/`: individual mastered WAVs or selected export format
- `interludes/`: generated transition files
- `album_sequence.wav`: continuous album master when full album render is selected
- `manifest.json`: inputs, settings, analysis, warnings, output paths, and transition rationales
- `scorecard.json`: local render-health score when run through the app or `score-render`
- `dashboard.html`: readable report when run through the app or `export-dashboard`

## Quick Render

```powershell
album-master render .\raw-tracks --output .\outputs\album-v1 --preset album-cohesion-cinematic --arc cinematic --interlude-style auto --interlude-duration 8 --album-wav
album-master score-render .\outputs\album-v1\manifest.json --scorer local
album-master export-dashboard .\outputs\album-v1\manifest.json --output .\outputs\album-v1\dashboard.html
```

The output folder contains:

- `masters/`: mastered track files
- `interludes/`: musical transitions between tracks
- `album_sequence.wav`: continuous album render when `--album-wav` is used
- `manifest.json`: settings, album story, arc plan, character inference, track analysis, render paths, per-track/per-transition rationales, edge-mastering moves, preset metadata

## Project Workflow

Create an editable album project:

```powershell
album-master init-project .\raw-tracks --project .\album.ams.json --title "Album Draft" --preset velvet-museum --arc cinematic --interlude-style auto --interlude-duration 8 --album-wav
```

Edit `album.ams.json` to adjust track titles, order, inferred/assigned character, and transition controls:

```json
{
  "tracks": [
    {
      "path": "raw-tracks/04_djent_arrival.wav",
      "title": "The Door Gives Way",
      "character": "heavy_djent"
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

The desktop app also includes target profile shortcuts for common album/export directions such as streaming, Apple-ish, YouTube-ish, quiet album, and loud rock. Those shortcuts simply set the manual LUFS/ceiling controls; you can still override them directly.

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
2. Analyze duration, sample peak, true peak estimate, RMS, integrated LUFS-style loudness, crest factor, dynamic range, stereo image, spectral centroid, spectral balance, transient density, and energy density.
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
13. Apply ceiling limiting and write the selected output format.

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
```

The test suite includes an eight-track synthetic album that exercises the acoustic -> heavy/djent -> acoustic return workflow end to end, including render, interludes, full album WAV, transition preview, scorecard, dashboard, and narrative rationales. The smoke command also verifies 1-track, 2-track, and 8-track renders, individual mastered tracks, transition files, manifest/report artifacts, finite samples, and basic ceiling safety.

## Troubleshooting

- `Required audio tool is missing: ffmpeg`: install FFmpeg and make sure `ffmpeg -version` works in the same PowerShell session.
- `Required audio tool is missing: ffprobe`: FFprobe ships with FFmpeg; add the FFmpeg `bin` folder to `PATH`.
- The app opens but render fails immediately: run `album-master analyze .\path\to\song.wav` to confirm decode works outside the GUI.
- MP3/M4A/Opus export fails: your FFmpeg build may not include that encoder. Use WAV or FLAC.
- A track reports clipping or ceiling warnings: the render still completed, but inspect the source and output before trusting the loudness setting.
- Long FFmpeg exports can raise a timeout; set `ALBUM_MASTER_FFMPEG_TIMEOUT` to a larger number of seconds before rendering.
- LUFS and true peak are local approximations. For a real release, validate the final WAV in a trusted external meter.
