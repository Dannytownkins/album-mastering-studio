from __future__ import annotations

import json
import os
import wave
import shutil
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
DEFAULT_AUDIO_TOOL_TIMEOUT = 900.0


class AudioToolError(RuntimeError):
    """Raised when FFmpeg or FFprobe cannot process an audio file."""


def check_audio_tools() -> list[str]:
    return [tool for tool in ("ffmpeg", "ffprobe") if shutil.which(tool) is None]


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


def write_audio(path: Path, samples: np.ndarray, sample_rate: int, *, bit_depth: int = 24, dither: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    suffix = path.suffix.lower()
    samples = _stereo_float(samples)

    if suffix == ".wav":
        _write_wav(path, samples, sample_rate, bit_depth=bit_depth, dither=dither)
        return

    with tempfile.TemporaryDirectory(prefix="album-master-encode-") as tmpdir:
        source = Path(tmpdir) / "source.wav"
        _write_wav(source, samples, sample_rate, bit_depth=bit_depth, dither=dither)
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
    if suffix == ".ogg":
        return ["-c:a", "libvorbis", "-q:a", "5"]
    if suffix == ".opus":
        return ["-c:a", "libopus", "-b:a", "192k"]
    raise ValueError(f"Unsupported output extension: {suffix}")


def _stereo_float(samples: np.ndarray) -> np.ndarray:
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim == 1:
        samples = samples[:, np.newaxis]
    if samples.shape[1] == 1:
        samples = np.repeat(samples, 2, axis=1)
    elif samples.shape[1] > 2:
        samples = samples[:, :2]
    return np.nan_to_num(np.clip(samples, -1.0, 1.0), nan=0.0, posinf=0.0, neginf=0.0)


def _write_wav(path: Path, samples: np.ndarray, sample_rate: int, *, bit_depth: int, dither: bool) -> None:
    if bit_depth == 32:
        wavfile.write(path, sample_rate, samples.astype(np.float32))
        return
    if bit_depth == 24:
        _write_pcm24(path, samples, sample_rate, dither=dither)
        return
    if bit_depth == 16:
        rendered = _quantize(samples, 16, dither=dither).astype("<i2")
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(rendered.shape[1])
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            wav.writeframes(rendered.reshape(-1).tobytes())
        return
    raise ValueError("WAV bit depth must be 16, 24, or 32.")


def _write_pcm24(path: Path, samples: np.ndarray, sample_rate: int, *, dither: bool) -> None:
    quantized = _quantize(samples, 24, dither=dither).reshape(-1).astype(np.int32)
    unsigned = quantized & 0xFFFFFF
    packed = np.empty((unsigned.size, 3), dtype=np.uint8)
    packed[:, 0] = unsigned & 0xFF
    packed[:, 1] = (unsigned >> 8) & 0xFF
    packed[:, 2] = (unsigned >> 16) & 0xFF
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(samples.shape[1])
        wav.setsampwidth(3)
        wav.setframerate(sample_rate)
        wav.writeframes(packed.tobytes())


def _quantize(samples: np.ndarray, bit_depth: int, *, dither: bool) -> np.ndarray:
    scale = float((1 << (bit_depth - 1)) - 1)
    rendered = samples.astype(np.float64, copy=False)
    if dither:
        rng = np.random.default_rng(0)
        rendered = rendered + ((rng.random(rendered.shape) - rng.random(rendered.shape)) / scale)
    rendered = np.clip(rendered, -1.0, 1.0 - (1.0 / scale))
    return np.round(rendered * scale)


def _run(args: list[str], capture: bool = False) -> subprocess.CompletedProcess:
    timeout = float(os.environ.get("ALBUM_MASTER_FFMPEG_TIMEOUT", DEFAULT_AUDIO_TOOL_TIMEOUT))
    try:
        return subprocess.run(
            args,
            check=True,
            text=True,
            capture_output=capture,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise AudioToolError(f"Required audio tool is missing: {args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() if exc.stderr else str(exc)
        raise AudioToolError(detail) from exc
    except subprocess.TimeoutExpired as exc:
        raise AudioToolError(f"{args[0]} timed out while processing audio.") from exc
