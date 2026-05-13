from __future__ import annotations

from dataclasses import asdict, dataclass
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np
from scipy import ndimage, signal

from .analysis import AudioStats, analyze_audio, db_to_amplitude
from .loudness import integrated_lufs, true_peak_dbfs

EPSILON = 1e-12
TONE_LOW_SHELF_HZ = 105.0
TONE_PRESENCE_HZ = 3200.0
TONE_PRESENCE_Q = 0.90
TONE_AIR_HZ = 9800.0
TONE_AIR_Q = 0.65
COMPRESSOR_ATTACK_SECONDS = 0.015
COMPRESSOR_RELEASE_SECONDS = 0.180
INTENSITY_THRESHOLD_SCALE_DB = 3.0
INTENSITY_RATIO_SCALE = 0.22
PREVIEW_WIDTH_BASE = 1.0
PREVIEW_WIDTH_SCALE = 1.8
PREVIEW_WIDTH_MIN = 0.35
PREVIEW_WIDTH_MAX = 1.65
PREVIEW_SMOOTHING_SECONDS = 0.015


@dataclass(frozen=True)
class MasterPreset:
    name: str
    display_name: str
    description: str
    target_lufs: float
    ceiling_dbfs: float
    compressor_threshold_dbfs: float
    compressor_ratio: float
    highpass_hz: float
    warmth: float
    low_shelf_db: float = 0.0
    low_mid_db: float = 0.0
    presence_db: float = 0.0
    air_db: float = 0.0
    stereo_width: float = 1.0
    transient_punch: float = 0.0
    interlude_bias: str = "ambient"
    science_note: str = ""

    def to_dict(self) -> dict[str, float | str]:
        return asdict(self)


@dataclass(frozen=True)
class MasterResult:
    samples: np.ndarray
    before: AudioStats
    after: AudioStats
    applied_gain_db: float
    preset: MasterPreset
    ceiling_dbfs: float
    target_lufs: float


@dataclass(frozen=True)
class LivePreviewModelResult:
    samples: np.ndarray
    model_id: str
    preview_parity: str
    export_faithful_preview_required: bool
    modeled_controls: tuple[str, ...]
    modeled_width: float
    modeled_drive: float
    tuning: dict[str, float]
    normalized_tuning: dict[str, float]


@dataclass(frozen=True)
class FineTune:
    lufs_offset: float = 0.0
    ceiling_dbfs: float | None = None
    brightness_db_offset: float = 0.0
    warmth_offset: float = 0.0
    low_end_db_offset: float = 0.0
    low_mid_db_offset: float = 0.0
    air_db_offset: float = 0.0
    presence_db_offset: float = 0.0
    width_offset: float = 0.0
    intensity_offset: float = 0.0
    limiter_aggressiveness_offset: float = 0.0


