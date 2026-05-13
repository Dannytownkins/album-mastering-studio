use album_mastering_studio_desktop_lib::dsp::{process_mbc_with_trace, MbcSettings};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const SAMPLE_RATE: f32 = 48_000.0;
const CHANNELS: usize = 2;
const PARITY_LIMIT_RMS: f32 = 0.003_162_277_6;
const GR_TRACE_LIMIT_DB: f32 = 0.3;
const TRACE_HZ: f32 = 100.0;

#[test]
fn rust_mbc_matches_python_mbc_oracle() {
    let settings = MbcSettings {
        threshold_dbfs: -24.0,
        ratio: 3.0,
        ..MbcSettings::default()
    };
    let input = curated_compressor_signal();
    let mut rust_output = input.clone();
    let rust_trace = process_mbc_with_trace(&mut rust_output, &settings, SAMPLE_RATE, TRACE_HZ);

    let python = python_mbc_oracle(&input, settings);
    let rms = channel_rms_delta(&rust_output, &python.samples);
    let gr_peak_delta = peak_gr_trace_delta(&rust_trace, &python.trace);

    println!(
        "MBC parity: left {}, right {}, GR trace peak delta {:.3} dB",
        dbfs_label(rms[0]),
        dbfs_label(rms[1]),
        gr_peak_delta
    );

    assert!(
        rms.iter().all(|value| *value <= PARITY_LIMIT_RMS),
        "MBC parity failed: left RMS {:.8}, right RMS {:.8}; limit {:.8}",
        rms[0],
        rms[1],
        PARITY_LIMIT_RMS
    );
    assert!(
        gr_peak_delta <= GR_TRACE_LIMIT_DB,
        "MBC gain-reduction trace drift {:.3} dB exceeds {:.3} dB",
        gr_peak_delta,
        GR_TRACE_LIMIT_DB
    );
}

#[derive(Debug)]
struct PythonMbcOutput {
    samples: Vec<f32>,
    trace: Vec<[f32; 4]>,
}

fn curated_compressor_signal() -> Vec<f32> {
    let frames = SAMPLE_RATE as usize * 10;
    let mut samples = Vec::with_capacity(frames * CHANNELS);
    let mut noise = 0x1234_5678_u32;

    for frame in 0..frames {
        let t = frame as f32 / SAMPLE_RATE;
        let (left, right) = if frame < SAMPLE_RATE as usize * 2 {
            let value = (2.0 * std::f32::consts::PI * 1_000.0 * t).sin() * db_to_amp(-6.0);
            (value, value * 0.97)
        } else if frame < SAMPLE_RATE as usize * 6 {
            let left = (white_noise(&mut noise) * db_to_amp(-12.0)).clamp(-1.0, 1.0);
            let right = (white_noise(&mut noise) * db_to_amp(-12.0)).clamp(-1.0, 1.0);
            (left, right)
        } else {
            let low = (2.0 * std::f32::consts::PI * 80.0 * t).sin();
            let high = (2.0 * std::f32::consts::PI * 8_000.0 * t).sin();
            let value = (low + high) * 0.5 * db_to_amp(-10.0);
            (value, value * 0.94)
        };
        samples.push(left);
        samples.push(right);
    }

    samples
}

fn white_noise(state: &mut u32) -> f32 {
    *state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    let value = ((*state >> 8) as f32) / ((1_u32 << 24) as f32);
    (value * 2.0) - 1.0
}

fn python_mbc_oracle(input: &[f32], settings: MbcSettings) -> PythonMbcOutput {
    let root = repo_root();
    let scratch = env::temp_dir().join(format!(
        "album-mastering-studio-mbc-parity-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before UNIX_EPOCH")
            .as_nanos()
    ));
    fs::create_dir_all(&scratch).expect("create MBC parity scratch dir");
    let input_path = scratch.join("input.raw");
    let output_path = scratch.join("output.raw");
    let trace_path = scratch.join("trace.raw");
    write_f32_raw(&input_path, input);

    let script = r#"
