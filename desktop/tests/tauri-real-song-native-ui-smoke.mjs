import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const outputRoot = process.env.AMS_TAURI_REAL_SONG_OUTPUT || path.join(repoRoot, "test-output", "tauri-real-song-native-ui-smoke");
const sourcePath = process.env.AMS_REAL_SONG_PATH;
const cdpPort = process.env.TAURI_CDP_PORT || "9222";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const statePath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "recent-session.json");
const stateBackup = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;

assert.ok(sourcePath, "Set AMS_REAL_SONG_PATH to a local audio file for this smoke.");
assert.equal(existsSync(sourcePath), true, `Real-song fixture does not exist: ${sourcePath}`);
mkdirSync(outputRoot, { recursive: true });

const target = await findTauriPageTarget();
const cdp = await connectCdp(target.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");
await cdp.send("Page.enable");
await waitForCondition(cdp, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'", 15000);

try {
  const seeded = await seedRealSongSession(cdp);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForCondition(cdp, `document.body.innerText.includes(${JSON.stringify(seeded.title)})`, 15000);

  const smoke = await evaluateInWebView(cdp, realSongNativeUiExpression(seeded.title));
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-real-song-native-ui.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...seeded,
    ...smoke,
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
  };

  assert.equal(evidence.initialMode, "Track Master");
  assert.equal(evidence.trackVisible, true);
  assert.equal(evidence.nativeButtonEnabled, true);
  assert.equal(evidence.nativeStarted, true);
  assert.equal(evidence.nativePlaybackEvidence?.kind, "native-ab-loop");
  assert.equal(evidence.nativePlaybackEvidence?.active, true);
  assert.equal(Number.isFinite(evidence.nativePlaybackEvidence?.invoke_elapsed_ms), true);
  assert.equal(Number.isFinite(evidence.nativePlaybackEvidence?.prepare_client_elapsed_ms), true);
  assert.equal(typeof evidence.nativePlaybackEvidence?.source_cache_hit, "boolean");
  assert.equal(typeof evidence.nativePlaybackEvidence?.master_cache_hit, "boolean");
  assert.equal(evidence.pauseButtonEnabled, true);
  assert.equal(evidence.pausedStatus.active, true);
  assert.equal(evidence.pausedStatus.paused, true);
  assert.equal(evidence.seekSliderVisible, true);
  assert.ok(Math.abs(evidence.seekedStatus.position_seconds - evidence.seekTargetSeconds) <= 0.08);
  assert.equal(evidence.resumedStatus.active, true);
  assert.equal(evidence.resumedStatus.paused, false);
  assert.equal(evidence.runningStatus.active, true);
  assert.equal(evidence.runningStatus.paused, false);
  assert.ok(evidence.runningStatus.played_output_frames > 0);
  assert.equal(evidence.stoppedStatus.active, false);
  assert.equal(Array.isArray(evidence.stoppedStatus.stream_errors), true);
  assert.equal(evidence.stoppedStatus.stream_errors.length, 0);
  assert.equal(Array.isArray(evidence.stoppedStatus.warnings), true);
  assert.equal(evidence.stoppedStatus.warnings.length, 0);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-real-song-native-ui-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  await evaluateInWebView(cdp, "window.__TAURI_INTERNALS__.invoke('stop_native_playback').then((status) => JSON.stringify(status)).catch(() => JSON.stringify({ active: false }))")
    .catch(() => undefined);
  await sleep(1000);
  restoreAutosave();
  cdp.close();
}

async function seedRealSongSession(cdp) {
  const title = fileStem(sourcePath);
  const analysisRows = await evaluateInWebView(
    cdp,
    `(async () => {
      const rows = await window.__TAURI_INTERNALS__.invoke('analyze_tracks', {
        paths: [${JSON.stringify(sourcePath)}],
        sampleRate: 48000,
        waveformBins: 256
      });
      return JSON.stringify(rows);
    })()`,
  );
  assert.equal(analysisRows.length, 1);
  const row = analysisRows[0];
  const duration = row.analysis?.duration_seconds || 0;
  const regionEnd = duration > 0 ? Math.min(0.12, 5 / duration) : 0.03;
  const session = {
    version: 2,
    savedAt: new Date().toISOString(),
    mode: "track",
    settings: {
      albumTitle: `${title} Native A/B UI Smoke`,
      artist: "Real Song Fixture",
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
        id: "real-song-native-ui",
        path: sourcePath,
        title,
        artist: "Real Song Fixture",
        isrc: "",
        character: "auto",
        preset: "auto",
        analysis: row.analysis,
        waveform: row.waveform,
      },
    ],
    selectedTrackId: "real-song-native-ui",
    projectPath: "",
    region: { start: 0, end: Math.max(regionEnd, 0.01) },
    waveformZoom: 1,
    advancedOpen: false,
    volumeMatch: false,
    liveAudition: false,
    loopSelection: false,
  };
  await evaluateInWebView(
    cdp,
    `(async () => {
      await window.__TAURI_INTERNALS__.invoke('autosave_session', { session: ${JSON.stringify(session)} });
      return JSON.stringify({ seeded: true });
    })()`,
  );
  return {
    analysis: row.analysis,
    sourcePath,
    title,
    waveformBins: row.waveform?.length ?? 0,
  };
}

