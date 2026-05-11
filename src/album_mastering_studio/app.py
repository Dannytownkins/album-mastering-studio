from __future__ import annotations

import json
import hashlib
import os
import subprocess
import sys
import queue
import shutil
import threading
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
try:
    import winsound
except ImportError:  # pragma: no cover - non-Windows fallback.
    winsound = None

from .arc import ARC_PRESETS
from .analysis import analyze_audio
from .audio_io import AUDIO_EXTENSIONS, check_audio_tools, load_audio, probe, write_audio
from .character import CHARACTER_LABELS
from .constants import DEFAULT_RENDER_SUBDIR, DEFAULT_SAMPLE_RATE, MAX_TRACKS
from .dashboard import export_dashboard
from .interludes import INTERLUDE_STYLE_CHOICES
from .mastering import PRESETS
from .pipeline import load_project, render_project, render_transition_preview
from .scoring import score_render


@dataclass
class TrackState:
    path: Path
    title: str
    character: str = "auto"
    preset: str = "auto"
    analysis: dict[str, Any] | None = None
    probe: dict[str, Any] | None = None
    waveform: list[float] | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class TransitionState:
    style: str = "inherit"
    duration_seconds: float = 8.0
    enabled: bool = True


TARGET_PROFILES: dict[str, tuple[float | None, float | None]] = {
    "Custom": (None, None),
    "Spotify / streaming (-14 LUFS)": (-14.0, -1.0),
    "Apple Music-ish (-16 LUFS)": (-16.0, -1.0),
    "YouTube-ish (-13 LUFS)": (-13.0, -1.0),
    "Quiet album (-18 LUFS)": (-18.0, -1.0),
    "Loud rock (-10.5 LUFS)": (-10.5, -0.8),
}


def main(default_output: Path | None = None) -> int:
    root = tk.Tk()
    MasteringStudioApp(root, default_output=default_output)
    root.mainloop()
    return 0