PRESETS: dict[str, MasterPreset] = {
    "streaming": MasterPreset(
        name="streaming",
        display_name="Streaming / Transparent",
        description="Balanced, modern translation with restrained color and clean headroom.",
        target_lufs=-14.0,
        ceiling_dbfs=-1.0,
        compressor_threshold_dbfs=-18.0,
        compressor_ratio=2.0,
        highpass_hz=28.0,
        warmth=0.03,
        air_db=0.8,
        stereo_width=1.04,
        transient_punch=0.04,
        interlude_bias="ambient",
        science_note="LUFS-aligned with conservative ceiling and light program compression.",
    ),
    "acoustic-natural": MasterPreset(
        name="acoustic-natural",
        display_name="Acoustic / Natural",
        description="Open, breathable mastering for intimate performances and wood/string detail.",
        target_lufs=-16.2,
        ceiling_dbfs=-1.5,
        compressor_threshold_dbfs=-21.5,
        compressor_ratio=1.45,
        highpass_hz=24.0,
        warmth=0.035,
        low_shelf_db=0.7,
        low_mid_db=0.2,
        presence_db=-0.4,
        air_db=0.45,
        stereo_width=1.02,
        transient_punch=-0.04,
        interlude_bias="minimal",
        science_note="Lower target loudness and gentle compression preserve transient nuance and room tone.",
    ),
    "heavy-rock-metal": MasterPreset(
        name="heavy-rock-metal",
        display_name="Heavy Rock / Metal",
        description="Forward guitars, controlled low mids, and enough density for heavy arrangements.",
        target_lufs=-12.0,
        ceiling_dbfs=-0.9,
        compressor_threshold_dbfs=-20.5,
        compressor_ratio=2.85,
        highpass_hz=32.0,
        warmth=0.045,
        low_shelf_db=0.6,
        low_mid_db=-1.25,
        presence_db=1.1,
        air_db=0.85,
        stereo_width=1.07,
        transient_punch=0.08,
        interlude_bias="rhythmic",
        science_note="Low-mid cleanup, assertive density, and presence support distorted guitars without burying drums.",
    ),
    "djent-modern-metal": MasterPreset(
        name="djent-modern-metal",
        display_name="Djent / Modern Metal",
        description="Tight low end, sharp pick definition, and modern limiter pressure.",
        target_lufs=-10.9,
        ceiling_dbfs=-0.8,
        compressor_threshold_dbfs=-22.5,
        compressor_ratio=3.35,
        highpass_hz=36.0,
        warmth=0.035,
        low_shelf_db=1.0,
        low_mid_db=-1.9,
        presence_db=1.8,
        air_db=1.2,
        stereo_width=1.08,
        transient_punch=0.14,
        interlude_bias="rhythmic",
        science_note="Aggressive low-mid discipline and transient emphasis keep palm-muted riffs clear and compact.",
    ),
    "warm-glue": MasterPreset(
        name="warm-glue",
        display_name="Warm Glue",
        description="Cohesive warmth, softened edges, and restrained top end.",
        target_lufs=-13.8,
        ceiling_dbfs=-1.1,
        compressor_threshold_dbfs=-20.5,
        compressor_ratio=2.25,
        highpass_hz=26.0,
        warmth=0.095,
        low_shelf_db=1.2,
        low_mid_db=0.25,
        presence_db=-0.65,
        air_db=-0.15,
        stereo_width=0.98,
        transient_punch=-0.03,
        interlude_bias="tape",
        science_note="Extra saturation and slightly narrowed image make varied songs feel like the same record.",
    ),
    "bright-air": MasterPreset(
        name="bright-air",
        display_name="Bright / Air",
        description="Lifted top, clean edges, and wider image without maximum loudness.",
        target_lufs=-13.4,
        ceiling_dbfs=-1.0,
        compressor_threshold_dbfs=-18.7,
        compressor_ratio=2.0,
        highpass_hz=30.0,
        warmth=0.025,
        low_shelf_db=-0.2,
        low_mid_db=-0.7,
        presence_db=0.9,
        air_db=2.2,
        stereo_width=1.12,
        transient_punch=0.05,
        interlude_bias="ambient",
        science_note="Presence and air shelves reveal detail while moderate compression avoids brittle over-density.",
    ),
    "dark-smooth": MasterPreset(
        name="dark-smooth",
        display_name="Dark / Smooth",
        description="Darker top, rounded presence, and calm density for less-fatiguing masters.",
        target_lufs=-14.7,
        ceiling_dbfs=-1.2,
        compressor_threshold_dbfs=-20.0,
        compressor_ratio=1.9,
        highpass_hz=24.0,
        warmth=0.075,
        low_shelf_db=0.8,
        low_mid_db=0.1,
        presence_db=-1.2,
        air_db=-0.9,
        stereo_width=0.97,
        transient_punch=-0.05,
        interlude_bias="tape",
        science_note="Reduced presence and air tame edge while light saturation keeps the master from feeling dull.",
    ),
    "loud-aggressive": MasterPreset(
        name="loud-aggressive",
        display_name="Loud / Aggressive",
        description="Dense, forward, and intentionally assertive with ceiling protection.",
        target_lufs=-10.4,
        ceiling_dbfs=-0.8,
        compressor_threshold_dbfs=-23.0,
        compressor_ratio=3.8,
        highpass_hz=34.0,
        warmth=0.055,
        low_shelf_db=0.4,
        low_mid_db=-1.5,
        presence_db=1.7,
        air_db=1.35,
        stereo_width=1.08,
        transient_punch=0.12,
        interlude_bias="rhythmic",
        science_note="Stronger compression and transient shaping increase urgency while limiter headroom remains explicit.",
    ),
    "album-cohesion-cinematic": MasterPreset(
        name="album-cohesion-cinematic",
        display_name="Album Cohesion / Cinematic",
        description="Polished album glue with dimensional width and planned emotional movement.",
        target_lufs=-13.1,
        ceiling_dbfs=-1.0,
        compressor_threshold_dbfs=-19.2,
        compressor_ratio=2.15,
        highpass_hz=26.0,
        warmth=0.07,
        low_shelf_db=0.9,
        low_mid_db=-0.65,
        presence_db=-0.15,
        air_db=1.35,
        stereo_width=1.13,
        transient_punch=0.03,
        interlude_bias="swell",
        science_note="Moderate loudness, wide image, and controlled low mids favor whole-album continuity over singles loudness.",
    ),
    "gentle": MasterPreset(
        name="gentle",
        display_name="Soft Master",
        description="Open and low-pressure master for intimate or dynamic material.",
        target_lufs=-16.0,
        ceiling_dbfs=-1.5,
        compressor_threshold_dbfs=-20.0,
        compressor_ratio=1.5,
        highpass_hz=24.0,
        warmth=0.015,
        low_shelf_db=0.5,
        air_db=0.4,
        stereo_width=1.02,
        transient_punch=-0.02,
        interlude_bias="minimal",
        science_note="Preserves crest factor and avoids forcing quieter performances upward.",
    ),
    "loud": MasterPreset(
        name="loud",
        display_name="Forward Loud",
        description="Dense, assertive, and still ceiling-aware.",
        target_lufs=-11.5,
        ceiling_dbfs=-0.8,
        compressor_threshold_dbfs=-20.0,
        compressor_ratio=3.0,
        highpass_hz=30.0,
        warmth=0.05,
        low_mid_db=-0.9,
        presence_db=1.2,
        air_db=1.0,
        stereo_width=1.06,
        transient_punch=0.09,
        interlude_bias="rhythmic",
        science_note="Higher density through stronger compression, low-mid cleanup, and presence lift.",
    ),
    "3am-kitchen-floor": MasterPreset(
        name="3am-kitchen-floor",
        display_name="3am Kitchen Floor",
        description="Warm, close, slightly worn, like a private record playing after everyone left.",
        target_lufs=-15.2,
        ceiling_dbfs=-1.4,
        compressor_threshold_dbfs=-22.0,
        compressor_ratio=1.65,
        highpass_hz=22.0,
        warmth=0.11,
        low_shelf_db=1.8,
        low_mid_db=0.7,
        presence_db=-1.4,
        air_db=-0.7,
        stereo_width=0.93,
        transient_punch=-0.08,
        interlude_bias="tape",
        science_note="Warmer shelf, softened presence, narrower image, lower target loudness, and gentler compression for late-night intimacy.",
    ),
    "radio-brittle": MasterPreset(
        name="radio-brittle",
        display_name="Radio Brittle",
        description="Bright, urgent, hard-edged, and a little over-caffeinated on purpose.",
        target_lufs=-10.8,
        ceiling_dbfs=-0.7,
        compressor_threshold_dbfs=-24.0,
        compressor_ratio=3.8,
        highpass_hz=38.0,
        warmth=0.025,
        low_shelf_db=-1.8,
        low_mid_db=-2.2,
        presence_db=3.2,
        air_db=2.4,
        stereo_width=1.13,
        transient_punch=0.15,
        interlude_bias="rhythmic",
        science_note="Lean low end, aggressive presence/air lift, stronger density, and wider sides for a sharp broadcast-forward identity.",
    ),
    "velvet-museum": MasterPreset(
        name="velvet-museum",
        display_name="Velvet Museum",
        description="Expensive, dimensional, polished, and dark around the edges.",
        target_lufs=-13.2,
        ceiling_dbfs=-1.0,
        compressor_threshold_dbfs=-19.0,
        compressor_ratio=2.2,
        highpass_hz=26.0,
        warmth=0.07,
        low_shelf_db=1.0,
        low_mid_db=-0.8,
        presence_db=-0.3,
        air_db=1.6,
        stereo_width=1.16,
        transient_punch=0.02,
        interlude_bias="swell",
        science_note="Low-end weight, low-mid discipline, controlled presence, wide image, and refined top for cinematic polish.",
    ),
}


