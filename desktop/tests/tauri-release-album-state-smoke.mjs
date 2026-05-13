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
  process.env.AMS_TAURI_RELEASE_ALBUM_STATE_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-release-album-state-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const cdpPort = process.env.TAURI_CDP_PORT || "9350";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const statePath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "recent-session.json");
const stateBackup = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;

assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
safeRemove(outputRoot);
mkdirSync(inputsDir, { recursive: true });
const fixturePaths = [
  path.join(inputsDir, "01_release_album_state.wav"),
  path.join(inputsDir, "02_release_album_state.wav"),
];
writePcm16Fixture(fixturePaths[0], 164.81, 1.45);
writePcm16Fixture(fixturePaths[1], 220.0, 1.55);

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

  await evaluateInWebView(cdp, seedAlbumStateExpression());
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForCondition(cdp, "document.body.innerText.includes('Album State Fixture 1')", 15000);

  const smoke = await evaluateInWebView(cdp, albumStateExpression());
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-release-album-state.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...smoke,
    boundaryPreviewPathExists: existsSync(smoke.boundaryPreviewPath || ""),
    boundaryPreviewProjectExists: existsSync(smoke.boundaryPreviewProjectPath || ""),
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
    statePath,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    targetTitle: target.title,
    targetUrl: target.url,
  };

  assert.equal(evidence.releaseExeExists, true);
  assert.equal(evidence.appTextIncludesBrand, true);
  assert.equal(evidence.activeMode, "Album Master");
  assert.equal(evidence.trackCountLabel, "2 / 8 tracks");
  assert.equal(evidence.albumControlsVisible, true);
  assert.equal(evidence.albumPlanButtonEnabledBefore, true);
  assert.equal(evidence.albumPlanReadyVisible, true);
  assert.match(evidence.albumPlanStatusText, /Engine plan ready/i);
  assert.match(evidence.albumPlanReviewText, /Release Album State/);
  assert.match(evidence.albumPlanReviewText, /2 tracks/i);
  assert.equal(evidence.albumPlanLogReady, true);
  assert.equal(evidence.initialAlbumTitle, "Release Album State");
  assert.equal(evidence.albumTitleRoundTrip.undone, "Release Album State");
  assert.equal(evidence.albumTitleRoundTrip.redone, "Release Album Redone");
  assert.equal(evidence.generatedTransitionsRoundTrip.undone, false);
  assert.equal(evidence.generatedTransitionsRoundTrip.redone, true);
  assert.equal(evidence.boundaryStyleRoundTrip.undone, "direct");
  assert.equal(evidence.boundaryStyleRoundTrip.redone, "crossfade");
  assert.equal(evidence.boundarySecondsRoundTrip.undone, "2.0 s");
  assert.equal(evidence.boundarySecondsRoundTrip.redone, "4.5 s");
  assert.equal(evidence.trackRoleRoundTrip.undone, "auto");
  assert.equal(evidence.trackRoleRoundTrip.redone, "heavy_djent");
  assert.equal(evidence.trackPresetRoundTrip.undone, "auto");
  assert.equal(evidence.trackPresetRoundTrip.redone, "bright-air");
  assert.equal(evidence.persisted?.mode, "album");
  assert.equal(evidence.persisted?.settings?.albumTitle, "Release Album Redone");
  assert.equal(evidence.persisted?.settings?.transitionsEnabled, true);
  assert.equal(evidence.persisted?.settings?.boundaryStyle, "crossfade");
  assert.equal(Number(evidence.persisted?.settings?.boundaryDuration), 4.5);
  assert.equal(evidence.persistedTrack?.character, "heavy_djent");
  assert.equal(evidence.persistedTrack?.preset, "bright-air");
  assert.equal(evidence.boundaryPreviewButtonEnabledBefore, true);
  assert.equal(evidence.boundaryPreviewReadyVisible, true);
  assert.equal(evidence.boundaryPreviewPathExists, true);
  assert.equal(evidence.boundaryPreviewProjectExists, true);
  assert.match(evidence.boundaryPreviewTransportLabel, /Boundary 1 to 2 Preview/);
  assert.equal(evidence.boundaryPreviewParity, "Bounded boundary preview");
  assert.match(evidence.boundaryPreviewParityTitle, /adjacent track tails and heads/);
  assert.match(evidence.boundaryPreviewParityTitle, /not full-album approval/);
  assert.equal(evidence.boundaryPreviewParityWarn, false);
  assert.equal(evidence.boundaryPreviewHistoryVisible, true);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-release-album-state-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
  restoreStateFile();
}

