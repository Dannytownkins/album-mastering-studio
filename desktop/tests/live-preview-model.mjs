import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
export const livePreviewConfig = JSON.parse(
  readFileSync(path.join(repoRoot, "desktop", "src", "livePreviewConfig.json"), "utf8"),
);

export const firstControlLivePreviewTuning = livePreviewConfig.firstControlTuning;

export function compareExportVsLiveModel({ sourcePath, exportPath, outputPath, tuning = firstControlLivePreviewTuning }) {
  assert.equal(existsSync(sourcePath), true, `Source path missing for parity comparison: ${sourcePath}`);
  assert.equal(existsSync(exportPath), true, `Export path missing for parity comparison: ${exportPath}`);

  const python = process.env.ALBUM_MASTER_PYTHON || process.env.PYTHON || "python";
  const render = spawnSync(
    python,
    [
      "-m",
      "album_mastering_studio.cli",
      "preview-model",
      sourcePath,
      "--output",
      outputPath,
      "--tuning-json",
      JSON.stringify(tuning),
    ],
    { encoding: "utf8" },
  );
  assert.equal(render.status, 0, render.stderr || render.stdout);
  const modelSummary = JSON.parse(render.stdout);

  const metricsScript = String.raw`
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

source_path, live_path, export_path = sys.argv[1:4]

def read_wav(path):
    sample_rate, audio = wavfile.read(path)
    if audio.ndim == 1:
        audio = audio[:, None]
    if np.issubdtype(audio.dtype, np.integer):
        peak = float(np.iinfo(audio.dtype).max)
        audio = audio.astype(np.float32) / peak
    else:
        audio = audio.astype(np.float32)
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    return int(sample_rate), np.nan_to_num(audio[:, :2], nan=0.0, posinf=0.0, neginf=0.0)

def rms_dbfs(audio):
    return 20.0 * math.log10(float(np.sqrt(np.mean(np.square(audio))) + 1e-12))

def peak_dbfs(audio):
    return 20.0 * math.log10(float(np.max(np.abs(audio)) + 1e-12))

source_rate, source = read_wav(source_path)
live_rate, live = read_wav(live_path)
export_rate, exported = read_wav(export_path)
if source_rate != live_rate or source_rate != export_rate:
    raise SystemExit(f"Sample-rate mismatch: source={source_rate} live={live_rate} export={export_rate}")

length = min(source.shape[0], live.shape[0], exported.shape[0])
source = source[:length]
live = live[:length]
exported = exported[:length]
difference = exported - live
print(json.dumps({
    "source_path": str(Path(source_path)),
    "export_path": str(Path(export_path)),
    "sample_rate": source_rate,
    "compared_frames": int(length),
    "live_model_path": str(Path(live_path)),
    "source_lufs_proxy": rms_dbfs(source),
    "live_lufs_proxy": rms_dbfs(live),
    "export_lufs_proxy": rms_dbfs(exported),
    "export_minus_live_lufs_proxy": rms_dbfs(exported) - rms_dbfs(live),
    "source_peak_dbfs": peak_dbfs(source),
    "live_peak_dbfs": peak_dbfs(live),
    "export_peak_dbfs": peak_dbfs(exported),
    "rms_difference_dbfs": rms_dbfs(difference)
}))
`;
  const metrics = spawnSync(python, ["-c", metricsScript, sourcePath, outputPath, exportPath], {
    encoding: "utf8",
  });
  assert.equal(metrics.status, 0, metrics.stderr || metrics.stdout);
  const { output: _modelOutput, source: _modelSource, ...modelMetadata } = modelSummary;
  const comparison = {
    offline_engine: "python-render-track-master",
    ...modelMetadata,
    ...JSON.parse(metrics.stdout),
  };
  const exportLoudnessDeltaVsSource = Math.abs(comparison.export_lufs_proxy - comparison.source_lufs_proxy);
  const liveLoudnessDeltaVsSource = Math.abs(comparison.live_lufs_proxy - comparison.source_lufs_proxy);
  const exportAndLiveLoudnessDeltaDifference = Math.abs(exportLoudnessDeltaVsSource - liveLoudnessDeltaVsSource);
  return {
    ...comparison,
    exportDiffersFromLiveMaterially:
      Math.abs(comparison.export_minus_live_lufs_proxy) >= 1 &&
      comparison.rms_difference_dbfs > -60,
    exportDominatesLiveLoudnessDelta: exportLoudnessDeltaVsSource > liveLoudnessDeltaVsSource + 0.5,
    exportLoudnessDeltaVsSource,
    liveLoudnessDeltaVsSource,
    exportAndLiveLoudnessDeltaDifference,
  };
}

export function compareLiveModelOutputs({ referencePath, candidatePath }) {
  assert.equal(existsSync(referencePath), true, `Reference model path missing: ${referencePath}`);
  assert.equal(existsSync(candidatePath), true, `Candidate model path missing: ${candidatePath}`);

  const python = process.env.ALBUM_MASTER_PYTHON || process.env.PYTHON || "python";
  const script = String.raw`
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

reference_path, candidate_path = sys.argv[1:3]

def read_wav(path):
    sample_rate, audio = wavfile.read(path)
    if audio.ndim == 1:
        audio = audio[:, None]
    if np.issubdtype(audio.dtype, np.integer):
        peak = float(np.iinfo(audio.dtype).max)
        audio = audio.astype(np.float32) / peak
    else:
        audio = audio.astype(np.float32)
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    return int(sample_rate), np.nan_to_num(audio[:, :2], nan=0.0, posinf=0.0, neginf=0.0)

def rms_dbfs(audio):
    return 20.0 * math.log10(float(np.sqrt(np.mean(np.square(audio))) + 1e-12))

reference_rate, reference = read_wav(reference_path)
candidate_rate, candidate = read_wav(candidate_path)
if reference_rate != candidate_rate:
    raise SystemExit(f"Sample-rate mismatch: reference={reference_rate} candidate={candidate_rate}")

length = min(reference.shape[0], candidate.shape[0])
reference = reference[:length]
candidate = candidate[:length]
difference = candidate - reference
print(json.dumps({
    "reference_path": str(Path(reference_path)),
    "candidate_path": str(Path(candidate_path)),
    "sample_rate": reference_rate,
    "compared_frames": int(length),
    "rms_difference_dbfs": rms_dbfs(difference),
    "max_abs_difference": float(np.max(np.abs(difference))) if difference.size else 0.0,
    "reference_lufs_proxy": rms_dbfs(reference),
    "candidate_lufs_proxy": rms_dbfs(candidate),
    "candidate_minus_reference_lufs_proxy": rms_dbfs(candidate) - rms_dbfs(reference)
}))
`;
  const result = spawnSync(python, ["-c", script, referencePath, candidatePath], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
