from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile

AUDIO_EXTENSIONS = {
    ".aac",
    ".aif",
    ".aiff",
    ".flac",
    ".m4a",
    ".mp3",
    ".ogg",
    ".opus",
    ".wav",
}


class AudioToolError(RuntimeError):
    """Raised when FFmpeg or FFprobe cannot process an audio file."""


def collect_audio_files(paths: list[Path]) -> list[Path]:
    files: list[Path] = []
    for path in paths:
        if path.is_dir():
            files.extend(
                sorted(
                    child
                    for child in path.iterdir()
                    if child.is_file() and child.suffix.lower() in AUDIO_EXTENSIONS
                )
            )
        elif path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS:
            files.append(path)
        else:
            raise FileNotFoundError(f"No supported audio file found at: {path}")

    if not files:
        raise FileNotFoundError("No supported audio files found.")
    return files


def load_audio(path: Path, sample_rate: int) -> np.ndarray:
    with tempfile.TemporaryDirectory(prefix="album-master-decode-") as tmpdir:
        decoded = Path(tmpdir) / "decoded.wav"
        _run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(path),
                "-ac",
                "2",
                "-ar",
                str(sample_rate),
                "-f",
                "wav",
                "-c:a",
                "pcm_f32le",
                str(decoded),
            ]
        )
        rate, data = wavfile.read(decoded)

    if rate != sample_rate:
        raise AudioToolError(f"Expected {sample_rate} Hz but decoded {rate} Hz for {path}")

    samples = np.asarray(data, dtype=np.float32)
    if samples.ndim == 1:
        samples = samples[:, np.newaxis]
    if samples.shape[1] == 1:
        samples = np.repeat(samples, 2, axis=1)
    elif samples.shape[1] > 2:
        samples = samples[:, :2]

    return np.nan_to_num(samples, nan=0.0, posinf=0.0, neginf=0.0)


def write_audio(path: Path, samples: np.ndarray, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    suffix = path.suffix.lower()
    samples = np.clip(samples, -1.0, 1.0).astype(np.float32)

    with tempfile.TemporaryDirectory(prefix="album-master-encode-") as tmpdir:
        source = Path(tmpdir) / "source.wav"
        wavfile.write(source, sample_rate, samples)
        _run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(source),
                *_codec_args(suffix),
                str(path),
            ]
        )


def probe(path: Path) -> dict:
    result = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,bit_rate:stream=sample_rate,channels,codec_name",
            "-of",
            "json",
            str(path),
        ],
        capture=True,
    )
    return json.loads(result.stdout)


def _codec_args(suffix: str) -> list[str]:
    if suffix == ".wav":
        return ["-c:a", "pcm_s24le"]
    if suffix == ".flac":
        return ["-c:a", "flac"]
    if suffix == ".mp3":
        return ["-c:a", "libmp3lame", "-q:a", "2"]
    if suffix in {".m4a", ".aac"}:
        return ["-c:a", "aac", "-b:a", "256k"]
    if suffix in {".ogg", ".opus"}:
        return ["-c:a", "libopus", "-b:a", "192k"]
    raise ValueError(f"Unsupported output extension: {suffix}")


def _run(args: list[str], capture: bool = False) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            args,
            check=True,
            text=True,
            capture_output=capture,
        )
    except FileNotFoundError as exc:
        raise AudioToolError(f"Required audio tool is missing: {args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() if exc.stderr else str(exc)
        raise AudioToolError(detail) from exc
