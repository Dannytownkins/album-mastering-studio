from __future__ import annotations

from dataclasses import asdict, dataclass
from math import cos, pi
from typing import Any

from .analysis import AudioStats
from .character import TrackCharacter, infer_album_characters
from .interludes import INTERLUDE_STYLES
from .mastering import MasterPreset


@dataclass(frozen=True)
class ArcPreset:
    name: str
    display_name: str
    description: str
    curve: tuple[float, ...]
    roles: tuple[str, ...]


@dataclass(frozen=True)
class TrackArc:
    index: int
    role: str
    character: dict[str, Any]
    energy: float
    target_lufs: float
    mastering: dict[str, Any]
    rationale: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class TransitionArc:
    after_track: int
    handoff: str
    style: str
    duration_seconds: float
    tail_treatment: dict[str, Any]
    head_treatment: dict[str, Any]
    rationale: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class AlbumArcPlan:
    name: str
    display_name: str
    description: str
    intensity: float
    tracks: tuple[TrackArc, ...]
    transitions: tuple[TransitionArc, ...]

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "intensity": self.intensity,
            "tracks": [track.to_dict() for track in self.tracks],
            "transitions": [transition.to_dict() for transition in self.transitions],
        }


ARC_PRESETS: dict[str, ArcPreset] = {
    "cinematic": ArcPreset(
        name="cinematic",
        display_name="Cinematic Rise and Afterglow",
        description="A deliberate album shape: invitation, climb, peak, emotional release, afterglow.",
        curve=(0.32, 0.52, 0.78, 1.00, 0.70, 0.46),
        roles=("invitation", "pressure rise", "threshold", "centerpiece", "fallout", "afterglow"),
    ),
    "afterhours": ArcPreset(
        name="afterhours",
        display_name="Afterhours Descent",
        description="Starts present and slowly moves inward, darker, closer, and more private.",
        curve=(0.78, 0.66, 0.55, 0.43, 0.34, 0.28),
        roles=("door opens", "neon fade", "last crowded room", "quiet turn", "floorboards", "lights out"),
    ),
    "club-peak": ArcPreset(
        name="club-peak",
        display_name="Club Peak",
        description="A functional energy ramp with one obvious high point and a controlled landing.",
        curve=(0.46, 0.62, 0.78, 0.96, 1.00, 0.74),
        roles=("warm-up", "lock-in", "lift", "peak pressure", "release", "walkout"),
    ),
    "fever-dream": ArcPreset(
        name="fever-dream",
        display_name="Fever Dream",
        description="Uneven by design: unstable movement, odd valleys, sudden brightness.",
        curve=(0.58, 0.34, 0.86, 0.48, 1.00, 0.39),
        roles=("signal found", "tilt", "flash", "haze", "rupture", "trace"),
    ),
}


def build_album_arc(
    stats: list[AudioStats],
    preset: MasterPreset,
    arc_name: str,
    default_duration: float,
    default_style: str,
    intensity: float,
    characters: list[TrackCharacter] | None = None,
) -> AlbumArcPlan:
    if arc_name not in ARC_PRESETS:
        choices = ", ".join(sorted(ARC_PRESETS))
        raise ValueError(f"Unknown album arc '{arc_name}'. Choose one of: {choices}")

    arc = ARC_PRESETS[arc_name]
    intensity = max(0.0, min(float(intensity), 2.0))
    characters = characters or infer_album_characters(stats)
    energies = [_energy_score(item) for item in stats]
    curve = _resample_curve(arc.curve, len(stats))
    tracks: list[TrackArc] = []
    transitions: list[TransitionArc] = []

    for index, (track_stats, character, energy, curve_value) in enumerate(zip(stats, characters, energies, curve), start=1):
        role = _role_at(arc.roles, index, len(stats))
        arc_offset = (curve_value - 0.5) * 3.2 * intensity
        source_compensation = (0.5 - energy) * 0.45
        character_offset = _character_loudness_offset(character, index, len(stats))
        target_lufs = preset.target_lufs + arc_offset + source_compensation
        target_lufs += character_offset
        mastering = _mastering_bias(character, energy, curve_value, intensity)
        tracks.append(
            TrackArc(
                index=index,
                role=role,
                character=character.to_dict(),
                energy=round(energy, 4),
                target_lufs=round(target_lufs, 3),
                mastering=mastering,
                rationale=_track_rationale(index, len(stats), role, character, track_stats, target_lufs, curve_value, mastering),
            )
        )

    for index in range(max(len(stats) - 1, 0)):
        left = stats[index]
        right = stats[index + 1]
        left_character = characters[index]
        right_character = characters[index + 1]
        left_energy = energies[index]
        right_energy = energies[index + 1]
        handoff = _handoff(left_character.label, right_character.label)
        planned_style = _choose_style(
            default_style,
            preset,
            left,
            right,
            left_character,
            right_character,
            left_energy,
            right_energy,
            curve[index + 1],
        )
        duration = _transition_duration(default_duration, left_energy, right_energy, curve[index + 1], intensity, handoff)
        tail_treatment = _tail_treatment(handoff, duration)
        head_treatment = _head_treatment(handoff, duration)
        transitions.append(
            TransitionArc(
                after_track=index + 1,
                handoff=handoff,
                style=planned_style,
                duration_seconds=round(duration, 3),
                tail_treatment=tail_treatment,
                head_treatment=head_treatment,
                rationale=_transition_rationale(
                    index + 1,
                    handoff,
                    planned_style,
                    duration,
                    left_character,
                    right_character,
                    left,
                    right,
                    left_energy,
                    right_energy,
                ),
            )
        )

    return AlbumArcPlan(
        name=arc.name,
        display_name=arc.display_name,
        description=arc.description,
        intensity=intensity,
        tracks=tuple(tracks),
        transitions=tuple(transitions),
    )