import numpy as np
import sys
from scipy import signal

SAMPLE_RATE = 48000.0
LOW_HZ = 120.0
HIGH_HZ = 4000.0
Q = 0.7071068
RMS_WINDOW_SECONDS = 0.010
EPS = 1e-9
TRACE_HZ = 100.0

def normalize(b0, b1, b2, a0, a1, a2):
    return (
        np.array([b0 / a0, b1 / a0, b2 / a0], dtype=np.float64),
        np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64),
    )

def butter_lp(freq):
    omega = 2.0 * np.pi * freq / SAMPLE_RATE
    alpha = np.sin(omega) / (2.0 * max(Q, 0.000001))
    c = np.cos(omega)
    return normalize((1.0-c)*0.5, 1.0-c, (1.0-c)*0.5, 1.0+alpha, -2.0*c, 1.0-alpha)

def butter_hp(freq):
    omega = 2.0 * np.pi * freq / SAMPLE_RATE
    alpha = np.sin(omega) / (2.0 * max(Q, 0.000001))
    c = np.cos(omega)
    return normalize((1.0+c)*0.5, -(1.0+c), (1.0+c)*0.5, 1.0+alpha, -2.0*c, 1.0-alpha)

def lr4_split(x):
    low = signal.lfilter(*butter_lp(LOW_HZ), x, axis=0)
    low = signal.lfilter(*butter_lp(LOW_HZ), low, axis=0)
    mid = signal.lfilter(*butter_hp(LOW_HZ), x, axis=0)
    mid = signal.lfilter(*butter_hp(LOW_HZ), mid, axis=0)
    mid = signal.lfilter(*butter_lp(HIGH_HZ), mid, axis=0)
    mid = signal.lfilter(*butter_lp(HIGH_HZ), mid, axis=0)
    high = signal.lfilter(*butter_hp(HIGH_HZ), x, axis=0)
    high = signal.lfilter(*butter_hp(HIGH_HZ), high, axis=0)
    return [low, mid, high]

def coeff(seconds):
    return float(np.exp(-1.0 / (max(seconds, 0.000001) * SAMPLE_RATE)))

def gain_reduction_db(input_db, threshold, ratio, knee):
    ratio = max(ratio, 1.0)
    knee = max(knee, 0.0)
    if knee <= 0.0:
        return -max(input_db - threshold, 0.0) * (1.0 - (1.0 / ratio))
    lower = threshold - (knee * 0.5)
    upper = threshold + (knee * 0.5)
    if input_db <= lower:
        output = input_db
    elif input_db >= upper:
        output = threshold + ((input_db - threshold) / ratio)
    else:
        output = input_db + (((1.0 / ratio) - 1.0) * ((input_db - lower) ** 2) / (2.0 * knee))
    return output - input_db

input_path, output_path, trace_path = sys.argv[1], sys.argv[2], sys.argv[3]
threshold, ratio, attack_seconds, release_seconds, knee_db, makeup_db = [float(arg) for arg in sys.argv[4:10]]
samples = np.fromfile(input_path, dtype=np.float32).reshape((-1, 2)).astype(np.float64)
bands = lr4_split(samples)
attack = coeff(attack_seconds)
release = coeff(release_seconds)
rms_window = max(int(round(SAMPLE_RATE * RMS_WINDOW_SECONDS)), 1)
trace_interval = max(int(round(SAMPLE_RATE / TRACE_HZ)), 1)
output = np.zeros_like(samples)
trace = []

for band_index, band in enumerate(bands):
    envelope = 0.0
    squares = np.zeros(rms_window, dtype=np.float64)
    square_sum = 0.0
    square_index = 0
    gains = np.zeros(band.shape[0], dtype=np.float64)
    reductions = np.zeros(band.shape[0], dtype=np.float64)
    detector = np.maximum(np.abs(band[:, 0]), np.abs(band[:, 1]))
    for i, value in enumerate(detector):
        square = value * value
        square_sum += square - squares[square_index]
        squares[square_index] = square
        square_index = (square_index + 1) % rms_window
        level = np.sqrt(max(square_sum, 0.0) / rms_window)
        alpha = attack if level > envelope else release
        envelope = (alpha * envelope) + ((1.0 - alpha) * level)
        input_db = 20.0 * np.log10(max(envelope, EPS))
        reduction_db = gain_reduction_db(input_db, threshold, ratio, knee_db)
        gains[i] = 10.0 ** ((reduction_db + makeup_db) / 20.0)
        reductions[i] = -reduction_db
    output += band * gains[:, np.newaxis]
    bands[band_index] = reductions

