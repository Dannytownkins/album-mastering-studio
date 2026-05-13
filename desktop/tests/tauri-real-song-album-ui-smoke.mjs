import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const releaseExe =
  process.env.AMS_TAURI_RELEASE_EXE ||
  path.join(repoRoot, "desktop", "src-tauri", "target", "release", "album-mastering-studio.exe");
const outputRoot = process.env.AMS_TAURI_REAL_SONG_ALBUM_OUTPUT || path.join(repoRoot, "test-output", "tauri-real-song-album-ui-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const sourcePaths = readAlbumSourcePaths();
const sourcePath = sourcePaths[0];
const distinctSourceCount = new Set(sourcePaths.map((item) => path.resolve(item).toLocaleLowerCase())).size;
const sourceMode = distinctSourceCount > 1 ? "multi-song" : "single-song-derived-clips";
const cdpPort = process.env.TAURI_CDP_PORT || "9222";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const useExistingApp = process.env.AMS_TAURI_USE_EXISTING_APP === "1";
const albumPlaybackSeconds = Number(process.env.AMS_REAL_SONG_ALBUM_PLAYBACK_SECONDS || 20);
const statePath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "recent-session.json");
const stateBackup = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;

assert.ok(sourcePaths.length >= 1, "Set AMS_REAL_SONG_PATH or AMS_REAL_SONG_ALBUM_PATHS to local audio files for this smoke.");
assert.ok(sourcePaths.length <= 8, "Album Master smoke supports up to 8 source files.");
if (!useExistingApp) {
  assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
}
for (const candidate of sourcePaths) {
  assert.equal(existsSync(candidate), true, `Real-song fixture does not exist: ${candidate}`);
}
mkdirSync(inputsDir, { recursive: true });

const albumClips = writeAlbumClips(sourcePaths, inputsDir);
const clipPaths = albumClips.map((clip) => clip.path);
const browserArguments = [
  process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
  `--remote-debugging-port=${cdpPort}`,
]
  .filter(Boolean)
  .join(" ");
const app = useExistingApp
  ? null
  : spawn(releaseExe, [], {
      cwd: path.dirname(releaseExe),
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArguments },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
const stdout = [];
const stderr = [];
app?.stdout?.on("data", (chunk) => stdout.push(chunk.toString()));
app?.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));

