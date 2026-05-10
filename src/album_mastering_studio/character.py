from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .analysis import AudioStats


CHARACTER_LABELS = ("acoustic_folk", "transition", "heavy_djent", "return_acoustic")


@dataclass(frozen=True)
class TrackCharacter:
    label: str
    display_name: str
    confidence: float
    traits: dict[str, float | str | bool]
    rationale: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def infer_album_characters(
    stats: list[AudioStats],
    names: list[str | None] | None = None,
    overrides: list[str | None] | None = None,
) -> list[TrackCharacter]:
    names = names or [None] * len(stats)
    overrides = overrides or [None] * len(stats)
    characters = [
        _infer_one(item, names[index] or "", overrides[index] if index < len(overrides) else None)
        for index, item in enumerate(stats)
    ]

    has_seen_heavy = False
    resolved: list[TrackCharacter] = []
    for index, character in enumerate(characters):
        if character.label == "heavy_djent":
            has_seen_heavy = True

        if (
            has_seen_heavy
            and character.label == "acoustic_folk"
            and index >= max(1, len(characters) // 2)
        ):
            character = TrackCharacter(
                label="return_acoustic",
                display_name="Return / Acoustic",
                confidence=max(character.confidence, 0.82),
                traits={**character.traits, "after_heavy_center": True},
                rationale=(
                    "Inferred as return/acoustic because quieter acoustic material arrives after the heavy center of the album."
                ),
            )
        resolved.append(character)

    return resolved


def _infer_one(stats: AudioStats, name: str, override: str | None) -> TrackCharacter:
    forced = _normalize_label(override)
    if forced and forced != "auto":
        return TrackCharacter(
            label=forced,
            display_name=_display_name(forced),
            confidence=1.0,
            traits=_traits(stats, name),
            rationale=f"Assigned as {_display_name(forced).lower()} from the album project override.",
        )

    lowered = name.lower()
    traits = _traits(stats, name)
    if any(token in lowered for token in ("djent", "heavy", "metal", "riff", "chug")):
        label = "heavy_djent"
        confidence = 0.94
        reason = "name hints and high-density analysis point to a heavy/djent role"
    elif any(token in lowered for token in ("interlude", "transition", "bridge", "segue")):
        label = "transition"
        confidence = 0.92
        reason = "the title marks this track as connective tissue"
    elif any(token in lowered for token in ("acoustic", "folk", "intro", "opener", "closing", "return")):
        label = "acoustic_folk"
        confidence = 0.90
        reason = "the title indicates acoustic or folk material"
    else:
        heavy_score = _heavy_score(stats)
        transition_score = _transition_score(stats)
        acoustic_score = _acoustic_score(stats)
        scores = {
            "heavy_djent": heavy_score,
            "transition": transition_score,
            "acoustic_folk": acoustic_score,
        }
        label = max(scores, key=scores.get)
        confidence = max(scores[label], 0.52)
        reason = _score_reason(label, stats)

    return TrackCharacter(
        label=label,
        display_name=_display_name(label),
        confidence=round(float(min(confidence, 1.0)), 4),
        traits=traits,
        rationale=f"Inferred as {_display_name(label).lower()} because {reason}.",
    )


def _normalize_label(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower().replace("-", "_").replace("/", "_").replace(" ", "_")
    aliases = {
        "auto": "auto",
        "acoustic": "acoustic_folk",
        "folk": "acoustic_folk",
        "acoustic_folk": "acoustic_folk",
        "transition": "transition",
        "interlude": "transition",
        "heavy": "heavy_djent",
        "djent": "heavy_djent",
        "heavy_djent": "heavy_djent",
        "return": "return_acoustic",
        "return_acoustic": "return_acoustic",
    }
    if normalized not in aliases:
        choices = ", ".join(("auto", *CHARACTER_LABELS))
        raise ValueError(f"Unknown track character '{value}'. Choose one of: {choices}")
    return aliases[normalized]


def _traits(stats: AudioStats, name: str) -> dict[str, float | str | bool]:
    balance = stats.spectral_balance
    return {
        "name": name,
        "energy_density": round(stats.energy_density, 4),
        "dynamic_range_db": round(stats.dynamic_range_db, 3),
        "crest_factor_db": round(stats.crest_factor_db, 3),
        "spectral_centroid_hz": round(stats.spectral_centroid_hz, 2),
        "low_weight": round(balance.get("sub", 0.0) + balance.get("low", 0.0), 5),
        "presence_weight": round(balance.get("presence", 0.0) + balance.get("air", 0.0), 5),
        "transient_density": round(stats.transient_density, 5),
        "stereo_width": round(stats.stereo_width, 5),
    }


def _heavy_score(stats: AudioStats) -> float:
    balance = stats.spectral_balance
    low_weight = balance.get("sub", 0.0) + balance.get("low", 0.0) + (balance.get("low_mid", 0.0) * 0.35)
    crest_density = 1.0 - max(min((stats.crest_factor_db - 6.0) / 10.0, 1.0), 0.0)
    return (
        (stats.energy_density * 0.42)
        + (crest_density * 0.24)
        + (min(low_weight * 2.8, 1.0) * 0.16)
        + (stats.transient_density * 0.18)
    )


def _acoustic_score(stats: AudioStats) -> float:
    balance = stats.spectral_balance
    mid_air = balance.get("mid", 0.0) + balance.get("presence", 0.0) + (balance.get("air", 0.0) * 0.4)
    openness = max(min((stats.crest_factor_db - 7.5) / 10.0, 1.0), 0.0)
    lower_density = 1.0 - stats.energy_density
    return (lower_density * 0.38) + (openness * 0.30) + (min(mid_air * 2.2, 1.0) * 0.20) + ((1.0 - stats.transient_density) * 0.12)


def _transition_score(stats: AudioStats) -> float:
    short_form = 0.0
    if 20.0 <= stats.duration_seconds <= 100.0:
        short_form = 0.30
    low_pressure = 1.0 - stats.energy_density
    texture = min((stats.stereo_width * 0.8) + (stats.transient_density * 0.2), 1.0)
    return short_form + (low_pressure * 0.42) + (texture * 0.18)


def _score_reason(label: str, stats: AudioStats) -> str:
    if label == "heavy_djent":
        return (
            f"energy density is {stats.energy_density:.2f}, crest factor is {stats.crest_factor_db:.1f} dB, "
            f"and transient density is {stats.transient_density:.2f}"
        )
    if label == "transition":
        return (
            f"duration is {stats.duration_seconds:.0f}s with low pressure and textured stereo content"
        )
    return (
        f"energy density is {stats.energy_density:.2f} with {stats.crest_factor_db:.1f} dB crest factor and an open midrange balance"
    )


def _display_name(label: str) -> str:
    return {
        "acoustic_folk": "Acoustic / Folk",
        "transition": "Transition",
        "heavy_djent": "Heavy / Djent",
        "return_acoustic": "Return / Acoustic",
    }[label]
