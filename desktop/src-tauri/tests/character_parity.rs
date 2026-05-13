use album_mastering_studio_desktop_lib::dsp::{process_character, CharacterSettings};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const SAMPLE_RATE: f32 = 48_000.0;
const CHANNELS: usize = 2;
const PARITY_LIMIT_RMS: f32 = 0.005_623_413_3;
const HARMONIC_LIMIT_DB: f32 = 1.0;

#[test]
fn rust_character_matches_python_oracle() {
    for warmth in [0.0_f32, 0.035, 0.11] {
        let settings = CharacterSettings { warmth };
        let input = curated_character_signal();
        let mut rust_output = input.clone();
        process_character(&mut rust_output, &settings);

        let python_output = python_character_oracle(&input, settings);
        let rms = channel_rms_delta(&rust_output, &python_output);
        let third_delta_db = third_harmonic_delta_db(&rust_output, &python_output);
        println!(
            "Character parity warmth {:.3}: left {}, right {}, third harmonic delta {:.3} dB",
            warmth,
            dbfs_label(rms[0]),
            dbfs_label(rms[1]),
            third_delta_db
        );

        assert!(
            rms.iter().all(|value| *value <= PARITY_LIMIT_RMS),
            "Character parity failed for warmth {:.3}: left RMS {:.8}, right RMS {:.8}; limit {:.8}",
            warmth,
            rms[0],
            rms[1],
            PARITY_LIMIT_RMS
        );
        assert!(
            third_delta_db <= HARMONIC_LIMIT_DB,
            "Character third harmonic drift {:.3} dB exceeds {:.3} dB for warmth {:.3}",
            third_delta_db,
            HARMONIC_LIMIT_DB,
            warmth
        );
    }
}

fn curated_character_signal() -> Vec<f32> {
    let frames = SAMPLE_RATE as usize * 10;
    let mut samples = Vec::with_capacity(frames * CHANNELS);
    let mut white = 0x8765_4321_u32;
    let mut pink_left = PinkNoise::default();
    let mut pink_right = PinkNoise::default();

    for frame in 0..frames {
        let t = frame as f32 / SAMPLE_RATE;
        let (left, right) = if frame < SAMPLE_RATE as usize * 2 {
            let value = (2.0 * std::f32::consts::PI * 1_000.0 * t).sin() * db_to_amp(-3.0);
            (value, value * 0.98)
        } else if frame < SAMPLE_RATE as usize * 6 {
            (
                white_noise(&mut white) * db_to_amp(-12.0),
                white_noise(&mut white) * db_to_amp(-12.0),
            )
        } else {
            (
                pink_left.process(white_noise(&mut white)) * db_to_amp(-6.0),
                pink_right.process(white_noise(&mut white)) * db_to_amp(-6.0),
            )
        };
        samples.push(left);
        samples.push(right);
    }

    samples
}

#[derive(Default)]
struct PinkNoise {
    b0: f32,
    b1: f32,
    b2: f32,
    b3: f32,
    b4: f32,
    b5: f32,
    b6: f32,
}

impl PinkNoise {
    fn process(&mut self, white: f32) -> f32 {
        self.b0 = (0.99886 * self.b0) + (white * 0.0555179);
        self.b1 = (0.99332 * self.b1) + (white * 0.0750759);
        self.b2 = (0.96900 * self.b2) + (white * 0.1538520);
        self.b3 = (0.86650 * self.b3) + (white * 0.3104856);
        self.b4 = (0.55000 * self.b4) + (white * 0.5329522);
        self.b5 = (-0.7616 * self.b5) - (white * 0.0168980);
        let pink =
            self.b0 + self.b1 + self.b2 + self.b3 + self.b4 + self.b5 + self.b6 + (white * 0.5362);
        self.b6 = white * 0.115926;
        (pink * 0.11).clamp(-1.0, 1.0)
    }
}

fn white_noise(state: &mut u32) -> f32 {
    *state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    let value = ((*state >> 8) as f32) / ((1_u32 << 24) as f32);
    (value * 2.0) - 1.0
}

fn python_character_oracle(input: &[f32], settings: CharacterSettings) -> Vec<f32> {
    let root = repo_root();
    let scratch = env::temp_dir().join(format!(
        "album-mastering-studio-character-parity-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before UNIX_EPOCH")
            .as_nanos()
    ));
    fs::create_dir_all(&scratch).expect("create character parity scratch dir");
    let input_path = scratch.join("input.raw");
    let output_path = scratch.join("output.raw");
    write_f32_raw(&input_path, input);

    let script = r#"
import numpy as np
import sys

input_path, output_path = sys.argv[1], sys.argv[2]
warmth = max(float(sys.argv[3]), 0.0)
samples = np.fromfile(input_path, dtype=np.float32).reshape((-1, 2))
if warmth <= 0.0 or samples.size == 0:
    processed = samples.astype(np.float32)
else:
    drive = 1.0 + (warmth * 4.0)
    saturated = np.tanh(samples * drive) / np.tanh(drive)
    processed = ((samples * (1.0 - warmth)) + (saturated * warmth)).astype(np.float32)
processed.tofile(output_path)
"#;

    let status = Command::new(python_exe())
        .arg("-c")
        .arg(script)
        .arg(&input_path)
        .arg(&output_path)
        .arg(settings.warmth.to_string())
        .env("PYTHONPATH", root.join("src"))
        .current_dir(&root)
        .status()
        .expect("run Python character parity oracle");
    assert!(
        status.success(),
        "Python character parity oracle failed: {status}"
    );

    let output = read_f32_raw(&output_path);
    let _ = fs::remove_dir_all(&scratch);
    output
}

fn third_harmonic_delta_db(rust: &[f32], python: &[f32]) -> f32 {
    let frames = SAMPLE_RATE as usize * 2;
    let rust_amp = sine_bin_amplitude(rust, frames, 3_000.0);
    let python_amp = sine_bin_amplitude(python, frames, 3_000.0);
    (20.0 * (rust_amp.max(1.0e-12) / python_amp.max(1.0e-12)).log10()).abs()
}

fn sine_bin_amplitude(samples: &[f32], frames: usize, frequency: f32) -> f32 {
    let mut real = 0.0_f64;
    let mut imag = 0.0_f64;
    for frame in 0..frames {
        let sample = f64::from(samples[frame * CHANNELS]);
        let phase = -2.0 * std::f64::consts::PI * f64::from(frequency) * frame as f64
            / f64::from(SAMPLE_RATE);
        real += sample * phase.cos();
        imag += sample * phase.sin();
    }
    ((real * real + imag * imag).sqrt() * 2.0 / frames as f64) as f32
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