for i in range(0, samples.shape[0], trace_interval):
    trace.append([float(i), float(bands[0][i]), float(bands[1][i]), float(bands[2][i])])

output.astype(np.float32).tofile(output_path)
np.asarray(trace, dtype=np.float32).tofile(trace_path)
"#;

    let status = Command::new(python_exe())
        .arg("-c")
        .arg(script)
        .arg(&input_path)
        .arg(&output_path)
        .arg(&trace_path)
        .arg(settings.threshold_dbfs.to_string())
        .arg(settings.ratio.to_string())
        .arg(settings.attack_seconds.to_string())
        .arg(settings.release_seconds.to_string())
        .arg(settings.knee_db.to_string())
        .arg(settings.makeup_db.to_string())
        .env("PYTHONPATH", root.join("src"))
        .current_dir(&root)
        .status()
        .expect("run Python MBC parity oracle");
    assert!(status.success(), "Python MBC parity oracle failed: {status}");

    let samples = read_f32_raw(&output_path);
    let trace_values = read_f32_raw(&trace_path);
    let trace = trace_values
        .chunks_exact(4)
        .map(|chunk| [chunk[0], chunk[1], chunk[2], chunk[3]])
        .collect::<Vec<_>>();
    let _ = fs::remove_dir_all(&scratch);
    PythonMbcOutput { samples, trace }
}

fn peak_gr_trace_delta(
    rust_trace: &[album_mastering_studio_desktop_lib::dsp::MbcTraceFrame],
    python_trace: &[[f32; 4]],
) -> f32 {
    assert_eq!(rust_trace.len(), python_trace.len());
    rust_trace
        .iter()
        .zip(python_trace)
        .flat_map(|(rust, python)| {
            assert_eq!(rust.frame as f32, python[0]);
            [
                (rust.low_gr_db - python[1]).abs(),
                (rust.mid_gr_db - python[2]).abs(),
                (rust.high_gr_db - python[3]).abs(),
            ]
        })
        .fold(0.0_f32, f32::max)
}

fn channel_rms_delta(left: &[f32], right: &[f32]) -> [f32; 2] {
    assert_eq!(left.len(), right.len());
    let frames = left.len() / CHANNELS;
    let mut sum = [0.0_f64; 2];
    for frame in 0..frames {
        for channel in 0..CHANNELS {
            let index = (frame * CHANNELS) + channel;
            let delta = f64::from(left[index] - right[index]);
            sum[channel] += delta * delta;
        }
    }
    [
        (sum[0] / frames as f64).sqrt() as f32,
        (sum[1] / frames as f64).sqrt() as f32,
    ]
}

fn dbfs_label(rms: f32) -> String {
    if rms <= 0.0 {
        "-inf dBFS".to_string()
    } else {
        format!("{:.2} dBFS", 20.0 * rms.log10())
    }
}

fn db_to_amp(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

fn write_f32_raw(path: &Path, samples: &[f32]) {
    let bytes = samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect::<Vec<_>>();
    fs::write(path, bytes).expect("write raw f32 input");
}

fn read_f32_raw(path: &Path) -> Vec<f32> {
    let bytes = fs::read(path).expect("read raw f32 output");
    assert_eq!(bytes.len() % 4, 0);
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("resolve repo root from desktop/src-tauri")
        .to_path_buf()
}

fn python_exe() -> String {
    env::var("ALBUM_MASTER_PYTHON").unwrap_or_else(|_| "python".to_string())
}
