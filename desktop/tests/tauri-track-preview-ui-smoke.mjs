import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compareExportVsLiveModel,
  compareLiveModelOutputs,
  firstControlLivePreviewTuning,
} from "./live-preview-model.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const releaseExe =
  process.env.AMS_TAURI_RELEASE_EXE ||
  path.join(repoRoot, "desktop", "src-tauri", "target", "release", "album-mastering-studio.exe");
const outputRoot =
  process.env.AMS_TAURI_TRACK_PREVIEW_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-track-preview-ui-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const cdpPort = process.env.TAURI_CDP_PORT || "9348";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const statePath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "recent-session.json");
const stateBackup = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;

assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
safeRemove(outputRoot);
mkdirSync(inputsDir, { recursive: true });
const fixturePaths = [
  path.join(inputsDir, "01_track_preview_fixture.wav"),
  path.join(inputsDir, "02_track_preview_fixture.wav"),
];
writePcm16Fixture(fixturePaths[0], 174.61, 3.8);
writePcm16Fixture(fixturePaths[1], 261.63, 4.0);
const liveParityTuning = firstControlLivePreviewTuning;

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

  await evaluateInWebView(cdp, seedTrackPreviewSessionExpression());
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForCondition(cdp, "document.body.innerText.includes('Preview Fixture 2')", 15000);

  const smoke = await evaluateInWebView(cdp, trackPreviewExpression());
  const pixelSeek = await verifyPixelSeekDrag(cdp);
  const exportVsLiveComparison = compareExportVsLiveModel({
    exportPath: smoke.parityPreviewMasterPath,
    outputPath: path.join(outputRoot, "live-preview-first-control-model.wav"),
    sourcePath: fixturePaths[1],
    tuning: liveParityTuning,
  });
  const nativeVsEngineLivePreviewComparison = compareLiveModelOutputs({
    referencePath: smoke.tauriLivePreviewModelPath,
    candidatePath: smoke.tauriNativeLivePreviewModelPath,
  });
  const previewOutputDir = path.dirname(path.dirname(smoke.previewMasterPath));
  const regionPreviewOutputDir = path.dirname(path.dirname(smoke.regionPreviewMasterPath));
  const previewManifestPath = path.join(previewOutputDir, "manifest.json");
  const previewDashboardPath = path.join(previewOutputDir, "dashboard.html");
  const regionPreviewManifestPath = path.join(regionPreviewOutputDir, "manifest.json");
  const regionPreviewDashboardPath = path.join(regionPreviewOutputDir, "dashboard.html");
  const regionPreviewManifest = JSON.parse(readFileSync(regionPreviewManifestPath, "utf8"));
  const regionPreviewSourcePath = regionPreviewManifest.sequence?.find((item) => item.type === "track")?.source || "";
  const previewManifest = JSON.parse(readFileSync(previewManifestPath, "utf8"));
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-track-preview-ui.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...smoke,
    ...pixelSeek,
    exportVsLiveComparison,
    nativeVsEngineLivePreviewComparison,
    tauriLivePreviewPreparedSourcePathExists: existsSync(smoke.tauriLivePreviewPreparedSourcePath),
    tauriLivePreviewModelPathExists: existsSync(smoke.tauriLivePreviewModelPath),
    tauriNativeLivePreviewModelPathExists: existsSync(smoke.tauriNativeLivePreviewModelPath),
    tauriLivePreviewModelPlaybackCacheExists: existsSync(smoke.tauriLivePreviewModelPlaybackCachePath),
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    previewOutputDir,
    regionPreviewOutputDir,
    previewManifestPath,
    previewDashboardPath,
    regionPreviewManifestPath,
    regionPreviewDashboardPath,
    regionPreviewManifest,
    regionPreviewSourcePath,
    previewManifest,
    previewManifestExists: existsSync(previewManifestPath),
    previewDashboardExists: existsSync(previewDashboardPath),
    regionPreviewManifestExists: existsSync(regionPreviewManifestPath),
    regionPreviewDashboardExists: existsSync(regionPreviewDashboardPath),
    regionPreviewDashboardSkippedForAudition: !existsSync(regionPreviewDashboardPath),
    regionPreviewSourceExists: existsSync(regionPreviewSourcePath),
    previewMasterExists: existsSync(smoke.previewMasterPath),
    regionPreviewMasterExists: existsSync(smoke.regionPreviewMasterPath),
    parityPreviewMasterExists: existsSync(smoke.parityPreviewMasterPath),
    playbackCacheExists: existsSync(smoke.playbackCachePath),
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    targetTitle: target.title,
    targetUrl: target.url,
  };

  assert.equal(evidence.releaseExeExists, true);
  assert.equal(evidence.appTextIncludesBrand, true);
  assert.equal(evidence.activeMode, "Track Master");
  assert.equal(evidence.trackCountLabel, "2 / 8 tracks");
  assert.equal(evidence.selectedHeading, "Track 2");
  assert.equal(evidence.previewButtonEnabledBefore, true);
  assert.equal(evidence.previewReadyVisible, true);
  assert.equal(evidence.masterStatusAfterPreview, "Master ready");
  assert.equal(evidence.masteredButtonEnabledAfterPreview, true);
  assert.equal(evidence.playbackReadyVisible, true);
  assert.equal(evidence.abSourceReadyVisible, true);
  assert.equal(evidence.abMasterReadyVisible, true);
  assert.equal(evidence.abOriginalReadyVisible, true);
  assert.equal(evidence.abPreservesPosition, true);
  assert.equal(evidence.transportSeekInputVisible, true);
  assert.equal(evidence.transportSeeked, true);
  assert.equal(evidence.pixelSeekDragVisible, true);
  assert.equal(evidence.pixelSeekDragChangedPosition, true);
  assert.equal(evidence.pixelSeekDragHitTarget, true);
  assert.equal(evidence.regionCreated, true);
  assert.equal(evidence.loopEnabledAfterRegion, true);
  assert.equal(evidence.loopActive, true);
  assert.equal(evidence.regionLoopReturnedToStart, true);
  assert.equal(evidence.regionPreviewButtonEnabledBefore, true);
  assert.equal(evidence.regionPreviewReadyVisible, true);
  assert.equal(evidence.regionPreviewMasterExists, true);
  assert.equal(evidence.regionPreviewManifestExists, true);
  assert.equal(evidence.regionPreviewDashboardExists, false);
  assert.equal(evidence.regionPreviewDashboardSkippedForAudition, true);
  assert.equal(evidence.regionPreviewSourceExists, true);
  assert.equal(evidence.regionPreviewManifest.track_count, 1);
  assert.equal(evidence.regionPreviewManifest.interlude_count, 0);
  assert.notEqual(evidence.regionPreviewSourcePath, fixturePaths[1]);
  assert.match(evidence.regionPreviewSourcePath, /region-source\.wav$/);
  assert.equal(evidence.regionPreviewParity, "Render-faithful region");
  assert.equal(evidence.regionEngineAuditionPath, evidence.regionPreviewMasterPath);
  assert.equal(evidence.regionEngineAuditionEngine, "python-render-track-region-preview");
  assert.equal(evidence.regionEngineAuditionTransportIncludesRegion, true);
  assert.equal(Math.abs(evidence.regionEngineAuditionStartSeconds - evidence.expectedLoopStart) <= 0.08, true);
  assert.equal(Math.abs(evidence.regionEngineAuditionDurationSeconds - (evidence.expectedLoopEnd - evidence.expectedLoopStart)) <= 0.1, true);
  assert.equal(evidence.regionCleared, true);
  assert.equal(evidence.loopDisabledAfterClear, true);
  assert.equal(evidence.volumeMatchDefaultOff, true);
  assert.equal(evidence.volumeMatchActive, true);
  assert.equal(evidence.volumeMatchReducesMaster, true);
  assert.equal(evidence.volumeMatchReturnsToUnity, true);
  assert.equal(evidence.livePreviewDefaultOff, true);
  assert.equal(evidence.livePreviewButtonEnabled, true);
  assert.equal(evidence.livePreviewContractModelId, "web-audio-first-control-model");
  assert.equal(evidence.livePreviewContractPreviewParity, "approximate");
  assert.equal(evidence.livePreviewContractExportFaithfulRequired, true);
  assert.deepEqual(evidence.livePreviewContractModeledControls, ["Low", "Mid", "High", "Width", "Intensity"]);
  assert.deepEqual(evidence.livePreviewContractUnmodeledStages, [
    "preset_base_tone",
    "highpass",
    "low_mid_eq",
    "brightness_tilt",
    "warmth_saturation",
    "transient_shape",
    "lufs_match",
    "ceiling_limiter",
    "codec_qc",
  ]);
  assert.deepEqual(evidence.livePreviewContractWindowControls, evidence.livePreviewContractModeledControls);
  assert.equal(evidence.livePreviewContractWindowModelId, evidence.livePreviewContractModelId);
  assert.deepEqual(evidence.livePreviewContractDrift, []);
  assert.equal(evidence.livePreviewContractDriftVisible, false);
  assert.equal(evidence.tauriLivePreviewPreparedSourcePathExists, true);
  assert.equal(evidence.tauriLivePreviewModelOutputExists, true);
  assert.equal(evidence.tauriLivePreviewModelPathExists, true);
  assert.equal(evidence.tauriLivePreviewModel.live_preview_engine, "web-audio-first-control-model");
  assert.deepEqual(evidence.tauriLivePreviewModel.modeled_controls, ["Low", "Mid", "High", "Width", "Intensity"]);
  assert.deepEqual(evidence.tauriLivePreviewModel.tuning, liveParityTuning);
  assert.deepEqual(evidence.tauriLivePreviewModel.normalized_tuning, liveParityTuning);
  assert.deepEqual(evidence.tauriLivePreviewModel.unmodeled_export_stages, evidence.livePreviewContractUnmodeledStages);
  assert.ok(Math.abs(evidence.tauriLivePreviewModel.modeled_width - 1.36) <= 0.001);
  assert.ok(Math.abs(evidence.tauriLivePreviewModel.modeled_drive - 0.4) <= 0.001);
  assert.equal(evidence.tauriLivePreviewModel.preview_parity, "approximate");
  assert.equal(evidence.tauriLivePreviewModel.export_faithful_preview_required, true);
  assert.equal(evidence.tauriLivePreviewModel.same_engine, false);
  assert.equal(evidence.tauriLivePreviewModel.source, evidence.tauriLivePreviewPreparedSourcePath);
  assert.equal(evidence.tauriLivePreviewModel.output, evidence.tauriLivePreviewModelPath);
  assert.equal(evidence.tauriLivePreviewModel.sample_rate, 48000);
  assert.equal(evidence.tauriLivePreviewModel.frame_count, 48000 * 4);
  assert.equal(evidence.tauriNativeLivePreviewModelPathExists, true);
  assert.equal(evidence.tauriNativeLivePreviewModel.output_exists, true);
  assert.equal(evidence.tauriNativeLivePreviewModel.live_preview_engine, "web-audio-first-control-model");
  assert.equal(evidence.tauriNativeLivePreviewModel.native_engine, "rust-native-live-preview-model");
  assert.deepEqual(evidence.tauriNativeLivePreviewModel.modeled_controls, ["Low", "Mid", "High", "Width", "Intensity"]);
  assert.deepEqual(evidence.tauriNativeLivePreviewModel.tuning, liveParityTuning);
  assert.deepEqual(evidence.tauriNativeLivePreviewModel.normalized_tuning, liveParityTuning);
  assert.deepEqual(evidence.tauriNativeLivePreviewModel.unmodeled_export_stages, evidence.livePreviewContractUnmodeledStages);
  assert.ok(Math.abs(evidence.tauriNativeLivePreviewModel.modeled_width - 1.36) <= 0.001);
  assert.ok(Math.abs(evidence.tauriNativeLivePreviewModel.modeled_drive - 0.4) <= 0.001);
  assert.equal(evidence.tauriNativeLivePreviewModel.source, evidence.tauriLivePreviewPreparedSourcePath);
  assert.equal(evidence.tauriNativeLivePreviewModel.sample_rate, 48000);
  assert.equal(evidence.tauriNativeLivePreviewModel.frame_count, 48000 * 4);
  assert.equal(evidence.nativeVsEngineLivePreviewComparison.sample_rate, 48000);
  assert.equal(evidence.nativeVsEngineLivePreviewComparison.compared_frames, 48000 * 4);
  assert.ok(evidence.nativeVsEngineLivePreviewComparison.max_abs_difference < 0.005);
  assert.ok(evidence.nativeVsEngineLivePreviewComparison.rms_difference_dbfs < -60);
  assert.equal(evidence.tauriLivePreviewModelPlaybackCacheExists, true);
  assert.equal(evidence.tauriLivePreviewModelNativeProbe.source_sample_rate, 48000);
  assert.equal(evidence.tauriLivePreviewModelNativeProbe.source_total_frames, 48000 * 4);
  assert.equal(evidence.tauriLivePreviewModelNativeProbe.requested_duration_ms, 500);
  assert.equal(evidence.tauriLivePreviewModelNativeProbe.played_output_frames > 0, true);
  assert.equal(evidence.tauriLivePreviewModelNativeProbe.callback_count > 0, true);
  assert.deepEqual(evidence.tauriLivePreviewModelNativeProbe.stream_errors, []);
  assert.deepEqual(evidence.tauriLivePreviewModelNativeProbe.warnings, []);
  assert.match(evidence.livePreviewModeledStatus, /Live model: Low, Mid, High, Width, Intensity/);
  assert.match(evidence.livePreviewRenderOnlyStatus, /Render-only:/);
  assert.equal(evidence.livePreviewRenderOnlyIncludesTone, true);
  assert.equal(evidence.livePreviewRenderOnlyIncludesHighpass, true);
  assert.equal(evidence.livePreviewRenderOnlyIncludesLufs, true);
  assert.equal(evidence.livePreviewRenderOnlyIncludesLimiter, true);
  assert.equal(evidence.livePreviewActive, true);
  assert.equal(evidence.liveControlUpdated, true);
  assert.equal(evidence.liveControlResults.length, 5);
  assert.deepEqual(
    evidence.liveControlResults.map((item) => item.label),
    ["Low", "Mid", "High", "Width", "Intensity"],
  );
  assert.equal(evidence.liveControlUnder150ms, true);
  assert.equal(evidence.liveIntensityUnder500ms, true);
  assert.equal(evidence.liveSnapshotAfterControls.active, true);
  assert.ok(Math.abs(evidence.liveSnapshotAfterControls.bass - 0.5) <= 0.001);
  assert.ok(Math.abs(evidence.liveSnapshotAfterControls.mid - -0.25) <= 0.001);
  assert.ok(Math.abs(evidence.liveSnapshotAfterControls.high - 0.35) <= 0.001);
  assert.ok(Math.abs(evidence.liveSnapshotAfterControls.width - 1.36) <= 0.001);
  assert.ok(Math.abs(evidence.liveSnapshotAfterControls.drive - 0.4) <= 0.001);
  assert.equal(evidence.previewParityAfterLivePreview, "Approx audition");
  assert.equal(evidence.previewParityAfterControlChange, "Render required");
  assert.equal(evidence.parityPreviewReadyVisible, true);
  assert.equal(evidence.parityPreviewButtonEnabledBefore, true);
  assert.equal(evidence.parityPreviewMasterExists, true);
  assert.equal(evidence.parityMasterStatusAfterRender, "Master ready");
  assert.equal(evidence.previewParityAfterUpdatePreview, "Render-faithful preview");
  assert.equal(evidence.exportEngineAuditionPath, evidence.parityPreviewMasterPath);
  assert.equal(evidence.exportEngineAuditionEngine, "python-render-track-master");
  assert.ok(Math.abs(evidence.exportEngineAuditionStartSeconds - evidence.exportAuditionExpectedStartSeconds) <= 0.25);
  assert.ok(evidence.exportEngineAuditionCurrentTimeSeconds >= Math.max(0, evidence.exportAuditionExpectedStartSeconds - 0.25));
  assert.ok(evidence.exportEngineAuditionCurrentTimeSeconds <= evidence.exportAuditionExpectedStartSeconds + 3);
  assert.ok(evidence.exportEngineAuditionSourceDurationSeconds > evidence.exportAuditionExpectedStartSeconds);
  assert.match(evidence.previewParityTitleAfterUpdatePreview, /Python export engine/);
  assert.equal(evidence.previewParityTitleAfterUpdatePreview.includes(evidence.exportAuditionExpectedCueText), true);
  assert.equal(evidence.exportEngineAuditionTransportIncludesMastered, true);
  assert.match(evidence.livePreviewStatusAfterUpdatePreview, /Live Preview armed/);
  assert.equal(evidence.approximateLiveSourceReady, true);
  assert.equal(evidence.previewParityAfterReturnToLiveSource, "Approx audition");
  assert.match(evidence.livePreviewStatusAfterReturnToSource, /Live Preview active/);
  assert.equal(evidence.liveSnapshotAfterReturnToSource.active, true);
  assert.equal(evidence.exportVsLiveComparison.offline_engine, "python-render-track-master");
  assert.equal(evidence.exportVsLiveComparison.live_preview_engine, "web-audio-first-control-model");
  assert.deepEqual(evidence.exportVsLiveComparison.modeled_controls, ["Low", "Mid", "High", "Width", "Intensity"]);
  assert.ok(Math.abs(evidence.exportVsLiveComparison.modeled_width - 1.36) <= 0.001);
  assert.ok(Math.abs(evidence.exportVsLiveComparison.modeled_drive - 0.4) <= 0.001);
  assert.equal(evidence.exportVsLiveComparison.same_engine, false);
  assert.equal(evidence.exportVsLiveComparison.preview_parity, "approximate");
  assert.equal(evidence.exportVsLiveComparison.export_faithful_preview_required, true);
  assert.equal(evidence.exportVsLiveComparison.exportDiffersFromLiveMaterially, true);
  assert.equal(evidence.exportVsLiveComparison.exportDominatesLiveLoudnessDelta, true);
  assert.ok(Math.abs(evidence.exportVsLiveComparison.export_minus_live_lufs_proxy) >= 1);
  assert.ok(evidence.exportVsLiveComparison.rms_difference_dbfs > -60);
  assert.ok(
    evidence.exportVsLiveComparison.exportLoudnessDeltaVsSource >
      evidence.exportVsLiveComparison.liveLoudnessDeltaVsSource + 0.5,
  );
  assert.equal(evidence.exportVsLiveComparison.source_path, fixturePaths[1]);
  assert.equal(evidence.exportVsLiveComparison.export_path, evidence.parityPreviewMasterPath);
  assert.deepEqual(evidence.exportVsLiveComparison.tuning, liveParityTuning);
  assert.equal(evidence.exportVsLiveComparison.sample_rate, 48000);
  assert.equal(evidence.exportVsLiveComparison.compared_frames > 0, true);
  assert.equal(existsSync(evidence.exportVsLiveComparison.live_model_path), true);
  assert.equal(Number.isFinite(evidence.exportVsLiveComparison.source_lufs_proxy), true);
  assert.equal(Number.isFinite(evidence.exportVsLiveComparison.live_lufs_proxy), true);
  assert.equal(Number.isFinite(evidence.exportVsLiveComparison.export_lufs_proxy), true);
  assert.equal(Number.isFinite(evidence.exportVsLiveComparison.export_minus_live_lufs_proxy), true);
  assert.equal(Number.isFinite(evidence.exportVsLiveComparison.source_peak_dbfs), true);
  assert.equal(Number.isFinite(evidence.exportVsLiveComparison.live_peak_dbfs), true);
  assert.equal(Number.isFinite(evidence.exportVsLiveComparison.export_peak_dbfs), true);
  assert.equal(Number.isFinite(evidence.exportVsLiveComparison.rms_difference_dbfs), true);
  assert.equal(evidence.previewManifestExists, true);
  assert.equal(evidence.previewDashboardExists, true);
  assert.equal(evidence.previewMasterExists, true);
  assert.equal(evidence.parityPreviewMasterExists, true);
  assert.equal(evidence.playbackCacheExists, true);
  assert.equal(evidence.previewManifest.track_count, 1);
  assert.equal(evidence.previewManifest.interlude_count, 0);
  assert.equal(evidence.trackBatchExportButtonEnabledBefore, true);
  assert.equal(evidence.trackBatchReceiptVisible, true);
  assert.equal(evidence.trackBatchReceiptTextIncludesBatchSummary, true);
  assert.equal(evidence.trackBatchReceiptTextIncludesSingleTrackSummary, false);
  assert.equal(evidence.trackBatchReceiptTextIncludesTrackOutputs, true);
  assert.equal(evidence.trackBatchReceiptTextIncludesTwoRenderedPaths, true);
  assert.deepEqual(
    (evidence.previewManifest.sequence || []).filter((item) => item.type === "track").map((item) => item.title),
    ["Preview Fixture 2"],
  );
  assert.equal(evidence.masterStatusAfterControlChange === "Master ready", false);
  assert.equal(evidence.masteredButtonEnabledAfterControlChange, false);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-track-preview-ui-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
  restoreStateFile();
}

