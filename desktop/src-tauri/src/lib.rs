use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::hash_map::DefaultHasher,
    env, fs,
    hash::{Hash, Hasher},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct ProcessState {
    child: Mutex<Option<Child>>,
}

#[derive(Default)]
struct NativePlaybackState {
    session: Mutex<Option<NativePlaybackSession>>,
}

const NATIVE_FILE_PLAYBACK_MAX_MS: u32 = 60 * 60 * 1000;
const NATIVE_LIVE_PREVIEW_MAX_MS: u32 = 60 * 1000;
const AUDIO_SOURCE_EXTENSIONS: &[&str] = &[
    "aac", "aif", "aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav",
];
const LIVE_PREVIEW_MODEL_ID: &str = "web-audio-first-control-model";
const LIVE_PREVIEW_LOW_HZ: f64 = 105.0;
const LIVE_PREVIEW_MID_HZ: f64 = 3200.0;
const LIVE_PREVIEW_MID_Q: f64 = 0.9;
const LIVE_PREVIEW_HIGH_HZ: f64 = 9800.0;
const LIVE_PREVIEW_WIDTH_BASE: f64 = 1.0;
const LIVE_PREVIEW_WIDTH_SCALE: f64 = 1.8;
const LIVE_PREVIEW_WIDTH_MIN: f64 = 0.35;
const LIVE_PREVIEW_WIDTH_MAX: f64 = 1.65;
const LIVE_PREVIEW_COMPRESSOR_THRESHOLD_DBFS: f64 = -18.0;
const LIVE_PREVIEW_COMPRESSOR_THRESHOLD_DRIVE_SCALE_DB: f64 = 3.0;
const LIVE_PREVIEW_COMPRESSOR_RATIO_BASE: f64 = 2.0;
const LIVE_PREVIEW_COMPRESSOR_RATIO_DRIVE_SCALE: f64 = 0.44;
const LIVE_PREVIEW_EPSILON: f64 = 1e-12;

struct NativePlaybackSession {
    id: String,
    label: String,
    started_at: Instant,
    output_device: String,
    output_config: NativeAudioConfig,
    queued_output_frames: usize,
    played_output_frames: Arc<AtomicUsize>,
    callback_events: Arc<Mutex<Vec<(u128, u32)>>>,
    stream_errors: Arc<Mutex<Vec<String>>>,
    warnings: Arc<Mutex<Vec<String>>>,
    stop_requested: Arc<AtomicBool>,
    pause_requested: Arc<AtomicBool>,
    join_handle: Option<thread::JoinHandle<()>>,
}

#[derive(Clone, Serialize)]
struct CliEvent {
    stream: String,
    line: String,
}

#[derive(Serialize)]
struct CliResult {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Serialize)]
struct AudioSourceValidation {
    path: String,
    exists: bool,
    supported: bool,
    is_directory: bool,
    status: String,
    detail: String,
    diagnostic: Option<String>,
}

#[derive(Serialize)]
struct ProductRenderResult {
    output_dir: String,
    project_path: String,
    manifest_path: String,
    dashboard_path: Option<String>,
    manifest: Value,
}

#[derive(Serialize)]
struct PreparedPlaybackFile {
    path: String,
    source: String,
    cache_hit: bool,
    elapsed_ms: f64,
    bytes: u64,
}

#[derive(Clone, Copy)]
struct RenderProjectOptions {
    score: bool,
    dashboard: bool,
}

impl Default for RenderProjectOptions {
    fn default() -> Self {
        Self {
            score: true,
            dashboard: true,
        }
    }
}

#[derive(Clone, Serialize)]
struct NativeAudioConfig {
    channels: u16,
    sample_rate: u32,
    sample_format: String,
    buffer_size: String,
}

#[derive(Serialize)]
struct NativeAudioConfigRange {
    channels: u16,
    min_sample_rate: u32,
    max_sample_rate: u32,
    sample_format: String,
    buffer_size: String,
}

#[derive(Serialize)]
struct NativeAudioProbe {
    host: String,
    available_hosts: Vec<String>,
    default_output_device: Option<String>,
    default_output_config: Option<NativeAudioConfig>,
    supported_output_configs: Vec<NativeAudioConfigRange>,
    estimated_default_buffer_ms: Option<f64>,
    warnings: Vec<String>,
}

#[derive(Serialize)]
struct NativeAudioStreamProbe {
    host: String,
    default_output_device: String,
    default_output_config: NativeAudioConfig,
    requested_duration_ms: u32,
    elapsed_ms: f64,
    callback_count: usize,
    total_frames: u64,
    observed_callback_frames: Vec<u32>,
    min_callback_interval_ms: Option<f64>,
    avg_callback_interval_ms: Option<f64>,
    p95_callback_interval_ms: Option<f64>,
    max_callback_interval_ms: Option<f64>,
    stream_errors: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Serialize)]
struct NativeAudioPlaybackProbe {
    path: String,
    host: String,
    default_output_device: String,
    default_output_config: NativeAudioConfig,
    source_channels: u16,
    source_sample_rate: u32,
    source_sample_format: String,
    source_total_frames: u64,
    source_duration_ms: f64,
    requested_start_ms: f64,
    requested_duration_ms: u32,
    queued_source_frames: usize,
    queued_output_frames: usize,
    played_output_frames: usize,
    elapsed_ms: f64,
    callback_count: usize,
    total_frames: u64,
    observed_callback_frames: Vec<u32>,
    min_callback_interval_ms: Option<f64>,
    avg_callback_interval_ms: Option<f64>,
    p95_callback_interval_ms: Option<f64>,
    max_callback_interval_ms: Option<f64>,
    stream_errors: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Serialize)]
struct NativeAbLoopProbe {
    source_path: String,
    master_path: String,
    host: String,
    default_output_device: String,
    default_output_config: NativeAudioConfig,
    source_channels: u16,
    source_sample_rate: u32,
    master_channels: u16,
    master_sample_rate: u32,
    source_sample_format: String,
    master_sample_format: String,
    requested_start_ms: f64,
    region_duration_ms: u32,
    total_duration_ms: u32,
    source_region_frames: usize,
    master_region_frames: usize,
    queued_output_frames: usize,
    played_output_frames: usize,
    side_switch_count: usize,
    elapsed_ms: f64,
    callback_count: usize,
    total_frames: u64,
    observed_callback_frames: Vec<u32>,
    min_callback_interval_ms: Option<f64>,
    avg_callback_interval_ms: Option<f64>,
    p95_callback_interval_ms: Option<f64>,
    max_callback_interval_ms: Option<f64>,
    stream_errors: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Serialize)]
struct NativePlaybackStatus {
    active: bool,
    paused: bool,
    id: Option<String>,
    label: Option<String>,
    output_device: Option<String>,
    output_config: Option<NativeAudioConfig>,
    elapsed_ms: f64,
    position_seconds: f64,
    duration_seconds: f64,
    queued_output_frames: usize,
    played_output_frames: usize,
    callback_count: usize,
    total_frames: u64,
    observed_callback_frames: Vec<u32>,
    min_callback_interval_ms: Option<f64>,
    avg_callback_interval_ms: Option<f64>,
    p95_callback_interval_ms: Option<f64>,
    max_callback_interval_ms: Option<f64>,
    stream_errors: Vec<String>,
    warnings: Vec<String>,
}

struct NativeAudioStreamProbeResult {
    elapsed_ms: f64,
    callback_count: usize,
    total_frames: u64,
    observed_callback_frames: Vec<u32>,
    min_callback_interval_ms: Option<f64>,
    avg_callback_interval_ms: Option<f64>,
    p95_callback_interval_ms: Option<f64>,
    max_callback_interval_ms: Option<f64>,
    stream_errors: Vec<String>,
    warnings: Vec<String>,
}

struct NativePlaybackClip {
    channels: u16,
    sample_rate: u32,
    total_frames: u64,
    start_frame: u64,
    samples: Vec<f32>,
}

#[derive(Clone, Copy)]
struct NativeLivePreviewTuning {
    bass_db: f64,
    mid_db: f64,
    high_db: f64,
    width: f64,
    intensity: f64,
}

#[derive(Clone, Copy)]
struct NativeBiquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

#[tauri::command]
fn repo_root() -> Result<String, String> {
    Ok(repo_root_path().to_string_lossy().to_string())
}

#[tauri::command]
fn default_output_dir() -> Result<String, String> {
    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::temp_dir());
    let documents = home.join("Documents");
    let base = if documents.exists() { documents } else { home };
    let output = base.join("Album Mastering Studio").join("Renders");
    fs::create_dir_all(&output)
        .map_err(|error| format!("Could not create default output folder: {error}"))?;
    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
fn validate_audio_sources(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<Vec<AudioSourceValidation>, String> {
    let ffprobe = tool_path(&app, "ffprobe.exe", "ffprobe");
    Ok(paths
        .into_iter()
        .map(|path| validate_audio_source(&ffprobe, path))
        .collect())
}

#[tauri::command]
fn read_json(path: String) -> Result<Value, String> {
    let text =
        fs::read_to_string(&path).map_err(|error| format!("Could not read {path}: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("Could not parse JSON {path}: {error}"))
}

#[tauri::command]
fn write_project(path: String, project: Value) -> Result<(), String> {
    let target = PathBuf::from(&path);
    write_json_file(&target, &project)
}

#[tauri::command]
fn write_listening_receipt(path: String, receipt: Value) -> Result<String, String> {
    let target = PathBuf::from(&path);
    write_json_file(&target, &receipt)?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn write_listening_packet(root: String, packet: Value) -> Result<Value, String> {
    let target_dir = PathBuf::from(&root);
    fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Could not create {}: {error}", target_dir.display()))?;
    let json_path = target_dir.join("listening-handoff.json");
    let html_path = target_dir.join("listening-handoff.html");
    write_json_file(&json_path, &packet)?;
    fs::write(&html_path, render_listening_packet_html(&packet))
        .map_err(|error| format!("Could not write {}: {error}", html_path.display()))?;
    Ok(json!({
        "json_path": json_path.to_string_lossy().to_string(),
        "html_path": html_path.to_string_lossy().to_string(),
    }))
}

#[tauri::command]
fn analyze_tracks(
    app: AppHandle,
    state: State<'_, ProcessState>,
    paths: Vec<String>,
    sample_rate: u32,
    waveform_bins: u32,
) -> Result<Value, String> {
    if paths.is_empty() {
        return Err("No tracks were provided for analysis.".to_string());
    }
    let mut args = vec!["analyze".to_string()];
    args.extend(paths);
    args.extend([
        "--sample-rate".to_string(),
        sample_rate.to_string(),
        "--waveform-bins".to_string(),
        waveform_bins.to_string(),
    ]);
    let result = run_engine_command(&app, state.inner(), args, None)?;
    serde_json::from_str(&result.stdout)
        .map_err(|error| format!("Could not parse analysis JSON: {error}"))
}

#[tauri::command]
fn live_preview_contract(app: AppHandle, state: State<'_, ProcessState>) -> Result<Value, String> {
    let result = run_engine_command(
        &app,
        state.inner(),
        vec!["preview-contract".to_string(), "--json".to_string()],
        None,
    )?;
    serde_json::from_str(&result.stdout)
        .map_err(|error| format!("Could not parse live preview contract JSON: {error}"))
}

#[tauri::command]
fn render_live_preview_model(
    app: AppHandle,
    state: State<'_, ProcessState>,
    source_path: String,
    output_path: String,
    sample_rate: u32,
    tuning: Value,
    start_seconds: Option<f64>,
    duration_seconds: Option<f64>,
) -> Result<Value, String> {
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err(format!(
            "Live Preview model source does not exist: {}",
            source.display()
        ));
    }
    let output = PathBuf::from(&output_path);
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create Live Preview model folder {}: {error}",
                parent.display()
            )
        })?;
    }
    let tuning_json = serde_json::to_string(&tuning)
        .map_err(|error| format!("Could not serialize Live Preview model tuning: {error}"))?;
    let mut args = vec![
        "preview-model".to_string(),
        source_path,
        "--output".to_string(),
        output_path.clone(),
        "--sample-rate".to_string(),
        sample_rate.to_string(),
        "--tuning-json".to_string(),
        tuning_json,
    ];
    if let Some(value) = start_seconds.filter(|value| value.is_finite() && *value >= 0.0) {
        args.extend(["--start-seconds".to_string(), value.to_string()]);
    }
    if let Some(value) = duration_seconds.filter(|value| value.is_finite() && *value > 0.0) {
        args.extend(["--duration-seconds".to_string(), value.to_string()]);
    }
    let result = run_engine_command(&app, state.inner(), args, None)?;
    let mut summary: Value = serde_json::from_str(&result.stdout)
        .map_err(|error| format!("Could not parse live preview model JSON: {error}"))?;
    if !output.exists() {
        return Err(format!(
            "Live Preview model output was not created: {}",
            output.display()
        ));
    }
    if let Value::Object(map) = &mut summary {
        map.insert("output_exists".to_string(), json!(true));
    }
    Ok(summary)
}

#[tauri::command]
fn render_native_live_preview_model(
    source_path: String,
    output_path: String,
    sample_rate: u32,
    tuning: Value,
    start_seconds: Option<f64>,
    duration_seconds: Option<f64>,
) -> Result<Value, String> {
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err(format!(
            "Native Live Preview model source does not exist: {}",
            source.display()
        ));
    }
    let output = PathBuf::from(&output_path);
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create native Live Preview model folder {}: {error}",
                parent.display()
            )
        })?;
    }

    let requested_start_seconds = start_seconds.unwrap_or(0.0).max(0.0);
    let requested_duration_ms = duration_seconds
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| ((value * 1000.0).ceil() as u32).clamp(250, NATIVE_LIVE_PREVIEW_MAX_MS));
    let clip = read_pcm16_wav_segment(&source, requested_start_seconds, requested_duration_ms)?;
    if clip.sample_rate != sample_rate {
        return Err(format!(
            "Native Live Preview model expects {sample_rate} Hz prepared PCM WAV; got {} Hz from {}",
            clip.sample_rate,
            source.display()
        ));
    }

    let input_tuning = tuning.clone();
    let tuning = native_live_preview_tuning(&tuning)?;
    let mut modeled = clip.samples.clone();
    let channels = usize::from(clip.channels);
    let modeled_frames = modeled.len() / channels.max(1);
    apply_native_live_preview_biquad(
        &mut modeled,
        channels,
        native_preview_shelf("low", tuning.bass_db, LIVE_PREVIEW_LOW_HZ, sample_rate)?,
    );
    apply_native_live_preview_biquad(
        &mut modeled,
        channels,
        native_preview_peaking(
            tuning.mid_db,
            LIVE_PREVIEW_MID_HZ,
            LIVE_PREVIEW_MID_Q,
            sample_rate,
        )?,
    );
    apply_native_live_preview_biquad(
        &mut modeled,
        channels,
        native_preview_shelf("high", tuning.high_db, LIVE_PREVIEW_HIGH_HZ, sample_rate)?,
    );
    let modeled_width = apply_native_live_preview_width(&mut modeled, channels, tuning.width);
    let modeled_drive =
        apply_native_live_preview_compressor(&mut modeled, channels, tuning.intensity);
    for sample in &mut modeled {
        *sample = sample.clamp(-1.0, 1.0);
    }
    write_pcm16_wav(&output, &modeled, clip.channels, clip.sample_rate)?;
    if !output.exists() {
        return Err(format!(
            "Native Live Preview model output was not created: {}",
            output.display()
        ));
    }

    Ok(json!({
        "source": source_path,
        "output": output_path,
        "output_exists": true,
        "sample_rate": sample_rate,
        "frame_count": modeled_frames,
        "source_total_frames": clip.total_frames,
        "source_start_seconds": clip.start_frame as f64 / f64::from(clip.sample_rate.max(1)),
        "duration_seconds": modeled_frames as f64 / f64::from(clip.sample_rate.max(1)),
        "live_preview_engine": LIVE_PREVIEW_MODEL_ID,
        "native_engine": "rust-native-live-preview-model",
        "same_engine": false,
        "preview_parity": "approximate",
        "export_faithful_preview_required": true,
        "modeled_controls": ["Low", "Mid", "High", "Width", "Intensity"],
        "modeled_width": modeled_width,
        "modeled_drive": modeled_drive,
        "tuning": input_tuning,
        "normalized_tuning": {
            "bassDb": tuning.bass_db,
            "midDb": tuning.mid_db,
            "highDb": tuning.high_db,
            "width": tuning.width,
            "intensity": tuning.intensity
        },
        "unmodeled_export_stages": [
            "preset_base_tone",
            "highpass",
            "low_mid_eq",
            "brightness_tilt",
            "warmth_saturation",
            "transient_shape",
            "lufs_match",
            "ceiling_limiter",
            "codec_qc"
        ]
    }))
}

