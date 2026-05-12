import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const releaseExe =
  process.env.AMS_TAURI_RELEASE_EXE ||
  path.join(repoRoot, "desktop", "src-tauri", "target", "release", "album-mastering-studio.exe");
const sourcePath = process.env.AMS_REAL_SONG_PATH;
const outputRoot =
  process.env.AMS_TAURI_REAL_SONG_REGION_PREVIEW_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-real-song-region-preview-smoke");
const renderOutput = path.join(outputRoot, "region-preview-real-song");
const cdpPort = process.env.TAURI_CDP_PORT || "9354";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const requestedRegionSeconds = Number(process.env.AMS_REAL_SONG_REGION_SECONDS || 12);

assert.ok(sourcePath, "Set AMS_REAL_SONG_PATH to a local audio file for this smoke.");
assert.equal(existsSync(sourcePath), true, `Real-song fixture does not exist: ${sourcePath}`);
assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
safeRemove(renderOutput);
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

  const smoke = await evaluateInWebView(cdp, realSongRegionPreviewExpression());
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-real-song-region-preview.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...smoke,
    launchToTargetMs: roundMs(launchToTargetMs),
    launchToInvokeReadyMs: roundMs(launchToInvokeReadyMs),
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    source: fileSummary(sourcePath),
    regionSourceExists: existsSync(smoke.regionSourcePath),
    regionMasterExists: existsSync(smoke.regionMasterPath),
    playbackCacheExists: existsSync(smoke.playbackCachePath),
    manifestExists: existsSync(smoke.manifestPath),
    dashboardExists: existsSync(smoke.dashboardPath),
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    targetTitle: target.title,
    targetUrl: target.url,
  };

  assert.equal(evidence.releaseExeExists, true);
  assert.equal(evidence.appTextIncludesBrand, true);
  assert.ok(evidence.launchToInvokeReadyMs < 30_000, `Release launch took ${evidence.launchToInvokeReadyMs}ms`);
  assert.equal(evidence.sourceValidationStatus, "ok");
  assert.equal(evidence.analysisCount, 1);
  assert.equal(evidence.waveformBins, 256);
  assert.ok(evidence.analysisDurationSeconds > evidence.regionDurationSeconds);
  assert.ok(evidence.regionStartSeconds >= 0);
  assert.ok(evidence.regionDurationSeconds > 0);
  assert.ok(evidence.regionDurationSeconds <= Math.min(Math.max(requestedRegionSeconds, 0.25), 60) + 0.25);
  assert.equal(evidence.regionSourceExists, true);
  assert.equal(evidence.regionMasterExists, true);
  assert.equal(evidence.playbackCacheExists, true);
  assert.equal(evidence.manifestExists, true);
  assert.equal(evidence.dashboardExists, true);
  assert.notEqual(evidence.regionSourcePath, sourcePath);
  assert.match(evidence.regionSourcePath, /region-source\.wav$/);
  assert.equal(evidence.renderTrackCount, 1);
  assert.equal(evidence.renderInterludeCount, 0);
  assert.ok(evidence.regionRenderedDurationSeconds <= evidence.regionDurationSeconds + 0.5);
  assert.ok(evidence.regionRenderedDurationSeconds >= Math.max(0.25, evidence.regionDurationSeconds - 0.5));
  assert.equal(evidence.regionEngine, "python-render-track-region-preview");
  assert.equal(evidence.exportChecks.track_count, 1);
  assert.ok(["pass", "warn"].includes(evidence.exportChecks.status));
  assert.equal(evidence.nativePlaybackProbe.stream_errors.length, 0);
  assert.equal(Array.isArray(evidence.nativePlaybackProbe.warnings), true);
  assert.ok(evidence.nativePlaybackProbe.played_output_frames > 0);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-real-song-region-preview-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
}

