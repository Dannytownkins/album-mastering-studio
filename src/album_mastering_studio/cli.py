from __future__ import annotations

import argparse
import json
from pathlib import Path

from .arc import ARC_PRESETS
from .analysis import analyze_audio
from .audio_io import collect_audio_files, load_audio, write_audio
from .constants import DEFAULT_SAMPLE_RATE
from .dashboard import export_dashboard
from .iteration import iterate_project
from .mastering import PRESETS, live_preview_contract, render_live_preview_model
from .interludes import INTERLUDE_STYLE_CHOICES
from .pipeline import (
    RenderOptions,
    create_project,
    render_album,
    render_project,
    render_transition_preview,
)
from .standards import DELIVERY_PROFILES, delivery_profile


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="album-master",
        description="Master tracks and generate interludes for album sequencing.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    render = subparsers.add_parser("render", help="Render mastered tracks and interludes.")
    render.add_argument("inputs", nargs="+", type=Path, help="Audio files or folders to render.")
    render.add_argument("--output", "-o", type=Path, required=True, help="Output folder.")
    render.add_argument(
        "--preset",
        choices=sorted(PRESETS),
        default="streaming",
        help="Mastering preset.",
    )
    render.add_argument(
        "--format",
        dest="output_format",
        choices=["wav", "flac", "mp3", "m4a", "ogg", "opus"],
        default="wav",
        help="Output file format for tracks and interludes.",
    )
    render.add_argument("--sample-rate", type=int, default=48_000, help="Render sample rate.")
    render.add_argument("--bit-depth", type=int, choices=[16, 24, 32], default=24, help="WAV/intermediate export bit depth.")
    render.add_argument(
        "--delivery-profile",
        choices=sorted(DELIVERY_PROFILES),
        default="custom",
        help="Apply a standards-oriented delivery shortcut before manual overrides.",
    )
    render.add_argument("--no-codec-preview", action="store_true", help="Skip AAC/Opus round-trip QC preview for album WAV renders.")
    render.add_argument("--target-lufs", type=float, default=None, help="Optional album base LUFS target while preserving arc offsets.")
    render.add_argument("--ceiling-dbfs", type=float, default=None, help="Optional true-peak ceiling proxy in dBFS.")
    render.add_argument("--reference-track", type=Path, default=None, help="Optional reference track to analyze in the manifest.")
    render.add_argument(
        "--interlude-duration",
        type=float,
        default=8.0,
        help="Interlude duration in seconds.",
    )
    render.add_argument(
        "--interlude-style",
        choices=INTERLUDE_STYLE_CHOICES,
        default="auto",
        help="Generated interlude style. Use auto to derive it from surrounding tracks.",
    )
    render.add_argument(
        "--arc",
        choices=sorted(ARC_PRESETS),
        default="cinematic",
        help="Album-level emotional dynamic arc.",
    )
    render.add_argument("--arc-intensity", type=float, default=1.0, help="Strength of album arc movement.")
    render.add_argument("--tweak-lufs", type=float, default=0.0, help="Small album-wide LUFS offset.")
    render.add_argument("--tweak-brightness-db", type=float, default=0.0, help="Brightness tilt offset in dB.")
    render.add_argument("--tweak-warmth", type=float, default=0.0, help="Small saturation/warmth offset.")
    render.add_argument("--tweak-low-end-db", type=float, default=0.0, help="Small low-shelf weight offset in dB.")
    render.add_argument("--tweak-air-db", type=float, default=0.0, help="Small high-shelf air EQ offset in dB.")
    render.add_argument(
        "--tweak-presence-db",
        type=float,
        default=0.0,
        help="Small presence EQ offset around 3.2 kHz in dB.",
    )
    render.add_argument(
        "--tweak-width",
        type=float,
        default=0.0,
        help="Small stereo width offset, for example 0.05 or -0.05.",
    )
    render.add_argument("--tweak-intensity", type=float, default=0.0, help="Small compression/density offset.")
    render.add_argument("--tweak-limiter", type=float, default=0.0, help="Small limiter aggressiveness offset.")
    render.add_argument(
        "--album-wav",
        action="store_true",
        help="Also render a continuous album_sequence.wav file.",
    )
    render.add_argument("--json-events", action="store_true", help="Print newline-delimited JSON progress events during render.")

    init_project = subparsers.add_parser(
        "init-project",
        help="Create an editable album project JSON file from source tracks.",
    )
    init_project.add_argument("inputs", nargs="+", type=Path, help="Audio files or folders to add.")
    init_project.add_argument("--project", "-p", type=Path, required=True, help="Project JSON path.")
    init_project.add_argument("--title", default="Untitled Album", help="Album title.")
    init_project.add_argument(
        "--preset",
        choices=sorted(PRESETS),
        default="streaming",
        help="Default mastering preset.",
    )
    init_project.add_argument(
        "--format",
        dest="output_format",
        choices=["wav", "flac", "mp3", "m4a", "ogg", "opus"],
        default="wav",
        help="Default output format.",
    )
    init_project.add_argument("--sample-rate", type=int, default=48_000, help="Default render sample rate.")
    init_project.add_argument("--bit-depth", type=int, choices=[16, 24, 32], default=24, help="Default WAV/intermediate export bit depth.")
    init_project.add_argument(
        "--delivery-profile",
        choices=sorted(DELIVERY_PROFILES),
        default="custom",
        help="Apply a standards-oriented delivery shortcut before manual overrides.",
    )
    init_project.add_argument("--no-codec-preview", action="store_true", help="Disable AAC/Opus round-trip QC preview in the project.")
    init_project.add_argument("--target-lufs", type=float, default=None, help="Optional album base LUFS target while preserving arc offsets.")
    init_project.add_argument("--ceiling-dbfs", type=float, default=None, help="Optional true-peak ceiling proxy in dBFS.")
    init_project.add_argument("--reference-track", type=Path, default=None, help="Optional reference track to analyze in the manifest.")
    init_project.add_argument(
        "--interlude-duration",
        type=float,
        default=8.0,
        help="Default interlude duration in seconds.",
    )
    init_project.add_argument(
        "--interlude-style",
        choices=INTERLUDE_STYLE_CHOICES,
        default="auto",
        help="Default generated interlude style.",
    )
    init_project.add_argument(
        "--arc",
        choices=sorted(ARC_PRESETS),
        default="cinematic",
        help="Album-level emotional dynamic arc.",
    )
    init_project.add_argument("--arc-intensity", type=float, default=1.0, help="Strength of album arc movement.")
    init_project.add_argument("--tweak-lufs", type=float, default=0.0, help="Small album-wide LUFS offset.")
    init_project.add_argument("--tweak-brightness-db", type=float, default=0.0, help="Brightness tilt offset in dB.")
    init_project.add_argument("--tweak-warmth", type=float, default=0.0, help="Small saturation/warmth offset.")
    init_project.add_argument("--tweak-low-end-db", type=float, default=0.0, help="Small low-shelf weight offset in dB.")
    init_project.add_argument("--tweak-air-db", type=float, default=0.0, help="Small high-shelf air EQ offset in dB.")
    init_project.add_argument("--tweak-presence-db", type=float, default=0.0, help="Small presence EQ offset in dB.")
    init_project.add_argument("--tweak-width", type=float, default=0.0, help="Small stereo width offset.")
    init_project.add_argument("--tweak-intensity", type=float, default=0.0, help="Small compression/density offset.")
    init_project.add_argument("--tweak-limiter", type=float, default=0.0, help="Small limiter aggressiveness offset.")
    init_project.add_argument("--artist", default="", help="Default track/release artist metadata.")
    init_project.add_argument("--album-artist", default="", help="Album artist metadata.")
    init_project.add_argument("--genre", default="", help="Release genre metadata.")
    init_project.add_argument("--year", default="", help="Release year metadata.")
    init_project.add_argument("--upc", default="", help="Release UPC/EAN metadata.")
    init_project.add_argument("--notes", default="", help="Private release notes stored in the project manifest.")
    init_project.add_argument(
        "--album-wav",
        action="store_true",
        help="Set the project to render a continuous album_sequence.wav file.",
    )

    render_project_parser = subparsers.add_parser(
        "render-project",
        help="Render an editable album project JSON file.",
    )
    render_project_parser.add_argument("project", type=Path, help="Project JSON path.")
    render_project_parser.add_argument("--output", "-o", type=Path, required=True, help="Output folder.")
    render_project_parser.add_argument("--json-events", action="store_true", help="Print newline-delimited JSON progress events during render.")

    preview = subparsers.add_parser(
        "preview-transition",
        help="Render a short audition file for one project transition.",
    )
    preview.add_argument("project", type=Path, help="Project JSON path.")
    preview.add_argument(
        "--after-track",
        type=int,
        required=True,
        help="Preview the transition after this 1-based track index.",
    )
    preview.add_argument("--output", "-o", type=Path, required=True, help="Preview audio output path.")
    preview.add_argument("--tail-seconds", type=float, default=12.0, help="Seconds from the previous track tail.")
    preview.add_argument("--head-seconds", type=float, default=12.0, help="Seconds from the next track head.")

    score = subparsers.add_parser(
        "score-render",
        help="Score a completed render from its manifest and rendered audio.",
    )
    score.add_argument("manifest", type=Path, help="Render manifest.json path.")
    score.add_argument(
        "--scorer",
        choices=["auto", "local", "llm"],
        default="auto",
        help="Use local scoring, optional LLM scoring, or auto fallback.",
    )

    iterate = subparsers.add_parser(
        "iterate-project",
        help="Render, score, and adjust a project over multiple passes.",
    )
    iterate.add_argument("project", type=Path, help="Project JSON path.")
    iterate.add_argument("--output", "-o", type=Path, required=True, help="Iteration output folder.")
    iterate.add_argument("--passes", type=int, default=2, help="Number of render/score passes.")
    iterate.add_argument(
        "--scorer",
        choices=["auto", "local", "llm"],
        default="auto",
        help="Use local scoring, optional LLM scoring, or auto fallback.",
    )

    dashboard = subparsers.add_parser(
        "export-dashboard",
        help="Export a polished standalone HTML dashboard for a render.",
    )
    dashboard.add_argument("manifest", type=Path, help="Render manifest.json path.")
    dashboard.add_argument("--output", "-o", type=Path, required=True, help="Dashboard HTML output path.")

    analyze = subparsers.add_parser("analyze", help="Analyze source tracks without rendering.")
    analyze.add_argument("inputs", nargs="+", type=Path, help="Audio files or folders to analyze.")
    analyze.add_argument("--sample-rate", type=int, default=DEFAULT_SAMPLE_RATE, help="Analysis sample rate.")
    analyze.add_argument("--waveform-bins", type=int, default=128, help="Number of waveform thumbnail bins to include in JSON output.")

    preview_contract = subparsers.add_parser(
        "preview-contract",
        help="Print the engine-owned contract for the temporary live preview model.",
    )
    preview_contract.add_argument("--json", action="store_true", help="Print JSON. Included for explicit script usage.")

    preview_model = subparsers.add_parser(
        "preview-model",
        help="Render the engine-owned deterministic reference for the temporary live preview model.",
    )
    preview_model.add_argument("source", type=Path, help="Source audio file to model.")
    preview_model.add_argument("--output", "-o", type=Path, required=True, help="Output WAV path for the modeled preview.")
    preview_model.add_argument("--sample-rate", type=int, default=DEFAULT_SAMPLE_RATE, help="Model render sample rate.")
    preview_model.add_argument("--tuning-json", default=None, help="Inline JSON object or path to a JSON file with tuning values.")
    preview_model.add_argument("--bass-db", type=float, default=None, help="Modeled Low control in dB.")
    preview_model.add_argument("--mid-db", type=float, default=None, help="Modeled Mid/Presence control in dB.")
    preview_model.add_argument("--high-db", type=float, default=None, help="Modeled High/Air control in dB.")
    preview_model.add_argument("--width", type=float, default=None, help="Modeled Width control offset.")
    preview_model.add_argument("--intensity", type=float, default=None, help="Modeled Intensity control amount.")
    preview_model.add_argument("--start-seconds", type=float, default=0.0, help="Start time for a bounded model render.")
    preview_model.add_argument("--duration-seconds", type=float, default=None, help="Duration for a bounded model render.")

    app = subparsers.add_parser("app", help="Launch the local Windows desktop mastering studio.")
    app.add_argument("--output", "-o", type=Path, default=None, help="Default output folder for app renders.")

    smoke = subparsers.add_parser("smoke", help="Run product workflow smoke checks with synthetic audio.")
    smoke.add_argument("--output", "-o", type=Path, default=Path("test-output") / "smoke", help="Smoke output folder.")
    smoke.add_argument("--keep", action="store_true", help="Keep any existing smoke output folder contents.")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "render":
        options = _options_from_args(args)
        manifest = render_album(
            args.inputs,
            args.output,
            options,
            progress=_json_event_progress if args.json_events else None,
        )
        print(json.dumps(_render_summary(manifest), indent=2))
        return 0

    if args.command == "init-project":
        options = _options_from_args(args)
        project = create_project(
            args.inputs,
            args.project,
            options,
            album_title=args.title,
            metadata={
                "artist": args.artist,
                "album_artist": args.album_artist,
                "genre": args.genre,
                "release_year": args.year,
                "upc": args.upc,
                "notes": args.notes,
            },
        )
        print(
            json.dumps(
                {
                    "project": str(args.project),
                    "track_count": len(project["tracks"]),
                    "transition_count": len(project["transitions"]),
                },
                indent=2,
            )
        )
        return 0

    if args.command == "render-project":
        manifest = render_project(args.project, args.output, progress=_json_event_progress if args.json_events else None)
        print(json.dumps(_render_summary(manifest), indent=2))
        return 0

    if args.command == "preview-transition":
        summary = render_transition_preview(
            args.project,
            args.after_track,
            args.output,
            tail_seconds=args.tail_seconds,
            head_seconds=args.head_seconds,
        )
        print(json.dumps(summary, indent=2))
        return 0

    if args.command == "score-render":
        from .scoring import score_render

        scorecard = score_render(args.manifest, scorer=args.scorer)
        print(json.dumps({"overall": scorecard["overall"], "scorecard": str(args.manifest.parent / "scorecard.json")}, indent=2))
        return 0

    if args.command == "iterate-project":
        summary = iterate_project(args.project, args.output, passes=args.passes, scorer=args.scorer)
        print(
            json.dumps(
                {
                    "passes": len(summary["passes"]),
                    "last_overall": summary["passes"][-1]["overall"],
                    "summary": str(args.output / "iteration_summary.json"),
                },
                indent=2,
            )
        )
        return 0

    if args.command == "export-dashboard":
        summary = export_dashboard(args.manifest, args.output)
        print(json.dumps(summary, indent=2))
        return 0

    if args.command == "analyze":
        rows = []
        for path in collect_audio_files(args.inputs):
            samples = load_audio(path, args.sample_rate)
            rows.append(
                {
                    "source": str(path),
                    "analysis": analyze_audio(samples, args.sample_rate).to_dict(),
                    "waveform": _waveform(samples, bins=args.waveform_bins),
                }
            )
        print(json.dumps(rows, indent=2))
        return 0

    if args.command == "preview-contract":
        print(json.dumps(live_preview_contract(), indent=2))
        return 0

    if args.command == "preview-model":
        source = load_audio(args.source, args.sample_rate)
        source_total_frames = int(source.shape[0])
        source, source_start_seconds = _preview_model_window(
            source,
            args.sample_rate,
            args.start_seconds,
            args.duration_seconds,
        )
        tuning = _preview_tuning_from_args(args)
        result = render_live_preview_model(source, args.sample_rate, tuning)
        write_audio(args.output, result.samples, args.sample_rate, bit_depth=32, dither=False)
        contract = live_preview_contract()
        print(
            json.dumps(
                {
                    "source": str(args.source),
                    "output": str(args.output),
                    "sample_rate": args.sample_rate,
                    "frame_count": int(result.samples.shape[0]),
                    "source_total_frames": source_total_frames,
                    "source_start_seconds": source_start_seconds,
                    "duration_seconds": int(result.samples.shape[0]) / float(args.sample_rate),
                    "live_preview_engine": result.model_id,
                    "same_engine": False,
                    "preview_parity": result.preview_parity,
                    "export_faithful_preview_required": result.export_faithful_preview_required,
                    "modeled_controls": list(result.modeled_controls),
                    "modeled_width": result.modeled_width,
                    "modeled_drive": result.modeled_drive,
                    "tuning": result.tuning,
                    "normalized_tuning": result.normalized_tuning,
                    "unmodeled_export_stages": contract["unmodeledExportStages"],
                },
                indent=2,
            )
        )
        return 0

    if args.command == "app":
        from .app import main as app_main

        return app_main(default_output=args.output)

    if args.command == "smoke":
        from .smoke import run_smoke

        summary = run_smoke(args.output, clean=not args.keep)
        print(json.dumps(summary, indent=2))
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