#[tauri::command]
fn render_track_master(
    app: AppHandle,
    state: State<'_, ProcessState>,
    project: Value,
    output_dir: String,
) -> Result<ProductRenderResult, String> {
    render_project_product(
        &app,
        state.inner(),
        project,
        PathBuf::from(output_dir),
        "track.ams.json",
    )
}

#[tauri::command]
fn render_track_region_preview(
    app: AppHandle,
    state: State<'_, ProcessState>,
    mut project: Value,
    output_dir: String,
    start_seconds: f64,
    duration_seconds: f64,
    audition_only: Option<bool>,
) -> Result<ProductRenderResult, String> {
    let source = project
        .get("tracks")
        .and_then(Value::as_array)
        .and_then(|tracks| tracks.first())
        .and_then(|track| track.get("path"))
        .and_then(Value::as_str)
        .ok_or_else(|| "Region preview requires one source track.".to_string())?;
    let source_path = PathBuf::from(source);
    if !source_path.exists() {
        return Err(format!(
            "Region preview source does not exist: {}",
            source_path.display()
        ));
    }

    let sample_rate = project
        .get("settings")
        .and_then(|settings| settings.get("sample_rate"))
        .and_then(Value::as_u64)
        .unwrap_or(48_000)
        .clamp(8_000, 192_000);
    let safe_start = start_seconds.max(0.0);
    let safe_duration = duration_seconds.clamp(0.25, 60.0);
    let output_dir = PathBuf::from(output_dir);
    fs::create_dir_all(&output_dir).map_err(|error| {
        format!(
            "Could not create region preview folder {}: {error}",
            output_dir.display()
        )
    })?;
    let region_source = output_dir.join("region-source.wav");
    let ffmpeg = tool_path(&app, "ffmpeg.exe", "ffmpeg");
    let output = Command::new(&ffmpeg)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-ss")
        .arg(format!("{safe_start:.3}"))
        .arg("-t")
        .arg(format!("{safe_duration:.3}"))
        .arg("-i")
        .arg(&source_path)
        .arg("-vn")
        .arg("-ac")
        .arg("2")
        .arg("-ar")
        .arg(sample_rate.to_string())
        .arg("-sample_fmt")
        .arg("s16")
        .arg(&region_source)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Could not start FFmpeg for region preview: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "FFmpeg region preview trim failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let region_size = fs::metadata(&region_source)
        .map_err(|error| format!("Region preview source was not created: {error}"))?
        .len();
    if region_size == 0 {
        return Err("Region preview source was empty.".to_string());
    }

    if let Some(settings) = project.get_mut("settings").and_then(Value::as_object_mut) {
        settings.insert("album_wav".to_string(), json!(false));
        settings.insert("generated_transitions".to_string(), json!(false));
        settings.insert("codec_preview".to_string(), json!(false));
    }
    let track = project
        .get_mut("tracks")
        .and_then(Value::as_array_mut)
        .and_then(|tracks| tracks.first_mut())
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "Region preview project track is not editable.".to_string())?;
    track.insert(
        "path".to_string(),
        json!(region_source.to_string_lossy().to_string()),
    );

    let options = if audition_only.unwrap_or(false) {
        RenderProjectOptions {
            score: false,
            dashboard: false,
        }
    } else {
        RenderProjectOptions::default()
    };
    render_project_product_with_options(
        &app,
        state.inner(),
        project,
        output_dir,
        "region-preview.ams.json",
        options,
    )
}

#[tauri::command]
fn render_album_master(
    app: AppHandle,
    state: State<'_, ProcessState>,
    project: Value,
    output_dir: String,
) -> Result<ProductRenderResult, String> {
    render_project_product(
        &app,
        state.inner(),
        project,
        PathBuf::from(output_dir),
        "album.ams.json",
    )
}

#[tauri::command]
fn plan_album_project(
    app: AppHandle,
    state: State<'_, ProcessState>,
    project: Value,
    output_dir: String,
) -> Result<Value, String> {
    let output_dir = PathBuf::from(output_dir);
    fs::create_dir_all(&output_dir).map_err(|error| {
        format!(
            "Could not create album plan folder {}: {error}",
            output_dir.display()
        )
    })?;
    let project_path = output_dir.join("album-plan.ams.json");
    write_json_file(&project_path, &project)?;
    let result = run_engine_command(
        &app,
        state.inner(),
        vec![
            "plan-project".to_string(),
            project_path.to_string_lossy().to_string(),
        ],
        None,
    )?;
    let stdout = result.stdout.trim();
    let mut plan: Value = serde_json::from_str(stdout).map_err(|error| {
        format!("Could not parse album plan as JSON: {error}. Output: {stdout}")
    })?;
    let object = plan
        .as_object_mut()
        .ok_or_else(|| "Album plan must be a JSON object.".to_string())?;
    object.insert(
        "output_dir".to_string(),
        json!(output_dir.to_string_lossy().to_string()),
    );
    object.insert(
        "project_path".to_string(),
        json!(project_path.to_string_lossy().to_string()),
    );
    Ok(plan)
}

#[tauri::command]
fn render_album_boundary_preview(
    app: AppHandle,
    state: State<'_, ProcessState>,
    project: Value,
    output_dir: String,
    after_track: u64,
    tail_seconds: Option<f64>,
    head_seconds: Option<f64>,
) -> Result<Value, String> {
    if after_track == 0 {
        return Err("Boundary preview requires a 1-based after_track value.".to_string());
    }
    let output_dir = PathBuf::from(output_dir);
    fs::create_dir_all(&output_dir).map_err(|error| {
        format!(
            "Could not create boundary preview folder {}: {error}",
            output_dir.display()
        )
    })?;
    let project_path = output_dir.join("album-boundary-preview.ams.json");
    let output_path = output_dir.join(format!(
        "boundary-{after_track:02}-to-{next:02}.wav",
        next = after_track + 1
    ));
    write_json_file(&project_path, &project)?;

    let tail = tail_seconds.unwrap_or(8.0).clamp(0.25, 60.0);
    let head = head_seconds.unwrap_or(8.0).clamp(0.25, 60.0);
    let result = run_engine_command(
        &app,
        state.inner(),
        vec![
            "preview-transition".to_string(),
            project_path.to_string_lossy().to_string(),
            "--after-track".to_string(),
            after_track.to_string(),
            "--output".to_string(),
            output_path.to_string_lossy().to_string(),
            "--tail-seconds".to_string(),
            format!("{tail:.3}"),
            "--head-seconds".to_string(),
            format!("{head:.3}"),
        ],
        None,
    )?;

    let output_size = fs::metadata(&output_path)
        .map_err(|error| format!("Boundary preview was not created: {error}"))?
        .len();
    if output_size == 0 {
        return Err("Boundary preview output was empty.".to_string());
    }

    let stdout = result.stdout.trim();
    let mut summary: Value = serde_json::from_str(stdout).map_err(|error| {
        format!("Could not parse boundary preview summary as JSON: {error}. Output: {stdout}")
    })?;
    let object = summary
        .as_object_mut()
        .ok_or_else(|| "Boundary preview summary must be a JSON object.".to_string())?;
    object.insert(
        "output_dir".to_string(),
        json!(output_dir.to_string_lossy().to_string()),
    );
    object.insert(
        "project_path".to_string(),
        json!(project_path.to_string_lossy().to_string()),
    );
    object.insert("output_exists".to_string(), json!(true));
    object.insert("output_bytes".to_string(), json!(output_size));
    Ok(summary)
}

