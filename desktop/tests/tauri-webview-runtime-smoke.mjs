import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const outputRoot = process.env.AMS_TAURI_WEBVIEW_OUTPUT || path.join(repoRoot, "test-output", "tauri-webview-runtime-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const cdpPort = process.env.TAURI_CDP_PORT || "9222";
const cdpBase = `http://127.0.0.1:${cdpPort}`;

mkdirSync(inputsDir, { recursive: true });
writeFixtures(inputsDir);

const target = await findTauriPageTarget();
const cdp = await connectCdp(target.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");
await cdp.send("Page.enable");
await waitForCondition(cdp, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'", 15000);

const trackA = path.join(inputsDir, "01_tauri_fixture.wav");
const trackB = path.join(inputsDir, "02_tauri_fixture.wav");
const trackOutput = path.join(outputRoot, "track-master");
const albumOutput = path.join(outputRoot, "album-master");
const boundaryStyles = ["gap", "fade", "ring-out", "crossfade"];
const boundaryOutputs = Object.fromEntries(
  boundaryStyles.map((style) => [style, path.join(outputRoot, `album-boundary-${style}`)]),
);
const livePreviewTuning = {
  airDb: -0.75,
  bassDb: 2.25,
  compression: 0.35,
  presenceDb: 1.25,
  width: 0.18,
};

const smoke = await evaluateInWebView(cdp, buildSmokeExpression({
  albumOutput,
  boundaryOutputs,
  livePreviewTuning,
  paths: [trackA, trackB],
  trackOutput,
}));
const exportVsLiveComparison = compareExportVsLiveModel({
  exportPath: smoke.playbackPath,
  outputPath: path.join(outputRoot, "live-preview-model.wav"),
  sourcePath: smoke.sourcePlaybackPath,
  tuning: livePreviewTuning,
});

const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
const screenshotPath = path.join(outputRoot, "tauri-webview.png");
writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

const evidence = {
  ...smoke,
  albumDashboardExists: existsSync(smoke.albumDashboardPath),
  albumManifestExists: existsSync(smoke.albumManifestPath),
  albumSequenceExists: existsSync(smoke.albumSequence),
  boundaryAlbumSequenceExists: existsSync(smoke.boundaryAlbumSequence),
  boundaryAlbumSequenceExistsByStyle: Object.fromEntries(
    Object.entries(smoke.boundaryResults).map(([style, result]) => [style, existsSync(result.albumSequence)]),
  ),
  screenshot: screenshotPath,
  screenshotExists: existsSync(screenshotPath),
  trackDashboardExists: existsSync(smoke.trackDashboardPath),
  trackManifestExists: existsSync(smoke.trackManifestPath),
  trackOutputExists: existsSync(smoke.trackOutput),
  sourcePlaybackPathExists: existsSync(smoke.sourcePlaybackPath),
  playbackPathExists: existsSync(smoke.playbackPath),
  exportVsLiveComparison,
};

assert.equal(evidence.analysisCount, 2);
assert.deepEqual(evidence.waveformBins, [48, 48]);
assert.equal(evidence.trackCount, 1);
assert.equal(evidence.albumTrackCount, 2);
assert.equal(evidence.albumInterludeCount, 1);
assert.equal(evidence.trackManifestExists, true);
assert.equal(evidence.trackDashboardExists, true);
assert.equal(evidence.trackOutputExists, true);
assert.equal(evidence.sourcePlaybackPathExists, true);
assert.equal(evidence.playbackPathExists, true);
assert.ok(["pass", "warn"].includes(evidence.trackExportChecks.status));
assert.equal(evidence.trackExportChecks.track_count, 1);
assert.equal(evidence.trackExportChecks.interlude_count, 0);
assert.ok(evidence.trackExportCheckLabels.includes("Track outputs"));
assert.ok(evidence.trackExportCheckLabels.includes("Meter values"));
assert.equal(evidence.exportVsLiveComparison.same_engine, false);
assert.equal(evidence.exportVsLiveComparison.preview_parity, "approximate");
assert.equal(evidence.exportVsLiveComparison.export_faithful_preview_required, true);
assert.equal(existsSync(evidence.exportVsLiveComparison.live_model_path), true);
assert.equal(Number.isFinite(evidence.exportVsLiveComparison.export_minus_live_lufs_proxy), true);
assert.equal(Number.isFinite(evidence.exportVsLiveComparison.rms_difference_dbfs), true);
assert.equal(evidence.albumManifestExists, true);
assert.equal(evidence.albumDashboardExists, true);
assert.equal(evidence.albumSequenceExists, true);
const expectedBoundaryCueTypes = {
  gap: ["track", "boundary", "track"],
  fade: ["track", "track"],
  "ring-out": ["track", "boundary", "track"],
  crossfade: ["track", "boundary", "track"],
};
for (const style of boundaryStyles) {
  assert.equal(evidence.boundaryAlbumSequenceExistsByStyle[style], true);
  assert.equal(evidence.boundaryResults[style].interludeCount, 0);
  assert.deepEqual(evidence.boundaryResults[style].sequenceTypes, ["track", "boundary", "track"]);
  assert.deepEqual(evidence.boundaryResults[style].cueTypes, expectedBoundaryCueTypes[style]);
  assert.equal(evidence.boundaryResults[style].settings.generated_transitions, false);
  assert.equal(evidence.boundaryResults[style].settings.default_boundary_style, style);
  assert.equal(evidence.boundaryResults[style].settings.default_boundary_duration, 0.5);
}
assert.ok(["pass", "warn"].includes(evidence.albumExportChecks.status));
assert.equal(evidence.albumExportChecks.track_count, 2);
assert.equal(evidence.albumExportChecks.interlude_count, 1);
assert.ok(evidence.albumExportCheckLabels.includes("Album WAV"));
assert.ok(evidence.albumExportCheckLabels.includes("Track outputs"));
assert.equal(evidence.screenshotExists, true);
assert.equal(typeof evidence.nativeAudio.host, "string");
assert.equal(Array.isArray(evidence.nativeAudio.available_hosts), true);
assert.equal(Array.isArray(evidence.nativeAudio.warnings), true);
if (evidence.nativeAudio.default_output_device) {
  assert.equal(typeof evidence.nativeAudio.default_output_config?.sample_rate, "number");
  assert.equal(typeof evidence.nativeAudio.default_output_config?.channels, "number");
}
assert.equal(typeof evidence.nativeStream.host, "string");
assert.equal(typeof evidence.nativeStream.default_output_device, "string");
assert.equal(typeof evidence.nativeStream.default_output_config?.sample_rate, "number");
assert.equal(typeof evidence.nativeStream.default_output_config?.channels, "number");
assert.ok(evidence.nativeStream.callback_count >= 1);
assert.ok(evidence.nativeStream.total_frames >= 0);
assert.equal(Array.isArray(evidence.nativeStream.observed_callback_frames), true);
assert.equal(Array.isArray(evidence.nativeStream.stream_errors), true);
assert.equal(Array.isArray(evidence.nativeStream.warnings), true);
assert.equal(typeof evidence.nativePlayback.host, "string");
assert.equal(typeof evidence.nativePlayback.default_output_device, "string");
assert.equal(evidence.nativePlayback.source_sample_format, "PCM_S16LE");
assert.equal(evidence.nativePlayback.source_sample_rate, 48000);
assert.equal(evidence.nativePlayback.source_channels, 2);
assert.ok(evidence.nativePlayback.callback_count >= 1);
assert.ok(evidence.nativePlayback.queued_source_frames > 0);
assert.ok(evidence.nativePlayback.queued_output_frames > 0);
assert.ok(evidence.nativePlayback.played_output_frames > 0);
assert.equal(Array.isArray(evidence.nativePlayback.stream_errors), true);
assert.equal(Array.isArray(evidence.nativePlayback.warnings), true);
assert.equal(typeof evidence.nativeAbLoop.host, "string");
assert.equal(evidence.nativeAbLoop.source_sample_format, "PCM_S16LE");
assert.equal(evidence.nativeAbLoop.master_sample_format, "PCM_S16LE");
assert.equal(evidence.nativeAbLoop.source_sample_rate, 48000);
assert.equal(evidence.nativeAbLoop.master_sample_rate, 48000);
assert.ok(evidence.nativeAbLoop.source_region_frames > 0);
assert.ok(evidence.nativeAbLoop.master_region_frames > 0);
assert.ok(evidence.nativeAbLoop.side_switch_count >= 1);
assert.ok(evidence.nativeAbLoop.played_output_frames > 0);
assert.equal(Array.isArray(evidence.nativeAbLoop.stream_errors), true);
assert.equal(Array.isArray(evidence.nativeAbLoop.warnings), true);
assert.equal(evidence.nativeSessionStart.active, true);
assert.ok(evidence.nativeSessionStart.queued_output_frames > 0);
assert.equal(evidence.nativeSessionRunning.active, true);
assert.ok(evidence.nativeSessionRunning.played_output_frames > 0);
assert.equal(evidence.nativeSessionPaused.active, true);
assert.equal(evidence.nativeSessionPaused.paused, true);
assert.equal(evidence.nativeSessionSeeked.active, true);
assert.equal(evidence.nativeSessionSeeked.paused, true);
assert.ok(evidence.nativeSessionSeeked.position_seconds >= evidence.nativeSeekTargetSeconds - 0.03);
assert.equal(evidence.nativeSessionResumed.active, true);
assert.equal(evidence.nativeSessionResumed.paused, false);
assert.ok(evidence.nativeSessionAfterResume.played_output_frames >= evidence.nativeSessionSeeked.played_output_frames);
assert.equal(evidence.nativeSessionStop.active, false);
assert.ok(evidence.nativeSessionStop.played_output_frames > 0);
assert.equal(Array.isArray(evidence.nativeSessionStop.stream_errors), true);
assert.equal(Array.isArray(evidence.nativeSessionStop.warnings), true);
assert.equal(evidence.nativeFileSessionStart.active, true);
assert.match(evidence.nativeFileSessionStart.label || "", /^Native file:/);
assert.ok(evidence.nativeFileSessionStart.queued_output_frames > 0);
assert.equal(evidence.nativeFileSessionRunning.active, true);
assert.ok(evidence.nativeFileSessionRunning.played_output_frames > 0);
assert.equal(evidence.nativeFileSessionPaused.active, true);
assert.equal(evidence.nativeFileSessionPaused.paused, true);
assert.equal(evidence.nativeFileSessionSeeked.active, true);
assert.equal(evidence.nativeFileSessionSeeked.paused, true);
assert.ok(evidence.nativeFileSessionSeeked.position_seconds >= evidence.nativeFileSeekTargetSeconds - 0.03);
assert.equal(evidence.nativeFileSessionResumed.active, true);
assert.equal(evidence.nativeFileSessionResumed.paused, false);
assert.ok(evidence.nativeFileSessionAfterResume.played_output_frames >= evidence.nativeFileSessionSeeked.played_output_frames);
assert.equal(evidence.nativeFileSessionStop.active, false);
assert.ok(evidence.nativeFileSessionStop.played_output_frames > 0);
assert.equal(Array.isArray(evidence.nativeFileSessionStop.stream_errors), true);
assert.equal(Array.isArray(evidence.nativeFileSessionStop.warnings), true);

const resultPath = path.join(outputRoot, "tauri-webview-runtime-smoke.json");
writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
cdp.close();

console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));

function writeFixtures(targetDir) {
  const python = process.env.ALBUM_MASTER_PYTHON || "python";
  const script = `
from pathlib import Path
import numpy as np
from scipy.io import wavfile
root = Path(r"${targetDir.replaceAll("\\", "\\\\")}")
root.mkdir(parents=True, exist_ok=True)
sr = 48000
for idx, freq in enumerate((196.0, 246.94), start=1):
    seconds = 1.35
    t = np.linspace(0, seconds, int(sr * seconds), endpoint=False)
    fade_in = np.minimum(1.0, np.linspace(0, 1, t.size) * 18)
    fade_out = np.minimum(1.0, np.linspace(1, 0, t.size) * 18)
    env = fade_in * fade_out
    tone = (np.sin(2*np.pi*freq*t) * 0.22 * env).astype(np.float32)
    wavfile.write(root / f"{idx:02d}_tauri_fixture.wav", sr, np.column_stack([tone, tone * 0.95]).astype(np.float32))
`;
  const result = spawnSync(python, ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function compareExportVsLiveModel({ exportPath, outputPath, sourcePath, tuning }) {
  const python = process.env.ALBUM_MASTER_PYTHON || "python";
  const script = `
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

source_path, export_path, output_path, tuning_json = sys.argv[1:5]
tuning = json.loads(tuning_json)

def read_wav(path):
    sample_rate, audio = wavfile.read(path)
    if audio.ndim == 1:
        audio = audio[:, None]
    if np.issubdtype(audio.dtype, np.integer):
        peak = float(np.iinfo(audio.dtype).max)
        audio = audio.astype(np.float32) / peak
    else:
        audio = audio.astype(np.float32)
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    audio = np.nan_to_num(audio[:, :2], nan=0.0, posinf=0.0, neginf=0.0)
    return int(sample_rate), audio

def apply_biquad(audio, b, a):
    return np.column_stack([signal.lfilter(b, a, audio[:, channel]) for channel in range(audio.shape[1])]).astype(np.float32)

def peaking(gain_db, freq, sample_rate, q=0.9):
    if abs(gain_db) < 1e-9:
        return None
    a_gain = 10 ** (gain_db / 40.0)
    omega = 2.0 * math.pi * freq / sample_rate
    alpha = math.sin(omega) / (2.0 * q)
    cosw = math.cos(omega)
    b0 = 1.0 + alpha * a_gain
    b1 = -2.0 * cosw
    b2 = 1.0 - alpha * a_gain
    a0 = 1.0 + alpha / a_gain
    a1 = -2.0 * cosw
    a2 = 1.0 - alpha / a_gain
    return np.array([b0, b1, b2]) / a0, np.array([1.0, a1 / a0, a2 / a0])

def low_shelf(gain_db, freq, sample_rate):
    if abs(gain_db) < 1e-9:
        return None
    a_gain = 10 ** (gain_db / 40.0)
    omega = 2.0 * math.pi * freq / sample_rate
    sinw = math.sin(omega)
    cosw = math.cos(omega)
    root_a = math.sqrt(a_gain)
    alpha = sinw / 2.0 * math.sqrt(2.0)
    b0 = a_gain * ((a_gain + 1.0) - (a_gain - 1.0) * cosw + 2.0 * root_a * alpha)
    b1 = 2.0 * a_gain * ((a_gain - 1.0) - (a_gain + 1.0) * cosw)
    b2 = a_gain * ((a_gain + 1.0) - (a_gain - 1.0) * cosw - 2.0 * root_a * alpha)
    a0 = (a_gain + 1.0) + (a_gain - 1.0) * cosw + 2.0 * root_a * alpha
    a1 = -2.0 * ((a_gain - 1.0) + (a_gain + 1.0) * cosw)
    a2 = (a_gain + 1.0) + (a_gain - 1.0) * cosw - 2.0 * root_a * alpha
    return np.array([b0, b1, b2]) / a0, np.array([1.0, a1 / a0, a2 / a0])

def high_shelf(gain_db, freq, sample_rate):
    if abs(gain_db) < 1e-9:
        return None
    a_gain = 10 ** (gain_db / 40.0)
    omega = 2.0 * math.pi * freq / sample_rate
    sinw = math.sin(omega)
    cosw = math.cos(omega)
    root_a = math.sqrt(a_gain)
    alpha = sinw / 2.0 * math.sqrt(2.0)
    b0 = a_gain * ((a_gain + 1.0) + (a_gain - 1.0) * cosw + 2.0 * root_a * alpha)
    b1 = -2.0 * a_gain * ((a_gain - 1.0) + (a_gain + 1.0) * cosw)
    b2 = a_gain * ((a_gain + 1.0) + (a_gain - 1.0) * cosw - 2.0 * root_a * alpha)
    a0 = (a_gain + 1.0) - (a_gain - 1.0) * cosw + 2.0 * root_a * alpha
    a1 = 2.0 * ((a_gain - 1.0) - (a_gain + 1.0) * cosw)
    a2 = (a_gain + 1.0) - (a_gain - 1.0) * cosw - 2.0 * root_a * alpha
    return np.array([b0, b1, b2]) / a0, np.array([1.0, a1 / a0, a2 / a0])

def apply_width(audio, width_value):
    width = min(1.65, max(0.35, 1.0 + width_value * 1.8))
    mid = (audio[:, 0] + audio[:, 1]) * 0.5
    side = (audio[:, 0] - audio[:, 1]) * 0.5 * width
    return np.column_stack([mid + side, mid - side]).astype(np.float32)

def apply_static_compression(audio, amount):
    amount = min(1.0, max(0.0, amount))
    if amount <= 0:
        return audio
    threshold = 10 ** ((-18.0 - amount * 16.0) / 20.0)
    ratio = 1.0 + amount * 3.5
    magnitude = np.abs(audio)
    over = magnitude > threshold
    output = audio.copy()
    compressed = threshold * np.power(magnitude[over] / threshold, 1.0 / ratio)
    output[over] = np.sign(audio[over]) * compressed
    return output.astype(np.float32)

def live_preview_model(audio, sample_rate, tuning):
    modeled = audio.copy()
    for design in (
        low_shelf(float(tuning.get("bassDb", 0.0)), 160.0, sample_rate),
        peaking(float(tuning.get("presenceDb", 0.0)), 1400.0, sample_rate),
        high_shelf(float(tuning.get("airDb", 0.0)), 5600.0, sample_rate),
    ):
        if design is not None:
            modeled = apply_biquad(modeled, design[0], design[1])
    modeled = apply_static_compression(modeled, float(tuning.get("compression", 0.0)))
    modeled = apply_width(modeled, float(tuning.get("width", 0.0)))
    return np.clip(modeled, -1.0, 1.0).astype(np.float32)

def rms_dbfs(audio):
    rms = float(np.sqrt(np.mean(np.square(audio))) + 1e-12)
    return 20.0 * math.log10(rms)

def peak_dbfs(audio):
    peak = float(np.max(np.abs(audio)) + 1e-12)
    return 20.0 * math.log10(peak)

def spectral_centroid(audio, sample_rate):
    mono = np.mean(audio, axis=1)
    size = int(min(max(256, mono.size), 8192))
    if size <= 0:
        return 0.0
    frame = mono[:size] * np.hanning(size)
    magnitude = np.abs(np.fft.rfft(frame))
    total = float(np.sum(magnitude))
    if total <= 1e-12:
        return 0.0
    freqs = np.fft.rfftfreq(size, 1.0 / sample_rate)
    return float(np.sum(freqs * magnitude) / total)

source_rate, source = read_wav(source_path)
export_rate, exported = read_wav(export_path)
if source_rate != export_rate:
    raise SystemExit("Sample-rate mismatch between playback assets")

live = live_preview_model(source, source_rate, tuning)
Path(output_path).parent.mkdir(parents=True, exist_ok=True)
wavfile.write(output_path, source_rate, live)

length = min(source.shape[0], live.shape[0], exported.shape[0])
source = source[:length]
live = live[:length]
exported = exported[:length]
difference = exported - live

result = {
    "offline_engine": "python-render-project",
    "live_preview_engine": "web-audio-deterministic-model",
    "same_engine": False,
    "preview_parity": "approximate",
    "export_faithful_preview_required": True,
    "sample_rate": source_rate,
    "compared_frames": int(length),
    "live_model_path": str(Path(output_path)),
    "source_lufs_proxy": rms_dbfs(source),
    "live_lufs_proxy": rms_dbfs(live),
    "export_lufs_proxy": rms_dbfs(exported),
    "export_minus_live_lufs_proxy": rms_dbfs(exported) - rms_dbfs(live),
    "source_peak_dbfs": peak_dbfs(source),
    "live_peak_dbfs": peak_dbfs(live),
    "export_peak_dbfs": peak_dbfs(exported),
    "rms_difference_dbfs": rms_dbfs(difference),
    "live_centroid_hz": spectral_centroid(live, source_rate),
    "export_centroid_hz": spectral_centroid(exported, source_rate),
}
print(json.dumps(result))
`;
  const result = spawnSync(python, ["-c", script, sourcePath, exportPath, outputPath, JSON.stringify(tuning)], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function findTauriPageTarget() {
  let response;
  try {
    response = await fetch(`${cdpBase}/json/list`);
  } catch (error) {
    throw new Error(
      `Could not reach Tauri WebView CDP at ${cdpBase}. Start Tauri dev with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${cdpPort}. ${error}`,
    );
  }
  assert.equal(response.ok, true, `CDP target list failed with HTTP ${response.status}`);
  const targets = await response.json();
  const target = targets.find((item) => item.type === "page" && item.url.includes("127.0.0.1:1420"));
  assert.ok(target, `No Tauri page target found on ${cdpBase}`);
  return target;
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(JSON.stringify(message.error)));
    } else {
      resolve(message.result);
    }
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("CDP WebSocket failed"));
  });
  return {
    close() {
      socket.close();
    },
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const callId = ++id;
        pending.set(callId, { reject, resolve });
        socket.send(JSON.stringify({ id: callId, method, params }));
      });
    },
  };
}

