from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class DeliveryProfile:
    key: str
    display_name: str
    target_lufs: float | None
    ceiling_dbfs: float | None
    sample_rate: int | None
    bit_depth: int | None
    output_format: str | None
    codec_preview: bool
    note: str

    def to_dict(self) -> dict:
        return asdict(self)


DELIVERY_PROFILES: dict[str, DeliveryProfile] = {
    "custom": DeliveryProfile(
        key="custom",
        display_name="Custom",
        target_lufs=None,
        ceiling_dbfs=None,
        sample_rate=None,
        bit_depth=None,
        output_format=None,
        codec_preview=True,
        note="Manual target. Use when you want to control every render setting directly.",
    ),
    "streaming-universal": DeliveryProfile(
        key="streaming-universal",
        display_name="Streaming universal (-14 LUFS / -1 dBTP)",
        target_lufs=-14.0,
        ceiling_dbfs=-1.0,
        sample_rate=48_000,
        bit_depth=24,
        output_format="wav",
        codec_preview=True,
        note="Practical one-master baseline for private streaming-style delivery.",
    ),
    "aes-album-mode": DeliveryProfile(
        key="aes-album-mode",
        display_name="AES album mode (loudest track around -14)",
        target_lufs=-14.0,
        ceiling_dbfs=-1.0,
        sample_rate=48_000,
        bit_depth=24,
        output_format="wav",
        codec_preview=True,
        note="Album-oriented profile: preserve track-to-track intent and let the arc carry relative loudness.",
    ),
    "apple-aac-check": DeliveryProfile(
        key="apple-aac-check",
        display_name="Apple / AAC check (-16-ish LUFS / -1 dBTP)",
        target_lufs=-16.0,
        ceiling_dbfs=-1.0,
        sample_rate=48_000,
        bit_depth=24,
        output_format="wav",
        codec_preview=True,
        note="Apple does not publish a fixed LUFS contract; this profile uses a conservative Sound Check-style reference and AAC clip preview.",
    ),
    "youtube-video": DeliveryProfile(
        key="youtube-video",
        display_name="YouTube / video (48 kHz / -14 LUFS)",
        target_lufs=-14.0,
        ceiling_dbfs=-1.0,
        sample_rate=48_000,
        bit_depth=24,
        output_format="wav",
        codec_preview=True,
        note="48 kHz, 24-bit working default for video-oriented delivery.",
    ),
    "amazon-alexa-safe": DeliveryProfile(
        key="amazon-alexa-safe",
        display_name="Amazon / speaker safe (-14 LUFS / -2 dBTP)",
        target_lufs=-14.0,
        ceiling_dbfs=-2.0,
        sample_rate=48_000,
        bit_depth=24,
        output_format="wav",
        codec_preview=True,
        note="Conservative true-peak ceiling for lossy transcodes and smart-speaker playback.",
    ),
    "cd-16": DeliveryProfile(
        key="cd-16",
        display_name="CD 16/44.1 with dither",
        target_lufs=-14.0,
        ceiling_dbfs=-1.0,
        sample_rate=44_100,
        bit_depth=16,
        output_format="wav",
        codec_preview=False,
        note="16-bit PCM export path with final-stage TPDF dither.",
    ),
    "vinyl-premaster": DeliveryProfile(
        key="vinyl-premaster",
        display_name="Vinyl premaster / relaxed headroom",
        target_lufs=-18.0,
        ceiling_dbfs=-3.0,
        sample_rate=48_000,
        bit_depth=24,
        output_format="wav",
        codec_preview=False,
        note="Relaxed limiter target and extra headroom for later cutting decisions. This is not a replacement for a cutting engineer.",
    ),
    "loud-rock": DeliveryProfile(
        key="loud-rock",
        display_name="Loud rock reference (-10.5 LUFS / -1 dBTP)",
        target_lufs=-10.5,
        ceiling_dbfs=-1.0,
        sample_rate=48_000,
        bit_depth=24,
        output_format="wav",
        codec_preview=True,
        note="Competitive private reference profile. The report will show expected normalization penalty.",
    ),
}


def delivery_profile(key: str | None) -> DeliveryProfile:
    if not key:
        return DELIVERY_PROFILES["custom"]
    try:
        return DELIVERY_PROFILES[delivery_key(str(key))]
    except ValueError:
        return DELIVERY_PROFILES["custom"]


def delivery_choices() -> tuple[str, ...]:
    return tuple(profile.display_name for profile in DELIVERY_PROFILES.values())


def delivery_choice(key: str) -> str:
    return DELIVERY_PROFILES[key].display_name


def delivery_key(value: str) -> str:
    normalized = str(value).strip().lower()
    if normalized in DELIVERY_PROFILES:
        return normalized
    for key, profile in DELIVERY_PROFILES.items():
        if profile.display_name.lower() == normalized:
            return key
    raise ValueError(f"Unknown delivery profile: {value}")