#[tauri::command]
fn run_export_checks(manifest: Value) -> Result<Value, String> {
    let warnings = manifest
        .get("warnings")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let sequence = manifest
        .get("sequence")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let tracks = sequence
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("track"))
        .collect::<Vec<_>>();
    let interludes = sequence
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("interlude"))
        .collect::<Vec<_>>();
    let track_count = manifest
        .get("track_count")
        .and_then(Value::as_u64)
        .unwrap_or(tracks.len() as u64);
    let interlude_count = manifest
        .get("interlude_count")
        .and_then(Value::as_u64)
        .unwrap_or(interludes.len() as u64);
    let album_wav_requested = manifest
        .get("settings")
        .and_then(|settings| settings.get("album_wav"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let codec_preview_requested = manifest
        .get("settings")
        .and_then(|settings| settings.get("codec_preview"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let album_sequence = manifest.get("album_sequence").and_then(Value::as_str);
    let codec_previews = manifest
        .get("codec_previews")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut checks = Vec::<Value>::new();
    let mut fail_count = 0_u32;
    let mut warn_count = 0_u32;
    push_export_check(
        &mut checks,
        &mut fail_count,
        &mut warn_count,
        "Manifest",
        !sequence.is_empty(),
        false,
        format!("{} sequence item(s)", sequence.len()),
    );
    push_export_check(
        &mut checks,
        &mut fail_count,
        &mut warn_count,
        "Track outputs",
        tracks.len() as u64 == track_count
            && !tracks.is_empty()
            && tracks
                .iter()
                .all(|track| local_path_exists_json(track.get("output"))),
        false,
        format!("{} rendered track path(s) exist", tracks.len()),
    );
    let non_finite = tracks.iter().any(|track| {
        let after = track.get("after").unwrap_or(&Value::Null);
        !finite_json_number(after.get("integrated_lufs"))
            || !finite_json_number(after.get("true_peak_dbfs"))
    });
    push_export_check(
        &mut checks,
        &mut fail_count,
        &mut warn_count,
        "Meter values",
        !non_finite,
        false,
        "Rendered track LUFS and peak values are finite.",
    );
    if album_wav_requested {
        push_export_check(
            &mut checks,
            &mut fail_count,
            &mut warn_count,
            "Album WAV",
            local_path_exists_json(manifest.get("album_sequence")),
            false,
            album_sequence
                .unwrap_or("missing album_sequence.wav")
                .to_string(),
        );
    } else {
        checks.push(json!({
            "label": "Album WAV",
            "status": "skip",
            "detail": "Not requested for this render."
        }));
    }
    if codec_preview_requested {
        push_export_check(
            &mut checks,
            &mut fail_count,
            &mut warn_count,
            "Codec QC",
            !codec_previews.is_empty()
                && codec_previews
                    .iter()
                    .all(|preview| local_path_exists_json(preview.get("output"))),
            false,
            format!("{} codec preview path(s) exist", codec_previews.len()),
        );
    } else {
        checks.push(json!({
            "label": "Codec QC",
            "status": "skip",
            "detail": "Not requested for this render."
        }));
    }
    push_export_check(
        &mut checks,
        &mut fail_count,
        &mut warn_count,
        "Advisory warnings",
        warnings.is_empty(),
        !warnings.is_empty(),
        if warnings.is_empty() {
            "No render warnings emitted.".to_string()
        } else {
            format!("{} warning(s) need review", warnings.len())
        },
    );

    let status = if fail_count > 0 {
        "fail"
    } else if warn_count > 0 {
        "warn"
    } else {
        "pass"
    };
    Ok(json!({
        "status": status,
        "summary": format!(
            "{} track(s), {} transition(s), {} warning(s)",
            track_count,
            interlude_count,
            warnings.len()
        ),
        "track_count": track_count,
        "interlude_count": interlude_count,
        "warning_count": warnings.len(),
        "checks": checks,
        "warnings": warnings
    }))
}

#[tauri::command]
fn native_audio_probe() -> Result<NativeAudioProbe, String> {
    let host = cpal::default_host();
    let mut warnings = Vec::new();
    let available_hosts = cpal::available_hosts()
        .into_iter()
        .map(|host_id| format!("{host_id:?}"))
        .collect::<Vec<_>>();
    let default_output_device = match host.default_output_device() {
        Some(device) => device,
        None => {
            warnings.push("No default native output device was reported by cpal.".to_string());
            return Ok(NativeAudioProbe {
                host: format!("{:?}", host.id()),
                available_hosts,
                default_output_device: None,
                default_output_config: None,
                supported_output_configs: Vec::new(),
                estimated_default_buffer_ms: None,
                warnings,
            });
        }
    };

    let device_name = default_output_device.name().unwrap_or_else(|error| {
        warnings.push(format!("Could not read native output device name: {error}"));
        "Unknown output device".to_string()
    });
    let default_output_config = match default_output_device.default_output_config() {
        Ok(config) => {
            let stream_config = config.config();
            Some(NativeAudioConfig {
                channels: stream_config.channels,
                sample_rate: stream_config.sample_rate.0,
                sample_format: format!("{:?}", config.sample_format()),
                buffer_size: native_buffer_size_label(&stream_config.buffer_size),
            })
        }
        Err(error) => {
            warnings.push(format!(
                "Could not read default native output config: {error}"
            ));
            None
        }
    };
    let supported_output_configs = match default_output_device.supported_output_configs() {
        Ok(configs) => configs
            .take(24)
            .map(|config| NativeAudioConfigRange {
                channels: config.channels(),
                min_sample_rate: config.min_sample_rate().0,
                max_sample_rate: config.max_sample_rate().0,
                sample_format: format!("{:?}", config.sample_format()),
                buffer_size: supported_buffer_size_label(config.buffer_size()),
            })
            .collect::<Vec<_>>(),
        Err(error) => {
            warnings.push(format!(
                "Could not read supported native output configs: {error}"
            ));
            Vec::new()
        }
    };
    let estimated_default_buffer_ms = default_output_config.as_ref().and_then(|config| {
        native_buffer_frames(&config.buffer_size)
            .map(|frames| frames as f64 / config.sample_rate as f64 * 1000.0)
    });
    if estimated_default_buffer_ms.is_none() {
        warnings.push("Default native output buffer size is not fixed, so exact buffer latency must be measured during playback.".to_string());
    }

    Ok(NativeAudioProbe {
        host: format!("{:?}", host.id()),
        available_hosts,
        default_output_device: Some(device_name),
        default_output_config,
        supported_output_configs,
        estimated_default_buffer_ms,
        warnings,
    })
}

#[tauri::command]
fn native_audio_stream_probe(duration_ms: Option<u32>) -> Result<NativeAudioStreamProbe, String> {
    let requested_duration_ms = duration_ms.unwrap_or(750).clamp(100, 5_000);
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "No default native output device was reported by cpal.".to_string())?;
    let device_name = device
        .name()
        .map_err(|error| format!("Could not read native output device name: {error}"))?;
    let supported_config = device
        .default_output_config()
        .map_err(|error| format!("Could not read default native output config: {error}"))?;
    let sample_format = supported_config.sample_format();
    let stream_config = supported_config.config();
    let native_config = NativeAudioConfig {
        channels: stream_config.channels,
        sample_rate: stream_config.sample_rate.0,
        sample_format: format!("{sample_format:?}"),
        buffer_size: native_buffer_size_label(&stream_config.buffer_size),
    };
    let duration = Duration::from_millis(requested_duration_ms as u64);
    let result = match sample_format {
        cpal::SampleFormat::F32 => {
            run_native_silence_stream_probe::<f32>(&device, &stream_config, duration)
        }
        cpal::SampleFormat::I16 => {
            run_native_silence_stream_probe::<i16>(&device, &stream_config, duration)
        }
        cpal::SampleFormat::U16 => {
            run_native_silence_stream_probe::<u16>(&device, &stream_config, duration)
        }
        other => Err(format!(
            "Native stream cadence probe does not support sample format {other:?} yet."
        )),
    }?;

    Ok(NativeAudioStreamProbe {
        host: format!("{:?}", host.id()),
        default_output_device: device_name,
        default_output_config: native_config,
        requested_duration_ms,
        elapsed_ms: result.elapsed_ms,
        callback_count: result.callback_count,
        total_frames: result.total_frames,
        observed_callback_frames: result.observed_callback_frames,
        min_callback_interval_ms: result.min_callback_interval_ms,
        avg_callback_interval_ms: result.avg_callback_interval_ms,
        p95_callback_interval_ms: result.p95_callback_interval_ms,
        max_callback_interval_ms: result.max_callback_interval_ms,
        stream_errors: result.stream_errors,
        warnings: result.warnings,
    })
}

#[tauri::command]
fn native_playback_file_probe(
    path: String,
    duration_ms: Option<u32>,
    start_seconds: Option<f64>,
) -> Result<NativeAudioPlaybackProbe, String> {
    let requested_duration_ms = duration_ms.unwrap_or(750).clamp(100, 60_000);
    let requested_start_seconds = start_seconds.unwrap_or(0.0).max(0.0);
    let source_path = PathBuf::from(&path);
    if !source_path.exists() {
        return Err(format!(
            "Native playback source does not exist: {}",
            source_path.display()
        ));
    }

    let clip = read_pcm16_wav_segment(
        &source_path,
        requested_start_seconds,
        Some(requested_duration_ms),
    )?;
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "No default native output device was reported by cpal.".to_string())?;
    let device_name = device
        .name()
        .map_err(|error| format!("Could not read native output device name: {error}"))?;
    let supported_config = device
        .default_output_config()
        .map_err(|error| format!("Could not read default native output config: {error}"))?;
    let sample_format = supported_config.sample_format();
    let stream_config = supported_config.config();
    let native_config = NativeAudioConfig {
        channels: stream_config.channels,
        sample_rate: stream_config.sample_rate.0,
        sample_format: format!("{sample_format:?}"),
        buffer_size: native_buffer_size_label(&stream_config.buffer_size),
    };
    let output_channels = usize::from(stream_config.channels.max(1));
    let output_samples =
        native_playback_output_samples(&clip, output_channels, stream_config.sample_rate.0)?;
    let queued_output_frames = output_samples.len() / output_channels;
    let duration = Duration::from_millis(requested_duration_ms as u64);
    let (result, played_output_frames) = match sample_format {
        cpal::SampleFormat::F32 => run_native_audio_samples_probe::<f32>(
            &device,
            &stream_config,
            output_samples,
            duration,
        )?,
        cpal::SampleFormat::I16 => run_native_audio_samples_probe::<i16>(
            &device,
            &stream_config,
            output_samples,
            duration,
        )?,
        cpal::SampleFormat::U16 => run_native_audio_samples_probe::<u16>(
            &device,
            &stream_config,
            output_samples,
            duration,
        )?,
        other => {
            return Err(format!(
                "Native playback probe does not support sample format {other:?} yet."
            ))
        }
    };
    let mut warnings = result.warnings;
    if played_output_frames < queued_output_frames {
        warnings.push(format!(
            "Native stream consumed {played_output_frames} of {queued_output_frames} queued output frames during the probe window."
        ));
    }

    Ok(NativeAudioPlaybackProbe {
        path: source_path.to_string_lossy().to_string(),
        host: format!("{:?}", host.id()),
        default_output_device: device_name,
        default_output_config: native_config,
        source_channels: clip.channels,
        source_sample_rate: clip.sample_rate,
        source_sample_format: "PCM_S16LE".to_string(),
        source_total_frames: clip.total_frames,
        source_duration_ms: clip.total_frames as f64 / clip.sample_rate as f64 * 1000.0,
        requested_start_ms: clip.start_frame as f64 / clip.sample_rate as f64 * 1000.0,
        requested_duration_ms,
        queued_source_frames: clip.samples.len() / usize::from(clip.channels),
        queued_output_frames,
        played_output_frames,
        elapsed_ms: result.elapsed_ms,
        callback_count: result.callback_count,
        total_frames: result.total_frames,
        observed_callback_frames: result.observed_callback_frames,
        min_callback_interval_ms: result.min_callback_interval_ms,
        avg_callback_interval_ms: result.avg_callback_interval_ms,
        p95_callback_interval_ms: result.p95_callback_interval_ms,
        max_callback_interval_ms: result.max_callback_interval_ms,
        stream_errors: result.stream_errors,
        warnings,
    })
}

#[tauri::command]
fn native_ab_loop_probe(
    source_path: String,
    master_path: String,
    start_seconds: Option<f64>,
    region_duration_ms: Option<u32>,
    total_duration_ms: Option<u32>,
) -> Result<NativeAbLoopProbe, String> {
    let requested_start_seconds = start_seconds.unwrap_or(0.0).max(0.0);
    let region_duration_ms = region_duration_ms.unwrap_or(250).clamp(100, 2_000);
    let total_duration_ms = total_duration_ms
        .unwrap_or(1_000)
        .clamp(region_duration_ms, 5_000);
    let source_path_buf = PathBuf::from(&source_path);
    let master_path_buf = PathBuf::from(&master_path);
    if !source_path_buf.exists() {
        return Err(format!(
            "Native A/B source path does not exist: {}",
            source_path_buf.display()
        ));
    }
    if !master_path_buf.exists() {
        return Err(format!(
            "Native A/B master path does not exist: {}",
            master_path_buf.display()
        ));
    }

    let source_clip = read_pcm16_wav_segment(
        &source_path_buf,
        requested_start_seconds,
        Some(region_duration_ms),
    )?;
    let master_clip = read_pcm16_wav_segment(
        &master_path_buf,
        requested_start_seconds,
        Some(region_duration_ms),
    )?;
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "No default native output device was reported by cpal.".to_string())?;
    let device_name = device
        .name()
        .map_err(|error| format!("Could not read native output device name: {error}"))?;
    let supported_config = device
        .default_output_config()
        .map_err(|error| format!("Could not read default native output config: {error}"))?;
    let sample_format = supported_config.sample_format();
    let stream_config = supported_config.config();
    let native_config = NativeAudioConfig {
        channels: stream_config.channels,
        sample_rate: stream_config.sample_rate.0,
        sample_format: format!("{sample_format:?}"),
        buffer_size: native_buffer_size_label(&stream_config.buffer_size),
    };
    let output_channels = usize::from(stream_config.channels.max(1));
    let source_output =
        native_playback_output_samples(&source_clip, output_channels, stream_config.sample_rate.0)?;
    let master_output =
        native_playback_output_samples(&master_clip, output_channels, stream_config.sample_rate.0)?;
    let output_samples = native_ab_loop_output_samples(
        &source_output,
        &master_output,
        output_channels,
        stream_config.sample_rate.0,
        region_duration_ms,
        total_duration_ms,
    )?;
    let queued_output_frames = output_samples.len() / output_channels;
    let region_output_frames =
        native_duration_frames(region_duration_ms, stream_config.sample_rate.0);
    let side_switch_count = queued_output_frames
        .div_ceil(region_output_frames.max(1))
        .saturating_sub(1);
    let duration = Duration::from_millis(total_duration_ms as u64);
    let (result, played_output_frames) = match sample_format {
        cpal::SampleFormat::F32 => run_native_audio_samples_probe::<f32>(
            &device,
            &stream_config,
            output_samples,
            duration,
        )?,
        cpal::SampleFormat::I16 => run_native_audio_samples_probe::<i16>(
            &device,
            &stream_config,
            output_samples,
            duration,
        )?,
        cpal::SampleFormat::U16 => run_native_audio_samples_probe::<u16>(
            &device,
            &stream_config,
            output_samples,
            duration,
        )?,
        other => {
            return Err(format!(
                "Native A/B loop probe does not support sample format {other:?} yet."
            ))
        }
    };
    let mut warnings = result.warnings;
    if played_output_frames < queued_output_frames {
        warnings.push(format!(
            "Native A/B stream consumed {played_output_frames} of {queued_output_frames} queued output frames during the probe window."
        ));
    }

    Ok(NativeAbLoopProbe {
        source_path: source_path_buf.to_string_lossy().to_string(),
        master_path: master_path_buf.to_string_lossy().to_string(),
        host: format!("{:?}", host.id()),
        default_output_device: device_name,
        default_output_config: native_config,
        source_channels: source_clip.channels,
        source_sample_rate: source_clip.sample_rate,
        master_channels: master_clip.channels,
        master_sample_rate: master_clip.sample_rate,
        source_sample_format: "PCM_S16LE".to_string(),
        master_sample_format: "PCM_S16LE".to_string(),
        requested_start_ms: source_clip.start_frame as f64 / source_clip.sample_rate as f64
            * 1000.0,
        region_duration_ms,
        total_duration_ms,
        source_region_frames: source_clip.samples.len() / usize::from(source_clip.channels),
        master_region_frames: master_clip.samples.len() / usize::from(master_clip.channels),
        queued_output_frames,
        played_output_frames,
        side_switch_count,
        elapsed_ms: result.elapsed_ms,
        callback_count: result.callback_count,
        total_frames: result.total_frames,
        observed_callback_frames: result.observed_callback_frames,
        min_callback_interval_ms: result.min_callback_interval_ms,
        avg_callback_interval_ms: result.avg_callback_interval_ms,
        p95_callback_interval_ms: result.p95_callback_interval_ms,
        max_callback_interval_ms: result.max_callback_interval_ms,
        stream_errors: result.stream_errors,
        warnings,
    })
}

#[tauri::command]
fn start_native_ab_loop_playback(
    state: State<'_, NativePlaybackState>,
    source_path: String,
    master_path: String,
    start_seconds: Option<f64>,
    region_duration_ms: Option<u32>,
    total_duration_ms: Option<u32>,
) -> Result<NativePlaybackStatus, String> {
    let _ = stop_native_playback_inner(state.inner())?;
    let requested_start_seconds = start_seconds.unwrap_or(0.0).max(0.0);
    let region_duration_ms = region_duration_ms.unwrap_or(500).clamp(100, 5_000);
    let total_duration_ms = total_duration_ms
        .unwrap_or(3_000)
        .clamp(region_duration_ms, 30_000);
    let source_path_buf = PathBuf::from(&source_path);
    let master_path_buf = PathBuf::from(&master_path);
    if !source_path_buf.exists() {
        return Err(format!(
            "Native A/B source path does not exist: {}",
            source_path_buf.display()
        ));
    }
    if !master_path_buf.exists() {
        return Err(format!(
            "Native A/B master path does not exist: {}",
            master_path_buf.display()
        ));
    }

    let source_clip = read_pcm16_wav_segment(
        &source_path_buf,
        requested_start_seconds,
        Some(region_duration_ms),
    )?;
    let master_clip = read_pcm16_wav_segment(
        &master_path_buf,
        requested_start_seconds,
        Some(region_duration_ms),
    )?;
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "No default native output device was reported by cpal.".to_string())?;
    let device_name = device
        .name()
        .map_err(|error| format!("Could not read native output device name: {error}"))?;
    let supported_config = device
        .default_output_config()
        .map_err(|error| format!("Could not read default native output config: {error}"))?;
    let sample_format = supported_config.sample_format();
    let stream_config = supported_config.config();
    let native_config = NativeAudioConfig {
        channels: stream_config.channels,
        sample_rate: stream_config.sample_rate.0,
        sample_format: format!("{sample_format:?}"),
        buffer_size: native_buffer_size_label(&stream_config.buffer_size),
    };
    let output_channels = usize::from(stream_config.channels.max(1));
    let source_output =
        native_playback_output_samples(&source_clip, output_channels, stream_config.sample_rate.0)?;
    let master_output =
        native_playback_output_samples(&master_clip, output_channels, stream_config.sample_rate.0)?;
    let output_samples = native_ab_loop_output_samples(
        &source_output,
        &master_output,
        output_channels,
        stream_config.sample_rate.0,
        region_duration_ms,
        total_duration_ms,
    )?;
    let queued_output_frames = output_samples.len() / output_channels;
    let played_output_frames = Arc::new(AtomicUsize::new(0));
    let callback_events = Arc::new(Mutex::new(Vec::<(u128, u32)>::new()));
    let stream_errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let warnings = Arc::new(Mutex::new(Vec::<String>::new()));
    let stop_requested = Arc::new(AtomicBool::new(false));
    let pause_requested = Arc::new(AtomicBool::new(false));
    let started_at = Instant::now();
    let id = native_session_id();
    let label = format!(
        "Native A/B {} ms region from {:.2}s",
        region_duration_ms, requested_start_seconds
    );

    let thread_played_frames = played_output_frames.clone();
    let thread_callback_events = callback_events.clone();
    let thread_stream_errors = stream_errors.clone();
    let thread_warnings = warnings.clone();
    let thread_stop_requested = stop_requested.clone();
    let thread_pause_requested = pause_requested.clone();
    let thread_started_at = started_at;
    let join_handle = thread::spawn(move || {
        let result = match sample_format {
            cpal::SampleFormat::F32 => run_native_audio_samples_until_stop::<f32>(
                device,
                stream_config,
                output_samples,
                thread_stop_requested,
                thread_pause_requested,
                thread_played_frames,
                thread_callback_events,
                thread_stream_errors.clone(),
                thread_started_at,
            ),
            cpal::SampleFormat::I16 => run_native_audio_samples_until_stop::<i16>(
                device,
                stream_config,
                output_samples,
                thread_stop_requested,
                thread_pause_requested,
                thread_played_frames,
                thread_callback_events,
                thread_stream_errors.clone(),
                thread_started_at,
            ),
            cpal::SampleFormat::U16 => run_native_audio_samples_until_stop::<u16>(
                device,
                stream_config,
                output_samples,
                thread_stop_requested,
                thread_pause_requested,
                thread_played_frames,
                thread_callback_events,
                thread_stream_errors.clone(),
                thread_started_at,
            ),
            other => Err(format!(
                "Native A/B playback does not support sample format {other:?} yet."
            )),
        };
        if let Err(error) = result {
            if let Ok(mut guard) = thread_stream_errors.lock() {
                guard.push(error);
            }
            if let Ok(mut guard) = thread_warnings.lock() {
                guard.push("Native playback session ended with an error.".to_string());
            }
        }
    });

    let session = NativePlaybackSession {
        id,
        label,
        started_at,
        output_device: device_name,
        output_config: native_config,
        queued_output_frames,
        played_output_frames,
        callback_events,
        stream_errors,
        warnings,
        stop_requested,
        pause_requested,
        join_handle: Some(join_handle),
    };
    let status = native_playback_status_from_session(&session);
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "Native playback lock poisoned.".to_string())?;
    *guard = Some(session);
    Ok(status)
}