def _render_summary(manifest: dict) -> dict:
    return {
        "track_count": manifest["track_count"],
        "interlude_count": manifest["interlude_count"],
        "album_sequence": manifest["album_sequence"],
        "manifest": "manifest.json",
    }


def _json_event_progress(event: dict) -> None:
    print(json.dumps(event, separators=(",", ":")), flush=True)


def _options_from_args(args) -> RenderOptions:
    profile = delivery_profile(args.delivery_profile)
    return RenderOptions(
        sample_rate=profile.sample_rate or args.sample_rate,
        preset=args.preset,
        output_format=profile.output_format or args.output_format,
        bit_depth=profile.bit_depth or args.bit_depth,
        delivery_profile=args.delivery_profile,
        codec_preview=(not args.no_codec_preview) and profile.codec_preview,
        target_lufs=args.target_lufs if args.target_lufs is not None else profile.target_lufs,
        ceiling_dbfs=args.ceiling_dbfs if args.ceiling_dbfs is not None else profile.ceiling_dbfs,
        interlude_duration=args.interlude_duration,
        interlude_style=args.interlude_style,
        arc=args.arc,
        arc_intensity=args.arc_intensity,
        tweak_lufs=args.tweak_lufs,
        tweak_brightness_db=args.tweak_brightness_db,
        tweak_warmth=args.tweak_warmth,
        tweak_low_end_db=args.tweak_low_end_db,
        tweak_air_db=args.tweak_air_db,
        tweak_presence_db=args.tweak_presence_db,
        tweak_width=args.tweak_width,
        tweak_intensity=args.tweak_intensity,
        tweak_limiter=args.tweak_limiter,
        album_wav=args.album_wav,
        reference_track=args.reference_track,
    )


