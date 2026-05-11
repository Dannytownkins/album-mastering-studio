import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  BarChart3,
  Disc3,
  FileDown,
  FolderOpen,
  Info,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Scissors,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CliResult, RenderManifest, Settings, Track, TransitionArtifact } from "./types";

const MAX_TRACKS = 8;

const PRESETS = [
  ["album-cohesion-cinematic", "Album cohesion / cinematic"],
  ["streaming", "Streaming / transparent"],
  ["acoustic-natural", "Acoustic / natural"],
  ["heavy-rock-metal", "Heavy rock / metal"],
  ["djent-modern-metal", "Djent / modern metal"],
  ["warm-glue", "Warm glue"],
  ["bright-air", "Bright / air"],
  ["dark-smooth", "Dark / smooth"],
  ["loud-aggressive", "Loud / aggressive"],
];

const ARCS = [
  ["cinematic", "Cinematic rise"],
  ["steady", "Steady cohesion"],
  ["front_loaded", "Front loaded"],
  ["late_peak", "Late peak"],
  ["intimate_return", "Heavy return to intimate"],
];

const DELIVERY = [
  ["streaming-universal", "Streaming universal"],
  ["aes-album-mode", "AES album mode"],
  ["apple-aac-check", "Apple / AAC check"],
  ["youtube-video", "YouTube / video"],
  ["amazon-alexa-safe", "Amazon / speaker safe"],
  ["cd-16", "CD 16/44.1"],
  ["vinyl-premaster", "Vinyl premaster"],
  ["loud-rock", "Loud rock reference"],
  ["custom", "Custom"],
];

const TRANSITIONS = [
  "auto",
  "ambient",
  "tape",
  "swell",
  "rhythmic",
  "minimal",
  "crossfade",
  "filtered-fade",
  "reverse-swell",
  "noise-riser",
  "sub-drop",
  "tape-stop",
  "breath-gap",
  "ring-out",
  "pulsed-swell",
  "drone-pad",
  "hard-cut",
];

const initialSettings: Settings = {
  albumTitle: "Untitled Album",
  artist: "",
  albumArtist: "",
  genre: "",
  year: "",
  upc: "",
  outputDir: "",
  referenceTrack: "",
  preset: "album-cohesion-cinematic",
  arc: "cinematic",
  arcIntensity: 1,
  deliveryProfile: "streaming-universal",
  targetLufs: "-14.0",
  ceilingDbfs: "-1.0",
  sampleRate: 48000,
  bitDepth: 24,
  outputFormat: "wav",
  codecPreview: true,
  transitionStyle: "auto",
  transitionDuration: 8,
  tweakLufs: 0,
  brightness: 0,
  bass: 0,
  presence: 0,
  air: 0,
  warmth: 0,
  compression: 0,
  limiter: 0,
  width: 0,
};

type PlayItem = {
  label: string;
  path: string;
  kind: "source" | "master" | "album" | "transition" | "reference";
};

type CliEvent = {
  stream: "stdout" | "stderr" | "status";
  line: string;
};

type ProgressEvent = {
  type: "progress";
  stage: string;
  message: string;
  current: number;
  total: number;
  fraction: number;
};

