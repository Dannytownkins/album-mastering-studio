from __future__ import annotations

import copy
import json
from pathlib import Path

from .pipeline import load_project, render_project
from .scoring import score_render


def iterate_project(
    project_path: Path,
    output_dir: Path,
    passes: int = 2,
    scorer: str = "auto",
) -> dict:
    passes = max(1, int(passes))
    output_dir.mkdir(parents=True, exist_ok=True)
    original = load_project(project_path)
    working = _absolutize_project_paths(copy.deepcopy(original), project_path.resolve().parent)
    summary = {
        "version": 1,
        "source_project": str(project_path),
        "passes": [],
        "halt_reason": "max_passes",
    }

    for pass_number in range(1, passes + 1):
        pass_dir = output_dir / f"pass_{pass_number:02d}"
        pass_dir.mkdir(parents=True, exist_ok=True)
        pass_project = pass_dir / "project.ams.json"
        pass_project.write_text(json.dumps(working, indent=2), encoding="utf-8")

        manifest = render_project(pass_project, pass_dir)
        scorecard = score_render(pass_dir / "manifest.json", scorer=scorer)
        summary["passes"].append(
            {
                "pass": pass_number,
                "project": str(pass_project),
                "manifest": str(pass_dir / "manifest.json"),
                "scorecard": str(pass_dir / "scorecard.json"),
                "overall": scorecard["overall"],
                "suggestions": scorecard["suggestions"],
                "album_sequence": manifest.get("album_sequence"),
                "iteration_decision": {
                    "applied": False,
                    "rationale": "No follow-up adjustment was needed for this pass.",
                },
            }
        )

        if not _needs_iteration(scorecard):
            summary["halt_reason"] = "converged"
            summary["passes"][-1]["iteration_decision"] = {
                "applied": False,
                "rationale": "Stopped because the bounded local score thresholds converged.",
            }
            break

        if pass_number < passes:
            working, decision = _apply_iteration(working, scorecard)
            summary["passes"][-1]["iteration_decision"] = decision

    summary_path = output_dir / "iteration_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def _absolutize_project_paths(project: dict, base_dir: Path) -> dict:
    for track in project.get("tracks", []):
        path = Path(track["path"])
        track["path"] = str(path if path.is_absolute() else base_dir / path)
    return project


def _apply_iteration(project: dict, scorecard: dict) -> tuple[dict, dict]:
    updated = copy.deepcopy(project)
    settings = updated.setdefault("settings", {})
    dimensions = scorecard.get("dimensions", {})

    if dimensions.get("album_arc", {}).get("score", 1.0) < 0.86:
        settings["arc_intensity"] = min(float(settings.get("arc_intensity", 1.0)) + 0.12, 1.8)
        return updated, {
            "applied": True,
            "dimension": "album_arc",
            "rationale": "Raised arc_intensity by 0.12 because rendered loudness did not follow the planned album shape closely enough.",
        }

    if dimensions.get("interlude_cohesion", {}).get("score", 1.0) < 0.90:
        settings["default_interlude_style"] = "auto"
        for transition in updated.get("transitions", []):
            transition["style"] = "auto"
            transition["duration_seconds"] = min(float(transition.get("duration_seconds", 8.0)) + 0.75, 18.0)
        return updated, {
            "applied": True,
            "dimension": "interlude_cohesion",
            "rationale": "Switched transitions to auto and lengthened each gap by 0.75s because connective material was underdeveloped.",
        }

    if dimensions.get("translation_safety", {}).get("score", 1.0) < 0.92:
        settings["tweak_lufs"] = float(settings.get("tweak_lufs", 0.0)) - 0.35
        return updated, {
            "applied": True,
            "dimension": "translation_safety",
            "rationale": "Lowered album loudness by 0.35 LU because true-peak safety was below threshold.",
        }

    if dimensions.get("preset_identity", {}).get("score", 1.0) < 0.85:
        settings["tweak_warmth"] = min(float(settings.get("tweak_warmth", 0.0)) + 0.015, 0.12)
        settings["tweak_air_db"] = float(settings.get("tweak_air_db", 0.0)) + 0.25
        return updated, {
            "applied": True,
            "dimension": "preset_identity",
            "rationale": "Kept the selected preset and added a small warmth/air move because preset identity scored too generic.",
        }

    if dimensions.get("genre_shift_handling", {}).get("score", 1.0) < 0.86:
        for transition in updated.get("transitions", []):
            transition["style"] = "auto"
            transition["duration_seconds"] = min(float(transition.get("duration_seconds", 8.0)) + 1.0, 18.0)
        return updated, {
            "applied": True,
            "dimension": "genre_shift_handling",
            "rationale": "Forced auto transition planning and added 1.0s because genre-shift handoffs need more planned connective tissue.",
        }

    return updated, {
        "applied": False,
        "rationale": "No single safe iteration move matched the current scorecard.",
    }


def _needs_iteration(scorecard: dict) -> bool:
    dimensions = scorecard.get("dimensions", {})
    thresholds = {
        "album_arc": 0.86,
        "interlude_cohesion": 0.90,
        "translation_safety": 0.92,
        "preset_identity": 0.85,
        "genre_shift_handling": 0.86,
    }
    return any(
        dimensions.get(name, {}).get("score", 1.0) < threshold
        for name, threshold in thresholds.items()
    )
