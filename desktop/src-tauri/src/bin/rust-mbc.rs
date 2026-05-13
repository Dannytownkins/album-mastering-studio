use album_mastering_studio_desktop_lib::dsp::{process_mbc, MbcSettings};
use std::{env, fs, path::PathBuf};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 5 {
        return Err(
            "Usage: rust-mbc <input.raw> <output.raw> <sample-rate> <threshold-dbfs> <ratio>"
                .to_string(),
        );
    }

    let input = PathBuf::from(&args[0]);
    let output = PathBuf::from(&args[1]);
    let sample_rate = args[2]
        .parse::<f32>()
        .map_err(|error| format!("Invalid sample rate '{}': {error}", args[2]))?;
    let settings = MbcSettings {
        threshold_dbfs: parse_float("threshold-dbfs", &args[3])?,
        ratio: parse_float("ratio", &args[4])?,
        ..MbcSettings::default()
    };

    let bytes = fs::read(&input)
        .map_err(|error| format!("Could not read MBC raw input {}: {error}", input.display()))?;
    if bytes.len() % 4 != 0 {
        return Err("MBC raw input byte length is not divisible by 4.".to_string());
    }
    let mut samples = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect::<Vec<_>>();
    if samples.len() % 2 != 0 {
        return Err("MBC raw input must contain complete stereo frames.".to_string());
    }

    process_mbc(&mut samples, &settings, sample_rate);

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let output_bytes = samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect::<Vec<_>>();
    fs::write(&output, output_bytes).map_err(|error| {
        format!(
            "Could not write MBC raw output {}: {error}",
            output.display()
        )
    })
}

fn parse_float(label: &str, value: &str) -> Result<f32, String> {
    value
        .parse::<f32>()
        .map_err(|error| format!("Invalid {label} value '{value}': {error}"))
}
