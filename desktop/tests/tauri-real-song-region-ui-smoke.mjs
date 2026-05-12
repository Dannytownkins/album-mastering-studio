import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const releaseExe =
  process.env.AMS_TAURI_RELEASE_EXE ||
  path.join(repoRoot, "desktop", "src-tauri", "target", "release", "album-mastering-studio.exe");
const sourcePath = process.env.AMS_REAL_SONG_PATH;
const outputRoot =
  process.env.AMS_TAURI_REAL_SONG_REGION_UI_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-real-song-region-ui-smoke");
const cdpPort = process.env.TAURI_CDP_PORT || "9355";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const requestedRegionSeconds = Number(process.env.AMS_REAL_SONG_REGION_SECONDS || 12);
const statePath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "recent-session.json");
const stateBackup = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;

assert.ok(sourcePath, "Set AMS_REAL_SONG_PATH to a local audio file for this smoke.");
assert.equal(existsSync(sourcePath), true, `Real-song fixture does not exist: ${sourcePath}`);
assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
safeRemove(outputRoot);
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
const appExited = new Promise((resolve) => app.once("exit", resolve));

let cdp;
try {
  const target = await waitForPageTarget();
  const launchToTargetMs = nowMs() - launchStarted;
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitForCondition(cdp, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'", 15000);
  const launchToInvokeReadyMs = nowMs() - launchStarted;

  const seeded = await seedRealSongTrackSession(cdp);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForCondition(cdp, `document.body.innerText.includes(${JSON.stringify(seeded.title)})`, 15000);

  const smoke = await evaluateInWebView(cdp, realSongRegionUiExpression(seeded));
  const regionPreviewOutputDir = path.dirname(path.dirname(smoke.regionPreviewMasterPath));
  const manifestPath = path.join(regionPreviewOutputDir, "manifest.json");
  const dashboardPath = path.join(regionPreviewOutputDir, "dashboard.html");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const trackItem = (manifest.sequence || []).find((item) => item.type === "track") || {};
  const regionSourcePath = trackItem.source || "";
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-real-song-region-ui.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...seeded,
    ...smoke,
    launchToTargetMs: roundMs(launchToTargetMs),
    launchToInvokeReadyMs: roundMs(launchToInvokeReadyMs),
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    source: fileSummary(sourcePath),
    regionPreviewOutputDir,
    manifestPath,
    dashboardPath,
    manifest,
    regionSourcePath,
    regionRenderedDurationSeconds: trackItem.after?.duration_seconds ?? null,
    manifestExists: existsSync(manifestPath),
    dashboardExists: existsSync(dashboardPath),
    dashboardSkippedForAudition: !existsSync(dashboardPath),
    regionSourceExists: existsSync(regionSourcePath),
    regionMasterExists: existsSync(smoke.regionPreviewMasterPath),
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
  assert.equal(evidence.activeMode, "Track Master");
  assert.equal(evidence.trackVisible, true);
  assert.equal(evidence.trackCountLabel, "1 / 8 tracks");
  assert.equal(evidence.analyzeButtonEnabled, true);
  assert.equal(evidence.initialAnalysisStatus, "Needs analysis");
  assert.equal(evidence.renderRegionDisabledBeforeAnalyze, true);
  assert.equal(evidence.analysisCompletedVisible, true);
  assert.equal(evidence.analysisStatusAfterAnalyze, "Analyzed");
  assert.equal(evidence.sourceLufsVisible, true);
  assert.equal(evidence.sourcePeakVisible, true);
  assert.equal(evidence.waveformEnabledAfterAnalyze, true);
  assert.equal(evidence.exportEnabledAfterAnalyze, true);
  assert.equal(evidence.renderRegionEnabledAfterAnalyze, true);
  assert.equal(evidence.regionCreated, true);
  assert.notEqual(evidence.regionReadoutAfterDrag, "No region selected");
  assert.notEqual(evidence.regionReadoutAfterDrag, "00:00 - 00:00 (00:00)");
  assert.equal(evidence.regionPreviewButtonEnabledBefore, true);
  assert.equal(evidence.firstRegionPreviewReadyVisible, true);
  assert.equal(evidence.firstRegionPreviewParity, "Render-faithful region");
  assert.equal(evidence.lowControlSet, true);
  assert.equal(evidence.regionInvalidatedAfterLowChange, true);
  assert.equal(evidence.regionParityAfterLowChange, "Render required");
  assert.equal(evidence.renderRegionEnabledAfterLowChange, true);
  assert.equal(evidence.transportLabelAfterLowChange, "Player idle");
  assert.equal(evidence.secondRegionButtonEnabledBeforeClick, true);
  assert.equal(evidence.secondRegionRenderStarted, true);
  assert.equal(evidence.secondRegionPreviewReadyVisible, true);
  assert.notEqual(evidence.secondRegionPreviewMasterPath, evidence.firstRegionPreviewMasterPath);
  assert.equal(evidence.secondRegionPreviewParity, "Render-faithful region");
  assert.equal(evidence.secondAudioLoadedRegion, true);
  assert.equal(evidence.regionPreviewReadyVisible, true);
  assert.equal(evidence.regionEngineAuditionReady, true);
  assert.equal(evidence.regionPreviewParity, "Render-faithful region");
  assert.equal(evidence.regionEngineAuditionPath, evidence.regionPreviewMasterPath);
  assert.equal(evidence.regionEngineAuditionEngine, "python-render-track-region-preview");
  assert.equal(evidence.regionEngineAuditionTransportIncludesRegion, true);
  assert.ok(Math.abs(evidence.regionEngineAuditionStartSeconds - evidence.expectedRegionStartSeconds) <= 0.75);
  assert.ok(Math.abs(evidence.regionEngineAuditionDurationSeconds - evidence.expectedRegionDurationSeconds) <= 0.75);
  assert.equal(evidence.manifestExists, true);
  assert.equal(evidence.dashboardExists, false);
  assert.equal(evidence.dashboardSkippedForAudition, true);
  assert.equal(evidence.regionSourceExists, true);
  assert.equal(evidence.regionMasterExists, true);
  assert.equal(evidence.manifest.track_count, 1);
  assert.equal(evidence.manifest.interlude_count, 0);
  assert.equal(trackItem.output, evidence.regionPreviewMasterPath);
  assert.notEqual(evidence.regionSourcePath, sourcePath);
  assert.match(evidence.regionSourcePath, /region-source\.wav$/);
  assert.ok(evidence.regionRenderedDurationSeconds <= evidence.expectedRegionDurationSeconds + 0.75);
  assert.ok(evidence.regionRenderedDurationSeconds >= Math.max(0.25, evidence.expectedRegionDurationSeconds - 0.75));
  assert.equal(evidence.audioLoadedRegion, true);
  assert.ok(evidence.transportDurationSeconds > 0);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-real-song-region-ui-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
  await Promise.race([appExited, sleep(5000)]);
  restoreStateFile();
}

async function seedRealSongTrackSession(cdp) {
  const title = fileStem(sourcePath);
  const sourceDuration = probeDurationSeconds(sourcePath);
  assert.ok(sourceDuration > 0, "Real-song UI region smoke could not read source duration.");
  const requestedSeconds = Math.max(0.25, Math.min(requestedRegionSeconds, 60));
  const expectedRegionStartSeconds = Math.min(Math.max(5, sourceDuration * 0.35), Math.max(sourceDuration - 0.5, 0));
  const expectedRegionDurationSeconds = Math.max(0.25, Math.min(requestedSeconds, sourceDuration - expectedRegionStartSeconds));
  const regionStartFraction = expectedRegionStartSeconds / sourceDuration;
  const regionEndFraction = (expectedRegionStartSeconds + expectedRegionDurationSeconds) / sourceDuration;
  const session = {
    version: 2,
    savedAt: new Date().toISOString(),
    mode: "track",
    settings: {
      albumTitle: `${title} Region UI Smoke`,
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
      boundaryStyle: "direct",
      boundaryDuration: 0,
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
        id: "real-song-region-ui",
        path: sourcePath,
        title,
        artist: "Real Song Fixture",
        isrc: "",
        character: "auto",
        preset: "auto",
      },
    ],
    selectedTrackId: "real-song-region-ui",
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
  return {
    expectedRegionDurationSeconds,
    expectedRegionStartSeconds,
    regionEndFraction,
    regionStartFraction,
    sourcePath,
    sourceDurationSeconds: sourceDuration,
    title,
  };
}

function realSongRegionUiExpression(seeded) {
  return `
(async () => {
  const text = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
  const buttons = () => Array.from(document.querySelectorAll('button'));
  const buttonByText = (label) => {
    const button = buttons().find((item) => text(item).includes(label));
    if (!button) throw new Error('Button not found: ' + label);
    return button;
  };
  const waitFor = async (predicate, timeoutMs) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return false;
  };
  const logText = () => document.querySelector('.log')?.textContent || '';
  const transportLabel = () => text(document.querySelector('.transport-label'));
  const audio = () => document.querySelector('audio');
  const setRangeValue = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const activeMode = text(document.querySelector('.mode-tabs button.active'));
  const trackCountLabel = text(document.querySelector('.library .panel-title span'));
  const trackVisible = document.body.innerText.includes(${JSON.stringify(seeded.title)});
  const analyzeButton = buttonByText('Analyze');
  const analyzeButtonEnabled = !analyzeButton.disabled;
  const exportButton = buttonByText('Export Master');
  const renderRegionButtonBeforeAnalyze = buttonByText('Render Region');
  const renderRegionDisabledBeforeAnalyze = renderRegionButtonBeforeAnalyze.disabled;
  const initialAnalysisStatus = text(document.querySelector('.status-pills .pill:nth-child(1)'));
  analyzeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const analysisCompletedVisible = await waitFor(() => {
    const progress = text(document.querySelector('.progress-readout'));
    if (
      document.querySelector('.source-repair-panel') ||
      logText().includes('Analyze blocked:') ||
      logText().includes('Analyze failed:') ||
      progress.includes('Fix missing or unreadable source files.') ||
      progress.includes('Analyze failed.')
    ) {
      throw new Error('Visible Analyze failed source validation: ' + JSON.stringify({
        log: logText().slice(-2000),
        progress
      }));
    }
    return logText().includes('Analyzed 1 track(s).');
  }, 180000);
  if (!analysisCompletedVisible) {
    throw new Error('Visible Analyze did not complete for the real-song track: ' + JSON.stringify({
      log: logText().slice(-2000),
      progress: text(document.querySelector('.progress-readout'))
    }));
  }
  const waveformReady = await waitFor(() => {
    const canvas = document.querySelector('canvas.wave-large');
    return Boolean(canvas && !canvas.classList.contains('disabled'));
  }, 10000);
  if (!waveformReady) throw new Error('Waveform did not become enabled after visible Analyze');
  const sourceLufsText = text(Array.from(document.querySelectorAll('.metric')).find((item) => text(item).startsWith('Source LUFS')));
  const sourcePeakText = text(Array.from(document.querySelectorAll('.metric')).find((item) => text(item).startsWith('Source Peak')));
  const sourceLufsVisible = Boolean(sourceLufsText && !sourceLufsText.includes('--'));
  const sourcePeakVisible = Boolean(sourcePeakText && !sourcePeakText.includes('--'));
  const exportEnabledAfterAnalyze = !exportButton.disabled;
  const renderRegionEnabledAfterAnalyze = !buttonByText('Render Region').disabled;
  const analysisStatusAfterAnalyze = text(document.querySelector('.status-pills .pill:nth-child(1)'));
  const waveform = document.querySelector('canvas.wave-large');
  if (!waveform) throw new Error('Waveform canvas not found');
  const waveRect = waveform.getBoundingClientRect();
  const waveY = waveRect.top + waveRect.height / 2;
  const regionStartFraction = ${JSON.stringify(seeded.regionStartFraction)};
  const regionEndFraction = ${JSON.stringify(seeded.regionEndFraction)};
  waveform.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    clientX: waveRect.left + waveRect.width * regionStartFraction,
    clientY: waveY,
    view: window
  }));
  waveform.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true,
    cancelable: true,
    clientX: waveRect.left + waveRect.width * regionEndFraction,
    clientY: waveY,
    view: window
  }));
  waveform.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    clientX: waveRect.left + waveRect.width * regionEndFraction,
    clientY: waveY,
    view: window
  }));
  const regionCreated = await waitFor(() => text(document.querySelector('.region-readout')) !== 'No region selected', 5000);
  if (!regionCreated) throw new Error('Region selection was not created from waveform drag');
  const regionReadoutAfterDrag = text(document.querySelector('.region-readout'));
  const regionPreviewButton = buttonByText('Render Region');
  const regionPreviewButtonEnabledBefore = !regionPreviewButton.disabled;
  if (!regionPreviewButtonEnabledBefore) throw new Error('Render Region button was disabled after selecting a region');
  regionPreviewButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const firstRegionPreviewReadyVisible = await waitFor(() => /Region engine preview ready: ([^\\n]+)/.test(logText()), 180000);
  if (!firstRegionPreviewReadyVisible) {
    throw new Error('Region preview did not render through the visible UI: ' + JSON.stringify({
      log: logText().slice(-2000),
      progress: text(document.querySelector('.progress-readout'))
    }));
  }
  const firstRegionPreviewMatch = /Region engine preview ready: ([^\\n]+)/.exec(logText());
  const firstRegionPreviewMasterPath = firstRegionPreviewMatch?.[1]?.trim() || '';
  const firstRegionEngineAuditionReady = await waitFor(() => {
    const audition = window.__AMS_REGION_ENGINE_AUDITION__ || {};
    return Boolean(
      audition.path === firstRegionPreviewMasterPath &&
      text(document.querySelector('.preview-parity-status')) === 'Render-faithful region' &&
      transportLabel().includes('Engine Region')
    );
  }, 10000);
  if (!firstRegionEngineAuditionReady) {
    throw new Error('Region preview did not hand off to engine-rendered region playback: ' + JSON.stringify({
      audition: window.__AMS_REGION_ENGINE_AUDITION__ || null,
      expectedPath: firstRegionPreviewMasterPath,
      previewParity: text(document.querySelector('.preview-parity-status')),
      transportLabel: transportLabel(),
      log: logText().slice(-2000)
    }));
  }
  const audioLoadedRegion = await waitFor(() => audio()?.duration > 0 && !Number.isNaN(audio()?.duration), 10000);
  const firstRegionPreviewParity = text(document.querySelector('.preview-parity-status'));
  const lowControl = Array.from(document.querySelectorAll('.core-controls label.slider')).find((item) => text(item).startsWith('Low'));
  const lowInput = lowControl?.querySelector('input[type="range"]');
  if (!lowInput) throw new Error('Low control not found');
  setRangeValue(lowInput, 0.5);
  const lowControlSet = await waitFor(() => (
    Math.abs(Number(lowInput.value) - 0.5) <= 0.001 &&
    text(lowControl?.querySelector('output')) === '+0.50 dB'
  ), 5000);
  if (!lowControlSet) throw new Error('Low control did not update to 0.5 dB');
  const regionInvalidatedAfterLowChange = await waitFor(() => (
    text(document.querySelector('.preview-parity-status')) === 'Render required' &&
    document.querySelector('.preview-parity-status')?.classList.contains('warn') &&
    transportLabel() === 'Player idle' &&
    !buttonByText('Render Region').disabled
  ), 10000);
  if (!regionInvalidatedAfterLowChange) {
    throw new Error('Region preview did not become render-required after Low control change: ' + JSON.stringify({
      previewParity: text(document.querySelector('.preview-parity-status')),
      transportLabel: transportLabel(),
      renderRegionDisabled: buttonByText('Render Region').disabled,
      log: logText().slice(-1000)
    }));
  }
  const regionParityAfterLowChange = text(document.querySelector('.preview-parity-status'));
  const transportLabelAfterLowChange = transportLabel();
  const renderRegionEnabledAfterLowChange = !buttonByText('Render Region').disabled;
  const regionReadoutAfterLowChange = text(document.querySelector('.region-readout'));
  await new Promise((resolve) => setTimeout(resolve, 750));
  const secondRegionButton = buttonByText('Render Region');
  const secondRegionButtonEnabledBeforeClick = !secondRegionButton.disabled;
  if (!secondRegionButtonEnabledBeforeClick) {
    throw new Error('Second Render Region button was disabled after invalidation: ' + JSON.stringify({
      previewParity: text(document.querySelector('.preview-parity-status')),
      transportLabel: transportLabel(),
      progress: text(document.querySelector('.progress-readout'))
    }));
  }
  secondRegionButton.click();
  const secondRegionRenderStarted = await waitFor(() => (
    text(document.querySelector('.progress-readout')).includes('Rendering') ||
    Array.from(logText().matchAll(/Region engine preview ready: ([^\\n]+)/g)).length >= 2
  ), 10000);
  if (!secondRegionRenderStarted) {
    throw new Error('Second Render Region click did not start a render: ' + JSON.stringify({
      buttonDisabled: buttonByText('Render Region').disabled,
      previewParity: text(document.querySelector('.preview-parity-status')),
      transportLabel: transportLabel(),
      progress: text(document.querySelector('.progress-readout')),
      log: logText().slice(-1500)
    }));
  }
  const secondRegionPreviewReadyVisible = await waitFor(() => {
    const audition = window.__AMS_REGION_ENGINE_AUDITION__ || {};
    return Boolean(
      audition.path &&
      audition.path !== firstRegionPreviewMasterPath &&
      audition.engine === 'python-render-track-region-preview'
    );
  }, 180000);
  if (!secondRegionPreviewReadyVisible) {
    throw new Error('Second Region preview did not produce a new engine-rendered path after Low control change: ' + JSON.stringify({
      log: logText().slice(-2000),
      progress: text(document.querySelector('.progress-readout'))
    }));
  }
  const secondRegionPreviewMasterPath = window.__AMS_REGION_ENGINE_AUDITION__?.path || '';
  const regionEngineAuditionReady = await waitFor(() => {
    const audition = window.__AMS_REGION_ENGINE_AUDITION__ || {};
    return Boolean(
      audition.path === secondRegionPreviewMasterPath &&
      text(document.querySelector('.preview-parity-status')) === 'Render-faithful region' &&
      transportLabel().includes('Engine Region')
    );
  }, 10000);
  if (!regionEngineAuditionReady) {
    throw new Error('Second Region preview did not hand off to engine-rendered region playback: ' + JSON.stringify({
      audition: window.__AMS_REGION_ENGINE_AUDITION__ || null,
      expectedPath: secondRegionPreviewMasterPath,
      previewParity: text(document.querySelector('.preview-parity-status')),
      transportLabel: transportLabel(),
      log: logText().slice(-2000)
    }));
  }
  const secondAudioLoadedRegion = await waitFor(() => audio()?.duration > 0 && !Number.isNaN(audio()?.duration), 10000);
  const regionPreviewParity = text(document.querySelector('.preview-parity-status'));
  const transportDurationSeconds = audio()?.duration || 0;
  return JSON.stringify({
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    activeMode,
    trackCountLabel,
    trackVisible,
    analyzeButtonEnabled,
    initialAnalysisStatus,
    renderRegionDisabledBeforeAnalyze,
    analysisCompletedVisible,
    analysisStatusAfterAnalyze,
    sourceLufsText,
    sourcePeakText,
    sourceLufsVisible,
    sourcePeakVisible,
    waveformEnabledAfterAnalyze: waveformReady,
    exportEnabledAfterAnalyze,
    renderRegionEnabledAfterAnalyze,
    regionCreated,
    regionReadoutAfterDrag,
    regionPreviewButtonEnabledBefore,
    firstRegionPreviewReadyVisible,
    firstRegionPreviewMasterPath,
    firstRegionPreviewParity,
    lowControlSet,
    lowControlValue: Number(lowInput.value),
    lowControlOutput: text(lowControl?.querySelector('output')),
    regionInvalidatedAfterLowChange,
    regionParityAfterLowChange,
    transportLabelAfterLowChange,
    renderRegionEnabledAfterLowChange,
    regionReadoutAfterLowChange,
    secondRegionButtonEnabledBeforeClick,
    secondRegionRenderStarted,
    secondRegionPreviewReadyVisible,
    secondRegionPreviewMasterPath,
    secondRegionPreviewParity: regionPreviewParity,
    secondAudioLoadedRegion,
    regionPreviewReadyVisible: secondRegionPreviewReadyVisible,
    regionPreviewMasterPath: secondRegionPreviewMasterPath,
    regionPreviewParity,
    regionEngineAuditionReady,
    regionEngineAuditionPath: window.__AMS_REGION_ENGINE_AUDITION__?.path || '',
    regionEngineAuditionEngine: window.__AMS_REGION_ENGINE_AUDITION__?.engine || '',
    regionEngineAuditionStartSeconds: window.__AMS_REGION_ENGINE_AUDITION__?.startSeconds ?? null,
    regionEngineAuditionDurationSeconds: window.__AMS_REGION_ENGINE_AUDITION__?.durationSeconds ?? null,
    regionEngineAuditionTransportIncludesRegion: transportLabel().includes('Engine Region'),
    transportLabelAfterRegion: transportLabel(),
    audioLoadedRegion,
    transportDurationSeconds
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
    throw new Error(JSON.stringify(result.exceptionDetails, null, 2));
  }
  return JSON.parse(result.result.value);
}

function restoreStateFile() {
  mkdirSync(path.dirname(statePath), { recursive: true });
  if (stateBackup == null) {
    rmSync(statePath, { force: true });
  } else {
    writeFileSync(statePath, stateBackup);
  }
}

function safeRemove(target) {
  const resolved = path.resolve(target);
  const allowedRoot = path.resolve(repoRoot, "test-output");
  assert.ok(
    resolved === allowedRoot || resolved.startsWith(`${allowedRoot}${path.sep}`),
    `Refusing to remove path outside repo test-output: ${resolved}`,
  );
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}

function fileSummary(target) {
  const stats = statSync(target);
  return { path: target, size: stats.size, modified: stats.mtime.toISOString() };
}

function probeDurationSeconds(target) {
  const result = spawnSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nokey=1:noprint_wrappers=1",
    target,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const duration = Number(result.stdout.trim());
  assert.ok(Number.isFinite(duration) && duration > 0, `Invalid ffprobe duration for ${target}: ${result.stdout}`);
  return duration;
}

function fileStem(target) {
  return path.basename(target).replace(/\.[^.]+$/, "").replace(/\s+\(\d+\)$/, "");
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
