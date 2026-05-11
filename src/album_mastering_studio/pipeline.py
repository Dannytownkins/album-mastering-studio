from __future__ import annotations

import json
import re
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np

from .analysis import analyze_audio
from .arc import AlbumArcPlan, build_album_arc
from .audio_io import collect_audio_files, load_audio, probe, write_audio
from .character import infer_album_characters
from .constants import DEFAULT_SAMPLE_RATE, MAX_TRACKS
from .interludes import INTERLUDE_STYLE_CHOICES, make_interlude
from .mastering import PRESETS, FineTune, MasterResult, apply_edge_treatment, limit_ceiling, master_track


@dataclass(frozen=True)
class RenderOptions:
    sample_rate: int = DEFAULT_SAMPLE_RATE
    preset: str = "streaming"
    output_format: str = "wav"
    target_lufs: float | None = None
    ceiling_dbfs: float | None = None
    interlude_duration: float = 8.0
    interlude_style: str = "auto"
    arc: str = "cinematic"
    arc_intensity: float = 1.0
    tweak_lufs: float = 0.0
    tweak_brightness_db: float = 0.0
    tweak_warmth: float = 0.0
    tweak_low_end_db: float = 0.0
    tweak_air_db: float = 0.0
    tweak_presence_db: float = 0.0
    tweak_width: float = 0.0
    tweak_intensity: float = 0.0
    tweak_limiter: float = 0.0
    album_wav: bool = False
    reference_track: Path | None = None


@dataclass(frozen=True)
class TrackSpec:
    path: Path
    title: str | None = None
    character: str | None = None
    preset: str | None = None


@dataclass(frozen=True)
class TransitionSpec:
    duration_seconds: float
    style: str
    enabled: bool = True


@dataclass(frozen=True)
class LoadedTrack:
    spec: TrackSpec
    samples: np.ndarray


def render_album(inputs: list[Path], output_dir: Path, options: RenderOptions) -> dict:
    tracks = collect_audio_files(inputs)
    track_specs = [TrackSpec(path=track) for track in tracks]
    transitions = [
        TransitionSpec(
            duration_seconds=options.interlude_duration,
            style=options.interlude_style,
            enabled=True,
        )
        for _ in range(max(len(track_specs) - 1, 0))
    ]
    return render_sequence(track_specs, output_dir, options, transitions, project_path=None, album_title=None)


def render_project(project_path: Path, output_dir: Path) -> dict:
    project = load_project(project_path)
    base_dir = project_path.resolve().parent
    settings = project.get("settings", {})
    options = RenderOptions(
        sample_rate=int(settings.get("sample_rate", DEFAULT_SAMPLE_RATE)),
        preset=str(settings.get("preset", "streaming")),
        output_format=str(settings.get("output_format", "wav")),
        target_lufs=_optional_float(settings.get("target_lufs")),
        ceiling_dbfs=_optional_float(settings.get("ceiling_dbfs")),
        interlude_duration=float(settings.get("default_interlude_duration", 8.0)),
        interlude_style=str(settings.get("default_interlude_style", "auto")).strip().lower(),
        arc=str(settings.get("arc", "cinematic")).strip().lower(),
        arc_intensity=float(settings.get("arc_intensity", 1.0)),
        tweak_lufs=float(_optional_float(settings.get("tweak_lufs")) or 0.0),
        tweak_brightness_db=float(settings.get("tweak_brightness_db", 0.0)),
        tweak_warmth=float(settings.get("tweak_warmth", 0.0)),
        tweak_low_end_db=float(settings.get("tweak_low_end_db", 0.0)),
        tweak_air_db=float(settings.get("tweak_air_db", 0.0)),
        tweak_presence_db=float(settings.get("tweak_presence_db", 0.0)),
        tweak_width=float(settings.get("tweak_width", 0.0)),
        tweak_intensity=float(settings.get("tweak_intensity", 0.0)),
        tweak_limiter=float(settings.get("tweak_limiter", 0.0)),
        album_wav=bool(settings.get("album_wav", False)),
        reference_track=_optional_project_path(base_dir, settings.get("reference_track")),
    )

    track_specs = [
        TrackSpec(
            path=_resolve_project_path(base_dir, Path(track["path"])),
            title=track.get("title"),
            character=track.get("character"),
            preset=track.get("preset"),
        )
        for track in project.get("tracks", [])
    ]
    if not track_specs:
        raise ValueError(f"Project has no tracks: {project_path}")

    transitions = _project_transitions(project, options, len(track_specs))
    return render_sequence(
        track_specs,
        output_dir,
        options,
        transitions,
        project_path=project_path,
        album_title=project.get("album_title"),
    )