#[tauri::command]
fn start_native_file_playback(
    state: State<'_, NativePlaybackState>,
    path: String,
    label: Option<String>,
    start_seconds: Option<f64>,
    max_duration_ms: Option<u32>,
) -> Result<NativePlaybackStatus, String> {
    let _ = stop_native_playback_inner(state.inner())?;
    let requested_start_seconds = start_seconds.unwrap_or(0.0).max(0.0);
    let requested_duration_ms = max_duration_ms
        .unwrap_or(NATIVE_FILE_PLAYBACK_MAX_MS)
        .clamp(1_000, NATIVE_FILE_PLAYBACK_MAX_MS);
    let source_path = PathBuf::from(&path);
    if !source_path.exists() {
        return Err(format!(
            "Native playback source does not exist: {}",
            source_path.display()
        ));
    }

    let clip = read_pcm16_wav_segment(
        &source_path,
        requested_start_seconds,
        Some(requested_duration_ms),
    )?;
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| "No default native output device was reported by cpal.".to_string())?;
    let device_name = device
        .name()
        .map_err(|error| format!("Could not read native output device name: {error}"))?;
    let supported_config = device
        .default_output_config()
        .map_err(|error| format!("Could not read default native output config: {error}"))?;
    let sample_format = supported_config.sample_format();
    let stream_config = supported_config.config();
    let native_config = NativeAudioConfig {
        channels: stream_config.channels,
        sample_rate: stream_config.sample_rate.0,
        sample_format: format!("{sample_format:?}"),
        buffer_size: native_buffer_size_label(&stream_config.buffer_size),
    };
    let output_channels = usize::from(stream_config.channels.max(1));
    let output_samples =
        native_playback_output_samples(&clip, output_channels, stream_config.sample_rate.0)?;
    let queued_output_frames = output_samples.len() / output_channels;
    let played_output_frames = Arc::new(AtomicUsize::new(0));
    let callback_events = Arc::new(Mutex::new(Vec::<(u128, u32)>::new()));
    let stream_errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let mut initial_warnings = Vec::<String>::new();
    let clip_frames = clip.samples.len() / usize::from(clip.channels.max(1));
    if clip.start_frame + (clip_frames as u64) < clip.total_frames {
        let queued_seconds = clip_frames as f64 / f64::from(clip.sample_rate.max(1));
        initial_warnings.push(format!(
            "Native file playback queued {:.1}s from {:.1}s; use a shorter seek window if memory pressure is high.",
            queued_seconds, requested_start_seconds
        ));
    }
    let warnings = Arc::new(Mutex::new(initial_warnings));
    let stop_requested = Arc::new(AtomicBool::new(false));
    let pause_requested = Arc::new(AtomicBool::new(false));
    let started_at = Instant::now();
    let id = native_session_id();
    let fallback_label = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("playback file")
        .to_string();
    let label_text = label
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback_label);
    let label = format!("Native file: {label_text}");

    let thread_played_frames = played_output_frames.clone();
    let thread_callback_events = callback_events.clone();
    let thread_stream_errors = stream_errors.clone();
    let thread_warnings = warnings.clone();
    let thread_stop_requested = stop_requested.clone();
    let thread_pause_requested = pause_requested.clone();
    let thread_started_at = started_at;
    let join_handle = thread::spawn(move || {
        let result = match sample_format {
            cpal::SampleFormat::F32 => run_native_audio_samples_until_stop::<f32>(
                device,
                stream_config,
                output_samples,
                thread_stop_requested,
                thread_pause_requested,
                thread_played_frames,
                thread_callback_events,
                thread_stream_errors.clone(),
                thread_started_at,
            ),
            cpal::SampleFormat::I16 => run_native_audio_samples_until_stop::<i16>(
                device,
                stream_config,
                output_samples,
                thread_stop_requested,
                thread_pause_requested,
                thread_played_frames,
                thread_callback_events,
                thread_stream_errors.clone(),
                thread_started_at,
            ),
            cpal::SampleFormat::U16 => run_native_audio_samples_until_stop::<u16>(
                device,
                stream_config,
                output_samples,
                thread_stop_requested,
                thread_pause_requested,
                thread_played_frames,
                thread_callback_events,
                thread_stream_errors.clone(),
                thread_started_at,
            ),
            other => Err(format!(
                "Native file playback does not support sample format {other:?} yet."
            )),
        };
        if let Err(error) = result {
            if let Ok(mut guard) = thread_stream_errors.lock() {
                guard.push(error);
            }
            if let Ok(mut guard) = thread_warnings.lock() {
                guard.push("Native file playback session ended with an error.".to_string());
            }
        }
    });

    let session = NativePlaybackSession {
        id,
        label,
        started_at,
        output_device: device_name,
        output_config: native_config,
        queued_output_frames,
        played_output_frames,
        callback_events,
        stream_errors,
        warnings,
        stop_requested,
        pause_requested,
        join_handle: Some(join_handle),
    };
    let status = native_playback_status_from_session(&session);
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "Native playback lock poisoned.".to_string())?;
    *guard = Some(session);
    Ok(status)
}

#[tauri::command]
fn native_playback_status(
    state: State<'_, NativePlaybackState>,
) -> Result<NativePlaybackStatus, String> {
    native_playback_status_inner(state.inner())
}

#[tauri::command]
fn pause_native_playback(
    state: State<'_, NativePlaybackState>,
    paused: bool,
) -> Result<NativePlaybackStatus, String> {
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "Native playback lock poisoned.".to_string())?;
    let Some(session) = guard.as_mut() else {
        return Ok(inactive_native_playback_status());
    };
    if session
        .join_handle
        .as_ref()
        .map(|handle| handle.is_finished())
        .unwrap_or(false)
    {
        let mut finished = guard.take().expect("session exists");
        if let Some(handle) = finished.join_handle.take() {
            let _ = handle.join();
        }
        let mut status = native_playback_status_from_session(&finished);
        status.active = false;
        return Ok(status);
    }
    session.pause_requested.store(paused, Ordering::Relaxed);
    Ok(native_playback_status_from_session(session))
}

#[tauri::command]
fn seek_native_playback(
    state: State<'_, NativePlaybackState>,
    position_seconds: f64,
) -> Result<NativePlaybackStatus, String> {
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "Native playback lock poisoned.".to_string())?;
    let Some(session) = guard.as_mut() else {
        return Ok(inactive_native_playback_status());
    };
    if session
        .join_handle
        .as_ref()
        .map(|handle| handle.is_finished())
        .unwrap_or(false)
    {
        let mut finished = guard.take().expect("session exists");
        if let Some(handle) = finished.join_handle.take() {
            let _ = handle.join();
        }
        let mut status = native_playback_status_from_session(&finished);
        status.active = false;
        return Ok(status);
    }
    let sample_rate = f64::from(session.output_config.sample_rate.max(1));
    let target_frame = (position_seconds.max(0.0) * sample_rate).round() as usize;
    session.played_output_frames.store(
        target_frame.min(session.queued_output_frames),
        Ordering::Relaxed,
    );
    Ok(native_playback_status_from_session(session))
}

#[tauri::command]
fn stop_native_playback(
    state: State<'_, NativePlaybackState>,
) -> Result<NativePlaybackStatus, String> {
    stop_native_playback_inner(state.inner())
}

fn write_json_file(target: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Could not serialize JSON: {error}"))?;
    fs::write(&target, text)
        .map_err(|error| format!("Could not write {}: {error}", target.display()))
}