def live_preview_contract() -> dict:
    """Return the engine-owned contract for the temporary Web Audio audition model."""
    streaming = PRESETS["streaming"]
    return {
        "modelId": "web-audio-first-control-model",
        "previewParity": "approximate",
        "exportFaithfulPreviewRequired": True,
        "modeledControls": ["Low", "Mid", "High", "Width", "Intensity"],
        "filters": {
            "low": {
                "type": "lowshelf",
                "exportControl": "tweak_low_end_db",
                "frequencyHz": TONE_LOW_SHELF_HZ,
            },
            "mid": {
                "type": "peaking",
                "exportControl": "tweak_presence_db",
                "frequencyHz": TONE_PRESENCE_HZ,
                "q": TONE_PRESENCE_Q,
            },
            "high": {
                "type": "highshelf",
                "exportControl": "tweak_air_db",
                "frequencyHz": TONE_AIR_HZ,
            },
        },
        "width": {
            "exportControl": "tweak_width",
            "base": PREVIEW_WIDTH_BASE,
            "scale": PREVIEW_WIDTH_SCALE,
            "min": PREVIEW_WIDTH_MIN,
            "max": PREVIEW_WIDTH_MAX,
        },
        "compressor": {
            "exportControl": "tweak_intensity",
            "attackSeconds": COMPRESSOR_ATTACK_SECONDS,
            "releaseSeconds": COMPRESSOR_RELEASE_SECONDS,
            "thresholdBaseDbfs": streaming.compressor_threshold_dbfs,
            "thresholdDriveScaleDb": INTENSITY_THRESHOLD_SCALE_DB,
            "ratioBase": streaming.compressor_ratio,
            "ratioDriveScale": streaming.compressor_ratio * INTENSITY_RATIO_SCALE,
            "kneeDb": 0,
        },
        "smoothingSeconds": PREVIEW_SMOOTHING_SECONDS,
        "unmodeledExportStages": [
            "preset_base_tone",
            "highpass",
            "low_mid_eq",
            "brightness_tilt",
            "warmth_saturation",
            "transient_shape",
            "lufs_match",
            "ceiling_limiter",
            "codec_qc",
        ],
    }


