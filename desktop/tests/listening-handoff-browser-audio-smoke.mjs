import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const defaultOutputRoot = path.join(repoRoot, "test-output", "tauri-real-song-listening-packet-smoke");
const outputRoot = process.env.AMS_HANDOFF_BROWSER_OUTPUT_ROOT || defaultOutputRoot;
const handoffPath = path.resolve(
  process.env.AMS_LISTENING_HANDOFF_HTML || process.argv[2] || findLatestHandoff(defaultOutputRoot),
);
const resultPath =
  process.env.AMS_HANDOFF_BROWSER_RESULT ||
  path.join(outputRoot, "listening-handoff-browser-audio-smoke.json");
const expectedAudioCount = Number(process.env.AMS_HANDOFF_EXPECTED_AUDIO_COUNT || 4);
const cdpPort = process.env.AMS_HANDOFF_BROWSER_CDP_PORT || "9561";
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const browserExe = process.env.AMS_BROWSER_EXE || findBrowserExe();

assert.equal(existsSync(handoffPath), true, `Listening handoff HTML not found: ${handoffPath}`);
assert.equal(existsSync(browserExe), true, `Browser executable not found: ${browserExe}`);
mkdirSync(path.dirname(resultPath), { recursive: true });

const profileDir = mkdtempSync(path.join(os.tmpdir(), "ams-handoff-browser-"));
const browser = spawn(
  browserExe,
  [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--allow-file-access-from-files",
    "--autoplay-policy=no-user-gesture-required",
    fileUrlForPath(handoffPath),
  ],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);
const stdout = [];
const stderr = [];
browser.stdout?.on("data", (chunk) => stdout.push(chunk.toString()));
browser.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));

let cdp;
try {
  const target = await waitForPageTarget();
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await waitForCondition(cdp, "document.readyState === 'complete' && document.querySelectorAll('audio').length > 0", 15_000);
  const smoke = await evaluateInBrowser(cdp, audioMetadataExpression());
  const evidence = {
    ...smoke,
    browserExe,
    handoffPath,
    resultPath,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    targetTitle: target.title,
    targetUrl: target.url,
  };

  assert.equal(evidence.audioCount, expectedAudioCount);
  assert.equal(evidence.allAudioReady, true);
  assert.equal(evidence.reviewDecisionVisible, true);
  assert.equal(evidence.reviewJsonKind, "listening-review-decision");
  assert.equal(evidence.reviewJsonDefaultStatus, "not-approved");
  assert.equal(evidence.reviewJsonDefaultApproved, false);
  assert.equal(evidence.reviewJsonDefaultLivePreviewScopeAccepted, false);
  assert.equal(evidence.reviewDownloadButtonVisible, true);
  for (const item of evidence.items) {
    assert.equal(item.error, null, `${item.label || item.src} reported media error`);
    assert.ok(item.readyState >= 1, `${item.label || item.src} did not load metadata`);
    assert.equal(Number.isFinite(item.duration) && item.duration > 0, true, `${item.label || item.src} has invalid duration`);
  }

  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, result: resultPath, handoff: handoffPath }, null, 2));
} finally {
  cdp?.close();
  browser.kill();
  await sleep(750);
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  } catch {
    // Browser shutdown can briefly hold profile locks on Windows; the smoke result does not depend on temp cleanup.
  }
}

function findLatestHandoff(root) {
  const matches = [];
  collect(root, matches);
  if (!matches.length) {
    throw new Error(`No listening-handoff.html files found under ${root}`);
  }
  matches.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return matches[0];
}

function collect(target, matches) {
  if (!existsSync(target)) return;
  const stat = statSync(target);
  if (stat.isFile()) {
    if (path.basename(target) === "listening-handoff.html") matches.push(target);
    return;
  }
  for (const entry of readdirSync(target)) {
    collect(path.join(target, entry), matches);
  }
}

function findBrowserExe() {
  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`No supported browser found. Tried: ${candidates.join(", ")}`);
  return found;
}

function fileUrlForPath(targetPath) {
  return pathToFileURL(targetPath).href;
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
  throw new Error(`Could not reach browser CDP at ${cdpBase}: ${lastError || "timed out"}`);
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
    socket.onerror = () => reject(new Error("CDP WebSocket failed"));
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

async function evaluateInBrowser(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return JSON.parse(result.result.value);
}

function audioMetadataExpression() {
  return `
(async () => {
  const started = performance.now();
  const audios = Array.from(document.querySelectorAll('audio'));
  const audioEvidence = await Promise.all(audios.map((audio) => waitForAudio(audio)));
  const reviewPreviewText = document.querySelector('#review-json-preview')?.textContent || '{}';
  const reviewPreview = JSON.parse(reviewPreviewText);
  return JSON.stringify({
    pageTitle: document.title,
    pageUrl: location.href,
    audioCount: audios.length,
    allAudioReady: audioEvidence.every((item) => !item.error && item.readyState >= 1 && Number.isFinite(item.duration) && item.duration > 0),
    reviewDecisionVisible: Boolean(document.querySelector('#review-decision')),
    reviewDownloadButtonVisible: Boolean(document.querySelector('#download-review')),
    reviewJsonDefaultStatus: reviewPreview.status,
    reviewJsonDefaultApproved: reviewPreview.approved,
    reviewJsonDefaultLivePreviewScopeAccepted: reviewPreview.checklist?.live_preview_scope_accepted,
    reviewJsonKind: reviewPreview.kind,
    elapsedMs: Math.round((performance.now() - started) * 10) / 10,
    items: audioEvidence,
  });

  function waitForAudio(audio) {
    const events = [];
    const startedAt = performance.now();
    const eventNames = ['loadstart', 'loadedmetadata', 'canplay', 'canplaythrough', 'error', 'stalled', 'suspend'];
    let done = false;
    return new Promise((resolve) => {
      const finish = (reason) => {
        if (done) return;
        done = true;
        eventNames.forEach((name) => audio.removeEventListener(name, listeners[name]));
        resolve({
          label: audio.closest('.audition')?.querySelector('strong')?.textContent?.trim() || '',
          src: audio.getAttribute('src') || '',
          currentSrc: audio.currentSrc || '',
          readyState: audio.readyState,
          networkState: audio.networkState,
          duration: Number.isFinite(audio.duration) ? audio.duration : null,
          error: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
          reason,
          elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
          events,
        });
      };
      const listeners = Object.fromEntries(eventNames.map((name) => [
        name,
        () => {
          events.push({
            name,
            atMs: Math.round((performance.now() - startedAt) * 10) / 10,
            readyState: audio.readyState,
            networkState: audio.networkState,
            duration: Number.isFinite(audio.duration) ? audio.duration : null,
            error: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
          });
          if (name === 'error') finish('error');
          if (audio.readyState >= 4 && Number.isFinite(audio.duration) && audio.duration > 0) finish(name);
        },
      ]));
      eventNames.forEach((name) => audio.addEventListener(name, listeners[name]));
      if (audio.readyState >= 4 && Number.isFinite(audio.duration) && audio.duration > 0) {
        finish('already-ready');
        return;
      }
      audio.load();
      window.setTimeout(() => finish('timeout'), 10000);
    });
  }
})()
`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