fn render_listening_packet_html(packet: &Value) -> String {
    let status = json_str(packet.get("status"));
    let mode = json_str(packet.get("mode"));
    let created_at = json_str(packet.get("created_at"));
    let approved = packet
        .get("approved")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let notes = packet
        .get("checklist")
        .and_then(|value| value.get("notes"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let render = packet.get("render").unwrap_or(&Value::Null);
    let export_checks = packet.get("export_checks").unwrap_or(&Value::Null);
    let audition_context = packet.get("audition_context").unwrap_or(&Value::Null);
    let approval_scope = packet.get("approval_scope").unwrap_or(&Value::Null);

    let mut html = String::from(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Album Mastering Studio Listening Handoff</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #161616; background: #fafafa; line-height: 1.45; }
    main { max-width: 980px; margin: 0 auto; }
    section { margin: 24px 0; padding: 18px; background: #fff; border: 1px solid #ddd; border-radius: 8px; }
    h1, h2 { margin: 0 0 12px; }
    .status { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #f0d98b; font-weight: 700; }
    .status.approved { background: #8ad69b; }
    .caveat { padding: 12px; border-left: 4px solid #b15c44; background: #fff2ee; }
    code { word-break: break-all; }
    li { margin: 6px 0; }
    audio { display: block; width: 100%; margin: 8px 0; }
    .audition { margin: 10px 0 14px; }
    .audition strong { display: block; }
    .audition a { color: #76531b; }
    .review-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px 16px; margin: 12px 0; }
    .review-grid label { display: flex; gap: 8px; align-items: center; }
    .approval-check { margin: 14px 0; padding: 12px; border: 1px solid #d4b15f; background: #fff8e6; border-radius: 6px; }
    textarea { width: 100%; min-height: 100px; box-sizing: border-box; margin: 8px 0 12px; font: inherit; }
    button { padding: 8px 12px; border: 1px solid #9c7a2f; background: #f0d98b; border-radius: 6px; font-weight: 700; cursor: pointer; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: #f4f4f4; border-radius: 6px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; border-bottom: 1px solid #ddd; padding: 8px; vertical-align: top; }
  </style>
</head>
<body>
<main>
"#,
    );

    html.push_str(&format!(
        "<h1>Listening Handoff</h1><p><span class=\"status{}\">{}</span> {} {}</p>",
        if approved { " approved" } else { "" },
        escape_html(&status),
        escape_html(&mode),
        escape_html(&created_at)
    ));
    html.push_str("<p class=\"caveat\">This packet is not human approval unless the user has actually listened and marked the render approved. Automated checks only prove file generation and technical smoke coverage.</p>");

    html.push_str("<section><h2>Audition Scope</h2><ul>");
    html.push_str(&format!(
        "<li>Approval basis: <strong>{}</strong></li>",
        escape_html(&json_str(approval_scope.get("basis")))
    ));
    html.push_str(&format!(
        "<li>Current audition: <strong>{}</strong></li>",
        escape_html(&json_str(audition_context.get("preview_parity")))
    ));
    html.push_str(&format!(
        "<li>{}</li>",
        escape_html(&json_str(audition_context.get("preview_note")))
    ));
    html.push_str(&format!(
        "<li>Live Preview scope: <strong>{}</strong></li>",
        escape_html(&json_str(approval_scope.get("live_preview")))
    ));
    html.push_str("</ul></section>");

    html.push_str("<section><h2>Render Files</h2><ul>");
    html_path_item(&mut html, "Manifest", render.get("manifest_path"));
    html_path_item(&mut html, "Dashboard", render.get("dashboard_path"));
    html_path_item(&mut html, "Album WAV", render.get("album_sequence"));
    html_path_item(&mut html, "Cue sheet", render.get("cue_sheet"));
    html.push_str("</ul></section>");
    let album_sequence = json_str(render.get("album_sequence"));
    if !album_sequence.is_empty() {
        html.push_str("<section><h2>Album Audition</h2>");
        html_audio_item(&mut html, "Album WAV", &album_sequence);
        html.push_str("</section>");
    }

    html.push_str("<section><h2>Mastered Tracks</h2><ol>");
    for track in json_array(packet.get("tracks")) {
        let title = json_str(track.get("title"));
        let source = json_str(track.get("source"));
        let output = json_str(track.get("output"));
        html.push_str("<li>");
        html.push_str(&format!("<strong>{}</strong>", escape_html(&title)));
        html_audio_item(&mut html, "Original", &source);
        html_audio_item(&mut html, "Mastered", &output);
        html.push_str("</li>");
    }
    html.push_str("</ol></section>");

    html.push_str("<section><h2>Codec Previews</h2><ul>");
    for preview in json_array(packet.get("codec_previews")) {
        html.push_str("<li>");
        html_audio_item(
            &mut html,
            &json_str(preview.get("codec")),
            &json_str(preview.get("output")),
        );
        html.push_str("</li>");
    }
    html.push_str("</ul></section>");

    html.push_str("<section><h2>Export Checks</h2><table><thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead><tbody>");
    for check in json_array(export_checks.get("checks")) {
        html.push_str(&format!(
            "<tr><td>{}</td><td>{}</td><td>{}</td></tr>",
            escape_html(&json_str(check.get("label"))),
            escape_html(&json_str(check.get("status"))),
            escape_html(&json_str(check.get("detail")))
        ));
    }
    html.push_str("</tbody></table></section>");

    let caveats = json_array(packet.get("caveats"));
    if !caveats.is_empty() {
        html.push_str("<section><h2>Caveats</h2><ul>");
        for caveat in caveats {
            let text = caveat.as_str().unwrap_or("");
            if !text.is_empty() {
                html.push_str(&format!("<li>{}</li>", escape_html(text)));
            }
        }
        html.push_str("</ul></section>");
    }

    html.push_str(
        r#"<section id="review-decision"><h2>Review Decision</h2>
<p class="caveat">Default is not approved. Mark approval only after listening to the rendered master, codec preview, or album WAV listed in this packet.</p>
<div class="review-grid">
  <label><input type="checkbox" id="heard-original"> Original heard</label>
  <label><input type="checkbox" id="heard-master"> Mastered render heard</label>
  <label><input type="checkbox" id="heard-codec"> Codec preview heard</label>
  <label><input type="checkbox" id="heard-album"> Album WAV heard</label>
  <label><input type="checkbox" id="reviewed-dashboard"> Dashboard reviewed</label>
  <label><input type="checkbox" id="reviewed-export-checks"> Export checks reviewed</label>
</div>
<label class="approval-check"><input type="checkbox" id="decision-approved"> Approved after listening</label>
<label for="decision-notes"><strong>Review notes</strong></label>
<textarea id="decision-notes" placeholder="What passed, what failed, and any changes needed before release."></textarea>
<button type="button" id="download-review">Download review JSON</button>
<pre id="review-json-preview" aria-label="Review JSON preview"></pre>
</section>"#,
    );

    html.push_str("<section><h2>Listening Notes</h2><p>");
    html.push_str(&escape_html(notes));
    html.push_str("</p></section>");
    html.push_str("<script type=\"application/json\" id=\"packet-json\">");
    html.push_str(&escape_script_json(&packet.to_string()));
    html.push_str("</script>");
    html.push_str(
        r##"<script>
(function () {
  const packet = JSON.parse(document.getElementById("packet-json").textContent || "{}");
  const byId = (id) => document.getElementById(id);
  const checked = (id) => Boolean(byId(id) && byId(id).checked);
  const notes = () => byId("decision-notes") ? byId("decision-notes").value : "";
  const buildDecision = () => {
    const approved = checked("decision-approved");
    return {
      version: 1,
      kind: "listening-review-decision",
      created_at: new Date().toISOString(),
      source_packet_created_at: packet.created_at || "",
      source_status: packet.status || "",
      mode: packet.mode || "",
      status: approved ? "approved" : "not-approved",
      approved,
      checklist: {
        original_heard: checked("heard-original"),
        mastered_render_heard: checked("heard-master"),
        codec_preview_heard: checked("heard-codec"),
        album_wav_heard: checked("heard-album"),
        dashboard_reviewed: checked("reviewed-dashboard"),
        export_checks_reviewed: checked("reviewed-export-checks"),
        notes: notes()
      },
      approval_scope: packet.approval_scope || {},
      render: packet.render || {},
      tracks: packet.tracks || [],
      transitions: packet.transitions || [],
      codec_previews: packet.codec_previews || [],
      export_checks: packet.export_checks || null,
      caveats: [
        "This decision was entered manually from the standalone listening handoff.",
        "Approval is valid only if the listener actually auditioned the rendered output, codec preview, or album WAV.",
        ...(packet.caveats || [])
      ]
    };
  };
  const preview = byId("review-json-preview");
  const refresh = () => {
    if (preview) preview.textContent = JSON.stringify(buildDecision(), null, 2);
  };
  document.querySelectorAll("#review-decision input, #review-decision textarea").forEach((element) => {
    element.addEventListener("input", refresh);
    element.addEventListener("change", refresh);
  });
  byId("download-review")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(buildDecision(), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "listening-review-decision.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  refresh();
}());
</script></main></body></html>
"##,
    );
    html
}

fn html_path_item(html: &mut String, label: &str, value: Option<&Value>) {
    let path = json_str(value);
    if !path.is_empty() {
        html.push_str(&format!(
            "<li><strong>{}</strong><br><code>{}</code></li>",
            escape_html(label),
            escape_html(&path)
        ));
    }
}

fn html_audio_item(html: &mut String, label: &str, path: &str) {
    if path.is_empty() {
        return;
    }
    let href = local_file_url(path);
    html.push_str(&format!(
        "<div class=\"audition\"><strong>{}</strong><audio controls preload=\"metadata\" src=\"{}\"></audio><a href=\"{}\">Open file</a><br><code>{}</code></div>",
        escape_html(label),
        escape_html(&href),
        escape_html(&href),
        escape_html(path)
    ));
}

fn local_file_url(path: &str) -> String {
    if path.starts_with("file://") || path.starts_with("http://") || path.starts_with("https://") {
        return path.to_string();
    }
    let normalized = path.replace('\\', "/");
    if normalized.starts_with("//") {
        return format!("file:{}", percent_encode_file_url_path(&normalized));
    }
    format!("file:///{}", percent_encode_file_url_path(&normalized))
}

fn percent_encode_file_url_path(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        let character = *byte as char;
        if character.is_ascii_alphanumeric()
            || matches!(
                character,
                '/' | ':'
                    | '.'
                    | '_'
                    | '-'
                    | '~'
                    | '!'
                    | '$'
                    | '&'
                    | '\''
                    | '('
                    | ')'
                    | '*'
                    | '+'
                    | ','
                    | ';'
                    | '='
                    | '@'
            )
        {
            encoded.push(character);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn json_array(value: Option<&Value>) -> Vec<Value> {
    value.and_then(Value::as_array).cloned().unwrap_or_default()
}

fn json_str(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or("").to_string()
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn escape_script_json(value: &str) -> String {
    value
        .replace('&', "\\u0026")
        .replace('<', "\\u003C")
        .replace('>', "\\u003E")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

fn render_project_product(
    app: &AppHandle,
    state: &ProcessState,
    project: Value,
    output_dir: PathBuf,
    project_name: &str,
) -> Result<ProductRenderResult, String> {
    render_project_product_with_options(
        app,
        state,
        project,
        output_dir,
        project_name,
        RenderProjectOptions::default(),
    )
}

fn render_project_product_with_options(
    app: &AppHandle,
    state: &ProcessState,
    project: Value,
    output_dir: PathBuf,
    project_name: &str,
    options: RenderProjectOptions,
) -> Result<ProductRenderResult, String> {
    fs::create_dir_all(&output_dir).map_err(|error| {
        format!(
            "Could not create output folder {}: {error}",
            output_dir.display()
        )
    })?;
    let project_path = output_dir.join(project_name);
    write_json_file(&project_path, &project)?;

    run_engine_command(
        app,
        state,
        vec![
            "render-project".to_string(),
            project_path.to_string_lossy().to_string(),
            "--output".to_string(),
            output_dir.to_string_lossy().to_string(),
            "--json-events".to_string(),
        ],
        None,
    )?;

    let manifest_path = output_dir.join("manifest.json");
    let manifest = read_json(manifest_path.to_string_lossy().to_string())?;

    if options.score {
        if let Err(error) = run_engine_command(
            app,
            state,
            vec![
                "score-render".to_string(),
                manifest_path.to_string_lossy().to_string(),
                "--scorer".to_string(),
                "local".to_string(),
            ],
            None,
        ) {
            emit(
                app,
                "stderr",
                &format!("Score failed after audio render: {error}"),
            );
        }
    }

    let dashboard_path = output_dir.join("dashboard.html");
    let dashboard = if options.dashboard {
        match run_engine_command(
            app,
            state,
            vec![
                "export-dashboard".to_string(),
                manifest_path.to_string_lossy().to_string(),
                "--output".to_string(),
                dashboard_path.to_string_lossy().to_string(),
            ],
            None,
        ) {
            Ok(_) => Some(dashboard_path.to_string_lossy().to_string()),
            Err(error) => {
                emit(
                    app,
                    "stderr",
                    &format!("Dashboard export failed after audio render: {error}"),
                );
                None
            }
        }
    } else {
        None
    };

    Ok(ProductRenderResult {
        output_dir: output_dir.to_string_lossy().to_string(),
        project_path: project_path.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        dashboard_path: dashboard,
        manifest,
    })
}

fn native_buffer_size_label(buffer_size: &cpal::BufferSize) -> String {
    match buffer_size {
        cpal::BufferSize::Default => "default".to_string(),
        cpal::BufferSize::Fixed(frames) => format!("fixed:{frames}"),
    }
}

fn supported_buffer_size_label(buffer_size: &cpal::SupportedBufferSize) -> String {
    match buffer_size {
        cpal::SupportedBufferSize::Range { min, max } => format!("range:{min}-{max}"),
        cpal::SupportedBufferSize::Unknown => "unknown".to_string(),
    }
}

fn native_buffer_frames(buffer_size: &str) -> Option<u32> {
    buffer_size.strip_prefix("fixed:")?.parse().ok()
}

fn run_native_silence_stream_probe<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    duration: Duration,
) -> Result<NativeAudioStreamProbeResult, String>
where
    T: cpal::Sample + cpal::SizedSample,
{
    let channels = usize::from(config.channels.max(1));
    let events = Arc::new(Mutex::new(Vec::<(u128, u32)>::new()));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let start = Instant::now();
    let callback_events = events.clone();
    let stream_errors = errors.clone();

    let stream = device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                for sample in data.iter_mut() {
                    *sample = T::EQUILIBRIUM;
                }
                let frames = (data.len() / channels) as u32;
                if let Ok(mut guard) = callback_events.lock() {
                    guard.push((start.elapsed().as_micros(), frames));
                }
            },
            move |error| {
                if let Ok(mut guard) = stream_errors.lock() {
                    guard.push(error.to_string());
                }
            },
            None,
        )
        .map_err(|error| format!("Could not build native output stream: {error}"))?;

    stream
        .play()
        .map_err(|error| format!("Could not start native output stream: {error}"))?;
    thread::sleep(duration);
    drop(stream);

    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    summarize_native_stream_probe(events, errors, elapsed_ms)
}

fn summarize_native_stream_probe(
    events: Arc<Mutex<Vec<(u128, u32)>>>,
    errors: Arc<Mutex<Vec<String>>>,
    elapsed_ms: f64,
) -> Result<NativeAudioStreamProbeResult, String> {
    let events = events
        .lock()
        .map_err(|_| "Native stream event lock poisoned.".to_string())?
        .clone();
    let stream_errors = errors
        .lock()
        .map_err(|_| "Native stream error lock poisoned.".to_string())?
        .clone();
    let callback_count = events.len();
    let total_frames = events
        .iter()
        .map(|(_, frames)| u64::from(*frames))
        .sum::<u64>();
    let mut observed_callback_frames = Vec::new();
    for (_, frames) in &events {
        if !observed_callback_frames.contains(frames) {
            observed_callback_frames.push(*frames);
        }
        if observed_callback_frames.len() >= 16 {
            break;
        }
    }
    observed_callback_frames.sort_unstable();

    let mut intervals = events
        .windows(2)
        .map(|pair| pair[1].0.saturating_sub(pair[0].0) as f64 / 1000.0)
        .collect::<Vec<_>>();
    let min_callback_interval_ms = intervals.iter().copied().reduce(f64::min);
    let max_callback_interval_ms = intervals.iter().copied().reduce(f64::max);
    let avg_callback_interval_ms = if intervals.is_empty() {
        None
    } else {
        Some(intervals.iter().sum::<f64>() / intervals.len() as f64)
    };
    intervals.sort_by(|left, right| left.total_cmp(right));
    let p95_callback_interval_ms = if intervals.is_empty() {
        None
    } else {
        let index = ((intervals.len() as f64 * 0.95).ceil() as usize)
            .saturating_sub(1)
            .min(intervals.len() - 1);
        Some(intervals[index])
    };

    let mut warnings = Vec::new();
    if callback_count < 2 {
        warnings.push(
            "Native stream produced fewer than two callbacks during the probe window.".to_string(),
        );
    }
    if !stream_errors.is_empty() {
        warnings
            .push("Native stream reported one or more errors during the probe window.".to_string());
    }

    Ok(NativeAudioStreamProbeResult {
        elapsed_ms,
        callback_count,
        total_frames,
        observed_callback_frames,
        min_callback_interval_ms,
        avg_callback_interval_ms,
        p95_callback_interval_ms,
        max_callback_interval_ms,
        stream_errors,
        warnings,
    })
}

fn read_pcm16_wav_segment(
    path: &Path,
    start_seconds: f64,
    duration_ms: Option<u32>,
) -> Result<NativePlaybackClip, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Could not open playback WAV {}: {error}", path.display()))?;
    let mut riff_header = [0_u8; 12];
    file.read_exact(&mut riff_header)
        .map_err(|error| format!("Could not read WAV header {}: {error}", path.display()))?;
    if &riff_header[0..4] != b"RIFF" || &riff_header[8..12] != b"WAVE" {
        return Err(format!(
            "Native playback probe only supports RIFF/WAVE PCM files: {}",
            path.display()
        ));
    }

    let mut channels = None;
    let mut sample_rate = None;
    let mut bits_per_sample = None;
    let mut audio_format = None;
    let mut block_align = None;
    let mut data_position = None;
    let mut data_size = None;

    loop {
        let mut chunk_header = [0_u8; 8];
        match file.read_exact(&mut chunk_header) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(error) => {
                return Err(format!(
                    "Could not read WAV chunk header {}: {error}",
                    path.display()
                ))
            }
        }
        let chunk_id = &chunk_header[0..4];
        let chunk_size = u32::from_le_bytes(chunk_header[4..8].try_into().unwrap()) as u64;
        let chunk_start = file.stream_position().map_err(|error| {
            format!(
                "Could not inspect WAV chunk position {}: {error}",
                path.display()
            )
        })?;

        if chunk_id == b"fmt " {
            let mut fmt = vec![0_u8; chunk_size as usize];
            file.read_exact(&mut fmt).map_err(|error| {
                format!("Could not read WAV fmt chunk {}: {error}", path.display())
            })?;
            if fmt.len() < 16 {
                return Err(format!(
                    "WAV fmt chunk is too short for native playback: {}",
                    path.display()
                ));
            }
            audio_format = Some(u16::from_le_bytes([fmt[0], fmt[1]]));
            channels = Some(u16::from_le_bytes([fmt[2], fmt[3]]));
            sample_rate = Some(u32::from_le_bytes([fmt[4], fmt[5], fmt[6], fmt[7]]));
            block_align = Some(u16::from_le_bytes([fmt[12], fmt[13]]));
            bits_per_sample = Some(u16::from_le_bytes([fmt[14], fmt[15]]));
        } else if chunk_id == b"data" {
            data_position = Some(chunk_start);
            data_size = Some(chunk_size);
            file.seek(SeekFrom::Current(chunk_size as i64))
                .map_err(|error| {
                    format!("Could not skip WAV data chunk {}: {error}", path.display())
                })?;
        } else {
            file.seek(SeekFrom::Current(chunk_size as i64))
                .map_err(|error| format!("Could not skip WAV chunk {}: {error}", path.display()))?;
        }

        if chunk_size % 2 == 1 {
            file.seek(SeekFrom::Current(1)).map_err(|error| {
                format!(
                    "Could not skip WAV chunk padding {}: {error}",
                    path.display()
                )
            })?;
        }
    }

    let channels =
        channels.ok_or_else(|| format!("WAV fmt chunk is missing channels: {}", path.display()))?;
    let sample_rate = sample_rate
        .ok_or_else(|| format!("WAV fmt chunk is missing sample rate: {}", path.display()))?;
    let bits_per_sample = bits_per_sample
        .ok_or_else(|| format!("WAV fmt chunk is missing bit depth: {}", path.display()))?;
    let audio_format = audio_format
        .ok_or_else(|| format!("WAV fmt chunk is missing audio format: {}", path.display()))?;
    let block_align = block_align.ok_or_else(|| {
        format!(
            "WAV fmt chunk is missing block alignment: {}",
            path.display()
        )
    })?;
    let data_position =
        data_position.ok_or_else(|| format!("WAV data chunk is missing: {}", path.display()))?;
    let data_size =
        data_size.ok_or_else(|| format!("WAV data chunk has unknown size: {}", path.display()))?;

    if audio_format != 1 || bits_per_sample != 16 {
        return Err(format!(
            "Native playback probe expects PCM 16-bit WAV from prepare_playback_file; got format {audio_format}, {bits_per_sample} bits."
        ));
    }
    if channels == 0 || sample_rate == 0 {
        return Err(format!(
            "WAV has invalid channel count or sample rate: {}",
            path.display()
        ));
    }
    let expected_block_align = channels
        .checked_mul(2)
        .ok_or_else(|| format!("WAV channel count is too large: {}", path.display()))?;
    if block_align != expected_block_align {
        return Err(format!(
            "WAV block alignment {block_align} does not match {channels} channels at 16-bit PCM."
        ));
    }

    let total_frames = data_size / u64::from(block_align);
    let start_frame = ((start_seconds * sample_rate as f64).floor() as u64).min(total_frames);
    let requested_frames = duration_ms
        .map(|duration| ((duration as f64 / 1000.0) * sample_rate as f64).ceil() as u64)
        .unwrap_or_else(|| total_frames.saturating_sub(start_frame));
    let available_frames = total_frames
        .saturating_sub(start_frame)
        .min(requested_frames.max(1));
    if available_frames == 0 {
        return Err(format!(
            "Requested native playback segment starts after the end of {}",
            path.display()
        ));
    }

    file.seek(SeekFrom::Start(
        data_position + start_frame * u64::from(block_align),
    ))
    .map_err(|error| format!("Could not seek playback WAV {}: {error}", path.display()))?;
    let byte_count = available_frames
        .checked_mul(u64::from(block_align))
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| "Requested native playback segment is too large to buffer.".to_string())?;
    let mut pcm = vec![0_u8; byte_count];
    file.read_exact(&mut pcm).map_err(|error| {
        format!(
            "Could not read playback WAV samples {}: {error}",
            path.display()
        )
    })?;
    let samples = pcm
        .chunks_exact(2)
        .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]) as f32 / 32768.0)
        .collect::<Vec<_>>();

    Ok(NativePlaybackClip {
        channels,
        sample_rate,
        total_frames,
        start_frame,
        samples,
    })
}

fn native_playback_output_samples(
    clip: &NativePlaybackClip,
    output_channels: usize,
    output_sample_rate: u32,
) -> Result<Vec<f32>, String> {
    let source_channels = usize::from(clip.channels);
    let source_frames = clip.samples.len() / source_channels;
    if source_frames == 0 {
        return Err("Native playback probe has no source frames to play.".to_string());
    }
    let output_frames = ((source_frames as f64 * output_sample_rate as f64)
        / clip.sample_rate as f64)
        .ceil()
        .max(1.0) as usize;
    let mut output = Vec::with_capacity(output_frames * output_channels);
    for output_frame in 0..output_frames {
        let source_position =
            output_frame as f64 * clip.sample_rate as f64 / output_sample_rate as f64;
        let base_frame = source_position.floor() as usize;
        let next_frame = (base_frame + 1).min(source_frames - 1);
        let fraction = (source_position - base_frame as f64) as f32;
        for output_channel in 0..output_channels {
            let sample = channel_sample(
                clip,
                source_channels,
                base_frame,
                next_frame,
                fraction,
                output_channel,
            );
            output.push(sample.clamp(-1.0, 1.0));
        }
    }
    Ok(output)
}

fn native_live_preview_tuning(value: &Value) -> Result<NativeLivePreviewTuning, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Native Live Preview tuning must be a JSON object.".to_string())?;
    Ok(NativeLivePreviewTuning {
        bass_db: native_tuning_value(
            object,
            &[
                "bassDb",
                "lowDb",
                "lowEndDb",
                "low_end_db",
                "tweak_low_end_db",
            ],
        )?,
        mid_db: native_tuning_value(
            object,
            &["midDb", "presenceDb", "presence_db", "tweak_presence_db"],
        )?,
        high_db: native_tuning_value(object, &["highDb", "airDb", "air_db", "tweak_air_db"])?,
        width: native_tuning_value(object, &["width", "widthOffset", "tweak_width"])?,
        intensity: native_tuning_value(
            object,
            &[
                "intensity",
                "compression",
                "compressionOffset",
                "tweak_intensity",
            ],
        )?,
    })
}

fn native_tuning_value(
    object: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Result<f64, String> {
    for key in keys {
        if let Some(value) = object.get(*key) {
            return value.as_f64().ok_or_else(|| {
                format!("Native Live Preview tuning value '{key}' must be numeric.")
            });
        }
    }
    Ok(0.0)
}

fn apply_native_live_preview_biquad(
    samples: &mut [f32],
    channels: usize,
    biquad: Option<NativeBiquad>,
) {
    let Some(biquad) = biquad else {
        return;
    };
    if channels == 0 {
        return;
    }
    let mut z1 = vec![0.0_f64; channels];
    let mut z2 = vec![0.0_f64; channels];
    for frame in samples.chunks_exact_mut(channels) {
        for (channel, sample) in frame.iter_mut().enumerate() {
            let x = f64::from(*sample);
            let y = (biquad.b0 * x) + z1[channel];
            z1[channel] = (biquad.b1 * x) - (biquad.a1 * y) + z2[channel];
            z2[channel] = (biquad.b2 * x) - (biquad.a2 * y);
            *sample = y as f32;
        }
    }
}

fn apply_native_live_preview_width(
    samples: &mut [f32],
    channels: usize,
    width_setting: f64,
) -> f64 {
    let width = (LIVE_PREVIEW_WIDTH_BASE + (width_setting * LIVE_PREVIEW_WIDTH_SCALE))
        .clamp(LIVE_PREVIEW_WIDTH_MIN, LIVE_PREVIEW_WIDTH_MAX);
    if channels < 2 {
        return width;
    }
    for frame in samples.chunks_exact_mut(channels) {
        let left = f64::from(frame[0]);
        let right = f64::from(frame[1]);
        let mid = (left + right) * 0.5;
        let side = (left - right) * 0.5;
        frame[0] = (mid + (side * width)) as f32;
        frame[1] = (mid - (side * width)) as f32;
    }
    width
}

fn apply_native_live_preview_compressor(
    samples: &mut [f32],
    channels: usize,
    intensity: f64,
) -> f64 {
    let drive = intensity.clamp(0.0, 1.0);
    if drive <= 0.0 || channels == 0 {
        return drive;
    }
    let threshold = LIVE_PREVIEW_COMPRESSOR_THRESHOLD_DBFS
        - (drive * LIVE_PREVIEW_COMPRESSOR_THRESHOLD_DRIVE_SCALE_DB);
    let ratio =
        LIVE_PREVIEW_COMPRESSOR_RATIO_BASE + (drive * LIVE_PREVIEW_COMPRESSOR_RATIO_DRIVE_SCALE);
    for frame in samples.chunks_exact_mut(channels) {
        let level = frame
            .iter()
            .map(|sample| f64::from(sample.abs()))
            .fold(0.0_f64, f64::max);
        let x_db = 20.0 * level.max(LIVE_PREVIEW_EPSILON).log10();
        let y_db = if x_db > threshold {
            threshold + ((x_db - threshold) / ratio)
        } else {
            x_db
        };
        let gain = 10.0_f64.powf((y_db - x_db) / 20.0) as f32;
        for sample in frame {
            *sample *= gain;
        }
    }
    drive
}

fn native_preview_peaking(
    gain_db: f64,
    frequency: f64,
    q: f64,
    sample_rate: u32,
) -> Result<Option<NativeBiquad>, String> {
    if gain_db.abs() < LIVE_PREVIEW_EPSILON {
        return Ok(None);
    }
    let amplitude = 10.0_f64.powf(gain_db / 40.0);
    let omega = 2.0 * std::f64::consts::PI * frequency / f64::from(sample_rate);
    let alpha = omega.sin() / (2.0 * q);
    let cos_omega = omega.cos();
    let b0 = 1.0 + (alpha * amplitude);
    let b1 = -2.0 * cos_omega;
    let b2 = 1.0 - (alpha * amplitude);
    let a0 = 1.0 + (alpha / amplitude);
    let a1 = -2.0 * cos_omega;
    let a2 = 1.0 - (alpha / amplitude);
    Ok(Some(normalize_native_biquad(b0, b1, b2, a0, a1, a2)?))
}

fn native_preview_shelf(
    kind: &str,
    gain_db: f64,
    frequency: f64,
    sample_rate: u32,
) -> Result<Option<NativeBiquad>, String> {
    if gain_db.abs() < LIVE_PREVIEW_EPSILON {
        return Ok(None);
    }
    let amplitude = 10.0_f64.powf(gain_db / 40.0);
    let omega = 2.0 * std::f64::consts::PI * frequency / f64::from(sample_rate);
    let sin_omega = omega.sin();
    let cos_omega = omega.cos();
    let root = amplitude.sqrt();
    let alpha = (sin_omega / 2.0) * 2.0_f64.sqrt();
    let (b0, b1, b2, a0, a1, a2) = match kind {
        "low" => (
            amplitude
                * ((amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) + (2.0 * root * alpha)),
            2.0 * amplitude * ((amplitude - 1.0) - ((amplitude + 1.0) * cos_omega)),
            amplitude
                * ((amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) - (2.0 * root * alpha)),
            (amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) + (2.0 * root * alpha),
            -2.0 * ((amplitude - 1.0) + ((amplitude + 1.0) * cos_omega)),
            (amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) - (2.0 * root * alpha),
        ),
        "high" => (
            amplitude
                * ((amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) + (2.0 * root * alpha)),
            -2.0 * amplitude * ((amplitude - 1.0) + ((amplitude + 1.0) * cos_omega)),
            amplitude
                * ((amplitude + 1.0) + ((amplitude - 1.0) * cos_omega) - (2.0 * root * alpha)),
            (amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) + (2.0 * root * alpha),
            2.0 * ((amplitude - 1.0) - ((amplitude + 1.0) * cos_omega)),
            (amplitude + 1.0) - ((amplitude - 1.0) * cos_omega) - (2.0 * root * alpha),
        ),
        _ => return Err(format!("Unknown native Live Preview shelf kind: {kind}")),
    };
    Ok(Some(normalize_native_biquad(b0, b1, b2, a0, a1, a2)?))
}

fn normalize_native_biquad(
    b0: f64,
    b1: f64,
    b2: f64,
    a0: f64,
    a1: f64,
    a2: f64,
) -> Result<NativeBiquad, String> {
    if a0.abs() < LIVE_PREVIEW_EPSILON {
        return Err("Native Live Preview filter had an invalid zero a0 coefficient.".to_string());
    }
    Ok(NativeBiquad {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    })
}

fn write_pcm16_wav(
    path: &Path,
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
) -> Result<(), String> {
    if channels == 0 {
        return Err("Cannot write native Live Preview WAV with zero channels.".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let data_bytes = samples
        .len()
        .checked_mul(2)
        .ok_or_else(|| "Native Live Preview WAV is too large.".to_string())?;
    let data_bytes_u32 = u32::try_from(data_bytes)
        .map_err(|_| "Native Live Preview WAV is too large.".to_string())?;
    let byte_rate = sample_rate
        .checked_mul(u32::from(channels))
        .and_then(|value| value.checked_mul(2))
        .ok_or_else(|| "Native Live Preview WAV byte rate overflowed.".to_string())?;
    let block_align = channels
        .checked_mul(2)
        .ok_or_else(|| "Native Live Preview WAV block alignment overflowed.".to_string())?;
    let mut file = fs::File::create(path).map_err(|error| {
        format!(
            "Could not create native Live Preview WAV {}: {error}",
            path.display()
        )
    })?;
    file.write_all(b"RIFF")
        .and_then(|_| file.write_all(&(36_u32 + data_bytes_u32).to_le_bytes()))
        .and_then(|_| file.write_all(b"WAVE"))
        .and_then(|_| file.write_all(b"fmt "))
        .and_then(|_| file.write_all(&16_u32.to_le_bytes()))
        .and_then(|_| file.write_all(&1_u16.to_le_bytes()))
        .and_then(|_| file.write_all(&channels.to_le_bytes()))
        .and_then(|_| file.write_all(&sample_rate.to_le_bytes()))
        .and_then(|_| file.write_all(&byte_rate.to_le_bytes()))
        .and_then(|_| file.write_all(&block_align.to_le_bytes()))
        .and_then(|_| file.write_all(&16_u16.to_le_bytes()))
        .and_then(|_| file.write_all(b"data"))
        .and_then(|_| file.write_all(&data_bytes_u32.to_le_bytes()))
        .map_err(|error| format!("Could not write native Live Preview WAV header: {error}"))?;
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0 - (1.0 / 32767.0)) * 32767.0).round() as i16;
        file.write_all(&value.to_le_bytes())
            .map_err(|error| format!("Could not write native Live Preview WAV sample: {error}"))?;
    }
    Ok(())
}

fn native_ab_loop_output_samples(
    source_output: &[f32],
    master_output: &[f32],
    output_channels: usize,
    output_sample_rate: u32,
    region_duration_ms: u32,
    total_duration_ms: u32,
) -> Result<Vec<f32>, String> {
    let source_frames = source_output.len() / output_channels;
    let master_frames = master_output.len() / output_channels;
    if source_frames == 0 || master_frames == 0 {
        return Err(
            "Native A/B loop probe needs non-empty source and master segments.".to_string(),
        );
    }
    let region_frames = native_duration_frames(region_duration_ms, output_sample_rate);
    let total_frames = native_duration_frames(total_duration_ms, output_sample_rate);
    let mut output = Vec::with_capacity(total_frames * output_channels);
    for frame in 0..total_frames {
        let loop_index = frame / region_frames;
        let use_source = loop_index % 2 == 0;
        let selected = if use_source {
            source_output
        } else {
            master_output
        };
        let selected_frames = if use_source {
            source_frames
        } else {
            master_frames
        };
        let selected_frame = frame % region_frames % selected_frames;
        let sample_offset = selected_frame * output_channels;
        output.extend_from_slice(&selected[sample_offset..sample_offset + output_channels]);
    }
    Ok(output)
}

fn native_duration_frames(duration_ms: u32, sample_rate: u32) -> usize {
    ((duration_ms as f64 / 1000.0) * sample_rate as f64)
        .ceil()
        .max(1.0) as usize
}

fn channel_sample(
    clip: &NativePlaybackClip,
    source_channels: usize,
    base_frame: usize,
    next_frame: usize,
    fraction: f32,
    output_channel: usize,
) -> f32 {
    if source_channels == 1 {
        return interpolated_sample(clip, source_channels, base_frame, next_frame, fraction, 0);
    }
    if output_channel < source_channels {
        return interpolated_sample(
            clip,
            source_channels,
            base_frame,
            next_frame,
            fraction,
            output_channel,
        );
    }
    if output_channel == 0 {
        return (0..source_channels)
            .map(|channel| {
                interpolated_sample(
                    clip,
                    source_channels,
                    base_frame,
                    next_frame,
                    fraction,
                    channel,
                )
            })
            .sum::<f32>()
            / source_channels as f32;
    }
    0.0
}

fn interpolated_sample(
    clip: &NativePlaybackClip,
    source_channels: usize,
    base_frame: usize,
    next_frame: usize,
    fraction: f32,
    channel: usize,
) -> f32 {
    let current = clip.samples[base_frame * source_channels + channel];
    let next = clip.samples[next_frame * source_channels + channel];
    current + (next - current) * fraction
}

fn run_native_audio_samples_probe<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Vec<f32>,
    duration: Duration,
) -> Result<(NativeAudioStreamProbeResult, usize), String>
where
    T: cpal::Sample + cpal::SizedSample + cpal::FromSample<f32>,
{
    let channels = usize::from(config.channels.max(1));
    let queued_frames = samples.len() / channels;
    let samples = Arc::new(samples);
    let played_frames = Arc::new(AtomicUsize::new(0));
    let events = Arc::new(Mutex::new(Vec::<(u128, u32)>::new()));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let start = Instant::now();
    let callback_events = events.clone();
    let stream_errors = errors.clone();
    let played_frames_for_callback = played_frames.clone();
    let samples_for_callback = samples.clone();
    let mut cursor = 0_usize;

    let stream = device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                for frame in data.chunks_mut(channels) {
                    let frame_index = cursor / channels;
                    for (channel, sample) in frame.iter_mut().enumerate() {
                        let value = if frame_index < queued_frames {
                            samples_for_callback
                                .get(frame_index * channels + channel)
                                .copied()
                                .unwrap_or(0.0)
                        } else {
                            0.0
                        };
                        *sample = T::from_sample(value);
                    }
                    if frame_index < queued_frames {
                        cursor += channels;
                    }
                }
                played_frames_for_callback
                    .store((cursor / channels).min(queued_frames), Ordering::Relaxed);
                let frames = (data.len() / channels) as u32;
                if let Ok(mut guard) = callback_events.lock() {
                    guard.push((start.elapsed().as_micros(), frames));
                }
            },
            move |error| {
                if let Ok(mut guard) = stream_errors.lock() {
                    guard.push(error.to_string());
                }
            },
            None,
        )
        .map_err(|error| format!("Could not build native playback stream: {error}"))?;

    stream
        .play()
        .map_err(|error| format!("Could not start native playback stream: {error}"))?;
    thread::sleep(duration);
    drop(stream);

    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let result = summarize_native_stream_probe(events, errors, elapsed_ms)?;
    Ok((
        result,
        played_frames.load(Ordering::Relaxed).min(queued_frames),
    ))
}

