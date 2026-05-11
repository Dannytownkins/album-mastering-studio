# AGENTS.md

## Product Outcome

This repo is a private Windows PC album-mastering studio for a personal creative workflow. The app should let a user load and reorder up to 8 songs, analyze them, choose a mastering direction, fine-tune the sound, generate transitions between adjacent songs, render a continuous album WAV, render individual mastered tracks, and open a readable report/dashboard explaining the render.

Keep the product useful before polishing architecture. Prefer complete vertical workflow improvements over isolated backend refactors.

## Repo Rules

- Work from the existing Python package in `src/album_mastering_studio`; do not restart from scratch unless the current implementation blocks the requested outcome.
- Keep processing local/offline by default. Do not upload songs or require external services.
- No hardcoded secrets, no global installs, and no cloud dependency for core processing.
- Keep FFmpeg/FFprobe as the audio import/export boundary, and keep final WAV exports as integer PCM unless explicitly testing float intermediates.
- Preserve the editable `.ams.json` project workflow.
- Limit album projects/renders to 8 tracks unless the product requirement changes.
- Generated audio/report artifacts belong under ignored folders such as `outputs/` or `test-output/`.

## Windows Setup

From the repo root:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e .
```

FFmpeg and FFprobe must be installed and available on `PATH`:

```powershell
ffmpeg -version
ffprobe -version
```

## Run Commands

Launch the desktop app:

```powershell
album-master app
```

Equivalent direct launcher:

```powershell
album-master-studio
```

CLI fallback render:

```powershell
album-master render .\raw-tracks --output .\outputs\album-v1 --preset album-cohesion-cinematic --delivery-profile streaming-universal --arc cinematic --interlude-style auto --interlude-duration 8 --album-wav
album-master score-render .\outputs\album-v1\manifest.json --scorer local
album-master export-dashboard .\outputs\album-v1\manifest.json --output .\outputs\album-v1\dashboard.html
```

Smoke/eval:

```powershell
python -m compileall -q src tests
python -m unittest discover -s tests
album-master smoke --output .\test-output\smoke
```

## Architecture Notes

- `audio_io.py`: FFmpeg/FFprobe decode, probe, and encode wrappers.
- `analysis.py` and `loudness.py`: local loudness, true-peak proxy, dynamic, stereo, spectral, and transient measurements.
- `standards.py`: delivery profile shortcuts for streaming, AES album-mode, Apple/AAC, YouTube, Amazon/speaker-safe, CD, vinyl premaster, and loud-rock references.
- `mastering.py`: presets, fine-tuning controls, EQ/compression/saturation/width/limiting chain.
- `arc.py`: album arc planning, character-aware loudness targets, handoff decisions, and tail/head edge treatments.
- `interludes.py`: local generated transition styles.
- `pipeline.py`: project loading, render sequencing, manifests, warnings, codec QC, cue sheets, and album WAV assembly.
- `dashboard.py`: standalone HTML report.
- `app.py`: Tkinter desktop launcher for Windows.
- `smoke.py`: synthetic workflow validation for 1-, 2-, and 8-track renders.

## Current Limitations

- LUFS and true peak are practical local approximations, not replacements for release-meter validation.
- Tempo/key/chroma are approximated only through local root and spectral heuristics.
- The GUI is dark, workflow-first, and still basic compared with a DAW.
- Codec QC previews are local FFmpeg round trips, not a substitute for checking a final release in the destination platform tooling.
- Optional LLM scoring is additive only and must never become required for the core render path.
