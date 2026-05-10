from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np

from .analysis import analyze_audio
from .audio_io import load_audio


def score_render(manifest_path: Path, scorer: str = "auto") -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    dimensions = _local_dimensions(manifest, manifest_path)
    overall = _weighted_overall(dimensions)
    features = _score_features(manifest, dimensions, overall)
    llm_notes = _llm_score(features, scorer)
    suggestions = _suggestions(dimensions)

    scorecard = {
        "version": 1,
        "scorer": "llm" if llm_notes else "local",
        "overall": round(overall, 4),
        "dimensions": dimensions,
        "suggestions": suggestions,
        "llm_notes": llm_notes,
        "features": features,
    }

    scorecard_path = manifest_path.parent / "scorecard.json"
    scorecard_path.write_text(json.dumps(scorecard, indent=2), encoding="utf-8")
    return scorecard


def _local_dimensions(manifest: dict, manifest_path: Path) -> dict[str, dict[str, Any]]:
    tracks = [item for item in manifest.get("sequence", []) if item.get("type") == "track"]
    interludes = [item for item in manifest.get("sequence", []) if item.get("type") == "interlude"]
    album_stats = _album_stats(manifest, manifest_path)

    target_errors = [
        abs(float(track["after"]["integrated_lufs"]) - float(track["arc"]["target_lufs"]))
        for track in tracks
        if "arc" in track and "after" in track
    ]
    arc_fit = _clamp01(1.0 - ((float(np.mean(target_errors)) if target_errors else 5.0) / 3.0))
    arc_shape = _arc_shape_score(tracks)
    peak_score = _peak_score(tracks, album_stats)
    interlude_score = _interlude_score(tracks, interludes)
    identity_score = _identity_score(tracks)
    continuity_score = _continuity_score(tracks, interludes, album_stats)
    genre_shift_score = _genre_shift_score(tracks, interludes)
    rationale_score = _rationale_score(manifest, tracks, interludes)

    return {
        "album_arc": {
            "score": round((arc_fit * 0.62) + (arc_shape * 0.38), 4),
            "target_error_lufs": round(float(np.mean(target_errors)) if target_errors else 0.0, 4),
            "shape_score": round(arc_shape, 4),
            "note": "How closely rendered track loudness follows the planned album arc.",
        },
        "interlude_cohesion": {
            "score": round(interlude_score, 4),
            "styles": sorted({item.get("style") for item in interludes if item.get("style")}),
            "count": len(interludes),
            "note": "Whether every gap has musical connective material with useful variation.",
        },
        "translation_safety": {
            "score": round(peak_score, 4),
            "max_true_peak_dbfs": _max_true_peak(tracks, album_stats),
            "note": "Ceiling, true-peak risk, and basic distribution safety.",
        },
        "preset_identity": {
            "score": round(identity_score, 4),
            "preset": manifest.get("settings", {}).get("preset"),
            "note": "Whether the chosen profile has audible, documented EQ/dynamics intent.",
        },
        "sequence_continuity": {
            "score": round(continuity_score, 4),
            "album_lufs": album_stats.get("integrated_lufs") if album_stats else None,
            "note": "Whether the final album render behaves like one connected sequence.",
        },
        "genre_shift_handling": {
            "score": round(genre_shift_score, 4),
            "handoffs": [item.get("handoff") for item in interludes],
            "note": "Whether acoustic/heavy/return handoffs have planned interludes and mastering edge moves.",
        },
        "decision_rationales": {
            "score": round(rationale_score, 4),
            "note": "Whether the manifest explains mastering and transition decisions in plain language.",
        },
    }


def _score_features(manifest: dict, dimensions: dict, overall: float) -> dict:
    return {
        "overall": round(overall, 4),
        "album_title": manifest.get("album_title"),
        "settings": manifest.get("settings", {}),
        "arc": manifest.get("arc", {}),
        "dimensions": dimensions,
    }


