from __future__ import annotations

import json
import os
import queue
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .arc import ARC_PRESETS
from .analysis import analyze_audio
from .audio_io import AUDIO_EXTENSIONS, load_audio, probe
from .character import CHARACTER_LABELS
from .dashboard import export_dashboard
from .interludes import INTERLUDE_STYLE_CHOICES
from .mastering import PRESETS
from .pipeline import render_project, render_transition_preview
from .scoring import score_render


@dataclass
class TrackState:
    path: Path
    title: str
    character: str = "auto"
    preset: str = "auto"
    analysis: dict[str, Any] | None = None
    probe: dict[str, Any] | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class TransitionState:
    style: str = "auto"
    duration_seconds: float = 8.0
    enabled: bool = True


def main(default_output: Path | None = None) -> int:
    root = tk.Tk()
    MasteringStudioApp(root, default_output=default_output)
    root.mainloop()
    return 0


class MasteringStudioApp:
    def __init__(self, root: tk.Tk, default_output: Path | None = None) -> None:
        self.root = root
        self.root.title("Album Mastering Studio")
        self.root.geometry("1280x820")
        self.queue: queue.Queue[tuple] = queue.Queue()
        self.tracks: list[TrackState] = []
        self.transitions: list[TransitionState] = []
        self.busy = False
        self.last_output_dir: Path | None = None
        self.last_dashboard_path: Path | None = None

        default_output = default_output or (Path.cwd() / "outputs" / "studio-render")
        self.album_title = tk.StringVar(value="Untitled Album")
        self.output_dir = tk.StringVar(value=str(default_output))
        self.sample_rate = tk.IntVar(value=48_000)
        self.preset = tk.StringVar(value=_preset_choice("album-cohesion-cinematic"))
        self.arc = tk.StringVar(value=_arc_choice("cinematic"))
        self.arc_intensity = tk.DoubleVar(value=1.0)
        self.output_format = tk.StringVar(value="wav")
        self.transition_style = tk.StringVar(value="auto")
        self.transition_duration = tk.DoubleVar(value=8.0)
        self.target_lufs = tk.StringVar(value="")
        self.ceiling_dbfs = tk.StringVar(value="-1.0")
        self.brightness = tk.DoubleVar(value=0.0)
        self.bass_weight = tk.DoubleVar(value=0.0)
        self.mid_presence = tk.DoubleVar(value=0.0)
        self.air = tk.DoubleVar(value=0.0)
        self.warmth = tk.DoubleVar(value=0.0)
        self.compression = tk.DoubleVar(value=0.0)
        self.limiter = tk.DoubleVar(value=0.0)
        self.width = tk.DoubleVar(value=0.0)

        self.track_title = tk.StringVar(value="")
        self.track_character = tk.StringVar(value="auto")
        self.track_preset = tk.StringVar(value="auto")
        self.transition_override_style = tk.StringVar(value="auto")
        self.transition_override_duration = tk.DoubleVar(value=8.0)
        self.transition_enabled = tk.BooleanVar(value=True)

        self._build_ui()
        self._refresh_tracks()
        self._poll_queue()

    def _build_ui(self) -> None:
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        header = ttk.Frame(self.root, padding=(12, 10, 12, 6))
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(1, weight=1)
        ttk.Label(header, text="Album Title").grid(row=0, column=0, sticky="w")
        ttk.Entry(header, textvariable=self.album_title).grid(row=0, column=1, sticky="ew", padx=(8, 12))
        ttk.Label(header, text="Output").grid(row=0, column=2, sticky="w")
        ttk.Entry(header, textvariable=self.output_dir, width=48).grid(row=0, column=3, sticky="ew", padx=(8, 6))
        ttk.Button(header, text="Browse", command=self._choose_output).grid(row=0, column=4)

        main = ttk.PanedWindow(self.root, orient=tk.HORIZONTAL)
        main.grid(row=1, column=0, sticky="nsew", padx=12, pady=6)

        left = ttk.Frame(main)
        right = ttk.Frame(main)
        main.add(left, weight=3)
        main.add(right, weight=2)

        self._build_track_panel(left)
        self._build_control_panel(right)
        self._build_log_panel()

    def _build_track_panel(self, parent: ttk.Frame) -> None:
        parent.rowconfigure(1, weight=1)
        parent.columnconfigure(0, weight=1)
        toolbar = ttk.Frame(parent)
        toolbar.grid(row=0, column=0, sticky="ew", pady=(0, 6))
        for text, command in (
            ("Add Files", self._add_files),
            ("Remove", self._remove_selected_track),
            ("Move Up", lambda: self._move_track(-1)),
            ("Move Down", lambda: self._move_track(1)),
            ("Analyze", self._analyze_tracks),
        ):
            ttk.Button(toolbar, text=text, command=command).pack(side=tk.LEFT, padx=(0, 6))

        columns = ("title", "duration", "format", "character", "preset", "path")
        self.track_tree = ttk.Treeview(parent, columns=columns, show="headings", height=12)
        for name, label, width in (
            ("title", "Title", 180),
            ("duration", "Duration", 82),
            ("format", "Format", 76),
            ("character", "Character", 120),
            ("preset", "Preset", 145),
            ("path", "Path", 360),
        ):
            self.track_tree.heading(name, text=label)
            self.track_tree.column(name, width=width, minwidth=60, stretch=name == "path")
        self.track_tree.grid(row=1, column=0, sticky="nsew")
        self.track_tree.bind("<<TreeviewSelect>>", lambda _event: self._load_selected_track())

        detail = ttk.LabelFrame(parent, text="Selected Track", padding=10)
        detail.grid(row=2, column=0, sticky="ew", pady=(8, 0))
        detail.columnconfigure(1, weight=1)
        ttk.Label(detail, text="Title").grid(row=0, column=0, sticky="w")
        ttk.Entry(detail, textvariable=self.track_title).grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Label(detail, text="Character").grid(row=0, column=2, sticky="w")
        ttk.Combobox(
            detail,
            textvariable=self.track_character,
            values=("auto", *CHARACTER_LABELS),
            width=18,
            state="readonly",
        ).grid(row=0, column=3, sticky="ew", padx=8)
        ttk.Label(detail, text="Preset").grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Combobox(
            detail,
            textvariable=self.track_preset,
            values=("auto", *_preset_choices()),
            width=28,
            state="readonly",
        ).grid(row=1, column=1, columnspan=2, sticky="ew", padx=8, pady=(8, 0))
        ttk.Button(detail, text="Apply Track Override", command=self._apply_track_override).grid(
            row=1, column=3, sticky="ew", padx=8, pady=(8, 0)
        )

        transition_box = ttk.LabelFrame(parent, text="Transitions", padding=10)
        transition_box.grid(row=3, column=0, sticky="nsew", pady=(8, 0))
        transition_box.columnconfigure(0, weight=1)
        self.transition_tree = ttk.Treeview(
            transition_box,
            columns=("between", "style", "duration", "enabled"),
            show="headings",
            height=5,
        )
        for name, label, width in (
            ("between", "Between", 100),
            ("style", "Style", 140),
            ("duration", "Seconds", 80),
            ("enabled", "On", 60),
        ):
            self.transition_tree.heading(name, text=label)
            self.transition_tree.column(name, width=width, minwidth=50)
        self.transition_tree.grid(row=0, column=0, sticky="ew")
        self.transition_tree.bind("<<TreeviewSelect>>", lambda _event: self._load_selected_transition())

        controls = ttk.Frame(transition_box)
        controls.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        ttk.Combobox(
            controls,
            textvariable=self.transition_override_style,
            values=INTERLUDE_STYLE_CHOICES,
            width=18,
            state="readonly",
        ).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Spinbox(
            controls,
            textvariable=self.transition_override_duration,
            from_=0.25,
            to=30.0,
            increment=0.25,
            width=7,
        ).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Checkbutton(controls, text="Enabled", variable=self.transition_enabled).pack(side=tk.LEFT, padx=(0, 10))
        ttk.Button(controls, text="Apply Transition", command=self._apply_transition_override).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(controls, text="Preview Transition", command=self._preview_transition).pack(side=tk.LEFT)

    def _build_control_panel(self, parent: ttk.Frame) -> None:
        parent.columnconfigure(0, weight=1)
        settings = ttk.LabelFrame(parent, text="Mastering Direction", padding=10)
        settings.grid(row=0, column=0, sticky="ew")
        settings.columnconfigure(1, weight=1)
        ttk.Label(settings, text="Preset").grid(row=0, column=0, sticky="w")
        ttk.Combobox(settings, textvariable=self.preset, values=_preset_choices(), state="readonly").grid(
            row=0, column=1, sticky="ew", padx=8
        )
        ttk.Label(settings, text="Album Arc").grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Combobox(settings, textvariable=self.arc, values=_arc_choices(), state="readonly").grid(
            row=1, column=1, sticky="ew", padx=8, pady=(8, 0)
        )
        ttk.Label(settings, text="Arc Intensity").grid(row=2, column=0, sticky="w", pady=(8, 0))
        ttk.Scale(settings, variable=self.arc_intensity, from_=0.0, to=2.0, orient=tk.HORIZONTAL).grid(
            row=2, column=1, sticky="ew", padx=8, pady=(8, 0)
        )

        render = ttk.LabelFrame(parent, text="Render Settings", padding=10)
        render.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        for index in range(4):
            render.columnconfigure(index, weight=1)
        self._entry(render, "Target LUFS", self.target_lufs, 0, 0)
        self._entry(render, "Ceiling dBFS", self.ceiling_dbfs, 0, 2)
        self._entry(render, "Transition Sec", self.transition_duration, 1, 0)
        ttk.Label(render, text="Transition Style").grid(row=1, column=2, sticky="w", pady=(8, 0))
        ttk.Combobox(render, textvariable=self.transition_style, values=INTERLUDE_STYLE_CHOICES, state="readonly").grid(
            row=1, column=3, sticky="ew", padx=8, pady=(8, 0)
        )
        self._entry(render, "Sample Rate", self.sample_rate, 2, 0)
        ttk.Label(render, text="Format").grid(row=2, column=2, sticky="w", pady=(8, 0))
        ttk.Combobox(render, textvariable=self.output_format, values=("wav", "flac", "mp3", "m4a", "ogg", "opus"), state="readonly").grid(
            row=2, column=3, sticky="ew", padx=8, pady=(8, 0)
        )

        tune = ttk.LabelFrame(parent, text="Fine Tuning", padding=10)
        tune.grid(row=2, column=0, sticky="ew", pady=(8, 0))
        tune.columnconfigure(1, weight=1)
        for row, (label, var, low, high) in enumerate(
            (
                ("Brightness", self.brightness, -3.0, 3.0),
                ("Bass Weight", self.bass_weight, -3.0, 3.0),
                ("Mid Presence", self.mid_presence, -3.0, 3.0),
                ("Air", self.air, -3.0, 3.0),
                ("Warmth", self.warmth, -0.08, 0.12),
                ("Compression", self.compression, -1.0, 1.0),
                ("Limiter", self.limiter, -1.0, 1.0),
                ("Stereo Width", self.width, -0.35, 0.35),
            )
        ):
            ttk.Label(tune, text=label).grid(row=row, column=0, sticky="w", pady=2)
            ttk.Scale(tune, variable=var, from_=low, to=high, orient=tk.HORIZONTAL).grid(row=row, column=1, sticky="ew", padx=8, pady=2)
            ttk.Label(tune, textvariable=var, width=8).grid(row=row, column=2, sticky="e", pady=2)

        actions = ttk.LabelFrame(parent, text="Actions", padding=10)
        actions.grid(row=3, column=0, sticky="ew", pady=(8, 0))
        for text, command in (
            ("Render Full Album", lambda: self._render(album_wav=True)),
            ("Render Tracks Only", lambda: self._render(album_wav=False)),
            ("Open Output Folder", self._open_output_folder),
            ("Open Report", self._open_report),
        ):
            ttk.Button(actions, text=text, command=command).pack(fill=tk.X, pady=3)

    def _build_log_panel(self) -> None:
        log_frame = ttk.LabelFrame(self.root, text="Progress / Warnings", padding=(10, 6, 10, 10))
        log_frame.grid(row=2, column=0, sticky="ew", padx=12, pady=(0, 12))
        log_frame.columnconfigure(0, weight=1)
        self.log = tk.Text(log_frame, height=8, wrap=tk.WORD)
        self.log.grid(row=0, column=0, sticky="ew")
        self._log("Ready. Add up to 8 songs, analyze, choose a direction, then render.")

    def _entry(self, parent: ttk.Frame, label: str, variable: tk.Variable, row: int, column: int) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=column, sticky="w", pady=(8 if row else 0, 0))
        ttk.Entry(parent, textvariable=variable, width=12).grid(
            row=row, column=column + 1, sticky="ew", padx=8, pady=(8 if row else 0, 0)
        )

    def _choose_output(self) -> None:
        selected = filedialog.askdirectory(title="Choose output folder")
        if selected:
            self.output_dir.set(selected)

    def _add_files(self) -> None:
        if len(self.tracks) >= 8:
            messagebox.showwarning("Track limit", "This studio supports up to 8 tracks per album.")
            return
        filetypes = [("Audio files", " ".join(f"*{ext}" for ext in sorted(AUDIO_EXTENSIONS))), ("All files", "*.*")]
        selected = filedialog.askopenfilenames(title="Add songs", filetypes=filetypes)
        added = 0
        for raw in selected:
            path = Path(raw)
            if path.suffix.lower() not in AUDIO_EXTENSIONS:
                continue
            if any(track.path == path for track in self.tracks):
                continue
            if len(self.tracks) >= 8:
                break
            self.tracks.append(TrackState(path=path, title=path.stem))
            added += 1
        if added:
            self._sync_transitions()
            self._refresh_tracks()
            self._log(f"Added {added} track(s).")

    def _remove_selected_track(self) -> None:
        index = self._selected_track_index()
        if index is None:
            return
        removed = self.tracks.pop(index)
        self._sync_transitions()
        self._refresh_tracks()
        self._log(f"Removed {removed.path.name}.")

    def _move_track(self, delta: int) -> None:
        index = self._selected_track_index()
        if index is None:
            return
        new_index = index + delta
        if new_index < 0 or new_index >= len(self.tracks):
            return
        self.tracks[index], self.tracks[new_index] = self.tracks[new_index], self.tracks[index]
        self._sync_transitions()
        self._refresh_tracks(select=new_index)
        self._log("Track order updated.")

    def _load_selected_track(self) -> None:
        index = self._selected_track_index()
        if index is None:
            return
        track = self.tracks[index]
        self.track_title.set(track.title)
        self.track_character.set(track.character)
        self.track_preset.set("auto" if track.preset == "auto" else _preset_choice(track.preset))

    def _apply_track_override(self) -> None:
        index = self._selected_track_index()
        if index is None:
            return
        track = self.tracks[index]
        track.title = self.track_title.get().strip() or track.path.stem
        track.character = self.track_character.get()
        track.preset = _preset_key_or_auto(self.track_preset.get())
        self._refresh_tracks(select=index)
        self._log(f"Updated track {index + 1} overrides.")

    def _load_selected_transition(self) -> None:
        index = self._selected_transition_index()
        if index is None:
            return
        transition = self.transitions[index]
        self.transition_override_style.set(transition.style)
        self.transition_override_duration.set(transition.duration_seconds)
        self.transition_enabled.set(transition.enabled)

    def _apply_transition_override(self) -> None:
        index = self._selected_transition_index()
        if index is None:
            return
        self.transitions[index] = TransitionState(
            style=self.transition_override_style.get(),
            duration_seconds=max(0.25, float(self.transition_override_duration.get())),
            enabled=bool(self.transition_enabled.get()),
        )
        self._refresh_transitions(select=index)
        self._log(f"Updated transition {index + 1}.")

    def _analyze_tracks(self) -> None:
        if not self.tracks:
            messagebox.showinfo("No tracks", "Add songs before analyzing.")
            return
        snapshot = [(index, track.path) for index, track in enumerate(self.tracks)]
        sample_rate = int(self.sample_rate.get())
        self._start_background(self._analyze_worker, snapshot, sample_rate)

    def _analyze_worker(self, snapshot: list[tuple[int, Path]], sample_rate: int) -> None:
        self.queue.put(("log", f"Analyzing {len(snapshot)} track(s) at {sample_rate} Hz..."))
        for index, path in snapshot:
            try:
                info = probe(path)
                samples = load_audio(path, sample_rate)
                stats = analyze_audio(samples, sample_rate).to_dict()
                self.queue.put(("analysis", index, str(path), stats, info))
                self.queue.put(("log", f"Analyzed {path.name}."))
            except Exception as exc:
                self.queue.put(("log", f"Warning: could not analyze {path.name}: {exc}"))
        self.queue.put(("done",))

    def _render(self, album_wav: bool) -> None:
        if not self.tracks:
            messagebox.showinfo("No tracks", "Add songs before rendering.")
            return
        try:
            project = self._project_dict(album_wav=album_wav)
        except ValueError as exc:
            messagebox.showerror("Invalid settings", str(exc))
            return
        output_dir = self._fresh_output_dir()
        self._start_background(self._render_worker, project, output_dir)

    def _render_worker(self, project: dict, output_dir: Path) -> None:
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
            project_path = output_dir / "album.ams.json"
            project_path.write_text(json.dumps(project, indent=2), encoding="utf-8")
            self.queue.put(("log", f"Rendering project to {output_dir}..."))
            manifest = render_project(project_path, output_dir)
            score = score_render(output_dir / "manifest.json", scorer="local")
            dashboard = export_dashboard(output_dir / "manifest.json", output_dir / "dashboard.html")
            self.queue.put(("paths", output_dir, Path(dashboard["dashboard"])))
            self.queue.put(("log", f"Render complete. Score {score['overall']:.2f}."))
            for warning in manifest.get("warnings", []):
                self.queue.put(("log", f"Warning: {warning}"))
        except Exception as exc:
            self.queue.put(("error", str(exc)))
        finally:
            self.queue.put(("done",))

    def _preview_transition(self) -> None:
        index = self._selected_transition_index()
        if index is None:
            messagebox.showinfo("No transition", "Select a transition first.")
            return
        if len(self.tracks) < 2:
            return
        try:
            project = self._project_dict(album_wav=False)
        except ValueError as exc:
            messagebox.showerror("Invalid settings", str(exc))
            return
        output_dir = self._fresh_output_dir() / "previews"
        self._start_background(self._preview_worker, project, output_dir, index)

    def _preview_worker(self, project: dict, output_dir: Path, index: int) -> None:
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
            project_path = output_dir / "preview.ams.json"
            project_path.write_text(json.dumps(project, indent=2), encoding="utf-8")
            preview_path = output_dir / f"transition_{index + 1:02d}_to_{index + 2:02d}.wav"
            summary = render_transition_preview(project_path, index + 1, preview_path, tail_seconds=8.0, head_seconds=8.0)
            self.queue.put(("paths", output_dir, None))
            self.queue.put(("log", f"Preview rendered: {summary['output']}"))
        except Exception as exc:
            self.queue.put(("error", str(exc)))
        finally:
            self.queue.put(("done",))

    def _project_dict(self, album_wav: bool) -> dict:
        sample_rate = int(self.sample_rate.get())
        transition_duration = max(0.25, float(self.transition_duration.get()))
        transition_style = self.transition_style.get()
        self._sync_transitions()
        return {
            "version": 1,
            "album_title": self.album_title.get().strip() or "Untitled Album",
            "settings": {
                "sample_rate": sample_rate,
                "preset": _preset_key(self.preset.get()),
                "output_format": self.output_format.get(),
                "target_lufs": _optional_float(self.target_lufs.get()),
                "ceiling_dbfs": _optional_float(self.ceiling_dbfs.get()),
                "default_interlude_duration": transition_duration,
                "default_interlude_style": transition_style,
                "arc": _arc_key(self.arc.get()),
                "arc_intensity": float(self.arc_intensity.get()),
                "tweak_lufs": 0.0,
                "tweak_brightness_db": float(self.brightness.get()),
                "tweak_warmth": float(self.warmth.get()),
                "tweak_low_end_db": float(self.bass_weight.get()),
                "tweak_air_db": float(self.air.get()),
                "tweak_presence_db": float(self.mid_presence.get()),
                "tweak_width": float(self.width.get()),
                "tweak_intensity": float(self.compression.get()),
                "tweak_limiter": float(self.limiter.get()),
                "album_wav": album_wav,
            },
            "tracks": [
                {
                    "path": str(track.path),
                    "title": track.title,
                    "character": track.character,
                    "preset": track.preset,
                }
                for track in self.tracks
            ],
            "transitions": [
                {
                    "after_track": index + 1,
                    "duration_seconds": transition_duration if transition.style == "auto" else transition.duration_seconds,
                    "style": transition_style if transition.style == "auto" else transition.style,
                    "enabled": transition.enabled,
                }
                for index, transition in enumerate(self.transitions)
            ],
        }

    def _sync_transitions(self) -> None:
        needed = max(len(self.tracks) - 1, 0)
        while len(self.transitions) < needed:
            self.transitions.append(
                TransitionState(
                    style=self.transition_style.get(),
                    duration_seconds=max(0.25, float(self.transition_duration.get())),
                    enabled=True,
                )
            )
        del self.transitions[needed:]

    def _fresh_output_dir(self) -> Path:
        base = Path(self.output_dir.get()).expanduser()
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        if base.name.startswith("studio-render"):
            return base.with_name(f"{base.name}-{stamp}")
        return base / f"studio-render-{stamp}"

    def _selected_track_index(self) -> int | None:
        selected = self.track_tree.selection()
        if not selected:
            return None
        return int(selected[0])

    def _selected_transition_index(self) -> int | None:
        selected = self.transition_tree.selection()
        if not selected:
            return None
        return int(selected[0])

    def _refresh_tracks(self, select: int | None = None) -> None:
        self.track_tree.delete(*self.track_tree.get_children())
        for index, track in enumerate(self.tracks):
            stats = track.analysis or {}
            info = track.probe or {}
            duration = stats.get("duration_seconds") or info.get("format", {}).get("duration")
            fmt = _format_probe(info)
            self.track_tree.insert(
                "",
                tk.END,
                iid=str(index),
                values=(
                    track.title,
                    _seconds(duration),
                    fmt,
                    track.character,
                    "auto" if track.preset == "auto" else PRESETS[track.preset].display_name,
                    str(track.path),
                ),
            )
        if select is not None and 0 <= select < len(self.tracks):
            self.track_tree.selection_set(str(select))
            self.track_tree.focus(str(select))
        self._refresh_transitions()

    def _refresh_transitions(self, select: int | None = None) -> None:
        self._sync_transitions()
        self.transition_tree.delete(*self.transition_tree.get_children())
        for index, transition in enumerate(self.transitions):
            self.transition_tree.insert(
                "",
                tk.END,
                iid=str(index),
                values=(
                    f"{index + 1} -> {index + 2}",
                    transition.style,
                    f"{transition.duration_seconds:.2f}",
                    "yes" if transition.enabled else "no",
                ),
            )
        if select is not None and 0 <= select < len(self.transitions):
            self.transition_tree.selection_set(str(select))
            self.transition_tree.focus(str(select))

    def _start_background(self, target, *args) -> None:
        if self.busy:
            messagebox.showinfo("Busy", "A background task is already running.")
            return
        self.busy = True
        thread = threading.Thread(target=target, args=args, daemon=True)
        thread.start()

    def _poll_queue(self) -> None:
        try:
            while True:
                item = self.queue.get_nowait()
                kind = item[0]
                if kind == "log":
                    self._log(item[1])
                elif kind == "analysis":
                    _, index, path, stats, info = item
                    if 0 <= index < len(self.tracks) and str(self.tracks[index].path) == path:
                        self.tracks[index].analysis = stats
                        self.tracks[index].probe = info
                        self._refresh_tracks(select=index)
                elif kind == "paths":
                    self.last_output_dir = Path(item[1])
                    self.last_dashboard_path = Path(item[2]) if item[2] else self.last_dashboard_path
                elif kind == "error":
                    self._log(f"Error: {item[1]}")
                    messagebox.showerror("Album Mastering Studio", item[1])
                elif kind == "done":
                    self.busy = False
        except queue.Empty:
            pass
        self.root.after(150, self._poll_queue)

    def _log(self, message: str) -> None:
        self.log.insert(tk.END, f"{datetime.now().strftime('%H:%M:%S')}  {message}\n")
        self.log.see(tk.END)

    def _open_output_folder(self) -> None:
        if self.last_output_dir and self.last_output_dir.exists():
            os.startfile(str(self.last_output_dir))
        else:
            messagebox.showinfo("No output yet", "Render first, then open the output folder.")

    def _open_report(self) -> None:
        if self.last_dashboard_path and self.last_dashboard_path.exists():
            os.startfile(str(self.last_dashboard_path))
        else:
            messagebox.showinfo("No report yet", "Render first, then open the dashboard report.")


