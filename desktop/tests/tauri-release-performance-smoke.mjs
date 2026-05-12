import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const releaseExe =
  process.env.AMS_TAURI_RELEASE_EXE ||
  path.join(repoRoot, "desktop", "src-tauri", "target", "release", "album-mastering-studio.exe");
const outputRoot =
  process.env.AMS_TAURI_PERFORMANCE_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-release-performance-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const renderOutput = path.join(outputRoot, "album-master-performance");
const cdpPort = process.env.TAURI_CDP_PORT || "9344";
const cdpBase = `http://127.0.0.1:${cdpPort}`;

assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
safeRemove(renderOutput);
mkdirSync(inputsDir, { recursive: true });
const fixturePaths = writePerformanceFixtures(inputsDir, 8);

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

  const smoke = await evaluateInWebView(cdp, performanceSmokeExpression());
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-release-performance.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...smoke,
    launchToTargetMs: roundMs(launchToTargetMs),
    launchToInvokeReadyMs: roundMs(launchToInvokeReadyMs),
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    targetTitle: target.title,
    targetUrl: target.url,
    albumSequenceExists: existsSync(smoke.albumSequencePath),
    dashboardExists: existsSync(smoke.dashboardPath),
    manifestExists: existsSync(smoke.manifestPath),
  };

  assert.equal(evidence.releaseExeExists, true);
  assert.equal(evidence.appTextIncludesBrand, true);
  assert.ok(evidence.launchToInvokeReadyMs < 30_000, `Release launch took ${evidence.launchToInvokeReadyMs}ms`);
  assert.equal(evidence.sourceValidationCount, 8);
  assert.equal(evidence.sourceValidationStatuses.every((status) => status === "ok"), true);
  assert.equal(evidence.analysisCount, 8);
  assert.equal(evidence.waveformBins.every((count) => count === 128), true);
  assert.equal(evidence.renderTrackCount, 8);
  assert.equal(evidence.renderInterludeCount, 0);
  assert.equal(evidence.albumSequenceExists, true);
  assert.equal(evidence.dashboardExists, true);
  assert.equal(evidence.manifestExists, true);
  assert.ok(["pass", "warn"].includes(evidence.exportChecks.status));
  assert.equal(evidence.exportChecks.track_count, 8);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-release-performance-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
}

function performanceSmokeExpression() {
  return `
(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') throw new Error('Tauri invoke is not available in this WebView');
  const paths = ${JSON.stringify(fixturePaths)};
  const renderOutput = ${JSON.stringify(renderOutput)};
  const timed = async (label, action) => {
    const started = performance.now();
    const result = await action();
    return { label, durationMs: Math.round((performance.now() - started) * 10) / 10, result };
  };
  const nativeAudio = await timed('native_audio_probe', () => invoke('native_audio_probe'));
  const sourceValidation = await timed('validate_audio_sources', () => invoke('validate_audio_sources', { paths }));
  const analysis = await timed('analyze_tracks_8', () => invoke('analyze_tracks', { paths, sampleRate: 48000, waveformBins: 128 }));
  const project = {
    version: 1,
    album_title: 'Tauri Release Performance Smoke',
    metadata: { artist: 'Codex Fixture' },
    settings: {
      sample_rate: 48000,
      bit_depth: 24,
      output_format: 'wav',
      preset: 'streaming',
      delivery_profile: 'streaming-universal',
      ceiling_dbfs: -1.0,
      album_wav: true,
      codec_preview: false,
      generated_transitions: false,
      default_boundary_style: 'direct',
      default_boundary_duration: 0
    },
    tracks: paths.map((source, index) => ({
      path: source,
      title: 'Performance Fixture ' + String(index + 1).padStart(2, '0'),
      artist: 'Codex Fixture',
      isrc: '',
      character: 'auto',
      preset: 'auto'
    })),
    transitions: paths.slice(0, -1).map((_, index) => ({
      after_track: index + 1,
      duration_seconds: 0,
      style: 'inherit',
      enabled: false,
      boundary_style: 'direct',
      boundary_duration_seconds: 0
    }))
  };
  const render = await timed('render_album_master_8', () => invoke('render_album_master', { project, outputDir: renderOutput }));
  const exportChecks = await timed('run_export_checks', () => invoke('run_export_checks', { manifest: render.result.manifest }));
  return JSON.stringify({
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    nativeAudioDurationMs: nativeAudio.durationMs,
    nativeAudioHost: nativeAudio.result.host,
    sourceValidationDurationMs: sourceValidation.durationMs,
    sourceValidationCount: sourceValidation.result.length,
    sourceValidationStatuses: sourceValidation.result.map((row) => row.status),
    analysisDurationMs: analysis.durationMs,
    analysisCount: analysis.result.length,
    waveformBins: analysis.result.map((row) => row.waveform.length),
    renderDurationMs: render.durationMs,
    renderTrackCount: render.result.manifest.track_count,
    renderInterludeCount: render.result.manifest.interlude_count,
    albumSequencePath: render.result.manifest.album_sequence || render.result.manifest.outputs?.album_sequence || '',
    dashboardPath: render.result.dashboard_path,
    manifestPath: render.result.manifest_path,
    exportChecksDurationMs: exportChecks.durationMs,
    exportChecks: exportChecks.result
  });
})()
`;
}

function writePerformanceFixtures(targetDir, count) {
  return Array.from({ length: count }, (_, index) => {
    const targetPath = path.join(targetDir, `${String(index + 1).padStart(2, "0")}_performance_fixture.wav`);
    writePcm16Fixture(targetPath, 164.81 + index * 27.5, 1.15 + index * 0.015);
    return targetPath;
  });
}

function writePcm16Fixture(targetPath, frequency, seconds) {
  const sampleRate = 48_000;
  const frameCount = Math.floor(sampleRate * seconds);
  const channelCount = 2;
  const bytesPerSample = 2;
  const dataSize = frameCount * channelCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const t = frame / sampleRate;
    const fadeIn = Math.min(1, frame / (sampleRate * 0.04));
    const fadeOut = Math.min(1, (frameCount - frame) / (sampleRate * 0.04));
    const envelope = fadeIn * fadeOut;
    const left = Math.sin(2 * Math.PI * frequency * t) * 0.18 * envelope;
    const right = Math.sin(2 * Math.PI * (frequency * 1.498) * t) * 0.16 * envelope;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left * 32767))), 44 + frame * 4);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right * 32767))), 44 + frame * 4 + 2);
  }

  writeFileSync(targetPath, buffer);
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

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