def _weighted_overall(dimensions: dict[str, dict[str, Any]]) -> float:
    weights = {
        "album_arc": 0.21,
        "interlude_cohesion": 0.19,
        "translation_safety": 0.15,
        "preset_identity": 0.12,
        "sequence_continuity": 0.13,
        "genre_shift_handling": 0.13,
        "decision_rationales": 0.07,
    }
    return float(
        sum(dimensions[name]["score"] * weight for name, weight in weights.items())
        / sum(weights.values())
    )


def _suggestions(dimensions: dict[str, dict[str, Any]]) -> list[str]:
    suggestions: list[str] = []
    if dimensions["album_arc"]["score"] < 0.86:
        suggestions.append("Increase arc_intensity or reduce per-track target error so the album has a clearer emotional shape.")
    if dimensions["interlude_cohesion"]["score"] < 0.90:
        suggestions.append("Use auto interludes and allow longer transitions where adjacent tracks have a large energy or brightness change.")
    if dimensions["translation_safety"]["score"] < 0.92:
        suggestions.append("Lower tweak_lufs or choose a gentler preset to protect true-peak headroom.")
    if dimensions["preset_identity"]["score"] < 0.85:
        suggestions.append("Choose a stronger taste preset such as 3am-kitchen-floor, radio-brittle, or velvet-museum.")
    if dimensions["sequence_continuity"]["score"] < 0.84:
        suggestions.append("Render an album WAV and preview transitions so continuity is scored against actual audio.")
    if dimensions["genre_shift_handling"]["score"] < 0.86:
        suggestions.append("Use auto character detection or explicit character overrides so acoustic-heavy-acoustic handoffs get edge mastering moves.")
    if dimensions["decision_rationales"]["score"] < 0.92:
        suggestions.append("Keep narrative rationales in the manifest for every mastered track and generated transition.")
    return suggestions or ["Score is strong enough for this pass; audition before making taste changes."]


def _album_stats(manifest: dict, manifest_path: Path) -> dict | None:
    album_path = manifest.get("album_sequence")
    if not album_path:
        return None

    path = Path(album_path)
    if not path.is_absolute() and not path.exists():
        candidate = manifest_path.parent / path.name
        path = candidate if candidate.exists() else path
    if not path.exists():
        return None

    samples = load_audio(path, int(manifest.get("settings", {}).get("sample_rate", 48_000)))
    return analyze_audio(samples, int(manifest.get("settings", {}).get("sample_rate", 48_000))).to_dict()


def _arc_shape_score(tracks: list[dict]) -> float:
    if len(tracks) < 3:
        return 0.85

    planned = np.array([float(track["arc"]["target_lufs"]) for track in tracks], dtype=np.float64)
    actual = np.array([float(track["after"]["integrated_lufs"]) for track in tracks], dtype=np.float64)
    if np.std(planned) < 1e-6 or np.std(actual) < 1e-6:
        return 0.72
    correlation = float(np.corrcoef(planned, actual)[0, 1])
    return _clamp01((correlation + 1.0) / 2.0)


def _peak_score(tracks: list[dict], album_stats: dict | None) -> float:
    max_peak = _max_true_peak(tracks, album_stats)
    if max_peak is None:
        return 0.75
    if max_peak <= -1.0:
        return 1.0
    if max_peak <= -0.3:
        return 0.86
    return 0.62


def _max_true_peak(tracks: list[dict], album_stats: dict | None) -> float | None:
    peaks = [float(track["after"]["true_peak_dbfs"]) for track in tracks if "after" in track]
    if album_stats and album_stats.get("true_peak_dbfs") is not None:
        peaks.append(float(album_stats["true_peak_dbfs"]))
    return max(peaks) if peaks else None


def _interlude_score(tracks: list[dict], interludes: list[dict]) -> float:
    expected = max(len(tracks) - 1, 0)
    if expected == 0:
        return 1.0
    coverage = len(interludes) / expected
    generic_penalty = 0.18 if any(item.get("style") in {None, "silent"} for item in interludes) else 0.0
    duration_score = _clamp01(float(np.mean([min(float(item.get("duration_seconds", 0.0)) / 4.0, 1.0) for item in interludes])) if interludes else 0.0)
    variety = min(len({item.get("style") for item in interludes}) / max(min(expected, 3), 1), 1.0)
    return _clamp01((coverage * 0.55) + (duration_score * 0.25) + (variety * 0.20) - generic_penalty)


