from __future__ import annotations

import hashlib

import numpy as np
from scipy import signal

from .mastering import prepare_interlude_level

EPSILON = 1e-12

INTERLUDE_STYLES = (
    "ambient",
    "tape",
    "swell",
    "rhythmic",
    "minimal",
    "crossfade",
    "filtered-fade",
    "reverse-swell",
    "noise-riser",
    "sub-drop",
    "tape-stop",
    "breath-gap",
    "ring-out",
    "pulsed-swell",
    "drone-pad",
    "hard-cut",
)
INTERLUDE_STYLE_CHOICES = ("auto", *INTERLUDE_STYLES)


def make_interlude(
    previous_track: np.ndarray,
    next_track: np.ndarray,
    sample_rate: int,
    duration_seconds: float,
    style: str = "ambient",
    target_lufs: float = -23.0,
    ceiling_dbfs: float = -1.0,
) -> np.ndarray:
    if style not in INTERLUDE_STYLES:
        choices = ", ".join(INTERLUDE_STYLES)
        raise ValueError(f"Unknown interlude style '{style}'. Choose one of: {choices}")

    frame_count = max(int(sample_rate * duration_seconds), sample_rate // 4)
    root_a = _estimate_root_frequency(previous_track[-sample_rate * 12 :], sample_rate)
    root_b = _estimate_root_frequency(next_track[: sample_rate * 12], sample_rate)
    tempo_bpm = _estimate_transition_tempo(previous_track, next_track, sample_rate)

    if style == "crossfade":
        interlude = _actual_crossfade(previous_track, next_track, frame_count)
        return prepare_interlude_level(interlude, sample_rate, target_lufs=target_lufs, ceiling_dbfs=ceiling_dbfs)
    if style == "hard-cut":
        return np.zeros((frame_count, 2), dtype=np.float32)

    frequency_curve = _frequency_glide(root_a, root_b, frame_count)
    pad = _harmonic_pad(frequency_curve, sample_rate)
    texture = _transition_texture(previous_track, next_track, sample_rate, frame_count)
    air = _filtered_noise(frame_count, sample_rate, root_a, root_b)

    interlude = _compose_style(style, pad, texture, air, frequency_curve, sample_rate, tempo_bpm)
    interlude *= _fade(np.ones(frame_count, dtype=np.float32), sample_rate, 0.75)[:, np.newaxis]
    if style == "breath-gap":
        return prepare_interlude_level(
            interlude,
            sample_rate,
            target_lufs=min(target_lufs - 8.0, -28.0),
            ceiling_dbfs=ceiling_dbfs,
        )
    return prepare_interlude_level(interlude, sample_rate, target_lufs=target_lufs, ceiling_dbfs=ceiling_dbfs)


def _compose_style(
    style: str,
    pad: np.ndarray,
    texture: np.ndarray,
    air: np.ndarray,
    frequency_curve: np.ndarray,
    sample_rate: int,
    tempo_bpm: float,
) -> np.ndarray:
    if style == "ambient":
        return pad + texture + air
    if style == "tape":
        return _tape_color((pad * 0.65) + (texture * 1.15) + (air * 0.45), sample_rate)
    if style == "swell":
        return (pad * 0.70) + _reverse_swell(texture) + (air * 0.35)
    if style == "rhythmic":
        return _rhythmic_gate((pad * 0.85) + (texture * 0.65), tempo_bpm, sample_rate) + (air * 0.20)
    if style == "minimal":
        return (texture * 0.55) + (pad * 0.18)
    if style == "crossfade":
        return _clean_crossfade(texture, sample_rate)
    if style == "filtered-fade":
        return _filtered_fade(texture + (pad * 0.18), sample_rate)
    if style == "reverse-swell":
        return (pad * 0.52) + (_reverse_swell(texture) * 1.2) + _rising_air(air)
    if style == "noise-riser":
        return (pad * 0.32) + _rising_air(air * 1.8)
    if style == "sub-drop":
        return (texture * 0.30) + _sub_drop(frequency_curve, sample_rate) + (air * 0.16)
    if style == "tape-stop":
        return _tape_stop(texture + (pad * 0.24), sample_rate)
    if style == "breath-gap":
        return _breath_gap(air)
    if style == "ring-out":
        return _ring_out(texture, pad)
    if style == "pulsed-swell":
        return _pulsed_swell(pad + (texture * 0.55), tempo_bpm, sample_rate) + (air * 0.25)
    if style == "drone-pad":
        return (pad * 1.35) + (texture * 0.30) + (air * 0.18)
    if style == "hard-cut":
        return _hard_cut_marker(air)
    raise AssertionError(f"Unhandled interlude style: {style}")


def _actual_crossfade(previous_track: np.ndarray, next_track: np.ndarray, frame_count: int) -> np.ndarray:
    tail = _fit_or_pad(_fit_stereo(previous_track), frame_count, from_end=True)
    head = _fit_or_pad(_fit_stereo(next_track), frame_count, from_end=False)
    out_env = np.cos(np.linspace(0.0, np.pi / 2.0, frame_count, dtype=np.float32))[:, np.newaxis]
    in_env = np.sin(np.linspace(0.0, np.pi / 2.0, frame_count, dtype=np.float32))[:, np.newaxis]
    return ((tail * out_env) + (head * in_env)).astype(np.float32)


def _fit_or_pad(samples: np.ndarray, frame_count: int, from_end: bool) -> np.ndarray:
    if samples.shape[0] >= frame_count:
        return samples[-frame_count:] if from_end else samples[:frame_count]
    output = np.zeros((frame_count, 2), dtype=np.float32)
    if from_end:
        output[-samples.shape[0] :] = samples
    else:
        output[: samples.shape[0]] = samples
    return output


def _clean_crossfade(texture: np.ndarray, sample_rate: int) -> np.ndarray:
    if texture.shape[0] < 128:
        return texture
    sos = signal.butter(2, 6400.0, btype="lowpass", fs=sample_rate, output="sos")
    return signal.sosfiltfilt(sos, texture * 1.3, axis=0).astype(np.float32)


def _filtered_fade(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    if samples.shape[0] < 256:
        return samples
    sos = signal.butter(2, [110.0, 2800.0], btype="bandpass", fs=sample_rate, output="sos")
    filtered = signal.sosfiltfilt(sos, samples, axis=0)
    curve = np.linspace(0.0, 1.0, samples.shape[0], dtype=np.float32)
    tilt = (0.85 - (0.35 * curve))[:, np.newaxis]
    return (filtered * tilt).astype(np.float32)


def _rising_air(air: np.ndarray) -> np.ndarray:
    if air.shape[0] == 0:
        return air
    rise = np.linspace(0.0, 1.0, air.shape[0], dtype=np.float32) ** 1.65
    return (air * rise[:, np.newaxis]).astype(np.float32)


def _sub_drop(frequency_curve: np.ndarray, sample_rate: int) -> np.ndarray:
    frame_count = frequency_curve.size
    if frame_count == 0:
        return np.zeros((0, 2), dtype=np.float32)
    start = float(np.clip(np.median(frequency_curve) * 0.5, 42.0, 90.0))
    end = max(start * 0.42, 28.0)
    drop_curve = np.linspace(start, end, frame_count, dtype=np.float32)
    osc = _oscillator(drop_curve, sample_rate, 1.0)
    envelope = np.exp(-np.linspace(0.0, 5.0, frame_count, dtype=np.float32))
    impact = np.sin(np.linspace(0.0, np.pi, frame_count, dtype=np.float32)) ** 10
    sub = ((osc * envelope * 0.42) + (impact * 0.08)).astype(np.float32)
    return np.column_stack([sub, sub * 0.96]).astype(np.float32)


def _tape_stop(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    frame_count = samples.shape[0]
    if frame_count < 256:
        return samples
    source_positions = np.cumsum(np.linspace(1.0, 0.32, frame_count, dtype=np.float32))
    source_positions = source_positions / source_positions[-1] * (frame_count - 1)
    x = np.arange(frame_count, dtype=np.float32)
    stopped = np.column_stack(
        [
            np.interp(source_positions, x, samples[:, channel])
            for channel in range(samples.shape[1])
        ]
    )
    sos = signal.butter(2, 5200.0, btype="lowpass", fs=sample_rate, output="sos")
    envelope = np.linspace(1.0, 0.18, frame_count, dtype=np.float32)[:, np.newaxis]
    return (signal.sosfiltfilt(sos, stopped, axis=0) * envelope).astype(np.float32)


def _breath_gap(air: np.ndarray) -> np.ndarray:
    if air.shape[0] == 0:
        return air
    frame_count = air.shape[0]
    envelope = np.clip(np.sin(np.linspace(0.0, np.pi, frame_count, dtype=np.float32)), 0.0, None) ** 2.4
    return (air * envelope[:, np.newaxis] * 0.22).astype(np.float32)


def _ring_out(texture: np.ndarray, pad: np.ndarray) -> np.ndarray:
    if texture.shape[0] == 0:
        return texture
    decay = np.exp(-np.linspace(0.0, 4.0, texture.shape[0], dtype=np.float32))[:, np.newaxis]
    return ((texture * 1.25 * decay) + (pad * 0.22)).astype(np.float32)


def _pulsed_swell(samples: np.ndarray, tempo_bpm: float, sample_rate: int) -> np.ndarray:
    pulsed = _rhythmic_gate(samples, tempo_bpm, sample_rate)
    if pulsed.shape[0] == 0:
        return pulsed
    lift = np.linspace(0.25, 1.0, pulsed.shape[0], dtype=np.float32)[:, np.newaxis]
    return (pulsed * lift).astype(np.float32)


def _hard_cut_marker(air: np.ndarray) -> np.ndarray:
    if air.shape[0] == 0:
        return air
    frame_count = air.shape[0]
    marker = air * 0.035
    click_frames = max(frame_count // 80, 16)
    marker[:click_frames] = air[:click_frames] * 0.16
    marker[-click_frames:] = air[-click_frames:] * 0.16
    return marker.astype(np.float32)


def _estimate_root_frequency(samples: np.ndarray, sample_rate: int) -> float:
    if samples.size == 0:
        return 110.0

    mono = samples.astype(np.float32, copy=False) if samples.ndim == 1 else np.mean(samples, axis=1)
    mono = mono[np.isfinite(mono)]
    if mono.size < sample_rate // 2 or np.max(np.abs(mono)) < EPSILON:
        return 110.0

    segment = mono[: min(mono.size, sample_rate * 8)]
    segment = segment - np.mean(segment)
    window = np.hanning(segment.size)
    spectrum = np.abs(np.fft.rfft(segment * window))
    freqs = np.fft.rfftfreq(segment.size, 1.0 / sample_rate)
    mask = (freqs >= 45.0) & (freqs <= 440.0)
    if not np.any(mask):
        return 110.0

    strongest = float(freqs[mask][np.argmax(spectrum[mask])])
    if not np.isfinite(strongest) or strongest <= 0:
        return 110.0

    return _fold_to_comfortable_octave(strongest)


def _estimate_transition_tempo(previous_track: np.ndarray, next_track: np.ndarray, sample_rate: int) -> float:
    candidates = [
        _estimate_tempo_bpm(previous_track[-sample_rate * 20 :], sample_rate),
        _estimate_tempo_bpm(next_track[: sample_rate * 20], sample_rate),
    ]
    usable = [value for value in candidates if value is not None]
    return float(np.median(usable)) if usable else 96.0


def _estimate_tempo_bpm(samples: np.ndarray, sample_rate: int) -> float | None:
    if samples.size == 0 or sample_rate <= 0:
        return None
    mono = np.mean(_fit_stereo(samples), axis=1)
    if mono.size < sample_rate or np.max(np.abs(mono)) < EPSILON:
        return None

    hop = max(int(sample_rate * 0.020), 1)
    frame = max(int(sample_rate * 0.060), hop)
    energies = []
    for start in range(0, max(mono.size - frame + 1, 1), hop):
        block = mono[start : start + frame]
        if block.size:
            energies.append(float(np.sqrt(np.mean(np.square(block)))))
    if len(energies) < 16:
        return None

    envelope = np.asarray(energies, dtype=np.float64)
    envelope = np.maximum(np.diff(envelope, prepend=envelope[0]), 0.0)
    envelope -= float(np.mean(envelope))
    if np.max(np.abs(envelope)) < EPSILON:
        return None

    corr = signal.correlate(envelope, envelope, mode="full", method="fft")[len(envelope) - 1 :]
    frame_rate = sample_rate / hop
    min_lag = max(int(frame_rate * 60.0 / 180.0), 1)
    max_lag = min(int(frame_rate * 60.0 / 48.0), corr.size - 1)
    if max_lag <= min_lag:
        return None
    lag = min_lag + int(np.argmax(corr[min_lag:max_lag]))
    bpm = 60.0 * frame_rate / lag
    return float(np.clip(bpm, 48.0, 180.0))


def _fold_to_comfortable_octave(frequency: float) -> float:
    while frequency < 82.41:
        frequency *= 2.0
    while frequency > 196.0:
        frequency /= 2.0
    return frequency


def _frequency_glide(start_hz: float, end_hz: float, frame_count: int) -> np.ndarray:
    start_hz = max(start_hz, 40.0)
    end_hz = max(end_hz, 40.0)
    progress = np.linspace(0.0, 1.0, frame_count, dtype=np.float32)
    eased = 0.5 - 0.5 * np.cos(np.pi * progress)
    return (start_hz * np.power(end_hz / start_hz, eased)).astype(np.float32)


def _harmonic_pad(frequency_curve: np.ndarray, sample_rate: int) -> np.ndarray:
    left = _oscillator(frequency_curve, sample_rate, 1.0)
    fifth = _oscillator(frequency_curve, sample_rate, 1.5)
    octave = _oscillator(frequency_curve, sample_rate, 2.0)
    shimmer = _oscillator(frequency_curve, sample_rate, 3.0)

    pad_left = (0.16 * left) + (0.07 * fifth) + (0.035 * octave)
    pad_right = (0.13 * left) + (0.09 * fifth) + (0.04 * shimmer)
    envelope = np.sin(np.linspace(0.0, np.pi, frequency_curve.size, dtype=np.float32))
    return np.column_stack([pad_left, pad_right]).astype(np.float32) * envelope[:, np.newaxis]


def _oscillator(frequency_curve: np.ndarray, sample_rate: int, multiplier: float) -> np.ndarray:
    phase = np.cumsum(frequency_curve.astype(np.float64) * float(multiplier)) * (2.0 * np.pi / sample_rate)
    return np.sin(phase).astype(np.float32)


def _transition_texture(
    previous_track: np.ndarray,
    next_track: np.ndarray,
    sample_rate: int,
    frame_count: int,
) -> np.ndarray:
    texture = np.zeros((frame_count, 2), dtype=np.float32)
    window = min(frame_count // 2, sample_rate * 5, previous_track.shape[0], next_track.shape[0])
    if window <= 0:
        return texture

    tail = _fit_stereo(previous_track[-window:])
    head = _fit_stereo(next_track[:window])
    tail = _soft_bandlimit(tail, sample_rate)
    head = _soft_bandlimit(head, sample_rate)

    tail_env = np.linspace(1.0, 0.0, window, dtype=np.float32) ** 1.7
    head_env = np.linspace(0.0, 1.0, window, dtype=np.float32) ** 1.7
    texture[:window] += tail * tail_env[:, np.newaxis] * 0.28
    texture[-window:] += head * head_env[:, np.newaxis] * 0.22
    return texture


def _soft_bandlimit(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    if samples.shape[0] < 256:
        return samples
    sos = signal.butter(2, [140.0, 4200.0], btype="bandpass", fs=sample_rate, output="sos")
    return signal.sosfiltfilt(sos, samples, axis=0).astype(np.float32)


def _tape_color(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    if samples.size == 0:
        return samples

    colored = np.tanh(samples * 1.35) / np.tanh(1.35)
    frame_count = samples.shape[0]
    wobble = 1.0 + (0.018 * np.sin(np.linspace(0.0, 2.0 * np.pi * 1.2, frame_count, dtype=np.float32)))
    colored = colored * wobble[:, np.newaxis]
    if frame_count > 256:
        sos = signal.butter(2, 6200.0, btype="lowpass", fs=sample_rate, output="sos")
        colored = signal.sosfiltfilt(sos, colored, axis=0)
    return colored.astype(np.float32)


def _reverse_swell(texture: np.ndarray) -> np.ndarray:
    frame_count = texture.shape[0]
    if frame_count == 0:
        return texture

    reversed_texture = texture[::-1]
    envelope = np.linspace(0.0, 1.0, frame_count, dtype=np.float32)
    envelope = np.clip(np.sin(envelope * np.pi), 0.0, None) ** 0.65
    return (reversed_texture * envelope[:, np.newaxis] * 1.25).astype(np.float32)


def _rhythmic_gate(
    samples: np.ndarray,
    tempo_bpm: float,
    sample_rate: int,
) -> np.ndarray:
    frame_count = samples.shape[0]
    if frame_count == 0:
        return samples

    beats_per_second = float(np.clip(tempo_bpm, 48.0, 180.0)) / 60.0
    phase = np.arange(frame_count, dtype=np.float32) / sample_rate
    pulse = 0.45 + (0.55 * np.maximum(0.0, np.sin(2.0 * np.pi * beats_per_second * phase)) ** 2.4)
    return (samples * pulse[:, np.newaxis]).astype(np.float32)


def _filtered_noise(frame_count: int, sample_rate: int, root_a: float, root_b: float) -> np.ndarray:
    seed_text = f"{root_a:.4f}:{root_b:.4f}:{frame_count}:{sample_rate}"
    seed = int(hashlib.sha256(seed_text.encode("utf-8")).hexdigest()[:8], 16)
    rng = np.random.default_rng(seed)
    noise = rng.normal(0.0, 0.035, (frame_count, 2)).astype(np.float32)
    sos = signal.butter(2, [400.0, 8500.0], btype="bandpass", fs=sample_rate, output="sos")
    filtered = signal.sosfiltfilt(sos, noise, axis=0).astype(np.float32)
    envelope = np.clip(
        np.sin(np.linspace(0.0, np.pi, frame_count, dtype=np.float32)),
        0.0,
        None,
    ) ** 1.4
    return filtered * envelope[:, np.newaxis]


def _fade(envelope: np.ndarray, sample_rate: int, seconds: float) -> np.ndarray:
    frames = min(envelope.size // 2, int(sample_rate * seconds))
    if frames <= 0:
        return envelope
    curve = 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, frames, dtype=np.float32))
    envelope[:frames] *= curve
    envelope[-frames:] *= curve[::-1]
    return envelope


def _fit_stereo(samples: np.ndarray) -> np.ndarray:
    if samples.ndim == 1:
        samples = samples[:, np.newaxis]
    if samples.shape[1] == 1:
        return np.repeat(samples, 2, axis=1).astype(np.float32)
    return samples[:, :2].astype(np.float32)
