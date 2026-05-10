from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

from .loudness import integrated_lufs, true_peak_dbfs

EPSILON = 1e-12


@dataclass(frozen=True)
class AudioStats:
    duration_seconds: float
    peak_dbfs: float
    true_peak_dbfs: float
    rms_dbfs: float
    integrated_lufs: float
    crest_factor_db: float
    dynamic_range_db: float
    stereo_correlation: float | None
    stereo_width: float
    spectral_centroid_hz: float
    spectral_balance: dict[str, float]
    transient_density: float
    energy_density: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def amplitude_to_db(value: float | np.ndarray) -> float | np.ndarray:
    return 20.0 * np.log10(np.maximum(np.asarray(value), EPSILON))


def db_to_amplitude(db: float | np.ndarray) -> float | np.ndarray:
    return np.power(10.0, np.asarray(db) / 20.0)


def analyze_audio(samples: np.ndarray, sample_rate: int) -> AudioStats:
    if samples.ndim == 1:
        samples = samples[:, np.newaxis]

    duration = float(samples.shape[0] / sample_rate) if sample_rate else 0.0
    mono = np.mean(samples, axis=1) if samples.size else np.array([], dtype=np.float32)

    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    rms = float(np.sqrt(np.mean(np.square(samples)))) if samples.size else 0.0
    peak_db = float(amplitude_to_db(peak))
    rms_db = float(amplitude_to_db(rms))

    correlation: float | None = None
    if samples.ndim == 2 and samples.shape[1] >= 2 and samples.shape[0] > 2:
        left = samples[:, 0]
        right = samples[:, 1]
        if np.std(left) > EPSILON and np.std(right) > EPSILON:
            correlation = float(np.corrcoef(left, right)[0, 1])

    lufs = integrated_lufs(samples, sample_rate)
    true_peak = true_peak_dbfs(samples)
    spectral_centroid = _spectral_centroid(mono, sample_rate)
    spectral_balance = _spectral_balance(mono, sample_rate)
    transient_density = _transient_density(mono, sample_rate)

    return AudioStats(
        duration_seconds=duration,
        peak_dbfs=peak_db,
        true_peak_dbfs=true_peak,
        rms_dbfs=rms_db,
        integrated_lufs=lufs,
        crest_factor_db=peak_db - rms_db,
        dynamic_range_db=_dynamic_range(mono, sample_rate),
        stereo_correlation=correlation,
        stereo_width=_stereo_width_score(samples),
        spectral_centroid_hz=spectral_centroid,
        spectral_balance=spectral_balance,
        transient_density=transient_density,
        energy_density=_energy_density(lufs, spectral_centroid, peak_db - rms_db, transient_density),
    )


def _spectral_centroid(mono: np.ndarray, sample_rate: int) -> float:
    if mono.size == 0:
        return 0.0

    max_samples = min(mono.size, sample_rate * 30)
    segment = mono[:max_samples].astype(np.float64)
    if np.max(np.abs(segment)) < EPSILON:
        return 0.0

    window = np.hanning(segment.size)
    magnitudes = np.abs(np.fft.rfft(segment * window))
    if np.sum(magnitudes) < EPSILON:
        return 0.0

    frequencies = np.fft.rfftfreq(segment.size, 1.0 / sample_rate)
    return float(np.sum(frequencies * magnitudes) / np.sum(magnitudes))


def _spectral_balance(mono: np.ndarray, sample_rate: int) -> dict[str, float]:
    empty = {
        "sub": 0.0,
        "low": 0.0,
        "low_mid": 0.0,
        "mid": 0.0,
        "presence": 0.0,
        "air": 0.0,
    }
    if mono.size == 0 or sample_rate <= 0:
        return empty

    max_samples = min(mono.size, sample_rate * 30)
    segment = mono[:max_samples].astype(np.float64)
    if np.max(np.abs(segment)) < EPSILON:
        return empty

    window = np.hanning(segment.size)
    spectrum = np.square(np.abs(np.fft.rfft(segment * window)))
    freqs = np.fft.rfftfreq(segment.size, 1.0 / sample_rate)
    total = float(np.sum(spectrum))
    if total < EPSILON:
        return empty

    bands = {
        "sub": (20.0, 80.0),
        "low": (80.0, 250.0),
        "low_mid": (250.0, 800.0),
        "mid": (800.0, 2500.0),
        "presence": (2500.0, 6500.0),
        "air": (6500.0, min(sample_rate / 2.0, 16000.0)),
    }
    return {
        name: round(float(np.sum(spectrum[(freqs >= low) & (freqs < high)]) / total), 5)
        for name, (low, high) in bands.items()
    }


def _dynamic_range(mono: np.ndarray, sample_rate: int) -> float:
    if mono.size == 0 or sample_rate <= 0:
        return 0.0

    window = max(int(sample_rate * 0.100), 1)
    hop = max(int(sample_rate * 0.050), 1)
    values = []
    for start in range(0, max(mono.size - window + 1, 1), hop):
        block = mono[start : min(start + window, mono.size)]
        if block.size:
            values.append(float(np.sqrt(np.mean(np.square(block)))))
    if not values:
        return 0.0

    db_values = amplitude_to_db(np.asarray(values, dtype=np.float64))
    return round(float(np.percentile(db_values, 95) - np.percentile(db_values, 10)), 4)


def _stereo_width_score(samples: np.ndarray) -> float:
    if samples.ndim != 2 or samples.shape[1] < 2 or samples.shape[0] == 0:
        return 0.0

    left = samples[:, 0].astype(np.float64)
    right = samples[:, 1].astype(np.float64)
    mid = (left + right) * 0.5
    side = (left - right) * 0.5
    mid_rms = float(np.sqrt(np.mean(np.square(mid))))
    side_rms = float(np.sqrt(np.mean(np.square(side))))
    return round(float(np.clip(side_rms / max(mid_rms, EPSILON), 0.0, 2.0)), 5)


def _transient_density(mono: np.ndarray, sample_rate: int) -> float:
    if mono.size == 0 or sample_rate <= 0:
        return 0.0

    window = max(int(sample_rate * 0.040), 1)
    hop = max(int(sample_rate * 0.010), 1)
    energies = []
    for start in range(0, max(mono.size - window + 1, 1), hop):
        block = mono[start : min(start + window, mono.size)]
        if block.size:
            energies.append(float(np.sqrt(np.mean(np.square(block)))))
    if len(energies) < 3:
        return 0.0

    energy = np.asarray(energies, dtype=np.float64)
    positive_flux = np.maximum(np.diff(energy), 0.0)
    density = float(np.mean(positive_flux) / max(np.mean(energy), EPSILON))
    return round(float(np.clip(density * 6.5, 0.0, 1.0)), 5)


def _energy_density(lufs: float, spectral_centroid: float, crest_factor: float, transient_density: float) -> float:
    loudness = max(min((lufs + 30.0) / 20.0, 1.0), 0.0)
    brightness = max(min(spectral_centroid / 5200.0, 1.0), 0.0)
    density = 1.0 - max(min((crest_factor - 5.0) / 13.0, 1.0), 0.0)
    transient = max(min(transient_density, 1.0), 0.0)
    return round(float((loudness * 0.44) + (brightness * 0.21) + (density * 0.23) + (transient * 0.12)), 5)
