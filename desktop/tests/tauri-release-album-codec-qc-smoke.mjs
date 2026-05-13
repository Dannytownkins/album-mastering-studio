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
  process.env.AMS_TAURI_RELEASE_ALBUM_CODEC_QC_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-release-album-codec-qc-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const cdpPort = process.env.TAURI_CDP_PORT || "9352";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const statePath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "recent-session.json");
const stateBackup = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;

assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
safeRemove(outputRoot);
mkdirSync(inputsDir, { recursive: true });
const fixturePaths = [
  path.join(inputsDir, "01_album_codec_qc.wav"),
  path.join(inputsDir, "02_album_codec_qc.wav"),
];
writePcm16Fixture(fixturePaths[0], 174.61, 5.0);
writePcm16Fixture(fixturePaths[1], 261.63, 5.2);

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

  await evaluateInWebView(cdp, seedAlbumCodecQcExpression());
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForCondition(cdp, "document.body.innerText.includes('Album Codec Fixture 1')", 15000);

  const smoke = await evaluateInWebView(cdp, albumCodecQcExpression());
  const manifest = JSON.parse(readFileSync(path.join(smoke.outputDir, "manifest.json"), "utf8"));
  const listeningReceipt = JSON.parse(readFileSync(smoke.listeningReceiptPath, "utf8"));
  const codecPreviews = manifest.codec_previews || [];
  const codecPreviewOutputs = codecPreviews.map((preview) => preview.output || "");
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-release-album-codec-qc.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...smoke,
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
    manifestCodecPreviewFlag: manifest.settings?.codec_preview,
    manifestAlbumSequence: manifest.album_sequence,
    listeningReceipt,
    listeningReceiptExists: existsSync(smoke.listeningReceiptPath),
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
  assert.equal(evidence.activeMode, "Album Master");
  assert.equal(evidence.trackCountLabel, "2 / 8 tracks");
  assert.equal(evidence.renderComplete, true);
  assert.equal(evidence.albumReceiptIncludesCodecQc, true);
  assert.equal(evidence.albumReceiptIncludesTwoCodecPaths, true);
  assert.equal(evidence.albumCodecButtonsVisible, true);
  assert.equal(evidence.albumCodecButtonCount, 2);
  assert.equal(evidence.albumExportHistoryVisible, true);
  assert.equal(evidence.albumExportHistoryDashboardEnabled, true);
  assert.equal(evidence.albumExportHistoryPlayEnabled, true);
  assert.equal(evidence.albumExportHistoryPlaybackReady, true);
  assert.equal(evidence.persistedAlbumExportHistory, true);
  assert.equal(evidence.albumWavPlaybackReady, true);
  assert.match(evidence.albumWavTransportLabel, /album_sequence\.wav/);
  assert.equal(evidence.albumWavParity, "Render-faithful album");
  assert.match(evidence.albumWavParityTitle, /rendered continuous album WAV/);
  assert.equal(evidence.albumAacPlaybackReady, true);
  assert.match(evidence.codecTransportLabel, /Album AAC 256k/);
  assert.equal(evidence.codecPreviewParity, "Codec preview audition");
  assert.match(evidence.codecPreviewParityTitle, /local QC/);
  assert.equal(evidence.codecPreviewParityWarn, false);
  assert.equal(evidence.nativeAlbumCodecStarted, true);
  assert.equal(evidence.nativeAlbumCodecStopped, true);
  assert.equal(evidence.persistedCodecPreviewAudition, true);
  assert.equal(evidence.listeningReceiptExists, true);
  assert.equal(evidence.listeningReceipt.status, "not-approved");
  assert.equal(evidence.listeningReceipt.approved, false);
  assert.equal(evidence.listeningReceipt.stale, false);
  assert.equal(evidence.listeningReceipt.checklist.codecPreviewAudition, true);
  assert.equal(evidence.listeningReceipt.render.track_count, 2);
  assert.equal(evidence.listeningReceipt.render.interlude_count, 0);
  assert.equal(evidence.listeningReceipt.export_checks.status, "pass");
  assert.equal(evidence.listeningReceipt.codec_previews.length, 2);
  assert.equal(evidence.listeningReceipt.audition_context.preview_parity, "Codec preview audition");
  assert.equal(evidence.listeningReceipt.audition_context.transport_label, "Album AAC 256k");
  assert.equal(evidence.listeningReceipt.audition_context.transport_kind, "codec");
  assert.equal(evidence.listeningReceipt.audition_context.live_preview.contract_preview_parity, "approximate");
  assert.equal(evidence.listeningReceipt.audition_context.live_preview.modeled_controls.includes("Low"), true);
  assert.equal(evidence.listeningReceipt.audition_context.native_playback.status, "ready");
  assert.equal(evidence.manifestCodecPreviewFlag, true);
  assert.equal(evidence.codecPreviewCount, 2);
  assert.equal(evidence.codecPreviewOutputsExist, true);
  assert.deepEqual(evidence.codecPreviewCodecs, ["AAC 256k", "Opus 192k"]);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-release-album-codec-qc-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
  restoreStateFile();
}