function seedAlbumStateExpression() {
  const waveform = Array.from({ length: 96 }, (_, index) => Math.abs(Math.sin(index / 7)) * 0.72 + 0.12);
  const session = {
    version: 2,
    savedAt: new Date().toISOString(),
    mode: "album",
    settings: {
      albumTitle: "Release Album State",
      artist: "Album State Artist",
      albumArtist: "Album State Artist",
      genre: "Fixture",
      year: "2026",
      upc: "",
      outputDir: outputRoot,
      referenceTrack: "",
      preset: "album-cohesion-cinematic",
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
      id: `album-state-${index + 1}`,
      path: fixturePath,
      title: `Album State Fixture ${index + 1}`,
      artist: "Album State Artist",
      isrc: "",
      character: "auto",
      preset: "auto",
      analysis: {
        duration_seconds: index === 0 ? 1.45 : 1.55,
        integrated_lufs: index === 0 ? -18.1 : -17.4,
        true_peak_dbfs: -5.4,
        loudness_range_lu_proxy: 3.8,
        spectral_centroid_hz: index === 0 ? 1350 : 2300,
        stereo_width: index === 0 ? 0.16 : 0.22,
        transient_density: 0.24,
      },
      waveform: index === 0 ? waveform : [...waveform].reverse(),
    })),
    selectedTrackId: "album-state-1",
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

