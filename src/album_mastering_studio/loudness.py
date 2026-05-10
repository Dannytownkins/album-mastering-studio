from __future__ import annotations

import numpy as np
from scipy import signal

EPSILON = 1e-12


def integrated_lufs(samples: np.ndarray, sample_rate: int) -> float:
    weighted = k_weight(samples, sample_rate)
    if weighted.size == 0:
        return -120.0

    block_size = max(int(sample_rate * 0.400), 1)
    hop_size = max(int(sample_rate * 0.100), 1)
    energies = _block_energies(weighted, block_size, hop_size)
    if energies.size == 0:
        return -120.0

    loudness = _energy_to_lufs(energies)
    absolute = energies[loudness > -70.0]
    if absolute.size == 0:
        return -120.0

    preliminary = _energy_to_lufs(np.array([float(np.mean(absolute))]))[0]
    relative_threshold = preliminary - 10.0
    gated = energies[(_energy_to_lufs(energies) > relative_threshold) & (_energy_to_lufs(energies) > -70.0)]
    if gated.size == 0:
        return float(preliminary)

    return float(_energy_to_lufs(np.array([float(np.mean(gated))]))[0])


def true_peak_dbfs(samples: np.ndarray, oversample: int = 4) -> float:
    if samples.size == 0:
        return -240.0

    oversampled = signal.resample_poly(samples, oversample, 1, axis=0)
    peak = float(np.max(np.abs(oversampled)))
    return float(20.0 * np.log10(max(peak, EPSILON)))


def k_weight(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    if samples.ndim == 1:
        samples = samples[:, np.newaxis]
    samples = np.asarray(samples, dtype=np.float64)

    shelf_b, shelf_a = _high_shelf(sample_rate, frequency=1681.974450955533, gain_db=4.0, q=0.7071752369554196)
    shelved = signal.lfilter(shelf_b, shelf_a, samples, axis=0)

    sos = signal.butter(2, 38.13547087602444, btype="highpass", fs=sample_rate, output="sos")
    return signal.sosfilt(sos, shelved, axis=0)


def _block_energies(samples: np.ndarray, block_size: int, hop_size: int) -> np.ndarray:
    total_frames = samples.shape[0]
    if total_frames == 0:
        return np.array([], dtype=np.float64)

    starts = list(range(0, max(total_frames - block_size + 1, 1), hop_size))
    if not starts:
        starts = [0]

    energies = []
    weights = np.ones(samples.shape[1], dtype=np.float64)
    if weights.size > 2:
        weights[2:] = 1.41

    for start in starts:
        block = samples[start : min(start + block_size, total_frames)]
        if block.size == 0:
            continue
        channel_energy = np.mean(np.square(block), axis=0)
        energies.append(float(np.sum(channel_energy * weights[: channel_energy.size])))

    return np.asarray(energies, dtype=np.float64)


def _energy_to_lufs(energies: np.ndarray) -> np.ndarray:
    return -0.691 + (10.0 * np.log10(np.maximum(energies, EPSILON)))


def _high_shelf(sample_rate: int, frequency: float, gain_db: float, q: float) -> tuple[np.ndarray, np.ndarray]:
    amplitude = 10.0 ** (gain_db / 40.0)
    omega = 2.0 * np.pi * frequency / sample_rate
    alpha = np.sin(omega) / (2.0 * q)
    cos_omega = np.cos(omega)
    root_amplitude = np.sqrt(amplitude)

    b0 = amplitude * ((amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) + (2.0 * root_amplitude * alpha))
    b1 = -2.0 * amplitude * ((amplitude - 1.0) + ((amplitude + 1.0) * cos_omega))
    b2 = amplitude * ((amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) - (2.0 * root_amplitude * alpha))
    a0 = (amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) + (2.0 * root_amplitude * alpha)
    a1 = 2.0 * ((amplitude - 1.0) - ((amplitude + 1.0) * cos_omega))
    a2 = (amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) - (2.0 * root_amplitude * alpha)

    return np.array([b0, b1, b2], dtype=np.float64) / a0, np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64)
