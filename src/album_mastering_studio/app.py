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
import time
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
from .standards import delivery_choice, delivery_choices, delivery_key, delivery_profile


@dataclass
class TrackState:
    path: Path
    title: str
    character: str = "auto"
    preset: str = "auto"
    artist: str = ""
    isrc: str = ""
    analysis: dict[str, Any] | None = None
    probe: dict[str, Any] | None = None
    waveform: list[float] | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class TransitionState:
    style: str = "inherit"
    duration_seconds: float = 8.0
    enabled: bool = True


UI_COLORS = {
    "bg": "#071013",
    "panel": "#0d1b1e",
    "panel_alt": "#102328",
    "panel_lift": "#132c31",
    "input": "#081518",
    "table": "#09171a",
    "table_alt": "#0c1e22",
    "line": "#26434a",
    "line_hot": "#4b7773",
    "text": "#d8e6df",
    "muted": "#88a39c",
    "faint": "#58716d",
    "primary": "#6ff0a8",
    "primary_dark": "#183f32",
    "accent": "#ffb454",
    "accent_dark": "#3b2b14",
    "danger": "#ff5c7a",
    "danger_dark": "#3a1722",
    "selection": "#1d4548",
    "wave": "#6ff0a8",
    "wave_mid": "#29464d",
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
        self.last_preview_dir: Path | None = None
        self.last_preview_path: Path | None = None
        self.last_master_preview_path: Path | None = None
        self.last_master_preview_track_index: int | None = None
        self.pending_ab_after_preview_index: int | None = None
        self.current_project_path: Path | None = None
        self.missing_audio_tools = check_audio_tools()
        self.playback_temp_dir = Path(tempfile.mkdtemp(prefix="album-master-playback-"))
        self.playback_cache: dict[tuple[str, int, int], Path] = {}
        self.playback_active = False
        self.playback_started_at = 0.0
        self.playback_duration_seconds = 0.0
        self.playback_track_index: int | None = None
        self.waveform_playhead_fraction: float | None = None
        self.playback_progress = tk.DoubleVar(value=0.0)
        self.playback_time = tk.StringVar(value="00:00 / 00:00")
        self.playback_now = tk.StringVar(value="No playback")
        self.settings_state = tk.StringVar(value="READY: choose a sound, then preview or render.")
        self.last_applied_state = tk.StringVar(value="Nothing has been previewed or rendered in this session.")
        self._tracking_changes = False
        self._settings_dirty = False
        self.cancel_requested = False
        self.editing_track_index: int | None = None
        self.editing_transition_index: int | None = None

        default_output = default_output or (Path.cwd() / "outputs" / DEFAULT_RENDER_SUBDIR)
        self.album_title = tk.StringVar(value="Untitled Album")
        self.artist = tk.StringVar(value="")
        self.album_artist = tk.StringVar(value="")
        self.release_year = tk.StringVar(value="")
        self.genre = tk.StringVar(value="")
        self.upc = tk.StringVar(value="")
        self.output_dir = tk.StringVar(value=str(default_output))
        self.reference_path = tk.StringVar(value="")
        self.sample_rate = tk.StringVar(value=str(DEFAULT_SAMPLE_RATE))
        self.bit_depth = tk.StringVar(value="24")
        self.target_profile = tk.StringVar(value=delivery_choice("streaming-universal"))
        self.codec_preview = tk.BooleanVar(value=True)
        self.preset = tk.StringVar(value=_preset_choice("album-cohesion-cinematic"))
        self.arc = tk.StringVar(value=_arc_choice("cinematic"))
        self.arc_intensity = tk.DoubleVar(value=1.0)
        self.output_format = tk.StringVar(value="wav")
        self.transition_style = tk.StringVar(value="auto")
        self.transition_duration = tk.DoubleVar(value=8.0)
        self.target_lufs = tk.StringVar(value="-14.0")
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
        self.track_artist = tk.StringVar(value="")
        self.track_isrc = tk.StringVar(value="")
        self.track_character = tk.StringVar(value="auto")
        self.track_preset = tk.StringVar(value="auto")
        self.transition_override_style = tk.StringVar(value="inherit")
        self.transition_override_duration = tk.DoubleVar(value=8.0)
        self.transition_enabled = tk.BooleanVar(value=True)
        self.track_counter = tk.StringVar(value=f"0 / {MAX_TRACKS} tracks")
        self.status = tk.StringVar(value="Ready")
        self.slider_labels: dict[str, tk.StringVar] = {}

        self._configure_theme()
        self._build_ui()
        self._refresh_tracks()
        self._bind_setting_change_markers()
        self._tracking_changes = True
        self._poll_queue()
        self._bind_shortcuts()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        if self.missing_audio_tools:
            self._log(f"Missing required audio tools: {', '.join(self.missing_audio_tools)}. Install FFmpeg/FFprobe before rendering.")

    def _configure_theme(self) -> None:
        colors = UI_COLORS
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        self.root.configure(bg=colors["bg"])
        self.root.option_add("*Font", "{Segoe UI} 9")
        self.root.option_add("*Menu.background", colors["panel"])
        self.root.option_add("*Menu.foreground", colors["text"])
        self.root.option_add("*Menu.activeBackground", colors["selection"])
        self.root.option_add("*Menu.activeForeground", colors["primary"])
        self.root.option_add("*TCombobox*Listbox.background", colors["input"])
        self.root.option_add("*TCombobox*Listbox.foreground", colors["text"])
        self.root.option_add("*TCombobox*Listbox.selectBackground", colors["selection"])
        self.root.option_add("*TCombobox*Listbox.selectForeground", colors["primary"])

        style.configure(
            ".",
            background=colors["bg"],
            foreground=colors["text"],
            bordercolor=colors["line"],
            darkcolor=colors["panel"],
            lightcolor=colors["panel_lift"],
            troughcolor=colors["input"],
            selectbackground=colors["selection"],
            selectforeground=colors["text"],
            font=("Segoe UI", 9),
        )
        style.configure("TFrame", background=colors["bg"])
        style.configure("Panel.TFrame", background=colors["panel"])
        style.configure("TLabel", background=colors["bg"], foreground=colors["text"])
        style.configure("Muted.TLabel", background=colors["bg"], foreground=colors["muted"])
        style.configure("Brand.TLabel", background=colors["bg"], foreground=colors["primary"], font=("Segoe UI Semibold", 15))
        style.configure("Console.TLabel", background=colors["bg"], foreground=colors["accent"], font=("Segoe UI Semibold", 9))
        style.configure("Counter.TLabel", background=colors["bg"], foreground=colors["primary"], font=("Segoe UI Semibold", 9))

        style.configure(
            "TLabelframe",
            background=colors["panel"],
            foreground=colors["primary"],
            bordercolor=colors["line"],
            relief="solid",
            borderwidth=1,
        )
        style.configure(
            "TLabelframe.Label",
            background=colors["bg"],
            foreground=colors["primary"],
            font=("Segoe UI Semibold", 9),
        )

        style.configure(
            "TEntry",
            fieldbackground=colors["input"],
            foreground=colors["text"],
            insertcolor=colors["primary"],
            bordercolor=colors["line"],
            lightcolor=colors["line"],
            darkcolor=colors["line"],
            padding=(6, 4),
        )
        style.configure(
            "TCombobox",
            fieldbackground=colors["input"],
            background=colors["panel_lift"],
            foreground=colors["text"],
            arrowcolor=colors["primary"],
            bordercolor=colors["line"],
            padding=(6, 3),
        )
        style.map(
            "TCombobox",
            fieldbackground=[("readonly", colors["input"]), ("disabled", colors["panel"])],
            foreground=[("readonly", colors["text"]), ("disabled", colors["faint"])],
            background=[("active", colors["panel_lift"]), ("readonly", colors["panel_lift"])],
        )
        style.configure(
            "TSpinbox",
            fieldbackground=colors["input"],
            foreground=colors["text"],
            arrowcolor=colors["primary"],
            bordercolor=colors["line"],
            padding=(6, 3),
        )

        self._configure_button_styles(style)
        style.configure("TCheckbutton", background=colors["panel"], foreground=colors["text"], indicatorcolor=colors["input"])
        style.map("TCheckbutton", background=[("active", colors["panel"])], foreground=[("active", colors["text"])])
        style.configure("Horizontal.TScale", background=colors["panel"], troughcolor=colors["input"], bordercolor=colors["line"])
        style.configure("TProgressbar", troughcolor=colors["input"], background=colors["primary"], bordercolor=colors["line"])
        style.configure("TPanedwindow", background=colors["bg"])
        style.configure(
            "Vertical.TScrollbar",
            background=colors["panel_lift"],
            troughcolor=colors["input"],
            bordercolor=colors["line"],
            arrowcolor=colors["primary"],
            relief="flat",
        )
        style.map("Vertical.TScrollbar", background=[("active", colors["panel_lift"]), ("pressed", colors["panel_lift"])])

        style.configure(
            "Treeview",
            background=colors["table"],
            fieldbackground=colors["table"],
            foreground=colors["text"],
            bordercolor=colors["line"],
            rowheight=25,
            relief="flat",
        )
        style.configure(
            "Treeview.Heading",
            background=colors["panel_lift"],
            foreground=colors["accent"],
            bordercolor=colors["line"],
            relief="flat",
            font=("Segoe UI Semibold", 9),
        )
        style.map(
            "Treeview",
            background=[("selected", colors["selection"])],
            foreground=[("selected", colors["primary"])],
        )

    def _configure_button_styles(self, style: ttk.Style) -> None:
        colors = UI_COLORS

        def button_style(name: str, bg: str, fg: str, border: str) -> None:
            style.configure(
                name,
                background=bg,
                foreground=fg,
                bordercolor=border,
                focusthickness=1,
                focuscolor=border,
                padding=(10, 6),
                relief="flat",
                font=("Segoe UI Semibold", 9),
            )
            style.map(
                name,
                background=[("active", bg), ("pressed", bg), ("disabled", colors["panel"])],
                foreground=[("active", fg), ("pressed", fg), ("disabled", colors["faint"])],
                bordercolor=[("active", border), ("pressed", border)],
            )

        button_style("TButton", colors["panel_lift"], colors["text"], colors["line"])
        button_style("Primary.TButton", colors["primary_dark"], colors["primary"], colors["primary"])
        button_style("Accent.TButton", colors["accent_dark"], colors["accent"], colors["accent"])
        button_style("Danger.TButton", colors["danger_dark"], colors["danger"], colors["danger"])
        button_style("Ghost.TButton", colors["panel"], colors["muted"], colors["line"])

    def _build_ui(self) -> None:
        self._build_menu()
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        header = ttk.Frame(self.root, padding=(14, 12, 14, 8))
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(1, weight=1)
        header.columnconfigure(3, weight=1)
        ttk.Label(header, text="ALBUM MASTERING STUDIO", style="Brand.TLabel").grid(row=0, column=0, columnspan=2, sticky="w")
        ttk.Label(header, text="LOCAL OFFLINE RENDER CONSOLE", style="Console.TLabel").grid(row=0, column=2, columnspan=3, sticky="e")
        ttk.Label(header, text="Album Title").grid(row=1, column=0, sticky="w", pady=(10, 0))
        ttk.Entry(header, textvariable=self.album_title).grid(row=1, column=1, sticky="ew", padx=(8, 12), pady=(10, 0))
        ttk.Label(header, text="Output").grid(row=1, column=2, sticky="w", pady=(10, 0))
        ttk.Entry(header, textvariable=self.output_dir, width=48).grid(row=1, column=3, sticky="ew", padx=(8, 6), pady=(10, 0))
        ttk.Button(header, text="Browse", command=self._choose_output, style="Ghost.TButton").grid(row=1, column=4, pady=(10, 0))
        ttk.Label(header, text="Artist").grid(row=2, column=0, sticky="w", pady=(8, 0))
        ttk.Entry(header, textvariable=self.artist).grid(row=2, column=1, sticky="ew", padx=(8, 12), pady=(8, 0))
        ttk.Label(header, text="Album Artist").grid(row=2, column=2, sticky="w", pady=(8, 0))
        ttk.Entry(header, textvariable=self.album_artist).grid(row=2, column=3, sticky="ew", padx=(8, 6), pady=(8, 0))
        metadata_row = ttk.Frame(header)
        metadata_row.grid(row=2, column=4, sticky="ew", pady=(8, 0))
        ttk.Label(metadata_row, text="Year").pack(side=tk.LEFT, padx=(0, 3))
        ttk.Entry(metadata_row, textvariable=self.release_year, width=7).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Label(metadata_row, text="Genre").pack(side=tk.LEFT, padx=(0, 3))
        ttk.Entry(metadata_row, textvariable=self.genre, width=13).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Label(metadata_row, text="UPC").pack(side=tk.LEFT, padx=(0, 3))
        ttk.Entry(metadata_row, textvariable=self.upc, width=14).pack(side=tk.LEFT)
        ttk.Label(header, text="Reference").grid(row=3, column=0, sticky="w", pady=(8, 0))
        ttk.Entry(header, textvariable=self.reference_path).grid(row=3, column=1, columnspan=3, sticky="ew", padx=(8, 6), pady=(8, 0))
        ttk.Button(header, text="Browse", command=self._choose_reference, style="Ghost.TButton").grid(row=3, column=4, pady=(8, 0))

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
        run_menu.add_command(label="Render Full Album + Transitions", accelerator="Ctrl+R", command=lambda: self._render(album_wav=True))
        run_menu.add_command(label="Smoke Check", command=self._run_smoke_check)
        menu.add_cascade(label="Run", menu=run_menu)
        for item in (menu, file_menu, run_menu):
            item.configure(
                background=UI_COLORS["panel"],
                foreground=UI_COLORS["text"],
                activebackground=UI_COLORS["selection"],
                activeforeground=UI_COLORS["primary"],
                borderwidth=0,
            )
        self.root.config(menu=menu)

    def _build_track_panel(self, parent: ttk.Frame) -> None:
        parent.rowconfigure(1, weight=1)
        parent.columnconfigure(0, weight=1)
        toolbar = ttk.Frame(parent)
        toolbar.grid(row=0, column=0, sticky="ew", pady=(0, 6))
        for text, command, style_name in (
            ("Add Files", self._add_files, "Primary.TButton"),
            ("Remove", self._remove_selected_track, "Danger.TButton"),
            ("Move Up", lambda: self._move_track(-1), "Ghost.TButton"),
            ("Move Down", lambda: self._move_track(1), "Ghost.TButton"),
            ("Analyze", self._analyze_tracks, "Accent.TButton"),
            ("Preview Master", self._preview_selected_master, "Primary.TButton"),
            ("Play Source", self._play_selected_source, "TButton"),
            ("Play Master", self._play_selected_master, "TButton"),
            ("A/B Compare", self._play_ab_clip, "Accent.TButton"),
            ("Play Album", self._play_album_sequence, "TButton"),
            ("Stop", self._stop_playback, "Ghost.TButton"),
        ):
            ttk.Button(toolbar, text=text, command=command, style=style_name).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Label(toolbar, textvariable=self.track_counter, style="Counter.TLabel").pack(side=tk.RIGHT)

        columns = ("title", "duration", "lufs", "peak", "dr", "brightness", "format", "character", "preset", "path")
        self.track_tree = ttk.Treeview(parent, columns=columns, show="headings", height=12)
        for name, label, width in (
            ("title", "Title", 180),
            ("duration", "Duration", 82),
            ("lufs", "LUFS", 70),
            ("peak", "True Peak", 82),
            ("dr", "LRA", 55),
            ("brightness", "Bright", 70),
            ("format", "Format", 120),
            ("character", "Character", 120),
            ("preset", "Preset", 145),
            ("path", "Path", 360),
        ):
            self.track_tree.heading(name, text=label)
            self.track_tree.column(name, width=width, minwidth=60, stretch=name == "path")
        self.track_tree.grid(row=1, column=0, sticky="nsew")
        self.track_tree.tag_configure("even", background=UI_COLORS["table"])
        self.track_tree.tag_configure("odd", background=UI_COLORS["table_alt"])
        self.track_tree.tag_configure("warning", foreground=UI_COLORS["accent"])
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
        ttk.Button(detail, text="Apply Track Override", command=self._apply_track_override, style="Accent.TButton").grid(
            row=1, column=3, sticky="ew", padx=8, pady=(8, 0)
        )
        ttk.Label(detail, text="Artist").grid(row=2, column=0, sticky="w", pady=(8, 0))
        ttk.Entry(detail, textvariable=self.track_artist).grid(row=2, column=1, sticky="ew", padx=8, pady=(8, 0))
        ttk.Label(detail, text="ISRC").grid(row=2, column=2, sticky="w", pady=(8, 0))
        ttk.Entry(detail, textvariable=self.track_isrc, width=18).grid(row=2, column=3, sticky="ew", padx=8, pady=(8, 0))

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
        self.transition_tree.tag_configure("even", background=UI_COLORS["table"])
        self.transition_tree.tag_configure("odd", background=UI_COLORS["table_alt"])
        self.transition_tree.tag_configure("disabled", foreground=UI_COLORS["faint"])
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
        ttk.Button(controls, text="Apply Transition", command=self._apply_transition_override, style="Accent.TButton").pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(controls, text="Preview Transition", command=self._preview_transition, style="Primary.TButton").pack(side=tk.LEFT)
        ttk.Button(controls, text="Play Preview", command=self._play_last_preview).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(controls, text="Play Rendered", command=self._play_rendered_transition).pack(side=tk.LEFT, padx=(6, 0))

        waveform_box = ttk.LabelFrame(parent, text="Selected Track Waveform / Analysis", padding=8)
        waveform_box.grid(row=4, column=0, sticky="ew", pady=(8, 0))
        waveform_box.columnconfigure(0, weight=1)
        self.waveform_canvas = tk.Canvas(
            waveform_box,
            height=82,
            bg=UI_COLORS["input"],
            highlightthickness=1,
            highlightbackground=UI_COLORS["line_hot"],
        )
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
        quick_presets = ttk.Frame(settings)
        quick_presets.grid(row=3, column=0, columnspan=3, sticky="ew", pady=(10, 0))
        for column, (label, key) in enumerate(
            (
                ("Natural", "acoustic-natural"),
                ("Metal", "heavy-rock-metal"),
                ("Djent", "djent-modern-metal"),
                ("Warm", "warm-glue"),
                ("Bright", "bright-air"),
                ("Loud", "loud-aggressive"),
                ("Cinematic", "album-cohesion-cinematic"),
            )
        ):
            quick_presets.columnconfigure(column, weight=1)
            ttk.Button(
                quick_presets,
                text=label,
                command=lambda preset_key=key: self._choose_preset(preset_key),
                style="Ghost.TButton",
            ).grid(row=0, column=column, sticky="ew", padx=(0 if column == 0 else 3, 0))

        render = ttk.LabelFrame(parent, text="Render Settings", padding=10)
        render.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        for index in range(4):
            render.columnconfigure(index, weight=1)
        ttk.Label(render, text="Delivery Profile").grid(row=0, column=0, sticky="w")
        target_box = ttk.Combobox(render, textvariable=self.target_profile, values=delivery_choices(), state="readonly")
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
        ttk.Label(render, text="Bit Depth").grid(row=3, column=2, sticky="w", pady=(8, 0))
        ttk.Combobox(render, textvariable=self.bit_depth, values=("16", "24", "32"), state="readonly", width=8).grid(
            row=3, column=3, sticky="ew", padx=8, pady=(8, 0)
        )
        ttk.Label(render, text="Format").grid(row=4, column=0, sticky="w", pady=(8, 0))
        ttk.Combobox(render, textvariable=self.output_format, values=("wav", "flac", "mp3", "m4a", "ogg", "opus"), state="readonly").grid(
            row=4, column=1, sticky="ew", padx=8, pady=(8, 0)
        )
        ttk.Checkbutton(render, text="Codec QC preview", variable=self.codec_preview).grid(row=4, column=2, columnspan=2, sticky="w", pady=(8, 0))

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

        listen = ttk.LabelFrame(parent, text="Listen / Apply State", padding=10)
        listen.grid(row=3, column=0, sticky="ew", pady=(8, 0))
        listen.columnconfigure(0, weight=1)
        ttk.Label(listen, textvariable=self.settings_state, style="Console.TLabel").grid(row=0, column=0, columnspan=4, sticky="ew")
        ttk.Label(listen, textvariable=self.last_applied_state, style="Muted.TLabel", wraplength=520).grid(
            row=1, column=0, columnspan=4, sticky="ew", pady=(4, 8)
        )
        for column, (text, command, style_name) in enumerate(
            (
                ("Preview Master", self._preview_selected_master, "Primary.TButton"),
                ("A/B Compare", self._play_ab_clip, "Accent.TButton"),
                ("Play Source", self._play_selected_source, "TButton"),
                ("Play Master", self._play_selected_master, "TButton"),
            )
        ):
            listen.columnconfigure(column, weight=1)
            ttk.Button(listen, text=text, command=command, style=style_name).grid(
                row=2, column=column, sticky="ew", padx=(0 if column == 0 else 4, 0)
            )

        actions = ttk.LabelFrame(parent, text="Actions", padding=10)
        actions.grid(row=4, column=0, sticky="ew", pady=(8, 0))
        for text, command, style_name in (
            ("Auto Master Album (Full WAV + Transitions)", lambda: self._render(album_wav=True), "Primary.TButton"),
            ("Render Masters + Transition Files Only", lambda: self._render(album_wav=False), "Accent.TButton"),
            ("Open Report", self._open_report, "TButton"),
            ("Open Output Folder", self._open_output_folder, "TButton"),
            ("Open Project", self._open_project, "Ghost.TButton"),
            ("Save Project As", self._save_project_as, "Ghost.TButton"),
            ("Smoke Check", self._run_smoke_check, "Ghost.TButton"),
            ("Reset Tuning", self._reset_tuning, "Danger.TButton"),
        ):
            ttk.Button(actions, text=text, command=command, style=style_name).pack(fill=tk.X, pady=3)

    def _build_log_panel(self) -> None:
        log_frame = ttk.LabelFrame(self.root, text="Progress / Warnings", padding=(10, 6, 10, 10))
        log_frame.grid(row=2, column=0, sticky="ew", padx=12, pady=(0, 12))
        log_frame.columnconfigure(0, weight=1)
        status_row = ttk.Frame(log_frame)
        status_row.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 6))
        status_row.columnconfigure(1, weight=1)
        ttk.Label(status_row, textvariable=self.status, style="Console.TLabel").grid(row=0, column=0, sticky="w")
        self.progress = ttk.Progressbar(status_row, mode="indeterminate")
        self.progress.grid(row=0, column=1, sticky="ew", padx=10)
        self.cancel_button = ttk.Button(status_row, text="Cancel", command=self._request_cancel, style="Danger.TButton", state=tk.DISABLED)
        self.cancel_button.grid(row=0, column=2, sticky="e", padx=(0, 6))
        ttk.Button(status_row, text="Clear Log", command=self._clear_log, style="Ghost.TButton").grid(row=0, column=3, sticky="e")
        playback_row = ttk.Frame(log_frame)
        playback_row.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(0, 6))
        playback_row.columnconfigure(1, weight=1)
        ttk.Label(playback_row, textvariable=self.playback_now, style="Muted.TLabel", width=28).grid(row=0, column=0, sticky="w")
        ttk.Progressbar(playback_row, variable=self.playback_progress, maximum=100.0, mode="determinate").grid(
            row=0, column=1, sticky="ew", padx=10
        )
        ttk.Label(playback_row, textvariable=self.playback_time, style="Console.TLabel", width=16).grid(row=0, column=2, sticky="e")
        self.log = tk.Text(log_frame, height=8, wrap=tk.WORD)
        self.log.configure(
            background=UI_COLORS["input"],
            foreground=UI_COLORS["text"],
            insertbackground=UI_COLORS["primary"],
            selectbackground=UI_COLORS["selection"],
            selectforeground=UI_COLORS["primary"],
            relief=tk.FLAT,
            borderwidth=1,
            highlightthickness=1,
            highlightbackground=UI_COLORS["line"],
            font=("Cascadia Mono", 9),
        )
        self.log.grid(row=2, column=0, sticky="ew")
        self.log.tag_configure("time", foreground=UI_COLORS["faint"])
        self.log.tag_configure("normal", foreground=UI_COLORS["text"])
        self.log.tag_configure("ok", foreground=UI_COLORS["primary"])
        self.log.tag_configure("warning", foreground=UI_COLORS["accent"])
        self.log.tag_configure("error", foreground=UI_COLORS["danger"])
        scrollbar = ttk.Scrollbar(log_frame, orient=tk.VERTICAL, command=self.log.yview)
        scrollbar.grid(row=2, column=1, sticky="ns")
        self.log.configure(yscrollcommand=scrollbar.set)
        self._log(
            f"Ready. Add up to {MAX_TRACKS} songs, choose a preset, use Preview Master or A/B Compare to hear changes, then Auto Master Album."
        )

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

    def _bind_setting_change_markers(self) -> None:
        watched: tuple[tk.Variable, ...] = (
            self.album_title,
            self.artist,
            self.album_artist,
            self.release_year,
            self.genre,
            self.upc,
            self.reference_path,
            self.sample_rate,
            self.bit_depth,
            self.target_profile,
            self.codec_preview,
            self.preset,
            self.arc,
            self.arc_intensity,
            self.output_format,
            self.transition_style,
            self.transition_duration,
            self.target_lufs,
            self.ceiling_dbfs,
            self.tweak_lufs,
            self.brightness,
            self.bass_weight,
            self.mid_presence,
            self.air,
            self.warmth,
            self.compression,
            self.limiter,
            self.width,
        )
        for variable in watched:
            variable.trace_add("write", lambda *_args: self._mark_settings_pending())
        for variable in (self.transition_style, self.transition_duration):
            variable.trace_add("write", lambda *_args: self._refresh_transitions())

    def _mark_settings_pending(self) -> None:
        if not self._tracking_changes:
            return
        self._settings_dirty = True
        self.settings_state.set("PENDING: click Preview Master, A/B Compare, or Auto Master Album to hear these settings.")

    def _mark_applied(self, message: str) -> None:
        self._settings_dirty = False
        self.settings_state.set("APPLIED: the current settings have a fresh preview/render.")
        self.last_applied_state.set(message)

    def _invalidate_render_outputs(self) -> None:
        self.last_manifest = None
        self.last_dashboard_path = None
        self.last_preview_dir = None
        self.last_preview_path = None
        self.last_master_preview_path = None
        self.last_master_preview_track_index = None
        self.pending_ab_after_preview_index = None
        self.pending_ab_after_preview_index = None

    def _choose_preset(self, key: str) -> None:
        self.preset.set(_preset_choice(key))
        self._log(f"Preset selected: {PRESETS[key].display_name}. Preview or render to hear it.")

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
        profile = delivery_profile(delivery_key(self.target_profile.get()))
        if profile.target_lufs is not None:
            self.target_lufs.set(f"{profile.target_lufs:.1f}")
        if profile.ceiling_dbfs is not None:
            self.ceiling_dbfs.set(f"{profile.ceiling_dbfs:.1f}")
        if profile.sample_rate is not None:
            self.sample_rate.set(str(profile.sample_rate))
        if profile.bit_depth is not None:
            self.bit_depth.set(str(profile.bit_depth))
        if profile.output_format is not None:
            self.output_format.set(profile.output_format)
        self.codec_preview.set(profile.codec_preview)
        self._log(f"Applied delivery profile: {profile.display_name}. {profile.note}")

    def _request_cancel(self) -> None:
        if not self.busy:
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
        metadata = project.get("metadata", {})
        self.last_manifest = None
        self.last_dashboard_path = None
        self.last_preview_dir = None
        self.last_preview_path = None
        self.last_master_preview_path = None
        self.last_master_preview_track_index = None
        self.album_title.set(str(project.get("album_title") or "Untitled Album"))
        self.artist.set(str(metadata.get("artist", "")))
        self.album_artist.set(str(metadata.get("album_artist", "")))
        self.release_year.set(str(metadata.get("release_year", "")))
        self.genre.set(str(metadata.get("genre", "")))
        self.upc.set(str(metadata.get("upc", "")))
        self.sample_rate.set(str(settings.get("sample_rate", DEFAULT_SAMPLE_RATE)))
        self.bit_depth.set(str(settings.get("bit_depth", 24)))
        self.preset.set(_preset_choice(str(settings.get("preset", "album-cohesion-cinematic"))))
        self.arc.set(_arc_choice(str(settings.get("arc", "cinematic"))))
        self.arc_intensity.set(float(settings.get("arc_intensity", 1.0)))
        self.output_format.set(str(settings.get("output_format", "wav")))
        self.target_profile.set(_delivery_choice_from_settings(settings))
        self.codec_preview.set(bool(settings.get("codec_preview", True)))
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
                    artist=str(raw_track.get("artist") or ""),
                    isrc=str(raw_track.get("isrc") or ""),
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
        self._settings_dirty = True
        self.settings_state.set("PENDING: opened project needs a fresh preview or render.")
        self.last_applied_state.set(f"Opened project: {project_path}")

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
            self.tracks.append(TrackState(path=path, title=path.stem, artist=self.artist.get().strip()))
            added += 1
        if added:
            self._sync_transitions()
            self._refresh_tracks()
            self._invalidate_render_outputs()
            self._mark_settings_pending()
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
        self._invalidate_render_outputs()
        self._mark_settings_pending()
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
        self._invalidate_render_outputs()
        self._mark_settings_pending()
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
        self.track_artist.set(track.artist or self.artist.get())
        self.track_isrc.set(track.isrc)
        self.track_character.set(track.character)
        self.track_preset.set("auto" if track.preset == "auto" else _preset_choice(track.preset))
        self._update_selected_analysis(track)

    def _apply_track_override(self) -> None:
        index = self._selected_track_index()
        if index is None:
            return
        self._save_track_editor(index, silent=False)
        self._refresh_tracks(select=index)
        self._mark_settings_pending()

    def _save_track_editor(self, index: int, silent: bool) -> None:
        if index < 0 or index >= len(self.tracks):
            return
        track = self.tracks[index]
        try:
            preset = _preset_key_or_auto(self.track_preset.get())
        except ValueError:
            preset = track.preset
        before = (track.title, track.artist, track.isrc, track.character, track.preset)
        track.title = self.track_title.get().strip() or track.path.stem
        track.artist = self.track_artist.get().strip()
        track.isrc = self.track_isrc.get().strip().upper()
        track.character = self.track_character.get()
        track.preset = preset
        after = (track.title, track.artist, track.isrc, track.character, track.preset)
        if before != after:
            self._mark_settings_pending()
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
            self._mark_settings_pending()

    def _save_transition_editor(self, index: int, silent: bool) -> bool:
        if index < 0 or index >= len(self.transitions):
            return False
        try:
            duration = _read_float(self.transition_override_duration, "Transition override seconds", minimum=0.25, maximum=30.0)
        except ValueError as exc:
            if not silent:
                messagebox.showerror("Invalid transition", str(exc))
            return False
        current = self.transitions[index]
        updated = TransitionState(
            style=self.transition_override_style.get(),
            duration_seconds=duration,
            enabled=bool(self.transition_enabled.get()),
        )
        self.transitions[index] = updated
        if current != updated:
            self._mark_settings_pending()
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
        self.settings_state.set("RENDERING: applying current settings to the album.")
        self.last_applied_state.set("Rendering now. The output folder, album WAV, transitions, and report will update when it finishes.")
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
            track_count = manifest.get("track_count", 0)
            interlude_count = manifest.get("interlude_count", 0)
            album_sequence = manifest.get("album_sequence")
            summary = (
                f"Render complete: {track_count} masters, "
                f"{interlude_count} transitions"
            )
            if album_sequence:
                summary += ", continuous album WAV"
            elif project.get("settings", {}).get("album_wav"):
                summary += ", no album WAV"
            self.queue.put(("log", f"{summary}.{score_text}"))
            self.queue.put(
                (
                    "applied_state",
                    f"Last render used current settings: {track_count} masters, {interlude_count} transitions. Output: {output_dir}",
                )
            )
            if album_sequence:
                self.queue.put(("log", f"Continuous album WAV: {album_sequence}"))
            if interlude_count:
                self.queue.put(("log", f"Transition files: {manifest.get('outputs', {}).get('interludes_dir')}"))
            if project.get("settings", {}).get("album_wav") and len(project.get("tracks", [])) > 1 and manifest.get("interlude_count", 0) == 0:
                self.queue.put(("log", "Warning: full album render produced zero transitions; check whether transitions are disabled."))
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
            output_dir = Path(self.output_dir.get()).expanduser() / "previews" / "transitions"
            self._validate_output_dir(output_dir)
        except ValueError as exc:
            messagebox.showerror("Invalid settings", str(exc))
            return
        self.settings_state.set("PREVIEWING: applying current transition settings.")
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
            self.queue.put(("preview_dir", output_dir))
            self.queue.put(("preview_path", preview_path))
            self.queue.put(("log", f"Preview rendered and queued for playback: {summary['output']}"))
            self.queue.put(("applied_state", f"Transition preview used current settings: {preview_path}"))
            self.queue.put(("play_path", str(preview_path), "Transition preview"))
        except Exception as exc:
            self.queue.put(("error", str(exc)))
        finally:
            self.queue.put(("done",))

    def _preview_selected_master(self, auto_play: bool = True) -> None:
        index = self._selected_track_index()
        if index is None:
            messagebox.showinfo("No track", "Select a track first.")
            return
        if self.missing_audio_tools:
            messagebox.showerror("Missing FFmpeg", f"Missing required audio tools: {', '.join(self.missing_audio_tools)}")
            return
        try:
            project = self._project_dict(album_wav=False)
            project["tracks"] = [project["tracks"][index]]
            project["transitions"] = []
            output_dir = Path(self.output_dir.get()).expanduser() / "previews" / f"master_{index + 1:02d}"
            self._validate_output_dir(output_dir)
        except ValueError as exc:
            messagebox.showerror("Invalid settings", str(exc))
            return
        self.settings_state.set("PREVIEWING: applying current settings to the selected song.")
        self._start_background(self._preview_master_worker, project, output_dir, index, auto_play)

    def _preview_master_worker(self, project: dict, output_dir: Path, original_index: int, auto_play: bool) -> None:
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
            project_path = output_dir / "master-preview.ams.json"
            project_path.write_text(json.dumps(project, indent=2), encoding="utf-8")
            self.queue.put(("log", f"Rendering selected-track master preview to {output_dir}..."))
            if self.cancel_requested:
                self.queue.put(("log", "Master preview canceled before render started."))
                return
            manifest = render_project(project_path, output_dir)
            tracks = [item for item in manifest.get("sequence", []) if item.get("type") == "track"]
            if not tracks:
                raise RuntimeError("Master preview did not produce a track output.")
            preview_path = Path(tracks[0]["output"])
            self.queue.put(("preview_dir", output_dir))
            self.queue.put(("preview_master_path", str(preview_path), original_index))
            self.queue.put(("log", f"Master preview rendered: {preview_path}"))
            self.queue.put(("applied_state", f"Master preview used current settings for track {original_index + 1}: {preview_path}"))
            if auto_play:
                self.queue.put(("play_path", str(preview_path), "Master preview", original_index))
        except Exception as exc:
            self.queue.put(("error", str(exc)))
        finally:
            self.queue.put(("done",))

    def _play_selected_source(self) -> None:
        index = self._selected_track_index()
        if index is None:
            messagebox.showinfo("No track", "Select a track first.")
            return
        self._play_audio_path(self.tracks[index].path, label=f"Original: {self.tracks[index].title}", track_index=index)

    def _play_selected_master(self) -> None:
        index = self._selected_track_index()
        if index is None:
            messagebox.showinfo("No track", "Select a track first.")
            return
        master_path = self._selected_master_path(index)
        if master_path is None:
            self._log("No fresh master preview exists yet; rendering Preview Master first.")
            self._preview_selected_master(auto_play=True)
            return
        if self._settings_dirty:
            self._log("Warning: Play Master is using the last preview/render. Current control changes are pending; click Preview Master to hear them.")
        self._play_audio_path(master_path, label=f"Mastered: {self.tracks[index].title}", track_index=index)

    def _play_ab_clip(self) -> None:
        index = self._selected_track_index()
        if index is None:
            messagebox.showinfo("No track", "Select a track first.")
            return
        master_path = self._selected_master_path(index)
        if master_path is None:
            self.pending_ab_after_preview_index = index
            self._log("No fresh master preview exists yet; rendering Preview Master first, then A/B Compare will start.")
            self._preview_selected_master(auto_play=False)
            return
        if self._settings_dirty:
            self._log("Warning: A/B Compare is using the last preview/render. Current control changes are pending; click Preview Master first for a fresh comparison.")
        try:
            sample_rate = _read_int(self.sample_rate, "Sample rate", minimum=8_000, maximum=192_000)
            source = load_audio(self.tracks[index].path, sample_rate)
            master = load_audio(master_path, sample_rate)
            start, end = _audible_preview_window(source, sample_rate, seconds=10.0)
            frames = min(end - start, max(master.shape[0] - start, 0), int(sample_rate * 10.0))
            if frames <= 0:
                raise ValueError("selected track has no playable audio")
            gap = np.zeros((int(sample_rate * 0.25), 2), dtype=np.float32)
            source_segment = source[start : start + frames]
            master_segment = master[start : start + frames]
            clip = np.concatenate([source_segment, gap, master_segment, gap, source_segment, gap, master_segment], axis=0)
            path = self.playback_temp_dir / f"ab_track_{index + 1:02d}.wav"
            write_audio(path, clip, sample_rate, bit_depth=24)
            self._log(f"A/B clip rendered from {_time_label(start / sample_rate)}: original -> mastered -> original -> mastered.")
            self._play_audio_path(path, label="A/B original/mastered", track_index=index)
        except Exception as exc:
            messagebox.showerror("A/B clip failed", str(exc))

    def _play_album_sequence(self) -> None:
        album_path = self._album_sequence_path()
        if album_path is None:
            messagebox.showinfo("No album render yet", "Use Render Full Album + Transitions first.")
            return
        self._play_audio_path(album_path, label="Full album")

    def _play_rendered_transition(self) -> None:
        index = self._selected_transition_index()
        if index is None:
            messagebox.showinfo("No transition", "Select a transition first.")
            return
        transition_path = self._rendered_transition_path(index)
        if transition_path is None:
            messagebox.showinfo("No rendered transition yet", "Use Preview Transition or Render Full Album + Transitions first.")
            return
        self._play_audio_path(transition_path, label=f"Rendered transition {index + 1}")

    def _play_last_preview(self) -> None:
        if self.last_preview_path and self.last_preview_path.exists():
            self._play_audio_path(self.last_preview_path, label="Transition preview")
        else:
            messagebox.showinfo("No preview yet", "Render a transition preview first.")

    def _stop_playback(self) -> None:
        if winsound is not None:
            winsound.PlaySound(None, winsound.SND_PURGE)
        self.playback_active = False
        self.playback_track_index = None
        self.waveform_playhead_fraction = None
        self.playback_progress.set(0.0)
        self.playback_time.set("00:00 / 00:00")
        self.playback_now.set("Stopped")
        self._redraw_selected_waveform()
        self._log("Stopped playback.")

    def _play_audio_path(self, path: Path, label: str | None = None, track_index: int | None = None) -> None:
        if not path.exists():
            messagebox.showinfo("Missing file", f"Audio file does not exist: {path}")
            return
        if winsound is None:
            _open_path(path)
            self._start_playback_meter(path, _audio_duration(path), label or path.stem, track_index=track_index)
            self._log(f"Opened {label or path.stem}: {path}")
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
            self._start_playback_meter(path, _audio_duration(path), label or path.stem, track_index=track_index)
            self._log(f"Playing {label or path.stem}: {path}")
        except Exception as exc:
            self._log(f"Playback fallback: {exc}")
            _open_path(path)
            self._start_playback_meter(path, _audio_duration(path), label or path.stem, track_index=track_index)

    def _start_playback_meter(self, path: Path, duration_seconds: float, label: str, track_index: int | None = None) -> None:
        self.playback_active = True
        self.playback_started_at = time.monotonic()
        self.playback_duration_seconds = max(float(duration_seconds), 0.0)
        self.playback_track_index = track_index
        self.waveform_playhead_fraction = 0.0 if track_index is not None else None
        self.playback_now.set(label)
        self.playback_progress.set(0.0)
        self.playback_time.set(f"00:00 / {_time_label(self.playback_duration_seconds)}")
        self._redraw_selected_waveform()
        self._update_playback_meter()

    def _update_playback_meter(self) -> None:
        if not self.playback_active:
            return
        elapsed = max(time.monotonic() - self.playback_started_at, 0.0)
        duration = self.playback_duration_seconds
        if duration > 0:
            fraction = min(elapsed / duration, 1.0)
            self.playback_progress.set(fraction * 100.0)
            if self.playback_track_index is not None:
                self.waveform_playhead_fraction = fraction
                self._redraw_selected_waveform()
            self.playback_time.set(f"{_time_label(min(elapsed, duration))} / {_time_label(duration)}")
            if elapsed >= duration:
                self.playback_active = False
                self.playback_progress.set(100.0)
                self.waveform_playhead_fraction = 1.0 if self.playback_track_index is not None else None
                self._redraw_selected_waveform()
                self.playback_now.set("Finished")
                return
        else:
            self.playback_time.set(f"{_time_label(elapsed)} / --:--")
        self.root.after(250, self._update_playback_meter)

    def _selected_master_path(self, index: int) -> Path | None:
        if self.last_master_preview_track_index == index and self.last_master_preview_path and self.last_master_preview_path.exists():
            return self.last_master_preview_path
        if self.last_manifest:
            tracks = [item for item in self.last_manifest.get("sequence", []) if item.get("type") == "track"]
            if index < len(tracks):
                path = Path(tracks[index]["output"])
                if path.exists():
                    return path
        return None

    def _album_sequence_path(self) -> Path | None:
        if not self.last_manifest or not self.last_manifest.get("album_sequence"):
            return None
        path = Path(self.last_manifest["album_sequence"])
        return path if path.exists() else None

    def _rendered_transition_path(self, index: int) -> Path | None:
        if not self.last_manifest:
            return None
        for item in self.last_manifest.get("sequence", []):
            if item.get("type") == "interlude" and item.get("between") == [index + 1, index + 2]:
                path = Path(item.get("output", ""))
                if path.exists():
                    return path
        return None

    def _run_smoke_check(self) -> None:
        if self.missing_audio_tools:
            messagebox.showerror("Missing FFmpeg", f"Missing required audio tools: {', '.join(self.missing_audio_tools)}")
            return
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
        self.target_lufs.set("-14.0")
        self.ceiling_dbfs.set("-1.0")
        self.sample_rate.set(str(DEFAULT_SAMPLE_RATE))
        self.bit_depth.set("24")
        self.output_format.set("wav")
        self.codec_preview.set(True)
        self.tweak_lufs.set("0.0")
        self.target_profile.set(delivery_choice("streaming-universal"))
        self._refresh_tracks()
        self._mark_settings_pending()
        self._log("Reset global tuning controls. Track and transition overrides were preserved.")

    def _project_dict(self, album_wav: bool) -> dict:
        self._save_open_editors()
        sample_rate = _read_int(self.sample_rate, "Sample rate", minimum=8_000, maximum=192_000)
        bit_depth = _read_int(self.bit_depth, "Bit depth", minimum=16, maximum=32)
        if bit_depth not in {16, 24, 32}:
            raise ValueError("Bit depth must be 16, 24, or 32.")
        transition_duration = _read_float(self.transition_duration, "Transition seconds", minimum=0.25, maximum=30.0)
        transition_style = self.transition_style.get()
        reference = self.reference_path.get().strip()
        self._sync_transitions()
        return {
            "version": 1,
            "album_title": self.album_title.get().strip() or "Untitled Album",
            "metadata": {
                "artist": self.artist.get().strip(),
                "album_artist": self.album_artist.get().strip(),
                "genre": self.genre.get().strip(),
                "release_year": self.release_year.get().strip(),
                "upc": self.upc.get().strip(),
            },
            "settings": {
                "sample_rate": sample_rate,
                "preset": _preset_key(self.preset.get()),
                "output_format": self.output_format.get(),
                "bit_depth": bit_depth,
                "delivery_profile": delivery_key(self.target_profile.get()),
                "target_profile": self.target_profile.get(),
                "codec_preview": bool(self.codec_preview.get()),
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
                    "artist": track.artist,
                    "isrc": track.isrc,
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
            tags = ("warning",) if track.warnings else ("even" if index % 2 == 0 else "odd",)
            self.track_tree.insert(
                "",
                tk.END,
                iid=str(index),
                tags=tags,
                values=(
                    track.title,
                    _seconds(duration),
                    _num(stats.get("integrated_lufs")),
                    _num(stats.get("true_peak_dbfs")),
                    _num(stats.get("loudness_range_lu_proxy", stats.get("dynamic_range_db"))),
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
            tags = ("disabled",) if not transition.enabled else ("even" if index % 2 == 0 else "odd",)
            duration = _safe_float(self.transition_duration, transition.duration_seconds) if transition.style == "inherit" else transition.duration_seconds
            style = f"inherit -> {self.transition_style.get()}" if transition.style == "inherit" else transition.style
            self.transition_tree.insert(
                "",
                tk.END,
                iid=str(index),
                tags=tags,
                values=(
                    f"{index + 1} -> {index + 2}",
                    style,
                    f"{duration:.2f}",
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
                        f"ST max {_num(stats.get('short_term_lufs_max'))}",
                        f"LRA {_num(stats.get('loudness_range_lu_proxy'))}",
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
        canvas.configure(bg=UI_COLORS["input"], highlightbackground=UI_COLORS["line_hot"])
        canvas.create_line(0, mid, width, mid, fill=UI_COLORS["wave_mid"])
        if not waveform:
            canvas.create_text(width / 2.0, mid, text="No waveform yet", fill=UI_COLORS["muted"])
            return
        step = width / max(len(waveform), 1)
        for index, value in enumerate(waveform):
            x = index * step
            amp = max(0.0, min(float(value), 1.0)) * (height * 0.44)
            canvas.create_line(x, mid - amp, x, mid + amp, fill=UI_COLORS["wave"])
        selected = self._selected_track_index()
        if (
            self.waveform_playhead_fraction is not None
            and self.playback_track_index is not None
            and selected == self.playback_track_index
        ):
            x = max(0.0, min(self.waveform_playhead_fraction, 1.0)) * width
            canvas.create_line(x, 0, x, height, fill=UI_COLORS["accent"], width=2)

    def _start_background(self, target, *args) -> None:
        if self.busy:
            messagebox.showinfo("Busy", "A background task is already running.")
            return
        self.busy = True
        self.cancel_requested = False
        self.status.set("Working...")
        self.cancel_button.configure(state=tk.NORMAL)
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
                elif kind == "preview_dir":
                    self.last_preview_dir = Path(item[1])
                elif kind == "manifest":
                    self.last_manifest = item[1]
                elif kind == "preview_path":
                    self.last_preview_path = Path(item[1])
                elif kind == "preview_master_path":
                    self.last_master_preview_path = Path(item[1])
                    self.last_master_preview_track_index = int(item[2])
                elif kind == "play_path":
                    self._play_audio_path(
                        Path(item[1]),
                        label=item[2] if len(item) > 2 else None,
                        track_index=int(item[3]) if len(item) > 3 and item[3] is not None else None,
                    )
                elif kind == "applied_state":
                    self._mark_applied(str(item[1]))
                elif kind == "error":
                    self._log(f"Error: {item[1]}")
                    self._settings_dirty = True
                    self.settings_state.set("ERROR: current settings were not applied. Fix the message below and try again.")
                    messagebox.showerror("Album Mastering Studio", item[1])
                elif kind == "done":
                    self.busy = False
                    self.status.set("Canceled" if self.cancel_requested else "Ready")
                    if self.cancel_requested:
                        self._settings_dirty = True
                        self.settings_state.set("CANCELED: current settings still need a fresh preview or render.")
                    self.progress.stop()
                    self.cancel_button.configure(state=tk.DISABLED)
                    pending_ab = self.pending_ab_after_preview_index
                    self.pending_ab_after_preview_index = None
                    if (
                        pending_ab is not None
                        and not self.cancel_requested
                        and self.last_master_preview_track_index == pending_ab
                        and self.last_master_preview_path
                        and self.last_master_preview_path.exists()
                        and 0 <= pending_ab < len(self.tracks)
                    ):
                        self.track_tree.selection_set(str(pending_ab))
                        self.track_tree.focus(str(pending_ab))
                        self.root.after(50, self._play_ab_clip)
        except queue.Empty:
            pass
        self.root.after(150, self._poll_queue)

    def _log(self, message: str) -> None:
        lower = message.lower()
        if lower.startswith("error") or "failed" in lower:
            tag = "error"
        elif "warning" in lower or "missing" in lower or "risk" in lower:
            tag = "warning"
        elif "ready" in lower or "complete" in lower or "passed" in lower or "wrote" in lower:
            tag = "ok"
        else:
            tag = "normal"
        self.log.insert(tk.END, f"{datetime.now().strftime('%H:%M:%S')}  ", ("time",))
        self.log.insert(tk.END, f"{message}\n", (tag,))
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


def _delivery_choice_from_settings(settings: dict) -> str:
    value = settings.get("delivery_profile", settings.get("target_profile", "streaming-universal"))
    try:
        return delivery_choice(delivery_key(str(value)))
    except ValueError:
        return delivery_choice("streaming-universal")


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


def _audio_duration(path: Path) -> float:
    try:
        info = probe(path)
        return float((info.get("format") or {}).get("duration") or 0.0)
    except Exception:
        return 0.0


def _time_label(value: float) -> str:
    seconds = max(float(value), 0.0)
    minutes, whole_seconds = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:d}:{minutes:02d}:{whole_seconds:02d}"
    return f"{minutes:02d}:{whole_seconds:02d}"


def _audible_preview_window(samples: np.ndarray, sample_rate: int, seconds: float) -> tuple[int, int]:
    frame_count = int(max(seconds, 1.0) * sample_rate)
    if samples.shape[0] <= frame_count:
        return 0, samples.shape[0]
    mono = np.mean(np.square(samples.astype(np.float64)), axis=1) if samples.ndim == 2 else np.square(samples.astype(np.float64))
    hop = max(sample_rate // 2, 1)
    best_start = 0
    best_energy = -1.0
    for start in range(0, samples.shape[0] - frame_count + 1, hop):
        energy = float(np.mean(mono[start : start + frame_count]))
        if energy > best_energy:
            best_energy = energy
            best_start = start
    return best_start, best_start + frame_count


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


if __name__ == "__main__":
    raise SystemExit(main())
