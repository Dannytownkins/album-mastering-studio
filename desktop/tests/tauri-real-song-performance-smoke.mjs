import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const releaseExe =
  process.env.AMS_TAURI_RELEASE_EXE ||
  path.join(repoRoot, "desktop", "src-tauri", "target", "release", "album-mastering-studio.exe");
const sourcePath = process.env.AMS_REAL_SONG_PATH;
const outputRoot =
  process.env.AMS_TAURI_REAL_SONG_PERFORMANCE_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-real-song-performance-smoke");
const renderOutput = path.join(outputRoot, "track-master-real-song");
const firstControlRenderOutput = path.join(outputRoot, "track-master-real-song-first-control");
const firstControlLiveTuning = { bassDb: 0.5, midDb: -0.25, highDb: 0.35, width: 0.2, intensity: 0.4 };
const cdpPort = process.env.TAURI_CDP_PORT || "9345";
const cdpBase = `http://127.0.0.1:${cdpPort}`;

assert.ok(sourcePath, "Set AMS_REAL_SONG_PATH to a local audio file for this smoke.");
assert.equal(existsSync(sourcePath), true, `Real-song fixture does not exist: ${sourcePath}`);
assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
safeRemove(renderOutput);
safeRemove(firstControlRenderOutput);
mkdirSync(outputRoot, { recursive: true });

const launchStarted = nowMs();
const browserArguments = [
  process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
  `--remote-debugging-port=${cdpPort}`,
]
  .filter(Boolean)
  .join(" ");
const app = spawn(releaseExe, [], {
  cwd: path.dirname(releaseExe),
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArguments },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
const stdout = [];
const stderr = [];
app.stdout?.on("data", (chunk) => stdout.push(chunk.toString()));
app.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));