def render_transition_preview(
    project_path: Path,
    after_track: int,
    output_path: Path,
    tail_seconds: float = 12.0,
    head_seconds: float = 12.0,
) -> dict:
    project = load_project(project_path)
    base_dir = project_path.resolve().parent
    settings = project.get("settings", {})
    options = RenderOptions(
        sample_rate=int(settings.get("sample_rate", DEFAULT_SAMPLE_RATE)),
        preset=str(settings.get("preset", "streaming")),
        output_format=output_path.suffix.lower().lstrip(".") or str(settings.get("output_format", "wav")),
        target_lufs=_optional_float(settings.get("target_lufs")),
        ceiling_dbfs=_optional_float(settings.get("ceiling_dbfs")),
        interlude_duration=float(settings.get("default_interlude_duration", 8.0)),
        interlude_style=str(settings.get("default_interlude_style", "auto")).strip().lower(),
        arc=str(settings.get("arc", "cinematic")).strip().lower(),
        arc_intensity=float(settings.get("arc_intensity", 1.0)),
        tweak_lufs=float(_optional_float(settings.get("tweak_lufs")) or 0.0),
        tweak_brightness_db=float(settings.get("tweak_brightness_db", 0.0)),
        tweak_warmth=float(settings.get("tweak_warmth", 0.0)),
        tweak_low_end_db=float(settings.get("tweak_low_end_db", 0.0)),
        tweak_air_db=float(settings.get("tweak_air_db", 0.0)),
        tweak_presence_db=float(settings.get("tweak_presence_db", 0.0)),
        tweak_width=float(settings.get("tweak_width", 0.0)),
        tweak_intensity=float(settings.get("tweak_intensity", 0.0)),
        tweak_limiter=float(settings.get("tweak_limiter", 0.0)),
        album_wav=False,
        reference_track=_optional_project_path(base_dir, settings.get("reference_track")),
    )

    track_specs = [
        TrackSpec(
            path=_resolve_project_path(base_dir, Path(track["path"])),
            title=track.get("title"),
            character=track.get("character"),
            preset=track.get("preset"),
        )
        for track in project.get("tracks", [])
    ]
    if after_track < 1 or after_track >= len(track_specs):
        raise ValueError(f"after_track must be between 1 and {len(track_specs) - 1}")

    loaded = _load_tracks(track_specs, options.sample_rate)
    source_stats = [analyze_audio(track.samples, options.sample_rate) for track in loaded]
    characters = infer_album_characters(
        source_stats,
        [track.spec.title or track.spec.path.stem for track in loaded],
        [track.spec.character for track in loaded],
    )
    arc_plan = build_album_arc(
        source_stats,
        PRESETS[options.preset],
        options.arc,
        options.interlude_duration,
        options.interlude_style,
        options.arc_intensity,
        characters=characters,
    )
    transitions = _resolve_transition_plan(_project_transitions(project, options, len(track_specs)), arc_plan)
    transition = transitions[after_track - 1]
    left = track_specs[after_track - 1]
    right = track_specs[after_track]
    fine_tune = _fine_tune(options)
    left_preset = _track_preset_name(left, options)
    right_preset = _track_preset_name(right, options)
    left_result = master_track(
        loaded[after_track - 1].samples,
        options.sample_rate,
        left_preset,
        target_lufs=_target_lufs_for_track(arc_plan.tracks[after_track - 1].target_lufs, options, PRESETS[options.preset]),
        fine_tune=_combine_fine_tune(fine_tune, arc_plan.tracks[after_track - 1].mastering),
    )
    right_result = master_track(
        loaded[after_track].samples,
        options.sample_rate,
        right_preset,
        target_lufs=_target_lufs_for_track(arc_plan.tracks[after_track].target_lufs, options, PRESETS[options.preset]),
        fine_tune=_combine_fine_tune(fine_tune, arc_plan.tracks[after_track].mastering),
    )
    transition_arc = arc_plan.transitions[after_track - 1]
    left_master = _shape_master_edges(
        left_result,
        options.sample_rate,
        head_treatment=None,
        tail_treatment=transition_arc.tail_treatment,
    ).samples
    right_master = _shape_master_edges(
        right_result,
        options.sample_rate,
        head_treatment=transition_arc.head_treatment,
        tail_treatment=None,
    ).samples

    chunks = [
        _tail(left_master, options.sample_rate, tail_seconds),
    ]
    if transition.enabled:
        chunks.append(
            make_interlude(
                left_master,
                right_master,
                options.sample_rate,
                transition.duration_seconds,
                transition.style,
                target_lufs=_transition_target_lufs(left_result.after.integrated_lufs, right_result.after.integrated_lufs, transition.style),
                ceiling_dbfs=_interlude_ceiling(options),
            )
        )
    chunks.append(_head(right_master, options.sample_rate, head_seconds))

    preview = np.concatenate(chunks, axis=0).astype(np.float32)
    write_audio(output_path, preview, options.sample_rate)
    return {
        "project": str(project_path),
        "output": str(output_path),
        "between": [after_track, after_track + 1],
        "left": str(left.path),
        "right": str(right.path),
        "transition_enabled": transition.enabled,
        "style": transition.style if transition.enabled else None,
        "interlude_duration_seconds": transition.duration_seconds if transition.enabled else 0.0,
        "tail_seconds": tail_seconds,
        "head_seconds": head_seconds,
        "duration_seconds": preview.shape[0] / options.sample_rate,
    }