function restoreAutosave() {
  mkdirSync(path.dirname(statePath), { recursive: true });
  if (stateBackup == null) {
    rmSync(statePath, { force: true });
  } else {
    writeFileSync(statePath, stateBackup);
  }
}

function realSongNativeUiExpression(title) {
  return `
(async () => {
  const text = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
  const buttons = () => Array.from(document.querySelectorAll('button'));
  const buttonByText = (label) => {
    const button = buttons().find((item) => text(item).includes(label));
    if (!button) throw new Error('Button not found: ' + label);
    return button;
  };
  const click = (element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const waitFor = async (predicate, timeoutMs) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  };
  const initialMode = text(document.querySelector('.mode-tabs button.active'));
  const trackVisible = document.body.innerText.includes(${JSON.stringify(title)});
  const nativeButton = buttonByText('Native A/B');
  const nativeButtonEnabled = !nativeButton.disabled;
  click(nativeButton);
  const nativeStarted = await waitFor(() => text(document.querySelector('.native-audition-status')).startsWith('Native A/B '), 180000);
  if (!nativeStarted) throw new Error('Native A/B did not start from the visible UI button');
  await new Promise((resolve) => setTimeout(resolve, 650));
  const nativeStatusTextAfterStart = text(document.querySelector('.native-audition-status'));
  const nativePlaybackEvidence = window.__AMS_NATIVE_PLAYBACK_EVIDENCE__ || null;
  const pauseButton = buttonByText('Pause');
  const pauseButtonEnabled = !pauseButton.disabled;
  click(pauseButton);
  const nativePaused = await waitFor(async () => (await window.__TAURI_INTERNALS__.invoke('native_playback_status')).paused, 10000);
  if (!nativePaused) throw new Error('Native A/B did not pause from the visible UI button');
  const pausedStatus = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
  const seekSlider = document.querySelector('input[aria-label="Native playback position"]');
  const seekSliderVisible = !!seekSlider;
  if (!seekSlider) throw new Error('Native playback position slider not found');
  const seekTargetSeconds = Math.max(0.1, Math.min(0.6, (pausedStatus.duration_seconds || 1) * 0.35));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(seekSlider, String(seekTargetSeconds));
  seekSlider.dispatchEvent(new Event('input', { bubbles: true }));
  seekSlider.dispatchEvent(new Event('change', { bubbles: true }));
  const nativeSeeked = await waitFor(async () => {
    const status = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
    return status.position_seconds >= seekTargetSeconds - 0.03;
  }, 10000);
  if (!nativeSeeked) throw new Error('Native A/B did not seek from the visible UI slider');
  const seekedStatus = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
  click(buttonByText('Resume'));
  const nativeResumed = await waitFor(async () => {
    const status = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
    return status.active && !status.paused;
  }, 10000);
  if (!nativeResumed) throw new Error('Native A/B did not resume from the visible UI button');
  await new Promise((resolve) => setTimeout(resolve, 650));
  const resumedStatus = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
  const runningStatus = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
  click(buttonByText('Native A/B'));
  await waitFor(async () => !(await window.__TAURI_INTERNALS__.invoke('native_playback_status')).active, 10000);
  const stoppedStatus = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
  const nativeStatusTextAfterStop = text(document.querySelector('.native-audition-status'));
  return JSON.stringify({
    initialMode,
    trackVisible,
    nativeButtonEnabled,
    nativeStarted,
    nativePlaybackEvidence,
    nativeStatusTextAfterStart,
    pauseButtonEnabled,
    pausedStatus,
    seekSliderVisible,
    seekTargetSeconds,
    seekedStatus,
    resumedStatus,
    nativeStatusTextAfterStop,
    runningStatus,
    stoppedStatus
  });
})()
`;
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
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.result.value) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for condition: ${expression}`);
}

function fileStem(value) {
  return path.basename(value).replace(/\.[^.]+$/, "").replace(/\s+\(\d+\)$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