let cdp;
try {
  const target = await findTauriPageTarget();
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitForCondition(cdp, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'", 15000);

  const seeded = await seedAlbumSession(cdp, clipPaths);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForCondition(cdp, "document.body.innerText.includes('Album Clip 1')", 15000);

  const smoke = await evaluateInWebView(cdp, realSongAlbumUiExpression(albumPlaybackSeconds));
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-real-song-album-ui.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const manifestPath = smoke.manifestPath;
  const dashboardPath = smoke.dashboardPath;
  const albumSequencePath = smoke.albumSequencePath;
  const evidence = {
    ...seeded,
    ...smoke,
    manifestExists: existsSync(manifestPath),
    dashboardExists: existsSync(dashboardPath),
    albumSequenceExists: existsSync(albumSequencePath),
    albumPlaybackCachePathExists: existsSync(smoke.albumPlaybackCachePath),
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    launchedReleaseApp: !useExistingApp,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
  };

  assert.equal(evidence.initialMode, "Album Master");
  assert.equal(evidence.sourceMode, sourceMode);
  assert.equal(evidence.distinctSourceCount, distinctSourceCount);
  assert.equal(evidence.seededTrackCount, `${clipPaths.length} / 8 tracks`);
  assert.equal(evidence.generatedTransitionsEnabled, true);
  assert.equal(evidence.analyzeButtonEnabled, true);
  assert.equal(evidence.exportEnabledAfterAnalyze, true);
  assert.equal(evidence.sourceLufsVisible, true);
  assert.equal(evidence.albumStoryVisibleBeforeRender, true);
  assert.equal(evidence.albumRoleCardCountBeforeRender, clipPaths.length);
  assert.equal(evidence.albumRoleOverrideApplied, true);
  assert.equal(evidence.renderedOverrideCharacter, "heavy_djent");
  assert.equal(evidence.renderComplete, true);
  assert.equal(evidence.exportReceiptVisible, true);
  assert.ok(evidence.exportReceiptText.includes("Album WAV"));
  assert.ok(["pass", "warn"].includes(evidence.exportChecks.status));
  assert.equal(evidence.exportChecks.track_count, clipPaths.length);
  assert.equal(evidence.exportChecks.interlude_count, clipPaths.length - 1);
  assert.ok(evidence.exportCheckLabels.includes("Track outputs"));
  assert.ok(evidence.exportCheckLabels.includes("Meter values"));
  assert.equal(evidence.trackOutputsCheckStatus, "pass");
  assert.equal(evidence.albumWavCheckStatus, "pass");
  assert.equal(typeof evidence.manifestAlbumStory, "string");
  assert.ok(evidence.manifestAlbumStory.length > 20);
  assert.equal(evidence.albumWavButtonEnabled, true);
  assert.equal(evidence.albumPlaybackReady, true);
  assert.equal(evidence.nativeFileButtonEnabled, true);
  assert.equal(evidence.nativeFileStarted, true);
  assert.match(evidence.nativeFileStatusAfterStart?.label || "", /^Native file:/);
  assert.equal(evidence.nativeFileStatusAfterStart?.active, true);
  assert.equal(evidence.nativeFileStatusTextAfterStart, "Native playback playing");
  assert.equal(evidence.nativeFilePaused, true);
  assert.equal(evidence.nativeFilePausedStatus?.paused, true);
  assert.equal(evidence.nativeFileSeekSliderVisible, true);
  assert.equal(evidence.nativeFileSeeked, true);
  assert.ok(evidence.nativeFileSeekedStatus?.position_seconds >= evidence.nativeFileSeekTargetSeconds - 0.03);
  assert.equal(evidence.nativeFileResumed, true);
  assert.equal(evidence.nativeFileResumedStatus?.active, true);
  assert.equal(evidence.nativeFileResumedStatus?.paused, false);
  assert.equal(evidence.nativeFileStoppedStatus?.active, false);
  assert.equal(evidence.nativeStatusTextAfterFileStop, "Native transport ready");
  assert.equal(evidence.albumPlaybackCachePathExists, true);
  assert.equal(evidence.albumPlaybackStability?.source_sample_format, "PCM_S16LE");
  assert.equal(evidence.albumPlaybackStability?.source_sample_rate, 48000);
  assert.equal(evidence.albumPlaybackStability?.requested_duration_ms, albumPlaybackSeconds * 1000);
  assert.ok(evidence.albumPlaybackStability?.callback_count >= 1);
  assert.ok(evidence.albumPlaybackStability?.queued_output_frames >= 48000 * albumPlaybackSeconds * 0.9);
  assert.ok(evidence.albumPlaybackStability?.played_output_frames >= 48000 * albumPlaybackSeconds * 0.65);
  assert.equal(Array.isArray(evidence.albumPlaybackStability?.stream_errors), true);
  assert.equal(evidence.albumPlaybackStability.stream_errors.length, 0);
  assert.equal(Array.isArray(evidence.albumPlaybackStability?.warnings), true);
  assert.equal(evidence.transitionPlaybackReady, true);
  assert.equal(evidence.dashboardLoaded, true);
  assert.equal(evidence.manifestExists, true);
  assert.equal(evidence.dashboardExists, true);
  assert.equal(evidence.albumSequenceExists, true);
  assert.equal(evidence.manifestTrackCount, clipPaths.length);
  assert.equal(evidence.manifestInterludeCount, clipPaths.length - 1);
  assert.equal(evidence.sequenceTrackCount, clipPaths.length);
  assert.equal(evidence.sequenceInterludeCount, clipPaths.length - 1);
  assert.equal(Array.isArray(evidence.manifestWarnings), true);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-real-song-album-ui-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  await sleep(1000);
  restoreAutosave();
  cdp?.close();
  app?.kill();
}

function readAlbumSourcePaths() {
  const albumPaths = (process.env.AMS_REAL_SONG_ALBUM_PATHS || "").trim();
  if (albumPaths) {
    const parsed = albumPaths.startsWith("[")
      ? JSON.parse(albumPaths)
      : albumPaths.split(path.delimiter).map((item) => item.trim()).filter(Boolean);
    assert.equal(Array.isArray(parsed), true, "AMS_REAL_SONG_ALBUM_PATHS must be a JSON array or path-delimited list.");
    assert.ok(parsed.length >= 2, "AMS_REAL_SONG_ALBUM_PATHS must contain at least two files for a multi-song Album Master smoke.");
    const resolved = parsed.map((item) => path.resolve(String(item)));
    const distinct = new Set(resolved.map((item) => item.toLocaleLowerCase())).size;
    assert.ok(distinct >= 2, "AMS_REAL_SONG_ALBUM_PATHS must contain at least two distinct files.");
    return resolved;
  }
  assert.ok(process.env.AMS_REAL_SONG_PATH, "Set AMS_REAL_SONG_PATH to a local audio file for this smoke.");
  return [path.resolve(process.env.AMS_REAL_SONG_PATH)];
}

function writeAlbumClips(sources, targetDir) {
  if (sources.length > 1) {
    return sources.map((source, index) => writeAlbumClip(source, targetDir, index, 0));
  }
  const offsets = [0, 32, 64];
  const clipLengthSeconds = Number(process.env.AMS_REAL_SONG_ALBUM_CLIP_SECONDS || 10);
  return offsets.map((offset, index) => writeAlbumClip(sources[0], targetDir, index, offset, clipLengthSeconds));
}

function writeAlbumClip(source, targetDir, index, offsetSeconds, clipLengthSeconds = Number(process.env.AMS_REAL_SONG_ALBUM_CLIP_SECONDS || 10)) {
  const output = path.join(targetDir, `${String(index + 1).padStart(2, "0")}_${safeClipName(fileStem(source))}_album_clip.wav`);
  const result = spawnSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(offsetSeconds),
      "-t",
      String(clipLengthSeconds),
      "-i",
      source,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-sample_fmt",
      "s16",
      output,
    ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(output), true, `Expected album clip was not created: ${output}`);
  return { path: output, source, sourceTitle: fileStem(source) };
}