def render_sequence(
    tracks: list[TrackSpec],
    output_dir: Path,
    options: RenderOptions,
    transitions: list[TransitionSpec],
    project_path: Path | None,
    album_title: str | None,
) -> dict:
    if len(tracks) > MAX_TRACKS:
        raise ValueError(f"Album Mastering Studio supports up to {MAX_TRACKS} tracks per render.")
    output_dir.mkdir(parents=True, exist_ok=True)
    masters_dir = output_dir / "masters"
    interludes_dir = output_dir / "interludes"
    masters_dir.mkdir(parents=True, exist_ok=True)
    interludes_dir.mkdir(parents=True, exist_ok=True)

    loaded_tracks = _load_tracks(tracks, options.sample_rate)
    source_stats = [analyze_audio(track.samples, options.sample_rate) for track in loaded_tracks]
    warnings: list[str] = []
    reference = _reference_report(options.reference_track, options.sample_rate)
    if reference and reference.get("warning"):
        warnings.append(f"Reference: {reference['warning']}")
    characters = infer_album_characters(
        source_stats,
        [track.spec.title or track.spec.path.stem for track in loaded_tracks],
        [track.spec.character for track in loaded_tracks],
    )
    preset = PRESETS[options.preset]
    arc_plan = build_album_arc(
        source_stats,
        preset,
        options.arc,
        options.interlude_duration,
        options.interlude_style,
        options.arc_intensity,
        characters=characters,
    )
    transitions = _resolve_transition_plan(transitions, arc_plan)

    mastered: list[tuple[TrackSpec, np.ndarray, MasterResult, dict]] = []
    fine_tune = _fine_tune(options)

    for index, loaded in enumerate(loaded_tracks, start=1):
        track = loaded.spec
        source = track.path
        track_arc = arc_plan.tracks[index - 1].to_dict()
        head_treatment = arc_plan.transitions[index - 2].head_treatment if index > 1 else None
        tail_treatment = arc_plan.transitions[index - 1].tail_treatment if index <= len(arc_plan.transitions) else None
        track_preset = _track_preset_name(track, options)
        result = master_track(
            loaded.samples,
            options.sample_rate,
            track_preset,
            target_lufs=_target_lufs_for_track(arc_plan.tracks[index - 1].target_lufs, options, preset),
            fine_tune=_combine_fine_tune(fine_tune, arc_plan.tracks[index - 1].mastering),
        )
        result = _shape_master_edges(
            result,
            options.sample_rate,
            head_treatment=head_treatment,
            tail_treatment=tail_treatment,
        )
        title = track.title or source.stem
        output_path = masters_dir / f"{index:02d}_{_slug(title)}_mastered.{options.output_format}"
        write_audio(output_path, result.samples, options.sample_rate)
        mastered.append((track, result.samples, result, track_arc))

    sequence: list[dict] = []
    for index, (track, audio, result, track_arc) in enumerate(mastered, start=1):
        source = track.path
        title = track.title or source.stem
        output_path = masters_dir / f"{index:02d}_{_slug(title)}_mastered.{options.output_format}"
        track_warnings = _track_warnings(title, result.before, result.after, result.ceiling_dbfs, result.target_lufs, result.applied_gain_db)
        warnings.extend(f"Track {index}: {warning}" for warning in track_warnings)
        sequence.append(
            {
                "type": "track",
                "index": index,
                "title": track.title,
                "source": str(source),
                "output": str(output_path),
                "probe": _safe_probe(source),
                "selected_preset": _track_preset_name(track, options),
                "character": track_arc["character"],
                "before": result.before.to_dict(),
                "after": result.after.to_dict(),
                "applied_gain_db": result.applied_gain_db,
                "preset": result.preset.to_dict(),
                "ceiling_dbfs": result.ceiling_dbfs,
                "arc": track_arc,
                "mastering_moves": track_arc["mastering"],
                "edge_treatments": {
                    "head": arc_plan.transitions[index - 2].head_treatment if index > 1 else None,
                    "tail": arc_plan.transitions[index - 1].tail_treatment if index <= len(arc_plan.transitions) else None,
                },
                "warnings": track_warnings,
                "rationale": track_arc["rationale"],
            }
        )

        if index <= len(mastered) - 1:
            transition = transitions[index - 1]
            if transition.enabled:
                left_track, left_audio, _, _ = mastered[index - 1]
                right_track, right_audio, _, _ = mastered[index]
                transition_arc = arc_plan.transitions[index - 1].to_dict()
                interlude = make_interlude(
                    left_audio,
                    right_audio,
                    options.sample_rate,
                    transition.duration_seconds,
                    transition.style,
                    target_lufs=_transition_target_lufs(
                        result.after.integrated_lufs,
                        mastered[index][2].after.integrated_lufs,
                        transition.style,
                    ),
                    ceiling_dbfs=_interlude_ceiling(options),
                )
                interlude_stats = analyze_audio(interlude, options.sample_rate)
                interlude_warnings = _interlude_warnings(index, interlude_stats, transition.style)
                warnings.extend(f"Transition {index}->{index + 1}: {warning}" for warning in interlude_warnings)
                output_path = (
                    interludes_dir
                    / f"{index:02d}_to_{index + 1:02d}_{transition.style}_{_slug(left_track.path.stem)}_into_{_slug(right_track.path.stem)}.{options.output_format}"
                )
                write_audio(output_path, interlude, options.sample_rate)
                sequence.append(
                    {
                        "type": "interlude",
                        "between": [index, index + 1],
                        "output": str(output_path),
                        "duration_seconds": transition.duration_seconds,
                        "style": transition.style,
                        "handoff": transition_arc["handoff"],
                        "analysis": interlude_stats.to_dict(),
                        "tail_treatment": transition_arc["tail_treatment"],
                        "head_treatment": transition_arc["head_treatment"],
                        "arc": {
                            **transition_arc,
                            "rendered_style": transition.style,
                            "rendered_duration_seconds": transition.duration_seconds,
                        },
                        "warnings": interlude_warnings,
                        "rationale": _actual_transition_rationale(transition_arc, transition),
                    }
                )

    album_path: Path | None = None
    if options.album_wav:
        album_path = output_dir / "album_sequence.wav"
        album_audio = _build_album_sequence(mastered, options, transitions)
        write_audio(album_path, album_audio, options.sample_rate)
        album_analysis = analyze_audio(album_audio, options.sample_rate)
        album_warnings = _album_warnings(album_analysis, options.ceiling_dbfs)
        warnings.extend(f"Album: {warning}" for warning in album_warnings)
    else:
        album_analysis = None
        album_warnings = []

    manifest = {
        "version": 1,
        "settings": {
            "sample_rate": options.sample_rate,
            "preset": options.preset,
            "output_format": options.output_format,
            "target_lufs": options.target_lufs,
            "ceiling_dbfs": options.ceiling_dbfs,
            "interlude_duration": options.interlude_duration,
            "interlude_style": options.interlude_style,
            "arc": options.arc,
            "arc_intensity": options.arc_intensity,
            "tweak_lufs": options.tweak_lufs,
            "tweak_brightness_db": options.tweak_brightness_db,
            "tweak_warmth": options.tweak_warmth,
            "tweak_low_end_db": options.tweak_low_end_db,
            "tweak_air_db": options.tweak_air_db,
            "tweak_presence_db": options.tweak_presence_db,
            "tweak_width": options.tweak_width,
            "tweak_intensity": options.tweak_intensity,
            "tweak_limiter": options.tweak_limiter,
            "album_wav": options.album_wav,
            "reference_track": str(options.reference_track) if options.reference_track else None,
        },
        "reference": reference,
        "album_title": album_title,
        "album_story": _album_story(arc_plan),
        "arc": arc_plan.to_dict(),
        "project": str(project_path) if project_path else None,
        "track_count": len(mastered),
        "interlude_count": sum(1 for item in sequence if item["type"] == "interlude"),
        "album_sequence": str(album_path) if album_path else None,
        "album_analysis": album_analysis.to_dict() if album_analysis else None,
        "outputs": {
            "manifest": str(output_dir / "manifest.json"),
            "album_sequence": str(album_path) if album_path else None,
            "masters_dir": str(masters_dir),
            "interludes_dir": str(interludes_dir),
        },
        "warnings": warnings,
        "album_warnings": album_warnings,
        "sequence": sequence,
        "decision_log": _decision_log(arc_plan, sequence),
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def create_project(
    inputs: list[Path],
    project_path: Path,
    options: RenderOptions,
    album_title: str = "Untitled Album",
) -> dict:
    tracks = collect_audio_files(inputs)
    if len(tracks) > MAX_TRACKS:
        raise ValueError(f"Album Mastering Studio supports up to {MAX_TRACKS} tracks per project.")
    base_dir = project_path.resolve().parent
    project = {
        "version": 1,
        "album_title": album_title,
        "settings": {
            "sample_rate": options.sample_rate,
            "preset": options.preset,
            "output_format": options.output_format,
            "target_lufs": options.target_lufs,
            "ceiling_dbfs": options.ceiling_dbfs,
            "default_interlude_duration": options.interlude_duration,
            "default_interlude_style": options.interlude_style,
            "arc": options.arc,
            "arc_intensity": options.arc_intensity,
            "tweak_lufs": options.tweak_lufs,
            "tweak_brightness_db": options.tweak_brightness_db,
            "tweak_warmth": options.tweak_warmth,
            "tweak_low_end_db": options.tweak_low_end_db,
            "tweak_air_db": options.tweak_air_db,
            "tweak_presence_db": options.tweak_presence_db,
            "tweak_width": options.tweak_width,
            "tweak_intensity": options.tweak_intensity,
            "tweak_limiter": options.tweak_limiter,
            "album_wav": options.album_wav,
            "reference_track": str(options.reference_track) if options.reference_track else None,
        },
        "tracks": [
            {
                "path": _project_relative_path(base_dir, track),
                "title": track.stem,
                "character": "auto",
                "preset": "auto",
            }
            for track in tracks
        ],
        "transitions": [
            {
                "after_track": index,
                "duration_seconds": options.interlude_duration,
                "style": options.interlude_style,
                "enabled": True,
            }
            for index in range(1, len(tracks))
        ],
    }
    project_path.parent.mkdir(parents=True, exist_ok=True)
    project_path.write_text(json.dumps(project, indent=2), encoding="utf-8")
    return project


def load_project(project_path: Path) -> dict:
    project = json.loads(project_path.read_text(encoding="utf-8"))
    if int(project.get("version", 0)) != 1:
        raise ValueError(f"Unsupported project version in {project_path}")
    return project


def _build_album_sequence(
    mastered: list[tuple[TrackSpec, np.ndarray, MasterResult, dict]],
    options: RenderOptions,
    transitions: list[TransitionSpec],
) -> np.ndarray:
    chunks: list[np.ndarray] = []
    for index, (_, audio, _, _) in enumerate(mastered):
        chunks.append(audio)
        if index < len(mastered) - 1:
            transition = transitions[index] if index < len(transitions) else TransitionSpec(
                duration_seconds=options.interlude_duration,
                style=options.interlude_style,
                enabled=True,
            )
            if not transition.enabled:
                continue
            chunks.append(
                make_interlude(
                    audio,
                    mastered[index + 1][1],
                    options.sample_rate,
                    transition.duration_seconds,
                    transition.style,
                    target_lufs=_transition_target_lufs(
                        mastered[index][2].after.integrated_lufs,
                        mastered[index + 1][2].after.integrated_lufs,
                        transition.style,
                    ),
                    ceiling_dbfs=_interlude_ceiling(options),
                )
            )

    if not chunks:
        return np.zeros((0, 2), dtype=np.float32)
    return np.concatenate(chunks, axis=0).astype(np.float32)


def _project_transitions(project: dict, options: RenderOptions, track_count: int) -> list[TransitionSpec]:
    transitions = [
        TransitionSpec(
            duration_seconds=options.interlude_duration,
            style=options.interlude_style,
            enabled=True,
        )
        for _ in range(max(track_count - 1, 0))
    ]
    for raw in project.get("transitions", []):
        after_track = int(raw.get("after_track", 0))
        if after_track < 1 or after_track >= track_count:
            raise ValueError(f"Invalid transition after_track value: {after_track}")

        style = str(raw.get("style", options.interlude_style)).strip().lower()
        if style == "inherit":
            style = options.interlude_style
        if style not in INTERLUDE_STYLE_CHOICES:
            choices = ", ".join(INTERLUDE_STYLE_CHOICES)
            raise ValueError(f"Unknown interlude style '{style}'. Choose one of: {choices}")

        transitions[after_track - 1] = TransitionSpec(
            duration_seconds=float(raw.get("duration_seconds", options.interlude_duration)),
            style=style,
            enabled=bool(raw.get("enabled", True)),
        )
    return transitions


def _load_tracks(tracks: list[TrackSpec], sample_rate: int) -> list[LoadedTrack]:
    return [LoadedTrack(spec=track, samples=load_audio(track.path, sample_rate)) for track in tracks]


def _resolve_transition_plan(transitions: list[TransitionSpec], arc_plan: AlbumArcPlan) -> list[TransitionSpec]:
    resolved: list[TransitionSpec] = []
    for index, transition in enumerate(transitions):
        if index >= len(arc_plan.transitions):
            resolved.append(transition)
            continue
        planned = arc_plan.transitions[index]
        resolved.append(
            TransitionSpec(
                duration_seconds=max(planned.duration_seconds, transition.duration_seconds)
                if transition.style == "auto"
                else transition.duration_seconds,
                style=planned.style if transition.style == "auto" else transition.style,
                enabled=transition.enabled,
            )
        )
    return resolved


def _fine_tune(options: RenderOptions) -> FineTune:
    return FineTune(
        ceiling_dbfs=options.ceiling_dbfs,
        brightness_db_offset=options.tweak_brightness_db,
        warmth_offset=options.tweak_warmth,
        low_end_db_offset=options.tweak_low_end_db,
        air_db_offset=options.tweak_air_db,
        presence_db_offset=options.tweak_presence_db,
        width_offset=options.tweak_width,
        intensity_offset=options.tweak_intensity,
        limiter_aggressiveness_offset=options.tweak_limiter,
    )


def _combine_fine_tune(base: FineTune, mastering: dict) -> FineTune:
    return FineTune(
        lufs_offset=base.lufs_offset,
        ceiling_dbfs=base.ceiling_dbfs,
        brightness_db_offset=base.brightness_db_offset,
        warmth_offset=base.warmth_offset + float(mastering.get("warmth_offset", 0.0)),
        low_end_db_offset=base.low_end_db_offset + float(mastering.get("low_end_db", 0.0)),
        low_mid_db_offset=base.low_mid_db_offset + float(mastering.get("low_mid_db", 0.0)),
        air_db_offset=base.air_db_offset + float(mastering.get("air_db", 0.0)),
        presence_db_offset=base.presence_db_offset + float(mastering.get("presence_db", 0.0)),
        width_offset=base.width_offset + float(mastering.get("width_offset", 0.0)),
        intensity_offset=base.intensity_offset + float(mastering.get("intensity_offset", 0.0)),
        limiter_aggressiveness_offset=base.limiter_aggressiveness_offset,
    )


def _shape_master_edges(
    result: MasterResult,
    sample_rate: int,
    head_treatment: dict | None,
    tail_treatment: dict | None,
) -> MasterResult:
    shaped = apply_edge_treatment(
        result.samples,
        sample_rate,
        head_treatment=head_treatment,
        tail_treatment=tail_treatment,
    )
    shaped = limit_ceiling(shaped, result.ceiling_dbfs, sample_rate=sample_rate)
    after = analyze_audio(shaped, sample_rate)
    gain_delta = after.integrated_lufs - result.after.integrated_lufs
    applied_gain = result.applied_gain_db + (gain_delta if np.isfinite(gain_delta) else 0.0)
    return replace(result, samples=shaped, after=after, applied_gain_db=applied_gain)


def _album_story(arc_plan: AlbumArcPlan) -> str:
    labels = [track.character["display_name"] for track in arc_plan.tracks]
    condensed: list[str] = []
    for label in labels:
        if not condensed or condensed[-1] != label:
            condensed.append(label)
    journey = " -> ".join(condensed)
    return (
        f"{arc_plan.display_name} shapes the album as {journey}, with loudness and density moving by role rather than a flat target."
    )


def _decision_log(arc_plan: AlbumArcPlan, sequence: list[dict]) -> dict[str, list[str]]:
    track_decisions = [
        item["rationale"]
        for item in sequence
        if item.get("type") == "track" and item.get("rationale")
    ]
    transition_decisions = [
        item["rationale"]
        for item in sequence
        if item.get("type") == "interlude" and item.get("rationale")
    ]
    edge_decisions = []
    for transition in arc_plan.transitions:
        edge_decisions.append(f"Track {transition.after_track} tail: {transition.tail_treatment['rationale']}")
        edge_decisions.append(f"Track {transition.after_track + 1} head: {transition.head_treatment['rationale']}")
    return {
        "album": [_album_story(arc_plan)],
        "tracks": track_decisions,
        "transitions": transition_decisions,
        "edge_mastering": edge_decisions,
    }


def _actual_transition_rationale(transition_arc: dict, transition: TransitionSpec) -> str:
    rationale = str(transition_arc["rationale"])
    if transition.style == transition_arc["style"] and transition.duration_seconds == transition_arc["duration_seconds"]:
        return rationale
    return (
        f"{rationale} Rendered with project override {transition.style} for {transition.duration_seconds:.1f}s."
    )


def _safe_probe(path: Path) -> dict | None:
    try:
        return probe(path)
    except Exception:
        return None


def _reference_report(path: Path | None, sample_rate: int) -> dict | None:
    if path is None:
        return None
    report: dict = {"path": str(path)}
    try:
        samples = load_audio(path, sample_rate)
        report["analysis"] = analyze_audio(samples, sample_rate).to_dict()
        report["probe"] = _safe_probe(path)
    except Exception as exc:
        report["warning"] = f"could not analyze reference track {path}: {exc}"
    return report


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "track"


def _tail(samples: np.ndarray, sample_rate: int, seconds: float) -> np.ndarray:
    frames = max(int(sample_rate * seconds), 0)
    return samples[-frames:] if frames else samples[:0]


def _head(samples: np.ndarray, sample_rate: int, seconds: float) -> np.ndarray:
    frames = max(int(sample_rate * seconds), 0)
    return samples[:frames] if frames else samples[:0]


def _resolve_project_path(base_dir: Path, path: Path) -> Path:
    return path if path.is_absolute() else base_dir / path


def _optional_project_path(base_dir: Path, value: object) -> Path | None:
    if value is None or str(value).strip().lower() in {"", "auto"}:
        return None
    return _resolve_project_path(base_dir, Path(str(value)))


def _project_relative_path(base_dir: Path, path: Path) -> str:
    try:
        return str(path.resolve().relative_to(base_dir))
    except ValueError:
        return str(path)


def _optional_float(value: object) -> float | None:
    if value is None or str(value).strip().lower() in {"", "auto"}:
        return None
    return float(value)


def _track_preset_name(track: TrackSpec, options: RenderOptions) -> str:
    candidate = (track.preset or "auto").strip()
    if candidate in {"", "auto"}:
        candidate = options.preset
    if candidate not in PRESETS:
        choices = ", ".join(sorted(PRESETS))
        raise ValueError(f"Unknown track preset '{candidate}' for {track.path}. Choose one of: {choices}")
    return candidate


def _target_lufs_for_track(planned_lufs: float, options: RenderOptions, preset) -> float:
    target = planned_lufs
    if options.target_lufs is not None:
        target += float(options.target_lufs) - float(preset.target_lufs)
    return target + options.tweak_lufs


def _track_warnings(title: str, before, after, ceiling_dbfs: float, target_lufs: float, applied_gain_db: float) -> list[str]:
    warnings: list[str] = []
    if before.peak_dbfs > -0.1 or before.true_peak_dbfs > -0.1:
        warnings.append("source is near 0 dBFS; inspect for clipping before trusting a loud master")
    if before.crest_factor_db < 4.0:
        warnings.append("source is already very dense, so limiter pressure may reveal distortion")
    if after.true_peak_dbfs > ceiling_dbfs + 0.15:
        warnings.append(
            f"rendered true-peak proxy {after.true_peak_dbfs:.2f} dBFS is above the requested ceiling {ceiling_dbfs:.2f} dBFS"
        )
    if after.integrated_lufs > -8.5:
        warnings.append("rendered loudness is extremely hot for an album master")
    if abs(applied_gain_db) >= 17.95 and abs(after.integrated_lufs - target_lufs) > 2.0:
        warnings.append("rendered loudness may be far from the requested target")
    if after.stereo_correlation is not None and after.stereo_correlation < -0.25:
        warnings.append("stereo correlation is strongly negative; mono compatibility may suffer")
    if not _stats_are_finite(after):
        warnings.append("rendered analysis contains non-finite values")
    return [f"{title}: {warning}" for warning in warnings]


def _transition_target_lufs(left_lufs: float, right_lufs: float, style: str) -> float:
    adjacent = (float(left_lufs) + float(right_lufs)) * 0.5
    offsets = {
        "crossfade": -2.0,
        "rhythmic": -3.0,
        "pulsed-swell": -3.0,
        "tape": -3.0,
        "noise-riser": -3.5,
        "filtered-fade": -4.0,
        "reverse-swell": -4.0,
        "sub-drop": -4.0,
        "tape-stop": -4.0,
        "swell": -5.0,
        "ring-out": -5.5,
        "ambient": -6.0,
        "drone-pad": -6.0,
        "minimal": -7.0,
        "breath-gap": -12.0,
    }
    target = adjacent + offsets.get(style, -5.0)
    lower = min(float(left_lufs), float(right_lufs)) - 12.0
    upper = max(float(left_lufs), float(right_lufs)) - 1.5
    return float(np.clip(target, lower, upper))


def _interlude_warnings(index: int, stats, style: str) -> list[str]:
    warnings: list[str] = []
    if style != "hard-cut" and stats.integrated_lufs < -65.0:
        warnings.append("transition is almost silent; verify that this is intentional")
    if stats.true_peak_dbfs > -1.0:
        warnings.append("transition true-peak proxy is close to the ceiling")
    if not _stats_are_finite(stats):
        warnings.append("transition analysis contains non-finite values")
    return [f"after track {index}: {warning}" for warning in warnings]


def _interlude_ceiling(options: RenderOptions) -> float:
    return float(options.ceiling_dbfs if options.ceiling_dbfs is not None else -1.0)


def _album_warnings(stats, ceiling_dbfs: float | None) -> list[str]:
    warnings: list[str] = []
    ceiling = ceiling_dbfs if ceiling_dbfs is not None else -0.8
    if stats.true_peak_dbfs > ceiling + 0.2:
        warnings.append(
            f"continuous album true-peak proxy {stats.true_peak_dbfs:.2f} dBFS is above the safety ceiling {ceiling:.2f} dBFS"
        )
    if stats.integrated_lufs > -8.5:
        warnings.append("continuous album loudness is extremely hot")
    if not _stats_are_finite(stats):
        warnings.append("continuous album analysis contains non-finite values")
    return warnings


def _stats_are_finite(stats) -> bool:
    values = [
        stats.duration_seconds,
        stats.peak_dbfs,
        stats.true_peak_dbfs,
        stats.rms_dbfs,
        stats.integrated_lufs,
        stats.crest_factor_db,
        stats.dynamic_range_db,
        stats.stereo_width,
        stats.spectral_centroid_hz,
        stats.transient_density,
        stats.energy_density,
    ]
    return all(np.isfinite(value) for value in values)