function albumStateExpression() {
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
  const logText = () => document.querySelector('.log')?.textContent || '';
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
  const click = (element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const activeMode = () => text(document.querySelector('.mode-tabs button.active'));
  const labelByText = (label) => Array.from(document.querySelectorAll('label')).find((item) => text(item).startsWith(label));
  const controlSelect = (label) => {
    const control = Array.from(document.querySelectorAll('label.control')).find((item) => text(item).startsWith(label));
    const select = control?.querySelector('select');
    if (!select) throw new Error(label + ' select not found');
    return select;
  };
  const sliderByLabel = (label) => {
    const slider = Array.from(document.querySelectorAll('label.slider')).find((item) => text(item).startsWith(label));
    if (!slider) throw new Error(label + ' slider not found');
    return slider;
  };
  const setInputValue = async (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextFrame();
  };
  const setSelectValue = async (select, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await nextFrame();
  };
  const setRangeValue = async (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await nextFrame();
  };
  const undoOnce = async () => {
    if (topActionButton('Undo').disabled) throw new Error('Undo was disabled');
    click(topActionButton('Undo'));
    await nextFrame();
  };
  const redoOnce = async () => {
    if (topActionButton('Redo').disabled) throw new Error('Redo was disabled');
    click(topActionButton('Redo'));
    await nextFrame();
  };
  const roundTrip = async ({ mutate, read, initial, changed, label }) => {
    await mutate();
    const changedReady = await waitFor(() => read() === changed, 5000);
    if (!changedReady) throw new Error(label + ' did not reach changed value: ' + JSON.stringify({ actual: read(), changed }));
    await undoOnce();
    const undoneReady = await waitFor(() => read() === initial, 5000);
    if (!undoneReady) throw new Error(label + ' did not undo: ' + JSON.stringify({ actual: read(), initial }));
    const undone = read();
    await redoOnce();
    const redoneReady = await waitFor(() => read() === changed, 5000);
    if (!redoneReady) throw new Error(label + ' did not redo: ' + JSON.stringify({ actual: read(), changed }));
    return { undone, redone: read() };
  };
  const waitForPersisted = async (predicate, timeoutMs) => {
    let latest = null;
    const ok = await waitFor(async () => {
      latest = await invoke('load_recent_session');
      return Boolean(predicate(latest));
    }, timeoutMs);
    if (!ok) throw new Error('Timed out waiting for persisted album state: ' + JSON.stringify(latest));
    return latest;
  };

  const activeModeValue = activeMode();
  const trackCountLabel = text(document.querySelector('.library .panel-title span'));
  const albumControlsVisible = document.body.innerText.includes('Album Arc') && document.body.innerText.includes('Album Story / Roles');
  const albumInput = labelByText('Album')?.querySelector('input');
  if (!albumInput) throw new Error('Album title input not found');
  const generatedTransitionsInput = Array.from(document.querySelectorAll('.album-controls .check-row'))
    .find((item) => text(item).includes('Generated transitions'))
    ?.querySelector('input');
  if (!generatedTransitionsInput) throw new Error('Generated transitions input not found');
  const boundarySelect = controlSelect('Boundary');
  const boundarySecondsSlider = sliderByLabel('Boundary Seconds');
  const trackRoleSelect = controlSelect('Track Role');
  const trackPresetSelect = controlSelect('Track Preset');
  const albumPlanButton = buttonByText('Review Album Plan');
  const albumPlanButtonEnabledBefore = !albumPlanButton.disabled;
  click(albumPlanButton);
  const albumPlanReadyVisible = await waitFor(
    () => /Engine plan ready/i.test(text(document.querySelector('.album-plan-review .engine-plan-status'))),
    120000,
  );
  const albumPlanStatusText = text(document.querySelector('.album-plan-review .engine-plan-status'));
  const albumPlanReviewText = text(document.querySelector('.album-plan-review'));
  const albumPlanLogReady = /Album plan ready:/.test(logText());

  const initialAlbumTitle = albumInput.value;
  const albumTitleRoundTrip = await roundTrip({
    label: 'album title',
    initial: 'Release Album State',
    changed: 'Release Album Redone',
    read: () => albumInput.value,
    mutate: () => setInputValue(albumInput, 'Release Album Redone')
  });
  const generatedTransitionsRoundTrip = await roundTrip({
    label: 'generated transitions',
    initial: false,
    changed: true,
    read: () => generatedTransitionsInput.checked,
    mutate: async () => {
      click(generatedTransitionsInput);
      await nextFrame();
    }
  });
  const boundaryStyleRoundTrip = await roundTrip({
    label: 'boundary style',
    initial: 'direct',
    changed: 'crossfade',
    read: () => boundarySelect.value,
    mutate: () => setSelectValue(boundarySelect, 'crossfade')
  });
  const boundarySecondsRoundTrip = await roundTrip({
    label: 'boundary seconds',
    initial: '2.0 s',
    changed: '4.5 s',
    read: () => text(boundarySecondsSlider.querySelector('output')),
    mutate: () => setRangeValue(boundarySecondsSlider.querySelector('input'), 4.5)
  });
  const trackRoleRoundTrip = await roundTrip({
    label: 'track role',
    initial: 'auto',
    changed: 'heavy_djent',
    read: () => trackRoleSelect.value,
    mutate: () => setSelectValue(trackRoleSelect, 'heavy_djent')
  });
  const trackPresetRoundTrip = await roundTrip({
    label: 'track preset',
    initial: 'auto',
    changed: 'bright-air',
    read: () => trackPresetSelect.value,
    mutate: () => setSelectValue(trackPresetSelect, 'bright-air')
  });
  const persisted = await waitForPersisted(
    (session) =>
      session?.mode === 'album' &&
      session?.settings?.albumTitle === 'Release Album Redone' &&
      session?.settings?.transitionsEnabled === true &&
      session?.settings?.boundaryStyle === 'crossfade' &&
      Number(session?.settings?.boundaryDuration) === 4.5 &&
      session?.tracks?.find((track) => track.id === 'album-state-1')?.character === 'heavy_djent' &&
      session?.tracks?.find((track) => track.id === 'album-state-1')?.preset === 'bright-air',
    12000,
  );
  const persistedTrack = persisted?.tracks?.find((track) => track.id === 'album-state-1') || null;
  const boundaryPreviewButton = buttonByText('Preview Boundary');
  const boundaryPreviewButtonEnabledBefore = !boundaryPreviewButton.disabled;
  click(boundaryPreviewButton);
  const boundaryPreviewReadyVisible = await waitFor(() => logText().includes('Boundary preview ready:'), 180000);
  const boundaryPreviewMatch = /Boundary preview ready: ([^\\n]+)/.exec(logText());
  if (!boundaryPreviewMatch) throw new Error('Boundary preview path was not logged: ' + logText());
  const boundaryPreviewPath = boundaryPreviewMatch[1].trim();
  const boundaryPreviewProjectPath = boundaryPreviewPath.replace(/boundary-01-to-02\\.wav$/, 'album-boundary-preview.ams.json');
  const boundaryPreviewTransportLabel = text(document.querySelector('.transport-label'));
  const boundaryPreviewParityElement = document.querySelector('.preview-parity-status');
  const boundaryPreviewParity = text(boundaryPreviewParityElement);
  const boundaryPreviewParityTitle = boundaryPreviewParityElement?.getAttribute('title') || '';
  const boundaryPreviewParityWarn = boundaryPreviewParityElement?.classList.contains('warn') ?? true;
  const boundaryPreviewHistoryVisible = Array.from(document.querySelectorAll('.render-history-card'))
    .some((item) => text(item).includes('Boundary Preview') && text(item).includes('Boundary 1 to 2 Preview'));

  return JSON.stringify({
    activeMode: activeModeValue,
    albumControlsVisible,
    albumPlanButtonEnabledBefore,
    albumPlanLogReady,
    albumPlanReadyVisible,
    albumPlanReviewText,
    albumPlanStatusText,
    albumTitleRoundTrip,
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    boundarySecondsRoundTrip,
    boundaryStyleRoundTrip,
    generatedTransitionsRoundTrip,
    initialAlbumTitle,
    persisted,
    persistedTrack,
    boundaryPreviewButtonEnabledBefore,
    boundaryPreviewHistoryVisible,
    boundaryPreviewParity,
    boundaryPreviewParityTitle,
    boundaryPreviewParityWarn,
    boundaryPreviewPath,
    boundaryPreviewProjectPath,
    boundaryPreviewReadyVisible,
    boundaryPreviewTransportLabel,
    trackCountLabel,
    trackPresetRoundTrip,
    trackRoleRoundTrip
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
    const pulse = Math.max(0, Math.sin(2 * Math.PI * 2.3 * t)) ** 3;
    const envelope = fadeIn * fadeOut * (0.028 + 0.22 * pulse);
    const tone = Math.sin(2 * Math.PI * frequency * t);
    const left = tone * envelope;
    const right = tone * envelope * 0.9;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left * 32767))), 44 + frame * 4);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right * 32767))), 44 + frame * 4 + 2);
  }

  writeFileSync(targetPath, buffer);
}

function restoreStateFile() {
  mkdirSync(path.dirname(statePath), { recursive: true });
  if (stateBackup == null) {
    rmSync(statePath, { force: true });
  } else {
    writeFileSync(statePath, stateBackup);
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
