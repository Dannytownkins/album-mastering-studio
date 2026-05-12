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
  process.env.AMS_TAURI_PROJECT_PERSISTENCE_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-project-persistence-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const savedProjectPath = path.join(outputRoot, "saved-album.ams.json");
const directProjectPath = path.join(outputRoot, "direct-path-copy.ams.json");
const renderOutput = path.join(outputRoot, "rendered-from-saved-project");
const cdpPort = process.env.TAURI_CDP_PORT || "9347";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const statePath = path.join(os.homedir(), "Documents", "Album Mastering Studio", "State", "recent-session.json");
const stateBackup = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;

assert.equal(existsSync(releaseExe), true, `Release executable not found: ${releaseExe}`);
safeRemove(outputRoot);
mkdirSync(inputsDir, { recursive: true });
const fixturePaths = [
  path.join(inputsDir, "01_project_persistence.wav"),
  path.join(inputsDir, "02_project_persistence.wav"),
];
writePcm16Fixture(fixturePaths[0], 196, 1.2);
writePcm16Fixture(fixturePaths[1], 293.66, 1.35);

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

  await evaluateInWebView(cdp, seedProjectSessionExpression());
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForCondition(cdp, "document.body.innerText.includes('Persistence Clip 1')", 15000);

  const smoke = await evaluateInWebView(cdp, projectPersistenceExpression());
  const savedProject = JSON.parse(readFileSync(savedProjectPath, "utf8"));
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = path.join(outputRoot, "tauri-project-persistence.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    ...smoke,
    releaseExe,
    releaseExeExists: existsSync(releaseExe),
    savedProjectPath,
    savedProjectExists: existsSync(savedProjectPath),
    directProjectPath,
    directProjectExists: existsSync(directProjectPath),
    savedProject,
    screenshot: screenshotPath,
    screenshotExists: existsSync(screenshotPath),
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    targetTitle: target.title,
    targetUrl: target.url,
    manifestExists: existsSync(smoke.renderManifestPath),
    dashboardExists: existsSync(smoke.renderDashboardPath),
    albumSequenceExists: existsSync(smoke.albumSequencePath),
    trackOutputExists: smoke.trackOutputPaths.map((output) => existsSync(output)),
  };

  assert.equal(evidence.releaseExeExists, true);
  assert.equal(evidence.appTextIncludesBrand, true);
  assert.equal(evidence.activeMode, "Album Master");
  assert.equal(evidence.trackCountLabel, "2 / 8 tracks");
  assert.equal(evidence.saveLogVisible, true);
  assert.equal(evidence.savedProjectExists, true);
  assert.equal(evidence.directProjectFieldVisible, true);
  assert.equal(evidence.directProjectSaveLogVisible, true);
  assert.equal(evidence.directProjectExists, true);
  assert.equal(evidence.directProjectAlbumTitle, "Persistence Smoke Album");
  assert.equal(evidence.directProjectLoadRestoredTitle, true);
  assert.equal(evidence.directProjectPathAfterLoad, savedProjectPath);
  assert.equal(evidence.savedProject.version, 1);
  assert.equal(evidence.savedProject.album_title, "Persistence Smoke Album");
  assert.equal(evidence.savedProject.metadata.artist, "Persistence Artist");
  assert.equal(evidence.savedProject.settings.album_wav, true);
  assert.equal(evidence.savedProject.settings.generated_transitions, false);
  assert.equal(evidence.savedProject.settings.default_boundary_style, "gap");
  assert.equal(evidence.savedProject.tracks.length, 2);
  assert.deepEqual(
    evidence.savedProject.tracks.map((track) => track.title),
    ["Persistence Clip 1", "Persistence Clip 2"],
  );
  assert.equal(evidence.loadedProjectAlbumTitle, "Persistence Smoke Album");
  assert.equal(evidence.renderTrackCount, 2);
  assert.equal(evidence.renderInterludeCount, 0);
  assert.equal(evidence.exportChecks.status, "pass");
  assert.equal(evidence.exportChecks.track_count, 2);
  assert.equal(evidence.manifestExists, true);
  assert.equal(evidence.dashboardExists, true);
  assert.equal(evidence.albumSequenceExists, true);
  assert.equal(evidence.trackOutputExists.every(Boolean), true);
  assert.equal(evidence.screenshotExists, true);

  const resultPath = path.join(outputRoot, "tauri-project-persistence-smoke.json");
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));
} finally {
  cdp?.close();
  app.kill();
  restoreStateFile();
}

