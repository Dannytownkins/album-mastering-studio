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
  process.env.AMS_TAURI_REAL_SONG_PERFORMANCE_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-real-song-performance-smoke");
const renderOutput = path.join(outputRoot, "track-master-real-song");
const cdpPort = process.env.TAURI_CDP_PORT || "9345";
const cdpBase = `http://127.0.0.1:${cdpPort}`;

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

  const smoke = await evaluateInWebView(cdp, realSongPerformanceExpression());
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-real-song-performance.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...smoke,
    launchToTargetMs: roundMs(launchToTargetMs),
    launchToInvokeReadyMs: roundMs(launchToInvokeReadyMs),
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
  assert.ok(["pass", "warn"].includes(evidence.exportChecks.status));
  assert.equal(evidence.exportChecks.track_count, 1);
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
    exportChecksDurationMs: exportChecks.durationMs,
    exportChecks: exportChecks.result
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