async function seedAlbumSession(cdp, paths) {
  const title = albumFixtureTitle();
  const session = {
    version: 2,
    savedAt: new Date().toISOString(),
    mode: "album",
    settings: {
      albumTitle: `${title} Album UI Smoke`,
      artist: "Real Song Fixture",
      albumArtist: "",
      genre: "",
      year: "",
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
      transitionsEnabled: true,
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
    tracks: paths.map((clipPath, index) => ({
      id: `real-album-clip-${index + 1}`,
      path: clipPath,
      title: `Album Clip ${index + 1}`,
      artist: "Real Song Fixture",
      isrc: "",
      character: "auto",
      preset: "auto",
    })),
    selectedTrackId: "real-album-clip-1",
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
    sourcePath,
    sourcePaths,
    sourceMode,
    distinctSourceCount,
    sourceTitle: title,
    albumClipSources: albumClips.map((clip) => clip.source),
    derivedClipPaths: paths,
  };
}

function albumFixtureTitle() {
  if (sourceMode === "multi-song") return "Multi-Song";
  return fileStem(sourcePath);
}

function restoreAutosave() {
  mkdirSync(path.dirname(statePath), { recursive: true });
  if (stateBackup == null) {
    rmSync(statePath, { force: true });
  } else {
    writeFileSync(statePath, stateBackup);
  }
}

function realSongAlbumUiExpression(playbackSeconds) {
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
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  };
  const initialMode = text(document.querySelector('.mode-tabs button.active'));
  const seededTrackCount = text(document.querySelector('.library .panel-title span'));
  const generatedTransitionsEnabled = Array.from(document.querySelectorAll('.album-controls .check-row'))
    .find((item) => text(item).includes('Generated transitions'))
    ?.querySelector('input')
    ?.checked === true;
  const analyzeButton = buttonByText('Analyze');
  const analyzeButtonEnabled = !analyzeButton.disabled;
  click(analyzeButton);
  const analyzed = await waitFor(() => !buttonByText('Export Album').disabled, 120000);
  if (!analyzed) throw new Error('Album clips did not finish analysis in the UI');
  const exportEnabledAfterAnalyze = !buttonByText('Export Album').disabled;
  const sourceLufsMetric = Array.from(document.querySelectorAll('.metric')).find((item) => text(item).startsWith('Source LUFS'));
  const sourceLufsVisible = !!sourceLufsMetric && !text(sourceLufsMetric).includes('--');
  const albumStoryVisibleBeforeRender = document.body.innerText.includes('Album Story / Roles');
  const albumRoleCardCountBeforeRender = document.querySelectorAll('.album-role-card').length;
  const roleOverride = document.querySelector('select[aria-label="Override role for Album Clip 2"]');
  if (!roleOverride) throw new Error('Album role override select not found before render');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(roleOverride, 'heavy_djent');
  roleOverride.dispatchEvent(new Event('change', { bubbles: true }));
  const albumRoleOverrideApplied = roleOverride.value === 'heavy_djent';

  click(buttonByText('Export Album'));
  const renderComplete = await waitFor(() => text(document.querySelector('.progress-readout')).includes('Album render complete.'), 240000);
  if (!renderComplete) throw new Error('Album render did not complete from the visible UI command');
  const exportReceiptAppeared = await waitFor(() => text(document.querySelector('.export-receipt')).includes('Album WAV'), 10000);
  if (!exportReceiptAppeared) throw new Error('Album export checks receipt did not appear after render');
  const exportReceiptText = text(document.querySelector('.export-receipt'));
  const exportReceiptVisible = !!document.querySelector('.export-receipt');

  const logText = document.querySelector('.log')?.textContent || '';
  const renderLine = logText.split(/\\r?\\n/).reverse().find((line) => line.includes('Album render complete:')) || '';
  const outputDir = renderLine.split(' transitions. ').pop().trim();
  if (!outputDir || outputDir === renderLine) throw new Error('Could not parse album output dir from UI log: ' + renderLine);
  const manifestPath = outputDir + '/manifest.json';
  const dashboardPath = outputDir + '/dashboard.html';
  const manifest = await window.__TAURI_INTERNALS__.invoke('read_json', { path: manifestPath });
  const exportChecks = await window.__TAURI_INTERNALS__.invoke('run_export_checks', { manifest });
  const exportCheckLabels = (exportChecks.checks || []).map((check) => check.label);
  const trackOutputsCheckStatus = (exportChecks.checks || []).find((check) => check.label === 'Track outputs')?.status;
  const albumWavCheckStatus = (exportChecks.checks || []).find((check) => check.label === 'Album WAV')?.status;
  const albumSequencePath = manifest.album_sequence;
  const sequence = manifest.sequence || [];
  const albumWavButton = buttonByText('Album WAV');
  const albumWavButtonEnabled = !albumWavButton.disabled;
  click(albumWavButton);
  const albumPlaybackReady = await waitFor(() => text(document.querySelector('.transport-label')).includes('album_sequence.wav'), 90000);
  const nativeFileButton = buttonByText('Native Play');
  const nativeFileButtonEnabled = !nativeFileButton.disabled;
  click(nativeFileButton);
  const nativeFileStarted = await waitFor(() => text(document.querySelector('.native-audition-status')).startsWith('Native playback '), 20000);
  if (!nativeFileStarted) throw new Error('Native file playback did not start from the visible transport button');
  await new Promise((resolve) => setTimeout(resolve, 650));
  const nativeFileStatusAfterStart = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
  const nativeFileStatusTextAfterStart = text(document.querySelector('.native-audition-status'));
  click(buttonByText('Pause'));
  const nativeFilePaused = await waitFor(async () => (await window.__TAURI_INTERNALS__.invoke('native_playback_status')).paused, 10000);
  if (!nativeFilePaused) throw new Error('Native file playback did not pause from the visible UI button');
  const nativeFilePausedStatus = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
  const nativeFileSeekSlider = document.querySelector('input[aria-label="Native playback position"]');
  const nativeFileSeekSliderVisible = !!nativeFileSeekSlider;
  if (!nativeFileSeekSlider) throw new Error('Native playback position slider not found for album WAV');
  const nativeFileSeekTargetSeconds = Math.max(0.1, Math.min(2.0, (nativeFilePausedStatus.duration_seconds || 1) * 0.35));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(nativeFileSeekSlider, String(nativeFileSeekTargetSeconds));
  nativeFileSeekSlider.dispatchEvent(new Event('input', { bubbles: true }));
  nativeFileSeekSlider.dispatchEvent(new Event('change', { bubbles: true }));
  const nativeFileSeeked = await waitFor(async () => {
    const status = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
    return status.position_seconds >= nativeFileSeekTargetSeconds - 0.03;
  }, 10000);
  if (!nativeFileSeeked) throw new Error('Native file playback did not seek from the visible UI slider');
  const nativeFileSeekedStatus = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
  click(buttonByText('Resume'));
  const nativeFileResumed = await waitFor(async () => {
    const status = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
    return status.active && !status.paused;
  }, 10000);
  if (!nativeFileResumed) throw new Error('Native file playback did not resume from the visible UI button');
  await new Promise((resolve) => setTimeout(resolve, 650));
  const nativeFileResumedStatus = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
  click(buttonByText('Native Stop'));
  await waitFor(async () => !(await window.__TAURI_INTERNALS__.invoke('native_playback_status')).active, 10000);
  await waitFor(() => text(document.querySelector('.native-audition-status')) === 'Native transport ready', 10000);
  const nativeFileStoppedStatus = await window.__TAURI_INTERNALS__.invoke('native_playback_status');
  const nativeStatusTextAfterFileStop = text(document.querySelector('.native-audition-status'));
  const albumPlaybackCachePath = await window.__TAURI_INTERNALS__.invoke('prepare_playback_file', { path: albumSequencePath });
  const albumPlaybackStability = await window.__TAURI_INTERNALS__.invoke('native_playback_file_probe', {
    path: albumPlaybackCachePath,
    durationMs: ${JSON.stringify(Math.round(albumPlaybackSeconds * 1000))},
    startSeconds: 0
  });
  const artifactButtons = Array.from(document.querySelectorAll('.artifact-grid button'));
  if (artifactButtons.length < 2) throw new Error('Expected album transition artifact buttons');
  click(artifactButtons[1]);
  const transitionPlaybackReady = await waitFor(() => text(document.querySelector('.transport-label')).includes('Transition'), 90000);
  const dashboardLoaded = !!document.querySelector('.dashboard-pane iframe');

  return JSON.stringify({
    initialMode,
    seededTrackCount,
    generatedTransitionsEnabled,
    analyzeButtonEnabled,
    exportEnabledAfterAnalyze,
    sourceLufsVisible,
    albumStoryVisibleBeforeRender,
    albumRoleCardCountBeforeRender,
    albumRoleOverrideApplied,
    renderComplete,
    exportReceiptVisible,
    exportReceiptText,
    exportChecks,
    exportCheckLabels,
    trackOutputsCheckStatus,
    albumWavCheckStatus,
    outputDir,
    manifestPath,
    dashboardPath,
    albumSequencePath,
    albumWavButtonEnabled,
    albumPlaybackReady,
    nativeFileButtonEnabled,
    nativeFileStarted,
    nativeFileStatusAfterStart,
    nativeFileStatusTextAfterStart,
    nativeFilePaused,
    nativeFilePausedStatus,
    nativeFileSeekSliderVisible,
    nativeFileSeekTargetSeconds,
    nativeFileSeeked,
    nativeFileSeekedStatus,
    nativeFileResumed,
    nativeFileResumedStatus,
    nativeFileStoppedStatus,
    nativeStatusTextAfterFileStop,
    albumPlaybackCachePath,
    albumPlaybackStability,
    transitionPlaybackReady,
    dashboardLoaded,
    manifestTrackCount: manifest.track_count,
    manifestInterludeCount: manifest.interlude_count,
    sequenceTrackCount: sequence.filter((item) => item.type === 'track').length,
    sequenceInterludeCount: sequence.filter((item) => item.type === 'interlude').length,
    renderedOverrideCharacter: sequence.find((item) => item.type === 'track' && item.index === 2)?.character?.label,
    manifestAlbumStory: manifest.album_story,
    manifestWarnings: manifest.warnings || []
  });
})()
`;
}

async function findTauriPageTarget() {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 20_000) {
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
  throw new Error(
    `Could not reach Tauri WebView CDP at ${cdpBase}. ${
      useExistingApp
        ? `Start Tauri dev with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${cdpPort}.`
        : `Release app was launched with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${cdpPort}.`
    } ${lastError || "timed out"}`,
  );
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

function fileStem(filePath) {
  return path.basename(filePath).replace(/\.[^.]+$/, "").replace(/\s+\(\d+\)$/, "");
}

function safeClipName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "real-song";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
