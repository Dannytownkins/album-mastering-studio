use album_mastering_studio_desktop_lib::dsp::{process_eq, EqSettings};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const SAMPLE_RATE: f32 = 48_000.0;
const CHANNELS: usize = 2;
const PARITY_LIMIT_RMS: f32 = 0.001;

#[test]
fn rust_eq_matches_python_eq_oracle() {
    for settings in [
        EqSettings {
            low_db: 0.0,
            mid_db: 0.0,
            high_db: 0.0,
        },
        EqSettings {
            low_db: 3.0,
            mid_db: 3.0,
            high_db: 3.0,
        },
        EqSettings {
            low_db: -3.0,
            mid_db: -3.0,
            high_db: -3.0,
        },
    ] {
        let input = canonical_test_signal();
        let mut rust_output = input.clone();
        process_eq(&mut rust_output, &settings, SAMPLE_RATE);

        let python_output = python_eq_oracle(&input, settings);
        let rms = channel_rms_delta(&rust_output, &python_output);
        println!(
            "EQ parity {:?}: left {}, right {}",
            settings,
            dbfs_label(rms[0]),
            dbfs_label(rms[1])
        );

        assert!(
            rms.iter().all(|value| *value <= PARITY_LIMIT_RMS),
            "EQ parity failed for {:?}: left RMS {:.6}, right RMS {:.6}; limit {:.6}",
            settings,
            rms[0],
            rms[1],
            PARITY_LIMIT_RMS
        );
    }
}

fn dbfs_label(rms: f32) -> String {
    if rms <= 0.0 {
        "-inf dBFS".to_string()
    } else {
        format!("{:.2} dBFS", 20.0 * rms.log10())
    }
}

fn canonical_test_signal() -> Vec<f32> {
    let frames = SAMPLE_RATE as usize * 2;
    let mut samples = Vec::with_capacity(frames * CHANNELS);
    for frame in 0..frames {
        let t = frame as f32 / SAMPLE_RATE;
        let left = (2.0 * std::f32::consts::PI * 97.0 * t).sin() * 0.19
            + (2.0 * std::f32::consts::PI * 1_000.0 * t).sin() * 0.13
            + (2.0 * std::f32::consts::PI * 9_700.0 * t).sin() * 0.07;
        let right = (2.0 * std::f32::consts::PI * 143.0 * t).sin() * 0.17
            + (2.0 * std::f32::consts::PI * 1_300.0 * t).sin() * 0.11
            + (2.0 * std::f32::consts::PI * 10_300.0 * t).sin() * 0.06;
        samples.push(left);
        samples.push(right);
    }
    samples
}

fn python_eq_oracle(input: &[f32], settings: EqSettings) -> Vec<f32> {
    let root = repo_root();
    let scratch = env::temp_dir().join(format!(
        "album-mastering-studio-eq-parity-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before UNIX_EPOCH")
            .as_nanos()
    ));
    fs::create_dir_all(&scratch).expect("create EQ parity scratch dir");
    let input_path = scratch.join("input.raw");
    let output_path = scratch.join("output.raw");
    write_f32_raw(&input_path, input);

    let script = r#"
import numpy as np
import sys
from scipy import signal

EQ_SHELF_SLOPE = 1.0
EQ_MID_Q = 0.707

def normalize(b0, b1, b2, a0, a1, a2):
    return (
        np.array([b0 / a0, b1 / a0, b2 / a0], dtype=np.float64),
        np.array([1.0, a1 / a0, a2 / a0], dtype=np.float64),
    )

def peak(sample_rate, frequency_hz, q, gain_db):
    amplitude = 10.0 ** (gain_db / 40.0)
    omega = 2.0 * np.pi * frequency_hz / sample_rate
    alpha = np.sin(omega) / (2.0 * max(q, 0.000001))
    cos_omega = np.cos(omega)
    return normalize(
        1.0 + (alpha * amplitude),
        -2.0 * cos_omega,
        1.0 - (alpha * amplitude),
        1.0 + (alpha / amplitude),
        -2.0 * cos_omega,
        1.0 - (alpha / amplitude),
    )

def shelf(sample_rate, frequency_hz, gain_db, slope, high):
    amplitude = 10.0 ** (gain_db / 40.0)
    omega = 2.0 * np.pi * frequency_hz / sample_rate
    sin_omega = np.sin(omega)
    cos_omega = np.cos(omega)
    alpha = (sin_omega / 2.0) * max(((amplitude + (1.0 / amplitude)) * ((1.0 / slope) - 1.0)) + 2.0, 0.0) ** 0.5
    beta = 2.0 * amplitude ** 0.5 * alpha
    if high:
        return normalize(
            amplitude * ((amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) + beta),
            -2.0 * amplitude * ((amplitude - 1.0) + ((amplitude + 1.0) * cos_omega)),
            amplitude * ((amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) - beta),
            (amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) + beta,
            2.0 * ((amplitude - 1.0) - ((amplitude + 1.0) * cos_omega)),
            (amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) - beta,
        )
    return normalize(
        amplitude * ((amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) + beta),
        2.0 * amplitude * ((amplitude - 1.0) - ((amplitude + 1.0) * cos_omega)),
        amplitude * ((amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) - beta),
        (amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) + beta,
        -2.0 * ((amplitude - 1.0) + ((amplitude + 1.0) * cos_omega)),
        (amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) - beta,
    )

input_path, output_path = sys.argv[1], sys.argv[2]
low_db, mid_db, high_db = (float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]))
sample_rate = 48000
samples = np.fromfile(input_path, dtype=np.float32).reshape((-1, 2))
processed = samples
if abs(low_db) > 0.000001:
    processed = signal.lfilter(*shelf(sample_rate, 100.0, low_db, EQ_SHELF_SLOPE, False), processed, axis=0)
if abs(mid_db) > 0.000001:
    processed = signal.lfilter(*peak(sample_rate, 1000.0, EQ_MID_Q, mid_db), processed, axis=0)
if abs(high_db) > 0.000001:
    processed = signal.lfilter(*shelf(sample_rate, 10000.0, high_db, EQ_SHELF_SLOPE, True), processed, axis=0)
processed.astype(np.float32).tofile(output_path)
"#;

    let status = Command::new(python_exe())
        .arg("-c")
        .arg(script)
        .arg(&input_path)
        .arg(&output_path)
        .arg(settings.low_db.to_string())
        .arg(settings.mid_db.to_string())
        .arg(settings.high_db.to_string())
        .env("PYTHONPATH", root.join("src"))
        .current_dir(&root)
        .status()
        .expect("run Python EQ parity oracle");
    assert!(status.success(), "Python EQ parity oracle failed: {status}");

    let output = read_f32_raw(&output_path);
    let _ = fs::remove_dir_all(&scratch);
    output
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