async function evaluateInWebView(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails, null, 2));
  }
  return JSON.parse(result.result.value);
}

async function waitForCondition(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.result?.value === true) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for condition: ${expression}`);
}

function buildSmokeExpression({ albumOutput, boundaryOutputs, livePreviewTuning, paths, trackOutput }) {
  return `
(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') throw new Error('Tauri invoke is not available in this WebView');
  const paths = ${JSON.stringify(paths)};
  const livePreviewTuning = ${JSON.stringify(livePreviewTuning)};
  const nativeAudio = await invoke('native_audio_probe');
  const nativeStream = await invoke('native_audio_stream_probe', { durationMs: 750 });
  const analysis = await invoke('analyze_tracks', { paths, sampleRate: 48000, waveformBins: 48 });
  const baseSettings = {
    sample_rate: 48000,
    preset: 'streaming',
    output_format: 'wav',
    bit_depth: 24,
    delivery_profile: 'streaming-universal',
    codec_preview: false,
    target_lufs: -14,
    ceiling_dbfs: -1,
    reference_track: null,
    default_interlude_duration: 0.5,
    default_interlude_style: 'auto',
    arc: 'cinematic',
    arc_intensity: 1,
    tweak_lufs: 0,
    tweak_brightness_db: 0,
    tweak_warmth: 0,
    tweak_low_end_db: 0,
    tweak_air_db: 0,
    tweak_presence_db: 0,
    tweak_width: 0,
    tweak_intensity: 0,
    tweak_limiter: 0,
    album_wav: false
  };
  const trackProject = {
    version: 1,
    album_title: 'Tauri Track Master Runtime Smoke',
    metadata: { artist: 'Codex Fixture' },
    settings: {
      ...baseSettings,
      album_wav: false,
      tweak_air_db: livePreviewTuning.airDb,
      tweak_intensity: livePreviewTuning.compression,
      tweak_low_end_db: livePreviewTuning.bassDb,
      tweak_presence_db: livePreviewTuning.presenceDb,
      tweak_width: livePreviewTuning.width
    },
    tracks: [{ path: paths[0], title: 'Tauri Fixture A', artist: '', isrc: '', character: 'auto', preset: 'auto' }],
    transitions: []
  };
  const trackResult = await invoke('render_track_master', { project: trackProject, outputDir: ${JSON.stringify(trackOutput)} });
  const trackItem = (trackResult.manifest.sequence || []).find((item) => item.type === 'track');
  if (!trackItem?.output) throw new Error('Track Master runtime smoke did not produce a track output');
  const trackExportChecks = await invoke('run_export_checks', { manifest: trackResult.manifest });
  const sourcePlaybackPath = await invoke('prepare_playback_file', { path: paths[0] });
  const playbackPath = await invoke('prepare_playback_file', { path: trackItem.output });
  const nativePlayback = await invoke('native_playback_file_probe', { path: playbackPath, durationMs: 500, startSeconds: 0 });
  const nativeAbLoop = await invoke('native_ab_loop_probe', {
    sourcePath: sourcePlaybackPath,
    masterPath: playbackPath,
    startSeconds: 0,
    regionDurationMs: 200,
    totalDurationMs: 800
  });
  const nativeSessionStart = await invoke('start_native_ab_loop_playback', {
    sourcePath: sourcePlaybackPath,
    masterPath: playbackPath,
    startSeconds: 0,
    regionDurationMs: 250,
    totalDurationMs: 1500
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const nativeSessionRunning = await invoke('native_playback_status');
  const nativeSessionPaused = await invoke('pause_native_playback', { paused: true });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const nativeSeekTargetSeconds = Math.max(0.1, Math.min(0.6, (nativeSessionPaused.duration_seconds || 1) * 0.35));
  const nativeSessionSeeked = await invoke('seek_native_playback', { positionSeconds: nativeSeekTargetSeconds });
  const nativeSessionResumed = await invoke('pause_native_playback', { paused: false });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const nativeSessionAfterResume = await invoke('native_playback_status');
  const nativeSessionStop = await invoke('stop_native_playback');
  const nativeFileSessionStart = await invoke('start_native_file_playback', {
    path: playbackPath,
    label: 'Track Master Render',
    startSeconds: 0,
    maxDurationMs: 2000
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const nativeFileSessionRunning = await invoke('native_playback_status');
  const nativeFileSessionPaused = await invoke('pause_native_playback', { paused: true });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const nativeFileSeekTargetSeconds = Math.max(0.1, Math.min(0.8, (nativeFileSessionPaused.duration_seconds || 1) * 0.45));
  const nativeFileSessionSeeked = await invoke('seek_native_playback', { positionSeconds: nativeFileSeekTargetSeconds });
  const nativeFileSessionResumed = await invoke('pause_native_playback', { paused: false });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const nativeFileSessionAfterResume = await invoke('native_playback_status');
  const nativeFileSessionStop = await invoke('stop_native_playback');
  const albumProject = {
    version: 1,
    album_title: 'Tauri Album Master Runtime Smoke',
    metadata: { artist: 'Codex Fixture' },
    settings: { ...baseSettings, preset: 'album-cohesion-cinematic', album_wav: true },
    tracks: [
      { path: paths[0], title: 'Tauri Fixture A', artist: '', isrc: '', character: 'auto', preset: 'auto' },
      { path: paths[1], title: 'Tauri Fixture B', artist: '', isrc: '', character: 'auto', preset: 'auto' }
    ],
    transitions: [{ after_track: 1, duration_seconds: 0.5, style: 'inherit', enabled: true }]
  };
  const albumResult = await invoke('render_album_master', { project: albumProject, outputDir: ${JSON.stringify(albumOutput)} });
  const albumExportChecks = await invoke('run_export_checks', { manifest: albumResult.manifest });
  const boundaryOutputs = ${JSON.stringify(boundaryOutputs)};
  const boundaryResults = {};
  for (const boundaryStyle of ['gap', 'fade', 'ring-out', 'crossfade']) {
    const boundaryProject = {
      version: 1,
      album_title: 'Tauri Album Boundary Runtime Smoke',
      metadata: { artist: 'Codex Fixture' },
      settings: {
        ...baseSettings,
        preset: 'album-cohesion-cinematic',
        album_wav: true,
        generated_transitions: false,
        default_boundary_style: boundaryStyle,
        default_boundary_duration: 0.5
      },
      tracks: [
        { path: paths[0], title: 'Boundary Fixture A', artist: '', isrc: '', character: 'auto', preset: 'auto' },
        { path: paths[1], title: 'Boundary Fixture B', artist: '', isrc: '', character: 'auto', preset: 'auto' }
      ],
      transitions: [{
        after_track: 1,
        duration_seconds: 0.5,
        style: 'inherit',
        enabled: false,
        boundary_style: boundaryStyle,
        boundary_duration_seconds: 0.5
      }]
    };
    const boundaryResult = await invoke('render_album_master', {
      project: boundaryProject,
      outputDir: boundaryOutputs[boundaryStyle]
    });
    boundaryResults[boundaryStyle] = {
      albumSequence: boundaryResult.manifest.album_sequence,
      interludeCount: boundaryResult.manifest.interlude_count,
      sequenceTypes: (boundaryResult.manifest.sequence || []).map((item) => item.type),
      cueTypes: (boundaryResult.manifest.cue_points || []).map((item) => item.type),
      settings: boundaryResult.manifest.settings
    };
  }
  const boundaryResult = boundaryResults.gap;
  return JSON.stringify({
    analysisCount: analysis.length,
    nativeAudio,
    nativeStream,
    waveformBins: analysis.map((row) => row.waveform.length),
    trackProjectPath: trackResult.project_path,
    trackManifestPath: trackResult.manifest_path,
    trackDashboardPath: trackResult.dashboard_path,
    trackCount: trackResult.manifest.track_count,
    trackOutput: trackItem.output,
    trackExportChecks,
    trackExportCheckLabels: (trackExportChecks.checks || []).map((check) => check.label),
    livePreviewTuning,
    sourcePlaybackPath,
    playbackPath,
    nativePlayback,
    nativeAbLoop,
    nativeSessionStart,
    nativeSessionRunning,
    nativeSessionPaused,
    nativeSeekTargetSeconds,
    nativeSessionSeeked,
    nativeSessionResumed,
    nativeSessionAfterResume,
    nativeSessionStop,
    nativeFileSessionStart,
    nativeFileSessionRunning,
    nativeFileSessionPaused,
    nativeFileSeekTargetSeconds,
    nativeFileSessionSeeked,
    nativeFileSessionResumed,
    nativeFileSessionAfterResume,
    nativeFileSessionStop,
    albumProjectPath: albumResult.project_path,
    albumManifestPath: albumResult.manifest_path,
    albumDashboardPath: albumResult.dashboard_path,
    albumTrackCount: albumResult.manifest.track_count,
    albumInterludeCount: albumResult.manifest.interlude_count,
    albumSequence: albumResult.manifest.album_sequence,
    albumExportChecks,
    albumExportCheckLabels: (albumExportChecks.checks || []).map((check) => check.label),
    albumWarnings: albumResult.manifest.warnings || [],
    boundaryAlbumSequence: boundaryResult.albumSequence,
    boundaryInterludeCount: boundaryResult.interludeCount,
    boundarySequenceTypes: boundaryResult.sequenceTypes,
    boundaryCueTypes: boundaryResult.cueTypes,
    boundarySettings: boundaryResult.settings,
    boundaryResults
  });
})()
`;
}
