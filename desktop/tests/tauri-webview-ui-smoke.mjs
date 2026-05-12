import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const outputRoot = process.env.AMS_TAURI_UI_OUTPUT || path.join(repoRoot, "test-output", "tauri-webview-ui-smoke");
const cdpPort = process.env.TAURI_CDP_PORT || "9222";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const statePath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "recent-session.json");
const userPresetsPath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "user-presets.json");
const stateBackup = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;
const userPresetsBackup = existsSync(userPresetsPath) ? readFileSync(userPresetsPath, "utf8") : null;

mkdirSync(outputRoot, { recursive: true });

const target = await findTauriPageTarget();
const cdp = await connectCdp(target.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");
await cdp.send("Page.enable");
await waitForCondition(cdp, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'", 15000);

try {
  await seedSession(cdp);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForCondition(cdp, "document.body.innerText.includes('Codex UI Fixture A')", 10000);

  const smoke = await evaluateInWebView(cdp, uiSmokeExpression());
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-webview-ui.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...smoke,
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
  };

  assert.equal(evidence.initialMode, "Track Master");
  assert.equal(evidence.seededTrackCount, "2 / 8 tracks");
  assert.equal(evidence.sourceRepairVisible, true);
  assert.equal(evidence.sourceRepairCount, 1);
  assert.match(evidence.sourceRepairStatus, /Unreadable source/);
  assert.equal(evidence.sourceRepairCleared, true);
  assert.equal(evidence.initialPreset, "Universal");
  assert.equal(evidence.afterClarityPreset, "Clarity");
  assert.equal(evidence.afterUndoPreset, "Universal");
  assert.equal(evidence.afterRedoPreset, "Clarity");
  assert.equal(evidence.userPresetSaved, true);
  assert.equal(evidence.afterPresetResetBeforeApply, "Universal");
  assert.equal(evidence.userPresetApplied, true);
  assert.ok(evidence.userPresetListCount >= 1);
  assert.equal(evidence.albumMode, "Album Master");
  assert.equal(evidence.albumControlsVisible, true);
  assert.equal(evidence.generatedTransitionsDefaultOff, true);
  assert.equal(evidence.generatedTransitionsOptIn, true);
  assert.equal(evidence.boundaryDefaultDirect, true);
  assert.equal(evidence.boundaryGapSelected, true);
  assert.equal(evidence.boundaryFadeSelected, true);
  assert.equal(evidence.boundaryRingOutSelected, true);
  assert.equal(evidence.boundaryCrossfadeSelected, true);
  assert.equal(evidence.boundaryDurationReadout, "3.0 s");
  assert.equal(evidence.albumStoryVisible, true);
  assert.equal(evidence.albumRoleCardCount, 2);
  assert.equal(evidence.albumRoleOverrideApplied, true);
  assert.equal(evidence.returnedMode, "Track Master");
  assert.equal(evidence.advancedVisible, true);
  assert.equal(evidence.livePreviewArmed, true);
  assert.match(evidence.livePreviewStatus, /Live Preview armed/);
  assert.equal(evidence.previewParityStatus, "Render required");
  assert.equal(evidence.livePreviewContractLoaded, true);
  assert.equal(evidence.livePreviewContractModelId, "web-audio-first-control-model");
  assert.deepEqual(evidence.livePreviewContractModeledControls, ["Low", "Mid", "High", "Width", "Intensity"]);
  assert.deepEqual(evidence.livePreviewContractDrift, []);
  assert.equal(evidence.livePreviewContractDriftVisible, false);
  assert.match(evidence.livePreviewModeledStatus, /Live model: Low, Mid, High, Width, Intensity/);
  assert.match(evidence.livePreviewRenderOnlyStatus, /Render-only:/);
  assert.equal(evidence.livePreviewRenderOnlyIncludesLufs, true);
  assert.equal(evidence.livePreviewRenderOnlyIncludesLimiter, true);
  assert.equal(evidence.nativeAbButtonEnabled, true);
  assert.equal(evidence.nativeAbStatus, "Native transport ready");
  assert.equal(evidence.listeningInitial, true);
  assert.equal(evidence.listeningApprovalInitial, "Not approved");
  assert.equal(evidence.listeningProgressAfterChecks.includes("3/6"), true);
  assert.equal(evidence.listeningApprovalAfterChecks, "Approved");
  assert.equal(evidence.persistedListening?.trackOriginal, true);
  assert.equal(evidence.persistedListening?.trackNativeAb, true);
  assert.equal(evidence.persistedListening?.dashboardReviewed, true);
  assert.equal(evidence.persistedListeningApproved, true);
  assert.equal(evidence.persistedListening?.notes, "Checked track and dashboard in UI smoke.");
  assert.equal(evidence.persistedRoleOverride, "heavy_djent");
  assert.equal(evidence.volumeMatchActive, true);
  assert.equal(evidence.zoomReadout, "2.0x");
  assert.equal(evidence.regionCreated, true);
  assert.equal(evidence.loopEnabledAfterRegion, true);
  assert.equal(evidence.loopActive, true);
  assert.equal(evidence.regionCleared, true);
  assert.equal(evidence.loopDisabledAfterClear, true);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-webview-ui-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  await sleep(1000);
  restoreStateFiles();
  cdp.close();
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

async function seedSession(cdp) {
  const fixtureA = path.join(outputRoot, "inputs", "01_tauri_ui_fixture.wav");
  const fixtureB = path.join(outputRoot, "inputs", "02_tauri_ui_fixture.wav");
  mkdirSync(path.dirname(fixtureA), { recursive: true });
  writeUiFixtures(path.dirname(fixtureA));
  const waveform = Array.from({ length: 96 }, (_, index) => Math.abs(Math.sin(index / 5)) * 0.8 + 0.1);
  const session = {
    version: 2,
    savedAt: new Date().toISOString(),
    mode: "track",
    settings: {
      albumTitle: "Codex UI Smoke Session",
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
      codecPreview: true,
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
        id: "codex-ui-a",
        path: fixtureA,
        title: "Codex UI Fixture A",
        artist: "Codex Fixture",
        isrc: "",
        character: "auto",
        preset: "auto",
        analysis: {
          duration_seconds: 90,
          integrated_lufs: -18.2,
          true_peak_dbfs: -3.1,
          loudness_range_lu_proxy: 7.4,
          spectral_centroid_hz: 2200,
          stereo_width: 0.42,
          transient_density: 0.38,
        },
        waveform,
      },
      {
        id: "codex-ui-b",
        path: fixtureB,
        title: "Codex UI Fixture B",
        artist: "Codex Fixture",
        isrc: "",
        character: "auto",
        preset: "auto",
        analysis: {
          duration_seconds: 95,
          integrated_lufs: -17.6,
          true_peak_dbfs: -2.8,
          loudness_range_lu_proxy: 6.9,
          spectral_centroid_hz: 2600,
          stereo_width: 0.46,
          transient_density: 0.41,
        },
        waveform: [...waveform].reverse(),
        sourceStatus: {
          path: fixtureB,
          exists: true,
          supported: true,
          is_directory: false,
          status: "unreadable",
          detail: "FFprobe could not read this audio source. The file may be corrupt or use an unsupported codec.",
          diagnostic: "Seeded UI source repair fixture.",
        },
      },
    ],
    selectedTrackId: "codex-ui-a",
    projectPath: "",
    region: null,
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
}

function writeUiFixtures(targetDir) {
  const python = process.env.ALBUM_MASTER_PYTHON || "python";
  const script = `
from pathlib import Path
import numpy as np
from scipy.io import wavfile
root = Path(r"${targetDir.replaceAll("\\", "\\\\")}")
root.mkdir(parents=True, exist_ok=True)
sr = 48000
for idx, freq in enumerate((174.61, 261.63), start=1):
    seconds = 2.0
    t = np.linspace(0, seconds, int(sr * seconds), endpoint=False)
    fade = np.minimum(1.0, np.linspace(0, 1, t.size) * 12) * np.minimum(1.0, np.linspace(1, 0, t.size) * 12)
    tone = (np.sin(2*np.pi*freq*t) * 0.18 * fade).astype(np.float32)
    wavfile.write(root / f"{idx:02d}_tauri_ui_fixture.wav", sr, np.column_stack([tone, tone * 0.92]).astype(np.float32))
`;
  const result = spawnSync(python, ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function uiSmokeExpression() {
  return `
(async () => {
  const text = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
  const buttons = () => Array.from(document.querySelectorAll('button'));
  const buttonByText = (label) => {
    const button = buttons().find((item) => text(item).includes(label));
    if (!button) throw new Error('Button not found: ' + label);
    return button;
  };
  const activeMode = () => text(document.querySelector('.mode-tabs button.active'));
  const activePreset = () => text(document.querySelector('.preset-tile.active strong'));
  const click = (element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const waitFor = async (predicate, timeoutMs) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return false;
  };
  const setInputValue = async (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await nextFrame();
  };
  const setRangeValue = async (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await nextFrame();
  };
  const setSelectValue = async (select, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await nextFrame();
  };
  const topActionButton = (title) => {
    const button = Array.from(document.querySelectorAll('.top-actions button')).find((item) => item.title === title);
    if (!button) throw new Error('Top action not found: ' + title);
    return button;
  };
  const initialMode = activeMode();
  const seededTrackCount = text(document.querySelector('.library .panel-title span'));
  const initialPreset = activePreset();
  const sourceRepairPanel = document.querySelector('.source-repair-panel');
  const sourceRepairVisible = !!sourceRepairPanel;
  const sourceRepairCount = sourceRepairPanel?.querySelectorAll('.source-issue-row').length ?? 0;
  const sourceRepairStatus = text(sourceRepairPanel?.querySelector('.source-status'));
  const sourceRepairRecheck = Array.from(sourceRepairPanel?.querySelectorAll('button') ?? []).find((item) => text(item).includes('Recheck'));
  if (!sourceRepairRecheck) throw new Error('Source repair recheck button not found');
  click(sourceRepairRecheck);
  const sourceRepairCleared = await waitFor(() => !document.querySelector('.source-repair-panel'), 10000);

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
  await setInputValue(userPresetPanel.querySelector('input[aria-label="User preset name"]'), 'Codex Smoke Chain');
  const saveUserPresetButton = Array.from(userPresetPanel.querySelectorAll('button')).find((item) => text(item).includes('Save'));
  click(saveUserPresetButton);
  const userPresetSaved = await waitFor(() => Array.from(userPresetPanel.querySelectorAll('option')).some((item) => text(item) === 'Codex Smoke Chain'), 10000);
  if (!userPresetSaved) throw new Error('User preset was not saved into the preset list');
  click(buttonByText('Universal'));
  await nextFrame();
  const afterPresetResetBeforeApply = activePreset();
  const applyUserPresetButton = Array.from(userPresetPanel.querySelectorAll('button')).find((item) => text(item).includes('Apply'));
  click(applyUserPresetButton);
  await nextFrame();
  const userPresetApplied = activePreset() === 'Clarity';
  const userPresetListCount = userPresetPanel.querySelectorAll('option').length;

  click(buttonByText('Album Master'));
  await nextFrame();
  const albumMode = activeMode();
  const albumControlsVisible = document.body.innerText.includes('Album Arc') && document.body.innerText.includes('Export Album');
  const generatedTransitionsInput = Array.from(document.querySelectorAll('.album-controls .check-row')).find((item) => text(item).includes('Generated transitions'))?.querySelector('input');
  if (!generatedTransitionsInput) throw new Error('Generated transitions toggle not found');
  const generatedTransitionsDefaultOff = generatedTransitionsInput.checked === false;
  click(generatedTransitionsInput);
  await nextFrame();
  const generatedTransitionsOptIn = generatedTransitionsInput.checked === true;
  const boundarySelect = Array.from(document.querySelectorAll('.album-controls label.control'))
    .find((item) => text(item).startsWith('Boundary'))
    ?.querySelector('select');
  if (!boundarySelect) throw new Error('Boundary select not found');
  const boundaryDefaultDirect = boundarySelect.value === 'direct';
  await setSelectValue(boundarySelect, 'gap');
  const boundaryGapSelected = boundarySelect.value === 'gap';
  await setSelectValue(boundarySelect, 'fade');
  const boundaryFadeSelected = boundarySelect.value === 'fade';
  await setSelectValue(boundarySelect, 'ring-out');
  const boundaryRingOutSelected = boundarySelect.value === 'ring-out';
  await setSelectValue(boundarySelect, 'crossfade');
  const boundaryCrossfadeSelected = boundarySelect.value === 'crossfade';
  const boundarySlider = Array.from(document.querySelectorAll('.album-controls label.slider'))
    .find((item) => text(item).includes('Boundary Seconds'));
  if (!boundarySlider) throw new Error('Boundary seconds slider not found');
  await setRangeValue(boundarySlider.querySelector('input'), 3);
  const boundaryDurationReadout = text(boundarySlider.querySelector('output'));
  const albumStoryVisible = document.body.innerText.includes('Album Story / Roles');
  const albumRoleCardCount = document.querySelectorAll('.album-role-card').length;
  const firstRoleSelect = document.querySelector('select[aria-label="Override role for Codex UI Fixture A"]');
  if (!firstRoleSelect) throw new Error('Album role override select not found');
  await setSelectValue(firstRoleSelect, 'heavy_djent');
  const albumRoleOverrideApplied = firstRoleSelect.value === 'heavy_djent';

  click(buttonByText('Track Master'));
  await nextFrame();
  const returnedMode = activeMode();

  click(buttonByText('Advanced'));
  await nextFrame();
  const advancedVisible = document.body.innerText.includes('Target LUFS') && document.body.innerText.includes('Codec QC');

  click(buttonByText('Live Preview'));
  await nextFrame();
  const livePreviewArmed = buttonByText('Live Preview').classList.contains('active') && document.body.innerText.includes('Live Preview armed');
  const livePreviewStatus = text(document.querySelector('.live-audition-status'));
  const previewParityStatus = text(document.querySelector('.preview-parity-status'));
  const livePreviewContractLoaded = await waitFor(() => window.__AMS_LIVE_PREVIEW_CONTRACT__?.modelId === 'web-audio-first-control-model', 5000);
  const livePreviewContract = window.__AMS_LIVE_PREVIEW_CONTRACT__ || {};
  const livePreviewContractDrift = window.__AMS_LIVE_PREVIEW_CONTRACT_DRIFT__ || [];
  const livePreviewContractDriftVisible = Array.from(document.querySelectorAll('.live-contract-status.warn'))
    .some((item) => text(item).includes('Contract drift'));
  const livePreviewModeledStatus = text(document.querySelector('.live-contract-status.modeled'));
  const livePreviewRenderOnlyStatus = text(document.querySelector('.live-contract-status.render-only'));
  const livePreviewRenderOnlyIncludesLufs = livePreviewRenderOnlyStatus.includes('LUFS');
  const livePreviewRenderOnlyIncludesLimiter = livePreviewRenderOnlyStatus.includes('limiter');
  const nativeAbButtonEnabled = !buttonByText('Native A/B').disabled;
  const nativeAbStatus = text(document.querySelector('.native-audition-status'));
  const listeningInitial = text(document.querySelector('.listening-panel .panel-title')).includes('0/6');
  const listeningApprovalInitial = text(document.querySelector('.listening-panel .approval-pill'));
  const listeningLabel = (label) => {
    const item = Array.from(document.querySelectorAll('.check-toggle')).find((candidate) => text(candidate).includes(label));
    if (!item) throw new Error('Listening checkbox not found: ' + label);
    return item;
  };
  click(listeningLabel('Original checked'));
  click(listeningLabel('Native A/B checked'));
  click(listeningLabel('Dashboard checked'));
  click(listeningLabel('Approved after listening'));
  const notesInput = document.querySelector('textarea[aria-label="Listening notes"]');
  const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  textareaSetter.call(notesInput, 'Checked track and dashboard in UI smoke.');
  notesInput.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const listeningProgressAfterChecks = text(document.querySelector('.listening-panel .panel-title'));
  const listeningApprovalAfterChecks = text(document.querySelector('.listening-panel .approval-pill'));
  const persisted = await window.__TAURI_INTERNALS__.invoke('load_recent_session');
  const persistedListening = persisted?.listeningChecklist;
  const persistedListeningApproved = persisted?.listeningApproved;
  const persistedRoleOverride = persisted?.tracks?.find((track) => track.title === 'Codex UI Fixture A')?.character;

  click(buttonByText('Volume Match'));
  await nextFrame();
  const volumeMatchActive = buttonByText('Volume Match').classList.contains('active');

  await setRangeValue(document.querySelector('.zoom-control input[type="range"]'), 2);
  const zoomReadout = text(document.querySelector('.zoom-control output'));

  const canvas = document.querySelector('canvas.wave-large');
  const rect = canvas.getBoundingClientRect();
  const y = rect.top + rect.height / 2;
  canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: rect.left + rect.width * 0.25, clientY: y, view: window }));
  canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: rect.left + rect.width * 0.55, clientY: y, view: window }));
  canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: rect.left + rect.width * 0.55, clientY: y, view: window }));
  await nextFrame();
  const regionReadoutAfterDrag = text(document.querySelector('.region-readout'));
  const regionCreated = regionReadoutAfterDrag !== 'No region selected';
  const loopButton = buttonByText('Loop');
  const loopEnabledAfterRegion = !loopButton.disabled;

  click(loopButton);
  await nextFrame();
  const loopActive = buttonByText('Loop').classList.contains('active');

  click(buttonByText('Clear Region'));
  await nextFrame();
  const regionCleared = text(document.querySelector('.region-readout')) === 'No region selected';
  const loopDisabledAfterClear = buttonByText('Loop').disabled;

  return JSON.stringify({
    advancedVisible,
    afterClarityPreset,
    afterRedoPreset,
    afterUndoPreset,
    afterPresetResetBeforeApply,
    albumControlsVisible,
    generatedTransitionsDefaultOff,
    generatedTransitionsOptIn,
    boundaryDefaultDirect,
    boundaryGapSelected,
    boundaryFadeSelected,
    boundaryRingOutSelected,
    boundaryCrossfadeSelected,
    boundaryDurationReadout,
    albumMode,
    albumRoleCardCount,
    albumRoleOverrideApplied,
    albumStoryVisible,
    initialMode,
    initialPreset,
    livePreviewArmed,
    livePreviewStatus,
    previewParityStatus,
    livePreviewContractLoaded,
    livePreviewContractModelId: livePreviewContract.modelId,
    livePreviewContractModeledControls: livePreviewContract.modeledControls,
    livePreviewContractDrift,
    livePreviewContractDriftVisible,
    livePreviewModeledStatus,
    livePreviewRenderOnlyStatus,
    livePreviewRenderOnlyIncludesLufs,
    livePreviewRenderOnlyIncludesLimiter,
    listeningInitial,
    listeningApprovalInitial,
    listeningProgressAfterChecks,
    listeningApprovalAfterChecks,
    persistedListening,
    persistedListeningApproved,
    persistedRoleOverride,
    userPresetApplied,
    userPresetListCount,
    userPresetSaved,
    nativeAbButtonEnabled,
    nativeAbStatus,
    loopActive,
    loopDisabledAfterClear,
    loopEnabledAfterRegion,
    redoEnabledAfterUndo,
    regionCleared,
    regionCreated,
    regionReadoutAfterDrag,
    returnedMode,
    seededTrackCount,
    sourceRepairCleared,
    sourceRepairCount,
    sourceRepairStatus,
    sourceRepairVisible,
    undoEnabledAfterPreset,
    volumeMatchActive,
    zoomReadout
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

async function waitForCondition(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.result?.value === true) return;
    await sleep(150);
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
    throw new Error(JSON.stringify(result.exceptionDetails, null, 2));
  }
  return JSON.parse(result.result.value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