function realSongRegionPreviewExpression() {
  const title = fileStem(sourcePath);
  return `
(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') throw new Error('Tauri invoke is not available in this WebView');
  const sourcePath = ${JSON.stringify(sourcePath)};
  const renderOutput = ${JSON.stringify(renderOutput)};
  const requestedRegionSeconds = ${JSON.stringify(requestedRegionSeconds)};
  const timed = async (label, action) => {
    const started = performance.now();
    const result = await action();
    return { label, durationMs: Math.round((performance.now() - started) * 10) / 10, result };
  };
  const sourceValidation = await timed('validate_audio_sources_real_song_region', () => invoke('validate_audio_sources', { paths: [sourcePath] }));
  const analysis = await timed('analyze_real_song_region', () => invoke('analyze_tracks', { paths: [sourcePath], sampleRate: 48000, waveformBins: 256 }));
  const analysisRow = analysis.result[0];
  const sourceDuration = analysisRow?.analysis?.duration_seconds || 0;
  if (!sourceDuration) throw new Error('Real-song region smoke could not read source duration');
  const startSeconds = Math.min(Math.max(5, sourceDuration * 0.35), Math.max(sourceDuration - 1, 0));
  const durationSeconds = Math.max(0.25, Math.min(requestedRegionSeconds, 60, sourceDuration - startSeconds));
  const project = {
    version: 1,
    album_title: ${JSON.stringify(`${title} Real Song Region Preview Smoke`)},
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
      default_boundary_duration: 0
    },
    tracks: [{ path: sourcePath, title: ${JSON.stringify(title)}, artist: 'Real Song Fixture', isrc: '', character: 'auto', preset: 'auto' }],
    transitions: []
  };
  const render = await timed('render_track_region_preview_real_song', () => invoke('render_track_region_preview', {
    project,
    outputDir: renderOutput,
    startSeconds,
    durationSeconds
  }));
  const manifest = render.result.manifest;
  const trackItem = (manifest.sequence || []).find((item) => item.type === 'track');
  if (!trackItem?.output) throw new Error('Region preview smoke did not produce a rendered master');
  const exportChecks = await timed('run_export_checks_real_song_region', () => invoke('run_export_checks', { manifest }));
  const playbackCache = await timed('prepare_playback_file_real_song_region', () => invoke('prepare_playback_file', { path: trackItem.output }));
  const probeDurationMs = Math.round(Math.min(3000, Math.max(500, durationSeconds * 1000)));
  const nativePlaybackProbe = await timed('native_playback_file_probe_real_song_region', () => invoke('native_playback_file_probe', {
    path: playbackCache.result,
    durationMs: probeDurationMs,
    startSeconds: 0
  }));
  return JSON.stringify({
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    sourceValidationDurationMs: sourceValidation.durationMs,
    sourceValidationStatus: sourceValidation.result[0]?.status,
    analysisDurationMs: analysis.durationMs,
    analysisCount: analysis.result.length,
    waveformBins: analysisRow?.waveform?.length ?? 0,
    analysisDurationSeconds: sourceDuration,
    analysisIntegratedLufs: analysisRow?.analysis?.integrated_lufs ?? null,
    analysisTruePeakDbfs: analysisRow?.analysis?.true_peak_dbfs ?? null,
    regionStartSeconds: startSeconds,
    regionDurationSeconds: durationSeconds,
    regionEngine: 'python-render-track-region-preview',
    renderDurationMs: render.durationMs,
    renderTrackCount: manifest.track_count,
    renderInterludeCount: manifest.interlude_count,
    regionSourcePath: trackItem.source,
    regionMasterPath: trackItem.output,
    regionRenderedDurationSeconds: trackItem.after?.duration_seconds ?? null,
    manifestPath: render.result.manifest_path,
    dashboardPath: render.result.dashboard_path,
    exportChecksDurationMs: exportChecks.durationMs,
    exportChecks: exportChecks.result,
    playbackCacheDurationMs: playbackCache.durationMs,
    playbackCachePath: playbackCache.result,
    nativePlaybackProbeDurationMs: nativePlaybackProbe.durationMs,
    nativePlaybackProbe: nativePlaybackProbe.result
  });
})()
`;
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

function safeRemove(target) {
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}

function fileSummary(target) {
  const stats = statSync(target);
  return { path: target, size: stats.size, modified: stats.mtime.toISOString() };
}

function fileStem(target) {
  return path.basename(target).replace(/\.[^.]+$/, "");
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