let cdp;
try {
  const target = await waitForPageTarget();
  const launchToTargetMs = nowMs() - launchStarted;
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitForCondition(cdp, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'", 15000);
  const launchToInvokeReadyMs = nowMs() - launchStarted;

  const smoke = await evaluateInWebView(cdp, realSongPerformanceExpression());
  const realSongExportVsLiveComparison = compareExportVsLiveModel({
    exportPath: smoke.firstControlTrackOutputPath,
    outputPath: path.join(outputRoot, "real-song-live-preview-first-control-model.wav"),
    sourcePath: smoke.playbackCachePath,
    tuning: firstControlLiveTuning,
  });
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-real-song-performance.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...smoke,
    launchToTargetMs: roundMs(launchToTargetMs),
    launchToInvokeReadyMs: roundMs(launchToInvokeReadyMs),
    realSongExportVsLiveComparison,
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    source: fileSummary(sourcePath),
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    targetTitle: target.title,
    targetUrl: target.url,
    dashboardExists: existsSync(smoke.dashboardPath),
    manifestExists: existsSync(smoke.manifestPath),
    playbackCacheExists: existsSync(smoke.playbackCachePath),
    trackOutputExists: existsSync(smoke.trackOutputPath),
    firstControlDashboardExists: existsSync(smoke.firstControlDashboardPath),
    firstControlManifestExists: existsSync(smoke.firstControlManifestPath),
    firstControlTrackOutputExists: existsSync(smoke.firstControlTrackOutputPath),
  };

  assert.equal(evidence.releaseExeExists, true);
  assert.equal(evidence.appTextIncludesBrand, true);
  assert.ok(evidence.launchToInvokeReadyMs < 30_000, `Release launch took ${evidence.launchToInvokeReadyMs}ms`);
  assert.equal(evidence.sourceValidationStatus, "ok");
  assert.equal(evidence.analysisCount, 1);
  assert.equal(evidence.waveformBins, 256);
  assert.ok(evidence.analysisDurationSeconds > 0);
  assert.equal(evidence.playbackCacheExists, true);
  assert.equal(evidence.renderTrackCount, 1);
  assert.equal(evidence.renderInterludeCount, 0);
  assert.equal(evidence.dashboardExists, true);
  assert.equal(evidence.manifestExists, true);
  assert.equal(evidence.trackOutputExists, true);
  assert.equal(evidence.firstControlRenderTrackCount, 1);
  assert.equal(evidence.firstControlRenderInterludeCount, 0);
  assert.equal(evidence.firstControlDashboardExists, true);
  assert.equal(evidence.firstControlManifestExists, true);
  assert.equal(evidence.firstControlTrackOutputExists, true);
  assert.ok(["pass", "warn"].includes(evidence.exportChecks.status));
  assert.equal(evidence.exportChecks.track_count, 1);
  assert.equal(evidence.realSongExportVsLiveComparison.offline_engine, "python-render-track-master");
  assert.equal(evidence.realSongExportVsLiveComparison.live_preview_engine, "web-audio-first-control-model");
  assert.deepEqual(evidence.realSongExportVsLiveComparison.modeled_controls, ["Low", "Mid", "High", "Width", "Intensity"]);
  assert.deepEqual(evidence.realSongExportVsLiveComparison.tuning, firstControlLiveTuning);
  assert.equal(evidence.realSongExportVsLiveComparison.same_engine, false);
  assert.equal(evidence.realSongExportVsLiveComparison.preview_parity, "approximate");
  assert.equal(evidence.realSongExportVsLiveComparison.export_faithful_preview_required, true);
  assert.equal(evidence.realSongExportVsLiveComparison.exportDiffersFromLiveMaterially, true);
  assert.ok(evidence.realSongExportVsLiveComparison.exportAndLiveLoudnessDeltaDifference >= 0.5);
  assert.equal(evidence.realSongExportVsLiveComparison.source_path, evidence.playbackCachePath);
  assert.equal(evidence.realSongExportVsLiveComparison.export_path, evidence.firstControlTrackOutputPath);
  assert.equal(existsSync(evidence.realSongExportVsLiveComparison.live_model_path), true);
  assert.equal(Number.isFinite(evidence.realSongExportVsLiveComparison.export_minus_live_lufs_proxy), true);
  assert.equal(Number.isFinite(evidence.realSongExportVsLiveComparison.rms_difference_dbfs), true);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-real-song-performance-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
}

