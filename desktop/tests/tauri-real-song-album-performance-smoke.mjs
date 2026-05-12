import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const releaseExe =
  process.env.AMS_TAURI_RELEASE_EXE ||
  path.join(repoRoot, "desktop", "src-tauri", "target", "release", "album-mastering-studio.exe");
const sourcePaths = readAlbumSourcePaths();
const sourcePath = sourcePaths[0];
const distinctSourceCount = new Set(sourcePaths.map((item) => path.resolve(item).toLocaleLowerCase())).size;
const sourceMode = distinctSourceCount > 1 ? "multi-song" : "single-song-derived-clips";
const outputRoot =
  process.env.AMS_TAURI_REAL_SONG_ALBUM_PERFORMANCE_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-real-song-album-performance-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const renderOutput = path.join(outputRoot, "album-master-real-song");
const cdpPort = process.env.TAURI_CDP_PORT || "9346";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const clipLengthSeconds = Number(process.env.AMS_REAL_SONG_ALBUM_CLIP_SECONDS || 10);

assert.ok(sourcePaths.length >= 1, "Set AMS_REAL_SONG_PATH or AMS_REAL_SONG_ALBUM_PATHS to local audio files for this smoke.");
assert.ok(sourcePaths.length <= 8, "Album Master smoke supports up to 8 source files.");
for (const candidate of sourcePaths) {
  assert.equal(existsSync(candidate), true, `Real-song fixture does not exist: ${candidate}`);
}
assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);

safeRemove(inputsDir);
safeRemove(renderOutput);
mkdirSync(inputsDir, { recursive: true });
mkdirSync(outputRoot, { recursive: true });
const albumClips = writeAlbumClips(sourcePaths, inputsDir);
const clipPaths = albumClips.map((clip) => clip.path);

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

let cdp;
try {
  const target = await waitForPageTarget();
  const launchToTargetMs = nowMs() - launchStarted;
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitForCondition(cdp, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'", 15000);
  const launchToInvokeReadyMs = nowMs() - launchStarted;

  const smoke = await evaluateInWebView(cdp, realSongAlbumPerformanceExpression());
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-real-song-album-performance.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...smoke,
    launchToTargetMs: roundMs(launchToTargetMs),
    launchToInvokeReadyMs: roundMs(launchToInvokeReadyMs),
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    sourceMode,
    sourcePaths,
    distinctSourceCount,
    source: fileSummary(sourcePath),
    sources: sourcePaths.map(fileSummary),
    clipLengthSeconds,
    clipSummaries: albumClips.map((clip) => ({ ...fileSummary(clip.path), source: clip.source, sourceTitle: clip.sourceTitle })),
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    targetTitle: target.title,
    targetUrl: target.url,
    albumSequenceExists: existsSync(smoke.albumSequencePath),
    cueJsonExists: existsSync(smoke.cueJsonPath),
    cueSheetExists: existsSync(smoke.cueSheetPath),
    dashboardExists: existsSync(smoke.dashboardPath),
    manifestExists: existsSync(smoke.manifestPath),
    trackOutputExists: smoke.trackOutputPaths.map((output) => existsSync(output)),
    interludeOutputExists: smoke.interludeOutputPaths.map((output) => existsSync(output)),
  };

  assert.equal(evidence.releaseExeExists, true);
  assert.equal(evidence.appTextIncludesBrand, true);
  assert.ok(evidence.launchToInvokeReadyMs < 30_000, `Release launch took ${evidence.launchToInvokeReadyMs}ms`);
  assert.equal(evidence.sourceMode, sourceMode);
  assert.equal(evidence.distinctSourceCount, distinctSourceCount);
  assert.equal(evidence.clipSummaries.length, clipPaths.length);
  assert.equal(evidence.clipSummaries.every((clip) => clip.size > 0), true);
  assert.equal(evidence.sourceValidationCount, clipPaths.length);
  assert.equal(evidence.sourceValidationStatuses.every((status) => status === "ok"), true);
  assert.equal(evidence.analysisCount, clipPaths.length);
  assert.equal(evidence.waveformBins.every((count) => count === 256), true);
  assert.equal(evidence.renderTrackCount, clipPaths.length);
  assert.equal(evidence.renderInterludeCount, clipPaths.length - 1);
  assert.equal(evidence.sequenceTrackCount, clipPaths.length);
  assert.equal(evidence.sequenceInterludeCount, clipPaths.length - 1);
  assert.equal(evidence.albumSequenceExists, true);
  assert.equal(evidence.cueJsonExists, true);
  assert.equal(evidence.cueSheetExists, true);
  assert.equal(evidence.dashboardExists, true);
  assert.equal(evidence.manifestExists, true);
  assert.equal(evidence.trackOutputExists.every(Boolean), true);
  assert.equal(evidence.interludeOutputExists.every(Boolean), true);
  assert.ok(["pass", "warn"].includes(evidence.exportChecks.status));
  assert.equal(evidence.exportChecks.track_count, clipPaths.length);
  assert.equal(evidence.exportChecks.interlude_count, clipPaths.length - 1);
  assert.equal(typeof evidence.albumStory, "string");
  assert.ok(evidence.albumStory.length > 20);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-real-song-album-performance-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
}

