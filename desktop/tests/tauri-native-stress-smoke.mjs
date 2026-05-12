import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const outputRoot = process.env.AMS_TAURI_NATIVE_STRESS_OUTPUT || path.join(repoRoot, "test-output", "tauri-native-stress-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const cdpPort = process.env.TAURI_CDP_PORT || "9222";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const stressTotalMs = Number(process.env.AMS_NATIVE_STRESS_MS || 8000);
const sampleIntervalMs = 500;

mkdirSync(inputsDir, { recursive: true });
writeFixtures(inputsDir);

const target = await findTauriPageTarget();
const cdp = await connectCdp(target.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");

const tauriPid = findTauriProcessId();
const trackA = path.join(inputsDir, "01_native_stress_fixture.wav");
const trackOutput = path.join(outputRoot, "track-master");
const resourceSamples = [];
let finalStatus = null;

try {
  const prepared = await evaluateInWebView(cdp, buildPrepareExpression({
    path: trackA,
    trackOutput,
  }));
  assert.equal(existsSync(prepared.sourcePlaybackPath), true);
  assert.equal(existsSync(prepared.masterPlaybackPath), true);

  const started = await evaluateInWebView(cdp, buildStartExpression({
    masterPath: prepared.masterPlaybackPath,
    sourcePath: prepared.sourcePlaybackPath,
    totalDurationMs: stressTotalMs,
  }));
  assert.equal(started.active, true);
  assert.ok(started.queued_output_frames > 0);

  const startedAt = Date.now();
  while (Date.now() - startedAt < stressTotalMs + 5000) {
    resourceSamples.push(sampleProcess(tauriPid));
    const status = await evaluateInWebView(cdp, "window.__TAURI_INTERNALS__.invoke('native_playback_status').then((status) => JSON.stringify(status))");
    finalStatus = status;
    if (!status.active) break;
    await sleep(sampleIntervalMs);
  }
  if (finalStatus?.active) {
    finalStatus = await evaluateInWebView(cdp, "window.__TAURI_INTERNALS__.invoke('stop_native_playback').then((status) => JSON.stringify(status))");
  }

  const evidence = {
    ...prepared,
    finalStatus,
    resourceSamples,
    stressTotalMs,
    tauriPid,
  };

  assert.equal(finalStatus.active, false);
  assert.ok(finalStatus.queued_output_frames > 0);
  assert.ok(finalStatus.played_output_frames >= Math.floor(finalStatus.queued_output_frames * 0.95));
  assert.ok(finalStatus.callback_count >= Math.floor(stressTotalMs / 20));
  assert.equal(Array.isArray(finalStatus.stream_errors), true);
  assert.equal(finalStatus.stream_errors.length, 0);
  assert.equal(Array.isArray(finalStatus.warnings), true);
  assert.equal(finalStatus.warnings.length, 0);
  assert.ok(resourceSamples.length >= 3);
  assert.ok(resourceSamples.every((sample) => sample && typeof sample.workingSetBytes === "number"));

  const resultPath = path.join(outputRoot, "tauri-native-stress-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  await evaluateInWebView(cdp, "window.__TAURI_INTERNALS__.invoke('stop_native_playback').then((status) => JSON.stringify(status)).catch(() => JSON.stringify({ active: false }))")
    .catch(() => undefined);
  cdp.close();
}

function writeFixtures(targetDir) {
  const python = process.env.ALBUM_MASTER_PYTHON || "python";
  const script = `
from pathlib import Path
import numpy as np
from scipy.io import wavfile
root = Path(r"${targetDir.replaceAll("\\", "\\\\")}")
root.mkdir(parents=True, exist_ok=True)
sr = 48000
seconds = 3.0
t = np.linspace(0, seconds, int(sr * seconds), endpoint=False)
fade = np.minimum(1.0, np.linspace(0, 1, t.size) * 14) * np.minimum(1.0, np.linspace(1, 0, t.size) * 14)
tone = (np.sin(2*np.pi*174.61*t) * 0.18 + np.sin(2*np.pi*261.63*t) * 0.08) * fade
wavfile.write(root / "01_native_stress_fixture.wav", sr, np.column_stack([tone, tone * 0.93]).astype(np.float32))
`;
  const result = spawnSync(python, ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
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

function buildPrepareExpression({ path: sourcePath, trackOutput }) {
  return `
(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') throw new Error('Tauri invoke is not available in this WebView');
  const sourcePath = ${JSON.stringify(sourcePath)};
  const outputDir = ${JSON.stringify(trackOutput)};
  const analysis = await invoke('analyze_tracks', { paths: [sourcePath], sampleRate: 48000, waveformBins: 64 });
  const project = {
    version: 1,
    album_title: 'Native Stress Track Master',
    metadata: { artist: 'Codex Fixture' },
    settings: {
      sample_rate: 48000,
      preset: 'streaming',
      output_format: 'wav',
      bit_depth: 24,
      delivery_profile: 'streaming-universal',
      codec_preview: false,
      target_lufs: -14,
      ceiling_dbfs: -1,
      reference_track: null,
      default_interlude_duration: 0,
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
    },
    tracks: [{ path: sourcePath, title: 'Native Stress Fixture', artist: '', isrc: '', character: 'auto', preset: 'auto' }],
    transitions: []
  };
  const result = await invoke('render_track_master', { project, outputDir });
  const trackItem = (result.manifest.sequence || []).find((item) => item.type === 'track');
  if (!trackItem?.output) throw new Error('Native stress render did not produce a track output');
  const sourcePlaybackPath = await invoke('prepare_playback_file', { path: sourcePath });
  const masterPlaybackPath = await invoke('prepare_playback_file', { path: trackItem.output });
  return JSON.stringify({
    analysisCount: analysis.length,
    sourcePlaybackPath,
    masterPlaybackPath,
    masterOutput: trackItem.output,
    manifestPath: result.manifest_path,
    dashboardPath: result.dashboard_path
  });
})()
`;
}

function buildStartExpression({ sourcePath, masterPath, totalDurationMs }) {
  return `
window.__TAURI_INTERNALS__.invoke('start_native_ab_loop_playback', {
  sourcePath: ${JSON.stringify(sourcePath)},
  masterPath: ${JSON.stringify(masterPath)},
  startSeconds: 0,
  regionDurationMs: 500,
  totalDurationMs: ${totalDurationMs}
}).then((status) => JSON.stringify(status))
`;
}

function findTauriProcessId() {
  const command = `
$process = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'album-mastering-studio.exe' } |
  Sort-Object CreationDate -Descending |
  Select-Object -First 1
if (-not $process) { throw 'album-mastering-studio.exe process not found' }
$process.ProcessId
`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return Number(result.stdout.trim());
}

function sampleProcess(pid) {
  const command = `
$p = Get-Process -Id ${pid} -ErrorAction Stop
[pscustomobject]@{
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
  id = $p.Id
  cpuSeconds = $p.CPU
  workingSetBytes = $p.WorkingSet64
  privateMemoryBytes = $p.PrivateMemorySize64
  handleCount = $p.HandleCount
} | ConvertTo-Json -Compress
`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