function realSongPerformanceExpression() {
  const title = fileStem(sourcePath);
  return `
(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') throw new Error('Tauri invoke is not available in this WebView');
  const sourcePath = ${JSON.stringify(sourcePath)};
  const renderOutput = ${JSON.stringify(renderOutput)};
  const firstControlRenderOutput = ${JSON.stringify(firstControlRenderOutput)};
  const timed = async (label, action) => {
    const started = performance.now();
    const result = await action();
    return { label, durationMs: Math.round((performance.now() - started) * 10) / 10, result };
  };
  const sourceValidation = await timed('validate_audio_sources_real_song', () => invoke('validate_audio_sources', { paths: [sourcePath] }));
  const analysis = await timed('analyze_real_song', () => invoke('analyze_tracks', { paths: [sourcePath], sampleRate: 48000, waveformBins: 256 }));
  const playbackCache = await timed('prepare_playback_file_real_song', () => invoke('prepare_playback_file', { path: sourcePath }));
  const project = {
    version: 1,
    album_title: ${JSON.stringify(`${title} Real Song Performance Smoke`)},
    metadata: { artist: 'Real Song Fixture' },
    settings: {
      sample_rate: 48000,
      bit_depth: 24,
      output_format: 'wav',
      preset: 'streaming',
      delivery_profile: 'streaming-universal',
      ceiling_dbfs: -1.0,
      album_wav: false,
      codec_preview: false,
      generated_transitions: false,
      default_boundary_style: 'direct',
      default_boundary_duration: 2
    },
    tracks: [{ path: sourcePath, title: ${JSON.stringify(title)}, artist: 'Real Song Fixture', isrc: '', character: 'auto', preset: 'auto' }],
    transitions: []
  };
  const render = await timed('render_track_master_real_song', () => invoke('render_track_master', { project, outputDir: renderOutput }));
  const trackItem = (render.result.manifest.sequence || []).find((item) => item.type === 'track');
  if (!trackItem?.output) throw new Error('Real-song performance smoke did not produce a track output');
  const firstControlProject = JSON.parse(JSON.stringify(project));
  firstControlProject.album_title = ${JSON.stringify(`${title} First-Control Live Comparison`)};
  firstControlProject.settings = {
    ...firstControlProject.settings,
    tweak_low_end_db: 0.5,
    tweak_presence_db: -0.25,
    tweak_air_db: 0.35,
    tweak_width: 0.2,
    tweak_intensity: 0.4
  };
  const firstControlRender = await timed('render_track_master_real_song_first_control', () => invoke('render_track_master', { project: firstControlProject, outputDir: firstControlRenderOutput }));
  const firstControlTrackItem = (firstControlRender.result.manifest.sequence || []).find((item) => item.type === 'track');
  if (!firstControlTrackItem?.output) throw new Error('Real-song first-control render did not produce a track output');
  const exportChecks = await timed('run_export_checks_real_song', () => invoke('run_export_checks', { manifest: render.result.manifest }));
  return JSON.stringify({
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    sourceValidationDurationMs: sourceValidation.durationMs,
    sourceValidationStatus: sourceValidation.result[0]?.status,
    analysisDurationMs: analysis.durationMs,
    analysisCount: analysis.result.length,
    waveformBins: analysis.result[0]?.waveform?.length ?? 0,
    analysisDurationSeconds: analysis.result[0]?.analysis?.duration_seconds ?? 0,
    analysisIntegratedLufs: analysis.result[0]?.analysis?.integrated_lufs ?? null,
    analysisTruePeakDbfs: analysis.result[0]?.analysis?.true_peak_dbfs ?? null,
    playbackCacheDurationMs: playbackCache.durationMs,
    playbackCachePath: playbackCache.result,
    renderDurationMs: render.durationMs,
    renderTrackCount: render.result.manifest.track_count,
    renderInterludeCount: render.result.manifest.interlude_count,
    dashboardPath: render.result.dashboard_path,
    manifestPath: render.result.manifest_path,
    trackOutputPath: trackItem.output,
    firstControlRenderDurationMs: firstControlRender.durationMs,
    firstControlRenderTrackCount: firstControlRender.result.manifest.track_count,
    firstControlRenderInterludeCount: firstControlRender.result.manifest.interlude_count,
    firstControlDashboardPath: firstControlRender.result.dashboard_path,
    firstControlManifestPath: firstControlRender.result.manifest_path,
    firstControlTrackOutputPath: firstControlTrackItem.output,
    firstControlManifestSettings: firstControlRender.result.manifest.settings,
    exportChecksDurationMs: exportChecks.durationMs,
    exportChecks: exportChecks.result
  });
})()
`;
}