fn run_native_audio_samples_until_stop<T>(
    device: cpal::Device,
    config: cpal::StreamConfig,
    samples: Vec<f32>,
    stop_requested: Arc<AtomicBool>,
    pause_requested: Arc<AtomicBool>,
    played_frames: Arc<AtomicUsize>,
    events: Arc<Mutex<Vec<(u128, u32)>>>,
    errors: Arc<Mutex<Vec<String>>>,
    started_at: Instant,
) -> Result<(), String>
where
    T: cpal::Sample + cpal::SizedSample + cpal::FromSample<f32>,
{
    let channels = usize::from(config.channels.max(1));
    let queued_frames = samples.len() / channels;
    let samples = Arc::new(samples);
    let callback_events = events.clone();
    let stream_errors = errors.clone();
    let played_frames_for_callback = played_frames.clone();
    let samples_for_callback = samples.clone();

    let stream = device
        .build_output_stream(
            &config,
            move |data: &mut [T], _| {
                let paused = pause_requested.load(Ordering::Relaxed);
                let mut cursor_frames = played_frames_for_callback
                    .load(Ordering::Relaxed)
                    .min(queued_frames);
                for frame in data.chunks_mut(channels) {
                    for (channel, sample) in frame.iter_mut().enumerate() {
                        let value = if paused {
                            0.0
                        } else if cursor_frames < queued_frames {
                            samples_for_callback
                                .get(cursor_frames * channels + channel)
                                .copied()
                                .unwrap_or(0.0)
                        } else {
                            0.0
                        };
                        *sample = T::from_sample(value);
                    }
                    if !paused && cursor_frames < queued_frames {
                        cursor_frames += 1;
                    }
                }
                played_frames_for_callback
                    .store(cursor_frames.min(queued_frames), Ordering::Relaxed);
                let frames = (data.len() / channels) as u32;
                if let Ok(mut guard) = callback_events.lock() {
                    guard.push((started_at.elapsed().as_micros(), frames));
                }
            },
            move |error| {
                if let Ok(mut guard) = stream_errors.lock() {
                    guard.push(error.to_string());
                }
            },
            None,
        )
        .map_err(|error| format!("Could not build native playback stream: {error}"))?;

    stream
        .play()
        .map_err(|error| format!("Could not start native playback stream: {error}"))?;
    while !stop_requested.load(Ordering::Relaxed)
        && played_frames.load(Ordering::Relaxed).min(queued_frames) < queued_frames
    {
        thread::sleep(Duration::from_millis(20));
    }
    drop(stream);
    Ok(())
}

