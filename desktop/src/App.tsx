import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  AlertTriangle,
  AudioWaveform,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Disc3,
  FileDown,
  FolderOpen,
  Gauge,
  GitCompare,
  Info,
  ListMusic,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  SlidersHorizontal,
  Square,
  Trash2,
  Undo2,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import livePreviewConfig from "./livePreviewConfig.json";
import type { Analysis, ProductRenderResult, RenderManifest, Settings, SourceValidation, Track, TransitionArtifact } from "./types";

const MAX_TRACKS = 8;
const MAX_HISTORY = 80;

type StudioMode = "track" | "album";
type AuditionSide = "source" | "master";
type RegionSelection = { start: number; end: number };

type PlayItem = {
  label: string;
  path: string;
  originalPath: string;
  kind: "source" | "master" | "album" | "transition" | "reference";
  trackId?: string;
};

type ComparePair = {
  label: string;
  trackId: string;
  source: PlayItem;
  master: PlayItem;
};

type PreviewArtifact = {
  trackId: string;
  revision: number;
  path: string;
  outputDir: string;
  auditionStartSeconds?: number;
  analysis?: Analysis;
  warnings?: string[];
};

type RegionPreviewArtifact = PreviewArtifact & {
  startSeconds: number;
  durationSeconds: number;
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

type LiveAuditionChain = {
  context: AudioContext;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  sideLeft: GainNode;
  sideRight: GainNode;
  output: GainNode;
};

type LiveAuditionSnapshot = {
  active: boolean;
  bass: number;
  mid: number;
  high: number;
  width: number;
  drive: number;
  contextState: AudioContextState;
  currentTime: number;
  baseLatencyMs: number | null;
  updatedAt: number;
};

type LivePreviewContract = {
  modelId: string;
  previewParity: string;
  exportFaithfulPreviewRequired: boolean;
  modeledControls: string[];
  filters: {
    low: { type: string; exportControl?: string; frequencyHz: number; q?: number };
    mid: { type: string; exportControl?: string; frequencyHz: number; q?: number };
    high: { type: string; exportControl?: string; frequencyHz: number; q?: number };
  };
  width: typeof livePreviewConfig.width & { exportControl?: string };
  compressor: typeof livePreviewConfig.compressor & { exportControl?: string };
  smoothingSeconds: number;
  unmodeledExportStages: string[];
};

type PresetTile = {
  id: string;
  label: string;
  enginePreset: string;
  tone: string;
  target: string;
};

type ManifestTrackItem = {
  type?: string;
  index?: number;
  title?: string;
  source?: string;
  output?: string;
  character?: {
    label?: string;
    display_name?: string;
    confidence?: number;
    reason?: string;
  };
  arc?: {
    role?: string;
    rationale?: string;
    target_lufs?: number;
  };
  mastering_moves?: {
    rationale?: string;
  };
  before?: Analysis;
  after?: Analysis;
  warnings?: string[];
  selected_preset?: string;
  rationale?: string;
};

type AlbumRolePreview = {
  track: Track;
  index: number;
  role: string;
  character: string;
  confidence: string;
  source: "render" | "analysis" | "manual" | "pending";
  rationale: string;
};

type ExportCheckItem = {
  label: string;
  status: "pass" | "warn" | "fail" | "skip";
  detail: string;
};

type ExportCheckResult = {
  status: "pass" | "warn" | "fail";
  summary: string;
  track_count: number;
  interlude_count: number;
  warning_count: number;
  checks: ExportCheckItem[];
  warnings: string[];
};

type AnalysisRow = {
  source: string;
  analysis: Analysis;
  waveform: number[];
};

type SessionSnapshot = {
  version: 2;
  mode: StudioMode;
  settings: Settings;
  tracks: Track[];
  selectedTrackId: string | null;
  projectPath: string;
  region: RegionSelection | null;
  waveformZoom: number;
  advancedOpen: boolean;
  volumeMatch: boolean;
  liveAudition: boolean;
  loopSelection: boolean;
  listeningChecklist?: ListeningChecklist;
  listeningApproved?: boolean;
};

type AutosavedSession = SessionSnapshot & {
  savedAt: string;
};

type ListeningChecklist = {
  trackOriginal: boolean;
  trackMaster: boolean;
  trackNativeAb: boolean;
  albumSequence: boolean;
  albumTransitions: boolean;
  dashboardReviewed: boolean;
  notes: string;
};

type UserPreset = {
  id: string;
  name: string;
  mode?: StudioMode;
  settings: Partial<Settings>;
  created_at?: string;
  updated_at?: string;
};

type NativePlaybackStatus = {
  active: boolean;
  paused: boolean;
  id: string | null;
  label: string | null;
  output_device: string | null;
  output_config: {
    channels: number;
    sample_rate: number;
    sample_format: string;
    buffer_size: string;
  } | null;
  elapsed_ms: number;
  position_seconds: number;
  duration_seconds: number;
  queued_output_frames: number;
  played_output_frames: number;
  callback_count: number;
  stream_errors: string[];
  warnings: string[];
};

const idleNativePlaybackStatus: NativePlaybackStatus = {
  active: false,
  paused: false,
  id: null,
  label: null,
  output_device: null,
  output_config: null,
  elapsed_ms: 0,
  position_seconds: 0,
  duration_seconds: 0,
  queued_output_frames: 0,
  played_output_frames: 0,
  callback_count: 0,
  stream_errors: [],
  warnings: [],
};

const emptyListeningChecklist: ListeningChecklist = {
  trackOriginal: false,
  trackMaster: false,
  trackNativeAb: false,
  albumSequence: false,
  albumTransitions: false,
  dashboardReviewed: false,
  notes: "",
};

const TRACK_PRESETS: PresetTile[] = [
  {
    id: "universal",
    label: "Universal",
    enginePreset: "streaming",
    tone: "Balanced",
    target: "Clean translation",
  },
  {
    id: "clarity",
    label: "Clarity",
    enginePreset: "bright-air",
    tone: "Open",
    target: "Detail and vocals",
  },
  {
    id: "tape",
    label: "Tape",
    enginePreset: "3am-kitchen-floor",
    tone: "Worn",
    target: "Glue and body",
  },
  {
    id: "spatial",
    label: "Spatial",
    enginePreset: "album-cohesion-cinematic",
    tone: "Wide",
    target: "Depth and image",
  },
  {
    id: "oomph",
    label: "Oomph",
    enginePreset: "heavy-rock-metal",
    tone: "Weight",
    target: "Low-end push",
  },
  {
    id: "warmth",
    label: "Warmth",
    enginePreset: "warm-glue",
    tone: "Smooth",
    target: "Fuller mids",
  },
  {
    id: "punch",
    label: "Punch",
    enginePreset: "loud",
    tone: "Forward",
    target: "Transient impact",
  },
  {
    id: "energy",
    label: "Energy",
    enginePreset: "loud-aggressive",
    tone: "Dense",
    target: "Loudness and bite",
  },
];

const SPECIALTY_PRESETS = [
  ["acoustic-natural", "Acoustic Natural"],
  ["djent-modern-metal", "Djent / Modern Metal"],
  ["dark-smooth", "Dark / Smooth"],
  ["gentle", "Soft Master"],
  ["radio-brittle", "Radio Brittle"],
  ["velvet-museum", "Velvet Museum"],
];

const ARCS = [
  ["cinematic", "Cinematic rise"],
  ["afterhours", "Afterhours descent"],
  ["club-peak", "Club peak"],
  ["fever-dream", "Fever dream"],
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

const CHARACTER_OPTIONS = [
  ["auto", "Auto"],
  ["acoustic_folk", "Acoustic"],
  ["transition", "Transition"],
  ["heavy_djent", "Heavy"],
  ["return_acoustic", "Return"],
];

const BOUNDARY_OPTIONS = [
  ["direct", "Direct"],
  ["gap", "Gap"],
  ["fade", "Fade"],
  ["ring-out", "Ring-out"],
  ["crossfade", "Crossfade"],
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
  preset: "streaming",
  arc: "cinematic",
  arcIntensity: 1,
  deliveryProfile: "streaming-universal",
  targetLufs: "-14.0",
  ceilingDbfs: "-1.0",
  sampleRate: 48000,
  bitDepth: 24,
  outputFormat: "wav",
  codecPreview: true,
  transitionsEnabled: false,
  boundaryStyle: "direct",
  boundaryDuration: 2,
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

const USER_PRESET_SETTING_KEYS: Array<keyof Settings> = [
  "preset",
  "arc",
  "arcIntensity",
  "deliveryProfile",
  "targetLufs",
  "ceilingDbfs",
  "sampleRate",
  "bitDepth",
  "outputFormat",
  "codecPreview",
  "transitionsEnabled",
  "boundaryStyle",
  "boundaryDuration",
  "transitionStyle",
  "transitionDuration",
  "tweakLufs",
  "brightness",
  "bass",
  "presence",
  "air",
  "warmth",
  "compression",
  "limiter",
  "width",
];

function App() {
  const [repoRoot, setRepoRoot] = useState("");
  const [mode, setMode] = useState<StudioMode>("track");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [logs, setLogs] = useState<string[]>(["Ready."]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("Idle");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("Waiting.");
  const [manifest, setManifest] = useState<RenderManifest | null>(null);
  const [exportChecks, setExportChecks] = useState<ExportCheckResult | null>(null);
  const [dashboardPath, setDashboardPath] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [sessionRevision, setSessionRevision] = useState(0);
  const [renderRevision, setRenderRevision] = useState<number | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<PreviewArtifact | null>(null);
  const [regionPreviewArtifact, setRegionPreviewArtifact] = useState<RegionPreviewArtifact | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [playItem, setPlayItem] = useState<PlayItem | null>(null);
  const [comparePair, setComparePair] = useState<ComparePair | null>(null);
  const [compareSide, setCompareSide] = useState<AuditionSide>("source");
  const [volumeMatch, setVolumeMatch] = useState(false);
  const [liveAudition, setLiveAudition] = useState(false);
  const [liveAuditionLatencyMs, setLiveAuditionLatencyMs] = useState<number | null>(null);
  const [livePreviewContract, setLivePreviewContract] = useState<LivePreviewContract | null>(null);
  const [livePreviewContractDrift, setLivePreviewContractDrift] = useState<string[]>([]);
  const [nativePlaybackStatus, setNativePlaybackStatus] = useState<NativePlaybackStatus>(idleNativePlaybackStatus);
  const [loopSelection, setLoopSelection] = useState(false);
  const [region, setRegion] = useState<RegionSelection | null>(null);
  const [waveformZoom, setWaveformZoom] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [listeningChecklist, setListeningChecklist] = useState<ListeningChecklist>(emptyListeningChecklist);
  const [listeningApproved, setListeningApproved] = useState(false);
  const [userPresets, setUserPresets] = useState<UserPreset[]>([]);
  const [selectedUserPresetId, setSelectedUserPresetId] = useState("");
  const [userPresetName, setUserPresetName] = useState("Custom chain");
  const [autosaveReady, setAutosaveReady] = useState(false);
  const [undoStack, setUndoStack] = useState<SessionSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<SessionSnapshot[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const liveAuditionRef = useRef<LiveAuditionChain | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const lastAutosaveKeyRef = useRef("");

  const selectedTrack = tracks.find((track) => track.id === selectedTrackId) ?? tracks[0] ?? null;
  const selectedIndex = selectedTrack ? tracks.findIndex((track) => track.id === selectedTrack.id) : -1;
  const sourceIssues = useMemo(
    () => tracks.filter((track) => track.sourceStatus && track.sourceStatus.status !== "ok"),
    [tracks],
  );
  const allAnalyzed = tracks.length > 0 && tracks.every((track) => track.analysis && (!track.sourceStatus || track.sourceStatus.status === "ok"));
  const hasCurrentRender = renderRevision !== null && renderRevision === sessionRevision;
  const hasStaleRender = renderRevision !== null && renderRevision !== sessionRevision;
  const transitions = useMemo(() => (hasStaleRender ? [] : manifestTransitions(manifest)), [manifest, hasStaleRender]);
  const selectedPreviewArtifact =
    selectedTrack && previewArtifact?.trackId === selectedTrack.id && previewArtifact.revision === sessionRevision
      ? previewArtifact
      : null;
  const selectedPreviewMaster = selectedPreviewArtifact?.path;
  const selectedRegionPreview =
    selectedTrack && regionPreviewArtifact?.trackId === selectedTrack.id && regionPreviewArtifact.revision === sessionRevision
      ? regionPreviewArtifact
      : null;
  const regionPreviewPlaying = Boolean(
    selectedRegionPreview && playItem?.originalPath && samePath(playItem.originalPath, selectedRegionPreview.path),
  );
  const selectedMaster = selectedPreviewMaster ?? (hasCurrentRender ? selectedTrack?.masteredPath : undefined);
  const selectedMasterAnalysis =
    selectedTrack && previewArtifact?.trackId === selectedTrack.id && previewArtifact.revision === sessionRevision
      ? previewArtifact.analysis
      : selectedTrack?.masteredAnalysis;
  const selectedWarnings =
    selectedTrack && previewArtifact?.trackId === selectedTrack.id && previewArtifact.revision === sessionRevision
      ? previewArtifact.warnings ?? selectedTrack.qualityWarnings ?? []
      : selectedTrack?.qualityWarnings ?? [];
  const albumTrackItems = useMemo(() => (hasStaleRender ? [] : manifestTrackItems(manifest)), [manifest, hasStaleRender]);
  const albumRolePreviews = useMemo(
    () => buildAlbumRolePreviews(tracks, albumTrackItems),
    [tracks, albumTrackItems],
  );
  const albumStoryText = useMemo(
    () => buildAlbumStoryText(manifest, tracks, allAnalyzed, hasStaleRender),
    [manifest, tracks, allAnalyzed, hasStaleRender],
  );
  const activePreset = TRACK_PRESETS.find((preset) => preset.enginePreset === settings.preset);
  const selectedUserPreset = userPresets.find((preset) => preset.id === selectedUserPresetId) ?? null;
  const selectedTimelineDuration = selectedTrack?.analysis?.duration_seconds ?? duration;
  const selectedRegionSeconds =
    region && selectedTimelineDuration > 0 ? Math.max(0, region.end - region.start) * selectedTimelineDuration : 0;
  const liveAuditionActive = liveAudition && playItem?.kind === "source";
  const nativePlaybackLabel = nativePlaybackStatus.label ?? "";
  const nativeAbPlaybackActive = nativePlaybackStatus.active && nativePlaybackLabel.startsWith("Native A/B");
  const nativeFilePlaybackActive = nativePlaybackStatus.active && nativePlaybackLabel.startsWith("Native file:");
  const nativePlaybackKind = nativeAbPlaybackActive ? "Native A/B" : "Native playback";
  const listeningCompletedCount = Object.entries(listeningChecklist).filter(
    ([key, value]) => key !== "notes" && value === true,
  ).length;
  const listeningTotalCount = Object.keys(emptyListeningChecklist).length - 1;
  const listeningApprovalStatus = listeningApproved
    ? hasStaleRender ? "Approval stale" : "Approved"
    : "Not approved";
  const previewParityLabel = regionPreviewPlaying
    ? "Render-faithful region"
    : selectedMaster
    ? liveAuditionActive ? "Approx audition" : "Render-faithful preview"
    : "Render required";
  const previewParityTitle = regionPreviewPlaying
    ? "Render Region used the same Python export engine on a bounded source window."
    : selectedMaster
    ? liveAuditionActive
      ? "Live Preview is a Web Audio approximation. Update Preview renders through the export engine."
      : selectedPreviewArtifact?.auditionStartSeconds != null
        ? `Rendered preview used the Python export engine and was cued at ${formatTime(selectedPreviewArtifact.auditionStartSeconds)}.`
        : "Update Preview renders the current settings through the export engine."
    : "Update Preview renders the current settings through the export engine.";
  const livePreviewContractModeledText = livePreviewContract?.modeledControls?.join(", ") ?? "Contract loading";
  const livePreviewContractRenderOnlyText = summarizePreviewStages(livePreviewContract?.unmodeledExportStages ?? []);
  const livePreviewContractTitle = livePreviewContract
    ? `Engine contract ${livePreviewContract.modelId}. ${livePreviewContractDrift.length ? `Drift: ${livePreviewContractDrift.join(", ")}.` : "Bundled live model matches."} Render-only stages: ${formatPreviewStages(livePreviewContract.unmodeledExportStages)}.`
    : "Loading the live preview contract from the Python engine.";
  const playbackVolume = useMemo(
    () => computePlaybackVolume(playItem, selectedTrack, selectedMasterAnalysis, volumeMatch),
    [playItem, selectedTrack, selectedMasterAnalysis, volumeMatch],
  );

  useEffect(() => {
    Promise.allSettled([
      invoke<string>("repo_root"),
      invoke<string>("default_output_dir"),
      invoke<AutosavedSession | null>("load_recent_session"),
      invoke<UserPreset[]>("list_user_presets"),
      invoke<LivePreviewContract>("live_preview_contract"),
    ]).then(([rootResult, outputResult, autosaveResult, presetsResult, contractResult]) => {
      const defaultOutput =
        outputResult.status === "fulfilled" ? outputResult.value : initialSettings.outputDir;
      if (rootResult.status === "fulfilled") {
        setRepoRoot(rootResult.value);
      }
      if (autosaveResult.status === "fulfilled" && autosaveResult.value) {
        restoreAutosavedSession(autosaveResult.value, defaultOutput);
        pushLog("Restored recent session.");
      } else {
        setSettings((current) => ({ ...current, outputDir: defaultOutput }));
      }
      if (presetsResult.status === "fulfilled") {
        setUserPresets(presetsResult.value);
        setSelectedUserPresetId(presetsResult.value[0]?.id ?? "");
      } else {
        pushLog(`User presets unavailable: ${String(presetsResult.reason)}`);
      }
      if (contractResult.status === "fulfilled") {
        const drift = livePreviewContractDriftMessages(contractResult.value);
        setLivePreviewContract(contractResult.value);
        setLivePreviewContractDrift(drift);
        const debugWindow = window as typeof window & {
          __AMS_LIVE_PREVIEW_CONTRACT__?: LivePreviewContract;
          __AMS_LIVE_PREVIEW_CONTRACT_DRIFT__?: string[];
        };
        debugWindow.__AMS_LIVE_PREVIEW_CONTRACT__ = contractResult.value;
        debugWindow.__AMS_LIVE_PREVIEW_CONTRACT_DRIFT__ = drift;
        if (drift.length) {
          pushLog(`Live Preview contract drift: ${drift.join(", ")}`);
        }
      } else {
        setLivePreviewContractDrift(["contract unavailable"]);
        pushLog(`Live Preview contract unavailable: ${String(contractResult.reason)}`);
      }
      setAutosaveReady(true);
    }).catch(() => setAutosaveReady(true));

    let appWindow: ReturnType<typeof getCurrentWindow>;
    try {
      appWindow = getCurrentWindow();
    } catch (error) {
      pushLog(`Tauri window hooks unavailable in browser preview: ${String(error)}`);
      return;
    }
    const unlistenCli = appWindow.listen<CliEvent>("cli-event", (event) => {
      const parsed = parseProgressEvent(event.payload.line);
      if (parsed) {
        setProgress(Math.max(0, Math.min(1, parsed.fraction ?? parsed.current / Math.max(parsed.total, 1))));
        setProgressLabel(parsed.message);
      } else {
        setLogs((current) => [...current.slice(-400), `${event.payload.stream}: ${event.payload.line}`]);
      }
    });
    const unlistenDrop = appWindow.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        addPaths(event.payload.paths);
      }
    });
    return () => {
      unlistenCli.then((dispose) => dispose()).catch(() => undefined);
      unlistenDrop.then((dispose) => dispose()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey && event.shiftKey && key === "z") || (event.ctrlKey && key === "y")) {
        event.preventDefault();
        redoSession();
      } else if (event.ctrlKey && key === "z") {
        event.preventDefault();
        undoSession();
      } else if (event.ctrlKey && key === "o") {
        event.preventDefault();
        openProject();
      } else if (event.ctrlKey && key === "s") {
        event.preventDefault();
        saveProject();
      } else if (event.ctrlKey && key === "r") {
        event.preventDefault();
        mode === "track" ? exportTrackMasters() : renderAlbum(true);
      } else if (key === "b" && comparePair) {
        event.preventDefault();
        toggleCompareSide();
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
  }, [playItem, selectedTrackId, tracks, settings, comparePair, compareSide, mode, undoStack, redoStack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playItem) return;
    audio.load();
    const playWhenReady = () => {
      if (pendingSeekRef.current != null) {
        audio.currentTime = Math.max(0, Math.min(pendingSeekRef.current, Math.max((audio.duration || 0) - 0.1, 0)));
        pendingSeekRef.current = null;
      }
      if (liveAudition) {
        prepareLiveAuditionChain();
        liveAuditionRef.current?.context.resume().catch(() => undefined);
      }
      audio.play().catch((error) => {
        pushLog(`Playback failed: ${String(error)}`);
        setProgressLabel("Playback failed.");
      });
    };
    audio.addEventListener("loadedmetadata", playWhenReady, { once: true });
    return () => audio.removeEventListener("loadedmetadata", playWhenReady);
  }, [playItem?.path]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = playbackVolume;
    }
  }, [playbackVolume]);

  useEffect(() => {
    if (!liveAudition && !liveAuditionRef.current) return;
    const chain = liveAudition ? prepareLiveAuditionChain() : liveAuditionRef.current;
    if (!chain) return;
    applyLiveAuditionChain(chain, {
      active: liveAuditionActive,
      bass: settings.bass,
      compression: settings.compression,
      high: settings.air,
      mid: settings.presence,
      outputGain: playbackVolume,
      width: settings.width,
    });
  }, [liveAudition, liveAuditionActive, settings.air, settings.bass, settings.compression, settings.presence, settings.width, playbackVolume]);

  useEffect(() => {
    return () => {
      liveAuditionRef.current?.context.close().catch(() => undefined);
      invoke("stop_native_playback").catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!nativePlaybackStatus.active) return;
    const handle = window.setInterval(() => {
      invoke<NativePlaybackStatus>("native_playback_status")
        .then((status) => {
          setNativePlaybackStatus(status);
          if (!status.active) {
            const completedKind = status.label?.startsWith("Native A/B") ? "Native A/B audition" : "Native playback";
            setProgressLabel(`${completedKind} complete.`);
          }
        })
        .catch((error) => {
          setNativePlaybackStatus(idleNativePlaybackStatus);
          pushLog(`Native playback status failed: ${String(error)}`);
        });
    }, 350);
    return () => window.clearInterval(handle);
  }, [nativePlaybackStatus.active]);

  useEffect(() => {
    if (!autosaveReady) return;
    const session = buildSessionSnapshot();
    const key = serializeSnapshot(session);
    if (key === lastAutosaveKeyRef.current) return;
    const handle = window.setTimeout(() => {
      lastAutosaveKeyRef.current = key;
      invoke<string>("autosave_session", {
        session: {
          ...session,
          savedAt: new Date().toISOString(),
        } satisfies AutosavedSession,
      }).catch((error) => {
        pushLog(`Autosave failed: ${String(error)}`);
      });
    }, 700);
    return () => window.clearTimeout(handle);
  }, [autosaveReady, mode, tracks, selectedTrackId, settings, projectPath, region, waveformZoom, advancedOpen, volumeMatch, liveAudition, loopSelection, listeningChecklist, listeningApproved]);

  function pushLog(message: string) {
    setLogs((current) => [...current.slice(-400), message]);
  }

  function prepareLiveAuditionChain(): LiveAuditionChain | null {
    if (liveAuditionRef.current) return liveAuditionRef.current;
    const audio = audioRef.current;
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!audio || !AudioContextCtor) {
      setLiveAudition(false);
      setProgressLabel("Live preview unavailable.");
      pushLog("Live preview unavailable: Web Audio is not available in this WebView.");
      return null;
    }
    const context = new AudioContextCtor() as AudioContext;
    const source = context.createMediaElementSource(audio);
    const low = context.createBiquadFilter();
    low.type = livePreviewConfig.filters.low.type as BiquadFilterType;
    low.frequency.value = livePreviewConfig.filters.low.frequencyHz;
    const mid = context.createBiquadFilter();
    mid.type = livePreviewConfig.filters.mid.type as BiquadFilterType;
    mid.frequency.value = livePreviewConfig.filters.mid.frequencyHz;
    mid.Q.value = livePreviewConfig.filters.mid.q;
    const high = context.createBiquadFilter();
    high.type = livePreviewConfig.filters.high.type as BiquadFilterType;
    high.frequency.value = livePreviewConfig.filters.high.frequencyHz;
    const compressor = context.createDynamicsCompressor();
    compressor.attack.value = livePreviewConfig.compressor.attackSeconds;
    compressor.release.value = livePreviewConfig.compressor.releaseSeconds;
    const splitter = context.createChannelSplitter(2);
    const midLeft = context.createGain();
    const midRight = context.createGain();
    const sideLeftIn = context.createGain();
    const sideRightIn = context.createGain();
    const midSum = context.createGain();
    const sideSum = context.createGain();
    const sideLeft = context.createGain();
    const sideRight = context.createGain();
    const leftOut = context.createGain();
    const rightOut = context.createGain();
    const merger = context.createChannelMerger(2);
    const output = context.createGain();

    midLeft.gain.value = 0.5;
    midRight.gain.value = 0.5;
    sideLeftIn.gain.value = 0.5;
    sideRightIn.gain.value = -0.5;
    sideLeft.gain.value = 1;
    sideRight.gain.value = -1;

    source.connect(low).connect(mid).connect(high).connect(compressor).connect(splitter);
    splitter.connect(midLeft, 0);
    splitter.connect(midRight, 1);
    splitter.connect(sideLeftIn, 0);
    splitter.connect(sideRightIn, 1);
    midLeft.connect(midSum);
    midRight.connect(midSum);
    sideLeftIn.connect(sideSum);
    sideRightIn.connect(sideSum);
    midSum.connect(leftOut);
    midSum.connect(rightOut);
    sideSum.connect(sideLeft).connect(leftOut);
    sideSum.connect(sideRight).connect(rightOut);
    leftOut.connect(merger, 0, 0);
    rightOut.connect(merger, 0, 1);
    merger.connect(output).connect(context.destination);

    const chain = { context, low, mid, high, compressor, sideLeft, sideRight, output };
    liveAuditionRef.current = chain;
    const latency = ((context.baseLatency || 0) + ((context as any).outputLatency || 0)) * 1000;
    setLiveAuditionLatencyMs(Number.isFinite(latency) && latency > 0 ? latency : null);
    applyLiveAuditionChain(chain, {
      active: liveAuditionActive,
      bass: settings.bass,
      compression: settings.compression,
      high: settings.air,
      mid: settings.presence,
      outputGain: playbackVolume,
      width: settings.width,
    });
    return chain;
  }

  function buildSessionSnapshot(): SessionSnapshot {
    return {
      version: 2,
      mode,
      settings,
      tracks: tracks.map(snapshotTrack),
      selectedTrackId,
      projectPath,
      region,
      waveformZoom,
      advancedOpen,
      volumeMatch,
      liveAudition,
      loopSelection,
      listeningChecklist,
      listeningApproved,
    };
  }

  function rememberUndo() {
    const snapshot = buildSessionSnapshot();
    const snapshotKey = serializeSnapshot(snapshot);
    setUndoStack((current) => {
      const previous = current[current.length - 1];
      if (previous && serializeSnapshot(previous) === snapshotKey) return current;
      return [...current, snapshot].slice(-MAX_HISTORY);
    });
    setRedoStack([]);
  }

  function applySessionSnapshot(snapshot: SessionSnapshot, action: "undo" | "redo" | "restore") {
    const safeTracks = (snapshot.tracks ?? []).slice(0, MAX_TRACKS).map(snapshotTrack);
    const selectedId = safeTracks.some((track) => track.id === snapshot.selectedTrackId)
      ? snapshot.selectedTrackId
      : safeTracks[0]?.id ?? null;
    setMode(snapshot.mode === "album" ? "album" : "track");
    setSettings({ ...initialSettings, ...(snapshot.settings ?? {}) });
    setTracks(safeTracks);
    setSelectedTrackId(selectedId);
    setProjectPath(snapshot.projectPath ?? "");
    setRegion(snapshot.region ?? null);
    setWaveformZoom(clamp(Number(snapshot.waveformZoom) || 1, 1, 8));
    setAdvancedOpen(Boolean(snapshot.advancedOpen));
    setVolumeMatch(Boolean(snapshot.volumeMatch));
    setLiveAudition(Boolean(snapshot.liveAudition));
    setLoopSelection(Boolean(snapshot.loopSelection && snapshot.region));
    setListeningChecklist(normalizeListeningChecklist(snapshot.listeningChecklist));
    setListeningApproved(Boolean(snapshot.listeningApproved));
    setManifest(null);
    setExportChecks(null);
    setDashboardPath("");
    setRenderRevision(null);
    setPreviewArtifact(null);
    setComparePair(null);
    setPlayItem(null);
    setSessionRevision((current) => current + 1);
    if (action !== "restore") {
      pushLog(action === "undo" ? "Undo." : "Redo.");
    }
  }

  function restoreAutosavedSession(session: AutosavedSession, defaultOutputDir: string) {
    applySessionSnapshot(
      {
        ...session,
        settings: {
          ...initialSettings,
          ...(session.settings ?? {}),
          outputDir: session.settings?.outputDir || defaultOutputDir,
        },
      },
      "restore",
    );
    setUndoStack([]);
    setRedoStack([]);
    lastAutosaveKeyRef.current = serializeSnapshot(session);
  }

  function undoSession() {
    if (busy || !undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    const current = buildSessionSnapshot();
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [current, ...stack].slice(0, MAX_HISTORY));
    applySessionSnapshot(previous, "undo");
  }

  function redoSession() {
    if (busy || !redoStack.length) return;
    const next = redoStack[0];
    const current = buildSessionSnapshot();
    setRedoStack((stack) => stack.slice(1));
    setUndoStack((stack) => [...stack, current].slice(-MAX_HISTORY));
    applySessionSnapshot(next, "redo");
  }

  function markDirty() {
    rememberUndo();
    setSessionRevision((current) => current + 1);
    setPreviewArtifact(null);
    setRegionPreviewArtifact(null);
    setExportChecks(null);
    setListeningApproved(false);
    setComparePair(null);
    setPlayItem((current) =>
      current && ["master", "album", "transition"].includes(current.kind) ? null : current,
    );
  }

  function updateListeningChecklist(patch: Partial<ListeningChecklist>) {
    rememberUndo();
    setListeningChecklist((current) => ({ ...current, ...patch }));
  }

  function updateListeningApproval(approved: boolean) {
    rememberUndo();
    setListeningApproved(approved);
  }

  function resetListeningChecklist() {
    rememberUndo();
    setListeningChecklist(emptyListeningChecklist);
    setListeningApproved(false);
  }

  function updateSettings(patch: Partial<Settings>, options: { dirty?: boolean } = { dirty: true }) {
    setSettings((current) => ({ ...current, ...patch }));
    if (options.dirty !== false) markDirty();
  }

  async function updateExportChecks(manifestToCheck: RenderManifest | null) {
    if (!manifestToCheck) {
      setExportChecks(null);
      return null;
    }
    try {
      const result = await invoke<ExportCheckResult>("run_export_checks", { manifest: manifestToCheck });
      setExportChecks(result);
      return result;
    } catch (error) {
      setExportChecks(null);
      pushLog(`Export checks failed: ${String(error)}`);
      return null;
    }
  }

  async function saveCurrentUserPreset() {
    const name = userPresetName.trim() || `${activePreset?.label ?? "Custom"} chain`;
    try {
      const saved = await invoke<UserPreset>("save_user_preset", {
        preset: {
          name,
          mode,
          settings: userPresetSettings(settings),
        },
      });
      setUserPresets((current) => sortUserPresets([...current.filter((preset) => preset.id !== saved.id), saved]));
      setSelectedUserPresetId(saved.id);
      setUserPresetName(saved.name);
      pushLog(`Saved user preset: ${saved.name}`);
      setProgressLabel("User preset saved.");
    } catch (error) {
      pushLog(`Save user preset failed: ${String(error)}`);
      setProgressLabel("User preset save failed.");
    }
  }

  function applyUserPreset() {
    if (!selectedUserPreset) return;
    const presetSettings = normalizeUserPresetSettings(selectedUserPreset.settings);
    if (!Object.keys(presetSettings).length) return;
    updateSettings(presetSettings);
    setUserPresetName(selectedUserPreset.name);
    pushLog(`Applied user preset: ${selectedUserPreset.name}`);
    setProgressLabel("User preset applied.");
  }

  function addPaths(paths: string[]) {
    const audioPaths = paths.filter((path) => /\.(wav|flac|mp3|m4a|aac|aif|aiff|ogg|opus)$/i.test(path));
    if (!audioPaths.length) return;
    markDirty();
    setManifest(null);
    setExportChecks(null);
    setDashboardPath("");
    setRenderRevision(null);
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
    if (typeof selected === "string") updateSettings({ referenceTrack: selected });
  }

  async function analyze() {
    if (!tracks.length) return;
    setBusy(true);
    setPhase("Analyzing");
    setProgress(0);
    setProgressLabel("Analyzing source files.");
    try {
      const sourceStatus = await invoke<SourceValidation[]>("validate_audio_sources", {
        paths: tracks.map((track) => track.path),
      });
      setTracks((current) =>
        current.map((track) => {
          const status = sourceStatus.find((candidate) => samePath(candidate.path, track.path));
          if (!status) return track;
          return {
            ...track,
            sourceStatus: status,
            analysis: status.status === "ok" ? track.analysis : undefined,
            waveform: status.status === "ok" ? track.waveform : undefined,
          };
        }),
      );
      const blocked = sourceStatus.filter((status) => status.status !== "ok");
      if (blocked.length) {
        const first = blocked[0];
        pushLog(`Analyze blocked: ${blocked.length} source issue(s). ${fileStem(first.path)}: ${first.detail}`);
        setProgressLabel("Fix missing or unreadable source files.");
        return;
      }
      const rows = await invoke<AnalysisRow[]>("analyze_tracks", {
        paths: tracks.map((track) => track.path),
        sampleRate: settings.sampleRate,
        waveformBins: 640,
      });
      setTracks((current) =>
        current.map((track) => {
          const row = rows.find((candidate) => samePath(candidate.source, track.path));
          return row ? { ...track, analysis: row.analysis, waveform: row.waveform } : track;
        }),
      );
      pushLog(`Analyzed ${rows.length} track(s).`);
      setProgress(1);
      setProgressLabel("Analysis complete.");
    } catch (error) {
      pushLog(`Analyze failed: ${String(error)}`);
      setProgressLabel("Analyze failed.");
    } finally {
      setBusy(false);
      setPhase("Idle");
    }
  }

  async function recheckSourceHealth(targetTracks = tracks) {
    if (!targetTracks.length) return;
    try {
      const sourceStatus = await invoke<SourceValidation[]>("validate_audio_sources", {
        paths: targetTracks.map((track) => track.path),
      });
      setTracks((current) =>
        current.map((track) => {
          const status = sourceStatus.find((candidate) => samePath(candidate.path, track.path));
          if (!status) return track;
          return {
            ...track,
            sourceStatus: status,
            analysis: status.status === "ok" ? track.analysis : undefined,
            waveform: status.status === "ok" ? track.waveform : undefined,
          };
        }),
      );
      const blocked = sourceStatus.filter((status) => status.status !== "ok");
      pushLog(blocked.length ? `Source check found ${blocked.length} issue(s).` : `Source check passed for ${sourceStatus.length} track(s).`);
      setProgressLabel(blocked.length ? "Source issues need repair." : "Source files are readable.");
    } catch (error) {
      pushLog(`Source check failed: ${String(error)}`);
      setProgressLabel("Source check failed.");
    }
  }

  async function exportTrackMasters() {
    if (!tracks.length || !settings.outputDir || !allAnalyzed) return;
    const revisionAtStart = sessionRevision;
    const exportRoot = `${settings.outputDir}\\track-master-${timestamp()}`;
    const updates = new Map<string, Partial<Track>>();
    setBusy(true);
    setPhase("Exporting Track Master");
    setProgress(0);
    setProgressLabel("Preparing independent masters.");
    setManifest(null);
    setExportChecks(null);
    setDashboardPath("");
    try {
      const renderedTrackItems: ManifestTrackItem[] = [];
      const batchWarnings: string[] = [];
      let lastDashboard = "";
      for (let index = 0; index < tracks.length; index += 1) {
        const track = tracks[index];
        const outputDir = `${exportRoot}\\${String(index + 1).padStart(2, "0")}-${slug(track.title)}`;
        const project = buildProject(false, [track], { transitionsEnabled: false });
        setProgressLabel(`Rendering ${track.title}.`);
        const result = await invoke<ProductRenderResult>("render_track_master", {
          project,
          outputDir,
        });
        const loaded = withDashboard(result.manifest, result.dashboard_path);
        const trackItem = manifestTrackItems(loaded)[0];
        const warnings = [...(loaded.warnings ?? []), ...(trackItem?.warnings ?? [])];
        if (trackItem) {
          renderedTrackItems.push({
            ...trackItem,
            index: index + 1,
            title: track.title,
            source: track.path,
          });
        }
        batchWarnings.push(...warnings);
        updates.set(track.id, {
          masteredPath: trackItem?.output,
          masteredAnalysis: trackItem?.after,
          qualityWarnings: warnings,
          lastOutputDir: outputDir,
        });
        lastDashboard = result.dashboard_path ?? "";
        setProgress((index + 1) / tracks.length);
      }
      const batchManifest = buildTrackMasterBatchManifest(renderedTrackItems, batchWarnings, exportRoot);
      setTracks((current) => current.map((track) => ({ ...track, ...(updates.get(track.id) ?? {}) })));
      setRenderRevision(revisionAtStart);
      setPreviewArtifact(null);
      setManifest(batchManifest);
      await updateExportChecks(batchManifest);
      setDashboardPath(lastDashboard);
      pushLog(`Track Master export complete: ${tracks.length} independent master(s). ${exportRoot}`);
      setProgressLabel("Track Master export complete.");
    } catch (error) {
      pushLog(`Track Master export failed: ${String(error)}`);
      setProgressLabel("Track Master export failed.");
    } finally {
      setBusy(false);
      setPhase("Idle");
    }
  }

  async function renderAlbum(albumWav: boolean) {
    if (!tracks.length || !settings.outputDir || !allAnalyzed) return;
    const revisionAtStart = sessionRevision;
    setBusy(true);
    setPhase(albumWav ? "Rendering Album Master" : "Rendering album files");
    setProgress(0);
    setProgressLabel("Preparing album render.");
    setManifest(null);
    setExportChecks(null);
    setDashboardPath("");
    try {
      const outputDir = `${settings.outputDir}\\album-master-${timestamp()}`;
      const project = buildProject(albumWav, tracks);
      const result = await invoke<ProductRenderResult>("render_album_master", { project, outputDir });
      const loaded = withDashboard(result.manifest, result.dashboard_path);
      setManifest(loaded);
      await updateExportChecks(loaded);
      setProjectPath(result.project_path);
      setTracks((current) => attachMasterPaths(current, loaded, outputDir));
      setRenderRevision(revisionAtStart);
      setPreviewArtifact(null);
      pushLog(`Album render complete: ${loaded.track_count} masters, ${loaded.interlude_count} transitions. ${outputDir}`);
      setDashboardPath(result.dashboard_path ?? "");
      setProgress(1);
      setProgressLabel("Album render complete.");
    } catch (error) {
      pushLog(`Album render failed: ${String(error)}`);
      setProgressLabel("Album render failed.");
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
    pushLog("Cancel requested.");
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
        defaultPath: `${settings.outputDir || repoRoot}\\album.ams.json`,
        filters: [{ name: "AMS project", extensions: ["ams.json", "json"] }],
      }));
    if (typeof selected !== "string") return;
    await invoke("write_project", {
      path: selected,
      project: buildProject(mode === "album", tracks),
    });
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
      transitionsEnabled:
        projectSettings.generated_transitions ??
        (project.transitions ?? []).some((item: any) => item.enabled !== false),
      boundaryStyle: projectSettings.default_boundary_style ?? current.boundaryStyle,
      boundaryDuration: projectSettings.default_boundary_duration ?? current.boundaryDuration,
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
    setMode(projectSettings.album_wav || (project.transitions ?? []).some((item: any) => item.enabled !== false) ? "album" : "track");
    setProjectPath(path);
    setManifest(null);
    setExportChecks(null);
    setDashboardPath("");
    setRenderRevision(null);
    setPreviewArtifact(null);
    setRegion(null);
    setUndoStack([]);
    setRedoStack([]);
    setSessionRevision((current) => current + 1);
    pushLog(`Opened project: ${path}`);
  }

  function buildProject(
    albumWav: boolean,
    projectTracks: Track[] = tracks,
    options: { transitionsEnabled?: boolean } = {},
  ) {
    const transitionsEnabled = options.transitionsEnabled ?? (albumWav && settings.transitionsEnabled);
    return {
      version: 1,
      album_title: settings.albumTitle || (mode === "track" ? "Track Master Session" : "Untitled Album"),
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
        generated_transitions: settings.transitionsEnabled,
        default_boundary_style: settings.boundaryStyle,
        default_boundary_duration: settings.boundaryDuration,
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
      tracks: projectTracks.map((track) => ({
        path: track.path,
        title: track.title,
        artist: track.artist,
        isrc: track.isrc,
        character: track.character,
        preset: track.preset,
      })),
      transitions: projectTracks.slice(0, -1).map((_, index) => ({
        after_track: index + 1,
        duration_seconds: settings.transitionDuration,
        style: "inherit",
        enabled: transitionsEnabled,
        boundary_style: settings.boundaryStyle,
        boundary_duration_seconds: settings.boundaryDuration,
      })),
    };
  }

  function updateTrack(id: string, patch: Partial<Track>) {
    markDirty();
    setTracks((current) => current.map((track) => (track.id === id ? { ...track, ...patch } : track)));
  }

  function removeTrack(id: string) {
    markDirty();
    setManifest(null);
    setExportChecks(null);
    setDashboardPath("");
    setRenderRevision(null);
    setTracks((current) => current.filter((track) => track.id !== id));
    if (selectedTrackId === id) setSelectedTrackId(null);
  }

  async function replaceTrackSource(track: Track) {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: ["wav", "flac", "mp3", "m4a", "aac", "aif", "aiff", "ogg", "opus"] }],
    });
    if (typeof selected !== "string") return;
    markDirty();
    setManifest(null);
    setExportChecks(null);
    setDashboardPath("");
    setRenderRevision(null);
    setPreviewArtifact((current) => (current?.trackId === track.id ? null : current));
    setTracks((current) =>
      current.map((item) => {
        if (item.id !== track.id) return item;
        const shouldRename = item.title === fileStem(item.path);
        return {
          ...item,
          path: selected,
          title: shouldRename ? fileStem(selected) : item.title,
          analysis: undefined,
          waveform: undefined,
          masteredPath: undefined,
          masteredAnalysis: undefined,
          qualityWarnings: undefined,
          lastOutputDir: undefined,
          sourceStatus: undefined,
        };
      }),
    );
    pushLog(`Replaced source for ${track.title}. Analyze again before export.`);
    setProgressLabel("Source replaced. Analyze again.");
  }

  function moveDragged(overId: string) {
    if (!draggingId || draggingId === overId) return;
    markDirty();
    setManifest(null);
    setExportChecks(null);
    setDashboardPath("");
    setRenderRevision(null);
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

  async function setAudio(item: Omit<PlayItem, "originalPath">) {
    setComparePair(null);
    setProgressLabel(`Preparing ${item.kind} playback.`);
    try {
      const playbackPath = await invoke<string>("prepare_playback_file", { path: item.path });
      setPlayItem({ ...item, originalPath: item.path, path: playbackPath });
      pushLog(`Playback ready: ${item.label}`);
    } catch (error) {
      pushLog(`Playback prep failed for ${item.label}: ${String(error)}`);
      setProgressLabel("Playback prep failed.");
    }
  }

  async function renderPreviewMaster(
    track: Track | null = selectedTrack,
    options: { audition?: boolean } = {},
  ): Promise<string | null> {
    if (!track || !settings.outputDir || !track.analysis) return null;
    const revisionAtStart = sessionRevision;
    const sourceDuration = track.analysis.duration_seconds ?? duration;
    const auditionStartSeconds = region
      ? regionStartTime(region, sourceDuration)
      : (audioRef.current?.currentTime ?? position);
    setBusy(true);
    setPhase("Rendering preview");
    setProgress(0);
    setProgressLabel(`Rendering preview for ${track.title}.`);
    try {
      const outputDir = `${settings.outputDir}\\preview-${timestamp()}`;
      const project = buildProject(false, [track], { transitionsEnabled: false });
      const result = await invoke<ProductRenderResult>("render_track_master", { project, outputDir });
      const loaded = withDashboard(result.manifest, result.dashboard_path);
      const trackItem = manifestTrackItems(loaded)[0];
      const masterPath = trackItem?.output ?? "";
      if (!masterPath) throw new Error("Preview render did not produce a mastered track.");
      const warnings = [...(loaded.warnings ?? []), ...(trackItem?.warnings ?? [])];
      setPreviewArtifact({
        trackId: track.id,
        revision: revisionAtStart,
        path: masterPath,
        outputDir,
        auditionStartSeconds,
        analysis: trackItem?.after,
        warnings,
      });
      setTracks((current) =>
        current.map((item) =>
          item.id === track.id
            ? { ...item, masteredPath: masterPath, masteredAnalysis: trackItem?.after, qualityWarnings: warnings, lastOutputDir: outputDir }
            : item,
        ),
      );
      setManifest(loaded);
      await updateExportChecks(loaded);
      if (options.audition) {
        pendingSeekRef.current = clamp(auditionStartSeconds, 0, Math.max(sourceDuration - 0.1, 0));
        (window as typeof window & {
          __AMS_EXPORT_ENGINE_AUDITION__?: {
            engine: string;
            path: string;
            revision: number;
            sourceDurationSeconds: number;
            startSeconds: number;
            trackId: string;
          };
        }).__AMS_EXPORT_ENGINE_AUDITION__ = {
          engine: "python-render-track-master",
          path: masterPath,
          revision: revisionAtStart,
          sourceDurationSeconds: sourceDuration,
          startSeconds: auditionStartSeconds,
          trackId: track.id,
        };
        await setAudio({
          label: `${track.title} - Mastered`,
          path: masterPath,
          kind: "master",
          trackId: track.id,
        });
      }
      setProgress(1);
      setProgressLabel("Preview ready.");
      pushLog(`Preview ready: ${masterPath}`);
      return masterPath;
    } catch (error) {
      pushLog(`Preview failed: ${String(error)}`);
      setProgressLabel("Preview failed.");
      return null;
    } finally {
      setBusy(false);
      setPhase("Idle");
    }
  }

  async function renderRegionPreview(track: Track | null = selectedTrack): Promise<string | null> {
    if (!track || !settings.outputDir || !track.analysis) return null;
    const windowToRender = regionPreviewWindow(track);
    if (!windowToRender) {
      pushLog("Region preview unavailable: source duration is unknown.");
      setProgressLabel("Region preview unavailable.");
      return null;
    }
    const revisionAtStart = sessionRevision;
    setBusy(true);
    setPhase("Rendering region preview");
    setProgress(0);
    setProgressLabel(`Rendering ${windowToRender.label} through the export engine.`);
    try {
      const outputDir = `${settings.outputDir}\\region-preview-${timestamp()}`;
      const project = buildProject(false, [track], { transitionsEnabled: false });
      const result = await invoke<ProductRenderResult>("render_track_region_preview", {
        project,
        outputDir,
        startSeconds: windowToRender.startSeconds,
        durationSeconds: windowToRender.durationSeconds,
        auditionOnly: true,
      });
      const loaded = withDashboard(result.manifest, result.dashboard_path);
      const trackItem = manifestTrackItems(loaded)[0];
      const masterPath = trackItem?.output ?? "";
      if (!masterPath) throw new Error("Region preview did not produce a mastered region.");
      const warnings = [...(loaded.warnings ?? []), ...(trackItem?.warnings ?? [])];
      const artifact: RegionPreviewArtifact = {
        trackId: track.id,
        revision: revisionAtStart,
        path: masterPath,
        outputDir,
        startSeconds: windowToRender.startSeconds,
        durationSeconds: windowToRender.durationSeconds,
        analysis: trackItem?.after,
        warnings,
      };
      setRegionPreviewArtifact(artifact);
      (window as typeof window & {
        __AMS_REGION_ENGINE_AUDITION__?: {
          durationSeconds: number;
          engine: string;
          path: string;
          revision: number;
          startSeconds: number;
          trackId: string;
        };
      }).__AMS_REGION_ENGINE_AUDITION__ = {
        durationSeconds: windowToRender.durationSeconds,
        engine: "python-render-track-region-preview",
        path: masterPath,
        revision: revisionAtStart,
        startSeconds: windowToRender.startSeconds,
        trackId: track.id,
      };
      pendingSeekRef.current = 0;
      await setAudio({
        label: `${track.title} - Engine Region`,
        path: masterPath,
        kind: "master",
        trackId: track.id,
      });
      setProgress(1);
      setProgressLabel("Region preview ready.");
      pushLog(`Region engine preview ready: ${masterPath}`);
      return masterPath;
    } catch (error) {
      pushLog(`Region preview failed: ${String(error)}`);
      setProgressLabel("Region preview failed.");
      return null;
    } finally {
      setBusy(false);
      setPhase("Idle");
    }
  }

  function regionPreviewWindow(track: Track) {
    const sourceDuration = Number(track.analysis?.duration_seconds ?? duration);
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) return null;
    if (region && region.end > region.start) {
      const startSeconds = clamp(region.start * sourceDuration, 0, Math.max(sourceDuration - 0.25, 0));
      const durationSeconds = clamp((region.end - region.start) * sourceDuration, 0.25, Math.max(sourceDuration - startSeconds, 0.25));
      return { durationSeconds, label: "selected region", startSeconds };
    }
    const startSeconds = clamp(audioRef.current?.currentTime ?? position, 0, Math.max(sourceDuration - 0.25, 0));
    const durationSeconds = clamp(Math.min(8, sourceDuration - startSeconds), 0.25, Math.max(0.25, Math.min(8, sourceDuration)));
    return { durationSeconds, label: "playhead window", startSeconds };
  }

  async function startCompare(side: AuditionSide = "source") {
    if (!selectedTrack) return;
    const masteredOriginalPath = selectedMaster ?? (await renderPreviewMaster(selectedTrack));
    if (!masteredOriginalPath) return;
    setProgressLabel("Preparing A/B compare.");
    try {
      const [sourcePath, masteredPlaybackPath] = await Promise.all([
        invoke<string>("prepare_playback_file", { path: selectedTrack.path }),
        invoke<string>("prepare_playback_file", { path: masteredOriginalPath }),
      ]);
      const pair: ComparePair = {
        label: selectedTrack.title,
        trackId: selectedTrack.id,
        source: {
          label: `${selectedTrack.title} - Original`,
          path: sourcePath,
          originalPath: selectedTrack.path,
          kind: "source",
          trackId: selectedTrack.id,
        },
        master: {
          label: `${selectedTrack.title} - Mastered`,
          path: masteredPlaybackPath,
          originalPath: masteredOriginalPath,
          kind: "master",
          trackId: selectedTrack.id,
        },
      };
      setComparePair(pair);
      setCompareSide(side);
      pendingSeekRef.current = Math.min(audioRef.current?.currentTime ?? regionStartTime(region, duration), Math.max(duration - 0.1, 0));
      setPlayItem(side === "source" ? pair.source : pair.master);
      pushLog(`A/B ready: ${selectedTrack.title}`);
    } catch (error) {
      pushLog(`A/B prep failed: ${String(error)}`);
      setProgressLabel("A/B prep failed.");
    }
  }

  function switchCompare(side: AuditionSide) {
    if (!comparePair) {
      startCompare(side);
      return;
    }
    pendingSeekRef.current = audioRef.current?.currentTime ?? 0;
    setCompareSide(side);
    setPlayItem(side === "source" ? comparePair.source : comparePair.master);
  }

  function toggleCompareSide() {
    if (!comparePair) return;
    switchCompare(compareSide === "source" ? "master" : "source");
  }

  async function toggleNativeAbLoop() {
    if (nativePlaybackStatus.active) {
      await stopNativeAudition();
      return;
    }
    if (!selectedTrack?.analysis) return;
    const masteredOriginalPath = selectedMaster ?? (await renderPreviewMaster(selectedTrack));
    if (!masteredOriginalPath) return;
    setProgressLabel("Preparing native A/B audition.");
    try {
      const [sourcePath, masterPath] = await Promise.all([
        invoke<string>("prepare_playback_file", { path: selectedTrack.path }),
        invoke<string>("prepare_playback_file", { path: masteredOriginalPath }),
      ]);
      const sourceDuration = selectedTrack.analysis.duration_seconds ?? duration;
      const startSeconds = regionStartTime(region, sourceDuration);
      const regionMs = Math.round(
        clamp(region ? (region.end - region.start) * sourceDuration * 1000 : 600, 150, 2000),
      );
      const totalMs = Math.round(clamp(regionMs * 4, 1200, 5000));
      const status = await invoke<NativePlaybackStatus>("start_native_ab_loop_playback", {
        sourcePath,
        masterPath,
        startSeconds,
        regionDurationMs: regionMs,
        totalDurationMs: totalMs,
      });
      setNativePlaybackStatus(status);
      setProgressLabel("Native A/B audition running.");
      pushLog(`Native A/B audition started: ${selectedTrack.title} on ${status.output_device ?? "default output"}.`);
    } catch (error) {
      setNativePlaybackStatus(idleNativePlaybackStatus);
      pushLog(`Native A/B audition failed: ${String(error)}`);
      setProgressLabel("Native A/B audition failed.");
    }
  }

  async function toggleNativeFilePlayback() {
    if (nativeFilePlaybackActive) {
      await stopNativeAudition();
      return;
    }
    if (!playItem) return;
    setProgressLabel("Starting native playback.");
    try {
      const startSeconds = duration > 0 ? clamp(position, 0, duration) : 0;
      const status = await invoke<NativePlaybackStatus>("start_native_file_playback", {
        path: playItem.path,
        label: playItem.label,
        startSeconds,
        maxDurationMs: 60 * 60 * 1000,
      });
      setNativePlaybackStatus(status);
      setProgressLabel("Native playback running.");
      pushLog(`Native playback started: ${playItem.label} on ${status.output_device ?? "default output"}.`);
    } catch (error) {
      setNativePlaybackStatus(idleNativePlaybackStatus);
      pushLog(`Native playback failed: ${String(error)}`);
      setProgressLabel("Native playback failed.");
    }
  }

  async function stopNativeAudition() {
    const label = nativeAbPlaybackActive ? "Native A/B audition" : "Native playback";
    try {
      const status = await invoke<NativePlaybackStatus>("stop_native_playback");
      setNativePlaybackStatus(status);
      setProgressLabel(`${label} stopped.`);
      pushLog(`${label} stopped.`);
    } catch (error) {
      pushLog(`${label} stop failed: ${String(error)}`);
    }
  }

  async function setNativeAuditionPaused(paused: boolean) {
    try {
      const status = await invoke<NativePlaybackStatus>("pause_native_playback", { paused });
      setNativePlaybackStatus(status);
      setProgressLabel(paused ? `${nativePlaybackKind} paused.` : `${nativePlaybackKind} running.`);
      pushLog(paused ? `${nativePlaybackKind} paused.` : `${nativePlaybackKind} resumed.`);
    } catch (error) {
      pushLog(`${nativePlaybackKind} pause failed: ${String(error)}`);
    }
  }

  async function seekNativeAudition(positionSeconds: number) {
    try {
      const status = await invoke<NativePlaybackStatus>("seek_native_playback", { positionSeconds });
      setNativePlaybackStatus(status);
    } catch (error) {
      pushLog(`${nativePlaybackKind} seek failed: ${String(error)}`);
    }
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (audioRef.current.paused) audioRef.current.play();
    else audioRef.current.pause();
  }

  function stopPlayback() {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  }

  function seek(value: number) {
    if (!audioRef.current || !duration) return;
    const next = clamp(value, 0, duration);
    audioRef.current.currentTime = next;
    setPosition(next);
  }

  function seekFraction(fraction: number) {
    if (!duration) return;
    seek(clamp(fraction, 0, 1) * duration);
  }

  function handleTimeUpdate(event: React.SyntheticEvent<HTMLAudioElement>) {
    const audio = event.currentTarget;
    const current = audio.currentTime || 0;
    setPosition(current);
    if (!loopSelection || !region || !audio.duration) return;
    const start = region.start * audio.duration;
    const end = region.end * audio.duration;
    if (end - start < 0.25) return;
    if (current >= end || current < start - 0.15) {
      audio.currentTime = start;
      setPosition(start);
    }
  }

  function toggleLoopSelection() {
    if (!region) return;
    setLoopSelection((current) => {
      const next = !current;
      if (next && audioRef.current && duration) {
        const start = region.start * duration;
        audioRef.current.currentTime = start;
        setPosition(start);
      }
      return next;
    });
  }

  function toggleLiveAudition() {
    if (!selectedTrack?.analysis) return;
    rememberUndo();
    setLiveAudition((current) => {
      const next = !current;
      if (next) {
        const chain = prepareLiveAuditionChain();
        chain?.context.resume().catch(() => undefined);
        setProgressLabel("Live preview enabled for source playback.");
        pushLog("Live preview enabled: Low/Mid/High, Width, Volume Match, and light Intensity respond through Web Audio.");
      } else {
        setProgressLabel("Live preview disabled.");
        pushLog("Live preview disabled.");
      }
      return next;
    });
  }

  function changeMode(nextMode: StudioMode) {
    if (mode === nextMode) return;
    markDirty();
    setMode(nextMode);
  }

  async function openLocalPath(path: string, label: string) {
    if (!path.trim()) {
      pushLog(`${label} is not available yet.`);
      return;
    }
    try {
      await invoke("open_path", { path });
      pushLog(`Opened ${label}: ${path}`);
    } catch (error) {
      pushLog(`Open ${label} failed: ${String(error)}`);
    }
  }

  function selectPreset(tile: PresetTile) {
    updateSettings({ preset: tile.enginePreset });
  }

  function resetCoreControls() {
    updateSettings({
      brightness: 0,
      bass: 0,
      presence: 0,
      air: 0,
      warmth: 0,
      compression: 0,
      limiter: 0,
      width: 0,
    });
  }

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="app-mark"><AudioWaveform size={18} /></span>
          <div>
            <p className="eyebrow">Local mastering</p>
            <h1>Album Mastering Studio</h1>
          </div>
        </div>
        <div className="mode-tabs" role="tablist" aria-label="Mastering mode">
          <button className={mode === "track" ? "active" : ""} onClick={() => changeMode("track")}><Music2 size={16} /> Track Master</button>
          <button className={mode === "album" ? "active" : ""} onClick={() => changeMode("album")}><ListMusic size={16} /> Album Master</button>
        </div>
        <div className="top-actions">
          <button onClick={undoSession} disabled={busy || !undoStack.length} title="Undo"><Undo2 size={16} /></button>
          <button onClick={redoSession} disabled={busy || !redoStack.length} title="Redo"><Redo2 size={16} /></button>
          <button onClick={openProject} title="Open project"><FolderOpen size={16} /> Open</button>
          <button onClick={saveProject} title="Save project"><Save size={16} /> Save</button>
          <button onClick={() => openLocalPath(settings.outputDir, "output folder")} title="Open output folder"><FolderOpen size={16} /> Output</button>
          <button onClick={() => alert("Album Mastering Studio\nLocal Tauri shell with Python engine sidecar.")} title="About"><Info size={16} /></button>
        </div>
      </header>

      <section className="session-strip">
        <label>
          {mode === "track" ? "Session" : "Album"}
          <input value={settings.albumTitle} onChange={(event) => updateSettings({ albumTitle: event.target.value })} />
        </label>
        <label>
          Artist
          <input value={settings.artist} onChange={(event) => updateSettings({ artist: event.target.value })} />
        </label>
        <label className="wide">
          Output
          <input value={settings.outputDir} onChange={(event) => updateSettings({ outputDir: event.target.value }, { dirty: false })} />
        </label>
        <label className="wide">
          Reference
          <div className="inline-field">
            <input value={settings.referenceTrack} onChange={(event) => updateSettings({ referenceTrack: event.target.value })} />
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
          <button className="drop-zone" onClick={addFiles}>
            Drop audio or click Add
          </button>
          {sourceIssues.length > 0 && (
            <div className="source-repair-panel" aria-label="Source repair">
              <div className="panel-title compact">
                <span><AlertTriangle size={15} /> Source Repair</span>
                <button onClick={() => recheckSourceHealth(sourceIssues)} disabled={busy}><RotateCcw size={14} /> Recheck</button>
              </div>
              <div className="source-issue-list">
                {sourceIssues.map((track) => (
                  <div className="source-issue-row" key={track.id}>
                    <div className="source-issue-copy">
                      <strong>{track.title}</strong>
                      <span className={`source-status ${track.sourceStatus?.status ?? "unreadable"}`}>{sourceStatusChip(track.sourceStatus)}</span>
                      <small>{track.sourceStatus?.detail}</small>
                    </div>
                    <div className="source-issue-actions">
                      <button onClick={() => replaceTrackSource(track)} disabled={busy}><FolderOpen size={14} /> Replace</button>
                      <button onClick={() => removeTrack(track.id)} disabled={busy}><Trash2 size={14} /> Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="track-list">
            {tracks.map((track, index) => (
              <button
                key={track.id}
                className={`track-row ${selectedTrackId === track.id ? "selected" : ""} ${track.sourceStatus && track.sourceStatus.status !== "ok" ? "source-issue" : ""}`}
                draggable
                onDragStart={() => setDraggingId(track.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => moveDragged(track.id)}
                onClick={() => setSelectedTrackId(track.id)}
              >
                <span className="track-number">{index + 1}</span>
                <span className="track-summary">
                  <strong>{track.title}</strong>
                  <WaveformMini bins={track.waveform} active={selectedTrackId === track.id} />
                  <small>{analysisChip(track)}</small>
                </span>
                <span
                  className="icon-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeTrack(track.id);
                  }}
                  title="Remove track"
                >
                  <Trash2 size={15} />
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="audition">
          <div className="selected-heading">
            <div>
              <p className="eyebrow">{selectedTrack ? `Track ${selectedIndex + 1}` : "No track"}</p>
              <input
                className="track-title-input"
                value={selectedTrack?.title ?? ""}
                onChange={(event) => selectedTrack && updateTrack(selectedTrack.id, { title: event.target.value })}
                disabled={!selectedTrack}
              />
            </div>
            <div className="status-pills">
              <span className={allAnalyzed ? "pill ok" : "pill"}>{allAnalyzed ? "Analyzed" : "Needs analysis"}</span>
              <span className={hasStaleRender ? "pill warn" : selectedMaster ? "pill ok" : "pill"}>
                {hasStaleRender ? "Preview stale" : selectedMaster ? "Master ready" : "No master"}
              </span>
            </div>
          </div>

          <WaveformPanel
            bins={selectedTrack?.waveform}
            zoom={waveformZoom}
            positionFraction={duration ? position / duration : 0}
            selection={region}
            disabled={!selectedTrack?.waveform}
            onSeek={seekFraction}
            onSelectionChange={(next) => {
              setRegion(next);
              if (!next) setLoopSelection(false);
            }}
          />

          <div className="wave-tools">
            <label className="zoom-control">
              Zoom
              <input type="range" min={1} max={8} step={0.25} value={waveformZoom} onChange={(event) => setWaveformZoom(Number(event.target.value))} />
              <output>{waveformZoom.toFixed(1)}x</output>
            </label>
            <button className={loopSelection ? "active" : ""} disabled={!region} onClick={toggleLoopSelection} title="Loop selected region">
              <Repeat size={16} /> Loop
            </button>
            <button disabled={!region} onClick={() => setRegion(null)}>Clear Region</button>
            <span className="region-readout">{region ? `${formatTime(region.start * selectedTimelineDuration)} - ${formatTime(region.end * selectedTimelineDuration)} (${formatTime(selectedRegionSeconds)})` : "No region selected"}</span>
          </div>

          <div className="transport">
            <button className="play" onClick={togglePlay} disabled={!playItem}>{isPlaying ? <Pause /> : <Play />}</button>
            <div className="transport-main">
              <div className="transport-label">{playItem ? `${playItem.label}` : "Player idle"}</div>
              <input
                aria-label="Playback position"
                className="seek"
                type="range"
                min={0}
                max={duration || 0}
                step={0.01}
                value={position}
                onInput={(event) => seek(Number(event.currentTarget.value))}
                onChange={(event) => seek(Number(event.currentTarget.value))}
              />
              <div className="time-row"><span>{formatTime(position)}</span><span>{formatTime(duration)}</span></div>
            </div>
            <button onClick={stopPlayback} disabled={!playItem}><Square size={17} /> Stop</button>
            <button
              className={nativeFilePlaybackActive ? "active" : ""}
              onClick={toggleNativeFilePlayback}
              disabled={(!playItem && !nativeFilePlaybackActive) || busy}
              title="Plays the current prepared transport item through the native Windows audio path."
            >
              {nativeFilePlaybackActive ? <Square size={17} /> : <Volume2 size={17} />} {nativeFilePlaybackActive ? "Native Stop" : "Native Play"}
            </button>
            <audio
              ref={audioRef}
              src={playItem ? convertFileSrc(playItem.path) : undefined}
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onError={() => {
                pushLog(playItem ? `Playback failed: ${playItem.originalPath}` : "Playback failed.");
                setProgressLabel("Playback failed.");
              }}
            />
          </div>

          <div className="audition-actions">
            <button disabled={!selectedTrack} onClick={() => selectedTrack && setAudio({ label: `${selectedTrack.title} - Original`, path: selectedTrack.path, kind: "source", trackId: selectedTrack.id })}>
              <Play size={16} /> Original
            </button>
            <button disabled={!selectedTrack?.analysis || busy} onClick={() => renderPreviewMaster(selectedTrack, { audition: true })}>
              <Activity size={16} /> Update Preview
            </button>
            <button
              disabled={!selectedTrack?.analysis || busy}
              onClick={() => renderRegionPreview(selectedTrack)}
              title="Renders the selected region or current playhead window through the Python export engine."
            >
              <Scissors size={16} /> Render Region
            </button>
            <button disabled={!selectedMaster} onClick={() => selectedTrack && selectedMaster && setAudio({ label: `${selectedTrack.title} - Mastered`, path: selectedMaster, kind: "master", trackId: selectedTrack.id })}>
              <Activity size={16} /> Mastered
            </button>
            <button
              className={liveAudition ? "active" : ""}
              disabled={!selectedTrack?.analysis}
              onClick={toggleLiveAudition}
              title="Applies the first-layer controls to source playback immediately. This is a Web Audio audition baseline, not the final export engine."
            >
              <SlidersHorizontal size={16} /> Live Preview
            </button>
            <div className="ab-switch" role="group" aria-label="Original mastered toggle">
              <button className={compareSide === "source" && comparePair ? "active" : ""} disabled={!selectedTrack?.analysis || busy} onClick={() => switchCompare("source")}>
                Original
              </button>
              <button className={compareSide === "master" && comparePair ? "active" : ""} disabled={!selectedTrack?.analysis || busy} onClick={() => switchCompare("master")}>
                Mastered
              </button>
            </div>
            <button
              className={nativeAbPlaybackActive ? "active" : ""}
              disabled={!selectedTrack?.analysis || busy}
              onClick={toggleNativeAbLoop}
              title="Runs a bounded native source/master A/B loop through the Rust audio path. This is native transport proof, not live DSP parity."
            >
              <GitCompare size={16} /> Native A/B
            </button>
            <button
              className={nativePlaybackStatus.paused ? "active" : ""}
              disabled={!nativePlaybackStatus.active}
              onClick={() => setNativeAuditionPaused(!nativePlaybackStatus.paused)}
              title={nativePlaybackStatus.paused ? "Resume native playback" : "Pause native playback"}
            >
              {nativePlaybackStatus.paused ? <Play size={16} /> : <Pause size={16} />} {nativePlaybackStatus.paused ? "Resume" : "Pause"}
            </button>
            <button className={volumeMatch ? "active" : ""} onClick={() => setVolumeMatch((current) => !current)} title="Aligns playback loudness for fair tone comparison. Export level is unchanged.">
              <Volume2 size={16} /> Volume Match
            </button>
            <span className={`live-audition-status ${liveAuditionActive ? "active" : ""}`}>
              {liveAudition
                ? `Live Preview ${liveAuditionActive ? "active" : "armed"}${liveAuditionLatencyMs ? ` ~${Math.round(liveAuditionLatencyMs)} ms` : ""}`
                : "Offline preview"}
            </span>
            <span
              className={`preview-parity-status ${liveAuditionActive || (!selectedMaster && !regionPreviewPlaying) ? "warn" : ""}`}
              title={previewParityTitle}
            >
              {previewParityLabel}
            </span>
            <span className="live-contract-status modeled" title={livePreviewContractTitle}>
              Live model: {livePreviewContractModeledText}
            </span>
            <span className="live-contract-status render-only" title={livePreviewContractTitle}>
              Render-only: {livePreviewContractRenderOnlyText}
            </span>
            {livePreviewContractDrift.length > 0 && (
              <span className="live-contract-status warn" title={livePreviewContractTitle}>
                Contract drift
              </span>
            )}
            <span className={`native-audition-status ${nativePlaybackStatus.active ? "active" : ""}`}>
              {nativePlaybackStatus.active
                ? `${nativePlaybackKind} ${nativePlaybackStatus.paused ? "paused" : "playing"}`
                : "Native transport ready"}
            </span>
            {nativePlaybackStatus.active && (
              <div className="native-transport-control">
                <input
                  aria-label="Native playback position"
                  type="range"
                  min={0}
                  max={Math.max(nativePlaybackStatus.duration_seconds, 0.01)}
                  step={0.01}
                  value={Math.min(nativePlaybackStatus.position_seconds, Math.max(nativePlaybackStatus.duration_seconds, 0.01))}
                  onInput={(event) => seekNativeAudition(Number(event.currentTarget.value))}
                />
                <span>{formatTime(nativePlaybackStatus.position_seconds)} / {formatTime(nativePlaybackStatus.duration_seconds)}</span>
                {nativePlaybackStatus.output_device && <span className="native-device">{nativePlaybackStatus.output_device}</span>}
              </div>
            )}
            {(nativePlaybackStatus.stream_errors.length > 0 || nativePlaybackStatus.warnings.length > 0) && (
              <span className="native-audition-status warn">Native issue</span>
            )}
          </div>

          <div className="analysis-grid">
            <Metric label="Source LUFS" value={formatDb(selectedTrack?.analysis?.integrated_lufs, " LUFS")} />
            <Metric label="Source Peak" value={formatDb(selectedTrack?.analysis?.true_peak_dbfs, " dBFS")} />
            <Metric label="Master LUFS" value={formatDb(selectedMasterAnalysis?.integrated_lufs, " LUFS")} />
            <Metric label="Master Peak" value={formatDb(selectedMasterAnalysis?.true_peak_dbfs, " dBFS")} />
          </div>

          <div className="quality-panel">
            <div className="panel-title compact">
              <span>Quality Checks</span>
              {selectedTrack?.lastOutputDir && <button onClick={() => openLocalPath(selectedTrack.lastOutputDir ?? "", "track output folder")}><FolderOpen size={15} /> Open</button>}
            </div>
            {exportChecks && !hasStaleRender && (
              <div className={`export-receipt ${exportChecks.status}`}>
                <div>
                  <strong>{exportChecks.status === "pass" ? "Export checks passed" : exportChecks.status === "warn" ? "Export checks need review" : "Export checks failed"}</strong>
                  <span>{exportChecks.summary}</span>
                </div>
                <div className="export-check-grid">
                  {exportChecks.checks.map((check) => (
                    <span className={`export-check ${check.status}`} key={`${check.label}-${check.status}`}>
                      <b>{check.label}</b>
                      <small>{check.detail}</small>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {selectedWarnings.length ? (
              <ul>
                {selectedWarnings.slice(0, 5).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
              </ul>
            ) : (
              <p>{selectedMaster ? "No warnings reported for the selected master." : "Checks appear after preview or export."}</p>
            )}
          </div>
        </section>

        <aside className="controls">
          <div className="panel-title">
            <span>Mastering Direction</span>
            {activePreset && <small>{activePreset.label}</small>}
          </div>
          <div className="preset-grid">
            {TRACK_PRESETS.map((tile) => (
              <button
                key={tile.id}
                className={`preset-tile ${settings.preset === tile.enginePreset ? "active" : ""}`}
                onClick={() => selectPreset(tile)}
              >
                <strong>{tile.label}</strong>
                <span>{tile.tone}</span>
                <small>{tile.target}</small>
              </button>
            ))}
          </div>

          <div className="user-preset-panel">
            <div className="panel-title compact">
              <span>User Presets</span>
              <small>{userPresets.length}</small>
            </div>
            <div className="preset-save-row">
              <input
                aria-label="User preset name"
                value={userPresetName}
                onChange={(event) => setUserPresetName(event.target.value)}
              />
              <button onClick={saveCurrentUserPreset}>
                <Save size={15} /> Save
              </button>
            </div>
            <div className="preset-apply-row">
              <select
                aria-label="Saved user presets"
                value={selectedUserPresetId}
                disabled={!userPresets.length}
                onChange={(event) => setSelectedUserPresetId(event.target.value)}
              >
                {userPresets.length ? (
                  userPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)
                ) : (
                  <option value="">No saved presets</option>
                )}
              </select>
              <button disabled={!selectedUserPreset} onClick={applyUserPreset}>
                <SlidersHorizontal size={15} /> Apply
              </button>
            </div>
          </div>

          <div className="core-controls">
            <Slider label="Intensity" unit="x" min={-1} max={1} step={0.05} value={settings.compression} onChange={(compression) => updateSettings({ compression })} />
            <Slider label="Low" unit="dB" min={-3} max={3} step={0.05} value={settings.bass} onChange={(bass) => updateSettings({ bass })} />
            <Slider label="Mid" unit="dB" min={-3} max={3} step={0.05} value={settings.presence} onChange={(presence) => updateSettings({ presence })} />
            <Slider label="High" unit="dB" min={-3} max={3} step={0.05} value={settings.air} onChange={(air) => updateSettings({ air })} />
          </div>

          <button className="collapse-button" onClick={() => setAdvancedOpen((current) => !current)}>
            <SlidersHorizontal size={16} /> Advanced {advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {advancedOpen && (
            <div className="advanced-controls">
              <ControlSelect label="Specialty preset" value={settings.preset} options={[...TRACK_PRESETS.map((item) => [item.enginePreset, item.label]), ...SPECIALTY_PRESETS]} onChange={(preset) => updateSettings({ preset })} />
              <ControlSelect label="Delivery" value={settings.deliveryProfile} options={DELIVERY} onChange={(deliveryProfile) => updateSettings({ deliveryProfile })} />
              <NumberField label="Target LUFS" value={settings.targetLufs} onChange={(targetLufs) => updateSettings({ targetLufs })} />
              <NumberField label="Ceiling dBFS" value={settings.ceilingDbfs} onChange={(ceilingDbfs) => updateSettings({ ceilingDbfs })} />
              <Slider label="Brightness" unit="dB" min={-3} max={3} step={0.05} value={settings.brightness} onChange={(brightness) => updateSettings({ brightness })} />
              <Slider label="Warmth" unit="sat" min={-0.08} max={0.12} step={0.005} value={settings.warmth} onChange={(warmth) => updateSettings({ warmth })} />
              <Slider label="Limiter" unit="push" min={-1} max={1} step={0.05} value={settings.limiter} onChange={(limiter) => updateSettings({ limiter })} />
              <Slider label="Width" unit="width" min={-0.35} max={0.35} step={0.01} value={settings.width} onChange={(width) => updateSettings({ width })} />
              <label className="check-row">
                <input type="checkbox" checked={settings.codecPreview} onChange={(event) => updateSettings({ codecPreview: event.target.checked })} />
                Codec QC
              </label>
            </div>
          )}

          {mode === "album" && (
            <div className="album-controls">
              <ControlSelect label="Album Arc" value={settings.arc} options={ARCS} onChange={(arc) => updateSettings({ arc })} />
              <label className="check-row">
                <input type="checkbox" checked={settings.transitionsEnabled} onChange={(event) => updateSettings({ transitionsEnabled: event.target.checked })} />
                Generated transitions
              </label>
              <ControlSelect label="Boundary" value={settings.boundaryStyle} options={BOUNDARY_OPTIONS} onChange={(boundaryStyle) => updateSettings({ boundaryStyle })} />
              <NumberSlider label="Boundary Seconds" min={0} max={12} step={0.25} value={settings.boundaryDuration} onChange={(boundaryDuration) => updateSettings({ boundaryDuration })} />
              <ControlSelect label="Transition" value={settings.transitionStyle} options={TRANSITIONS.map((item) => [item, item])} onChange={(transitionStyle) => updateSettings({ transitionStyle })} />
              <Slider label="Arc Intensity" unit="x" min={0} max={2} step={0.05} value={settings.arcIntensity} onChange={(arcIntensity) => updateSettings({ arcIntensity })} />
              <NumberSlider label="Transition Seconds" min={0} max={20} step={0.5} value={settings.transitionDuration} onChange={(transitionDuration) => updateSettings({ transitionDuration })} />
              {selectedTrack && (
                <>
                  <ControlSelect label="Track Role" value={selectedTrack.character} options={CHARACTER_OPTIONS} onChange={(character) => updateTrack(selectedTrack.id, { character })} />
                  <ControlSelect label="Track Preset" value={selectedTrack.preset} options={[["auto", "Auto"], ...TRACK_PRESETS.map((item) => [item.enginePreset, item.label]), ...SPECIALTY_PRESETS]} onChange={(preset) => updateTrack(selectedTrack.id, { preset })} />
                </>
              )}
              <AlbumStoryReview
                story={albumStoryText}
                roles={albumRolePreviews}
                selectedTrackId={selectedTrackId}
                onSelectTrack={setSelectedTrackId}
                onUpdateRole={(id, character) => updateTrack(id, { character })}
              />
            </div>
          )}

          <div className="command-panel">
            <button onClick={analyze} disabled={busy || !tracks.length}><BarChart3 size={16} /> Analyze</button>
            {mode === "track" ? (
              <button className="primary" disabled={busy || !allAnalyzed} onClick={exportTrackMasters}>
                <Gauge size={16} /> Export Master
              </button>
            ) : (
              <>
                <button className="primary" disabled={busy || !allAnalyzed} onClick={() => renderAlbum(true)}>
                  <Disc3 size={16} /> Export Album
                </button>
                <button disabled={busy || !allAnalyzed} onClick={() => renderAlbum(false)}>
                  <Scissors size={16} /> Masters Only
                </button>
              </>
            )}
            <button className="reset" onClick={resetCoreControls}><RotateCcw size={15} /> Reset</button>
            <button className="danger" disabled={!busy} onClick={cancel}>Cancel</button>
          </div>
        </aside>
      </section>

      <section className="lower-deck">
        <div className="render-panel">
          <div>
            <p className="eyebrow">Engine</p>
            <h2>{phase}</h2>
          </div>
          {hasStaleRender && <div className="stale-banner">Settings changed since the last preview or render.</div>}
          <div className="progress-readout">
            <span>{progressLabel}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div className="progress determinate"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          {mode === "album" && (
            <div className="artifact-grid">
              <button disabled={!manifest?.album_sequence || hasStaleRender} onClick={() => manifest?.album_sequence && setAudio({ label: "album_sequence.wav", path: manifest.album_sequence, kind: "album" })}>
                <Disc3 size={16} /> Album WAV
              </button>
              {transitions.map((transition) => (
                <button key={transition.output} onClick={() => setAudio({ label: `Transition ${transition.between[0]} to ${transition.between[1]}`, path: transition.output, kind: "transition" })}>
                  Transition {transition.between[0]}-{transition.between[1]} <span>{transition.style}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="dashboard-pane">
          <div className="panel-title compact">
            <span>Dashboard</span>
            <button disabled={!dashboardPath} onClick={() => dashboardPath && openLocalPath(dashboardPath, "dashboard HTML")}><FileDown size={16} /> Open HTML</button>
          </div>
          {dashboardPath ? <iframe src={convertFileSrc(dashboardPath)} /> : <div className="empty">No dashboard loaded.</div>}
        </div>

        <div className="listening-panel">
          <div className="panel-title compact">
            <span>Listening Pass</span>
            <span>{listeningCompletedCount}/{listeningTotalCount}</span>
            <span className={`approval-pill ${listeningApproved && !hasStaleRender ? "ok" : "warn"}`}>
              {listeningApprovalStatus}
            </span>
          </div>
          <div className="listening-grid">
            <ChecklistToggle label="Original checked" checked={listeningChecklist.trackOriginal} onChange={(trackOriginal) => updateListeningChecklist({ trackOriginal })} />
            <ChecklistToggle label="Master checked" checked={listeningChecklist.trackMaster} onChange={(trackMaster) => updateListeningChecklist({ trackMaster })} />
            <ChecklistToggle label="Native A/B checked" checked={listeningChecklist.trackNativeAb} onChange={(trackNativeAb) => updateListeningChecklist({ trackNativeAb })} />
            <ChecklistToggle label="Album WAV checked" checked={listeningChecklist.albumSequence} onChange={(albumSequence) => updateListeningChecklist({ albumSequence })} />
            <ChecklistToggle label="Transitions checked" checked={listeningChecklist.albumTransitions} onChange={(albumTransitions) => updateListeningChecklist({ albumTransitions })} />
            <ChecklistToggle label="Dashboard checked" checked={listeningChecklist.dashboardReviewed} onChange={(dashboardReviewed) => updateListeningChecklist({ dashboardReviewed })} />
          </div>
          <ChecklistToggle label="Approved after listening" checked={listeningApproved} onChange={updateListeningApproval} />
          <textarea
            aria-label="Listening notes"
            value={listeningChecklist.notes}
            onChange={(event) => updateListeningChecklist({ notes: event.target.value })}
            placeholder="Listening notes"
          />
          <button className="reset" onClick={resetListeningChecklist}>Clear Listening Pass</button>
        </div>

        <pre className="log">{logs.slice(-18).join("\n")}</pre>
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

function AlbumStoryReview({
  story,
  roles,
  selectedTrackId,
  onSelectTrack,
  onUpdateRole,
}: {
  story: string;
  roles: AlbumRolePreview[];
  selectedTrackId: string | null;
  onSelectTrack: (id: string) => void;
  onUpdateRole: (id: string, character: string) => void;
}) {
  return (
    <div className="album-story-review" aria-label="Album Story / Roles">
      <div className="panel-title compact">
        <span>Album Story / Roles</span>
        <small>{roles.length ? `${roles.length} track${roles.length === 1 ? "" : "s"}` : "No tracks"}</small>
      </div>
      <p className="story-copy">{story}</p>
      <div className="role-review-list">
        {roles.map((preview) => (
          <div
            className={`album-role-card ${preview.track.id === selectedTrackId ? "selected" : ""}`}
            key={preview.track.id}
          >
            <div className="role-card-heading">
              <button type="button" onClick={() => onSelectTrack(preview.track.id)}>
                Track {preview.index}
              </button>
              <strong>{preview.track.title}</strong>
            </div>
            <div className="role-chips">
              <span>{preview.role}</span>
              <span>{preview.character}</span>
              <span>{preview.confidence}</span>
            </div>
            <p>{preview.rationale}</p>
            <label className="control compact">
              Override role
              <select
                aria-label={`Override role for ${preview.track.title}`}
                value={preview.track.character}
                onChange={(event) => onUpdateRole(preview.track.id, event.target.value)}
              >
                {CHARACTER_OPTIONS.map(([key, name]) => <option value={key} key={key}>{name}</option>)}
              </select>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChecklistToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="check-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
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

function NumberSlider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <output>{value.toFixed(1)} s</output>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WaveformMini({ bins, active }: { bins?: number[]; active: boolean }) {
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
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = active ? "#2f2a22" : "#201f1d";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = active ? "#f0a84a" : "#7c7163";
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

function WaveformPanel({
  bins,
  zoom,
  positionFraction,
  selection,
  disabled,
  onSeek,
  onSelectionChange,
}: {
  bins?: number[];
  zoom: number;
  positionFraction: number;
  selection: RegionSelection | null;
  disabled?: boolean;
  onSeek: (fraction: number) => void;
  onSelectionChange: (selection: RegionSelection | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dragStart = useRef<number | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);
  const visible = visibleRange(positionFraction, zoom);
  const currentSelection = dragStart.current != null && dragCurrent != null
    ? normalizeRegion(dragStart.current, dragCurrent)
    : selection;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawWaveform(ctx, rect.width, rect.height, bins, visible, positionFraction, currentSelection, Boolean(disabled));
  }, [bins, visible.start, visible.end, positionFraction, currentSelection?.start, currentSelection?.end, disabled]);

  function fractionFromEvent(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const local = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    return clamp(visible.start + local * (visible.end - visible.start), 0, 1);
  }

  return (
    <canvas
      className={`wave-large ${disabled ? "disabled" : ""}`}
      ref={ref}
      onDoubleClick={() => onSelectionChange(null)}
      onMouseDown={(event) => {
        if (disabled) return;
        const fraction = fractionFromEvent(event);
        dragStart.current = fraction;
        setDragCurrent(fraction);
        onSeek(fraction);
      }}
      onMouseMove={(event) => {
        if (dragStart.current == null) return;
        setDragCurrent(fractionFromEvent(event));
      }}
      onMouseUp={(event) => {
        if (dragStart.current == null) return;
        const end = fractionFromEvent(event);
        const start = dragStart.current;
        dragStart.current = null;
        setDragCurrent(null);
        if (Math.abs(end - start) < 0.003) {
          onSeek(end);
        } else {
          onSelectionChange(normalizeRegion(start, end));
        }
      }}
      onMouseLeave={() => {
        if (dragStart.current != null && dragCurrent != null) {
          onSelectionChange(normalizeRegion(dragStart.current, dragCurrent));
        }
        dragStart.current = null;
        setDragCurrent(null);
      }}
    />
  );
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bins: number[] | undefined,
  visible: RegionSelection,
  positionFraction: number,
  selection: RegionSelection | null,
  disabled: boolean,
) {
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#211f1c");
  gradient.addColorStop(0.58, "#171817");
  gradient.addColorStop(1, "#24201c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(222, 204, 174, 0.1)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i += 1) {
    const y = (height / 6) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (!bins?.length || disabled) {
    ctx.fillStyle = "#746a5c";
    ctx.font = "13px system-ui";
    ctx.fillText("Analyze to draw waveform", 22, height / 2);
    return;
  }

  const startIndex = Math.max(0, Math.floor(visible.start * (bins.length - 1)));
  const endIndex = Math.min(bins.length - 1, Math.ceil(visible.end * (bins.length - 1)));
  const visibleBins = bins.slice(startIndex, endIndex + 1);
  const mid = height / 2;
  ctx.lineWidth = 1.2;
  visibleBins.forEach((bin, index) => {
    const x = (index / Math.max(visibleBins.length - 1, 1)) * width;
    const amp = Math.max(1, Math.pow(bin, 0.78) * height * 0.43);
    const hue = index % 18 === 0 ? "#e6b05c" : "#d5c4a8";
    ctx.strokeStyle = hue;
    ctx.beginPath();
    ctx.moveTo(x, mid - amp);
    ctx.lineTo(x, mid + amp);
    ctx.stroke();
  });

  if (selection) {
    const left = ((selection.start - visible.start) / (visible.end - visible.start)) * width;
    const right = ((selection.end - visible.start) / (visible.end - visible.start)) * width;
    ctx.fillStyle = "rgba(202, 70, 56, 0.28)";
    ctx.fillRect(Math.max(0, left), 0, Math.min(width, right) - Math.max(0, left), height);
    ctx.strokeStyle = "#df5a44";
    ctx.strokeRect(Math.max(0, left), 0.5, Math.min(width, right) - Math.max(0, left), height - 1);
  }

  const playX = ((positionFraction - visible.start) / (visible.end - visible.start)) * width;
  if (playX >= 0 && playX <= width) {
    ctx.strokeStyle = "#f2d085";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, height);
    ctx.stroke();
  }
}

function attachMasterPaths(tracks: Track[], manifest: RenderManifest, outputDir: string) {
  const renderedTracks = manifestTrackItems(manifest);
  return tracks.map((track, index) => {
    const item = renderedTracks[index];
    const warnings = [...(manifest.warnings ?? []), ...(item?.warnings ?? [])];
    return {
      ...track,
      masteredPath: item?.output,
      masteredAnalysis: item?.after,
      qualityWarnings: warnings,
      lastOutputDir: outputDir,
    };
  });
}

function buildAlbumStoryText(
  manifest: RenderManifest | null,
  tracks: Track[],
  allAnalyzed: boolean,
  hasStaleRender: boolean,
) {
  const story = !hasStaleRender ? manifest?.album_story : "";
  if (story) return story;
  if (!tracks.length) return "Add tracks to build an album story.";
  if (!allAnalyzed) return "Analyze the album to review likely roles before export.";
  const opener = tracks[0]?.title ?? "the opener";
  const closer = tracks[tracks.length - 1]?.title ?? "the closer";
  return `${opener} opens the sequence and ${closer} closes it. Review likely roles before export; the render will write the final album story and decision log.`;
}

function buildAlbumRolePreviews(tracks: Track[], manifestItems: ManifestTrackItem[]): AlbumRolePreview[] {
  return tracks.map((track, index) => {
    const item = manifestItems[index];
    if (item) {
      const character = item.character?.display_name ?? characterOptionLabel(item.character?.label ?? track.character);
      const confidence =
        typeof item.character?.confidence === "number"
          ? `${Math.round(item.character.confidence * 100)}% confidence`
          : "Render plan";
      return {
        track,
        index: index + 1,
        role: item.arc?.role ? titleCase(item.arc.role) : positionRole(index, tracks.length),
        character,
        confidence,
        source: "render",
        rationale: item.rationale ?? item.arc?.rationale ?? item.mastering_moves?.rationale ?? item.character?.reason ?? "Render plan is available for this track.",
      };
    }
    if (track.character !== "auto") {
      return {
        track,
        index: index + 1,
        role: positionRole(index, tracks.length),
        character: characterOptionLabel(track.character),
        confidence: "Manual override",
        source: "manual",
        rationale: "This role override will be passed into the album render.",
      };
    }
    if (!track.analysis) {
      return {
        track,
        index: index + 1,
        role: positionRole(index, tracks.length),
        character: "Likely role pending",
        confidence: "Needs analysis",
        source: "pending",
        rationale: "Analysis has not been run for this track yet.",
      };
    }
    return analysisRolePreview(track, index, tracks.length);
  });
}

function analysisRolePreview(track: Track, index: number, count: number): AlbumRolePreview {
  const analysis = track.analysis ?? {};
  const lufs = analysis.integrated_lufs ?? -16;
  const transient = analysis.transient_density ?? 0.35;
  const centroid = analysis.spectral_centroid_hz ?? 2200;
  const width = analysis.stereo_width ?? 0.4;
  let character = "Balanced";
  let confidence = "Unsure";
  let rationale = "Analysis suggests a balanced role; leave Auto unless the sequence intent is clearer by ear.";
  if (transient >= 0.52 || lufs > -13 || centroid > 3100) {
    character = "Likely Heavy";
    confidence = "Moderate";
    rationale = "Higher density or brightness suggests this may need the stronger album-center treatment.";
  } else if (lufs < -19 || transient < 0.24 || width < 0.28) {
    character = index === count - 1 && count > 2 ? "Likely Return" : "Likely Acoustic";
    confidence = "Moderate";
    rationale = "Lower density or narrower energy suggests a quieter role that should not be flattened into the loudest tracks.";
  }
  return {
    track,
    index: index + 1,
    role: positionRole(index, count),
    character,
    confidence,
    source: "analysis",
    rationale,
  };
}

function manifestTrackItems(manifest: RenderManifest | null): ManifestTrackItem[] {
  return ((manifest?.sequence ?? []).filter((item) => item.type === "track") as ManifestTrackItem[]) ?? [];
}

function buildTrackMasterBatchManifest(
  renderedTracks: ManifestTrackItem[],
  warnings: string[],
  exportRoot: string,
): RenderManifest {
  return {
    track_count: renderedTracks.length,
    interlude_count: 0,
    album_sequence: null,
    outputs: {
      masters_dir: exportRoot,
      album_sequence: null,
    },
    sequence: renderedTracks.map((track, index) => ({
      ...track,
      type: "track",
      index: index + 1,
    })),
    warnings,
    settings: {
      album_wav: false,
      codec_preview: false,
    },
  };
}

function withDashboard(manifest: RenderManifest, dashboardPath?: string | null): RenderManifest {
  return dashboardPath ? { ...manifest, dashboard: dashboardPath } : manifest;
}

function manifestTransitions(manifest: RenderManifest | null): TransitionArtifact[] {
  return ((manifest?.sequence ?? []).filter((item) => item.type === "interlude") as unknown as TransitionArtifact[]) ?? [];
}

function snapshotTrack(track: Track): Track {
  return {
    id: track.id || crypto.randomUUID(),
    path: track.path,
    title: track.title,
    artist: track.artist ?? "",
    isrc: track.isrc ?? "",
    character: track.character ?? "auto",
    preset: track.preset ?? "auto",
    analysis: track.analysis,
    waveform: track.waveform,
    sourceStatus: track.sourceStatus,
  };
}

function normalizeListeningChecklist(value?: Partial<ListeningChecklist> | null): ListeningChecklist {
  return {
    ...emptyListeningChecklist,
    ...(value ?? {}),
    notes: value?.notes ?? "",
  };
}

function userPresetSettings(settings: Settings): Partial<Settings> {
  const picked: Partial<Settings> = {};
  for (const key of USER_PRESET_SETTING_KEYS) {
    (picked as Record<keyof Settings, Settings[keyof Settings]>)[key] = settings[key];
  }
  return picked;
}

function normalizeUserPresetSettings(value?: Partial<Settings>): Partial<Settings> {
  const normalized: Partial<Settings> = {};
  if (!value || typeof value !== "object") return normalized;
  for (const key of USER_PRESET_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      (normalized as Record<keyof Settings, Settings[keyof Settings]>)[key] = value[key] as Settings[keyof Settings];
    }
  }
  return normalized;
}

function sortUserPresets(presets: UserPreset[]) {
  return [...presets].sort((left, right) => left.name.localeCompare(right.name));
}

function serializeSnapshot(snapshot: SessionSnapshot) {
  return JSON.stringify({
    version: snapshot.version,
    mode: snapshot.mode,
    settings: snapshot.settings,
    tracks: snapshot.tracks.map(snapshotTrack),
    selectedTrackId: snapshot.selectedTrackId,
    projectPath: snapshot.projectPath,
    region: snapshot.region,
    waveformZoom: snapshot.waveformZoom,
    advancedOpen: snapshot.advancedOpen,
    volumeMatch: snapshot.volumeMatch,
    liveAudition: snapshot.liveAudition,
    loopSelection: snapshot.loopSelection,
    listeningChecklist: normalizeListeningChecklist(snapshot.listeningChecklist),
    listeningApproved: Boolean(snapshot.listeningApproved),
  });
}

function applyLiveAuditionChain(
  chain: LiveAuditionChain,
  options: { active: boolean; bass: number; compression: number; high: number; mid: number; outputGain: number; width: number },
) {
  const now = chain.context.currentTime;
  const smoothing = livePreviewConfig.smoothingSeconds;
  const active = options.active;
  const bass = active ? clamp(options.bass, -6, 6) : 0;
  const mid = active ? clamp(options.mid, -6, 6) : 0;
  const high = active ? clamp(options.high, -6, 6) : 0;
  const width = active
    ? clamp(
        livePreviewConfig.width.base + options.width * livePreviewConfig.width.scale,
        livePreviewConfig.width.min,
        livePreviewConfig.width.max,
      )
    : livePreviewConfig.width.base;
  const drive = active ? clamp(Math.max(0, options.compression), 0, 1) : 0;

  chain.low.gain.setTargetAtTime(bass, now, smoothing);
  chain.mid.gain.setTargetAtTime(mid, now, smoothing);
  chain.high.gain.setTargetAtTime(high, now, smoothing);
  chain.sideLeft.gain.setTargetAtTime(width, now, smoothing);
  chain.sideRight.gain.setTargetAtTime(-width, now, smoothing);
  chain.output.gain.setTargetAtTime(1, now, smoothing);
  chain.compressor.threshold.setTargetAtTime(
    drive > 0
      ? livePreviewConfig.compressor.thresholdBaseDbfs - drive * livePreviewConfig.compressor.thresholdDriveScaleDb
      : 0,
    now,
    smoothing,
  );
  chain.compressor.ratio.setTargetAtTime(
    drive > 0
      ? livePreviewConfig.compressor.ratioBase + drive * livePreviewConfig.compressor.ratioDriveScale
      : livePreviewConfig.compressor.ratioBase,
    now,
    smoothing,
  );
  chain.compressor.knee.setTargetAtTime(drive > 0 ? livePreviewConfig.compressor.kneeDb : 0, now, smoothing);
  (window as typeof window & { __AMS_LIVE_AUDITION__?: LiveAuditionSnapshot }).__AMS_LIVE_AUDITION__ = {
    active,
    bass,
    mid,
    high,
    width,
    drive,
    contextState: chain.context.state,
    currentTime: now,
    baseLatencyMs: Number.isFinite(chain.context.baseLatency) ? chain.context.baseLatency * 1000 : null,
    updatedAt: performance.now(),
  };
}

const PREVIEW_STAGE_LABELS: Record<string, string> = {
  preset_base_tone: "tone",
  highpass: "highpass",
  low_mid_eq: "low-mid",
  brightness_tilt: "brightness",
  warmth_saturation: "warmth",
  transient_shape: "transients",
  lufs_match: "LUFS",
  ceiling_limiter: "limiter",
  codec_qc: "codec",
};

function summarizePreviewStages(stages: string[]) {
  if (!stages.length) return "Contract loading";
  return stages.map((stage) => PREVIEW_STAGE_LABELS[stage] ?? stage.replace(/_/g, " ")).join(", ");
}

function formatPreviewStages(stages: string[]) {
  if (!stages.length) return "none";
  return summarizePreviewStages(stages);
}

function livePreviewContractDriftMessages(contract: LivePreviewContract) {
  const drift: string[] = [];
  if (contract.modelId !== livePreviewConfig.modelId) drift.push("model");
  if (!sameFilterConfig(contractLiveFilterConfig(contract), livePreviewConfig.filters)) drift.push("filters");
  if (!sameNumericObject(contract.width, livePreviewConfig.width)) drift.push("width");
  if (!sameNumericObject(contract.compressor, livePreviewConfig.compressor)) drift.push("compressor");
  if (!sameNumber(contract.smoothingSeconds, livePreviewConfig.smoothingSeconds)) drift.push("smoothing");
  return drift;
}

function sameFilterConfig(left: ReturnType<typeof contractLiveFilterConfig>, right: typeof livePreviewConfig.filters) {
  return (
    left.low.type === right.low.type &&
    sameNumber(left.low.frequencyHz, right.low.frequencyHz) &&
    left.mid.type === right.mid.type &&
    sameNumber(left.mid.frequencyHz, right.mid.frequencyHz) &&
    sameNumber(left.mid.q, right.mid.q) &&
    left.high.type === right.high.type &&
    sameNumber(left.high.frequencyHz, right.high.frequencyHz)
  );
}

function sameNumericObject(left: Record<string, unknown>, right: Record<string, unknown>) {
  for (const key of Object.keys(right)) {
    if (!sameNumber(left[key], right[key])) return false;
  }
  return true;
}

function contractLiveFilterConfig(contract: LivePreviewContract) {
  return {
    low: {
      type: contract.filters.low.type,
      frequencyHz: contract.filters.low.frequencyHz,
    },
    mid: {
      type: contract.filters.mid.type,
      frequencyHz: contract.filters.mid.frequencyHz,
      q: contract.filters.mid.q,
    },
    high: {
      type: contract.filters.high.type,
      frequencyHz: contract.filters.high.frequencyHz,
    },
  };
}

function sameNumber(left: unknown, right: unknown) {
  return typeof left === "number" && typeof right === "number" && Math.abs(left - right) <= 0.000001;
}

function computePlaybackVolume(
  playItem: PlayItem | null,
  selectedTrack: Track | null,
  masterAnalysis: Analysis | undefined,
  volumeMatch: boolean,
) {
  if (!volumeMatch || !playItem || !selectedTrack || !["source", "master"].includes(playItem.kind)) return 1;
  const sourceLufs = selectedTrack.analysis?.integrated_lufs;
  const masterLufs = masterAnalysis?.integrated_lufs;
  if (!Number.isFinite(sourceLufs) || !Number.isFinite(masterLufs)) return 1;
  const target = Math.min(sourceLufs as number, masterLufs as number);
  const current = playItem.kind === "source" ? (sourceLufs as number) : (masterLufs as number);
  return clamp(Math.pow(10, (target - current) / 20), 0.2, 1);
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

function analysisChip(track: Track) {
  if (track.sourceStatus && track.sourceStatus.status !== "ok") return sourceStatusChip(track.sourceStatus);
  if (!track.analysis) return "Not analyzed";
  const lufs = formatDb(track.analysis.integrated_lufs, " LUFS");
  const peak = formatDb(track.analysis.true_peak_dbfs, " dBFS");
  return `${lufs} / ${peak}`;
}

function sourceStatusChip(status?: SourceValidation) {
  if (!status) return "Source issue";
  if (status.status === "missing") return "Missing source";
  if (status.status === "unsupported") return "Unsupported source";
  return "Unreadable source";
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

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "track";
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00";
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function formatDb(value: number | undefined, suffix: string) {
  if (!Number.isFinite(value)) return "--";
  return `${(value as number).toFixed(1)}${suffix}`;
}

function characterOptionLabel(value: string | undefined) {
  return CHARACTER_OPTIONS.find(([key]) => key === value)?.[1] ?? titleCase(value ?? "auto");
}

function positionRole(index: number, count: number) {
  if (count <= 1) return "Standalone";
  if (index === 0) return "Opener";
  if (index === count - 1) return "Closer";
  if (count <= 3) return "Center";
  if (index < count / 2) return "Lift";
  if (index === Math.floor(count / 2)) return "Centerpiece";
  return "Afterglow";
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRegion(a: number, b: number): RegionSelection {
  const start = clamp(Math.min(a, b), 0, 1);
  const end = clamp(Math.max(a, b), 0, 1);
  return { start, end };
}

function visibleRange(positionFraction: number, zoom: number): RegionSelection {
  const width = 1 / Math.max(1, zoom);
  const center = clamp(positionFraction || 0.5, width / 2, 1 - width / 2);
  return { start: center - width / 2, end: center + width / 2 };
}

function regionStartTime(region: RegionSelection | null, duration: number) {
  return region && duration ? region.start * duration : 0;
}

export default App;
