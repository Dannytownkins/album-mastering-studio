import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function runCli(args, cwd = repoRoot) {
  const result = spawnSync(process.env.ALBUM_MASTER_PYTHON || "python", ["-m", "album_mastering_studio.cli", ...args], {
    cwd,
    env: {
      ...process.env,
      PYTHONPATH: [path.join(repoRoot, "src"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("desktop CLI contract can analyze dropped files and render a manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ams-desktop-"));
  const inputDir = path.join(root, "inputs");
  const outputDir = path.join(root, "render");
  await mkdir(inputDir);

  const synth = `
from pathlib import Path
import numpy as np
from scipy.io import wavfile
root = Path(r"${inputDir.replaceAll("\\", "\\\\")}")
sr = 48000
t = np.linspace(0, 1.2, int(sr * 1.2), endpoint=False)
for idx, freq in enumerate((196.0, 246.94), start=1):
    audio = (np.sin(2*np.pi*freq*t) * 0.25).astype(np.float32)
    stereo = np.column_stack([audio, audio])
    wavfile.write(root / f"{idx:02d}_drop.wav", sr, stereo)
`;
  const synthResult = spawnSync("python", ["-c", synth], { encoding: "utf8" });
  assert.equal(synthResult.status, 0, synthResult.stderr);

  const trackA = path.join(inputDir, "01_drop.wav");
  const trackB = path.join(inputDir, "02_drop.wav");
  const analysis = JSON.parse(runCli(["analyze", trackA, trackB, "--waveform-bins", "32"]));
  assert.equal(analysis.length, 2);
  assert.equal(analysis[0].waveform.length, 32);

  const projectPath = path.join(root, "album.ams.json");
  await writeFile(
    projectPath,
    JSON.stringify(
      {
        version: 1,
        album_title: "Desktop Contract Test",
        metadata: {},
        settings: {
          sample_rate: 48000,
          preset: "album-cohesion-cinematic",
          output_format: "wav",
          bit_depth: 24,
          delivery_profile: "streaming-universal",
          codec_preview: false,
          target_lufs: -14,
          ceiling_dbfs: -1,
          reference_track: null,
          default_interlude_duration: 0.5,
          default_interlude_style: "auto",
          arc: "cinematic",
          arc_intensity: 1,
          tweak_lufs: 0,
          tweak_brightness_db: 0,
          tweak_warmth: 0,
          tweak_low_end_db: 0,
          tweak_air_db: 0,
          tweak_presence_db: 0,
          tweak_width: 0,
          tweak_intensity: 0,
          tweak_limiter: 0,
          album_wav: true
        },
        tracks: [
          { path: trackA, title: "Drop A", character: "auto", preset: "auto", artist: "", isrc: "" },
          { path: trackB, title: "Drop B", character: "auto", preset: "auto", artist: "", isrc: "" }
        ],
        transitions: [{ after_track: 1, duration_seconds: 0.5, style: "inherit", enabled: true }]
      },
      null,
      2,
    ),
  );

  const renderOutput = runCli(["render-project", projectPath, "--output", outputDir, "--json-events"]);
  assert.match(renderOutput, /"type":"progress"/);
  const manifest = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
  assert.equal(manifest.track_count, 2);
  assert.equal(manifest.interlude_count, 1);
  assert.ok(manifest.album_sequence);
});
