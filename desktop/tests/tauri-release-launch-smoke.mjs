import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const releaseExe =
  process.env.AMS_TAURI_RELEASE_EXE ||
  path.join(repoRoot, "desktop", "src-tauri", "target", "release", "album-mastering-studio.exe");
const outputRoot =
  process.env.AMS_TAURI_RELEASE_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-release-launch-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const fixturePath = path.join(inputsDir, "01_release_fixture.wav");
const corruptPath = path.join(inputsDir, "02_corrupt_fixture.mp3");
const missingPath = path.join(inputsDir, "03_missing_fixture.wav");
const renderOutput = path.join(outputRoot, "track-master");
const cdpPort = process.env.TAURI_CDP_PORT || "9341";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const statePath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "recent-session.json");
const stateBackup = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;

assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
mkdirSync(inputsDir, { recursive: true });
writePcm16Fixture(fixturePath);
writeFileSync(corruptPath, "this is not a readable audio file");
rmSync(missingPath, { force: true });

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
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitForCondition(cdp, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'", 15000);

  const smoke = await evaluateInWebView(cdp, releaseSmokeExpression());
  await evaluateInWebView(cdp, seedSourceRepairSessionExpression());
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForCondition(cdp, "document.body.innerText.includes('Release Corrupt Source')", 15000);
  const sourceRepairUi = await evaluateInWebView(cdp, sourceRepairUiExpression());
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-release-launch.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...smoke,
    sourceRepairUi,
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    targetTitle: target.title,
    targetUrl: target.url,
    trackDashboardExists: existsSync(smoke.trackDashboardPath),
    trackManifestExists: existsSync(smoke.trackManifestPath),
    trackOutputExists: existsSync(smoke.trackOutput),
  };

  assert.equal(evidence.releaseExeExists, true);
  assert.equal(evidence.appTextIncludesBrand, true);
  assert.equal(evidence.analysisCount, 1);
  assert.deepEqual(evidence.waveformBins, [32]);
  assert.deepEqual(evidence.sourceValidationStatuses, ["ok", "missing", "unreadable"]);
  assert.match(evidence.missingOpenPathError, /Cannot open missing path/);
  assert.equal(evidence.sourceRepairUi.visibleBefore, true);
  assert.equal(evidence.sourceRepairUi.countBefore, 1);
  assert.match(evidence.sourceRepairUi.statusText, /Unreadable source/);
  assert.equal(evidence.sourceRepairUi.countAfterRemove, 0);
  assert.equal(evidence.trackCount, 1);
  assert.equal(evidence.trackManifestExists, true);
  assert.equal(evidence.trackDashboardExists, true);
  assert.equal(evidence.trackOutputExists, true);
  assert.ok(["pass", "warn"].includes(evidence.exportChecks.status));
  assert.equal(evidence.exportChecks.track_count, 1);
  assert.equal(evidence.exportChecks.interlude_count, 0);
  assert.equal(typeof evidence.nativeAudio.host, "string");
  assert.equal(Array.isArray(evidence.nativeAudio.available_hosts), true);
  assert.equal(Array.isArray(evidence.nativeAudio.warnings), true);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-release-launch-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
  restoreStateFile();
}

function restoreStateFile() {
  mkdirSync(path.dirname(statePath), { recursive: true });
  if (stateBackup == null) {
    rmSync(statePath, { force: true });
  } else {
    writeFileSync(statePath, stateBackup);
  }
}