fn native_playback_status_inner(
    state: &NativePlaybackState,
) -> Result<NativePlaybackStatus, String> {
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "Native playback lock poisoned.".to_string())?;
    let Some(session) = guard.as_mut() else {
        return Ok(inactive_native_playback_status());
    };
    if session
        .join_handle
        .as_ref()
        .map(|handle| handle.is_finished())
        .unwrap_or(false)
    {
        let mut finished = guard.take().expect("session exists");
        if let Some(handle) = finished.join_handle.take() {
            let _ = handle.join();
        }
        let mut status = native_playback_status_from_session(&finished);
        status.active = false;
        return Ok(status);
    }
    Ok(native_playback_status_from_session(session))
}

fn stop_native_playback_inner(state: &NativePlaybackState) -> Result<NativePlaybackStatus, String> {
    let mut session = {
        let mut guard = state
            .session
            .lock()
            .map_err(|_| "Native playback lock poisoned.".to_string())?;
        guard.take()
    };
    let Some(ref mut current) = session else {
        return Ok(inactive_native_playback_status());
    };
    current.stop_requested.store(true, Ordering::Relaxed);
    if let Some(handle) = current.join_handle.take() {
        let _ = handle.join();
    }
    let mut status = native_playback_status_from_session(current);
    status.active = false;
    Ok(status)
}

fn native_playback_status_from_session(session: &NativePlaybackSession) -> NativePlaybackStatus {
    let callback_events = session
        .callback_events
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let stream_errors = session
        .stream_errors
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let warnings = session
        .warnings
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let callback_count = callback_events.len();
    let total_frames = callback_events
        .iter()
        .map(|(_, frames)| u64::from(*frames))
        .sum::<u64>();
    let mut observed_callback_frames = Vec::new();
    for (_, frames) in &callback_events {
        if !observed_callback_frames.contains(frames) {
            observed_callback_frames.push(*frames);
        }
        if observed_callback_frames.len() >= 16 {
            break;
        }
    }
    observed_callback_frames.sort_unstable();

    let mut intervals = callback_events
        .windows(2)
        .map(|pair| pair[1].0.saturating_sub(pair[0].0) as f64 / 1000.0)
        .collect::<Vec<_>>();
    let min_callback_interval_ms = intervals.iter().copied().reduce(f64::min);
    let max_callback_interval_ms = intervals.iter().copied().reduce(f64::max);
    let avg_callback_interval_ms = if intervals.is_empty() {
        None
    } else {
        Some(intervals.iter().sum::<f64>() / intervals.len() as f64)
    };
    intervals.sort_by(|left, right| left.total_cmp(right));
    let p95_callback_interval_ms = if intervals.is_empty() {
        None
    } else {
        let index = ((intervals.len() as f64 * 0.95).ceil() as usize)
            .saturating_sub(1)
            .min(intervals.len() - 1);
        Some(intervals[index])
    };

    let played_output_frames = session
        .played_output_frames
        .load(Ordering::Relaxed)
        .min(session.queued_output_frames);
    let sample_rate = f64::from(session.output_config.sample_rate.max(1));

    NativePlaybackStatus {
        active: session
            .join_handle
            .as_ref()
            .map(|handle| !handle.is_finished())
            .unwrap_or(false),
        paused: session.pause_requested.load(Ordering::Relaxed),
        id: Some(session.id.clone()),
        label: Some(session.label.clone()),
        output_device: Some(session.output_device.clone()),
        output_config: Some(session.output_config.clone()),
        elapsed_ms: session.started_at.elapsed().as_secs_f64() * 1000.0,
        position_seconds: played_output_frames as f64 / sample_rate,
        duration_seconds: session.queued_output_frames as f64 / sample_rate,
        queued_output_frames: session.queued_output_frames,
        played_output_frames,
        callback_count,
        total_frames,
        observed_callback_frames,
        min_callback_interval_ms,
        avg_callback_interval_ms,
        p95_callback_interval_ms,
        max_callback_interval_ms,
        stream_errors,
        warnings,
    }
}

fn push_export_check(
    checks: &mut Vec<Value>,
    fail_count: &mut u32,
    warn_count: &mut u32,
    label: &str,
    passed: bool,
    warning: bool,
    detail: impl Into<String>,
) {
    let status = if passed {
        "pass"
    } else if warning {
        *warn_count += 1;
        "warn"
    } else {
        *fail_count += 1;
        "fail"
    };
    checks.push(json!({
        "label": label,
        "status": status,
        "detail": detail.into()
    }));
}

fn finite_json_number(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_f64)
        .map(f64::is_finite)
        .unwrap_or(false)
}

fn local_path_exists_json(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(|path| PathBuf::from(path).exists())
        .unwrap_or(false)
}

fn inactive_native_playback_status() -> NativePlaybackStatus {
    NativePlaybackStatus {
        active: false,
        paused: false,
        id: None,
        label: None,
        output_device: None,
        output_config: None,
        elapsed_ms: 0.0,
        position_seconds: 0.0,
        duration_seconds: 0.0,
        queued_output_frames: 0,
        played_output_frames: 0,
        callback_count: 0,
        total_frames: 0,
        observed_callback_frames: Vec::new(),
        min_callback_interval_ms: None,
        avg_callback_interval_ms: None,
        p95_callback_interval_ms: None,
        max_callback_interval_ms: None,
        stream_errors: Vec::new(),
        warnings: Vec::new(),
    }
}

fn native_session_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("native-{millis:x}")
}

#[tauri::command]
fn autosave_session(session: Value) -> Result<String, String> {
    let target = app_state_dir()?.join("recent-session.json");
    let text = serde_json::to_string_pretty(&session)
        .map_err(|error| format!("Could not serialize autosave: {error}"))?;
    fs::write(&target, text)
        .map_err(|error| format!("Could not write autosave {}: {error}", target.display()))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn load_recent_session() -> Result<Option<Value>, String> {
    let target = app_state_dir()?.join("recent-session.json");
    if !target.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&target)
        .map_err(|error| format!("Could not read autosave {}: {error}", target.display()))?;
    let parsed = serde_json::from_str(&text)
        .map_err(|error| format!("Could not parse autosave {}: {error}", target.display()))?;
    Ok(Some(parsed))
}

#[tauri::command]
fn list_user_presets() -> Result<Value, String> {
    Ok(Value::Array(read_user_presets()?))
}

#[tauri::command]
fn save_user_preset(preset: Value) -> Result<Value, String> {
    let Value::Object(mut preset_object) = preset else {
        return Err("User preset must be a JSON object.".to_string());
    };
    let name = preset_object
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "User preset name is required.".to_string())?
        .to_string();
    let id = preset_object
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("user-{}-{}", slug_user_preset_name(&name), unix_millis()));
    let settings = preset_object
        .get("settings")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or_else(|| "User preset settings must be a JSON object.".to_string())?;
    let now = unix_millis().to_string();
    preset_object.insert("id".to_string(), Value::String(id.clone()));
    preset_object.insert("name".to_string(), Value::String(name));
    preset_object.insert("settings".to_string(), settings);
    preset_object
        .entry("created_at".to_string())
        .or_insert_with(|| Value::String(now.clone()));
    preset_object.insert("updated_at".to_string(), Value::String(now));
    let saved = Value::Object(preset_object);
    let mut presets = read_user_presets()?;
    if let Some(existing) = presets
        .iter()
        .position(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
    {
        presets[existing] = saved.clone();
    } else {
        presets.push(saved.clone());
    }
    presets.sort_by(|left, right| {
        let left_name = left.get("name").and_then(Value::as_str).unwrap_or_default();
        let right_name = right
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        left_name.to_lowercase().cmp(&right_name.to_lowercase())
    });
    write_user_presets(&presets)?;
    Ok(saved)
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("Cannot open missing path: {}", target.display()));
    }
    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer");
        command.arg(target);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(target);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(target);
        command
    };
    command
        .spawn()
        .map_err(|error| format!("Could not open path: {error}"))?;
    Ok(())
}

#[tauri::command]
fn prepare_playback_file(app: AppHandle, path: String) -> Result<String, String> {
    Ok(prepare_playback_file_inner(&app, path)?.path)
}

#[tauri::command]
fn prepare_playback_file_info(
    app: AppHandle,
    path: String,
) -> Result<PreparedPlaybackFile, String> {
    prepare_playback_file_inner(&app, path)
}

fn prepare_playback_file_inner(
    app: &AppHandle,
    path: String,
) -> Result<PreparedPlaybackFile, String> {
    let started = Instant::now();
    let source = PathBuf::from(&path);
    if !source.exists() {
        return Err(format!(
            "Playback source does not exist: {}",
            source.display()
        ));
    }

    let cache_dir = env::temp_dir()
        .join("album-mastering-studio")
        .join("playback-cache");
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Could not create playback cache: {error}"))?;

    let cache_key = playback_cache_key(&source)?;
    let output = cache_dir.join(format!("{cache_key}.wav"));
    if output.exists() {
        let bytes = fs::metadata(&output)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        return Ok(PreparedPlaybackFile {
            path: output.to_string_lossy().to_string(),
            source: source.to_string_lossy().to_string(),
            cache_hit: true,
            elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
            bytes,
        });
    }

    let ffmpeg = tool_path(app, "ffmpeg.exe", "ffmpeg");
    let output_result = Command::new(&ffmpeg)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-y")
        .arg("-i")
        .arg(&source)
        .arg("-vn")
        .arg("-ac")
        .arg("2")
        .arg("-ar")
        .arg("48000")
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(&output)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Could not start FFmpeg for playback: {error}"))?;

    if !output_result.status.success() {
        let stderr = String::from_utf8_lossy(&output_result.stderr);
        return Err(format!("FFmpeg playback conversion failed: {stderr}"));
    }

    let bytes = fs::metadata(&output)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    Ok(PreparedPlaybackFile {
        path: output.to_string_lossy().to_string(),
        source: source.to_string_lossy().to_string(),
        cache_hit: false,
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
        bytes,
    })
}