function seedTrackPreviewSessionExpression() {
  const waveform = Array.from({ length: 128 }, (_, index) => Math.abs(Math.sin(index / 8)) * 0.75 + 0.08);
  const tracks = fixturePaths.map((fixturePath, index) => ({
    id: `track-preview-${index + 1}`,
    path: fixturePath,
    title: `Preview Fixture ${index + 1}`,
    artist: "Preview Artist",
    isrc: "",
    character: "auto",
    preset: "auto",
    analysis: {
      duration_seconds: index === 0 ? 3.8 : 4.0,
      integrated_lufs: index === 0 ? -18.2 : -17.7,
      true_peak_dbfs: -6.2,
      loudness_range_lu_proxy: 4.1,
      spectral_centroid_hz: index === 0 ? 1200 : 1800,
      stereo_width: 0.08,
      transient_density: 0.18,
    },
    waveform,
  }));
  const session = {
    version: 2,
    savedAt: new Date().toISOString(),
    mode: "track",
    settings: {
      albumTitle: "Track Preview UI Smoke",
      artist: "Preview Artist",
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
    tracks,
    selectedTrackId: "track-preview-2",
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

function trackPreviewExpression() {
  return `
(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') throw new Error('Tauri invoke is not available in this WebView');
  const text = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
  const formatClock = (seconds) => {
    const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  };
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
  const masterStatus = () => text(document.querySelector('.status-pills .pill:nth-child(2)'));
  const livePreviewContract = await invoke('live_preview_contract');
  const livePreviewContractLoaded = await waitFor(
    () => window.__AMS_LIVE_PREVIEW_CONTRACT__?.modelId === livePreviewContract.modelId,
    5000,
  );
  if (!livePreviewContractLoaded) {
    throw new Error('Live Preview contract did not load into the visible app state');
  }
  const livePreviewWindowContract = window.__AMS_LIVE_PREVIEW_CONTRACT__ || {};
  const livePreviewContractDrift = window.__AMS_LIVE_PREVIEW_CONTRACT_DRIFT__ || [];
  const livePreviewContractDriftVisible = Array.from(document.querySelectorAll('.live-contract-status.warn'))
    .some((item) => text(item).includes('Contract drift'));
  const livePreviewModeledStatus = text(document.querySelector('.live-contract-status.modeled'));
  const livePreviewRenderOnlyStatus = text(document.querySelector('.live-contract-status.render-only'));
  const tauriLivePreviewPreparedSourcePath = await invoke('prepare_playback_file', {
    path: ${JSON.stringify(fixturePaths[1])}
  });
  const tauriLivePreviewModelPath = ${JSON.stringify(path.join(outputRoot, "tauri-command-live-preview-model.wav"))};
  const tauriLivePreviewModel = await invoke('render_live_preview_model', {
    sourcePath: tauriLivePreviewPreparedSourcePath,
    outputPath: tauriLivePreviewModelPath,
    sampleRate: 48000,
    tuning: ${JSON.stringify(liveParityTuning)}
  });
  const tauriNativeLivePreviewModelPath = ${JSON.stringify(path.join(outputRoot, "tauri-native-live-preview-model.wav"))};
  const tauriNativeLivePreviewModel = await invoke('render_native_live_preview_model', {
    sourcePath: tauriLivePreviewPreparedSourcePath,
    outputPath: tauriNativeLivePreviewModelPath,
    sampleRate: 48000,
    tuning: ${JSON.stringify(liveParityTuning)}
  });
  const tauriLivePreviewModelPlaybackCachePath = await invoke('prepare_playback_file', { path: tauriLivePreviewModelPath });
  const tauriLivePreviewModelNativeProbe = await invoke('native_playback_file_probe', {
    path: tauriLivePreviewModelPlaybackCachePath,
    durationMs: 500,
    startSeconds: 0
  });
  const masteredActionButton = () => buttons().find((item) => text(item).startsWith('Mastered') && item.closest('.audition-actions'));
  const activeMode = text(document.querySelector('.mode-tabs button.active'));
  const trackCountLabel = text(document.querySelector('.library .panel-title span'));
  const selectedHeading = text(document.querySelector('.selected-heading .eyebrow'));
  const previewButton = buttonByText('Update Preview');
  const previewButtonEnabledBefore = !previewButton.disabled;
  previewButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const previewReadyVisible = await waitFor(() => logText().includes('Preview ready:'), 180000);
  const previewMatch = /Preview ready: ([^\\n]+)/.exec(logText());
  if (!previewMatch) throw new Error('Preview path was not logged');
  const previewMasterPath = previewMatch[1].trim();
  const masterStatusAfterPreview = masterStatus();
  const masteredButtonEnabledAfterPreview = masteredActionButton()?.disabled === false;
  masteredActionButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const playbackReadyVisible = await waitFor(() => logText().includes('Playback ready: Preview Fixture 2 - Mastered'), 30000);
  const playbackMatch = /Playback ready: Preview Fixture 2 - Mastered/.exec(logText());
  const playbackCachePath = await invoke('prepare_playback_file', { path: previewMasterPath });
  const abButton = (label) => Array.from(document.querySelectorAll('.ab-switch button')).find((item) => text(item) === label);
  const transportLabel = () => text(document.querySelector('.transport-label'));
  const transportSeekInput = () => document.querySelector('input[aria-label="Playback position"]');
  const audio = () => document.querySelector('audio');
  const setRangeValue = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (!abButton('Original') || !abButton('Mastered')) throw new Error('A/B buttons not found');
  abButton('Original').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const abSourceReadyVisible = await waitFor(() => logText().includes('A/B ready: Preview Fixture 2') && transportLabel().includes('Original'), 30000);
  if (!abSourceReadyVisible) throw new Error('A/B source side did not become ready');
  await waitFor(() => audio()?.duration > 0 && !Number.isNaN(audio()?.duration), 10000);
  audio()?.pause();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const abDuration = audio()?.duration || 0;
  const abSeekTargetSeconds = Math.max(0.6, Math.min(2.2, abDuration * 0.45));
  const seekInput = transportSeekInput();
  if (!seekInput) throw new Error('Playback position input not found');
  setRangeValue(seekInput, abSeekTargetSeconds);
  const sourceSeeked = await waitFor(() => Math.abs((audio()?.currentTime || 0) - abSeekTargetSeconds) <= 0.08, 5000);
  if (!sourceSeeked) {
    throw new Error('Playback position input did not seek to target: ' + JSON.stringify({
      target: abSeekTargetSeconds,
      currentTime: audio()?.currentTime || 0,
      duration: audio()?.duration || 0,
      seekValue: transportSeekInput()?.value || '',
      seekMax: transportSeekInput()?.max || '',
      transportLabel: transportLabel(),
      timeRow: text(document.querySelector('.time-row'))
    }));
  }
  const transportSeekAudioTime = audio()?.currentTime || 0;
  const transportSeekReadout = text(document.querySelector('.time-row'));
  const abSourceTimeBeforeSwitch = audio()?.currentTime || 0;
  abButton('Mastered').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const abMasterReadyVisible = await waitFor(() => transportLabel().includes('Mastered') && audio()?.duration > 0, 10000);
  audio()?.pause();
  if (!abMasterReadyVisible) throw new Error('A/B master side did not preserve source position');
  const abMasterTimeAfterSwitch = audio()?.currentTime || 0;
  abButton('Original').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const abOriginalReadyVisible = await waitFor(() => transportLabel().includes('Original') && audio()?.duration > 0, 10000);
  audio()?.pause();
  if (!abOriginalReadyVisible) throw new Error('A/B original side did not preserve master position');
  const abSourceTimeAfterReturn = audio()?.currentTime || 0;
  const abPreservesPosition =
    Math.abs(abMasterTimeAfterSwitch - abSourceTimeBeforeSwitch) <= 0.35 &&
    Math.abs(abSourceTimeAfterReturn - abMasterTimeAfterSwitch) <= 0.35;
  const waveform = document.querySelector('canvas.wave-large');
  if (!waveform) throw new Error('Waveform canvas not found');
  const waveRect = waveform.getBoundingClientRect();
  const waveY = waveRect.top + waveRect.height / 2;
  const regionStartFraction = 0.25;
  const regionEndFraction = 0.55;
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
  const loopButton = buttonByText('Loop');
  const loopEnabledAfterRegion = !loopButton.disabled;
  loopButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const loopActive = await waitFor(() => buttonByText('Loop').classList.contains('active'), 5000);
  if (!loopActive) throw new Error('Loop button did not become active after region selection');
  const loopDuration = audio()?.duration || abDuration;
  const expectedLoopStart = regionStartFraction * loopDuration;
  const expectedLoopEnd = regionEndFraction * loopDuration;
  const loopStartAfterToggle = audio()?.currentTime || 0;
  audio().currentTime = expectedLoopEnd + 0.08;
  audio().dispatchEvent(new Event('timeupdate', { bubbles: true }));
  const regionLoopReturnedToStart = await waitFor(
    () => Math.abs((audio()?.currentTime || 0) - expectedLoopStart) <= 0.16,
    5000,
  );
  if (!regionLoopReturnedToStart) {
    throw new Error('Region loop did not return to start: ' + JSON.stringify({
      expectedLoopStart,
      expectedLoopEnd,
      currentTime: audio()?.currentTime || 0,
      readout: text(document.querySelector('.region-readout')),
      loopButtonClass: buttonByText('Loop').className
    }));
  }
  const regionPreviewButton = buttonByText('Render Region');
  const regionPreviewButtonEnabledBefore = !regionPreviewButton.disabled;
  if (!regionPreviewButtonEnabledBefore) throw new Error('Render Region button was disabled after selecting a region');
  regionPreviewButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const regionPreviewReadyVisible = await waitFor(() => /Region engine preview ready: ([^\\n]+)/.test(logText()), 180000);
  if (!regionPreviewReadyVisible) {
    throw new Error('Region preview did not render through the engine: ' + JSON.stringify({
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
      transportLabel: transportLabel()
    }));
  }
  const regionPreviewParity = text(document.querySelector('.preview-parity-status'));
  const regionEngineAuditionPath = window.__AMS_REGION_ENGINE_AUDITION__?.path || '';
  const regionEngineAuditionEngine = window.__AMS_REGION_ENGINE_AUDITION__?.engine || '';
  const regionEngineAuditionStartSeconds = window.__AMS_REGION_ENGINE_AUDITION__?.startSeconds ?? null;
  const regionEngineAuditionDurationSeconds = window.__AMS_REGION_ENGINE_AUDITION__?.durationSeconds ?? null;
  const regionEngineAuditionTransportIncludesRegion = transportLabel().includes('Engine Region');
  buttonByText('Clear Region').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const regionCleared = await waitFor(() => text(document.querySelector('.region-readout')) === 'No region selected', 5000);
  const loopDisabledAfterClear = buttonByText('Loop').disabled;
  const volumeMatchButton = () => buttonByText('Volume Match');
  const volumeMatchDefaultOff = !volumeMatchButton().classList.contains('active') && Math.abs((audio()?.volume ?? 1) - 1) <= 0.001;
  abButton('Mastered').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const volumeMatchMasterReady = await waitFor(() => transportLabel().includes('Mastered') && audio()?.duration > 0, 10000);
  audio()?.pause();
  if (!volumeMatchMasterReady) throw new Error('Mastered side was not ready for Volume Match check');
  const volumeBeforeMatch = audio()?.volume ?? 1;
  volumeMatchButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const volumeMatchActive = await waitFor(() => volumeMatchButton().classList.contains('active'), 5000);
  const volumeMatched = await waitFor(() => (audio()?.volume ?? 1) < volumeBeforeMatch - 0.03, 5000);
  const volumeAfterMatch = audio()?.volume ?? 1;
  volumeMatchButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const volumeMatchReturnsToUnity = await waitFor(
    () => !volumeMatchButton().classList.contains('active') && Math.abs((audio()?.volume ?? 0) - 1) <= 0.001,
    5000,
  );
  const volumeAfterMatchOff = audio()?.volume ?? 0;
  if (!volumeMatched) {
    throw new Error('Volume Match did not reduce mastered playback gain: ' + JSON.stringify({
      volumeBeforeMatch,
      volumeAfterMatch,
      transportLabel: transportLabel()
    }));
  }
  const livePreviewButton = buttonByText('Live Preview');
  const livePreviewDefaultOff = text(document.querySelector('.live-audition-status')) === 'Offline preview' && !livePreviewButton.classList.contains('active');
  const livePreviewButtonEnabled = !livePreviewButton.disabled;
  abButton('Original').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const liveSourceReady = await waitFor(() => transportLabel().includes('Original') && audio()?.duration > 0, 10000);
  if (!liveSourceReady) throw new Error('Original side was not ready for Live Preview check');
  const livePreviewStart = performance.now();
  livePreviewButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const livePreviewActive = await waitFor(() => {
    const snapshot = window.__AMS_LIVE_AUDITION__;
    return Boolean(
      livePreviewButton.classList.contains('active') &&
      text(document.querySelector('.live-audition-status')).includes('Live Preview active') &&
      snapshot?.active === true
    );
  }, 5000);
  if (!livePreviewActive) throw new Error('Live Preview did not become active from the visible UI button');
  const livePreviewActivationMs = performance.now() - livePreviewStart;
  const liveSnapshotAfterActivation = window.__AMS_LIVE_AUDITION__ || {};
  const liveLatencyStatus = text(document.querySelector('.live-audition-status'));
  const previewParityAfterLivePreview = text(document.querySelector('.preview-parity-status'));
  const sliderByLabel = (label) => {
    const control = Array.from(document.querySelectorAll('label.slider')).find((item) => text(item).startsWith(label));
    const input = control?.querySelector('input');
    if (!input) throw new Error(label + ' control not found');
    return { control, input };
  };
  const updateLiveControl = async ({ label, value, snapshotKey, expected, budgetMs }) => {
    const { input } = sliderByLabel(label);
    const started = performance.now();
    setRangeValue(input, value);
    const updated = await waitFor(() => {
      const snapshot = window.__AMS_LIVE_AUDITION__;
      return Boolean(snapshot?.active === true && Math.abs((snapshot[snapshotKey] || 0) - expected) <= 0.001);
    }, 5000);
    const latencyMs = performance.now() - started;
    if (!updated) {
      throw new Error('Live Preview ' + label + ' control did not update the Web Audio chain: ' + JSON.stringify(window.__AMS_LIVE_AUDITION__ || null));
    }
    return {
      label,
      value,
      snapshotKey,
      expected,
      latencyMs,
      underBudget: latencyMs <= budgetMs,
      snapshot: window.__AMS_LIVE_AUDITION__ || {}
    };
  };
  if (!Array.from(document.querySelectorAll('label.slider')).some((item) => text(item).startsWith('Width'))) {
    buttonByText('Advanced').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    const widthVisible = await waitFor(
      () => Array.from(document.querySelectorAll('label.slider')).some((item) => text(item).startsWith('Width')),
      5000,
    );
    if (!widthVisible) throw new Error('Width control did not become visible after opening Advanced');
  }
  const liveControlResults = [];
  liveControlResults.push(await updateLiveControl({ label: 'Low', value: 0.5, snapshotKey: 'bass', expected: 0.5, budgetMs: 150 }));
  liveControlResults.push(await updateLiveControl({ label: 'Mid', value: -0.25, snapshotKey: 'mid', expected: -0.25, budgetMs: 150 }));
  liveControlResults.push(await updateLiveControl({ label: 'High', value: 0.35, snapshotKey: 'high', expected: 0.35, budgetMs: 150 }));
  liveControlResults.push(await updateLiveControl({ label: 'Width', value: 0.2, snapshotKey: 'width', expected: 1.36, budgetMs: 150 }));
  liveControlResults.push(await updateLiveControl({ label: 'Intensity', value: 0.4, snapshotKey: 'drive', expected: 0.4, budgetMs: 500 }));
  const liveControlUpdated = liveControlResults.every((item) => item.snapshot.active === true);
  const liveControlLatencyMs = Math.max(...liveControlResults.map((item) => item.latencyMs));
  const liveControlUnder150ms = liveControlResults.filter((item) => item.label !== 'Intensity').every((item) => item.underBudget);
  const liveIntensityUnder500ms = liveControlResults.find((item) => item.label === 'Intensity')?.underBudget === true;
  const liveSnapshotAfterLow = liveControlResults.find((item) => item.label === 'Low')?.snapshot || {};
  const liveSnapshotAfterControls = window.__AMS_LIVE_AUDITION__ || {};
  await waitFor(() => masterStatus() !== 'Master ready', 5000);
  const masterStatusAfterControlChange = masterStatus();
  const masteredButtonEnabledAfterControlChange = masteredActionButton()?.disabled === false;
  const previewParityAfterControlChange = text(document.querySelector('.preview-parity-status'));
  const parityPreviewButtonReady = await waitFor(() => !buttonByText('Update Preview').disabled, 10000);
  const parityPreviewButton = buttonByText('Update Preview');
  const parityPreviewButtonEnabledBefore = parityPreviewButtonReady && !parityPreviewButton.disabled;
  if (!parityPreviewButtonEnabledBefore) {
    throw new Error('Parity preview button was not enabled after Low control change: ' + JSON.stringify({
      masterStatus: masterStatusAfterControlChange,
      buttonDisabled: parityPreviewButton.disabled,
      busyText: text(document.querySelector('.progress-readout')),
      log: logText().slice(-1000)
    }));
  }
  const exportAuditionExpectedStartSeconds = audio()?.currentTime || 0;
  const exportAuditionExpectedCueText = formatClock(exportAuditionExpectedStartSeconds);
  parityPreviewButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const parityPreviewReadyVisible = await waitFor(() => {
    const matches = Array.from(logText().matchAll(/Preview ready: ([^\\n]+)/g));
    return matches.length >= 1 && matches[matches.length - 1]?.[1]?.trim() !== previewMasterPath;
  }, 180000);
  if (!parityPreviewReadyVisible) {
    throw new Error('Parity preview render did not produce a new master path: ' + JSON.stringify({
      masterStatus: masterStatus(),
      buttonDisabled: buttonByText('Update Preview').disabled,
      matchCount: Array.from(logText().matchAll(/Preview ready: ([^\\n]+)/g)).length,
      log: logText().slice(-2000)
    }));
  }
  const parityPreviewMatches = Array.from(logText().matchAll(/Preview ready: ([^\\n]+)/g));
  const parityPreviewMasterPath = parityPreviewMatches[parityPreviewMatches.length - 1][1].trim();
  const parityMasterStatusAfterRender = masterStatus();
  const exportEngineAuditionReady = await waitFor(() => {
    const audition = window.__AMS_EXPORT_ENGINE_AUDITION__ || {};
    return Boolean(
      audition.path === parityPreviewMasterPath &&
      text(document.querySelector('.preview-parity-status')) === 'Render-faithful preview' &&
      transportLabel().includes('Mastered')
    );
  }, 10000);
  if (!exportEngineAuditionReady) {
    throw new Error('Update Preview did not hand off to the rendered master transport: ' + JSON.stringify({
      audition: window.__AMS_EXPORT_ENGINE_AUDITION__ || null,
      expectedPath: parityPreviewMasterPath,
      previewParity: text(document.querySelector('.preview-parity-status')),
      transportLabel: transportLabel(),
      log: logText().slice(-2000)
    }));
  }
  const previewParityAfterUpdatePreview = text(document.querySelector('.preview-parity-status'));
  const exportEngineAuditionPath = window.__AMS_EXPORT_ENGINE_AUDITION__?.path || '';
  const exportEngineAuditionEngine = window.__AMS_EXPORT_ENGINE_AUDITION__?.engine || '';
  const exportEngineAuditionStartSeconds = window.__AMS_EXPORT_ENGINE_AUDITION__?.startSeconds ?? null;
  const exportEngineAuditionSourceDurationSeconds = window.__AMS_EXPORT_ENGINE_AUDITION__?.sourceDurationSeconds ?? null;
  const exportEngineAuditionCurrentTimeSeconds = audio()?.currentTime || 0;
  const previewParityTitleAfterUpdatePreview = document.querySelector('.preview-parity-status')?.getAttribute('title') || '';
  const exportEngineAuditionTransportIncludesMastered = transportLabel().includes('Mastered');
  const livePreviewStatusAfterUpdatePreview = text(document.querySelector('.live-audition-status'));
  buttonByText('Original').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const approximateLiveSourceReady = await waitFor(() => {
    const snapshot = window.__AMS_LIVE_AUDITION__ || {};
    return Boolean(
      transportLabel().includes('Original') &&
      snapshot.active === true &&
      text(document.querySelector('.preview-parity-status')) === 'Approx audition'
    );
  }, 10000);
  if (!approximateLiveSourceReady) {
    throw new Error('Original playback did not return to approximate Live Preview after rendered preview handoff: ' + JSON.stringify({
      liveAudition: window.__AMS_LIVE_AUDITION__ || null,
      previewParity: text(document.querySelector('.preview-parity-status')),
      status: text(document.querySelector('.live-audition-status')),
      transportLabel: transportLabel()
    }));
  }
  const previewParityAfterReturnToLiveSource = text(document.querySelector('.preview-parity-status'));
  const livePreviewStatusAfterReturnToSource = text(document.querySelector('.live-audition-status'));
  const liveSnapshotAfterReturnToSource = window.__AMS_LIVE_AUDITION__ || {};
  const trackBatchExportButton = buttonByText('Export Master');
  const trackBatchExportButtonEnabledBefore = !trackBatchExportButton.disabled;
  if (!trackBatchExportButtonEnabledBefore) {
    throw new Error('Track Master batch export button was not enabled: ' + JSON.stringify({
      allText: document.body.innerText.slice(-2000),
      masterStatus: masterStatus(),
      log: logText().slice(-1000)
    }));
  }
  trackBatchExportButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const trackBatchReceiptVisible = await waitFor(
    () => text(document.querySelector('.export-receipt')).includes('2 track(s), 0 transition(s)'),
    240000,
  );
  const trackBatchReceiptText = text(document.querySelector('.export-receipt'));
  const trackBatchReceiptTextIncludesBatchSummary = trackBatchReceiptText.includes('2 track(s), 0 transition(s)');
  const trackBatchReceiptTextIncludesSingleTrackSummary = trackBatchReceiptText.includes('1 track(s), 0 transition(s)');
  const trackBatchReceiptTextIncludesTrackOutputs = trackBatchReceiptText.includes('Track outputs');
  const trackBatchReceiptTextIncludesTwoRenderedPaths = trackBatchReceiptText.includes('2 rendered track path(s) exist');
  if (!trackBatchReceiptVisible) {
    throw new Error('Track Master batch receipt did not cover both exported tracks: ' + JSON.stringify({
      receipt: trackBatchReceiptText,
      log: logText().slice(-2000)
    }));
  }
  return JSON.stringify({
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    activeMode,
    trackCountLabel,
    selectedHeading,
    previewButtonEnabledBefore,
    previewReadyVisible,
    previewMasterPath,
    masterStatusAfterPreview,
    masteredButtonEnabledAfterPreview,
    playbackReadyVisible: playbackReadyVisible && Boolean(playbackMatch),
    playbackCachePath,
    abSourceReadyVisible,
    abMasterReadyVisible,
    abOriginalReadyVisible,
    abSeekTargetSeconds,
    transportSeekInputVisible: Boolean(seekInput),
    transportSeeked: sourceSeeked,
    transportSeekAudioTime,
    transportSeekReadout,
    abSourceTimeBeforeSwitch,
    abMasterTimeAfterSwitch,
    abSourceTimeAfterReturn,
    abPreservesPosition,
    regionCreated,
    regionReadoutAfterDrag,
    loopEnabledAfterRegion,
    loopActive,
    expectedLoopStart,
    expectedLoopEnd,
    loopStartAfterToggle,
    regionLoopReturnedToStart,
    regionPreviewButtonEnabledBefore,
    regionPreviewReadyVisible,
    regionPreviewMasterPath,
    regionPreviewParity,
    regionEngineAuditionPath,
    regionEngineAuditionEngine,
    regionEngineAuditionStartSeconds,
    regionEngineAuditionDurationSeconds,
    regionEngineAuditionTransportIncludesRegion,
    regionCleared,
    loopDisabledAfterClear,
    volumeMatchDefaultOff,
    volumeMatchActive,
    volumeBeforeMatch,
    volumeAfterMatch,
    volumeMatchReducesMaster: volumeMatched,
    volumeAfterMatchOff,
    volumeMatchReturnsToUnity,
    livePreviewDefaultOff,
    livePreviewButtonEnabled,
    livePreviewContractModelId: livePreviewContract.modelId,
    livePreviewContractPreviewParity: livePreviewContract.previewParity,
    livePreviewContractExportFaithfulRequired: livePreviewContract.exportFaithfulPreviewRequired,
    livePreviewContractModeledControls: livePreviewContract.modeledControls,
    livePreviewContractUnmodeledStages: livePreviewContract.unmodeledExportStages,
    livePreviewContractWindowModelId: livePreviewWindowContract.modelId,
    livePreviewContractWindowControls: livePreviewWindowContract.modeledControls,
    livePreviewContractDrift,
    livePreviewContractDriftVisible,
    tauriLivePreviewPreparedSourcePath,
    tauriLivePreviewModel,
    tauriLivePreviewModelPath,
    tauriLivePreviewModelOutputExists: tauriLivePreviewModel.output_exists === true,
    tauriNativeLivePreviewModel,
    tauriNativeLivePreviewModelPath,
    tauriLivePreviewModelPlaybackCachePath,
    tauriLivePreviewModelNativeProbe,
    livePreviewModeledStatus,
    livePreviewRenderOnlyStatus,
    livePreviewRenderOnlyIncludesTone: livePreviewRenderOnlyStatus.includes('tone'),
    livePreviewRenderOnlyIncludesHighpass: livePreviewRenderOnlyStatus.includes('highpass'),
    livePreviewRenderOnlyIncludesLufs: livePreviewRenderOnlyStatus.includes('LUFS'),
    livePreviewRenderOnlyIncludesLimiter: livePreviewRenderOnlyStatus.includes('limiter'),
    livePreviewActive,
    livePreviewActivationMs,
    liveLatencyStatus,
    liveSnapshotAfterActivation,
    previewParityAfterLivePreview,
    liveControlUpdated,
    liveControlResults,
    liveControlLatencyMs,
    liveControlUnder150ms,
    liveIntensityUnder500ms,
    liveSnapshotAfterLow,
    liveSnapshotAfterControls,
    masterStatusAfterControlChange,
    masteredButtonEnabledAfterControlChange,
    previewParityAfterControlChange,
    parityPreviewButtonEnabledBefore,
    exportAuditionExpectedStartSeconds,
    exportAuditionExpectedCueText,
    parityPreviewReadyVisible,
    parityPreviewMasterPath,
    parityMasterStatusAfterRender,
    previewParityAfterUpdatePreview,
    exportEngineAuditionPath,
    exportEngineAuditionEngine,
    exportEngineAuditionStartSeconds,
    exportEngineAuditionSourceDurationSeconds,
    exportEngineAuditionCurrentTimeSeconds,
    previewParityTitleAfterUpdatePreview,
    exportEngineAuditionTransportIncludesMastered,
    livePreviewStatusAfterUpdatePreview,
    approximateLiveSourceReady,
    previewParityAfterReturnToLiveSource,
    livePreviewStatusAfterReturnToSource,
    liveSnapshotAfterReturnToSource,
    trackBatchExportButtonEnabledBefore,
    trackBatchReceiptVisible,
    trackBatchReceiptText,
    trackBatchReceiptTextIncludesBatchSummary,
    trackBatchReceiptTextIncludesSingleTrackSummary,
    trackBatchReceiptTextIncludesTrackOutputs,
    trackBatchReceiptTextIncludesTwoRenderedPaths
  });
})()
`;
}

async function verifyPixelSeekDrag(cdp) {
  const setup = await evaluateInWebView(
    cdp,
    `
(async () => {
  const input = document.querySelector('input[aria-label="Playback position"]');
  const audio = document.querySelector('audio');
  if (!input) throw new Error('Playback position input not found for pixel drag');
  if (!audio || !(audio.duration > 0)) throw new Error('Audio is not ready for pixel drag');
  input.scrollIntoView({ block: 'center', inline: 'center' });
  audio.pause();
  audio.currentTime = Math.max(0.1, audio.duration * 0.18);
  audio.dispatchEvent(new Event('timeupdate', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const rect = input.getBoundingClientRect();
  const targetFraction = 0.72;
  return JSON.stringify({
    visible: rect.width > 40 && rect.height > 4,
    duration: audio.duration,
    startTime: audio.currentTime,
    startFraction: audio.currentTime / audio.duration,
    targetFraction,
    targetTime: audio.duration * targetFraction,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  });
})()
`,
  );

  assert.equal(setup.visible, true, "Playback position input is not visibly draggable");
  const y = setup.rect.top + setup.rect.height / 2;
  const startX = setup.rect.left + setup.rect.width * setup.startFraction;
  const targetX = setup.rect.left + setup.rect.width * setup.targetFraction;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: startX, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: startX, y, button: "left", clickCount: 1 });
  for (let step = 1; step <= 8; step += 1) {
    const x = startX + ((targetX - startX) * step) / 8;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
    await sleep(25);
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: targetX, y, button: "left", clickCount: 1 });

  const result = await evaluateInWebView(
    cdp,
    `
(async () => {
  const text = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
  const input = document.querySelector('input[aria-label="Playback position"]');
  const audio = document.querySelector('audio');
  const targetTime = ${JSON.stringify(setup.targetTime)};
  const started = performance.now();
  while (performance.now() - started < 5000) {
    if (audio && Math.abs((audio.currentTime || 0) - targetTime) <= 0.35) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return JSON.stringify({
    pixelSeekDragVisible: Boolean(input),
    pixelSeekDragStartTime: ${JSON.stringify(setup.startTime)},
    pixelSeekDragTargetTime: targetTime,
    pixelSeekDragAudioTime: audio?.currentTime || 0,
    pixelSeekDragInputValue: input?.value || '',
    pixelSeekDragReadout: text(document.querySelector('.time-row')),
    pixelSeekDragChangedPosition: audio ? Math.abs((audio.currentTime || 0) - ${JSON.stringify(setup.startTime)}) >= 0.35 : false,
    pixelSeekDragHitTarget: audio ? Math.abs((audio.currentTime || 0) - targetTime) <= 0.35 : false
  });
})()
`,
  );
  return {
    pixelSeekDragRect: setup.rect,
    pixelSeekDragTargetFraction: setup.targetFraction,
    ...result,
  };
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
    const pulse = Math.max(0, Math.sin(2 * Math.PI * 2 * t)) ** 3;
    const envelope = fadeIn * fadeOut * (0.025 + 0.22 * pulse);
    const tone = Math.sin(2 * Math.PI * frequency * t);
    const left = tone * envelope;
    const right = tone * envelope * 0.92;
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