function realSongAlbumPerformanceExpression() {
  const sourceTitle = albumFixtureTitle();
  return `
(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') throw new Error('Tauri invoke is not available in this WebView');
  const paths = ${JSON.stringify(clipPaths)};
  const renderOutput = ${JSON.stringify(renderOutput)};
  const timed = async (label, action) => {
    const started = performance.now();
    const result = await action();
    return { label, durationMs: Math.round((performance.now() - started) * 10) / 10, result };
  };
  const sourceValidation = await timed('validate_audio_sources_real_song_album', () => invoke('validate_audio_sources', { paths }));
  const analysis = await timed('analyze_real_song_album', () => invoke('analyze_tracks', { paths, sampleRate: 48000, waveformBins: 256 }));
  const project = {
    version: 1,
    album_title: ${JSON.stringify(`${sourceTitle} Real Song Album Performance Smoke`)},
    metadata: { artist: 'Real Song Fixture' },
    settings: {
      sample_rate: 48000,
      bit_depth: 24,
      output_format: 'wav',
      preset: 'album-cohesion-cinematic',
      delivery_profile: 'streaming-universal',
      ceiling_dbfs: -1.0,
      album_wav: true,
      codec_preview: false,
      generated_transitions: true,
      default_boundary_style: 'direct',
      default_boundary_duration: 2,
      interlude_style: 'auto',
      interlude_duration: 1,
      arc: 'cinematic',
      arc_intensity: 1
    },
    tracks: paths.map((source, index) => ({
      path: source,
      title: 'Real Album Clip ' + String(index + 1),
      artist: 'Real Song Fixture',
      isrc: '',
      character: 'auto',
      preset: 'auto'
    })),
    transitions: paths.slice(0, -1).map((_, index) => ({
      after_track: index + 1,
      duration_seconds: 1,
      style: 'auto',
      enabled: true,
      boundary_style: 'direct',
      boundary_duration_seconds: 2
    }))
  };
  const render = await timed('render_album_master_real_song', () => invoke('render_album_master', { project, outputDir: renderOutput }));
  const manifest = render.result.manifest;
  const sequence = manifest.sequence || [];
  const trackItems = sequence.filter((item) => item.type === 'track');
  const interludeItems = sequence.filter((item) => item.type === 'interlude');
  const exportChecks = await timed('run_export_checks_real_song_album', () => invoke('run_export_checks', { manifest }));
  return JSON.stringify({
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    sourceValidationDurationMs: sourceValidation.durationMs,
    sourceValidationCount: sourceValidation.result.length,
    sourceValidationStatuses: sourceValidation.result.map((row) => row.status),
    analysisDurationMs: analysis.durationMs,
    analysisCount: analysis.result.length,
    waveformBins: analysis.result.map((row) => row.waveform.length),
    analysisDurationsSeconds: analysis.result.map((row) => row.analysis?.duration_seconds ?? 0),
    analysisIntegratedLufs: analysis.result.map((row) => row.analysis?.integrated_lufs ?? null),
    renderDurationMs: render.durationMs,
    renderTrackCount: manifest.track_count,
    renderInterludeCount: manifest.interlude_count,
    sequenceTrackCount: trackItems.length,
    sequenceInterludeCount: interludeItems.length,
    trackOutputPaths: trackItems.map((item) => item.output).filter(Boolean),
    interludeOutputPaths: interludeItems.map((item) => item.output).filter(Boolean),
    albumStory: manifest.album_story || '',
    albumIntegratedLufs: manifest.normalization_preview?.album_integrated_lufs ?? null,
    albumExpectedPlaybackGainDb: manifest.normalization_preview?.expected_playback_gain_db ?? null,
    albumSequencePath: manifest.album_sequence || manifest.outputs?.album_sequence || '',
    cueJsonPath: manifest.outputs?.cue_json || '',
    cueSheetPath: manifest.outputs?.cue_sheet || '',
    dashboardPath: render.result.dashboard_path,
    manifestPath: render.result.manifest_path,
    exportChecksDurationMs: exportChecks.durationMs,
    exportChecks: exportChecks.result
  });
})()
`;
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
  return offsets.map((offset, index) => writeAlbumClip(sources[0], targetDir, index, offset));
}

function writeAlbumClip(source, targetDir, index, offsetSeconds) {
  const output = path.join(targetDir, `${String(index + 1).padStart(2, "0")}_${safeClipName(fileStem(source))}_album_clip.wav`);
  const result = spawnSync(
      "ffmpeg",
      [
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
      ],
      { encoding: "utf8" },
    );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(output), true, `Expected album clip was not created: ${output}`);
  return { path: output, source, sourceTitle: fileStem(source) };
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

function fileSummary(filePath) {
  const stats = statSync(filePath);
  return {
    path: filePath,
    size: stats.size,
    modified: stats.mtime.toISOString(),
  };
}

function fileStem(filePath) {
  return path.basename(filePath).replace(/\.[^.]+$/, "") || "Real Song";
}

function albumFixtureTitle() {
  if (sourceMode === "multi-song") return "Multi-Song";
  return fileStem(sourcePath);
}

function safeClipName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "real-song";
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