function seedAlbumCodecQcExpression() {
  const waveform = Array.from({ length: 96 }, (_, index) => Math.abs(Math.sin(index / 7)) * 0.72 + 0.12);
  const session = {
    version: 2,
    savedAt: new Date().toISOString(),
    mode: "album",
    settings: {
      albumTitle: "Release Album Codec QC",
      artist: "Album Codec Fixture",
      albumArtist: "Album Codec Fixture",
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
      id: `album-codec-qc-${index + 1}`,
      path: fixturePath,
      title: `Album Codec Fixture ${index + 1}`,
      artist: "Album Codec Fixture",
      isrc: "",
      character: "auto",
      preset: "auto",
      analysis: {
        duration_seconds: index === 0 ? 5.0 : 5.2,
        integrated_lufs: index === 0 ? -18.2 : -17.5,
        true_peak_dbfs: -5.5,
        loudness_range_lu_proxy: 3.4,
        spectral_centroid_hz: index === 0 ? 1350 : 2100,
        stereo_width: 0.18,
        transient_density: 0.22,
      },
      waveform: index === 0 ? waveform : [...waveform].reverse(),
    })),
    selectedTrackId: "album-codec-qc-1",
    projectPath: "",
    region: null,
    waveformZoom: 1,
    advancedOpen: true,
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

