use serde::Serialize;
use serde_json::Value;
use std::{
    collections::hash_map::DefaultHasher,
    env,
    fs,
    hash::{Hash, Hasher},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct ProcessState {
    child: Mutex<Option<Child>>,
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
    fs::create_dir_all(&output).map_err(|error| format!("Could not create default output folder: {error}"))?;
    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
fn read_json(path: String) -> Result<Value, String> {
    let text = fs::read_to_string(&path).map_err(|error| format!("Could not read {path}: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("Could not parse JSON {path}: {error}"))
}

#[tauri::command]
fn write_project(path: String, project: Value) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(&project).map_err(|error| format!("Could not serialize project: {error}"))?;
    fs::write(&target, text).map_err(|error| format!("Could not write {}: {error}", target.display()))
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(path);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };
    command.spawn().map_err(|error| format!("Could not open path: {error}"))?;
    Ok(())
}

#[tauri::command]
fn prepare_playback_file(app: AppHandle, path: String) -> Result<String, String> {
    let source = PathBuf::from(&path);
    if !source.exists() {
        return Err(format!("Playback source does not exist: {}", source.display()));
    }

    let cache_dir = env::temp_dir()
        .join("album-mastering-studio")
        .join("playback-cache");
    fs::create_dir_all(&cache_dir).map_err(|error| format!("Could not create playback cache: {error}"))?;

    let cache_key = playback_cache_key(&source)?;
    let output = cache_dir.join(format!("{cache_key}.wav"));
    if output.exists() {
        return Ok(output.to_string_lossy().to_string());
    }

    let ffmpeg = tool_path(&app, "ffmpeg.exe", "ffmpeg");
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

    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
fn cancel_cli(state: State<'_, ProcessState>) -> Result<bool, String> {
    let mut guard = state.child.lock().map_err(|_| "Process lock poisoned".to_string())?;
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
    {
        let guard = state.child.lock().map_err(|_| "Process lock poisoned".to_string())?;
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

    emit(&app, "status", &description);
    let mut child = command.spawn().map_err(|error| format!("Could not start Python CLI: {error}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let mut guard = state.child.lock().map_err(|_| "Process lock poisoned".to_string())?;
        *guard = Some(child);
    }

    let stdout_lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let stdout_join = spawn_reader(app.clone(), "stdout", stdout, stdout_lines.clone());
    let stderr_join = spawn_reader(app.clone(), "stderr", stderr, stderr_lines.clone());

    let status = loop {
        thread::sleep(Duration::from_millis(100));
        let maybe_status = {
            let mut guard = state.child.lock().map_err(|_| "Process lock poisoned".to_string())?;
            match guard.as_mut() {
                Some(child) => child.try_wait().map_err(|error| format!("Could not poll Python CLI: {error}"))?,
                None => {
                    emit(&app, "status", "Python CLI canceled.");
                    return Ok(CliResult {
                        code: None,
                        stdout: join_lines(&stdout_lines),
                        stderr: join_lines(&stderr_lines),
                    });
                }
            }
        };
        if let Some(status) = maybe_status {
            let mut guard = state.child.lock().map_err(|_| "Process lock poisoned".to_string())?;
            guard.take();
            break status;
        }
    };

    let _ = stdout_join.join();
    let _ = stderr_join.join();
    let code = status.code();
    emit(&app, "status", &format!("Python CLI exited with {code:?}."));
    let result = CliResult {
        code,
        stdout: join_lines(&stdout_lines),
        stderr: join_lines(&stderr_lines),
    };
    if status.success() {
        Ok(result)
    } else {
        Err(format!("Python CLI failed with code {code:?}: {}", result.stderr))
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
    lines.lock().map(|guard| guard.join("\n")).unwrap_or_default()
}

fn playback_cache_key(source: &Path) -> Result<String, String> {
    let metadata = fs::metadata(source).map_err(|error| format!("Could not inspect {}: {error}", source.display()))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let canonical = source.canonicalize().unwrap_or_else(|_| source.to_path_buf());
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

fn engine_command(app: &AppHandle, cwd: &Path, args: &[String]) -> (Command, String) {
    let ffmpeg_dir = resource_dir(app, "ffmpeg");

    if let Ok(engine) = env::var("ALBUM_MASTER_ENGINE") {
        let mut command = Command::new(&engine);
        command.args(args).current_dir(cwd);
        apply_audio_tool_path(&mut command, ffmpeg_dir.as_deref());
        return (command, format!("{engine} {}", args.join(" ")));
    }

    if let Some(engine) = resource_file(app, "engine", "album-master-engine.exe") {
        let mut command = Command::new(&engine);
        command.args(args).current_dir(cwd);
        apply_audio_tool_path(&mut command, ffmpeg_dir.as_deref());
        return (
            command,
            format!("{} {}", engine.to_string_lossy(), args.join(" ")),
        );
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
    let existing = env::var("PATH").unwrap_or_default();
    let merged = if existing.is_empty() {
        ffmpeg_dir.to_string_lossy().to_string()
    } else {
        format!("{};{}", ffmpeg_dir.to_string_lossy(), existing)
    };
    command.env("PATH", merged);
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

pub fn run() {
    tauri::Builder::default()
        .manage(ProcessState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            repo_root,
            default_output_dir,
            read_json,
            write_project,
            open_path,
            prepare_playback_file,
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
