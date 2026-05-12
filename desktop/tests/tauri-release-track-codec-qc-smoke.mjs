import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const releaseExe =
  process.env.AMS_TAURI_RELEASE_EXE ||
  path.join(repoRoot, "desktop", "src-tauri", "target", "release", "album-mastering-studio.exe");
const outputRoot =
  process.env.AMS_TAURI_RELEASE_TRACK_CODEC_QC_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-release-track-codec-qc-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const cdpPort = process.env.TAURI_CDP_PORT || "9351";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const statePath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "recent-session.json");
const stateBackup = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;

assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
safeRemove(outputRoot);
mkdirSync(inputsDir, { recursive: true });
const fixturePaths = [
  path.join(inputsDir, "01_track_codec_qc.wav"),
  path.join(inputsDir, "02_track_codec_qc.wav"),
];
writePcm16Fixture(fixturePaths[0], 196.0, 1.65);
writePcm16Fixture(fixturePaths[1], 293.66, 1.75);

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

  await evaluateInWebView(cdp, seedTrackCodecQcExpression());
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForCondition(cdp, "document.body.innerText.includes('Codec QC Fixture 1')", 15000);

  const smoke = await evaluateInWebView(cdp, trackCodecQcExpression());
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-release-track-codec-qc.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const trackManifestPaths = readdirSync(smoke.exportRoot)
    .map((entry) => path.join(smoke.exportRoot, entry, "manifest.json"))
    .filter((manifestPath) => existsSync(manifestPath) && statSync(path.dirname(manifestPath)).isDirectory())
    .sort();
  const trackManifests = trackManifestPaths.map((manifestPath) => JSON.parse(readFileSync(manifestPath, "utf8")));
  const codecPreviews = trackManifests.flatMap((manifest) => manifest.codec_previews || []);
  const codecPreviewOutputs = codecPreviews.map((preview) => preview.output || "");
  const evidence = {
    ...smoke,
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
    trackManifestPaths,
    trackManifestCount: trackManifestPaths.length,
    trackManifestCodecPreviewFlags: trackManifests.map((manifest) => manifest.settings?.codec_preview),
    codecPreviewCount: codecPreviews.length,
    codecPreviewOutputs,
    codecPreviewOutputsExist: codecPreviewOutputs.every((output) => existsSync(output)),
    codecPreviewCodecs: codecPreviews.map((preview) => preview.codec),
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    targetTitle: target.title,
    targetUrl: target.url,
  };

  assert.equal(evidence.releaseExeExists, true);
  assert.equal(evidence.appTextIncludesBrand, true);
  assert.equal(evidence.activeMode, "Track Master");
  assert.equal(evidence.trackCountLabel, "2 / 8 tracks");
  assert.equal(evidence.codecCheckboxChecked, true);
  assert.equal(evidence.trackBatchReceiptVisible, true);
  assert.equal(evidence.trackBatchReceiptTextIncludesBatchSummary, true);
  assert.equal(evidence.trackBatchReceiptTextIncludesCodecQc, true);
  assert.equal(evidence.trackBatchReceiptTextIncludesFourCodecPaths, true);
  assert.equal(evidence.trackManifestCount, 2);
  assert.deepEqual(evidence.trackManifestCodecPreviewFlags, [true, true]);
  assert.equal(evidence.codecPreviewCount, 4);
  assert.equal(evidence.codecPreviewOutputsExist, true);
  assert.equal(evidence.codecPreviewCodecs.filter((codec) => codec === "AAC 256k").length, 2);
  assert.equal(evidence.codecPreviewCodecs.filter((codec) => codec === "Opus 192k").length, 2);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-release-track-codec-qc-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
  restoreStateFile();
}

function seedTrackCodecQcExpression() {
  const waveform = Array.from({ length: 96 }, (_, index) => Math.abs(Math.sin(index / 6.5)) * 0.7 + 0.1);
  const session = {
    version: 2,
    savedAt: new Date().toISOString(),
    mode: "track",
    settings: {
      albumTitle: "Release Track Codec QC",
      artist: "Codec Fixture",
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
      id: `track-codec-qc-${index + 1}`,
      path: fixturePath,
      title: `Codec QC Fixture ${index + 1}`,
      artist: "Codec Fixture",
      isrc: "",
      character: "auto",
      preset: "auto",
      analysis: {
        duration_seconds: index === 0 ? 1.65 : 1.75,
        integrated_lufs: index === 0 ? -18.6 : -17.8,
        true_peak_dbfs: -5.9,
        loudness_range_lu_proxy: 3.1,
        spectral_centroid_hz: index === 0 ? 1500 : 2200,
        stereo_width: 0.16,
        transient_density: 0.22,
      },
      waveform: index === 0 ? waveform : [...waveform].reverse(),
    })),
    selectedTrackId: "track-codec-qc-1",
    projectPath: "",
    region: null,
    waveformZoom: 1,
    advancedOpen: true,
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

function trackCodecQcExpression() {
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
  const activeMode = text(document.querySelector('.mode-tabs button.active'));
  const trackCountLabel = text(document.querySelector('.library .panel-title span'));
  const codecLabel = Array.from(document.querySelectorAll('label.check-row')).find((item) => text(item).includes('Codec QC'));
  const codecCheckboxChecked = codecLabel?.querySelector('input')?.checked === true;
  const exportButton = buttonByText('Export Master');
  const trackBatchExportButtonEnabledBefore = !exportButton.disabled;
  if (!trackBatchExportButtonEnabledBefore) {
    throw new Error('Track Master export button was disabled: ' + JSON.stringify({
      allText: document.body.innerText.slice(-2000),
      log: logText().slice(-1000)
    }));
  }
  exportButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const trackBatchReceiptVisible = await waitFor(
    () => {
      const receipt = text(document.querySelector('.export-receipt'));
      return receipt.includes('2 track(s), 0 transition(s)') && receipt.includes('Codec QC');
    },
    240000,
  );
  const trackBatchReceiptText = text(document.querySelector('.export-receipt'));
  if (!trackBatchReceiptVisible) {
    throw new Error('Track Master Codec QC receipt did not appear: ' + JSON.stringify({
      receipt: trackBatchReceiptText,
      log: logText().slice(-3000)
    }));
  }
  const marker = 'Track Master export complete: 2 independent master(s). ';
  const log = logText();
  const markerIndex = log.lastIndexOf(marker);
  const exportRoot = markerIndex >= 0 ? log.slice(markerIndex + marker.length).split('\\n')[0].trim() : '';
  if (!exportRoot) {
    throw new Error('Could not find Track Master export root in log: ' + log.slice(-2000));
  }
  return JSON.stringify({
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    activeMode,
    trackCountLabel,
    codecCheckboxChecked,
    trackBatchExportButtonEnabledBefore,
    trackBatchReceiptVisible,
    trackBatchReceiptText,
    trackBatchReceiptTextIncludesBatchSummary: trackBatchReceiptText.includes('2 track(s), 0 transition(s)'),
    trackBatchReceiptTextIncludesCodecQc: trackBatchReceiptText.includes('Codec QC'),
    trackBatchReceiptTextIncludesFourCodecPaths: trackBatchReceiptText.includes('4 codec preview path(s) exist'),
    exportRoot
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
    const envelope = fadeIn * fadeOut * 0.23;
    const tone = Math.sin(2 * Math.PI * frequency * t);
    const overtone = Math.sin(2 * Math.PI * frequency * 1.5 * t) * 0.12;
    const left = (tone + overtone) * envelope;
    const right = (tone * 0.9 - overtone * 0.08) * envelope;
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