def render_live_preview_model(
    samples: np.ndarray,
    sample_rate: int,
    tuning: dict | None = None,
) -> LivePreviewModelResult:
    """Render the deterministic engine-owned reference for the temporary Live Preview path."""
    contract = live_preview_contract()
    input_tuning = _preview_input_tuning(tuning or {})
    normalized_tuning = {
        "bassDb": _preview_tuning_value(input_tuning, "bassDb", "lowDb", "lowEndDb", "low_end_db", "tweak_low_end_db"),
        "midDb": _preview_tuning_value(input_tuning, "midDb", "presenceDb", "presence_db", "tweak_presence_db"),
        "highDb": _preview_tuning_value(input_tuning, "highDb", "airDb", "air_db", "tweak_air_db"),
        "width": _preview_tuning_value(input_tuning, "width", "widthOffset", "tweak_width"),
        "intensity": _preview_tuning_value(input_tuning, "intensity", "compression", "compressionOffset", "tweak_intensity"),
    }

    modeled = _preview_stereo_float(samples)
    for design in (
        _preview_shelf("low", normalized_tuning["bassDb"], contract["filters"]["low"]["frequencyHz"], sample_rate),
        _peaking_eq(
            sample_rate,
            contract["filters"]["mid"]["frequencyHz"],
            normalized_tuning["midDb"],
            contract["filters"]["mid"]["q"],
        ),
        _preview_shelf("high", normalized_tuning["highDb"], contract["filters"]["high"]["frequencyHz"], sample_rate),
    ):
        if design is not None:
            modeled = _apply_preview_biquad(modeled, design[0], design[1])

    modeled, modeled_width = _apply_live_preview_width(modeled, normalized_tuning["width"], contract["width"])
    modeled, modeled_drive = _apply_live_preview_compressor(
        modeled,
        normalized_tuning["intensity"],
        contract["compressor"],
    )
    modeled = np.nan_to_num(np.clip(modeled, -1.0, 1.0), nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)
    return LivePreviewModelResult(
        samples=modeled,
        model_id=contract["modelId"],
        preview_parity=contract["previewParity"],
        export_faithful_preview_required=bool(contract["exportFaithfulPreviewRequired"]),
        modeled_controls=tuple(contract["modeledControls"]),
        modeled_width=modeled_width,
        modeled_drive=modeled_drive,
        tuning=input_tuning,
        normalized_tuning=normalized_tuning,
    )


def master_track(
    samples: np.ndarray,
    sample_rate: int,
    preset_name: str,
    target_lufs: float | None = None,
    fine_tune: FineTune | None = None,
) -> MasterResult:
    if preset_name not in PRESETS:
        choices = ", ".join(sorted(PRESETS))
        raise ValueError(f"Unknown preset '{preset_name}'. Choose one of: {choices}")

    preset = PRESETS[preset_name]
    fine_tune = fine_tune or FineTune()
    intensity = float(np.clip(fine_tune.intensity_offset, -1.0, 1.0))
    limiter_aggressiveness = float(np.clip(fine_tune.limiter_aggressiveness_offset, -1.0, 1.0))
    ceiling_dbfs = (
        float(fine_tune.ceiling_dbfs)
        if fine_tune.ceiling_dbfs is not None
        else preset.ceiling_dbfs
    )
    ceiling_dbfs -= max(limiter_aggressiveness, 0.0) * 0.25
    brightness = float(np.clip(fine_tune.brightness_db_offset, -4.0, 4.0))
    before = analyze_audio(samples, sample_rate)

    processed = samples.astype(np.float32, copy=True)
    processed = _remove_dc(processed)
    processed = _highpass(processed, sample_rate, preset.highpass_hz)
    processed = _rust_eq(
        processed,
        sample_rate,
        low_db=preset.low_shelf_db + fine_tune.low_end_db_offset - (brightness * 0.12),
        mid_db=(
            preset.low_mid_db
            + fine_tune.low_mid_db_offset
            + preset.presence_db
            + fine_tune.presence_db_offset
            + (brightness * 0.48)
        ),
        high_db=preset.air_db + fine_tune.air_db_offset + (brightness * 0.82),
    )
    processed = _linked_compressor(
        processed,
        sample_rate=sample_rate,
        threshold_dbfs=preset.compressor_threshold_dbfs
        - (intensity * INTENSITY_THRESHOLD_SCALE_DB)
        - (max(limiter_aggressiveness, 0.0) * 0.75),
        ratio=max(
            1.05,
            preset.compressor_ratio
            * (1.0 + (intensity * INTENSITY_RATIO_SCALE) + (max(limiter_aggressiveness, 0.0) * 0.05)),
        ),
    )
    processed = _transient_shape(processed, sample_rate, preset.transient_punch + (intensity * 0.055))
    processed = _saturate(processed, max(preset.warmth + fine_tune.warmth_offset + max(intensity, 0.0) * 0.015, 0.0))
    processed = _stereo_width(processed, max(preset.stereo_width + fine_tune.width_offset, 0.15))
    processed, gain_db = _match_lufs(
        processed,
        sample_rate,
        (target_lufs if target_lufs is not None else preset.target_lufs) + fine_tune.lufs_offset,
    )
    resolved_target_lufs = (target_lufs if target_lufs is not None else preset.target_lufs) + fine_tune.lufs_offset
    processed = limit_ceiling(processed, ceiling_dbfs, sample_rate=sample_rate)

    return MasterResult(
        samples=processed.astype(np.float32),
        before=before,
        after=analyze_audio(processed, sample_rate),
        applied_gain_db=gain_db,
        preset=preset,
        ceiling_dbfs=ceiling_dbfs,
        target_lufs=resolved_target_lufs,
    )