def _energy_score(stats: AudioStats) -> float:
    return float(stats.energy_density)


def _resample_curve(curve: tuple[float, ...], count: int) -> list[float]:
    if count <= 0:
        return []
    if count == 1:
        return [curve[0]]
    if len(curve) == count:
        return list(curve)

    output = []
    for index in range(count):
        position = index * (len(curve) - 1) / (count - 1)
        lower = int(position)
        upper = min(lower + 1, len(curve) - 1)
        fraction = position - lower
        eased = 0.5 - (0.5 * cos(pi * fraction))
        output.append((curve[lower] * (1.0 - eased)) + (curve[upper] * eased))
    return output


def _role_at(roles: tuple[str, ...], index: int, count: int) -> str:
    if count <= 1:
        return roles[0]
    position = round((index - 1) * (len(roles) - 1) / (count - 1))
    return roles[min(position, len(roles) - 1)]


def _choose_style(
    requested_style: str,
    preset: MasterPreset,
    left: AudioStats,
    right: AudioStats,
    left_character: TrackCharacter,
    right_character: TrackCharacter,
    left_energy: float,
    right_energy: float,
    next_curve_value: float,
) -> str:
    if requested_style != "auto":
        return requested_style

    handoff = _handoff(left_character.label, right_character.label)
    if handoff == "acoustic_to_heavy":
        return "rhythmic"
    if handoff == "heavy_to_acoustic":
        return "swell" if preset.interlude_bias != "tape" else "tape"
    if handoff == "heavy_to_heavy":
        return "rhythmic"
    if handoff == "acoustic_to_acoustic" and preset.interlude_bias in {"tape", "minimal", "ambient"}:
        return preset.interlude_bias

    energy_delta = right_energy - left_energy
    brightness_delta = right.spectral_centroid_hz - left.spectral_centroid_hz
    if preset.interlude_bias in INTERLUDE_STYLES and abs(energy_delta) < 0.10:
        return preset.interlude_bias
    if energy_delta > 0.16 or next_curve_value > 0.82:
        return "rhythmic"
    if energy_delta < -0.16:
        return "swell"
    if brightness_delta < -900:
        return "tape"
    if max(left_energy, right_energy) < 0.42:
        return "minimal"
    return "ambient"


def _transition_duration(
    default_duration: float,
    left_energy: float,
    right_energy: float,
    curve_value: float,
    intensity: float,
    handoff: str,
) -> float:
    contrast = abs(right_energy - left_energy)
    arc_push = abs(curve_value - 0.5) * intensity
    handoff_bonus = {
        "acoustic_to_heavy": 3.0,
        "heavy_to_acoustic": 3.4,
        "heavy_to_heavy": 0.8,
        "acoustic_to_acoustic": 0.4,
    }.get(handoff, 1.0)
    duration = default_duration + (contrast * 3.0) + (arc_push * 1.4) + handoff_bonus
    return max(1.0, min(duration, 18.0))


