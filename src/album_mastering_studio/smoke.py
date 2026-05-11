from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
from scipy.io import wavfile

from .audio_io import load_audio
from .dashboard import export_dashboard
from .pipeline import RenderOptions, create_project, render_album, render_project
from .scoring import score_render


def run_smoke(output_dir: Path, clean: bool = True) -> dict:
    output_dir = output_dir.resolve()
    if clean and output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    checks: list[dict] = []
    checks.append(_one_track(output_dir / "one-track"))
    checks.append(_two_track(output_dir / "two-track"))
    checks.append(_eight_track(output_dir / "eight-track"))

    failed = [check for check in checks if not check["passed"]]
    summary = {
        "passed": not failed,
        "output": str(output_dir),
        "checks": checks,
    }
    (output_dir / "smoke-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    if failed:
        names = ", ".join(check["name"] for check in failed)
        raise RuntimeError(f"Smoke checks failed: {names}")
    return summary


def _one_track(root: Path) -> dict:
    inputs = root / "inputs"
    render = root / "render"
    inputs.mkdir(parents=True, exist_ok=True)
    _write_sine(inputs / "01_single.wav", 220.0, 0.35, seconds=1.2)
    manifest = render_album(
        [inputs],
        render,
        RenderOptions(
            preset="streaming",
            interlude_duration=0.5,
            interlude_style="minimal",
            album_wav=True,
        ),
    )
    return _check_render(
        "1-track render",
        render,
        manifest,
        expected_tracks=1,
        expected_interludes=0,
        require_dashboard=False,
    )


def _two_track(root: Path) -> dict:
    inputs = root / "inputs"
    render = root / "render"
    inputs.mkdir(parents=True, exist_ok=True)
    _write_sine(inputs / "01_a.wav", 196.0, 0.34, seconds=1.2)
    _write_sine(inputs / "02_b.wav", 293.66, 0.42, seconds=1.2)
    manifest = render_album(
        [inputs],
        render,
        RenderOptions(
            preset="warm-glue",
            interlude_duration=0.5,
            interlude_style="crossfade",
            album_wav=True,
        ),
    )
    return _check_render(
        "2-track transition render",
        render,
        manifest,
        expected_tracks=2,
        expected_interludes=1,
        require_dashboard=False,
    )


def _eight_track(root: Path) -> dict:
    inputs = root / "inputs"
    render = root / "render"
    project_path = root / "album.ams.json"
    inputs.mkdir(parents=True, exist_ok=True)
    _write_acoustic(inputs / "01_acoustic_opener.wav", 196.0, 0.30)
    _write_transition_texture(inputs / "02_threshold_transition.wav", 146.83, 0.24)
    _write_acoustic(inputs / "03_acoustic_threshold.wav", 220.0, 0.34)
    _write_djent(inputs / "04_djent_arrival.wav", 73.42, 0.58)
    _write_djent(inputs / "05_djent_pressure.wav", 82.41, 0.62)
    _write_djent(inputs / "06_heavy_center.wav", 92.50, 0.64)
    _write_acoustic(inputs / "07_return_acoustic.wav", 174.61, 0.28)
    _write_acoustic(inputs / "08_acoustic_afterglow.wav", 164.81, 0.24)

    project = create_project(
        [inputs],
        project_path,
        RenderOptions(
            preset="album-cohesion-cinematic",
            delivery_profile="streaming-universal",
            target_lufs=-13.5,
            ceiling_dbfs=-1.0,
            interlude_duration=0.5,
            interlude_style="auto",
            arc="cinematic",
            album_wav=True,
        ),
        album_title="Smoke Folk/Djent Return",
    )
    project["tracks"][1]["character"] = "transition"
    project["tracks"][3]["preset"] = "djent-modern-metal"
    project["tracks"][4]["preset"] = "djent-modern-metal"
    project["tracks"][5]["preset"] = "heavy-rock-metal"
    project["tracks"][6]["character"] = "return_acoustic"
    project["transitions"][2]["style"] = "reverse-swell"
    project["transitions"][5]["style"] = "ring-out"
    project_path.write_text(json.dumps(project, indent=2), encoding="utf-8")

    manifest = render_project(project_path, render)
    score_render(render / "manifest.json", scorer="local")
    export_dashboard(render / "manifest.json", render / "dashboard.html")
    return _check_render(
        "8-track product workflow",
        render,
        manifest,
        expected_tracks=8,
        expected_interludes=7,
        require_dashboard=True,
    )


def _check_render(
    name: str,
    render_dir: Path,
    manifest: dict,
    expected_tracks: int,
    expected_interludes: int,
    require_dashboard: bool,
) -> dict:
    failures: list[str] = []
    if manifest["track_count"] != expected_tracks:
        failures.append(f"expected {expected_tracks} tracks, got {manifest['track_count']}")
    if manifest["interlude_count"] != expected_interludes:
        failures.append(f"expected {expected_interludes} interludes, got {manifest['interlude_count']}")
    if not (render_dir / "manifest.json").exists():
        failures.append("manifest.json missing")
    if not manifest.get("album_sequence") or not Path(manifest["album_sequence"]).exists():
        failures.append("continuous album WAV missing")
    if not manifest.get("cue_sheet") or not Path(manifest["cue_sheet"]).exists():
        failures.append("cue sheet missing")
    if len(manifest.get("cue_points", [])) != expected_tracks + expected_interludes:
        failures.append("cue point count mismatch")
    if manifest.get("settings", {}).get("codec_preview", True) and expected_tracks:
        codec_previews = manifest.get("codec_previews", [])
        if len(codec_previews) < 2:
            failures.append("codec QC previews missing")
    if len(list((render_dir / "masters").glob("*.wav"))) != expected_tracks:
        failures.append("individual mastered WAV count mismatch")
    if len(list((render_dir / "interludes").glob("*.wav"))) != expected_interludes:
        failures.append("transition WAV count mismatch")
    if require_dashboard and not (render_dir / "dashboard.html").exists():
        failures.append("dashboard.html missing")
    if require_dashboard and not (render_dir / "scorecard.json").exists():
        failures.append("scorecard.json missing")
    if (render_dir / "album_sequence.wav").exists():
        album = load_audio(render_dir / "album_sequence.wav", 48_000)
        if np.any(~np.isfinite(album)):
            failures.append("album_sequence.wav contains NaN or inf samples")
        if float(np.max(np.abs(album))) > 1.0:
            failures.append("album_sequence.wav exceeds full-scale samples")
    if not manifest.get("sequence"):
        failures.append("manifest sequence is empty")
    for item in manifest.get("sequence", []):
        if item.get("type") == "interlude" and not item.get("rationale"):
            failures.append("transition rationale missing")
    return {
        "name": name,
        "passed": not failures,
        "render": str(render_dir),
        "failures": failures,
        "warnings": manifest.get("warnings", []),
    }


def _write_sine(path: Path, frequency: float, amplitude: float, seconds: float = 1.5) -> None:
    sample_rate = 48_000
    t = np.linspace(0.0, seconds, int(sample_rate * seconds), endpoint=False)
    tone = amplitude * np.sin(2.0 * np.pi * frequency * t)
    wavfile.write(path, sample_rate, np.column_stack([tone, tone * 0.92]).astype(np.float32))


def _write_acoustic(path: Path, frequency: float, amplitude: float) -> None:
    sample_rate = 48_000
    seconds = 1.4
    t = np.linspace(0.0, seconds, int(sample_rate * seconds), endpoint=False)
    strum_phase = np.mod(t * 2.0, 1.0)
    strum = np.exp(-strum_phase * 5.5)
    body = (
        np.sin(2.0 * np.pi * frequency * t)
        + (0.45 * np.sin(2.0 * np.pi * frequency * 2.0 * t))
        + (0.20 * np.sin(2.0 * np.pi * frequency * 3.0 * t))
    )
    air = 0.020 * np.sin(2.0 * np.pi * 3600.0 * t)
    left = amplitude * ((body * (0.42 + strum)) + air)
    right = amplitude * ((body * 0.90 * (0.40 + np.roll(strum, 91))) - air)
    wavfile.write(path, sample_rate, np.column_stack([left, right]).astype(np.float32))


def _write_djent(path: Path, frequency: float, amplitude: float) -> None:
    sample_rate = 48_000
    seconds = 1.4
    t = np.linspace(0.0, seconds, int(sample_rate * seconds), endpoint=False)
    gate = (0.30 + 0.70 * (np.sin(2.0 * np.pi * 8.0 * t) > 0.15).astype(np.float32))
    riff = (
        np.sin(2.0 * np.pi * frequency * t)
        + (0.75 * np.sin(2.0 * np.pi * frequency * 2.01 * t))
        + (0.55 * np.sin(2.0 * np.pi * frequency * 3.02 * t))
        + (0.22 * np.sin(2.0 * np.pi * 2600.0 * t))
    )
    distorted = np.tanh(riff * 3.0) * gate
    left = amplitude * distorted
    right = amplitude * np.tanh((riff * 2.7) + (0.10 * np.sin(2.0 * np.pi * 41.0 * t))) * np.roll(gate, 57)
    wavfile.write(path, sample_rate, np.column_stack([left, right]).astype(np.float32))


def _write_transition_texture(path: Path, frequency: float, amplitude: float) -> None:
    sample_rate = 48_000
    seconds = 1.4
    t = np.linspace(0.0, seconds, int(sample_rate * seconds), endpoint=False)
    swell = np.sin(np.linspace(0.0, np.pi, t.size)) ** 1.4
    pad = np.sin(2.0 * np.pi * frequency * t) + (0.30 * np.sin(2.0 * np.pi * frequency * 1.5 * t))
    left = amplitude * pad * swell
    right = amplitude * (pad * 0.82 + 0.12 * np.sin(2.0 * np.pi * 900.0 * t)) * swell
    wavfile.write(path, sample_rate, np.column_stack([left, right]).astype(np.float32))
