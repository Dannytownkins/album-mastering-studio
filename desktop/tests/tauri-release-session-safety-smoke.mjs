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
  process.env.AMS_TAURI_RELEASE_SESSION_SAFETY_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-release-session-safety-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const cdpPort = process.env.TAURI_CDP_PORT || "9349";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const statePath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "recent-session.json");
const userPresetsPath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "user-presets.json");
const stateBackup = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;
const userPresetsBackup = existsSync(userPresetsPath) ? readFileSync(userPresetsPath, "utf8") : null;

assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
safeRemove(outputRoot);
mkdirSync(inputsDir, { recursive: true });
const fixturePaths = [
  path.join(inputsDir, "01_release_session_safety.wav"),
  path.join(inputsDir, "02_release_session_safety.wav"),
];
writePcm16Fixture(fixturePaths[0], 185.0, 1.4);
writePcm16Fixture(fixturePaths[1], 246.94, 1.5);

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

  await evaluateInWebView(cdp, seedSessionSafetyExpression());
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForCondition(cdp, "document.body.innerText.includes('Session Safety Fixture 1')", 15000);

  const smoke = await evaluateInWebView(cdp, sessionSafetyExpression());
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-release-session-safety.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...smoke,
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
    statePath,
    userPresetsPath,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    targetTitle: target.title,
    targetUrl: target.url,
  };

  assert.equal(evidence.releaseExeExists, true);
  assert.equal(evidence.appTextIncludesBrand, true);
  assert.equal(evidence.activeMode, "Track Master");
  assert.equal(evidence.trackCountLabel, "2 / 8 tracks");
  assert.equal(evidence.restoredSessionTitle, "Release Session Safety");
  assert.equal(evidence.restoredSelectedHeading, "Track 1");
  assert.equal(evidence.initialPreset, "Universal");
  assert.equal(evidence.afterClarityPreset, "Clarity");
  assert.equal(evidence.undoEnabledAfterPreset, true);
  assert.equal(evidence.afterUndoPreset, "Universal");
  assert.equal(evidence.redoEnabledAfterUndo, true);
  assert.equal(evidence.afterRedoPreset, "Clarity");
  assert.equal(evidence.userPresetSaved, true);
  assert.equal(evidence.userPresetCommandVisible, true);
  assert.ok(evidence.userPresetListCount >= 1);
  assert.equal(evidence.persistedPresetName, "Session Safety Chain");
  assert.equal(evidence.listeningInitial, "Not approved");
  assert.equal(evidence.listeningApprovalAfterChecks, "Approved");
  assert.equal(evidence.persistedListeningApprovedAfterChecks, true);
  assert.equal(evidence.persistedListeningAfterChecks?.trackOriginal, true);
  assert.equal(evidence.persistedListeningAfterChecks?.trackMaster, true);
  assert.equal(evidence.persistedListeningAfterChecks?.trackNativeAb, true);
  assert.equal(evidence.persistedListeningAfterChecks?.codecPreviewAudition, true);
  assert.equal(evidence.persistedListeningAfterChecks?.notes, "Release smoke approval before a render-affecting edit.");
  assert.equal(evidence.lowControlReadoutAfterChange, "+0.50 dB");
  assert.equal(evidence.listeningApprovalAfterDirtyChange, "Not approved");
  assert.equal(evidence.persistedListeningApprovedAfterDirtyChange, false);
  assert.equal(Number(evidence.persistedBassAfterDirtyChange), 0.5);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-release-session-safety-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
  restoreStateFiles();
}