def prepare_interlude_level(
    samples: np.ndarray,
    sample_rate: int,
    target_lufs: float = -23.0,
    ceiling_dbfs: float = -1.0,
) -> np.ndarray:
    matched, _ = _match_lufs(samples, sample_rate, target_lufs)
    return limit_ceiling(matched, ceiling_dbfs, sample_rate=sample_rate).astype(np.float32)


def apply_edge_treatment(
    samples: np.ndarray,
    sample_rate: int,
    head_treatment: dict | None = None,
    tail_treatment: dict | None = None,
) -> np.ndarray:
    processed = samples.astype(np.float32, copy=True)
    total_frames = processed.shape[0]
    if head_treatment and tail_treatment and total_frames > 0:
        head_frames = min(int(sample_rate * max(float(head_treatment.get("seconds", 0.0)), 0.0)), total_frames)
        tail_frames = min(int(sample_rate * max(float(tail_treatment.get("seconds", 0.0)), 0.0)), total_frames)
        if head_frames + tail_frames > total_frames:
            scale = max((total_frames - 1) / max(head_frames + tail_frames, 1), 0.0)
            head_treatment = {**head_treatment, "seconds": (head_frames * scale) / sample_rate}
            tail_treatment = {**tail_treatment, "seconds": (tail_frames * scale) / sample_rate}
    if head_treatment:
        processed = _apply_edge_segment(processed, sample_rate, head_treatment, is_head=True)
    if tail_treatment:
        processed = _apply_edge_segment(processed, sample_rate, tail_treatment, is_head=False)
    return processed.astype(np.float32)