function albumCodecQcExpression() {
  return `
(async () => {
  const text = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
  const buttons = () => Array.from(document.querySelectorAll('button'));
  const buttonTexts = () => buttons().map((button) => ({ text: text(button), disabled: button.disabled, className: button.className || '' }));
  const buttonByText = (label) => {
    const button = buttons().find((item) => text(item).includes(label));
    if (!button) throw new Error('Button not found: ' + label);
    return button;
  };
  const artifactButtonByText = (label) => {
    const button = Array.from(document.querySelectorAll('.artifact-grid button')).find((item) => text(item).includes(label));
    if (!button) throw new Error('Artifact button not found: ' + label + ' / ' + text(document.querySelector('.artifact-grid')));
    return button;
  };
  const click = (element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const waitFor = async (predicate, timeoutMs) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return false;
  };
  const listeningLabel = (label) => {
    const item = Array.from(document.querySelectorAll('.check-toggle')).find((candidate) => text(candidate).includes(label));
    if (!item) throw new Error('Listening checkbox not found: ' + label);
    return item;
  };
  const waitForPersisted = async (predicate, timeoutMs) => {
    let latest = null;
    const ok = await waitFor(async () => {
      latest = await window.__TAURI_INTERNALS__.invoke('load_recent_session');
      return Boolean(predicate(latest));
    }, timeoutMs);
    if (!ok) throw new Error('Timed out waiting for persisted session: ' + JSON.stringify(latest));
    return latest;
  };
  const activeMode = text(document.querySelector('.mode-tabs button.active'));
  const trackCountLabel = text(document.querySelector('.library .panel-title span'));
  click(buttonByText('Export Album'));
  const renderComplete = await waitFor(() => text(document.querySelector('.progress-readout')).includes('Album render complete.'), 240000);
  if (!renderComplete) throw new Error('Album codec QC render did not complete');
  const receipt = text(document.querySelector('.export-receipt'));
  const albumReceiptIncludesCodecQc = receipt.includes('Codec QC');
  const albumReceiptIncludesTwoCodecPaths = receipt.includes('2 codec preview path(s) exist');
  const artifactText = text(document.querySelector('.artifact-grid'));
  const albumCodecButtonsVisible = artifactText.includes('Album WAV') && artifactText.includes('AAC 256k') && artifactText.includes('Opus 192k');
  const albumCodecButtonCount = Array.from(document.querySelectorAll('.artifact-grid button')).filter((button) => text(button).includes('Codec')).length;
  const transportLabel = () => text(document.querySelector('.transport-label'));
  const renderHistoryCards = () => Array.from(document.querySelectorAll('.render-history-card'));
  const historyCardButton = (card, label) => Array.from(card?.querySelectorAll('button') || []).find((button) => text(button).includes(label));
  const albumExportHistoryCard = () => renderHistoryCards()
    .find((card) => text(card).includes('Album Export') && text(card).includes('Release Album Codec QC Album'));
  const albumExportHistoryVisible = Boolean(albumExportHistoryCard());
  const albumExportHistoryDashboardButton = historyCardButton(albumExportHistoryCard(), 'Dashboard');
  const albumExportHistoryPlayButton = historyCardButton(albumExportHistoryCard(), 'Play');
  const albumExportHistoryDashboardEnabled = Boolean(albumExportHistoryDashboardButton && !albumExportHistoryDashboardButton.disabled);
  const albumExportHistoryPlayEnabled = Boolean(albumExportHistoryPlayButton && !albumExportHistoryPlayButton.disabled);
  if (albumExportHistoryPlayButton) click(albumExportHistoryPlayButton);
  const albumExportHistoryPlaybackReady = await waitFor(
    () => (document.querySelector('.log')?.textContent || '').includes('Playback ready: Release Album Codec QC Album') && transportLabel().includes('Release Album Codec QC Album'),
    30000,
  );
  const persistedAlbumHistory = await waitForPersisted(
    (session) => (session?.renderHistory || []).some((item) =>
      item.kind === 'album-export' &&
      item.label === 'Release Album Codec QC Album' &&
      item.primaryAudioKind === 'album' &&
      Boolean(item.primaryAudioPath) &&
      Boolean(item.dashboardPath)
    ),
    12000,
  );
  const persistedAlbumExportHistory = Boolean((persistedAlbumHistory?.renderHistory || []).find((item) => item.kind === 'album-export'));
  const previewParity = () => text(document.querySelector('.preview-parity-status'));
  const previewParityTitle = () => document.querySelector('.preview-parity-status')?.getAttribute('title') || '';
  const previewParityWarn = () => document.querySelector('.preview-parity-status')?.classList.contains('warn') ?? true;
  click(artifactButtonByText('Album WAV'));
  const albumWavPlaybackReady = await waitFor(
    () => (document.querySelector('.log')?.textContent || '').includes('Playback ready: album_sequence.wav') && transportLabel().includes('album_sequence.wav'),
    30000,
  );
  const albumWavTransportLabel = transportLabel();
  const albumWavParity = previewParity();
  const albumWavParityTitle = previewParityTitle();
  click(artifactButtonByText('AAC 256k'));
  const albumAacPlaybackReady = await waitFor(
    () => (document.querySelector('.log')?.textContent || '').includes('Playback ready: Album AAC 256k') && transportLabel().includes('Album AAC 256k'),
    30000,
  );
  const codecTransportLabel = transportLabel();
  const codecPreviewParity = previewParity();
  const codecPreviewParityTitle = previewParityTitle();
  const codecPreviewParityWarn = previewParityWarn();
  click(buttonByText('Native Play'));
  const nativeAlbumCodecStarted = await waitFor(() => text(document.querySelector('.native-audition-status')).includes('Native playback playing'), 30000);
  const nativeStopVisible = await waitFor(() => Boolean(buttons().find((button) => text(button).includes('Native Stop'))), 5000);
  if (!nativeStopVisible) {
    throw new Error('Native Stop was not visible after native playback start: ' + JSON.stringify({
      nativeStatus: text(document.querySelector('.native-audition-status')),
      progress: text(document.querySelector('.progress-readout')),
      transport: transportLabel(),
      buttons: buttonTexts(),
      log: (document.querySelector('.log')?.textContent || '').slice(-2000)
    }));
  }
  click(buttonByText('Native Stop'));
  const nativeAlbumCodecStopped = await waitFor(() => text(document.querySelector('.native-audition-status')).includes('Native transport ready'), 10000);
  click(listeningLabel('Codec preview checked'));
  const persisted = await waitForPersisted((session) => session?.listeningChecklist?.codecPreviewAudition === true, 12000);
  const logText = document.querySelector('.log')?.textContent || '';
  const renderLine = logText.split(/\\r?\\n/).reverse().find((line) => line.includes('Album render complete:')) || '';
  const outputDir = renderLine.split(' transitions. ').pop().trim();
  if (!outputDir || outputDir === renderLine) throw new Error('Could not parse album output dir from UI log: ' + renderLine);
  click(buttonByText('Save Receipt'));
  const listeningReceiptSaved = await waitFor(() => (document.querySelector('.log')?.textContent || '').includes('Listening receipt saved:'), 10000);
  if (!listeningReceiptSaved) throw new Error('Listening receipt was not saved');
  const listeningReceiptPath = outputDir + '\\\\listening-review.json';
  return JSON.stringify({
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    activeMode,
    trackCountLabel,
    renderComplete,
    albumReceiptIncludesCodecQc,
    albumReceiptIncludesTwoCodecPaths,
    albumCodecButtonsVisible,
    albumCodecButtonCount,
    albumExportHistoryVisible,
    albumExportHistoryDashboardEnabled,
    albumExportHistoryPlayEnabled,
    albumExportHistoryPlaybackReady,
    persistedAlbumExportHistory,
    albumWavPlaybackReady,
    albumWavTransportLabel,
    albumWavParity,
    albumWavParityTitle,
    albumAacPlaybackReady,
    codecTransportLabel,
    codecPreviewParity,
    codecPreviewParityTitle,
    codecPreviewParityWarn,
    nativeAlbumCodecStarted,
    nativeAlbumCodecStopped,
    persistedCodecPreviewAudition: persisted?.listeningChecklist?.codecPreviewAudition,
    listeningReceiptSaved,
    listeningReceiptPath,
    outputDir
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