def _preview_tuning_from_args(args) -> dict[str, float]:
    tuning: dict[str, float] = {}
    if args.tuning_json:
        raw = args.tuning_json
        try:
            loaded = json.loads(raw)
        except json.JSONDecodeError:
            loaded = json.loads(Path(raw).read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise ValueError("--tuning-json must be a JSON object.")
        for key, value in loaded.items():
            if isinstance(value, bool):
                continue
            tuning[str(key)] = float(value)

    for key, value in (
        ("bassDb", args.bass_db),
        ("midDb", args.mid_db),
        ("highDb", args.high_db),
        ("width", args.width),
        ("intensity", args.intensity),
    ):
        if value is not None:
            tuning[key] = float(value)
    return tuning


def _preview_model_window(samples, sample_rate: int, start_seconds: float | None, duration_seconds: float | None):
    frame_count = int(samples.shape[0])
    if frame_count <= 0:
        return samples, 0.0
    start = int(max(0.0, float(start_seconds or 0.0)) * sample_rate)
    start = min(start, max(frame_count - 1, 0))
    if duration_seconds is None or duration_seconds <= 0:
        end = frame_count
    else:
        requested = max(1, int(round(float(duration_seconds) * sample_rate)))
        end = min(frame_count, start + requested)
    if end <= start:
        end = min(frame_count, start + 1)
    return samples[start:end], start / float(sample_rate)


def _waveform(samples, bins: int = 128) -> list[float]:
    import numpy as np

    if samples.size == 0 or bins <= 0:
        return []
    mono = np.max(np.abs(samples), axis=1) if samples.ndim == 2 else np.abs(samples)
    edges = np.linspace(0, mono.size, bins + 1, dtype=int)
    chunks = []
    for start, end in zip(edges[:-1], edges[1:]):
        chunk = mono[start : max(end, start + 1)]
        chunks.append(float(chunk.max()) if chunk.size else 0.0)
    peak = max(chunks) if chunks else 0.0
    if peak <= 0.0:
        return chunks
    return [round(float(value / peak), 6) for value in chunks]


if __name__ == "__main__":
    raise SystemExit(main())