#[tauri::command]
fn cancel_cli(state: State<'_, ProcessState>) -> Result<bool, String> {
    let mut guard = state
        .child
        .lock()
        .map_err(|_| "Process lock poisoned".to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
fn run_cli(
    app: AppHandle,
    state: State<'_, ProcessState>,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<CliResult, String> {
    run_engine_command(&app, state.inner(), args, cwd)
}

fn run_engine_command(
    app: &AppHandle,
    state: &ProcessState,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<CliResult, String> {
    {
        let guard = state
            .child
            .lock()
            .map_err(|_| "Process lock poisoned".to_string())?;
        if guard.is_some() {
            return Err("A Python engine command is already running.".to_string());
        }
    }

    let root = cwd.map(PathBuf::from).unwrap_or_else(|| {
        default_output_dir()
            .map(PathBuf::from)
            .unwrap_or_else(|_| repo_root_path())
    });
    let (mut command, description) = engine_command(&app, &root, &args);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    emit(app, "status", &description);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start Python CLI: {error}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "Process lock poisoned".to_string())?;
        *guard = Some(child);
    }

    let stdout_lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let stdout_join = spawn_reader(app.clone(), "stdout", stdout, stdout_lines.clone());
    let stderr_join = spawn_reader(app.clone(), "stderr", stderr, stderr_lines.clone());

    let status = loop {
        thread::sleep(Duration::from_millis(100));
        let maybe_status = {
            let mut guard = state
                .child
                .lock()
                .map_err(|_| "Process lock poisoned".to_string())?;
            match guard.as_mut() {
                Some(child) => child
                    .try_wait()
                    .map_err(|error| format!("Could not poll Python CLI: {error}"))?,
                None => {
                    emit(app, "status", "Python CLI canceled.");
                    return Ok(CliResult {
                        code: None,
                        stdout: join_lines(&stdout_lines),
                        stderr: join_lines(&stderr_lines),
                    });
                }
            }
        };
        if let Some(status) = maybe_status {
            let mut guard = state
                .child
                .lock()
                .map_err(|_| "Process lock poisoned".to_string())?;
            guard.take();
            break status;
        }
    };

    let _ = stdout_join.join();
    let _ = stderr_join.join();
    let code = status.code();
    emit(app, "status", &format!("Python CLI exited with {code:?}."));
    let result = CliResult {
        code,
        stdout: join_lines(&stdout_lines),
        stderr: join_lines(&stderr_lines),
    };
    if status.success() {
        Ok(result)
    } else {
        Err(format!(
            "Python CLI failed with code {code:?}: {}",
            result.stderr
        ))
    }
}

fn spawn_reader(
    app: AppHandle,
    stream: &'static str,
    pipe: Option<impl std::io::Read + Send + 'static>,
    lines: Arc<Mutex<Vec<String>>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let Some(pipe) = pipe else {
            return;
        };
        let reader = BufReader::new(pipe);
        for line in reader.lines().flatten() {
            emit(&app, stream, &line);
            if let Ok(mut guard) = lines.lock() {
                guard.push(line);
            }
        }
    })
}

fn emit(app: &AppHandle, stream: &str, line: &str) {
    let _ = app.emit(
        "cli-event",
        CliEvent {
            stream: stream.to_string(),
            line: line.to_string(),
        },
    );
}

fn join_lines(lines: &Arc<Mutex<Vec<String>>>) -> String {
    lines
        .lock()
        .map(|guard| guard.join("\n"))
        .unwrap_or_default()
}

fn playback_cache_key(source: &Path) -> Result<String, String> {
    let metadata = fs::metadata(source)
        .map_err(|error| format!("Could not inspect {}: {error}", source.display()))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let canonical = source
        .canonicalize()
        .unwrap_or_else(|_| source.to_path_buf());
    let mut hasher = DefaultHasher::new();
    canonical.to_string_lossy().hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified.hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

fn tool_path(app: &AppHandle, bundled_name: &str, fallback_name: &str) -> PathBuf {
    if let Some(candidate) = resource_file(app, "ffmpeg", bundled_name) {
        return candidate;
    }
    PathBuf::from(fallback_name)
}

fn validate_audio_source(ffprobe: &Path, path: String) -> AudioSourceValidation {
    let source = PathBuf::from(&path);
    if !source.exists() {
        return audio_source_validation(
            path,
            false,
            false,
            false,
            "missing",
            "Source file is missing. Re-add it or remove it from the project before analyzing.",
            None,
        );
    }
    if source.is_dir() {
        let supported_count = fs::read_dir(&source)
            .ok()
            .into_iter()
            .flat_map(|entries| entries.flatten())
            .filter(|entry| {
                entry.path().is_file()
                    && entry
                        .path()
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .map(is_supported_audio_extension)
                        .unwrap_or(false)
            })
            .count();
        if supported_count == 0 {
            return audio_source_validation(
                path,
                true,
                false,
                true,
                "unsupported",
                "Folder contains no supported audio files.",
                None,
            );
        }
        return audio_source_validation(
            path,
            true,
            true,
            true,
            "ok",
            &format!("Folder contains {supported_count} supported audio file(s)."),
            None,
        );
    }
    if !source
        .extension()
        .and_then(|extension| extension.to_str())
        .map(is_supported_audio_extension)
        .unwrap_or(false)
    {
        return audio_source_validation(
            path,
            true,
            false,
            false,
            "unsupported",
            "File type is not supported by Album Mastering Studio.",
            None,
        );
    }

    match Command::new(ffprobe)
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("json")
        .arg(&source)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(output) if output.status.success() => audio_source_validation(
            path,
            true,
            true,
            false,
            "ok",
            "Audio source is readable.",
            None,
        ),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let diagnostic = stderr.trim();
            audio_source_validation(
                path,
                true,
                true,
                false,
                "unreadable",
                "FFprobe could not read this audio source. The file may be corrupt or use an unsupported codec.",
                if diagnostic.is_empty() {
                    None
                } else {
                    Some(diagnostic)
                },
            )
        }
        Err(error) => audio_source_validation(
            path,
            true,
            true,
            false,
            "unreadable",
            "Could not start FFprobe for source validation.",
            Some(&error.to_string()),
        ),
    }
}

fn audio_source_validation(
    path: String,
    exists: bool,
    supported: bool,
    is_directory: bool,
    status: &str,
    detail: &str,
    diagnostic: Option<&str>,
) -> AudioSourceValidation {
    AudioSourceValidation {
        path,
        exists,
        supported,
        is_directory,
        status: status.to_string(),
        detail: detail.to_string(),
        diagnostic: diagnostic.map(ToOwned::to_owned),
    }
}

fn is_supported_audio_extension(extension: &str) -> bool {
    AUDIO_SOURCE_EXTENSIONS
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(extension))
}

fn engine_command(app: &AppHandle, cwd: &Path, args: &[String]) -> (Command, String) {
    let ffmpeg_dir = resource_dir(app, "ffmpeg");

    if let Ok(engine) = env::var("ALBUM_MASTER_ENGINE") {
        let mut command = Command::new(&engine);
        command.args(args).current_dir(cwd);
        apply_audio_tool_path(&mut command, ffmpeg_dir.as_deref());
        return (command, format!("{engine} {}", args.join(" ")));
    }

    let use_bundled_sidecar =
        !cfg!(debug_assertions) || env::var("ALBUM_MASTER_USE_SIDECAR").is_ok();
    if use_bundled_sidecar {
        if let Some(engine) = resource_file(app, "engine", "album-master-engine.exe") {
            let mut command = Command::new(&engine);
            command.args(args).current_dir(cwd);
            apply_audio_tool_path(&mut command, ffmpeg_dir.as_deref());
            return (
                command,
                format!("{} {}", engine.to_string_lossy(), args.join(" ")),
            );
        }
    }

    let root = repo_root_path();
    let python = env::var("ALBUM_MASTER_PYTHON").unwrap_or_else(|_| "python".to_string());
    let mut command = Command::new(&python);
    command
        .arg("-m")
        .arg("album_mastering_studio.cli")
        .args(args)
        .current_dir(&root)
        .env("PYTHONPATH", python_path(&root));
    apply_audio_tool_path(&mut command, ffmpeg_dir.as_deref());
    (
        command,
        format!("python -m album_mastering_studio.cli {}", args.join(" ")),
    )
}

fn apply_audio_tool_path(command: &mut Command, ffmpeg_dir: Option<&Path>) {
    let Some(ffmpeg_dir) = ffmpeg_dir else {
        return;
    };
    if !ffmpeg_dir.exists() {
        return;
    }
    let current_path = env::var_os("PATH").unwrap_or_default();
    let mut entries = env::split_paths(&current_path).collect::<Vec<_>>();
    if !entries.iter().any(|entry| entry == ffmpeg_dir) {
        entries.insert(0, ffmpeg_dir.to_path_buf());
    }
    if let Ok(joined) = env::join_paths(entries) {
        command.env("PATH", joined);
    }
}
fn resource_dir(app: &AppHandle, subdir: &str) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        for candidate in [
            resource_dir.join(subdir),
            resource_dir.join("resources").join(subdir),
        ] {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn resource_file(app: &AppHandle, subdir: &str, file_name: &str) -> Option<PathBuf> {
    resource_dir(app, subdir)
        .map(|dir| dir.join(file_name))
        .filter(|path| path.exists())
}

fn repo_root_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .to_path_buf()
}

fn python_path(root: &Path) -> String {
    let src = root.join("src");
    let existing = env::var("PYTHONPATH").unwrap_or_default();
    if existing.is_empty() {
        src.to_string_lossy().to_string()
    } else {
        format!("{};{}", src.to_string_lossy(), existing)
    }
}

fn user_presets_path() -> Result<PathBuf, String> {
    Ok(app_state_dir()?.join("user-presets.json"))
}

fn read_user_presets() -> Result<Vec<Value>, String> {
    let target = user_presets_path()?;
    if !target.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&target)
        .map_err(|error| format!("Could not read user presets {}: {error}", target.display()))?;
    let parsed: Value = serde_json::from_str(&text)
        .map_err(|error| format!("Could not parse user presets {}: {error}", target.display()))?;
    match parsed {
        Value::Array(items) => Ok(items),
        _ => Err(format!(
            "User presets file must contain a JSON array: {}",
            target.display()
        )),
    }
}

fn write_user_presets(presets: &[Value]) -> Result<(), String> {
    let target = user_presets_path()?;
    let text = serde_json::to_string_pretty(presets)
        .map_err(|error| format!("Could not serialize user presets: {error}"))?;
    fs::write(&target, text)
        .map_err(|error| format!("Could not write user presets {}: {error}", target.display()))
}

fn slug_user_preset_name(value: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
        if slug.len() >= 48 {
            break;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "preset".to_string()
    } else {
        slug
    }
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn app_state_dir() -> Result<PathBuf, String> {
    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::temp_dir());
    let documents = home.join("Documents");
    let base = if documents.exists() { documents } else { home };
    let state = base.join("Album Mastering Studio").join("State");
    fs::create_dir_all(&state)
        .map_err(|error| format!("Could not create app state folder: {error}"))?;
    Ok(state)
}

pub fn run() {
    tauri::Builder::default()
        .manage(ProcessState::default())
        .manage(NativePlaybackState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            repo_root,
            default_output_dir,
            validate_audio_sources,
            read_json,
            write_project,
            write_listening_receipt,
            write_listening_packet,
            analyze_tracks,
            live_preview_contract,
            render_live_preview_model,
            render_native_live_preview_model,
            native_audio_probe,
            native_audio_stream_probe,
            native_playback_file_probe,
            native_ab_loop_probe,
            start_native_ab_loop_playback,
            start_native_file_playback,
            native_playback_status,
            pause_native_playback,
            seek_native_playback,
            stop_native_playback,
            render_track_master,
            render_track_region_preview,
            render_album_master,
            plan_album_project,
            render_album_boundary_preview,
            run_export_checks,
            autosave_session,
            load_recent_session,
            list_user_presets,
            save_user_preset,
            open_path,
            prepare_playback_file,
            prepare_playback_file_info,
            cancel_cli,
            run_cli
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Album Mastering Studio");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri app");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listening_packet_html_includes_playable_local_audio_controls() {
        let packet = json!({
            "status": "not-approved",
            "mode": "track",
            "created_at": "2026-05-13T11:28:57Z",
            "approved": false,
            "checklist": {
                "notes": "Human sound approval still required."
            },
            "render": {
                "dashboard_path": "C:\\Audio\\Dashboard.html",
                "album_sequence": null,
                "cue_sheet": null,
                "track_count": 1,
                "interlude_count": 0
            },
            "tracks": [
                {
                    "title": "Original Mix",
                    "source": "C:\\Audio\\Original Mix (Raw).mp3",
                    "output": "C:\\Audio\\Master Mix.wav"
                }
            ],
            "codec_previews": [
                {
                    "codec": "AAC 256k",
                    "output": "C:\\Audio\\Master Mix_m4a.m4a"
                }
            ],
            "export_checks": {
                "checks": [
                    {
                        "label": "Codec QC",
                        "status": "pass",
                        "detail": "1 codec preview path exists"
                    }
                ]
            },
            "audition_context": {
                "preview_parity": "Codec preview audition",
                "preview_note": "Codec preview playback was generated from the current render."
            },
            "approval_scope": {
                "basis": "rendered preview/export, codec preview, or album WAV listening",
                "live_preview": "directional-only"
            },
            "caveats": [
                "This packet prepares a human listening pass; it is not human approval by itself."
            ]
        });

        let html = render_listening_packet_html(&packet);

        assert!(html.contains("<audio controls preload=\"metadata\""));
        assert!(html.contains("file:///C:/Audio/Original%20Mix%20(Raw).mp3"));
        assert!(html.contains("file:///C:/Audio/Master%20Mix.wav"));
        assert!(html.contains("file:///C:/Audio/Master%20Mix_m4a.m4a"));
        assert!(html.contains("Open file"));
        assert!(html.contains("directional-only"));
        assert!(html.contains("not human approval"));
        assert!(html.contains("id=\"review-decision\""));
        assert!(html.contains("Approved after listening"));
        assert!(html.contains("Download review JSON"));
        assert!(html.contains("listening-review-decision.json"));
        assert!(html.contains("kind: \"listening-review-decision\""));
    }

    #[test]
    fn native_audio_probe_reports_default_output_device_without_playback() {
        let probe = native_audio_probe().expect("native audio probe should query default output");
        let default_device = probe
            .default_output_device
            .as_deref()
            .expect("cpal should report a default output device");
        assert!(
            !default_device.trim().is_empty(),
            "default output device name should not be empty"
        );
        assert!(
            probe.default_output_config.is_some(),
            "default output config should be available"
        );

        if let Ok(expected) = std::env::var("AMS_EXPECT_OUTPUT_DEVICE") {
            assert!(
                default_device
                    .to_lowercase()
                    .contains(&expected.to_lowercase()),
                "expected output device to include {expected}, got {default_device}"
            );
        }

        if let Ok(output_path) = std::env::var("AMS_NATIVE_AUDIO_PROBE_OUTPUT") {
            let output = PathBuf::from(output_path);
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).expect("probe output directory should be writable");
            }
            fs::write(
                &output,
                serde_json::to_string_pretty(&probe).expect("probe should serialize"),
            )
            .expect("probe output should be writable");
        }
    }
}