def _preset_choices() -> tuple[str, ...]:
    return tuple(f"{preset.display_name} ({key})" for key, preset in sorted(PRESETS.items()))


def _preset_choice(key: str) -> str:
    return f"{PRESETS[key].display_name} ({key})"


def _preset_key(value: str) -> str:
    if value in PRESETS:
        return value
    if value.endswith(")") and "(" in value:
        key = value.rsplit("(", 1)[1].rstrip(")")
        if key in PRESETS:
            return key
    raise ValueError(f"Unknown preset: {value}")


def _preset_key_or_auto(value: str) -> str:
    return "auto" if value == "auto" else _preset_key(value)


def _arc_choices() -> tuple[str, ...]:
    return tuple(f"{arc.display_name} ({key})" for key, arc in sorted(ARC_PRESETS.items()))


def _arc_choice(key: str) -> str:
    return f"{ARC_PRESETS[key].display_name} ({key})"


def _arc_key(value: str) -> str:
    if value in ARC_PRESETS:
        return value
    if value.endswith(")") and "(" in value:
        key = value.rsplit("(", 1)[1].rstrip(")")
        if key in ARC_PRESETS:
            return key
    raise ValueError(f"Unknown album arc: {value}")


def _optional_float(value: str) -> float | None:
    value = value.strip()
    if not value or value.lower() == "auto":
        return None
    return float(value)


def _seconds(value: Any) -> str:
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return "n/a"
    minutes = int(seconds // 60)
    rest = seconds - (minutes * 60)
    return f"{minutes}:{rest:04.1f}"


def _format_probe(info: dict[str, Any]) -> str:
    streams = info.get("streams") or []
    if not streams:
        return "n/a"
    stream = streams[0]
    codec = stream.get("codec_name", "?")
    rate = stream.get("sample_rate", "?")
    channels = stream.get("channels", "?")
    return f"{codec} {rate}Hz {channels}ch"