function seedSessionSafetyExpression() {
  const waveform = Array.from({ length: 96 }, (_, index) => Math.abs(Math.sin(index / 6)) * 0.75 + 0.1);
  const session = {
    version: 2,
    savedAt: new Date().toISOString(),
    mode: "track",
    settings: {
      albumTitle: "Release Session Safety",
      artist: "Safety Fixture",
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
      transitionDuration: 1,
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
    tracks: fixturePaths.map((fixturePath, index) => ({
      id: `session-safety-${index + 1}`,
      path: fixturePath,
      title: `Session Safety Fixture ${index + 1}`,
      artist: "Safety Fixture",
      isrc: "",
      character: "auto",
      preset: "auto",
      analysis: {
        duration_seconds: index === 0 ? 1.4 : 1.5,
        integrated_lufs: index === 0 ? -18.4 : -17.9,
        true_peak_dbfs: -5.8,
        loudness_range_lu_proxy: 3.2,
        spectral_centroid_hz: index === 0 ? 1400 : 2100,
        stereo_width: 0.12,
        transient_density: 0.2,
      },
      waveform: index === 0 ? waveform : [...waveform].reverse(),
    })),
    selectedTrackId: "session-safety-1",
    projectPath: "",
    region: null,
    waveformZoom: 1,
    advancedOpen: false,
    volumeMatch: false,
    liveAudition: false,
    loopSelection: false,
    listeningChecklist: {
      trackOriginal: false,
      trackMaster: false,
      trackNativeAb: false,
      codecPreviewAudition: false,
      albumSequence: false,
      albumTransitions: false,
      dashboardReviewed: false,
      notes: "",
    },
    listeningApproved: false,
  };
  return `
(async () => {
  await window.__TAURI_INTERNALS__.invoke('autosave_session', { session: ${JSON.stringify(session)} });
  return JSON.stringify({ seeded: true });
})()
`;
}

function sessionSafetyExpression() {
  return `
(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') throw new Error('Tauri invoke is not available in this WebView');
  const text = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
  const buttons = () => Array.from(document.querySelectorAll('button'));
  const buttonByText = (label) => {
    const button = buttons().find((item) => text(item).includes(label));
    if (!button) throw new Error('Button not found: ' + label);
    return button;
  };
  const topActionButton = (title) => {
    const button = Array.from(document.querySelectorAll('.top-actions button')).find((item) => item.title === title);
    if (!button) throw new Error('Top action not found: ' + title);
    return button;
  };
  const waitFor = async (predicate, timeoutMs) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  };
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const activeMode = () => text(document.querySelector('.mode-tabs button.active'));
  const activePreset = () => text(document.querySelector('.preset-tile.active strong'));
  const setInputValue = async (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await nextFrame();
  };
  const setTextareaValue = async (textarea, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    await nextFrame();
  };
  const setRangeValue = async (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await nextFrame();
  };
  const labelByText = (label) => Array.from(document.querySelectorAll('label')).find((item) => text(item).startsWith(label));
  const sliderByLabel = (label) => {
    const slider = Array.from(document.querySelectorAll('label.slider')).find((item) => text(item).startsWith(label));
    if (!slider) throw new Error(label + ' slider not found');
    return slider;
  };
  const listeningLabel = (label) => {
    const item = Array.from(document.querySelectorAll('.check-toggle')).find((candidate) => text(candidate).includes(label));
    if (!item) throw new Error('Listening checkbox not found: ' + label);
    return item;
  };
  const click = (element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const waitForPersisted = async (predicate, timeoutMs) => {
    let latest = null;
    const ok = await waitFor(async () => {
      latest = await invoke('load_recent_session');
      return Boolean(predicate(latest));
    }, timeoutMs);
    if (!ok) {
      throw new Error('Timed out waiting for persisted session: ' + JSON.stringify(latest));
    }
    return latest;
  };

  const activeModeValue = activeMode();
  const trackCountLabel = text(document.querySelector('.library .panel-title span'));
  const restoredSessionTitle = labelByText('Session')?.querySelector('input')?.value || '';
  const restoredSelectedHeading = text(document.querySelector('.selected-heading .eyebrow'));
  const initialPreset = activePreset();

  click(buttonByText('Clarity'));
  await nextFrame();
  const afterClarityPreset = activePreset();
  const undoEnabledAfterPreset = !topActionButton('Undo').disabled;

  click(topActionButton('Undo'));
  await nextFrame();
  const afterUndoPreset = activePreset();
  const redoEnabledAfterUndo = !topActionButton('Redo').disabled;

  click(topActionButton('Redo'));
  await nextFrame();
  const afterRedoPreset = activePreset();

  const userPresetPanel = document.querySelector('.user-preset-panel');
  if (!userPresetPanel) throw new Error('User preset panel not found');
  await setInputValue(userPresetPanel.querySelector('input[aria-label="User preset name"]'), 'Session Safety Chain');
  const savePresetButton = Array.from(userPresetPanel.querySelectorAll('button')).find((item) => text(item).includes('Save'));
  click(savePresetButton);
  const userPresetSaved = await waitFor(
    () => Array.from(userPresetPanel.querySelectorAll('option')).some((item) => text(item) === 'Session Safety Chain'),
    10000,
  );
  const userPresetList = await invoke('list_user_presets');
  const persistedPreset = userPresetList.find((preset) => preset.name === 'Session Safety Chain');
  const userPresetCommandVisible = Boolean(persistedPreset);

  const listeningInitial = text(document.querySelector('.listening-panel .approval-pill'));
  click(listeningLabel('Original checked'));
  click(listeningLabel('Master checked'));
  click(listeningLabel('Native A/B checked'));
  click(listeningLabel('Codec preview checked'));
  click(listeningLabel('Approved after listening'));
  await setTextareaValue(
    document.querySelector('textarea[aria-label="Listening notes"]'),
    'Release smoke approval before a render-affecting edit.',
  );
  const listeningApprovalAfterChecksReady = await waitFor(
    () => text(document.querySelector('.listening-panel .approval-pill')) === 'Approved',
    5000,
  );
  if (!listeningApprovalAfterChecksReady) throw new Error('Listening approval did not become Approved');
  const listeningApprovalAfterChecks = text(document.querySelector('.listening-panel .approval-pill'));
  const persistedAfterChecks = await waitForPersisted(
    (session) =>
      session?.listeningApproved === true &&
      session?.listeningChecklist?.trackOriginal === true &&
      session?.listeningChecklist?.trackMaster === true &&
      session?.listeningChecklist?.trackNativeAb === true &&
      session?.listeningChecklist?.codecPreviewAudition === true &&
      session?.listeningChecklist?.notes === 'Release smoke approval before a render-affecting edit.',
    12000,
  );

  const lowSlider = sliderByLabel('Low');
  await setRangeValue(lowSlider.querySelector('input'), 0.5);
  const lowControlReadoutAfterChange = text(lowSlider.querySelector('output'));
  const listeningApprovalAfterDirtyReady = await waitFor(
    () => text(document.querySelector('.listening-panel .approval-pill')) === 'Not approved',
    5000,
  );
  if (!listeningApprovalAfterDirtyReady) throw new Error('Listening approval did not clear after Low changed');
  const listeningApprovalAfterDirtyChange = text(document.querySelector('.listening-panel .approval-pill'));
  const persistedAfterDirtyChange = await waitForPersisted(
    (session) => session?.listeningApproved === false && Number(session?.settings?.bass) === 0.5,
    12000,
  );

  return JSON.stringify({
    activeMode: activeModeValue,
    afterClarityPreset,
    afterRedoPreset,
    afterUndoPreset,
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    initialPreset,
    listeningApprovalAfterChecks,
    listeningApprovalAfterDirtyChange,
    listeningInitial,
    lowControlReadoutAfterChange,
    persistedBassAfterDirtyChange: persistedAfterDirtyChange?.settings?.bass,
    persistedListeningAfterChecks: persistedAfterChecks?.listeningChecklist,
    persistedListeningApprovedAfterChecks: persistedAfterChecks?.listeningApproved,
    persistedListeningApprovedAfterDirtyChange: persistedAfterDirtyChange?.listeningApproved,
    persistedPresetName: persistedPreset?.name || '',
    redoEnabledAfterUndo,
    restoredSelectedHeading,
    restoredSessionTitle,
    trackCountLabel,
    undoEnabledAfterPreset,
    userPresetCommandVisible,
    userPresetListCount: userPresetList.length,
    userPresetSaved
  });
})()
`;
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
    const pulse = Math.max(0, Math.sin(2 * Math.PI * 2.8 * t)) ** 3;
    const envelope = fadeIn * fadeOut * (0.03 + 0.22 * pulse);
    const tone = Math.sin(2 * Math.PI * frequency * t);
    const overtone = Math.sin(2 * Math.PI * frequency * 2.01 * t) * 0.16;
    const left = (tone + overtone) * envelope;
    const right = (tone * 0.92 + overtone * 0.12) * envelope;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left * 32767))), 44 + frame * 4);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right * 32767))), 44 + frame * 4 + 2);
  }

  writeFileSync(targetPath, buffer);
}

function restoreStateFiles() {
  mkdirSync(path.dirname(statePath), { recursive: true });
  if (stateBackup == null) {
    rmSync(statePath, { force: true });
  } else {
    writeFileSync(statePath, stateBackup);
  }
  if (userPresetsBackup == null) {
    rmSync(userPresetsPath, { force: true });
  } else {
    writeFileSync(userPresetsPath, userPresetsBackup);
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