def _character_loudness_offset(character: TrackCharacter, index: int, count: int) -> float:
    offsets = {
        "acoustic_folk": -0.72,
        "transition": -1.25,
        "heavy_djent": 0.82,
        "return_acoustic": -1.05,
    }
    offset = offsets.get(character.label, 0.0)
    if index == 1 and character.label == "acoustic_folk":
        offset -= 0.25
    if index == count and character.label in {"acoustic_folk", "return_acoustic"}:
        offset -= 0.20
    return offset


def _mastering_bias(
    character: TrackCharacter,
    energy: float,
    curve_value: float,
    intensity: float,
) -> dict[str, Any]:
    if character.label == "heavy_djent":
        move = {
            "low_end_db": 0.35,
            "low_mid_db": -0.55,
            "presence_db": -0.20 if energy > 0.66 else 0.15,
            "air_db": 0.35,
            "width_offset": 0.035,
            "warmth_offset": 0.015,
            "intensity_offset": 0.24 + (0.08 * intensity),
            "rationale": "Tightened low mids and added controlled density because the heavy center should feel bigger without swallowing the record.",
        }
    elif character.label == "return_acoustic":
        move = {
            "low_end_db": 0.18,
            "low_mid_db": 0.10,
            "presence_db": -0.45,
            "air_db": -0.10,
            "width_offset": -0.055,
            "warmth_offset": 0.055,
            "intensity_offset": -0.22,
            "rationale": "Pulled the return inward with warmer color and lighter compression after the heavy section.",
        }
    elif character.label == "transition":
        move = {
            "low_end_db": -0.10,
            "low_mid_db": -0.25,
            "presence_db": -0.25,
            "air_db": 0.15,
            "width_offset": 0.025,
            "warmth_offset": 0.020,
            "intensity_offset": -0.12,
            "rationale": "Kept the connective track lower-pressure so it can redirect the album rather than compete with songs.",
        }
    else:
        move = {
            "low_end_db": 0.20,
            "low_mid_db": 0.05,
            "presence_db": -0.20,
            "air_db": 0.05 if curve_value > 0.55 else -0.10,
            "width_offset": -0.030,
            "warmth_offset": 0.035,
            "intensity_offset": -0.16,
            "rationale": "Left the acoustic material breathing with warmth, modest width, and less compression.",
        }
    return {key: (round(value, 4) if isinstance(value, float) else value) for key, value in move.items()}


def _handoff(left_label: str, right_label: str) -> str:
    left_heavy = left_label == "heavy_djent"
    right_heavy = right_label == "heavy_djent"
    left_acoustic = left_label in {"acoustic_folk", "return_acoustic"}
    right_acoustic = right_label in {"acoustic_folk", "return_acoustic"}
    if left_acoustic and right_heavy:
        return "acoustic_to_heavy"
    if left_heavy and right_acoustic:
        return "heavy_to_acoustic"
    if left_heavy and right_heavy:
        return "heavy_to_heavy"
    if left_acoustic and right_acoustic:
        return "acoustic_to_acoustic"
    if right_heavy:
        return "transition_to_heavy"
    if left_heavy:
        return "heavy_to_transition"
    return "textural_bridge"


def _tail_treatment(handoff: str, duration: float) -> dict[str, Any]:
    seconds = round(max(2.5, min(duration * 0.72, 9.5)), 3)
    treatments: dict[str, dict[str, Any]] = {
        "acoustic_to_heavy": {
            "seconds": seconds,
            "gain_db": -0.20,
            "low_shelf_db": 0.65,
            "low_mid_db": 0.10,
            "presence_db": -0.55,
            "air_db": -0.35,
            "width": 0.96,
            "warmth": 0.035,
            "rationale": "Weighted and darkened the acoustic tail so the down-tuned entrance feels earned.",
        },
        "heavy_to_acoustic": {
            "seconds": seconds,
            "gain_db": -0.45,
            "low_shelf_db": -0.70,
            "low_mid_db": -0.45,
            "presence_db": -0.70,
            "air_db": -0.30,
            "width": 0.92,
            "warmth": 0.020,
            "rationale": "Narrowed and softened the heavy tail before returning to close acoustic space.",
        },
        "heavy_to_heavy": {
            "seconds": round(max(1.8, min(duration * 0.45, 5.0)), 3),
            "gain_db": -0.10,
            "low_shelf_db": -0.10,
            "low_mid_db": -0.35,
            "presence_db": 0.10,
            "air_db": 0.05,
            "width": 0.99,
            "warmth": 0.010,
            "rationale": "Tightened the outgoing heavy tail so the next heavy track hits as a new section, not a smear.",
        },
        "acoustic_to_acoustic": {
            "seconds": round(max(2.0, min(duration * 0.55, 6.0)), 3),
            "gain_db": -0.10,
            "low_shelf_db": 0.15,
            "low_mid_db": 0.10,
            "presence_db": -0.20,
            "air_db": -0.05,
            "width": 0.98,
            "warmth": 0.030,
            "rationale": "Added a small tape-like lean so adjacent acoustic songs belong to the same room.",
        },
    }
    return treatments.get(
        handoff,
        {
            "seconds": round(max(2.0, min(duration * 0.50, 6.0)), 3),
            "gain_db": -0.15,
            "low_shelf_db": 0.0,
            "low_mid_db": -0.10,
            "presence_db": -0.15,
            "air_db": 0.0,
            "width": 0.98,
            "warmth": 0.015,
            "rationale": "Applied a restrained edge shape so the sequence stays connected.",
        },
    )


