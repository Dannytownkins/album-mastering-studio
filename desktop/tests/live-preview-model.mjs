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
  const python = process.env.PYTHON || "python";
  const script = String.raw`
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

source_path, export_path, output_path, tuning_json = sys.argv[1:]
tuning = json.loads(tuning_json)
config = ${JSON.stringify(livePreviewConfig)}

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

def shelf_filter(kind, gain_db, frequency, sample_rate):
    if abs(gain_db) < 1e-9:
        return None
    a_gain = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * frequency / sample_rate
    cosw = math.cos(w0)
    sinw = math.sin(w0)
    sqrt_a = math.sqrt(a_gain)
    alpha = sinw / 2 * math.sqrt(2.0)
    if kind == "low":
        b0 = a_gain * ((a_gain + 1) - (a_gain - 1) * cosw + 2 * sqrt_a * alpha)
        b1 = 2 * a_gain * ((a_gain - 1) - (a_gain + 1) * cosw)
        b2 = a_gain * ((a_gain + 1) - (a_gain - 1) * cosw - 2 * sqrt_a * alpha)
        a0 = (a_gain + 1) + (a_gain - 1) * cosw + 2 * sqrt_a * alpha
        a1 = -2 * ((a_gain - 1) + (a_gain + 1) * cosw)
        a2 = (a_gain + 1) + (a_gain - 1) * cosw - 2 * sqrt_a * alpha
    else:
        b0 = a_gain * ((a_gain + 1) + (a_gain - 1) * cosw + 2 * sqrt_a * alpha)
        b1 = -2 * a_gain * ((a_gain - 1) + (a_gain + 1) * cosw)
        b2 = a_gain * ((a_gain + 1) + (a_gain - 1) * cosw - 2 * sqrt_a * alpha)
        a0 = (a_gain + 1) - (a_gain - 1) * cosw + 2 * sqrt_a * alpha
        a1 = 2 * ((a_gain - 1) - (a_gain + 1) * cosw)
        a2 = (a_gain + 1) - (a_gain - 1) * cosw - 2 * sqrt_a * alpha
    return np.array([b0, b1, b2]) / a0, np.array([1.0, a1 / a0, a2 / a0])

def peaking_filter(gain_db, frequency, q, sample_rate):
    if abs(gain_db) < 1e-9:
        return None
    a_gain = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * frequency / sample_rate
    cosw = math.cos(w0)
    alpha = math.sin(w0) / (2 * q)
    b0 = 1 + alpha * a_gain
    b1 = -2 * cosw
    b2 = 1 - alpha * a_gain
    a0 = 1 + alpha / a_gain
    a1 = -2 * cosw
    a2 = 1 - alpha / a_gain
    return np.array([b0, b1, b2]) / a0, np.array([1.0, a1 / a0, a2 / a0])

def apply_biquad(audio, b, a):
    return np.column_stack([signal.lfilter(b, a, audio[:, channel]) for channel in range(audio.shape[1])]).astype(np.float32)

def apply_width(audio, width_setting):
    width_config = config["width"]
    width = max(float(width_config["min"]), min(float(width_config["max"]), float(width_config["base"]) + float(width_setting) * float(width_config["scale"])))
    mid = (audio[:, 0] + audio[:, 1]) * 0.5
    side = (audio[:, 0] - audio[:, 1]) * 0.5
    return np.column_stack([mid + side * width, mid - side * width]).astype(np.float32), width

def apply_static_compressor(audio, intensity):
    drive = max(0.0, min(1.0, float(intensity)))
    if drive <= 0:
        return audio.astype(np.float32), 0.0
    compressor = config["compressor"]
    threshold = float(compressor["thresholdBaseDbfs"]) - drive * float(compressor["thresholdDriveScaleDb"])
    ratio = float(compressor["ratioBase"]) + drive * float(compressor["ratioDriveScale"])
    knee = float(compressor["kneeDb"])
    level = np.max(np.abs(audio), axis=1)
    x_db = 20.0 * np.log10(np.maximum(level, 1e-12))
    y_db = np.array(x_db, copy=True)
    lower = threshold - knee / 2.0
    upper = threshold + knee / 2.0
    over = x_db > upper
    y_db[over] = threshold + (x_db[over] - threshold) / ratio
    if knee > 0:
        knee_zone = (x_db >= lower) & (x_db <= upper)
        y_db[knee_zone] = x_db[knee_zone] + (1.0 / ratio - 1.0) * ((x_db[knee_zone] - lower) ** 2) / (2.0 * knee)
    gain = np.power(10.0, (y_db - x_db) / 20.0)
    return (audio * gain[:, None]).astype(np.float32), drive

def rms_dbfs(audio):
    return 20.0 * math.log10(float(np.sqrt(np.mean(np.square(audio))) + 1e-12))

def peak_dbfs(audio):
    return 20.0 * math.log10(float(np.max(np.abs(audio)) + 1e-12))

source_rate, source = read_wav(source_path)
export_rate, exported = read_wav(export_path)
if source_rate != export_rate:
    raise SystemExit(f"Sample-rate mismatch: {source_rate} != {export_rate}")

live = source.copy()
for design in [
    shelf_filter("low", float(tuning.get("bassDb", 0.0)), float(config["filters"]["low"]["frequencyHz"]), source_rate),
    peaking_filter(float(tuning.get("midDb", 0.0)), float(config["filters"]["mid"]["frequencyHz"]), float(config["filters"]["mid"]["q"]), source_rate),
    shelf_filter("high", float(tuning.get("highDb", 0.0)), float(config["filters"]["high"]["frequencyHz"]), source_rate),
]:
    if design is not None:
        live = apply_biquad(live, design[0], design[1])
live, modeled_width = apply_width(live, float(tuning.get("width", 0.0)))
live, modeled_drive = apply_static_compressor(live, float(tuning.get("intensity", 0.0)))
live = np.clip(live, -1.0, 1.0).astype(np.float32)
Path(output_path).parent.mkdir(parents=True, exist_ok=True)
wavfile.write(output_path, source_rate, live)

length = min(source.shape[0], live.shape[0], exported.shape[0])
source = source[:length]
live = live[:length]
exported = exported[:length]
difference = exported - live
print(json.dumps({
    "offline_engine": "python-render-track-master",
    "live_preview_engine": config["modelId"],
    "same_engine": False,
    "preview_parity": "approximate",
    "export_faithful_preview_required": True,
    "tuning": tuning,
    "modeled_width": modeled_width,
    "modeled_drive": modeled_drive,
    "modeled_controls": ["Low", "Mid", "High", "Width", "Intensity"],
    "source_path": str(Path(source_path)),
    "export_path": str(Path(export_path)),
    "sample_rate": source_rate,
    "compared_frames": int(length),
    "live_model_path": str(Path(output_path)),
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
  const result = spawnSync(python, ["-c", script, sourcePath, exportPath, outputPath, JSON.stringify(tuning)], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const comparison = JSON.parse(result.stdout);
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