function compareExportVsLiveModel({ sourcePath, exportPath, outputPath, tuning }) {
  assert.equal(existsSync(sourcePath), true, `Source path missing for parity comparison: ${sourcePath}`);
  assert.equal(existsSync(exportPath), true, `Export path missing for parity comparison: ${exportPath}`);
  const python = process.env.PYTHON || "python";
  const script = String.raw`
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

source_path, export_path, output_path, tuning_json = sys.argv[1:]
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
    return int(sample_rate), np.nan_to_num(audio[:, :2], nan=0.0, posinf=0.0, neginf=0.0)

def shelf_filter(kind, gain_db, frequency, sample_rate):
    if abs(gain_db) < 1e-9:
        return None
    a_gain = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * frequency / sample_rate
    cosw = math.cos(w0)
    sinw = math.sin(w0)
    sqrt_a = math.sqrt(a_gain)
    alpha = sinw / 2 * math.sqrt(2.0)
    if kind == "low":
        b0 = a_gain * ((a_gain + 1) - (a_gain - 1) * cosw + 2 * sqrt_a * alpha)
        b1 = 2 * a_gain * ((a_gain - 1) - (a_gain + 1) * cosw)
        b2 = a_gain * ((a_gain + 1) - (a_gain - 1) * cosw - 2 * sqrt_a * alpha)
        a0 = (a_gain + 1) + (a_gain - 1) * cosw + 2 * sqrt_a * alpha
        a1 = -2 * ((a_gain - 1) + (a_gain + 1) * cosw)
        a2 = (a_gain + 1) + (a_gain - 1) * cosw - 2 * sqrt_a * alpha
    else:
        b0 = a_gain * ((a_gain + 1) + (a_gain - 1) * cosw + 2 * sqrt_a * alpha)
        b1 = -2 * a_gain * ((a_gain - 1) + (a_gain + 1) * cosw)
        b2 = a_gain * ((a_gain + 1) + (a_gain - 1) * cosw - 2 * sqrt_a * alpha)
        a0 = (a_gain + 1) - (a_gain - 1) * cosw + 2 * sqrt_a * alpha
        a1 = 2 * ((a_gain - 1) - (a_gain + 1) * cosw)
        a2 = (a_gain + 1) - (a_gain - 1) * cosw - 2 * sqrt_a * alpha
    return np.array([b0, b1, b2]) / a0, np.array([1.0, a1 / a0, a2 / a0])

def peaking_filter(gain_db, frequency, q, sample_rate):
    if abs(gain_db) < 1e-9:
        return None
    a_gain = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * frequency / sample_rate
    cosw = math.cos(w0)
    alpha = math.sin(w0) / (2 * q)
    b0 = 1 + alpha * a_gain
    b1 = -2 * cosw
    b2 = 1 - alpha * a_gain
    a0 = 1 + alpha / a_gain
    a1 = -2 * cosw
    a2 = 1 - alpha / a_gain
    return np.array([b0, b1, b2]) / a0, np.array([1.0, a1 / a0, a2 / a0])

def apply_biquad(audio, b, a):
    return np.column_stack([signal.lfilter(b, a, audio[:, channel]) for channel in range(audio.shape[1])]).astype(np.float32)

def apply_width(audio, width_setting):
    width = max(0.35, min(1.65, 1 + float(width_setting) * 1.8))
    mid = (audio[:, 0] + audio[:, 1]) * 0.5
    side = (audio[:, 0] - audio[:, 1]) * 0.5
    return np.column_stack([mid + side * width, mid - side * width]).astype(np.float32), width

def apply_static_compressor(audio, intensity):
    drive = max(0.0, min(1.0, float(intensity)))
    if drive <= 0:
        return audio.astype(np.float32), 0.0
    threshold = -18.0 - drive * 16.0
    ratio = 1.0 + drive * 3.5
    knee = 10.0
    level = np.max(np.abs(audio), axis=1)
    x_db = 20.0 * np.log10(np.maximum(level, 1e-12))
    y_db = np.array(x_db, copy=True)
    lower = threshold - knee / 2.0
    upper = threshold + knee / 2.0
    over = x_db > upper
    knee_zone = (x_db >= lower) & (x_db <= upper)
    y_db[over] = threshold + (x_db[over] - threshold) / ratio
    y_db[knee_zone] = x_db[knee_zone] + (1.0 / ratio - 1.0) * ((x_db[knee_zone] - lower) ** 2) / (2.0 * knee)
    gain = np.power(10.0, (y_db - x_db) / 20.0)
    return (audio * gain[:, None]).astype(np.float32), drive

def rms_dbfs(audio):
    return 20.0 * math.log10(float(np.sqrt(np.mean(np.square(audio))) + 1e-12))

def peak_dbfs(audio):
    return 20.0 * math.log10(float(np.max(np.abs(audio)) + 1e-12))

source_rate, source = read_wav(source_path)
export_rate, exported = read_wav(export_path)
if source_rate != export_rate:
    raise SystemExit(f"Sample-rate mismatch: {source_rate} != {export_rate}")

live = source.copy()
for design in [
    shelf_filter("low", float(tuning.get("bassDb", 0.0)), 160.0, source_rate),
    peaking_filter(float(tuning.get("midDb", 0.0)), 1400.0, 0.9, source_rate),
    shelf_filter("high", float(tuning.get("highDb", 0.0)), 5600.0, source_rate),
]:
    if design is not None:
        live = apply_biquad(live, design[0], design[1])
live, modeled_width = apply_width(live, float(tuning.get("width", 0.0)))
live, modeled_drive = apply_static_compressor(live, float(tuning.get("intensity", 0.0)))
live = np.clip(live, -1.0, 1.0).astype(np.float32)
Path(output_path).parent.mkdir(parents=True, exist_ok=True)
wavfile.write(output_path, source_rate, live)

length = min(source.shape[0], live.shape[0], exported.shape[0])
source = source[:length]
live = live[:length]
exported = exported[:length]
difference = exported - live
print(json.dumps({
    "offline_engine": "python-render-track-master",
    "live_preview_engine": "web-audio-first-control-model",
    "same_engine": False,
    "preview_parity": "approximate",
    "export_faithful_preview_required": True,
    "tuning": tuning,
    "modeled_width": modeled_width,
    "modeled_drive": modeled_drive,
    "modeled_controls": ["Low", "Mid", "High", "Width", "Intensity"],
    "source_path": str(Path(source_path)),
    "export_path": str(Path(export_path)),
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
    "rms_difference_dbfs": rms_dbfs(difference)
}))
`;
  const result = spawnSync(python, ["-c", script, sourcePath, exportPath, outputPath, JSON.stringify(tuning)], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const comparison = JSON.parse(result.stdout);
  const exportLoudnessDeltaVsSource = Math.abs(comparison.export_lufs_proxy - comparison.source_lufs_proxy);
  const liveLoudnessDeltaVsSource = Math.abs(comparison.live_lufs_proxy - comparison.source_lufs_proxy);
  const exportAndLiveLoudnessDeltaDifference = Math.abs(exportLoudnessDeltaVsSource - liveLoudnessDeltaVsSource);
  return {
    ...comparison,
    exportDiffersFromLiveMaterially:
      Math.abs(comparison.export_minus_live_lufs_proxy) >= 1 &&
      comparison.rms_difference_dbfs > -60,
    exportLoudnessDeltaVsSource,
    liveLoudnessDeltaVsSource,
    exportAndLiveLoudnessDeltaDifference,
  };
}

async function waitForPageTarget(timeoutMs = 20_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${cdpBase}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(
          (item) => item.type === "page" && item.webSocketDebuggerUrl && !item.url.startsWith("devtools://"),
        );
        if (target) return target;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Could not find release WebView CDP page at ${cdpBase}: ${lastError || "timed out"}`);
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
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
    socket.onerror = reject;
  });
  return {
    close() {
      socket.close();
    },
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        id += 1;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function waitForCondition(cdp, expression, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.result?.value === true) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for condition: ${expression}`);
}

async function evaluateInWebView(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return JSON.parse(result.result.value);
}

function safeRemove(targetPath) {
  const target = path.resolve(targetPath);
  const allowedRoot = path.resolve(outputRoot);
  assert.equal(target.startsWith(allowedRoot), true, `Refusing to remove path outside output root: ${target}`);
  rmSync(target, { force: true, recursive: true });
}

function fileSummary(filePath) {
  const stats = statSync(filePath);
  return {
    path: filePath,
    size: stats.size,
    modified: stats.mtime.toISOString(),
  };
}

function fileStem(filePath) {
  return path.basename(filePath).replace(/\.[^.]+$/, "") || "Real Song";
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