def _identity_score(tracks: list[dict]) -> float:
    if not tracks:
        return 0.0
    preset = tracks[0].get("preset", {})
    taste_fields = [
        abs(float(preset.get("low_shelf_db", 0.0))),
        abs(float(preset.get("low_mid_db", 0.0))),
        abs(float(preset.get("presence_db", 0.0))),
        abs(float(preset.get("air_db", 0.0))),
        abs(float(preset.get("stereo_width", 1.0)) - 1.0) * 10.0,
        abs(float(preset.get("warmth", 0.0))) * 18.0,
    ]
    return _clamp01(0.48 + (sum(taste_fields) / 13.0))


def _continuity_score(tracks: list[dict], interludes: list[dict], album_stats: dict | None) -> float:
    if not tracks:
        return 0.0
    score = 0.65
    if album_stats:
        score += 0.18
        album_lufs = float(album_stats["integrated_lufs"])
        track_lufs = [float(track["after"]["integrated_lufs"]) for track in tracks]
        if min(track_lufs) - 4.0 <= album_lufs <= max(track_lufs) + 2.0:
            score += 0.09
    if len(interludes) == max(len(tracks) - 1, 0):
        score += 0.08
    return _clamp01(score)


def _genre_shift_score(tracks: list[dict], interludes: list[dict]) -> float:
    if not tracks:
        return 0.0

    labels = [track.get("character", {}).get("label") for track in tracks]
    has_heavy = "heavy_djent" in labels
    has_return = "return_acoustic" in labels
    handoffs = {item.get("handoff") for item in interludes}
    score = 0.54
    if has_heavy:
        score += 0.10
    if has_return:
        score += 0.10
    if "acoustic_to_heavy" in handoffs or "transition_to_heavy" in handoffs:
        score += 0.09
    if "heavy_to_acoustic" in handoffs:
        score += 0.09
    treated = [
        item
        for item in interludes
        if item.get("tail_treatment", {}).get("rationale") and item.get("head_treatment", {}).get("rationale")
    ]
    if interludes:
        score += 0.08 * (len(treated) / len(interludes))
    return _clamp01(score)


def _rationale_score(manifest: dict, tracks: list[dict], interludes: list[dict]) -> float:
    track_count = len(tracks)
    interlude_count = len(interludes)
    expected = track_count + interlude_count
    if expected == 0:
        return 0.0

    narrative_items = [
        *(track.get("rationale") for track in tracks),
        *(item.get("rationale") for item in interludes),
    ]
    present = sum(1 for item in narrative_items if isinstance(item, str) and len(item.split()) >= 10)
    decision_log = manifest.get("decision_log", {})
    has_album_story = bool(manifest.get("album_story") or decision_log.get("album"))
    score = present / expected
    if has_album_story:
        score += 0.08
    return _clamp01(score)


def _llm_score(features: dict, scorer: str) -> str | None:
    if scorer == "local":
        return None
    api_key = os.environ.get("OPENAI_API_KEY")
    model = os.environ.get("ALBUM_MASTER_LLM_MODEL")
    if not api_key or not model:
        return None

    prompt = (
        "You are scoring an album mastering render from structured audio features. "
        "Give a concise mastering-director critique: what works, what feels generic, "
        "and one concrete next adjustment. Return plain text under 120 words.\n\n"
        + json.dumps(features, indent=2)
    )
    body = json.dumps(
        {
            "model": model,
            "input": prompt,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        if scorer == "llm":
            raise
        return None

    return _extract_response_text(payload)


def _extract_response_text(payload: dict) -> str | None:
    parts: list[str] = []
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                parts.append(str(content["text"]))
    return "\n".join(parts).strip() or None


def _clamp01(value: float) -> float:
    return max(0.0, min(float(value), 1.0))