function App() {
  const [repoRoot, setRepoRoot] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [logs, setLogs] = useState<string[]>(["Ready. Drop audio files, analyze, preview, then render."]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("Idle");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("Waiting for a command.");
  const [manifest, setManifest] = useState<RenderManifest | null>(null);
  const [dashboardPath, setDashboardPath] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [playItem, setPlayItem] = useState<PlayItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const selectedTrack = tracks.find((track) => track.id === selectedTrackId) ?? tracks[0] ?? null;
  const transitions = useMemo(() => manifestTransitions(manifest), [manifest]);
  const selectedMaster = selectedTrack?.masteredPath;

  useEffect(() => {
    invoke<string>("repo_root").then((root) => {
      setRepoRoot(root);
      setSettings((current) => ({ ...current, outputDir: `${root}\\outputs\\tauri-render` }));
    });
    const unlistenCli = getCurrentWindow().listen<CliEvent>("cli-event", (event) => {
      const parsed = parseProgressEvent(event.payload.line);
      if (parsed) {
        setProgress(Math.max(0, Math.min(1, parsed.fraction ?? parsed.current / Math.max(parsed.total, 1))));
        setProgressLabel(parsed.message);
        setLogs((current) => [...current.slice(-400), `progress: ${parsed.message}`]);
      } else {
        setLogs((current) => [...current.slice(-400), `${event.payload.stream}: ${event.payload.line}`]);
      }
    });
    const unlistenDrop = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        addPaths(event.payload.paths);
      }
    });
    return () => {
      unlistenCli.then((dispose) => dispose());
      unlistenDrop.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        openProject();
      } else if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveProject();
      } else if (event.ctrlKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        render(true);
      } else if (event.key === " " && playItem) {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "Delete" && selectedTrackId) {
        event.preventDefault();
        removeTrack(selectedTrackId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playItem, selectedTrackId, tracks, settings]);

  function pushLog(message: string) {
    setLogs((current) => [...current.slice(-400), message]);
  }

  function addPaths(paths: string[]) {
    const audioPaths = paths.filter((path) => /\.(wav|flac|mp3|m4a|aac|aif|aiff|ogg|opus)$/i.test(path));
    if (!audioPaths.length) return;
    setTracks((current) => {
      const seen = new Set(current.map((track) => track.path.toLowerCase()));
      const next = [...current];
      for (const path of audioPaths) {
        if (next.length >= MAX_TRACKS) break;
        if (seen.has(path.toLowerCase())) continue;
        next.push({
          id: crypto.randomUUID(),
          path,
          title: fileStem(path),
          artist: settings.artist,
          isrc: "",
          character: "auto",
          preset: "auto",
        });
      }
      if (!selectedTrackId && next.length) setSelectedTrackId(next[0].id);
      return next;
    });
  }

  async function addFiles() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Audio", extensions: ["wav", "flac", "mp3", "m4a", "aac", "aif", "aiff", "ogg", "opus"] }],
    });
    if (Array.isArray(selected)) addPaths(selected);
    else if (typeof selected === "string") addPaths([selected]);
  }

  async function chooseReference() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: ["wav", "flac", "mp3", "m4a", "aac", "aif", "aiff", "ogg", "opus"] }],
    });
    if (typeof selected === "string") setSettings((current) => ({ ...current, referenceTrack: selected }));
  }

  async function analyze() {
    if (!tracks.length) return;
    setBusy(true);
    setPhase("Analyzing");
    setProgress(0);
    setProgressLabel("Analyzing source files.");
    try {
      const result = await runCli(["analyze", ...tracks.map((track) => track.path), "--sample-rate", String(settings.sampleRate), "--waveform-bins", "180"]);
      const rows = JSON.parse(result.stdout);
      setTracks((current) =>
        current.map((track) => {
          const row = rows.find((candidate: { source: string }) => samePath(candidate.source, track.path));
          return row ? { ...track, analysis: row.analysis, waveform: row.waveform } : track;
        }),
      );
      pushLog(`Analyzed ${rows.length} track(s).`);
      setProgress(1);
      setProgressLabel("Analysis complete.");
    } catch (error) {
      pushLog(`Analyze failed: ${String(error)}`);
    } finally {
      setBusy(false);
      setPhase("Idle");
    }
  }

  async function render(albumWav: boolean) {
    if (!tracks.length || !settings.outputDir) return;
    setBusy(true);
    setPhase(albumWav ? "Rendering full album" : "Rendering masters and transitions");
    setProgress(0);
    setProgressLabel("Preparing render.");
    setManifest(null);
    setDashboardPath("");
    try {
      const outputDir = `${settings.outputDir}\\run-${timestamp()}`;
      const project = buildProject(albumWav);
      const generatedProjectPath = `${outputDir}\\album.ams.json`;
      await invoke("write_project", { path: generatedProjectPath, project });
      await runCli(["render-project", generatedProjectPath, "--output", outputDir, "--json-events"]);
      const manifestPath = `${outputDir}\\manifest.json`;
      setProgressLabel("Scoring render.");
      await runCli(["score-render", manifestPath, "--scorer", "local"]);
      const dashboard = `${outputDir}\\dashboard.html`;
      setProgressLabel("Exporting dashboard.");
      await runCli(["export-dashboard", manifestPath, "--output", dashboard]);
      const loaded = await invoke<RenderManifest>("read_json", { path: manifestPath });
      loaded.dashboard = dashboard;
      setManifest(loaded);
      setDashboardPath(dashboard);
      setProjectPath(generatedProjectPath);
      setTracks((current) => attachMasterPaths(current, loaded));
      setProgress(1);
      setProgressLabel("Render complete.");
      pushLog(`Render complete: ${loaded.track_count} masters, ${loaded.interlude_count} transitions. ${outputDir}`);
    } catch (error) {
      pushLog(`Render failed: ${String(error)}`);
    } finally {
      setBusy(false);
      setPhase("Idle");
    }
  }

  async function cancel() {
    await invoke("cancel_cli");
    setBusy(false);
    setPhase("Canceled");
    setProgressLabel("Canceled.");
    pushLog("Cancel requested. Python subprocess was killed if it was still running.");
  }

  async function openProject() {
    const selected = await open({ multiple: false, filters: [{ name: "AMS project", extensions: ["ams.json", "json"] }] });
    if (typeof selected !== "string") return;
    const project = await invoke<any>("read_json", { path: selected });
    loadProject(project, selected);
  }

  async function saveProject() {
    const selected =
      projectPath ||
      (await save({
        defaultPath: `${repoRoot}\\album.ams.json`,
        filters: [{ name: "AMS project", extensions: ["ams.json", "json"] }],
      }));
    if (typeof selected !== "string") return;
    await invoke("write_project", { path: selected, project: buildProject(true) });
    setProjectPath(selected);
    pushLog(`Saved project: ${selected}`);
  }

  function loadProject(project: any, path: string) {
    const projectSettings = project.settings ?? {};
    const metadata = project.metadata ?? {};
    setSettings((current) => ({
      ...current,
      albumTitle: project.album_title ?? "Untitled Album",
      artist: metadata.artist ?? "",
      albumArtist: metadata.album_artist ?? "",
      genre: metadata.genre ?? "",
      year: metadata.release_year ?? "",
      upc: metadata.upc ?? "",
      sampleRate: projectSettings.sample_rate ?? current.sampleRate,
      bitDepth: projectSettings.bit_depth ?? current.bitDepth,
      deliveryProfile: projectSettings.delivery_profile ?? current.deliveryProfile,
      targetLufs: projectSettings.target_lufs == null ? "" : String(projectSettings.target_lufs),
      ceilingDbfs: projectSettings.ceiling_dbfs == null ? "" : String(projectSettings.ceiling_dbfs),
      preset: projectSettings.preset ?? current.preset,
      arc: projectSettings.arc ?? current.arc,
      arcIntensity: projectSettings.arc_intensity ?? current.arcIntensity,
      transitionStyle: projectSettings.default_interlude_style ?? current.transitionStyle,
      transitionDuration: projectSettings.default_interlude_duration ?? current.transitionDuration,
      outputFormat: projectSettings.output_format ?? current.outputFormat,
      codecPreview: projectSettings.codec_preview ?? current.codecPreview,
      referenceTrack: projectSettings.reference_track ?? "",
      tweakLufs: projectSettings.tweak_lufs ?? 0,
      brightness: projectSettings.tweak_brightness_db ?? 0,
      bass: projectSettings.tweak_low_end_db ?? 0,
      presence: projectSettings.tweak_presence_db ?? 0,
      air: projectSettings.tweak_air_db ?? 0,
      warmth: projectSettings.tweak_warmth ?? 0,
      compression: projectSettings.tweak_intensity ?? 0,
      limiter: projectSettings.tweak_limiter ?? 0,
      width: projectSettings.tweak_width ?? 0,
    }));
    const loadedTracks = (project.tracks ?? []).slice(0, MAX_TRACKS).map((track: any) => ({
      id: crypto.randomUUID(),
      path: track.path,
      title: track.title || fileStem(track.path),
      artist: track.artist ?? "",
      isrc: track.isrc ?? "",
      character: track.character ?? "auto",
      preset: track.preset ?? "auto",
    }));
    setTracks(loadedTracks);
    setSelectedTrackId(loadedTracks[0]?.id ?? null);
    setProjectPath(path);
    pushLog(`Opened project: ${path}`);
  }

  function buildProject(albumWav: boolean) {
    return {
      version: 1,
      album_title: settings.albumTitle || "Untitled Album",
      metadata: {
        artist: settings.artist,
        album_artist: settings.albumArtist,
        genre: settings.genre,
        release_year: settings.year,
        upc: settings.upc,
      },
      settings: {
        sample_rate: settings.sampleRate,
        preset: settings.preset,
        output_format: settings.outputFormat,
        bit_depth: settings.bitDepth,
        delivery_profile: settings.deliveryProfile,
        target_lufs: optionalNumber(settings.targetLufs),
        ceiling_dbfs: optionalNumber(settings.ceilingDbfs),
        codec_preview: settings.codecPreview,
        reference_track: settings.referenceTrack || null,
        default_interlude_duration: settings.transitionDuration,
        default_interlude_style: settings.transitionStyle,
        arc: settings.arc,
        arc_intensity: settings.arcIntensity,
        tweak_lufs: settings.tweakLufs,
        tweak_brightness_db: settings.brightness,
        tweak_low_end_db: settings.bass,
        tweak_presence_db: settings.presence,
        tweak_air_db: settings.air,
        tweak_warmth: settings.warmth,
        tweak_intensity: settings.compression,
        tweak_limiter: settings.limiter,
        tweak_width: settings.width,
        album_wav: albumWav,
      },
      tracks: tracks.map((track) => ({
        path: track.path,
        title: track.title,
        artist: track.artist,
        isrc: track.isrc,
        character: track.character,
        preset: track.preset,
      })),
      transitions: tracks.slice(0, -1).map((_, index) => ({
        after_track: index + 1,
        duration_seconds: settings.transitionDuration,
        style: "inherit",
        enabled: true,
      })),
    };
  }

  async function runCli(args: string[]) {
    return invoke<CliResult>("run_cli", { args });
  }

  function updateTrack(id: string, patch: Partial<Track>) {
    setTracks((current) => current.map((track) => (track.id === id ? { ...track, ...patch } : track)));
  }

  function removeTrack(id: string) {
    setTracks((current) => current.filter((track) => track.id !== id));
    if (selectedTrackId === id) setSelectedTrackId(null);
  }

  function moveDragged(overId: string) {
    if (!draggingId || draggingId === overId) return;
    setTracks((current) => {
      const from = current.findIndex((track) => track.id === draggingId);
      const to = current.findIndex((track) => track.id === overId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function setAudio(item: PlayItem) {
    setPlayItem(item);
    setTimeout(() => audioRef.current?.play(), 25);
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (audioRef.current.paused) audioRef.current.play();
    else audioRef.current.pause();
  }

  function seek(value: number) {
    if (!audioRef.current || !duration) return;
    audioRef.current.currentTime = value;
  }

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local offline mastering console</p>
          <h1>Album Mastering Studio</h1>
        </div>
        <div className="top-actions">
          <button onClick={openProject} title="Ctrl+O"><FolderOpen size={16} /> Open</button>
          <button onClick={saveProject} title="Ctrl+S"><Save size={16} /> Save</button>
          <button onClick={() => invoke("open_path", { path: settings.outputDir })}><FolderOpen size={16} /> Output</button>
          <button onClick={() => alert("Album Mastering Studio Tauri shell\\nPython CLI is the mastering engine.")}><Info size={16} /> About</button>
        </div>
      </header>

      <section className="session-strip">
        <label>
          Album
          <input value={settings.albumTitle} onChange={(event) => setSettings({ ...settings, albumTitle: event.target.value })} />
        </label>
        <label>
          Artist
          <input value={settings.artist} onChange={(event) => setSettings({ ...settings, artist: event.target.value })} />
        </label>
        <label className="wide">
          Output
          <input value={settings.outputDir} onChange={(event) => setSettings({ ...settings, outputDir: event.target.value })} />
        </label>
        <label className="wide">
          Reference
          <div className="inline-field">
            <input value={settings.referenceTrack} onChange={(event) => setSettings({ ...settings, referenceTrack: event.target.value })} />
            <button onClick={chooseReference}>Pick</button>
          </div>
        </label>
      </section>

      <section className="workspace">
        <aside className="library">
          <div className="panel-title">
            <span>{tracks.length} / {MAX_TRACKS} tracks</span>
            <button onClick={addFiles}><Plus size={16} /> Add</button>
          </div>
          <div className="drop-zone" onClick={addFiles}>
            Drop WAV, FLAC, MP3, M4A, AIFF, OGG, or Opus here
          </div>
          <div className="track-list">
            {tracks.map((track, index) => (
              <div
                key={track.id}
                className={`track-row ${selectedTrackId === track.id ? "selected" : ""}`}
                draggable
                onDragStart={() => setDraggingId(track.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => moveDragged(track.id)}
                onClick={() => setSelectedTrackId(track.id)}
              >
                <span className="track-number">{index + 1}</span>
                <div className="track-main">
                  <input value={track.title} onChange={(event) => updateTrack(track.id, { title: event.target.value })} />
                  <Waveform bins={track.waveform} active={selectedTrackId === track.id} />
                  <span className="path-line">{track.path}</span>
                </div>
                <button className="icon" onClick={() => removeTrack(track.id)} title="Delete"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </aside>

        <section className="center-stack">
          <div className="transport">
            <button className="play" onClick={togglePlay}>{isPlaying ? <Pause /> : <Play />}</button>
            <div className="transport-main">
              <div className="transport-label">{playItem ? `${playItem.kind.toUpperCase()} - ${playItem.label}` : "Nothing loaded in player"}</div>
              <input className="seek" type="range" min={0} max={duration || 0} step={0.01} value={position} onChange={(event) => seek(Number(event.target.value))} />
              <div className="time-row"><span>{formatTime(position)}</span><span>{formatTime(duration)}</span></div>
            </div>
            <button onClick={() => audioRef.current?.pause()}><Square size={17} /> Stop</button>
            <audio
              ref={audioRef}
              src={playItem ? convertFileSrc(playItem.path) : undefined}
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
              onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime || 0)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />
          </div>

          <div className="button-grid">
            <button disabled={!selectedTrack} onClick={() => selectedTrack && setAudio({ label: selectedTrack.title, path: selectedTrack.path, kind: "source" })}><Play size={16} /> Source</button>
            <button disabled={!selectedMaster} onClick={() => selectedTrack && selectedMaster && setAudio({ label: selectedTrack.title, path: selectedMaster, kind: "master" })}><Activity size={16} /> Master</button>
            <button disabled={!manifest?.album_sequence} onClick={() => manifest?.album_sequence && setAudio({ label: "album_sequence.wav", path: manifest.album_sequence, kind: "album" })}><Disc3 size={16} /> Album</button>
            <button disabled={!settings.referenceTrack} onClick={() => setAudio({ label: "Reference", path: settings.referenceTrack, kind: "reference" })}><BarChart3 size={16} /> Reference</button>
          </div>

          <div className="render-panel">
            <div>
              <p className="eyebrow">Render & verify</p>
              <h2>{phase}</h2>
            </div>
            <div className="render-actions">
              <button className="primary" disabled={busy || !tracks.length} onClick={() => render(true)} title="Ctrl+R. Writes masters, transitions, continuous album WAV, manifest, scorecard, and dashboard.">
                <Disc3 size={17} /> Render Full Album
              </button>
              <button disabled={busy || !tracks.length} onClick={() => render(false)} title="Writes individual masters and transition files without the continuous album WAV.">
                <Scissors size={17} /> Render Tracks Only
              </button>
              <button className="danger" disabled={!busy} onClick={cancel}>Cancel</button>
            </div>
            <div className={`progress ${busy ? "running" : ""}`} />
            <div className="progress-readout">
              <span>{progressLabel}</span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <div className="progress determinate"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          </div>

          <div className="artifact-grid">
            {transitions.map((transition) => (
              <button key={transition.output} onClick={() => setAudio({ label: `${transition.between[0]} -> ${transition.between[1]} ${transition.style}`, path: transition.output, kind: "transition" })}>
                Transition {transition.between[0]}{" -> "}{transition.between[1]} <span>{transition.style}</span>
              </button>
            ))}
          </div>

          <pre className="log">{logs.slice(-16).join("\n")}</pre>
        </section>

        <aside className="controls">
          <ControlSelect label="Preset" value={settings.preset} options={PRESETS} onChange={(preset) => setSettings({ ...settings, preset })} />
          <ControlSelect label="Album Arc" value={settings.arc} options={ARCS} onChange={(arc) => setSettings({ ...settings, arc })} />
          <ControlSelect label="Delivery" value={settings.deliveryProfile} options={DELIVERY} onChange={(deliveryProfile) => setSettings({ ...settings, deliveryProfile })} />
          <ControlSelect label="Transition" value={settings.transitionStyle} options={TRANSITIONS.map((item) => [item, item])} onChange={(transitionStyle) => setSettings({ ...settings, transitionStyle })} />
          <NumberField label="Target LUFS" value={settings.targetLufs} onChange={(targetLufs) => setSettings({ ...settings, targetLufs })} />
          <NumberField label="Ceiling dBFS" value={settings.ceilingDbfs} onChange={(ceilingDbfs) => setSettings({ ...settings, ceilingDbfs })} />
          <Slider label="Arc Intensity" unit="x" min={0} max={2} step={0.05} value={settings.arcIntensity} onChange={(arcIntensity) => setSettings({ ...settings, arcIntensity })} />
          <Slider label="Brightness" unit="dB" min={-3} max={3} step={0.05} value={settings.brightness} onChange={(brightness) => setSettings({ ...settings, brightness })} />
          <Slider label="Bass Weight" unit="dB" min={-3} max={3} step={0.05} value={settings.bass} onChange={(bass) => setSettings({ ...settings, bass })} />
          <Slider label="Presence" unit="dB" min={-3} max={3} step={0.05} value={settings.presence} onChange={(presence) => setSettings({ ...settings, presence })} />
          <Slider label="Air" unit="dB" min={-3} max={3} step={0.05} value={settings.air} onChange={(air) => setSettings({ ...settings, air })} />
          <Slider label="Warmth" unit="sat" min={-0.08} max={0.12} step={0.005} value={settings.warmth} onChange={(warmth) => setSettings({ ...settings, warmth })} />
          <Slider label="Compression" unit="mix" min={-1} max={1} step={0.05} value={settings.compression} onChange={(compression) => setSettings({ ...settings, compression })} />
          <Slider label="Limiter" unit="push" min={-1} max={1} step={0.05} value={settings.limiter} onChange={(limiter) => setSettings({ ...settings, limiter })} />
          <Slider label="Stereo Width" unit="width" min={-0.35} max={0.35} step={0.01} value={settings.width} onChange={(width) => setSettings({ ...settings, width })} />
          <button className="reset" onClick={() => setSettings({ ...settings, brightness: 0, bass: 0, presence: 0, air: 0, warmth: 0, compression: 0, limiter: 0, width: 0 })}>
            <RotateCcw size={15} /> Reset tuning
          </button>
          <button onClick={analyze} disabled={busy || !tracks.length}><BarChart3 size={16} /> Analyze tracks</button>
        </aside>
      </section>

      <section className="dashboard-pane">
        <div className="panel-title">
          <span>Dashboard</span>
          <button disabled={!dashboardPath} onClick={() => dashboardPath && invoke("open_path", { path: dashboardPath })}><FileDown size={16} /> Open HTML</button>
        </div>
        {dashboardPath ? <iframe src={convertFileSrc(dashboardPath)} /> : <div className="empty">Render an album to load the dashboard here.</div>}
      </section>
    </main>
  );
}

function ControlSelect({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) {
  return (
    <label className="control">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([key, name]) => <option value={key} key={key}>{name}</option>)}
      </select>
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="control">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Slider({ label, unit, min, max, step, value, onChange }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <output>{value > 0 ? "+" : ""}{value.toFixed(step < 0.01 ? 3 : 2)} {unit}</output>
    </label>
  );
}

function Waveform({ bins, active }: { bins?: number[]; active: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#061417";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = active ? "#74f6a7" : "#3d6868";
    ctx.lineWidth = 1;
    const mid = rect.height / 2;
    (bins ?? []).forEach((bin, index) => {
      const x = (index / Math.max((bins?.length ?? 1) - 1, 1)) * rect.width;
      const amp = Math.max(1, bin * rect.height * 0.42);
      ctx.beginPath();
      ctx.moveTo(x, mid - amp);
      ctx.lineTo(x, mid + amp);
      ctx.stroke();
    });
  }, [bins, active]);
  return <canvas className="wave-mini" ref={ref} />;
}

function attachMasterPaths(tracks: Track[], manifest: RenderManifest) {
  const renderedTracks = (manifest.sequence ?? []).filter((item) => item.type === "track");
  return tracks.map((track, index) => ({ ...track, masteredPath: renderedTracks[index]?.output as string | undefined }));
}

function manifestTransitions(manifest: RenderManifest | null): TransitionArtifact[] {
  return ((manifest?.sequence ?? []).filter((item) => item.type === "interlude") as unknown as TransitionArtifact[]) ?? [];
}

function optionalNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseProgressEvent(line: string): ProgressEvent | null {
  if (!line.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(line);
    if (parsed?.type !== "progress") return null;
    return parsed as ProgressEvent;
  } catch {
    return null;
  }
}

function fileStem(path: string) {
  return path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "Untitled";
}

function samePath(a: string, b: string) {
  return a.toLowerCase().replace(/\//g, "\\") === b.toLowerCase().replace(/\//g, "\\");
}

function timestamp() {
  const now = new Date();
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00";
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default App;