class MasteringStudioApp:
    def __init__(self, root: tk.Tk, default_output: Path | None = None) -> None:
        self.root = root
        self.root.title("Album Mastering Studio")
        self.root.geometry("1360x880")
        self.root.minsize(1100, 720)
        self.queue: queue.Queue[tuple] = queue.Queue()
        self.tracks: list[TrackState] = []
        self.transitions: list[TransitionState] = []
        self.busy = False
        self.last_output_dir: Path | None = None
        self.last_dashboard_path: Path | None = None
        self.last_manifest: dict[str, Any] | None = None
        self.last_preview_path: Path | None = None
        self.current_project_path: Path | None = None
        self.missing_audio_tools = check_audio_tools()
        self.playback_temp_dir = Path(tempfile.mkdtemp(prefix="album-master-playback-"))
        self.playback_cache: dict[tuple[str, int, int], Path] = {}
        self.cancel_requested = False
        self.editing_track_index: int | None = None
        self.editing_transition_index: int | None = None

        default_output = default_output or (Path.cwd() / "outputs" / DEFAULT_RENDER_SUBDIR)
        self.album_title = tk.StringVar(value="Untitled Album")
        self.output_dir = tk.StringVar(value=str(default_output))
        self.reference_path = tk.StringVar(value="")
        self.sample_rate = tk.StringVar(value=str(DEFAULT_SAMPLE_RATE))
        self.target_profile = tk.StringVar(value="Custom")
        self.preset = tk.StringVar(value=_preset_choice("album-cohesion-cinematic"))
        self.arc = tk.StringVar(value=_arc_choice("cinematic"))
        self.arc_intensity = tk.DoubleVar(value=1.0)
        self.output_format = tk.StringVar(value="wav")
        self.transition_style = tk.StringVar(value="auto")
        self.transition_duration = tk.DoubleVar(value=8.0)
        self.target_lufs = tk.StringVar(value="")
        self.ceiling_dbfs = tk.StringVar(value="-1.0")
        self.tweak_lufs = tk.StringVar(value="0.0")
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
        self.transition_override_style = tk.StringVar(value="inherit")
        self.transition_override_duration = tk.DoubleVar(value=8.0)
        self.transition_enabled = tk.BooleanVar(value=True)
        self.track_counter = tk.StringVar(value=f"0 / {MAX_TRACKS} tracks")
        self.status = tk.StringVar(value="Ready")
        self.slider_labels: dict[str, tk.StringVar] = {}

        self._build_ui()
        self._refresh_tracks()
        self._poll_queue()
        self._bind_shortcuts()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        if self.missing_audio_tools:
            self._log(f"Missing required audio tools: {', '.join(self.missing_audio_tools)}. Install FFmpeg/FFprobe before rendering.")

    def _build_ui(self) -> None:
        self._build_menu()
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        header = ttk.Frame(self.root, padding=(12, 10, 12, 6))
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(1, weight=1)
        header.columnconfigure(3, weight=1)
        ttk.Label(header, text="Album Title").grid(row=0, column=0, sticky="w")
        ttk.Entry(header, textvariable=self.album_title).grid(row=0, column=1, sticky="ew", padx=(8, 12))
        ttk.Label(header, text="Output").grid(row=0, column=2, sticky="w")
        ttk.Entry(header, textvariable=self.output_dir, width=48).grid(row=0, column=3, sticky="ew", padx=(8, 6))
        ttk.Button(header, text="Browse", command=self._choose_output).grid(row=0, column=4)
        ttk.Label(header, text="Reference").grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Entry(header, textvariable=self.reference_path).grid(row=1, column=1, columnspan=3, sticky="ew", padx=(8, 6), pady=(8, 0))
        ttk.Button(header, text="Browse", command=self._choose_reference).grid(row=1, column=4, pady=(8, 0))

        main = ttk.PanedWindow(self.root, orient=tk.HORIZONTAL)
        main.grid(row=1, column=0, sticky="nsew", padx=12, pady=6)

        left = ttk.Frame(main)
        right = ttk.Frame(main)
        main.add(left, weight=3)
        main.add(right, weight=2)

        self._build_track_panel(left)
        self._build_control_panel(right)
        self._build_log_panel()

    def _build_menu(self) -> None:
        menu = tk.Menu(self.root)
        file_menu = tk.Menu(menu, tearoff=False)
        file_menu.add_command(label="Open Project...", accelerator="Ctrl+O", command=self._open_project)
        file_menu.add_command(label="Save Project As...", accelerator="Ctrl+S", command=self._save_project_as)
        file_menu.add_separator()
        file_menu.add_command(label="Add Files...", command=self._add_files)
        file_menu.add_command(label="Exit", command=self._on_close)
        menu.add_cascade(label="File", menu=file_menu)
        run_menu = tk.Menu(menu, tearoff=False)
        run_menu.add_command(label="Analyze", command=self._analyze_tracks)
        run_menu.add_command(label="Render Full Album", accelerator="Ctrl+R", command=lambda: self._render(album_wav=True))
        run_menu.add_command(label="Smoke Check", command=self._run_smoke_check)
        menu.add_cascade(label="Run", menu=run_menu)
        self.root.config(menu=menu)

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
            ("Play Source", self._play_selected_source),
            ("Play Master", self._play_selected_master),
            ("Stop", self._stop_playback),
        ):
            ttk.Button(toolbar, text=text, command=command).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Label(toolbar, textvariable=self.track_counter).pack(side=tk.RIGHT)

        columns = ("title", "duration", "lufs", "peak", "dr", "brightness", "format", "character", "preset", "path")
        self.track_tree = ttk.Treeview(parent, columns=columns, show="headings", height=12)
        for name, label, width in (
            ("title", "Title", 180),
            ("duration", "Duration", 82),
            ("lufs", "LUFS", 70),
            ("peak", "True Peak", 82),
            ("dr", "DR", 55),
            ("brightness", "Bright", 70),
            ("format", "Format", 120),
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
            values=("inherit", *INTERLUDE_STYLE_CHOICES),
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
        ttk.Button(controls, text="Play Preview", command=self._play_last_preview).pack(side=tk.LEFT, padx=(6, 0))

        waveform_box = ttk.LabelFrame(parent, text="Selected Track Waveform / Analysis", padding=8)
        waveform_box.grid(row=4, column=0, sticky="ew", pady=(8, 0))
        waveform_box.columnconfigure(0, weight=1)
        self.waveform_canvas = tk.Canvas(waveform_box, height=82, bg="#101418", highlightthickness=1, highlightbackground="#374151")
        self.waveform_canvas.grid(row=0, column=0, sticky="ew")
        self.waveform_canvas.bind("<Configure>", lambda _event: self._redraw_selected_waveform())
        self.analysis_summary = tk.StringVar(value="Analyze a selected track to see LUFS, true peak, dynamics, brightness, width, and transient density.")
        ttk.Label(waveform_box, textvariable=self.analysis_summary, wraplength=850).grid(row=1, column=0, sticky="ew", pady=(6, 0))

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
        arc_label = tk.StringVar()
        self._bind_slider_label("arc", self.arc_intensity, arc_label, "{:.2f}x")
        ttk.Label(settings, textvariable=arc_label, width=9).grid(row=2, column=2, sticky="e", pady=(8, 0))

        render = ttk.LabelFrame(parent, text="Render Settings", padding=10)
        render.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        for index in range(4):
            render.columnconfigure(index, weight=1)
        ttk.Label(render, text="Target Preset").grid(row=0, column=0, sticky="w")
        target_box = ttk.Combobox(render, textvariable=self.target_profile, values=tuple(TARGET_PROFILES), state="readonly")
        target_box.grid(row=0, column=1, sticky="ew", padx=8)
        target_box.bind("<<ComboboxSelected>>", lambda _event: self._apply_target_profile())
        self._entry(render, "Target LUFS", self.target_lufs, 0, 2)
        self._entry(render, "Ceiling dBFS", self.ceiling_dbfs, 1, 0)
        self._entry(render, "Sample Rate", self.sample_rate, 1, 2)
        self._entry(render, "Transition Sec", self.transition_duration, 2, 0)
        ttk.Label(render, text="Transition Style").grid(row=2, column=2, sticky="w", pady=(8, 0))
        ttk.Combobox(render, textvariable=self.transition_style, values=INTERLUDE_STYLE_CHOICES, state="readonly").grid(
            row=2, column=3, sticky="ew", padx=8, pady=(8, 0)
        )
        self._entry(render, "LU Offset", self.tweak_lufs, 3, 0)
        ttk.Label(render, text="Format").grid(row=3, column=2, sticky="w", pady=(8, 0))
        ttk.Combobox(render, textvariable=self.output_format, values=("wav", "flac", "mp3", "m4a", "ogg", "opus"), state="readonly").grid(
            row=3, column=3, sticky="ew", padx=8, pady=(8, 0)
        )

        tune = ttk.LabelFrame(parent, text="Fine Tuning", padding=10)
        tune.grid(row=2, column=0, sticky="ew", pady=(8, 0))
        tune.columnconfigure(1, weight=1)
        for row, (label, var, low, high, fmt) in enumerate(
            (
                ("Brightness", self.brightness, -3.0, 3.0, "{:+.2f} dB"),
                ("Bass Weight", self.bass_weight, -3.0, 3.0, "{:+.2f} dB"),
                ("Mid Presence", self.mid_presence, -3.0, 3.0, "{:+.2f} dB"),
                ("Air", self.air, -3.0, 3.0, "{:+.2f} dB"),
                ("Warmth", self.warmth, -0.08, 0.12, "{:+.3f}"),
                ("Compression", self.compression, -1.0, 1.0, "{:+.2f}"),
                ("Limiter", self.limiter, -1.0, 1.0, "{:+.2f}"),
                ("Stereo Width", self.width, -0.35, 0.35, "{:+.2f}"),
            )
        ):
            value_label = tk.StringVar()
            self._bind_slider_label(label, var, value_label, fmt)
            ttk.Label(tune, text=label).grid(row=row, column=0, sticky="w", pady=2)
            ttk.Scale(tune, variable=var, from_=low, to=high, orient=tk.HORIZONTAL).grid(row=row, column=1, sticky="ew", padx=8, pady=2)
            ttk.Label(tune, textvariable=value_label, width=10).grid(row=row, column=2, sticky="e", pady=2)

        actions = ttk.LabelFrame(parent, text="Actions", padding=10)
        actions.grid(row=3, column=0, sticky="ew", pady=(8, 0))
        for text, command in (
            ("Open Project", self._open_project),
            ("Save Project As", self._save_project_as),
            ("Render Full Album", lambda: self._render(album_wav=True)),
            ("Render Tracks Only", lambda: self._render(album_wav=False)),
            ("Smoke Check", self._run_smoke_check),
            ("Reset Tuning", self._reset_tuning),
            ("Open Output Folder", self._open_output_folder),
            ("Open Report", self._open_report),
        ):
            ttk.Button(actions, text=text, command=command).pack(fill=tk.X, pady=3)

    def _build_log_panel(self) -> None:
        log_frame = ttk.LabelFrame(self.root, text="Progress / Warnings", padding=(10, 6, 10, 10))
        log_frame.grid(row=2, column=0, sticky="ew", padx=12, pady=(0, 12))
        log_frame.columnconfigure(0, weight=1)
        status_row = ttk.Frame(log_frame)
        status_row.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 6))
        status_row.columnconfigure(1, weight=1)
        ttk.Label(status_row, textvariable=self.status).grid(row=0, column=0, sticky="w")
        self.progress = ttk.Progressbar(status_row, mode="indeterminate")
        self.progress.grid(row=0, column=1, sticky="ew", padx=10)
        ttk.Button(status_row, text="Cancel", command=self._request_cancel).grid(row=0, column=2, sticky="e", padx=(0, 6))
        ttk.Button(status_row, text="Clear Log", command=self._clear_log).grid(row=0, column=3, sticky="e")
        self.log = tk.Text(log_frame, height=8, wrap=tk.WORD)
        self.log.grid(row=1, column=0, sticky="ew")
        scrollbar = ttk.Scrollbar(log_frame, orient=tk.VERTICAL, command=self.log.yview)
        scrollbar.grid(row=1, column=1, sticky="ns")
        self.log.configure(yscrollcommand=scrollbar.set)
        self._log(f"Ready. Add up to {MAX_TRACKS} songs, analyze, choose a direction, then render.")

    def _entry(self, parent: ttk.Frame, label: str, variable: tk.Variable, row: int, column: int) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=column, sticky="w", pady=(8 if row else 0, 0))
        ttk.Entry(parent, textvariable=variable, width=12).grid(
            row=row, column=column + 1, sticky="ew", padx=8, pady=(8 if row else 0, 0)
        )

    def _bind_slider_label(self, name: str, variable: tk.DoubleVar, label: tk.StringVar, fmt: str) -> None:
        def update(*_args: object) -> None:
            try:
                label.set(fmt.format(float(variable.get())))
            except tk.TclError:
                label.set("n/a")

        variable.trace_add("write", update)
        self.slider_labels[name] = label
        update()

    def _bind_shortcuts(self) -> None:
        self.root.bind("<Control-o>", lambda _event: self._open_project())
        self.root.bind("<Control-s>", lambda _event: self._save_project_as())
        self.root.bind("<Control-r>", lambda _event: self._render(album_wav=True))
        self.root.bind("<Delete>", lambda _event: self._remove_selected_track())
        self.root.bind("<Alt-Up>", lambda _event: self._move_track(-1))
        self.root.bind("<Alt-Down>", lambda _event: self._move_track(1))

    def _clear_log(self) -> None:
        self.log.delete("1.0", tk.END)

    def _choose_output(self) -> None:
        selected = filedialog.askdirectory(title="Choose output folder")
        if selected:
            self.output_dir.set(selected)

    def _choose_reference(self) -> None:
        selected = filedialog.askopenfilename(
            title="Choose reference track",
            filetypes=_audio_filetypes(),
        )
        if selected:
            self.reference_path.set(selected)

    def _apply_target_profile(self) -> None:
        target, ceiling = TARGET_PROFILES.get(self.target_profile.get(), (None, None))
        if target is not None:
            self.target_lufs.set(f"{target:.1f}")
        if ceiling is not None:
            self.ceiling_dbfs.set(f"{ceiling:.1f}")
        self._log(f"Applied target preset: {self.target_profile.get()}.")

    def _request_cancel(self) -> None:
        if not self.busy:
            self.status.set("Ready")
            return
        self.cancel_requested = True
        self.status.set("Cancel requested...")
        self._log("Cancel requested. The current audio operation will finish its active step before stopping.")

    def _on_close(self) -> None:
        if self.busy and not messagebox.askyesno(
            "Render in progress",
            "A background audio task is still running. Close anyway? Partial output files may be left behind.",
        ):
            return
        self.cancel_requested = True
        self._stop_playback()
        shutil.rmtree(self.playback_temp_dir, ignore_errors=True)
        self.root.destroy()

    def _open_project(self) -> None:
        selected = filedialog.askopenfilename(
            title="Open album project",
            filetypes=[("Album Mastering Studio project", "*.ams.json"), ("JSON files", "*.json"), ("All files", "*.*")],
        )
        if not selected:
            return
        try:
            project_path = Path(selected)
            project = load_project(project_path)
            self._load_project_state(project, project_path)
            self.current_project_path = project_path
            self._log(f"Opened project: {project_path}")
        except Exception as exc:
            messagebox.showerror("Open Project", str(exc))

    def _save_project_as(self) -> None:
        selected = filedialog.asksaveasfilename(
            title="Save album project",
            defaultextension=".ams.json",
            filetypes=[("Album Mastering Studio project", "*.ams.json"), ("JSON files", "*.json"), ("All files", "*.*")],
        )
        if not selected:
            return
        try:
            project_path = Path(selected)
            project_path.parent.mkdir(parents=True, exist_ok=True)
            project_path.write_text(json.dumps(self._project_dict(album_wav=True), indent=2), encoding="utf-8")
            self.current_project_path = project_path
            self._log(f"Saved project: {project_path}")
        except Exception as exc:
            messagebox.showerror("Save Project", str(exc))

    def _load_project_state(self, project: dict, project_path: Path) -> None:
        base_dir = project_path.resolve().parent
        settings = project.get("settings", {})
        self.album_title.set(str(project.get("album_title") or "Untitled Album"))
        self.sample_rate.set(str(settings.get("sample_rate", DEFAULT_SAMPLE_RATE)))
        self.preset.set(_preset_choice(str(settings.get("preset", "album-cohesion-cinematic"))))
        self.arc.set(_arc_choice(str(settings.get("arc", "cinematic"))))
        self.arc_intensity.set(float(settings.get("arc_intensity", 1.0)))
        self.output_format.set(str(settings.get("output_format", "wav")))
        self.target_profile.set(str(settings.get("target_profile", "Custom")))
        self.transition_style.set(str(settings.get("default_interlude_style", "auto")))
        self.transition_duration.set(float(settings.get("default_interlude_duration", 8.0)))
        self.target_lufs.set("" if settings.get("target_lufs") is None else str(settings.get("target_lufs")))
        self.ceiling_dbfs.set("" if settings.get("ceiling_dbfs") is None else str(settings.get("ceiling_dbfs")))
        self.tweak_lufs.set(str(settings.get("tweak_lufs", 0.0)))
        reference = settings.get("reference_track")
        if reference:
            reference_path = Path(str(reference))
            if not reference_path.is_absolute():
                reference_path = base_dir / reference_path
            self.reference_path.set(str(reference_path))
        else:
            self.reference_path.set("")
        self.brightness.set(float(settings.get("tweak_brightness_db", 0.0)))
        self.bass_weight.set(float(settings.get("tweak_low_end_db", 0.0)))
        self.mid_presence.set(float(settings.get("tweak_presence_db", 0.0)))
        self.air.set(float(settings.get("tweak_air_db", 0.0)))
        self.warmth.set(float(settings.get("tweak_warmth", 0.0)))
        self.compression.set(float(settings.get("tweak_intensity", 0.0)))
        self.limiter.set(float(settings.get("tweak_limiter", 0.0)))
        self.width.set(float(settings.get("tweak_width", 0.0)))

        raw_tracks = list(project.get("tracks", []))
        if len(raw_tracks) > MAX_TRACKS:
            self._log(f"Project contains {len(raw_tracks)} tracks; loaded first {MAX_TRACKS}.")
        self.tracks = []
        for raw_track in raw_tracks[:MAX_TRACKS]:
            raw_path = Path(raw_track["path"])
            path = raw_path if raw_path.is_absolute() else base_dir / raw_path
            self.tracks.append(
                TrackState(
                    path=path,
                    title=str(raw_track.get("title") or path.stem),
                    character=str(raw_track.get("character") or "auto"),
                    preset=str(raw_track.get("preset") or "auto"),
                )
            )
        raw_transitions = list(project.get("transitions", []))
        if len(raw_transitions) > max(len(self.tracks) - 1, 0):
            self._log("Project has more transitions than loaded tracks; extra transitions were ignored.")
        self.transitions = [
            TransitionState(
                style=str(raw.get("style", settings.get("default_interlude_style", "auto"))),
                duration_seconds=float(raw.get("duration_seconds", settings.get("default_interlude_duration", 8.0))),
                enabled=bool(raw.get("enabled", True)),
            )
            for raw in raw_transitions[: max(len(self.tracks) - 1, 0)]
        ]
        self.editing_track_index = None
        self.editing_transition_index = None
        self._sync_transitions()
        self._refresh_tracks()

    def _add_files(self) -> None:
        if len(self.tracks) >= MAX_TRACKS:
            messagebox.showwarning("Track limit", f"This studio supports up to {MAX_TRACKS} tracks per album.")
            return
        selected = filedialog.askopenfilenames(title="Add songs", filetypes=_audio_filetypes())
        added = 0
        for raw in selected:
            path = Path(raw)
            if path.suffix.lower() not in AUDIO_EXTENSIONS:
                continue
            if any(track.path == path for track in self.tracks):
                continue
            if len(self.tracks) >= MAX_TRACKS:
                break
            self.tracks.append(TrackState(path=path, title=path.stem))
            added += 1
        if added:
            self._sync_transitions()
            self._refresh_tracks()
            self._log(f"Added {added} track(s).")
            self._analyze_tracks()

    def _remove_selected_track(self) -> None:
        self._save_open_editors()
        index = self._selected_track_index()
        if index is None:
            return
        removed = self.tracks.pop(index)
        self.editing_track_index = None
        self.editing_transition_index = None
        self._sync_transitions()
        self._refresh_tracks()
        self._log(f"Removed {removed.path.name}.")

    def _move_track(self, delta: int) -> None:
        self._save_open_editors()
        index = self._selected_track_index()
        if index is None:
            return
        new_index = index + delta
        if new_index < 0 or new_index >= len(self.tracks):
            return
        self.tracks[index], self.tracks[new_index] = self.tracks[new_index], self.tracks[index]
        self.editing_track_index = None
        self.editing_transition_index = None
        self._sync_transitions()
        self._refresh_tracks(select=new_index)
        self._log("Track order updated.")

    def _load_selected_track(self) -> None:
        index = self._selected_track_index()
        if index is None:
            return
        if self.editing_track_index is not None and self.editing_track_index != index:
            self._save_track_editor(self.editing_track_index, silent=True)
        track = self.tracks[index]
        self.editing_track_index = index
        self.track_title.set(track.title)
        self.track_character.set(track.character)
        self.track_preset.set("auto" if track.preset == "auto" else _preset_choice(track.preset))
        self._update_selected_analysis(track)

    def _apply_track_override(self) -> None:
        index = self._selected_track_index()
        if index is None:
            return
        self._save_track_editor(index, silent=False)
        self._refresh_tracks(select=index)

    def _save_track_editor(self, index: int, silent: bool) -> None:
        if index < 0 or index >= len(self.tracks):
            return
        track = self.tracks[index]
        try:
            preset = _preset_key_or_auto(self.track_preset.get())
        except ValueError:
            preset = track.preset
        track.title = self.track_title.get().strip() or track.path.stem
        track.character = self.track_character.get()
        track.preset = preset
        if not silent:
            self._log(f"Updated track {index + 1} overrides.")

    def _load_selected_transition(self) -> None:
        index = self._selected_transition_index()
        if index is None:
            return
        if self.editing_transition_index is not None and self.editing_transition_index != index:
            self._save_transition_editor(self.editing_transition_index, silent=True)
        transition = self.transitions[index]
        self.editing_transition_index = index
        self.transition_override_style.set(transition.style)
        self.transition_override_duration.set(transition.duration_seconds)
        self.transition_enabled.set(transition.enabled)

    def _apply_transition_override(self) -> None:
        index = self._selected_transition_index()
        if index is None:
            return
        if self._save_transition_editor(index, silent=False):
            self._refresh_transitions(select=index)

    def _save_transition_editor(self, index: int, silent: bool) -> bool:
        if index < 0 or index >= len(self.transitions):
            return False
        try:
            duration = _read_float(self.transition_override_duration, "Transition override seconds", minimum=0.25, maximum=30.0)
        except ValueError as exc:
            if not silent:
                messagebox.showerror("Invalid transition", str(exc))
            return False
        self.transitions[index] = TransitionState(
            style=self.transition_override_style.get(),
            duration_seconds=duration,
            enabled=bool(self.transition_enabled.get()),
        )
        if not silent:
            self._log(f"Updated transition {index + 1}.")
        return True

    def _save_open_editors(self) -> None:
        if self.editing_track_index is not None:
            self._save_track_editor(self.editing_track_index, silent=True)
        if self.editing_transition_index is not None:
            self._save_transition_editor(self.editing_transition_index, silent=True)

    def _analyze_tracks(self) -> None:
        if not self.tracks:
            messagebox.showinfo("No tracks", "Add songs before analyzing.")
            return
        if self.missing_audio_tools:
            messagebox.showerror("Missing FFmpeg", f"Missing required audio tools: {', '.join(self.missing_audio_tools)}")
            return
        snapshot = [(index, track.path) for index, track in enumerate(self.tracks)]
        try:
            sample_rate = _read_int(self.sample_rate, "Sample rate", minimum=8_000, maximum=192_000)
        except ValueError as exc:
            messagebox.showerror("Invalid settings", str(exc))
            return
        self._start_background(self._analyze_worker, snapshot, sample_rate)

    def _analyze_worker(self, snapshot: list[tuple[int, Path]], sample_rate: int) -> None:
        self.queue.put(("log", f"Analyzing {len(snapshot)} track(s) at {sample_rate} Hz..."))
        for index, path in snapshot:
            try:
                info = probe(path)
                samples = load_audio(path, sample_rate)
                stats = analyze_audio(samples, sample_rate).to_dict()
                waveform = _waveform(samples)
                self.queue.put(("analysis", index, str(path), stats, info, waveform))
                self.queue.put(("log", f"Analyzed {path.name}."))
            except Exception as exc:
                self.queue.put(("log", f"Warning: could not analyze {path.name}: {exc}"))
        self.queue.put(("done",))

    def _render(self, album_wav: bool) -> None:
        if not self.tracks:
            messagebox.showinfo("No tracks", "Add songs before rendering.")
            return
        if self.missing_audio_tools:
            messagebox.showerror("Missing FFmpeg", f"Missing required audio tools: {', '.join(self.missing_audio_tools)}")
            return
        try:
            project = self._project_dict(album_wav=album_wav)
            output_dir = self._fresh_output_dir()
            self._validate_output_dir(output_dir)
        except ValueError as exc:
            messagebox.showerror("Invalid settings", str(exc))
            return
        self._start_background(self._render_worker, project, output_dir)

    def _render_worker(self, project: dict, output_dir: Path) -> None:
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
            project_path = output_dir / "album.ams.json"
            project_path.write_text(json.dumps(project, indent=2), encoding="utf-8")
            self.queue.put(("log", f"Rendering project to {output_dir}..."))
            manifest = render_project(project_path, output_dir)
            if self.cancel_requested:
                self.queue.put(("manifest", manifest))
                self.queue.put(("paths", output_dir, None))
                self.queue.put(("log", "Cancel request received after audio render; skipped scoring and dashboard export."))
                return
            score = None
            dashboard_path = None
            try:
                score = score_render(output_dir / "manifest.json", scorer="local")
            except Exception as exc:
                self.queue.put(("log", f"Warning: scoring failed after render completed: {exc}"))
            try:
                dashboard = export_dashboard(output_dir / "manifest.json", output_dir / "dashboard.html")
                dashboard_path = Path(dashboard["dashboard"])
            except Exception as exc:
                self.queue.put(("log", f"Warning: dashboard export failed after render completed: {exc}"))
            self.queue.put(("manifest", manifest))
            self.queue.put(("paths", output_dir, dashboard_path))
            score_text = f" Score {score['overall']:.2f}." if score else ""
            self.queue.put(("log", f"Render complete.{score_text}"))
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
            output_dir = (self.last_output_dir or Path(self.output_dir.get()).expanduser()) / "previews"
            self._validate_output_dir(output_dir)
        except ValueError as exc:
            messagebox.showerror("Invalid settings", str(exc))
            return
        self._start_background(self._preview_worker, project, output_dir, index)

    def _preview_worker(self, project: dict, output_dir: Path, index: int) -> None:
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
            project_path = output_dir / "preview.ams.json"
            project_path.write_text(json.dumps(project, indent=2), encoding="utf-8")
            if self.cancel_requested:
                self.queue.put(("log", "Preview canceled before render started."))
                return
            preview_path = output_dir / f"transition_{index + 1:02d}_to_{index + 2:02d}.wav"
            summary = render_transition_preview(project_path, index + 1, preview_path, tail_seconds=8.0, head_seconds=8.0)
            self.queue.put(("paths", output_dir, None))
            self.queue.put(("preview_path", preview_path))
            self.queue.put(("log", f"Preview rendered: {summary['output']}"))
        except Exception as exc:
            self.queue.put(("error", str(exc)))
        finally:
            self.queue.put(("done",))

    def _play_selected_source(self) -> None:
        index = self._selected_track_index()
        if index is None:
            messagebox.showinfo("No track", "Select a track first.")
            return
        self._play_audio_path(self.tracks[index].path)

    def _play_selected_master(self) -> None:
        index = self._selected_track_index()
        if index is None:
            messagebox.showinfo("No track", "Select a track first.")
            return
        if not self.last_manifest:
            messagebox.showinfo("No render yet", "Render first, then play the selected master.")
            return
        tracks = [item for item in self.last_manifest.get("sequence", []) if item.get("type") == "track"]
        if index >= len(tracks):
            messagebox.showinfo("No master", "No rendered master exists for that selection.")
            return
        self._play_audio_path(Path(tracks[index]["output"]))

    def _play_last_preview(self) -> None:
        if self.last_preview_path and self.last_preview_path.exists():
            self._play_audio_path(self.last_preview_path)
        else:
            messagebox.showinfo("No preview yet", "Render a transition preview first.")

    def _stop_playback(self) -> None:
        if winsound is not None:
            winsound.PlaySound(None, winsound.SND_PURGE)
        self._log("Stopped playback.")

    def _play_audio_path(self, path: Path) -> None:
        if not path.exists():
            messagebox.showinfo("Missing file", f"Audio file does not exist: {path}")
            return
        if winsound is None:
            _open_path(path)
            return
        try:
            playback_path = path
            if path.suffix.lower() != ".wav":
                sample_rate = _read_int(self.sample_rate, "Sample rate", minimum=8_000, maximum=192_000)
                key = (str(path.resolve()), path.stat().st_mtime_ns, sample_rate)
                playback_path = self.playback_cache.get(key)
                if playback_path is None or not playback_path.exists():
                    digest = hashlib.sha1(f"{key[0]}:{key[1]}:{key[2]}".encode("utf-8")).hexdigest()[:12]
                    playback_path = self.playback_temp_dir / f"{path.stem}_{digest}.wav"
                    samples = load_audio(path, sample_rate)
                    write_audio(playback_path, samples, sample_rate)
                    self.playback_cache[key] = playback_path
            winsound.PlaySound(str(playback_path), winsound.SND_FILENAME | winsound.SND_ASYNC)
            self._log(f"Playing: {path}")
        except Exception as exc:
            self._log(f"Playback fallback: {exc}")
            _open_path(path)

    def _run_smoke_check(self) -> None:
        output_dir = Path(self.output_dir.get()).expanduser() / "smoke-check"
        self._start_background(self._smoke_worker, output_dir)

    def _smoke_worker(self, output_dir: Path) -> None:
        try:
            from .smoke import run_smoke

            self.queue.put(("log", f"Running smoke check to {output_dir}..."))
            if self.cancel_requested:
                self.queue.put(("log", "Smoke check canceled before it started."))
                return
            summary = run_smoke(output_dir, clean=True)
            self.queue.put(("paths", output_dir, None))
            self.queue.put(("log", f"Smoke check passed: {summary['output']}"))
        except Exception as exc:
            self.queue.put(("error", str(exc)))
        finally:
            self.queue.put(("done",))

    def _reset_tuning(self) -> None:
        self.arc_intensity.set(1.0)
        self.brightness.set(0.0)
        self.bass_weight.set(0.0)
        self.mid_presence.set(0.0)
        self.air.set(0.0)
        self.warmth.set(0.0)
        self.compression.set(0.0)
        self.limiter.set(0.0)
        self.width.set(0.0)
        self.target_lufs.set("")
        self.ceiling_dbfs.set("-1.0")
        self.tweak_lufs.set("0.0")
        self.target_profile.set("Custom")
        self.track_character.set("auto")
        self.track_preset.set("auto")
        self.transition_override_style.set("inherit")
        self.transition_override_duration.set(_safe_float(self.transition_duration, 8.0))
        self.transition_enabled.set(True)
        for track in self.tracks:
            track.character = "auto"
            track.preset = "auto"
        for index in range(len(self.transitions)):
            self.transitions[index] = TransitionState(
                style="inherit",
                duration_seconds=_safe_float(self.transition_duration, 8.0),
                enabled=True,
            )
        self.editing_track_index = None
        self.editing_transition_index = None
        self._refresh_tracks()
        self._log("Reset tuning controls.")

    def _project_dict(self, album_wav: bool) -> dict:
        self._save_open_editors()
        sample_rate = _read_int(self.sample_rate, "Sample rate", minimum=8_000, maximum=192_000)
        transition_duration = _read_float(self.transition_duration, "Transition seconds", minimum=0.25, maximum=30.0)
        transition_style = self.transition_style.get()
        reference = self.reference_path.get().strip()
        self._sync_transitions()
        return {
            "version": 1,
            "album_title": self.album_title.get().strip() or "Untitled Album",
            "settings": {
                "sample_rate": sample_rate,
                "preset": _preset_key(self.preset.get()),
                "output_format": self.output_format.get(),
                "target_profile": self.target_profile.get(),
                "target_lufs": _optional_float(self.target_lufs.get(), "Target LUFS"),
                "ceiling_dbfs": _optional_float(self.ceiling_dbfs.get(), "Ceiling dBFS"),
                "reference_track": str(Path(reference).expanduser()) if reference else None,
                "default_interlude_duration": transition_duration,
                "default_interlude_style": transition_style,
                "arc": _arc_key(self.arc.get()),
                "arc_intensity": float(self.arc_intensity.get()),
                "tweak_lufs": _optional_float(self.tweak_lufs.get(), "LU Offset") or 0.0,
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
                    "duration_seconds": transition_duration if transition.style == "inherit" else transition.duration_seconds,
                    "style": transition.style,
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
                    style="inherit",
                    duration_seconds=_safe_float(self.transition_duration, 8.0),
                    enabled=True,
                )
            )
        del self.transitions[needed:]

    def _fresh_output_dir(self) -> Path:
        base = Path(self.output_dir.get()).expanduser()
        if not base.exists():
            return base
        if base.is_dir() and not any(base.iterdir()):
            return base
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
        candidate = base / f"run-{stamp}"
        counter = 2
        while candidate.exists():
            candidate = base / f"run-{stamp}-{counter}"
            counter += 1
        return candidate

    def _validate_output_dir(self, output_dir: Path) -> None:
        parent = output_dir if output_dir.exists() else output_dir.parent
        parent.mkdir(parents=True, exist_ok=True)
        if not parent.is_dir():
            raise ValueError(f"Output path parent is not a folder: {parent}")
        probe = parent / ".album-master-write-test"
        try:
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
        except OSError as exc:
            raise ValueError(f"Output folder is not writable: {parent}") from exc

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

    def _redraw_selected_waveform(self) -> None:
        index = self._selected_track_index()
        if index is not None and 0 <= index < len(self.tracks):
            self._draw_waveform(self.tracks[index].waveform or [])

    def _refresh_tracks(self, select: int | None = None) -> None:
        self.track_counter.set(f"{len(self.tracks)} / {MAX_TRACKS} tracks")
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
                    _num(stats.get("integrated_lufs")),
                    _num(stats.get("true_peak_dbfs")),
                    _num(stats.get("dynamic_range_db")),
                    _num(stats.get("spectral_centroid_hz"), digits=0),
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

    def _update_selected_analysis(self, track: TrackState) -> None:
        stats = track.analysis or {}
        if stats:
            self.analysis_summary.set(
                " | ".join(
                    [
                        f"LUFS {_num(stats.get('integrated_lufs'))}",
                        f"True peak {_num(stats.get('true_peak_dbfs'))} dBFS",
                        f"RMS {_num(stats.get('rms_dbfs'))} dBFS",
                        f"DR {_num(stats.get('dynamic_range_db'))}",
                        f"Crest {_num(stats.get('crest_factor_db'))} dB",
                        f"Brightness {_num(stats.get('spectral_centroid_hz'), digits=0)} Hz",
                        f"Width {_num(stats.get('stereo_width'))}",
                        f"Transients {_num(stats.get('transient_density'))}",
                    ]
                )
            )
        else:
            self.analysis_summary.set("Analyze this track to see LUFS, true peak, dynamics, brightness, width, and transient density.")
        self._draw_waveform(track.waveform or [])

    def _draw_waveform(self, waveform: list[float]) -> None:
        canvas = self.waveform_canvas
        canvas.delete("all")
        width = max(canvas.winfo_width(), 320)
        height = max(canvas.winfo_height(), 80)
        mid = height / 2.0
        canvas.create_line(0, mid, width, mid, fill="#334155")
        if not waveform:
            canvas.create_text(width / 2.0, mid, text="No waveform yet", fill="#94a3b8")
            return
        step = width / max(len(waveform), 1)
        for index, value in enumerate(waveform):
            x = index * step
            amp = max(0.0, min(float(value), 1.0)) * (height * 0.44)
            canvas.create_line(x, mid - amp, x, mid + amp, fill="#38bdf8")

    def _start_background(self, target, *args) -> None:
        if self.busy:
            messagebox.showinfo("Busy", "A background task is already running.")
            return
        self.busy = True
        self.cancel_requested = False
        self.status.set("Working...")
        self.progress.start(12)
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
                    _, index, path, stats, info, waveform = item
                    if 0 <= index < len(self.tracks) and str(self.tracks[index].path) == path:
                        self.tracks[index].analysis = stats
                        self.tracks[index].probe = info
                        self.tracks[index].waveform = waveform
                        self._refresh_tracks(select=index)
                        self._update_selected_analysis(self.tracks[index])
                elif kind == "paths":
                    self.last_output_dir = Path(item[1])
                    self.last_dashboard_path = Path(item[2]) if item[2] else self.last_dashboard_path
                elif kind == "manifest":
                    self.last_manifest = item[1]
                elif kind == "preview_path":
                    self.last_preview_path = Path(item[1])
                elif kind == "error":
                    self._log(f"Error: {item[1]}")
                    messagebox.showerror("Album Mastering Studio", item[1])
                elif kind == "done":
                    self.busy = False
                    self.status.set("Canceled" if self.cancel_requested else "Ready")
                    self.progress.stop()
        except queue.Empty:
            pass
        self.root.after(150, self._poll_queue)

    def _log(self, message: str) -> None:
        self.log.insert(tk.END, f"{datetime.now().strftime('%H:%M:%S')}  {message}\n")
        self.log.see(tk.END)

    def _open_output_folder(self) -> None:
        if self.last_output_dir and self.last_output_dir.exists():
            _open_path(self.last_output_dir)
        else:
            messagebox.showinfo("No output yet", "Render first, then open the output folder.")

    def _open_report(self) -> None:
        if self.last_dashboard_path and self.last_dashboard_path.exists():
            _open_path(self.last_dashboard_path)
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


