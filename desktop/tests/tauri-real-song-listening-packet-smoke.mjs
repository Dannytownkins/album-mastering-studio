import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const releaseExe =
  process.env.AMS_TAURI_RELEASE_EXE ||
  path.join(repoRoot, "desktop", "src-tauri", "target", "release", "album-mastering-studio.exe");
const outputRoot =
  process.env.AMS_TAURI_REAL_SONG_LISTENING_PACKET_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-real-song-listening-packet-smoke");
const sourcePath = process.env.AMS_REAL_SONG_PATH;
const cdpPort = process.env.TAURI_CDP_PORT || String(9360 + (process.pid % 500));
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const statePath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "recent-session.json");
const stateBackup = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;

assert.ok(sourcePath, "Set AMS_REAL_SONG_PATH to a local audio file for this smoke.");
assert.equal(existsSync(sourcePath), true, `Real-song fixture does not exist: ${sourcePath}`);
assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
safeRemove(outputRoot);
mkdirSync(outputRoot, { recursive: true });
const sourceBefore = fileSummary(sourcePath);

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

  const seeded = await seedRealSongSession(cdp);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForCondition(cdp, `document.body.innerText.includes(${JSON.stringify(seeded.title)})`, 15000);

  const smoke = await evaluateInWebView(cdp, realSongListeningPacketExpression(seeded.title));
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-real-song-listening-packet.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const listeningReceipt = JSON.parse(readFileSync(smoke.listeningReceiptPath, "utf8"));
  const listeningPacket = JSON.parse(readFileSync(smoke.listeningPacketJsonPath, "utf8"));
  const listeningPacketHtml = readFileSync(smoke.listeningPacketHtmlPath, "utf8");
  const trackManifestPaths = readdirSync(smoke.exportRoot)
    .map((entry) => path.join(smoke.exportRoot, entry, "manifest.json"))
    .filter((manifestPath) => existsSync(manifestPath) && statSync(path.dirname(manifestPath)).isDirectory())
    .sort();
  const trackManifests = trackManifestPaths.map((manifestPath) => JSON.parse(readFileSync(manifestPath, "utf8")));
  const codecPreviewOutputs = listeningPacket.codec_previews.map((preview) => preview.output || "");
  const sourceAfter = fileSummary(sourcePath);
  const evidence = {
    ...seeded,
    ...smoke,
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    outputRoot,
    sourceBefore,
    sourceAfter,
    sourceUnchanged: {
      size: sourceAfter.size === sourceBefore.size,
      sha256: sourceAfter.sha256 === sourceBefore.sha256,
    },
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
    listeningReceipt,
    listeningReceiptExists: existsSync(smoke.listeningReceiptPath),
    listeningPacket,
    listeningPacketJsonExists: existsSync(smoke.listeningPacketJsonPath),
    listeningPacketHtmlExists: existsSync(smoke.listeningPacketHtmlPath),
    listeningPacketHtmlIncludesCaveat: listeningPacketHtml.includes("not human approval"),
    listeningPacketHtmlIncludesAuditionScope: listeningPacketHtml.includes("Audition Scope"),
    listeningPacketHtmlIncludesApprovalBasis: listeningPacketHtml.includes("rendered preview/export, codec preview, or album WAV listening"),
    listeningPacketHtmlIncludesLivePreviewScope: listeningPacketHtml.includes("directional-only"),
    listeningPacketHtmlIncludesAudioControls: listeningPacketHtml.includes("<audio controls"),
    listeningPacketHtmlIncludesReviewDecision: listeningPacketHtml.includes('id="review-decision"'),
    listeningPacketHtmlIncludesReviewDownload: listeningPacketHtml.includes("Download review JSON"),
    listeningPacketHtmlIncludesReviewDecisionDefault: listeningPacketHtml.includes('status: approved ? "approved" : "not-approved"'),
    listeningPacketHtmlIncludesReviewDecisionFilename: listeningPacketHtml.includes("listening-review-decision.json"),
    listeningPacketHtmlIncludesOriginalAudio: listeningPacketHtml.includes(pathToFileURL(sourcePath).href),
    listeningPacketHtmlIncludesMasteredAudio: listeningPacketHtml.includes(pathToFileURL(listeningPacket.tracks[0]?.output || "").href),
    listeningPacketHtmlIncludesCodecPreview: codecPreviewOutputs.every((output) => listeningPacketHtml.includes(output)),
    listeningPacketHtmlIncludesCodecAudioControls: codecPreviewOutputs.every((output) => listeningPacketHtml.includes(pathToFileURL(output).href)),
    codecPreviewOutputs,
    codecPreviewOutputsExist: codecPreviewOutputs.every((output) => existsSync(output)),
    trackManifestPaths,
    trackManifestCount: trackManifestPaths.length,
    trackManifestCodecPreviewFlags: trackManifests.map((manifest) => manifest.settings?.codec_preview),
    trackOutputPaths: listeningPacket.tracks.map((track) => track.output || ""),
    trackOutputsExist: listeningPacket.tracks.every((track) => existsSync(track.output || "")),
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    targetTitle: target.title,
    targetUrl: target.url,
    cdpPort,
  };

  const resultPath = path.join(outputRoot, "tauri-real-song-listening-packet-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));

  assert.equal(evidence.releaseExeExists, true);
  assert.equal(evidence.appTextIncludesBrand, true);
  assert.equal(evidence.activeMode, "Track Master");
  assert.equal(evidence.trackVisible, true);
  assert.equal(evidence.codecCheckboxChecked, true);
  assert.equal(evidence.exportButtonEnabledBefore, true);
  assert.equal(evidence.trackExportReceiptVisible, true);
  assert.equal(evidence.trackExportReceiptTextIncludesSingleTrackSummary, true);
  assert.equal(evidence.trackExportReceiptTextIncludesCodecQc, true);
  assert.equal(evidence.trackExportReceiptTextIncludesTwoCodecPaths, true);
  assert.equal(evidence.codecPreviewRailVisible, true);
  assert.equal(evidence.aacCodecPreviewReady, true);
  assert.match(evidence.codecTransportLabel, /AAC 256k/);
  assert.equal(evidence.nativeCodecPreviewStarted, true);
  assert.equal(evidence.nativeCodecPreviewStopped, true);
  assert.equal(evidence.persistedCodecPreviewAudition, true);
  assert.match(evidence.persistedListeningNotes, /human sound approval still required/);
  assert.equal(evidence.listeningReceiptSaved, true);
  assert.equal(evidence.listeningPacketSaved, true);
  assert.equal(evidence.listeningReceiptExists, true);
  assert.equal(evidence.listeningPacketJsonExists, true);
  assert.equal(evidence.listeningPacketHtmlExists, true);
  assert.equal(evidence.listeningReceipt.status, "not-approved");
  assert.equal(evidence.listeningReceipt.approved, false);
  assert.equal(evidence.listeningReceipt.stale, false);
  assert.equal(evidence.listeningReceipt.render.track_count, 1);
  assert.equal(evidence.listeningReceipt.render.interlude_count, 0);
  assert.equal(evidence.listeningReceipt.export_checks.status, "pass");
  assert.equal(evidence.listeningReceipt.codec_previews.length, 2);
  assert.equal(evidence.listeningReceipt.checklist.codecPreviewAudition, true);
  assert.equal(evidence.listeningReceipt.audition_context.preview_parity, "Codec preview audition");
  assert.equal(evidence.listeningReceipt.audition_context.transport_kind, "codec");
  assert.equal(evidence.listeningReceipt.approval_scope.live_preview, "directional-only");
  assert.equal(evidence.listeningPacket.status, "not-approved");
  assert.equal(evidence.listeningPacket.approved, false);
  assert.equal(evidence.listeningPacket.render.track_count, 1);
  assert.equal(evidence.listeningPacket.render.interlude_count, 0);
  assert.equal(evidence.listeningPacket.tracks.length, 1);
  assert.equal(evidence.listeningPacket.transitions.length, 0);
  assert.equal(evidence.listeningPacket.codec_previews.length, 2);
  assert.equal(evidence.listeningPacket.export_checks.status, "pass");
  assert.equal(evidence.listeningPacket.approval_scope.basis, "rendered preview/export, codec preview, or album WAV listening");
  assert.equal(evidence.listeningPacket.approval_scope.live_preview, "directional-only");
  assert.equal(evidence.listeningPacketHtmlIncludesCaveat, true);
  assert.equal(evidence.listeningPacketHtmlIncludesAuditionScope, true);
  assert.equal(evidence.listeningPacketHtmlIncludesApprovalBasis, true);
  assert.equal(evidence.listeningPacketHtmlIncludesLivePreviewScope, true);
  assert.equal(evidence.listeningPacketHtmlIncludesAudioControls, true);
  assert.equal(evidence.listeningPacketHtmlIncludesReviewDecision, true);
  assert.equal(evidence.listeningPacketHtmlIncludesReviewDownload, true);
  assert.equal(evidence.listeningPacketHtmlIncludesReviewDecisionDefault, true);
  assert.equal(evidence.listeningPacketHtmlIncludesReviewDecisionFilename, true);
  assert.equal(evidence.listeningPacketHtmlIncludesOriginalAudio, true);
  assert.equal(evidence.listeningPacketHtmlIncludesMasteredAudio, true);
  assert.equal(evidence.listeningPacketHtmlIncludesCodecPreview, true);
  assert.equal(evidence.listeningPacketHtmlIncludesCodecAudioControls, true);
  assert.equal(evidence.codecPreviewOutputsExist, true);
  assert.equal(evidence.trackManifestCount, 1);
  assert.deepEqual(evidence.trackManifestCodecPreviewFlags, [true]);
  assert.equal(evidence.trackOutputsExist, true);
  assert.equal(evidence.sourceUnchanged.size, true);
  assert.equal(evidence.sourceUnchanged.sha256, true);
  assert.equal(evidence.screenshotExists, true);

  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
  restoreStateFile();
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
  const session = {
    version: 2,
    savedAt: new Date().toISOString(),
    mode: "track",
    settings: {
      albumTitle: `${title} Listening Packet Smoke`,
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
      codecPreview: true,
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
        id: "real-song-listening-packet",
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
    selectedTrackId: "real-song-listening-packet",
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

function realSongListeningPacketExpression(title) {
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
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return false;
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
  const setTextareaValue = async (textarea, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  };
  const listeningLabel = (label) => {
    const item = Array.from(document.querySelectorAll('.check-toggle')).find((candidate) => text(candidate).includes(label));
    if (!item) throw new Error('Listening checkbox not found: ' + label);
    return item;
  };
  const codecButtonByText = (label) => {
    const button = Array.from(document.querySelectorAll('.codec-preview-actions button')).find((candidate) => text(candidate).includes(label));
    if (!button) throw new Error('Codec preview button not found: ' + label);
    return button;
  };
  const logText = () => document.querySelector('.log')?.textContent || '';
  const transportLabel = () => text(document.querySelector('.transport-label'));
  const activeMode = text(document.querySelector('.mode-tabs button.active'));
  const trackVisible = document.body.innerText.includes(${JSON.stringify(title)});
  const codecLabel = Array.from(document.querySelectorAll('label.check-row')).find((item) => text(item).includes('Codec QC'));
  const codecCheckboxChecked = codecLabel?.querySelector('input')?.checked === true;
  const exportButton = buttonByText('Export Master');
  const exportButtonEnabledBefore = !exportButton.disabled;
  if (!exportButtonEnabledBefore) {
    throw new Error('Track Master export button was disabled: ' + JSON.stringify({
      body: document.body.innerText.slice(-2000),
      log: logText().slice(-1000)
    }));
  }
  click(exportButton);
  const trackExportReceiptVisible = await waitFor(() => {
    const receipt = text(document.querySelector('.export-receipt'));
    return receipt.includes('1 track(s), 0 transition(s)') && receipt.includes('Codec QC');
  }, 240000);
  const trackExportReceiptText = text(document.querySelector('.export-receipt'));
  if (!trackExportReceiptVisible) {
    throw new Error('Track Master real-song receipt did not appear: ' + JSON.stringify({
      receipt: trackExportReceiptText,
      log: logText().slice(-3000)
    }));
  }
  const marker = 'Track Master export complete: 1 independent master(s). ';
  const markerIndex = logText().lastIndexOf(marker);
  const exportRoot = markerIndex >= 0 ? logText().slice(markerIndex + marker.length).split('\\n')[0].trim() : '';
  if (!exportRoot) throw new Error('Could not parse Track Master export root from log: ' + logText().slice(-2000));
  const codecPreviewRailVisible = await waitFor(
    () => text(document.querySelector('.codec-preview-panel')).includes('Codec Previews') &&
      text(document.querySelector('.codec-preview-panel')).includes('AAC 256k') &&
      text(document.querySelector('.codec-preview-panel')).includes('Opus 192k'),
    10000,
  );
  click(codecButtonByText('AAC 256k'));
  const aacCodecPreviewReady = await waitFor(
    () => logText().includes('Playback ready:') && transportLabel().includes('AAC 256k'),
    30000,
  );
  const codecTransportLabel = transportLabel();
  click(buttonByText('Native Play'));
  const nativeCodecPreviewStarted = await waitFor(
    () => text(document.querySelector('.native-audition-status')).includes('Native playback playing'),
    30000,
  );
  if (nativeCodecPreviewStarted) {
    click(buttonByText('Native Stop'));
  }
  const nativeCodecPreviewStopped = await waitFor(
    () => text(document.querySelector('.native-audition-status')).includes('Native transport ready'),
    10000,
  );
  click(listeningLabel('Codec preview checked'));
  await setTextareaValue(
    document.querySelector('textarea[aria-label="Listening notes"]'),
    'Real-song Track Master listening packet prepared by automated smoke; human sound approval still required.',
  );
  const persistedListening = await waitForPersisted(
    (session) =>
      session?.listeningChecklist?.codecPreviewAudition === true &&
      session?.listeningChecklist?.notes === 'Real-song Track Master listening packet prepared by automated smoke; human sound approval still required.',
    12000,
  );
  const saveReceiptButton = buttonByText('Save Receipt');
  if (saveReceiptButton.disabled) throw new Error('Save Receipt was disabled after export');
  click(saveReceiptButton);
  const listeningReceiptSaved = await waitFor(() => logText().includes('Listening receipt saved:'), 10000);
  if (!listeningReceiptSaved) throw new Error('Listening receipt was not saved: ' + logText().slice(-2000));
  const listeningReceiptPath = exportRoot + '\\\\listening-review.json';
  const savePacketButton = buttonByText('Save Listening Packet');
  if (savePacketButton.disabled) throw new Error('Save Listening Packet was disabled after export');
  click(savePacketButton);
  const listeningPacketSaved = await waitFor(() => logText().includes('Listening packet saved:'), 10000);
  if (!listeningPacketSaved) throw new Error('Listening packet was not saved: ' + logText().slice(-2000));
  const listeningPacketJsonPath = exportRoot + '\\\\listening-handoff.json';
  const listeningPacketHtmlPath = exportRoot + '\\\\listening-handoff.html';
  return JSON.stringify({
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    activeMode,
    trackVisible,
    codecCheckboxChecked,
    exportButtonEnabledBefore,
    trackExportReceiptVisible,
    trackExportReceiptText,
    trackExportReceiptTextIncludesSingleTrackSummary: trackExportReceiptText.includes('1 track(s), 0 transition(s)'),
    trackExportReceiptTextIncludesCodecQc: trackExportReceiptText.includes('Codec QC'),
    trackExportReceiptTextIncludesTwoCodecPaths: trackExportReceiptText.includes('2 codec preview path(s) exist'),
    codecPreviewRailVisible,
    aacCodecPreviewReady,
    codecTransportLabel,
    nativeCodecPreviewStarted,
    nativeCodecPreviewStopped,
    persistedCodecPreviewAudition: persistedListening?.listeningChecklist?.codecPreviewAudition,
    persistedListeningNotes: persistedListening?.listeningChecklist?.notes || '',
    listeningReceiptSaved,
    listeningReceiptPath,
    listeningPacketSaved,
    listeningPacketJsonPath,
    listeningPacketHtmlPath,
    exportRoot
  });
})()
`;
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
  const allowedRoot = path.resolve(repoRoot, "test-output");
  assert.equal(target.startsWith(allowedRoot), true, `Refusing to remove path outside test-output: ${target}`);
  rmSync(target, { force: true, recursive: true });
}

function fileSummary(filePath) {
  const stats = statSync(filePath);
  return {
    path: filePath,
    size: stats.size,
    sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
    modified: stats.mtime.toISOString(),
  };
}

function fileStem(filePath) {
  return path.basename(filePath).replace(/\.[^.]+$/, "") || "Real Song";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
