import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const engineExe =
  process.env.AMS_TAURI_ENGINE_EXE ||
  path.join(repoRoot, "desktop", "src-tauri", "target", "release", "resources", "engine", "album-master-engine.exe");
const ffmpegDir =
  process.env.AMS_TAURI_FFMPEG_DIR ||
  path.join(repoRoot, "desktop", "src-tauri", "target", "release", "resources", "ffmpeg");
const outputRoot =
  process.env.AMS_TAURI_SIDECAR_STARTUP_OUTPUT ||
  path.join(repoRoot, "test-output", "tauri-sidecar-startup-smoke");
const inputsDir = path.join(outputRoot, "inputs");
const fixturePath = path.join(inputsDir, "01_sidecar_startup_fixture.wav");
const resultPath = path.join(outputRoot, "tauri-sidecar-startup-smoke.json");

assert.equal(existsSync(engineExe), true, `Engine sidecar not found: ${engineExe}`);
assert.equal(existsSync(ffmpegDir), true, `Bundled FFmpeg folder not found: ${ffmpegDir}`);
assert.equal(existsSync(path.join(ffmpegDir, "ffmpeg.exe")), true, `Bundled FFmpeg missing in ${ffmpegDir}`);
assert.equal(existsSync(path.join(ffmpegDir, "ffprobe.exe")), true, `Bundled FFprobe missing in ${ffmpegDir}`);

mkdirSync(inputsDir, { recursive: true });
writePcm16Fixture(fixturePath);

const coldHelp = timedEngine(["--help"], 60_000);
const warmHelp = timedEngine(["--help"], 60_000);
const analysis = timedEngine(["analyze", fixturePath, "--sample-rate", "48000", "--waveform-bins", "32"], 90_000);

assert.equal(coldHelp.status, 0, coldHelp.stderr || coldHelp.stdout);
assert.equal(warmHelp.status, 0, warmHelp.stderr || warmHelp.stdout);
assert.equal(analysis.status, 0, analysis.stderr || analysis.stdout);
assert.ok(coldHelp.durationMs < 60_000, `Cold sidecar help took too long: ${coldHelp.durationMs}ms`);
assert.ok(warmHelp.durationMs < 60_000, `Warm sidecar help took too long: ${warmHelp.durationMs}ms`);
assert.ok(analysis.durationMs < 90_000, `Sidecar analyze took too long: ${analysis.durationMs}ms`);

const rows = JSON.parse(analysis.stdout);
assert.equal(rows.length, 1);
assert.equal(rows[0].source, fixturePath);
assert.equal(rows[0].waveform.length, 32);
assert.equal(Number.isFinite(rows[0].analysis.integrated_lufs), true);

const evidence = {
  engine: fileSummary(engineExe),
  ffmpeg: fileSummary(path.join(ffmpegDir, "ffmpeg.exe")),
  ffprobe: fileSummary(path.join(ffmpegDir, "ffprobe.exe")),
  fixture: fileSummary(fixturePath),
  commands: {
    coldHelp: commandSummary(coldHelp),
    warmHelp: commandSummary(warmHelp),
    analysis: commandSummary(analysis),
  },
  analysis: {
    count: rows.length,
    waveformBins: rows.map((row) => row.waveform.length),
    integratedLufs: rows[0].analysis.integrated_lufs,
    truePeakDbfs: rows[0].analysis.true_peak_dbfs,
  },
  note: "This measures direct PyInstaller sidecar startup from the release resources folder plus one real analysis call using bundled FFmpeg/FFprobe on PATH.",
};

writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ passed: true, output: outputRoot, result: resultPath }, null, 2));

function timedEngine(args, timeout) {
  const started = process.hrtime.bigint();
  const result = spawnSync(engineExe, args, {
    cwd: outputRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${ffmpegDir};${process.env.PATH || ""}` },
    timeout,
    windowsHide: true,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    args,
    status: result.status,
    signal: result.signal,
    durationMs: Number(durationMs.toFixed(1)),
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error) : null,
  };
}

function commandSummary(result) {
  return {
    args: result.args,
    status: result.status,
    signal: result.signal,
    durationMs: result.durationMs,
    stdoutBytes: Buffer.byteLength(result.stdout),
    stderrBytes: Buffer.byteLength(result.stderr),
    error: result.error,
  };
}

function fileSummary(filePath) {
  const stats = statSync(filePath);
  return {
    path: filePath,
    size: stats.size,
  };
}

function writePcm16Fixture(targetPath) {
  const sampleRate = 48_000;
  const seconds = 1.25;
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
    const envelope = fadeIn * fadeOut;
    const left = Math.sin(2 * Math.PI * 185 * t) * 0.2 * envelope;
    const right = Math.sin(2 * Math.PI * 277.18 * t) * 0.18 * envelope;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left * 32767))), 44 + frame * 4);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right * 32767))), 44 + frame * 4 + 2);
  }

  writeFileSync(targetPath, buffer);
}