function writePcm16Fixture(targetPath) {
  const sampleRate = 48_000;
  const seconds = 1.4;
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
    const left = Math.sin(2 * Math.PI * 220 * t) * 0.22 * envelope;
    const right = Math.sin(2 * Math.PI * 277.18 * t) * 0.2 * envelope;
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

function releaseSmokeExpression() {
  return `
(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') throw new Error('Tauri invoke is not available in this WebView');
  const paths = ${JSON.stringify([fixturePath])};
  const sourceHealthPaths = ${JSON.stringify([fixturePath, missingPath, corruptPath])};
  const nativeAudio = await invoke('native_audio_probe');
  const sourceValidation = await invoke('validate_audio_sources', { paths: sourceHealthPaths });
  let missingOpenPathError = '';
  try {
    await invoke('open_path', { path: ${JSON.stringify(missingPath)} });
  } catch (error) {
    missingOpenPathError = String(error);
  }
  const analysis = await invoke('analyze_tracks', { paths, sampleRate: 48000, waveformBins: 32 });
  const project = {
    version: 1,
    album_title: 'Tauri Release Launch Smoke',
    metadata: { artist: 'Codex Fixture' },
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
    tracks: [{ path: paths[0], title: 'Release Fixture A', artist: '', isrc: '', character: 'auto', preset: 'auto' }],
    transitions: []
  };
  const render = await invoke('render_track_master', { project, outputDir: ${JSON.stringify(renderOutput)} });
  const trackItem = (render.manifest.sequence || []).find((item) => item.type === 'track');
  if (!trackItem?.output) throw new Error('Release smoke did not produce a track output');
  const exportChecks = await invoke('run_export_checks', { manifest: render.manifest });
  return JSON.stringify({
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    sourceValidation,
    sourceValidationStatuses: sourceValidation.map((row) => row.status),
    missingOpenPathError,
    analysisCount: analysis.length,
    waveformBins: analysis.map((row) => row.waveform.length),
    nativeAudio,
    trackProjectPath: render.project_path,
    trackManifestPath: render.manifest_path,
    trackDashboardPath: render.dashboard_path,
    trackCount: render.manifest.track_count,
    trackOutput: trackItem.output,
    exportChecks
  });
})()
`;
}

function seedSourceRepairSessionExpression() {
  const waveform = Array.from({ length: 96 }, (_, index) => Math.abs(Math.sin(index / 5)) * 0.8 + 0.1);
  const session = {
    version: 2,
    savedAt: new Date().toISOString(),
    mode: "track",
    settings: {
      albumTitle: "Release Source Repair Smoke",
      artist: "Codex Fixture",
      albumArtist: "",
      genre: "",
      year: "",
      upc: "",
      outputDir: outputRoot,
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
      codecPreview: false,
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
    },
    tracks: [
      {
        id: "release-repair-good",
        path: fixturePath,
        title: "Release Repair Good",
        artist: "Codex Fixture",
        isrc: "",
        character: "auto",
        preset: "auto",
        analysis: {
          duration_seconds: 84,
          integrated_lufs: -16.8,
          true_peak_dbfs: -2.7,
          loudness_range_lu_proxy: 6.1,
          spectral_centroid_hz: 2100,
          stereo_width: 0.4,
          transient_density: 0.32,
        },
        waveform,
      },
      {
        id: "release-repair-corrupt",
        path: corruptPath,
        title: "Release Corrupt Source",
        artist: "Codex Fixture",
        isrc: "",
        character: "auto",
        preset: "auto",
        sourceStatus: {
          path: corruptPath,
          exists: true,
          supported: true,
          is_directory: false,
          status: "unreadable",
          detail: "FFprobe could not read this audio source. The file may be corrupt or use an unsupported codec.",
          diagnostic: "Seeded release source repair fixture.",
        },
      },
    ],
    selectedTrackId: "release-repair-good",
    projectPath: "",
    region: null,
    waveformZoom: 1,
    advancedOpen: false,
    volumeMatch: false,
    liveAudition: false,
    loopSelection: false,
  };
  return `
(async () => {
  await window.__TAURI_INTERNALS__.invoke('autosave_session', { session: ${JSON.stringify(session)} });
  return JSON.stringify({ seeded: true });
})()
`;
}

function sourceRepairUiExpression() {
  return `
(async () => {
  const text = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
  const click = (element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const panel = document.querySelector('.source-repair-panel');
  if (!panel) throw new Error('Source repair panel not found');
  const visibleBefore = !!panel;
  const countBefore = panel.querySelectorAll('.source-issue-row').length;
  const statusText = text(panel.querySelector('.source-status'));
  const removeButton = Array.from(panel.querySelectorAll('.source-issue-actions button')).find((button) => text(button).includes('Remove'));
  if (!removeButton) throw new Error('Source repair remove button not found');
  click(removeButton);
  await nextFrame();
  return JSON.stringify({
    visibleBefore,
    countBefore,
    statusText,
    countAfterRemove: document.querySelectorAll('.source-issue-row').length,
    trackCountAfterRemove: document.querySelectorAll('.track-row').length
  });
})()
`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
