import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const msiPath =
  process.env.AMS_TAURI_MSI_PATH ||
  path.join(
    repoRoot,
    "desktop",
    "src-tauri",
    "target",
    "release",
    "bundle",
    "msi",
    "Album Mastering Studio_0.1.0_x64_en-US.msi",
  );
const outputRoot =
  process.env.AMS_TAURI_MSI_OUTPUT || path.join(repoRoot, "test-output", "tauri-msi-package-smoke");
const imageRoot = path.join(outputRoot, "admin-image");
const materializedRoot = path.join(outputRoot, "materialized-app");
const releaseSmokeOutput = path.join(outputRoot, "release-launch");
const darkExe =
  process.env.AMS_TAURI_DARK_EXE || path.join(process.env.LOCALAPPDATA || "", "tauri", "WixTools314", "dark.exe");
const decompiledWxs = path.join(outputRoot, "decompiled.wxs");

assert.equal(existsSync(msiPath), true, `MSI package not found: ${msiPath}`);
assert.equal(existsSync(darkExe), true, `WiX dark.exe not found: ${darkExe}`);
safeRemove(imageRoot);
safeRemove(materializedRoot);
mkdirSync(outputRoot, { recursive: true });

const extraction = runProcess(darkExe, ["-x", imageRoot, "-o", decompiledWxs, msiPath], 180_000);
assert.equal(extraction.status, 0, extraction.stderr || extraction.stdout);

const extractedSources = extractedPackageSources();
const extractedExe = path.join(materializedRoot, "album-mastering-studio.exe");
const extractedEngine = path.join(materializedRoot, "resources", "engine", "album-master-engine.exe");
const extractedFfmpeg = path.join(materializedRoot, "resources", "ffmpeg", "ffmpeg.exe");
const extractedFfprobe = path.join(materializedRoot, "resources", "ffmpeg", "ffprobe.exe");
materializeExtractedPayload(extractedSources);
const extractedRoot = materializedRoot;
assert.equal(existsSync(extractedExe), true, `Materialized app EXE missing: ${extractedExe}`);
assert.equal(existsSync(extractedEngine), true, `Extracted engine sidecar missing: ${extractedEngine}`);
assert.equal(existsSync(extractedFfmpeg), true, `Extracted FFmpeg missing: ${extractedFfmpeg}`);
assert.equal(existsSync(extractedFfprobe), true, `Extracted FFprobe missing: ${extractedFfprobe}`);

const launchSmoke = runProcess("node", [path.join("tests", "tauri-release-launch-smoke.mjs")], 240_000, {
  AMS_TAURI_RELEASE_EXE: extractedExe,
  AMS_TAURI_RELEASE_OUTPUT: releaseSmokeOutput,
  TAURI_CDP_PORT: "9343",
});
assert.equal(launchSmoke.status, 0, launchSmoke.stderr || launchSmoke.stdout);

const extractedPayload = {
  app: fileSummary(extractedExe),
  engine: fileSummary(extractedEngine),
  ffmpeg: fileSummary(extractedFfmpeg),
  ffprobe: fileSummary(extractedFfprobe),
};
const evidence = {
  extractedPayload,
  extractedSources,
  extractedRoot,
  darkExe,
  decompiledWxs,
  extractionExitCode: extraction.status,
  imageRoot,
  launchSmokeExitCode: launchSmoke.status,
  msiPath,
  msiSize: statSync(msiPath).size,
  mode: "wix-dark-extraction",
  note: "The generated WiX MSI is per-machine, so this default smoke validates package payload and launchability without requiring elevation or writing Program Files/HKLM install state.",
  releaseSmokeOutput,
};
const resultPath = path.join(outputRoot, "tauri-msi-package-smoke.json");
writeFileSync(resultPath, JSON.stringify(evidence, null, 2));

if (process.env.AMS_TAURI_MSI_KEEP_IMAGE !== "1") {
  safeRemove(imageRoot);
  safeRemove(materializedRoot);
}

console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));

function runProcess(command, args, timeout, extraEnv = {}) {
  return spawnSync(command, args, {
    cwd: path.join(repoRoot, "desktop"),
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    timeout,
    windowsHide: true,
  });
}

function fileSummary(filePath) {
  const stats = statSync(filePath);
  return {
    path: filePath,
    size: stats.size,
  };
}

function extractedPackageSources() {
  const wxs = readFileSync(decompiledWxs, "utf8");
  return {
    app: sourceForFileName(wxs, "album-mastering-studio.exe"),
    engine: sourceForFileName(wxs, "album-master-engine.exe"),
    ffmpeg: sourceForFileName(wxs, "ffmpeg.exe"),
    ffprobe: sourceForFileName(wxs, "ffprobe.exe"),
  };
}

function sourceForFileName(wxs, fileName) {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = wxs.match(new RegExp(`<File\\b[^>]*\\bName="${escaped}"[^>]*\\bSource="([^"]+)"`, "i"));
  assert.ok(match, `Could not find extracted source path for ${fileName} in ${decompiledWxs}`);
  assert.equal(existsSync(match[1]), true, `Extracted source file missing for ${fileName}: ${match[1]}`);
  return match[1];
}

function materializeExtractedPayload(sources) {
  mkdirSync(path.join(materializedRoot, "resources", "engine"), { recursive: true });
  mkdirSync(path.join(materializedRoot, "resources", "ffmpeg"), { recursive: true });
  copyFileSync(sources.app, path.join(materializedRoot, "album-mastering-studio.exe"));
  copyFileSync(sources.engine, path.join(materializedRoot, "resources", "engine", "album-master-engine.exe"));
  copyFileSync(sources.ffmpeg, path.join(materializedRoot, "resources", "ffmpeg", "ffmpeg.exe"));
  copyFileSync(sources.ffprobe, path.join(materializedRoot, "resources", "ffmpeg", "ffprobe.exe"));
}

function safeRemove(targetPath) {
  const target = path.resolve(targetPath);
  const allowedRoot = path.resolve(outputRoot);
  assert.equal(target.startsWith(allowedRoot), true, `Refusing to remove path outside output root: ${target}`);
  rmSync(target, { force: true, recursive: true });
}