def _head_treatment(handoff: str, duration: float) -> dict[str, Any]:
    seconds = round(max(2.0, min(duration * 0.60, 8.0)), 3)
    treatments: dict[str, dict[str, Any]] = {
        "acoustic_to_heavy": {
            "seconds": seconds,
            "gain_db": -0.15,
            "low_shelf_db": -0.15,
            "low_mid_db": -0.25,
            "presence_db": -0.35,
            "air_db": -0.20,
            "width": 0.98,
            "warmth": 0.015,
            "rationale": "Tamed the first heavy seconds so the impact grows out of the interlude instead of arriving as a hard splice.",
        },
        "heavy_to_acoustic": {
            "seconds": seconds,
            "gain_db": 0.05,
            "low_shelf_db": 0.25,
            "low_mid_db": 0.20,
            "presence_db": -0.35,
            "air_db": -0.10,
            "width": 0.95,
            "warmth": 0.055,
            "rationale": "Warmed and narrowed the acoustic head so the return feels intimate after the heavy wall.",
        },
        "heavy_to_heavy": {
            "seconds": round(max(1.5, min(duration * 0.38, 4.0)), 3),
            "gain_db": -0.05,
            "low_shelf_db": 0.05,
            "low_mid_db": -0.20,
            "presence_db": 0.05,
            "air_db": 0.0,
            "width": 1.00,
            "warmth": 0.010,
            "rationale": "Prepared the next heavy head with a short tightening move so the center keeps momentum.",
        },
        "acoustic_to_acoustic": {
            "seconds": round(max(1.8, min(duration * 0.45, 5.0)), 3),
            "gain_db": 0.0,
            "low_shelf_db": 0.10,
            "low_mid_db": 0.05,
            "presence_db": -0.10,
            "air_db": 0.0,
            "width": 0.98,
            "warmth": 0.025,
            "rationale": "Matched the next acoustic entrance to the same softened album color.",
        },
    }
    return treatments.get(
        handoff,
        {
            "seconds": round(max(1.8, min(duration * 0.45, 5.0)), 3),
            "gain_db": 0.0,
            "low_shelf_db": 0.0,
            "low_mid_db": -0.10,
            "presence_db": -0.10,
            "air_db": 0.0,
            "width": 0.99,
            "warmth": 0.015,
            "rationale": "Applied a restrained entrance shape so the next track inherits the album tone.",
        },
    )


def _track_rationale(
    index: int,
    count: int,
    role: str,
    character: TrackCharacter,
    stats: AudioStats,
    target_lufs: float,
    curve_value: float,
    mastering: dict[str, Any],
) -> str:
    placement = "opener" if index == 1 else "closer" if index == count else role
    return (
        f"Set Track {index} as {placement} at {target_lufs:.1f} LUFS because it reads as "
        f"{character.display_name.lower()} with energy {stats.energy_density:.2f}; {mastering['rationale']}"
    )


def _transition_rationale(
    after_track: int,
    handoff: str,
    style: str,
    duration: float,
    left_character: TrackCharacter,
    right_character: TrackCharacter,
    left: AudioStats,
    right: AudioStats,
    left_energy: float,
    right_energy: float,
) -> str:
    readable = handoff.replace("_", " ")
    return (
        f"Planned Track {after_track}->{after_track + 1} as {readable} with a {style} interlude for {duration:.1f}s "
        f"because character moves {left_character.display_name.lower()} to {right_character.display_name.lower()} "
        f"and energy shifts {left_energy:.2f}->{right_energy:.2f}."
    )