def _optional_float(value: str, label: str = "Value") -> float | None:
    value = value.strip()
    if not value or value.lower() == "auto":
        return None
    try:
        return float(value)
    except ValueError as exc:
        raise ValueError(f"{label} must be a number or blank.") from exc


def _audio_filetypes() -> list[tuple[str, object]]:
    patterns = tuple(f"*{ext}" for ext in sorted(AUDIO_EXTENSIONS))
    return [("Audio files", patterns), ("All files", "*.*")]


def _read_int(variable: tk.Variable, label: str, minimum: int, maximum: int) -> int:
    try:
        value = int(float(variable.get()))
    except (tk.TclError, TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a number.") from exc
    if value < minimum or value > maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}.")
    return value


def _read_float(variable: tk.Variable, label: str, minimum: float, maximum: float) -> float:
    try:
        value = float(variable.get())
    except (tk.TclError, TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a number.") from exc
    if value < minimum or value > maximum:
        raise ValueError(f"{label} must be between {minimum:g} and {maximum:g}.")
    return value


def _safe_float(variable: tk.Variable, default: float) -> float:
    try:
        return float(variable.get())
    except (tk.TclError, TypeError, ValueError):
        return default


def _seconds(value: Any) -> str:
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return "n/a"
    minutes = int(seconds // 60)
    rest = seconds - (minutes * 60)
    return f"{minutes}:{rest:04.1f}"


def _num(value: Any, digits: int = 2) -> str:
    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return "n/a"


def _waveform(samples, bins: int = 128) -> list[float]:
    if samples.size == 0:
        return []
    mono = abs(samples).max(axis=1) if samples.ndim == 2 else abs(samples)
    if mono.size == 0:
        return []
    edges = np.linspace(0, mono.size, bins + 1, dtype=int)
    chunks = []
    for start, end in zip(edges[:-1], edges[1:]):
        chunk = mono[start:max(end, start + 1)]
        chunks.append(float(chunk.max()) if chunk.size else 0.0)
    peak = max(chunks) if chunks else 0.0
    if peak <= 0:
        return chunks
    return [value / peak for value in chunks]


def _format_probe(info: dict[str, Any] | None) -> str:
    if not info:
        return "unreadable"
    streams = info.get("streams") or []
    if not streams:
        return "n/a"
    stream = streams[0]
    codec = stream.get("codec_name", "?")
    rate = stream.get("sample_rate", "?")
    channels = stream.get("channels", "?")
    return f"{codec} {rate}Hz {channels}ch"


def _open_path(path: Path) -> None:
    if sys.platform.startswith("win"):
        os.startfile(str(path))
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])
