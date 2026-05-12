import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
  assert.equal(evidence.regionCreated, true);
  assert.notEqual(evidence.regionReadoutAfterDrag, "No region selected");
  assert.notEqual(evidence.regionReadoutAfterDrag, "00:00 - 00:00 (00:00)");
  assert.equal(evidence.regionPreviewButtonEnabledBefore, true);
  assert.equal(evidence.regionPreviewReadyVisible, true);
  assert.equal(evidence.regionEngineAuditionReady, true);
  assert.equal(evidence.regionPreviewParity, "Render-faithful region");
  assert.equal(evidence.regionEngineAuditionPath, evidence.regionPreviewMasterPath);
  assert.equal(evidence.regionEngineAuditionEngine, "python-render-track-region-preview");
  assert.equal(evidence.regionEngineAuditionTransportIncludesRegion, true);
  assert.ok(Math.abs(evidence.regionEngineAuditionStartSeconds - evidence.expectedRegionStartSeconds) <= 0.75);
  assert.ok(Math.abs(evidence.regionEngineAuditionDurationSeconds - evidence.expectedRegionDurationSeconds) <= 0.75);
  assert.equal(evidence.manifestExists, true);
  assert.equal(evidence.dashboardExists, true);
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
  const sourceDuration = row.analysis?.duration_seconds || 0;
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
        analysis: row.analysis,
        waveform: row.waveform,
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
    analysisDurationSeconds: sourceDuration,
    analysisIntegratedLufs: row.analysis?.integrated_lufs ?? null,
    analysisTruePeakDbfs: row.analysis?.true_peak_dbfs ?? null,
    expectedRegionDurationSeconds,
    expectedRegionStartSeconds,
    regionEndFraction,
    regionStartFraction,
    sourcePath,
    title,
    waveformBins: row.waveform?.length ?? 0,
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
  const activeMode = text(document.querySelector('.mode-tabs button.active'));
  const trackCountLabel = text(document.querySelector('.library .panel-title span'));
  const trackVisible = document.body.innerText.includes(${JSON.stringify(seeded.title)});
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
  const regionPreviewReadyVisible = await waitFor(() => /Region engine preview ready: ([^\\n]+)/.test(logText()), 180000);
  if (!regionPreviewReadyVisible) {
    throw new Error('Region preview did not render through the visible UI: ' + JSON.stringify({
      log: logText().slice(-2000),
      progress: text(document.querySelector('.progress-readout'))
    }));
  }
  const regionPreviewMatch = /Region engine preview ready: ([^\\n]+)/.exec(logText());
  const regionPreviewMasterPath = regionPreviewMatch?.[1]?.trim() || '';
  const regionEngineAuditionReady = await waitFor(() => {
    const audition = window.__AMS_REGION_ENGINE_AUDITION__ || {};
    return Boolean(
      audition.path === regionPreviewMasterPath &&
      text(document.querySelector('.preview-parity-status')) === 'Render-faithful region' &&
      transportLabel().includes('Engine Region')
    );
  }, 10000);
  if (!regionEngineAuditionReady) {
    throw new Error('Region preview did not hand off to engine-rendered region playback: ' + JSON.stringify({
      audition: window.__AMS_REGION_ENGINE_AUDITION__ || null,
      expectedPath: regionPreviewMasterPath,
      previewParity: text(document.querySelector('.preview-parity-status')),
      transportLabel: transportLabel(),
      log: logText().slice(-2000)
    }));
  }
  const audioLoadedRegion = await waitFor(() => audio()?.duration > 0 && !Number.isNaN(audio()?.duration), 10000);
  const regionPreviewParity = text(document.querySelector('.preview-parity-status'));
  const transportDurationSeconds = audio()?.duration || 0;
  return JSON.stringify({
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    activeMode,
    trackCountLabel,
    trackVisible,
    regionCreated,
    regionReadoutAfterDrag,
    regionPreviewButtonEnabledBefore,
    regionPreviewReadyVisible,
    regionPreviewMasterPath,
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