function seedProjectSessionExpression() {
  const session = {
    version: 2,
    savedAt: new Date().toISOString(),
    mode: "album",
    settings: {
      albumTitle: "Persistence Smoke Album",
      artist: "Persistence Artist",
      albumArtist: "Persistence Album Artist",
      genre: "Test",
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
      boundaryStyle: "gap",
      boundaryDuration: 0.5,
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
      id: `project-persistence-${index + 1}`,
      path: fixturePath,
      title: `Persistence Clip ${index + 1}`,
      artist: "Persistence Artist",
      isrc: "",
      character: "auto",
      preset: "auto",
    })),
    selectedTrackId: "project-persistence-1",
    projectPath: savedProjectPath,
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

function projectPersistenceExpression() {
  return `
(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') throw new Error('Tauri invoke is not available in this WebView');
  const text = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
  const buttonByText = (selector, label) => {
    const button = Array.from(document.querySelectorAll(selector)).find((item) => text(item).includes(label));
    if (!button) throw new Error('Button not found: ' + label);
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
  const setInputValue = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const labelByText = (label) => Array.from(document.querySelectorAll('label')).find((item) => text(item).startsWith(label));
  const activeMode = text(document.querySelector('.mode-tabs button.active'));
  const trackCountLabel = text(document.querySelector('.library .panel-title span'));
  buttonByText('.top-actions button', 'Save').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const saveLogVisible = await waitFor(() => document.body.innerText.includes('Saved project:'), 10000);
  const loadedProject = await invoke('read_json', { path: ${JSON.stringify(savedProjectPath)} });
  const projectField = labelByText('Project');
  const projectInput = projectField?.querySelector('input');
  const directProjectSaveButton = Array.from(projectField?.querySelectorAll('button') || []).find((item) => text(item) === 'Save');
  const directProjectLoadButton = Array.from(projectField?.querySelectorAll('button') || []).find((item) => text(item) === 'Load');
  const directProjectFieldVisible = Boolean(projectInput && directProjectSaveButton && directProjectLoadButton);
  if (!directProjectFieldVisible) throw new Error('Direct project path field was not visible');
  setInputValue(projectInput, ${JSON.stringify(directProjectPath)});
  directProjectSaveButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const directProjectSaveLogVisible = await waitFor(() => document.body.innerText.includes(${JSON.stringify(directProjectPath)}), 10000);
  const directProject = await invoke('read_json', { path: ${JSON.stringify(directProjectPath)} });
  const albumInput = labelByText('Album')?.querySelector('input');
  if (!albumInput) throw new Error('Album title input not found');
  setInputValue(albumInput, 'Mutation Should Be Replaced');
  const mutationVisible = await waitFor(() => albumInput.value === 'Mutation Should Be Replaced', 3000);
  setInputValue(projectInput, ${JSON.stringify(savedProjectPath)});
  directProjectLoadButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  const directProjectLoadRestoredTitle = await waitFor(() => {
    const input = labelByText('Album')?.querySelector('input');
    return input?.value === 'Persistence Smoke Album';
  }, 10000);
  const directProjectPathAfterLoad = labelByText('Project')?.querySelector('input')?.value || '';
  const render = await invoke('render_album_master', { project: loadedProject, outputDir: ${JSON.stringify(renderOutput)} });
  const exportChecks = await invoke('run_export_checks', { manifest: render.manifest });
  const trackItems = (render.manifest.sequence || []).filter((item) => item.type === 'track');
  return JSON.stringify({
    appTextIncludesBrand: document.body.innerText.includes('Album Mastering Studio'),
    activeMode,
    trackCountLabel,
    saveLogVisible,
    directProjectFieldVisible,
    directProjectSaveLogVisible,
    directProjectAlbumTitle: directProject.album_title,
    directProjectLoadRestoredTitle,
    directProjectPathAfterLoad,
    mutationVisible,
    loadedProjectAlbumTitle: loadedProject.album_title,
    renderTrackCount: render.manifest.track_count,
    renderInterludeCount: render.manifest.interlude_count,
    renderManifestPath: render.manifest_path,
    renderDashboardPath: render.dashboard_path,
    albumSequencePath: render.manifest.album_sequence || render.manifest.outputs?.album_sequence || '',
    trackOutputPaths: trackItems.map((item) => item.output).filter(Boolean),
    exportChecks
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
    const pulse = Math.max(0, Math.sin(2 * Math.PI * 2.2 * t)) ** 3;
    const envelope = fadeIn * fadeOut * (0.025 + 0.24 * pulse);
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