def limit_ceiling(samples: np.ndarray, ceiling_dbfs: float, sample_rate: int = 48_000) -> np.ndarray:
    ceiling = float(db_to_amplitude(ceiling_dbfs))
    if ceiling <= 0 or samples.size == 0:
        return np.zeros_like(samples, dtype=np.float32)

    audio = samples.astype(np.float64, copy=False)
    was_mono = audio.ndim == 1
    if was_mono:
        audio = audio[:, np.newaxis]

    oversample = 4
    guard = float(db_to_amplitude(-0.05))
    ceiling *= guard
    oversampled = signal.resample_poly(audio, oversample, 1, axis=0)
    detector = np.max(np.abs(oversampled), axis=1)
    lookahead = max(int(sample_rate * oversample * 0.004), 3)
    if lookahead % 2 == 0:
        lookahead += 1
    future_peak = ndimage.maximum_filter1d(
        detector,
        size=lookahead,
        mode="nearest",
        origin=-(lookahead // 2),
    )
    gain = np.minimum(1.0, ceiling / np.maximum(future_peak, EPSILON))

    release = max(int(sample_rate * oversample * 0.045), 3)
    if release % 2 == 0:
        release += 1
    gain = ndimage.minimum_filter1d(
        gain,
        size=release,
        mode="nearest",
        origin=release // 2,
    )

    limited_os = oversampled * gain[:, np.newaxis]
    limited = signal.resample_poly(limited_os, 1, oversample, axis=0)[: audio.shape[0]]
    sample_peak = float(np.max(np.abs(limited))) if limited.size else 0.0
    if sample_peak > ceiling:
        local_peak = np.max(np.abs(limited), axis=1)
        over = local_peak > ceiling
        limited[over] *= (ceiling / np.maximum(local_peak[over], EPSILON))[:, np.newaxis]
    if was_mono:
        limited = limited[:, 0]
    return limited.astype(np.float32)


def _apply_edge_segment(
    samples: np.ndarray,
    sample_rate: int,
    treatment: dict,
    is_head: bool,
) -> np.ndarray:
    seconds = max(float(treatment.get("seconds", 0.0)), 0.0)
    frames = min(int(sample_rate * seconds), samples.shape[0])
    if frames <= 8:
        return samples

    output = samples.copy()
    segment = output[:frames] if is_head else output[-frames:]
    wet = _rust_eq(
        segment,
        sample_rate,
        low_db=float(treatment.get("low_shelf_db", 0.0)),
        mid_db=float(treatment.get("low_mid_db", 0.0)) + float(treatment.get("presence_db", 0.0)),
        high_db=float(treatment.get("air_db", 0.0)),
    )
    wet = _stereo_width(wet, max(float(treatment.get("width", 1.0)), 0.15))
    wet = _saturate(wet, max(float(treatment.get("warmth", 0.0)), 0.0))
    gain = float(db_to_amplitude(float(treatment.get("gain_db", 0.0))))
    wet = wet * gain

    if is_head:
        envelope = np.linspace(1.0, 0.0, frames, dtype=np.float32)
    else:
        envelope = np.linspace(0.0, 1.0, frames, dtype=np.float32)
    envelope = 0.5 - (0.5 * np.cos(np.pi * envelope))
    blended = (segment * (1.0 - envelope[:, np.newaxis])) + (wet * envelope[:, np.newaxis])

    if is_head:
        output[:frames] = blended
    else:
        output[-frames:] = blended
    return output.astype(np.float32)


def _remove_dc(samples: np.ndarray) -> np.ndarray:
    if samples.size == 0:
        return samples
    return samples - np.mean(samples, axis=0, keepdims=True)


def _highpass(samples: np.ndarray, sample_rate: int, cutoff_hz: float) -> np.ndarray:
    if samples.shape[0] < sample_rate // 4:
        return samples
    sos = signal.butter(2, cutoff_hz, btype="highpass", fs=sample_rate, output="sos")
    return signal.sosfiltfilt(sos, samples, axis=0).astype(np.float32)


def _rust_eq(
    samples: np.ndarray,
    sample_rate: int,
    low_db: float,
    mid_db: float,
    high_db: float,
) -> np.ndarray:
    if samples.size == 0:
        return samples.astype(np.float32)
    if max(abs(low_db), abs(mid_db), abs(high_db)) < EPSILON:
        return samples.astype(np.float32)

    stereo = np.asarray(samples, dtype=np.float32)
    if stereo.ndim == 1:
        stereo = stereo[:, np.newaxis]
    if stereo.shape[1] == 1:
        stereo = np.repeat(stereo, 2, axis=1)
    elif stereo.shape[1] > 2:
        stereo = stereo[:, :2]
    stereo = np.ascontiguousarray(stereo, dtype=np.float32)

    with tempfile.TemporaryDirectory(prefix="album-master-rust-eq-") as tmpdir:
        input_path = Path(tmpdir) / "input.raw"
        output_path = Path(tmpdir) / "output.raw"
        stereo.tofile(input_path)
        command = _rust_eq_command()
        subprocess.run(
            [
                *command,
                str(input_path),
                str(output_path),
                str(int(sample_rate)),
                str(float(low_db)),
                str(float(mid_db)),
                str(float(high_db)),
            ],
            check=True,
            text=True,
            capture_output=True,
        )
        processed = np.fromfile(output_path, dtype=np.float32).reshape((-1, 2))
    return processed.astype(np.float32)


def _linked_compressor(
    samples: np.ndarray,
    sample_rate: int,
    threshold_dbfs: float,
    ratio: float,
) -> np.ndarray:
    if samples.size == 0:
        return samples

    detector = np.max(np.abs(samples), axis=1).astype(np.float64)
    attack = float(np.exp(-1.0 / (COMPRESSOR_ATTACK_SECONDS * sample_rate)))
    release = float(np.exp(-1.0 / (COMPRESSOR_RELEASE_SECONDS * sample_rate)))
    attacked = signal.lfilter([1.0 - attack], [1.0, -attack], detector).astype(np.float64)
    envelope = signal.lfilter([1.0 - release], [1.0, -release], attacked).astype(np.float64)

    envelope_db = 20.0 * np.log10(np.maximum(envelope, EPSILON))
    over_db = np.maximum(envelope_db - threshold_dbfs, 0.0)
    reduction_db = -over_db * (1.0 - (1.0 / ratio))
    gain = db_to_amplitude(reduction_db).astype(np.float32)
    return samples * gain[:, np.newaxis]


def _transient_shape(samples: np.ndarray, sample_rate: int, punch: float) -> np.ndarray:
    if abs(punch) < EPSILON or samples.shape[0] < sample_rate // 8:
        return samples

    mono = np.max(np.abs(samples), axis=1)
    fast = _one_pole(mono, sample_rate, 0.008)
    slow = _one_pole(mono, sample_rate, 0.090)
    transient = np.maximum(fast - slow, 0.0)
    if np.max(transient) < EPSILON:
        return samples

    scale = float(np.percentile(transient, 95.0))
    transient /= max(scale, EPSILON)
    transient = np.clip(transient, 0.0, 1.5)
    gain = 1.0 + (np.clip(punch, -0.5, 0.5) * 0.35 * transient)
    return (samples * gain[:, np.newaxis]).astype(np.float32)


def _saturate(samples: np.ndarray, warmth: float) -> np.ndarray:
    if warmth <= 0:
        return samples
    drive = 1.0 + (warmth * 4.0)
    saturated = np.tanh(samples * drive) / np.tanh(drive)
    return ((samples * (1.0 - warmth)) + (saturated * warmth)).astype(np.float32)


def _stereo_width(samples: np.ndarray, width: float) -> np.ndarray:
    if samples.ndim != 2 or samples.shape[1] < 2:
        return samples

    left = samples[:, 0]
    right = samples[:, 1]
    mid = (left + right) * 0.5
    side = (left - right) * 0.5 * width
    widened = np.column_stack([mid + side, mid - side])
    peak = float(np.max(np.abs(widened))) if widened.size else 0.0
    if peak > 1.0:
        widened /= peak
    return widened.astype(np.float32)


def _preview_input_tuning(tuning: dict) -> dict[str, float]:
    normalized: dict[str, float] = {}
    for key, value in tuning.items():
        if isinstance(value, bool):
            continue
        try:
            normalized[str(key)] = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Live Preview tuning value for '{key}' must be numeric.") from exc
    return normalized


def _preview_tuning_value(tuning: dict[str, float], *keys: str) -> float:
    for key in keys:
        if key in tuning:
            return float(tuning[key])
    return 0.0


def _preview_stereo_float(samples: np.ndarray) -> np.ndarray:
    audio = np.asarray(samples, dtype=np.float32)
    if audio.ndim == 1:
        audio = audio[:, np.newaxis]
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    elif audio.shape[1] > 2:
        audio = audio[:, :2]
    return np.nan_to_num(audio, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)


def _apply_live_preview_width(
    samples: np.ndarray,
    width_setting: float,
    width_contract: dict,
) -> tuple[np.ndarray, float]:
    width = float(
        np.clip(
            float(width_contract["base"]) + (float(width_setting) * float(width_contract["scale"])),
            float(width_contract["min"]),
            float(width_contract["max"]),
        )
    )
    if samples.ndim != 2 or samples.shape[1] < 2:
        return samples.astype(np.float32), width
    left = samples[:, 0]
    right = samples[:, 1]
    mid = (left + right) * 0.5
    side = (left - right) * 0.5
    widened = np.column_stack([mid + (side * width), mid - (side * width)])
    return widened.astype(np.float32), width


def _apply_live_preview_compressor(
    samples: np.ndarray,
    intensity: float,
    compressor_contract: dict,
) -> tuple[np.ndarray, float]:
    drive = float(np.clip(float(intensity), 0.0, 1.0))
    if drive <= 0.0 or samples.size == 0:
        return samples.astype(np.float32), drive

    threshold = float(compressor_contract["thresholdBaseDbfs"]) - (drive * float(compressor_contract["thresholdDriveScaleDb"]))
    ratio = float(compressor_contract["ratioBase"]) + (drive * float(compressor_contract["ratioDriveScale"]))
    knee = max(float(compressor_contract["kneeDb"]), 0.0)
    level = np.max(np.abs(samples), axis=1)
    x_db = 20.0 * np.log10(np.maximum(level, EPSILON))
    y_db = np.array(x_db, copy=True)
    lower = threshold - (knee * 0.5)
    upper = threshold + (knee * 0.5)
    over = x_db > upper
    y_db[over] = threshold + ((x_db[over] - threshold) / ratio)
    if knee > 0.0:
        knee_zone = (x_db >= lower) & (x_db <= upper)
        y_db[knee_zone] = x_db[knee_zone] + ((1.0 / ratio) - 1.0) * ((x_db[knee_zone] - lower) ** 2) / (2.0 * knee)
    gain = db_to_amplitude(y_db - x_db).astype(np.float32)
    return (samples * gain[:, np.newaxis]).astype(np.float32), drive


def _apply_preview_biquad(samples: np.ndarray, b: np.ndarray, a: np.ndarray) -> np.ndarray:
    if np.allclose(b, a):
        return samples
    return signal.lfilter(b, a, samples, axis=0).astype(np.float32)


def _preview_shelf(
    kind: str,
    gain_db: float,
    frequency: float,
    sample_rate: int,
) -> tuple[np.ndarray, np.ndarray] | None:
    if abs(gain_db) < EPSILON:
        return None

    amplitude = 10.0 ** (float(gain_db) / 40.0)
    omega = 2.0 * np.pi * float(frequency) / sample_rate
    sin_omega = np.sin(omega)
    cos_omega = np.cos(omega)
    root = np.sqrt(amplitude)
    alpha = (sin_omega / 2.0) * np.sqrt(2.0)

    if kind == "low":
        b0 = amplitude * ((amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) + (2.0 * root * alpha))
        b1 = 2.0 * amplitude * ((amplitude - 1.0) - ((amplitude + 1.0) * cos_omega))
        b2 = amplitude * ((amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) - (2.0 * root * alpha))
        a0 = (amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) + (2.0 * root * alpha)
        a1 = -2.0 * ((amplitude - 1.0) + ((amplitude + 1.0) * cos_omega))
        a2 = (amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) - (2.0 * root * alpha)
    elif kind == "high":
        b0 = amplitude * ((amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) + (2.0 * root * alpha))
        b1 = -2.0 * amplitude * ((amplitude - 1.0) + ((amplitude + 1.0) * cos_omega))
        b2 = amplitude * ((amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) - (2.0 * root * alpha))
        a0 = (amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) + (2.0 * root * alpha)
        a1 = 2.0 * ((amplitude - 1.0) - ((amplitude + 1.0) * cos_omega))
        a2 = (amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) - (2.0 * root * alpha)
    else:
        raise ValueError(f"Unknown Live Preview shelf kind: {kind}")

    return _normalize_biquad(b0, b1, b2, a0, a1, a2)


def _match_lufs(samples: np.ndarray, sample_rate: int, target_lufs: float) -> tuple[np.ndarray, float]:
    current_lufs = integrated_lufs(samples, sample_rate)
    if current_lufs <= -119.0:
        return samples, 0.0

    gain_db = float(np.clip(target_lufs - current_lufs, -18.0, 18.0))
    gain = float(db_to_amplitude(gain_db))
    return (samples * gain).astype(np.float32), gain_db


def _one_pole(values: np.ndarray, sample_rate: int, seconds: float) -> np.ndarray:
    coefficient = np.exp(-1.0 / max(seconds * sample_rate, 1.0))
    return signal.lfilter([1.0 - coefficient], [1.0, -coefficient], values).astype(values.dtype, copy=False)


def _rust_eq_command() -> list[str]:
    configured = os.environ.get("ALBUM_MASTER_RUST_EQ")
    if configured:
        return [configured]

    root = Path(__file__).resolve().parents[2]
    manifest = root / "desktop" / "src-tauri" / "Cargo.toml"
    if manifest.exists():
        cargo = os.environ.get("CARGO", "cargo")
        return [
            cargo,
            "run",
            "--quiet",
            "--manifest-path",
            str(manifest),
            "--bin",
            "rust-eq",
            "--",
        ]

    executable = Path(sys.executable).with_name("rust-eq.exe" if os.name == "nt" else "rust-eq")
    return [str(executable)]


def _peaking_eq(sample_rate: int, frequency: float, gain_db: float, q: float) -> tuple[np.ndarray, np.ndarray]:
    if abs(gain_db) < EPSILON:
        return np.array([1.0, 0.0, 0.0]), np.array([1.0, 0.0, 0.0])

    amplitude = 10.0 ** (gain_db / 40.0)
    omega = 2.0 * np.pi * frequency / sample_rate
    alpha = np.sin(omega) / (2.0 * q)
    cos_omega = np.cos(omega)
    b0 = 1.0 + (alpha * amplitude)
    b1 = -2.0 * cos_omega
    b2 = 1.0 - (alpha * amplitude)
    a0 = 1.0 + (alpha / amplitude)
    a1 = -2.0 * cos_omega
    a2 = 1.0 - (alpha / amplitude)
    return _normalize_biquad(b0, b1, b2, a0, a1, a2)


def _normalize_biquad(
    b0: float,
    b1: float,
    b2: float,
    a0: float,
    a1: float,
    a2: float,
) -> tuple[np.ndarray, np.ndarray]:
    return (
        np.array([b0 / a0, b1 / a0, b2 / a0], dtype=np.float64),
        np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64),
    )
