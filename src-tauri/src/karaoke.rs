use serde::{Deserialize, Serialize};
use std::{
    collections::hash_map::DefaultHasher,
    env, fs,
    hash::{Hash, Hasher},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::music_library::{current_root, is_audio, MusicLibraryState};

const GEMINI_MODEL: &str = "gemini-2.5-flash-lite";
const KARAOKE_SETTINGS_FILENAME: &str = "karaoke-settings.json";
// The standard Hybrid Transformer model is substantially faster than the
// fine-tuned ensemble while retaining strong vocal/instrumental separation,
// which is the only split StaySound needs for karaoke.
const DEMUCS_MODEL: &str = "htdemucs";
const LYRICS_MODEL: &str = "mlx-community/whisper-large-v3-turbo";
const MLX_WHISPER_VERSION: &str = "0.4.3";
const MFA_VERSION: &str = "3.4.*";
const MICROMAMBA_URL: &str = "https://micro.mamba.pm/api/micromamba/osx-arm64/latest";
const PHONEME_TIMING_SCRIPT: &str = include_str!("../python/phoneme_timing.py");
const ACOUSTIC_REFINER_SCRIPT: &str = include_str!("../python/refine_sustains.py");
const EXPERIMENTAL_INSTALLER: &str = include_str!("../python/install_experimental_aligner.py");
const EXPERIMENTAL_ALIGNER: &str = include_str!("../python/experimental_alignment.py");
// Alignment jobs share model/runtime files. Do not race installations or outputs.
static ALIGNMENT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KaraokeCapabilities {
    demucs_ready: bool,
    transcription_ready: bool,
    alignment_ready: bool,
    gemini_configured: bool,
    python_version: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KaraokeProgress {
    stage: String,
    progress: f32,
    detail: String,
    /// Live technical line (model, device, package being downloaded…) so the UI
    /// can show what the machine is really doing instead of a generic message.
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    /// Remaining time for the current stage when the underlying tool reports it.
    #[serde(skip_serializing_if = "Option::is_none")]
    eta_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KaraokeStems {
    instrumental_path: String,
    vocals_path: String,
    cached: bool,
    model: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedLyricsWord {
    text: String,
    start_ms: u64,
    end_ms: u64,
    #[serde(default)]
    confidence: f32,
    #[serde(default)]
    syllables: Vec<GeneratedLyricsSyllable>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedLyricsSyllable {
    text: String,
    start_ms: u64,
    end_ms: u64,
    #[serde(default)]
    phones: Vec<String>,
    #[serde(default)]
    sustained: bool,
    #[serde(default)]
    timing_confidence: f32,
    #[serde(default)]
    notes: Vec<GeneratedLyricsNote>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedLyricsNote {
    start_ms: u64,
    end_ms: u64,
    pitch_midi: f32,
    confidence: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedLyricsLine {
    text: String,
    start_ms: u64,
    end_ms: u64,
    #[serde(default)]
    language: Option<String>,
    words: Vec<GeneratedLyricsWord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLanguageHint {
    text: String,
    #[serde(default)]
    start_ms: Option<u64>,
    #[serde(default)]
    end_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedLyrics {
    language: String,
    model: String,
    #[serde(default)]
    alignment: Option<String>,
    #[serde(default)]
    text_source: Option<String>,
    #[serde(default)]
    text_match: Option<f32>,
    #[serde(default)]
    acoustic_model: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    alignment_notes: Vec<String>,
    lines: Vec<GeneratedLyricsLine>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KaraokeGenre {
    Pop,
    Rock,
    Reggaeton,
    Folk,
    Disco,
    Electronic,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KaraokeGenreResult {
    genre: KaraokeGenre,
    confidence: f32,
    reason: String,
    #[serde(default)]
    source: String,
    visual_plan: KaraokeVisualPlan,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KaraokeVisualPlan {
    intro: String,
    verse: String,
    chorus: String,
    bridge: String,
    outro: String,
}

#[derive(Default, Deserialize, Serialize)]
struct KaraokeSettings {
    gemini_api_key: Option<String>,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: GeminiContent,
}

#[derive(Deserialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Deserialize)]
struct GeminiPart {
    text: Option<String>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(KARAOKE_SETTINGS_FILENAME))
        .map_err(|error| error.to_string())
}

fn read_settings(app: &AppHandle) -> KaraokeSettings {
    settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, settings: &KaraokeSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let contents = serde_json::to_vec(settings).map_err(|error| error.to_string())?;
    fs::write(&path, contents).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(path, permissions).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn app_demucs_python(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("demucs-runtime/bin/python3"))
        .map_err(|error| error.to_string())
}

fn mfa_runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|path| path.join("mfa-runtime"))
        .map_err(|error| error.to_string())
}

fn mfa_is_ready(app: &AppHandle) -> bool {
    let Ok(runtime) = mfa_runtime_root(app) else {
        return false;
    };
    runtime.join("bin/mfa").is_file()
        && command_succeeds(
            &runtime.join("bin/python"),
            &["-c", "import librosa, numpy, pyphen, soundfile"],
        )
}

fn python_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(configured) = env::var("STAYSOUND_DEMUCS_PYTHON") {
        candidates.push(PathBuf::from(configured));
    }
    if let Ok(runtime) = app_demucs_python(app) {
        candidates.push(runtime);
    }
    if let Ok(current) = env::current_dir() {
        candidates.push(current.join(".venv-demucs/bin/python3"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/python3"));
    candidates.push(PathBuf::from("/usr/local/bin/python3"));
    candidates.push(PathBuf::from("/usr/bin/python3"));
    candidates
}

fn command_succeeds(program: &Path, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn find_python(app: &AppHandle, require_demucs: bool) -> Option<PathBuf> {
    python_candidates(app).into_iter().find(|candidate| {
        candidate.is_file()
            && (!require_demucs
                || (command_succeeds(candidate, &["-c", "import demucs, torch, static_ffmpeg"])
                    && candidate.parent().is_some_and(|folder| {
                        folder.join("ffmpeg").is_file() && folder.join("ffprobe").is_file()
                    })))
    })
}

fn transcription_is_ready(python: &Path) -> bool {
    command_succeeds(python, &["-c", "import mlx_whisper"])
}

fn install_mfa_runtime(app: &AppHandle) -> Result<(), String> {
    if mfa_is_ready(app) {
        return Ok(());
    }
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    let bootstrap = cache_root.join("mfa-bootstrap");
    let archive = bootstrap.join("micromamba.tar.bz2");
    let micromamba = bootstrap.join("bin/micromamba");
    let runtime = mfa_runtime_root(app)?;
    fs::create_dir_all(&bootstrap).map_err(|error| error.to_string())?;

    if !micromamba.is_file() {
        let download = Command::new("curl")
            .args([
                "-L",
                "--fail",
                "--silent",
                "--show-error",
                MICROMAMBA_URL,
                "-o",
            ])
            .arg(&archive)
            .output()
            .map_err(|error| error.to_string())?;
        if !download.status.success() {
            return Err("No pude descargar el instalador privado del alineador fonético.".into());
        }
        let extract = Command::new("tar")
            .args(["-xjf"])
            .arg(&archive)
            .args(["-C"])
            .arg(&bootstrap)
            .arg("bin/micromamba")
            .output()
            .map_err(|error| error.to_string())?;
        if !extract.status.success() {
            return Err("No pude preparar el instalador del alineador fonético.".into());
        }
    }

    let package = format!("montreal-forced-aligner={MFA_VERSION}");
    let action = if runtime.join("conda-meta").is_dir() {
        "install"
    } else {
        "create"
    };
    let install = Command::new(&micromamba)
        .args([action, "-y", "-p"])
        .arg(&runtime)
        .args([
            "-c",
            "conda-forge",
            &package,
            "pyphen",
            "librosa",
            // The Python import is `soundfile`, but conda-forge publishes it
            // under the distribution name `pysoundfile`.
            "pysoundfile",
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if !install.status.success() || !runtime.join("bin/mfa").is_file() {
        let error = String::from_utf8_lossy(&install.stderr);
        return Err(format!(
            "No pude instalar MFA. {}",
            error.lines().rev().take(5).collect::<Vec<_>>().join(" ")
        ));
    }
    Ok(())
}

fn install_private_ffmpeg(python: &Path) -> Result<(), String> {
    let output = Command::new(python)
        .args([
            "-c",
            "import shutil, static_ffmpeg; static_ffmpeg.add_paths(); print(shutil.which('ffmpeg')); print(shutil.which('ffprobe'))",
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("No pude preparar el decodificador de audio privado.".into());
    }
    let sources = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    let ffmpeg_source = sources.iter().find(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == "ffmpeg")
    });
    let ffprobe_source = sources.iter().find(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == "ffprobe")
    });
    let (Some(ffmpeg_source), Some(ffprobe_source)) = (ffmpeg_source, ffprobe_source) else {
        return Err("El runtime privado no entregó FFmpeg y FFprobe.".into());
    };
    let destination_folder = python
        .parent()
        .ok_or_else(|| "La ruta del runtime vocal no es válida.".to_string())?;
    for (source, name) in [(ffmpeg_source, "ffmpeg"), (ffprobe_source, "ffprobe")] {
        let destination = destination_folder.join(name);
        if destination.exists() {
            fs::remove_file(&destination).map_err(|error| error.to_string())?;
        }
        fs::copy(source, &destination).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&destination, fs::Permissions::from_mode(0o755))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn python_version(python: &Path) -> Option<String> {
    Command::new(python)
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if stdout.is_empty() {
                String::from_utf8_lossy(&output.stderr).trim().to_string()
            } else {
                stdout
            }
        })
}

fn emit_progress(app: &AppHandle, stage: &str, progress: f32, detail: &str) {
    emit_progress_detailed(app, stage, progress, detail, None, None);
}

fn emit_progress_detailed(
    app: &AppHandle,
    stage: &str,
    progress: f32,
    detail: &str,
    note: Option<String>,
    eta_ms: Option<u64>,
) {
    let _ = app.emit(
        "karaoke://progress",
        KaraokeProgress {
            stage: stage.to_string(),
            progress,
            detail: detail.to_string(),
            note,
            eta_ms,
        },
    );
}

/// Reads a child process stream that mixes `\n` lines with `\r`-refreshed
/// progress bars (tqdm) and hands every finished segment to `on_segment`.
fn stream_segments<R: Read>(reader: R, mut on_segment: impl FnMut(&str)) {
    let mut reader = BufReader::new(reader);
    let mut buffer: Vec<u8> = Vec::with_capacity(256);
    let mut byte = [0u8; 1];
    loop {
        match reader.read(&mut byte) {
            Ok(0) => break,
            Ok(_) => {
                if byte[0] == b'\n' || byte[0] == b'\r' {
                    let segment = String::from_utf8_lossy(&buffer).trim().to_string();
                    buffer.clear();
                    if !segment.is_empty() {
                        on_segment(&segment);
                    }
                } else {
                    buffer.push(byte[0]);
                    // A pathological line without separators must not grow forever.
                    if buffer.len() > 8_192 {
                        buffer.clear();
                    }
                }
            }
            Err(_) => break,
        }
    }
    let tail = String::from_utf8_lossy(&buffer).trim().to_string();
    if !tail.is_empty() {
        on_segment(&tail);
    }
}

/// Extracts the `NN%` ratio tqdm prints at the head of its bar.
fn parse_tqdm_percent(segment: &str) -> Option<f32> {
    let index = segment.find('%')?;
    let digits: String = segment[..index]
        .chars()
        .rev()
        .take_while(|character| character.is_ascii_digit())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<f32>().ok().map(|value| value / 100.0)
}

/// Extracts the remaining time from tqdm's `[elapsed<remaining, rate]` block.
fn parse_tqdm_eta_ms(segment: &str) -> Option<u64> {
    let start = segment.rfind('[')?;
    let block = &segment[start + 1..];
    let end = block.find(']').unwrap_or(block.len());
    let block = &block[..end];
    let remaining = block.split('<').nth(1)?.split(',').next()?.trim();
    parse_clock_ms(remaining)
}

/// Turns one line of pip output into a progress update. `packages` counts the
/// dependencies seen so far, which is the only length signal pip gives before
/// it finishes resolving, so the bar approaches — but never reaches — the end
/// of the stage while the note carries the literal package being downloaded.
fn pip_progress_line(
    segment: &str,
    packages: &mut f32,
    current: &mut String,
) -> Option<(f32, &'static str, Option<String>, Option<u64>)> {
    let advance = |packages: f32| 0.22 + 0.68 * (1.0 - (-packages / 14.0).exp());

    if let Some(rest) = segment.strip_prefix("Collecting ") {
        let name = rest.split(['=', '<', '>', '!', '[', ' ']).next().unwrap_or(rest);
        *packages += 1.0;
        *current = name.to_string();
        return Some((
            advance(*packages),
            "Descargando componentes…",
            Some(format!("Resolviendo {name}")),
            None,
        ));
    }

    if let Some(rest) = segment.strip_prefix("Downloading ") {
        let size = rest
            .rfind('(')
            .map(|index| rest[index + 1..].trim_end_matches(')').to_string());
        let name = if current.is_empty() {
            rest.split(['-', ' ']).next().unwrap_or(rest).to_string()
        } else {
            current.clone()
        };
        let note = match size {
            Some(size) => format!("Descargando {name} · {size}"),
            None => format!("Descargando {name}"),
        };
        return Some((advance(*packages), "Descargando componentes…", Some(note), None));
    }

    if segment.starts_with("Installing collected packages") {
        return Some((
            0.94,
            "Instalando componentes…",
            Some(format!("{} paquetes", *packages as u32)),
            None,
        ));
    }

    // pip's own bar: "   ━━━━━━━ 12.4/61.0 MB 5.1 MB/s eta 0:00:09"
    if let Some(index) = segment.find("eta ") {
        let eta = parse_clock_ms(segment[index + 4..].split_whitespace().next().unwrap_or(""));
        let transferred = segment
            .split_whitespace()
            .find(|token| token.contains('/') && token.contains('.'))
            .map(|token| token.to_string());
        let unit = segment
            .split_whitespace()
            .find(|token| matches!(*token, "MB" | "kB" | "GB"))
            .unwrap_or("MB");
        let note = match transferred {
            Some(transferred) if !current.is_empty() => {
                Some(format!("{current} · {transferred} {unit}"))
            }
            Some(transferred) => Some(format!("{transferred} {unit}")),
            None if !current.is_empty() => Some(format!("Descargando {current}")),
            None => None,
        };
        return Some((advance(*packages), "Descargando componentes…", note, eta));
    }

    None
}

/// Parses `mm:ss` / `hh:mm:ss` into milliseconds.
fn parse_clock_ms(value: &str) -> Option<u64> {
    let parts: Vec<&str> = value.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let mut seconds = 0u64;
    for part in &parts {
        let unit = part.trim().parse::<u64>().ok()?;
        seconds = seconds * 60 + unit;
    }
    Some(seconds * 1_000)
}

fn authorized_audio_path(
    state: &State<'_, MusicLibraryState>,
    path: &str,
) -> Result<PathBuf, String> {
    let root = current_root(state)?;
    let source = PathBuf::from(path)
        .canonicalize()
        .map_err(|_| "No pude localizar el archivo original de esta canción.".to_string())?;
    if !source.starts_with(&root) || !source.is_file() || !is_audio(&source) {
        return Err("La canción no pertenece a la carpeta de música autorizada.".into());
    }
    Ok(source)
}

fn cache_key(source: &Path) -> Result<String, String> {
    let metadata = fs::metadata(source).map_err(|error| error.to_string())?;
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

fn locate_stems(cache_root: &Path, source: &Path) -> Option<(PathBuf, PathBuf)> {
    let stem = source.file_stem()?.to_string_lossy();
    let folder = cache_root.join(DEMUCS_MODEL).join(stem.as_ref());
    let formats = ["flac", "wav"];
    formats.iter().find_map(|extension| {
        let vocals = folder.join(format!("vocals.{extension}"));
        let instrumental = folder.join(format!("no_vocals.{extension}"));
        (vocals.is_file() && instrumental.is_file()).then_some((instrumental, vocals))
    })
}

fn lyrics_file_path(app: &AppHandle, source: &Path) -> Result<PathBuf, String> {
    let key = cache_key(source)?;
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("generated-lyrics").join(format!("{key}.json")))
        .map_err(|error| error.to_string())
}

fn demucs_cache_root(app: &AppHandle, source: &Path) -> Result<PathBuf, String> {
    let key = cache_key(source)?;
    app.path()
        .app_cache_dir()
        .map(|path| path.join("karaoke").join(key))
        .map_err(|error| error.to_string())
}

/// Probing the runtime runs `python -c "import demucs, torch, …"` and
/// `python --version`: three subprocesses, and importing torch alone takes
/// seconds. A command declared as a plain `fn` runs on the main thread, so
/// asking this question used to stop the window painting for the whole probe.
/// Callers that are already off the main thread use this directly; the command
/// itself is `async` and goes through `spawn_blocking`.
fn capabilities_snapshot(app: &AppHandle) -> Result<KaraokeCapabilities, String> {
    let python = find_python(app, false);
    Ok(KaraokeCapabilities {
        demucs_ready: find_python(app, true).is_some(),
        transcription_ready: python.as_deref().is_some_and(transcription_is_ready),
        alignment_ready: mfa_is_ready(app),
        gemini_configured: read_settings(app)
            .gemini_api_key
            .is_some_and(|value| !value.trim().is_empty()),
        python_version: python.as_deref().and_then(python_version),
    })
}

#[tauri::command]
pub async fn karaoke_capabilities(app: AppHandle) -> Result<KaraokeCapabilities, String> {
    tauri::async_runtime::spawn_blocking(move || capabilities_snapshot(&app))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn install_local_lyrics_runtime(app: AppHandle) -> Result<KaraokeCapabilities, String> {
    let python = find_python(&app, true)
        .ok_or_else(|| "Primero necesito preparar el motor vocal local de Demucs.".to_string())?;
    if transcription_is_ready(&python) && mfa_is_ready(&app) {
        return capabilities_snapshot(&app);
    }

    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        emit_progress(
            &app_for_task,
            "transcription-runtime",
            0.06,
            "Preparando recursos…",
        );
        if !transcription_is_ready(&python) {
            let package = format!("mlx-whisper=={MLX_WHISPER_VERSION}");
            let output = Command::new(&python)
                .args([
                    "-m",
                    "pip",
                    "install",
                    "--disable-pip-version-check",
                    "--no-input",
                    &package,
                ])
                .output()
                .map_err(|error| error.to_string())?;
            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                return Err(format!(
                    "No pude instalar el transcriptor local. {}",
                    error.lines().rev().take(5).collect::<Vec<_>>().join(" ")
                ));
            }
        }
        emit_progress(
            &app_for_task,
            "transcription-runtime",
            0.42,
            "Preparando sincronización…",
        );
        install_mfa_runtime(&app_for_task)?;
        emit_progress(
            &app_for_task,
            "transcription-runtime",
            1.0,
            "Transcriptor local listo.",
        );
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;

    capabilities_snapshot(&app)
}

#[tauri::command]
pub async fn save_gemini_api_key(app: AppHandle, api_key: String) -> Result<bool, String> {
    let api_key = api_key.trim().to_string();
    if !api_key.is_empty() && api_key.len() < 20 {
        return Err("La clave de Gemini no parece válida.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut settings = read_settings(&app);
        settings.gemini_api_key = (!api_key.is_empty()).then_some(api_key);
        write_settings(&app, &settings)?;
        Ok(settings.gemini_api_key.is_some())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn install_demucs_runtime(app: AppHandle) -> Result<KaraokeCapabilities, String> {
    if find_python(&app, true).is_some() {
        return capabilities_snapshot(&app);
    }

    let system_python = find_python(&app, false)
        .ok_or_else(|| "No encontré una instalación compatible de Python 3.".to_string())?;
    let runtime_python = app_demucs_python(&app)?;
    let runtime_root = runtime_python
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "No pude crear la carpeta del motor vocal.".to_string())?
        .to_path_buf();
    let app_for_task = app.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        emit_progress(&app_for_task, "runtime", 0.05, "Preparando audio…");
        if !runtime_python.is_file() {
            if let Some(parent) = runtime_root.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }

            let venv = Command::new(&system_python)
                .args(["-m", "venv"])
                .arg(&runtime_root)
                .output()
                .map_err(|error| error.to_string())?;
            if !venv.status.success() {
                return Err(String::from_utf8_lossy(&venv.stderr).trim().to_string());
            }
        } else {
            emit_progress(&app_for_task, "runtime", 0.16, "Comprobando audio…");
        }

        emit_progress(&app_for_task, "runtime", 0.22, "Descargando componentes…");
        let mut install = Command::new(&runtime_python)
            .args([
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--no-input",
                "demucs==4.0.1",
                "diffq",
                "static-ffmpeg",
                "soundfile",
            ])
            .env("PYTHONUNBUFFERED", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| error.to_string())?;

        let stdout = install
            .stdout
            .take()
            .ok_or_else(|| "No pude leer la salida del instalador.".to_string())?;
        let stderr = install
            .stderr
            .take()
            .ok_or_else(|| "No pude leer la salida del instalador.".to_string())?;
        // pip writes failures to stderr while the package log goes to stdout,
        // so the error tail is collected on its own thread.
        let error_tail = std::thread::spawn(move || {
            let mut lines: Vec<String> = Vec::new();
            stream_segments(stderr, |segment| {
                lines.push(segment.to_string());
                if lines.len() > 12 {
                    lines.remove(0);
                }
            });
            lines
        });

        let app_for_pip = app_for_task.clone();
        let mut packages = 0f32;
        let mut current = String::new();
        stream_segments(stdout, |segment| {
            if let Some(progress) = pip_progress_line(segment, &mut packages, &mut current) {
                emit_progress_detailed(
                    &app_for_pip,
                    "runtime",
                    progress.0,
                    progress.1,
                    progress.2,
                    progress.3,
                );
            }
        });

        let status = install.wait().map_err(|error| error.to_string())?;
        let tail = error_tail.join().unwrap_or_default();
        if !status.success() {
            return Err(format!(
                "No pude instalar Demucs. {}",
                tail.iter().rev().take(4).cloned().collect::<Vec<_>>().join(" ")
            ));
        }
        install_private_ffmpeg(&runtime_python)?;
        emit_progress(&app_for_task, "runtime", 1.0, "Audio listo.");
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;

    capabilities_snapshot(&app)
}

#[tauri::command]
pub async fn prepare_karaoke_stems(
    app: AppHandle,
    state: State<'_, MusicLibraryState>,
    path: String,
) -> Result<KaraokeStems, String> {
    let source = authorized_audio_path(&state, &path)?;
    let python = find_python(&app, true).ok_or_else(|| {
        "El motor vocal todavía no está instalado. Vuelve a intentarlo después de prepararlo."
            .to_string()
    })?;
    let key = cache_key(&source)?;
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("karaoke")
        .join(key);
    fs::create_dir_all(&cache_root).map_err(|error| error.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&cache_root, true)
        .map_err(|error| error.to_string())?;

    if let Some((instrumental, vocals)) = locate_stems(&cache_root, &source) {
        emit_progress(&app, "separation", 1.0, "Audio listo.");
        return Ok(KaraokeStems {
            instrumental_path: instrumental.to_string_lossy().into_owned(),
            vocals_path: vocals.to_string_lossy().into_owned(),
            cached: true,
            model: DEMUCS_MODEL.into(),
        });
    }

    let app_for_task = app.clone();
    let source_for_task = source.clone();
    let cache_for_task = cache_root.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let use_mps = command_succeeds(
            &python,
            &[
                "-c",
                "import torch; raise SystemExit(0 if torch.backends.mps.is_available() else 1)",
            ],
        );
        let device_note = if use_mps {
            format!("{DEMUCS_MODEL} · GPU Metal")
        } else {
            format!("{DEMUCS_MODEL} · CPU")
        };
        emit_progress_detailed(
            &app_for_task,
            "separation",
            0.02,
            "Cargando el modelo de separación…",
            Some(device_note.clone()),
            None,
        );
        let private_bin = python
            .parent()
            .ok_or_else(|| "La ruta del motor vocal no es válida.".to_string())?;
        let existing_path = env::var_os("PATH").unwrap_or_default();
        let mut command_path = private_bin.as_os_str().to_os_string();
        command_path.push(":");
        command_path.push(existing_path);
        let mut command = Command::new(&python);
        command.args([
            "-m",
            "demucs",
            "--two-stems=vocals",
            "-n",
            DEMUCS_MODEL,
            "--flac",
            "-j",
            if use_mps { "1" } else { "2" },
        ]);
        if use_mps {
            command.args(["-d", "mps"]);
        }
        let mut child = command
            .arg("-o")
            .arg(&cache_for_task)
            .arg(&source_for_task)
            .env("PATH", command_path)
            // Demucs streams its tqdm bar to stderr; keeping it unbuffered lets
            // the loader mirror the real percentage instead of guessing.
            .env("PYTHONUNBUFFERED", "1")
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| error.to_string())?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "No pude leer la salida del separador.".to_string())?;
        let mut tail: Vec<String> = Vec::new();
        let mut last_percent = -1i32;
        stream_segments(stderr, |segment| {
            if let Some(ratio) = parse_tqdm_percent(segment) {
                let percent = (ratio * 100.0).round() as i32;
                if percent == last_percent {
                    return;
                }
                last_percent = percent;
                emit_progress_detailed(
                    &app_for_task,
                    "separation",
                    // Model load and file writing bookend the actual inference.
                    0.04 + ratio * 0.92,
                    "El modelo recorre la canción bloque a bloque…",
                    Some(format!("{device_note} · {percent} %")),
                    parse_tqdm_eta_ms(segment),
                );
                return;
            }
            tail.push(segment.to_string());
            if tail.len() > 12 {
                tail.remove(0);
            }
        });

        let status = child.wait().map_err(|error| error.to_string())?;
        if !status.success() {
            return Err(format!(
                "Demucs no pudo separar esta canción. {}",
                tail.iter().rev().take(5).cloned().collect::<Vec<_>>().join(" ")
            ));
        }
        emit_progress_detailed(
            &app_for_task,
            "separation",
            0.98,
            "Guardando las pistas separadas…",
            Some(format!("{device_note} · escribiendo FLAC")),
            None,
        );
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;

    let (instrumental, vocals) = locate_stems(&cache_root, &source)
        .ok_or_else(|| "Demucs terminó, pero no encontré las pistas separadas.".to_string())?;
    emit_progress(&app, "separation", 1.0, "Audio listo.");
    Ok(KaraokeStems {
        instrumental_path: instrumental.to_string_lossy().into_owned(),
        vocals_path: vocals.to_string_lossy().into_owned(),
        cached: false,
        model: DEMUCS_MODEL.into(),
    })
}

#[tauri::command]
pub async fn transcribe_karaoke_vocals(
    app: AppHandle,
    state: State<'_, MusicLibraryState>,
    path: String,
    language: String,
    language_hints: Vec<LyricsLanguageHint>,
) -> Result<GeneratedLyrics, String> {
    let source = authorized_audio_path(&state, &path)?;
    let python = find_python(&app, true)
        .ok_or_else(|| "El motor vocal local todavía no está preparado.".to_string())?;
    if !transcription_is_ready(&python) {
        return Err("El transcriptor local todavía no está instalado.".into());
    }

    let cache_root = demucs_cache_root(&app, &source)?;
    let (_, vocals) = locate_stems(&cache_root, &source)
        .ok_or_else(|| "Primero separa la voz de esta canción con Demucs.".to_string())?;
    let result_path = cache_root.join("generated-lyrics-draft.json");
    let model_cache = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("mlx-models");
    fs::create_dir_all(&model_cache).map_err(|error| error.to_string())?;

    let requested_language = match language.as_str() {
        "es" => "es",
        "en" => "en",
        "en-es" => "en-es",
        _ => "auto",
    }
    .to_string();
    let language_hints_json =
        serde_json::to_string(&language_hints).map_err(|error| error.to_string())?;
    let app_for_task = app.clone();
    let python_for_task = python.clone();
    let vocals_for_task = vocals.clone();
    let result_for_task = result_path.clone();
    let model_cache_for_task = model_cache.clone();
    let language_hints_for_task = language_hints_json.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        emit_progress(
            &app_for_task,
            "transcription",
            0.08,
            "Preparando transcripción…",
        );
        let script = r#"
import json
import re
import sys
import mlx_whisper
from mlx_whisper.audio import SAMPLE_RATE, load_audio

audio_path, output_path, requested_language, model, hints_json = sys.argv[1:6]
language_hints = json.loads(hints_json or "[]")

SPANISH_WORDS = {
    "algo", "alguien", "años", "aqui", "asi", "aunque", "cada", "como", "cuando",
    "de", "del", "el", "ella", "en", "eres", "esta", "este", "esto", "habia",
    "hasta", "la", "las", "le", "lejos", "lo", "los", "mano", "mas", "me", "mi",
    "miedo", "nadie", "no", "nos", "otra", "para", "pero", "por", "porque", "que",
    "quiero", "si", "siempre", "sin", "te", "tengo", "todo", "tu", "una", "vez",
    "volver", "ya", "yo",
}
ENGLISH_WORDS = {
    "a", "again", "all", "and", "are", "away", "be", "because", "but", "can",
    "close", "day", "did", "do", "eyes", "feel", "for", "found", "from", "had",
    "her", "here", "hold", "i", "i'm", "if", "in", "inside", "is", "it", "just",
    "know", "left", "love", "me", "my", "no", "not", "of", "on", "one", "that",
    "the", "there", "this", "till", "to", "trust", "was", "when", "with", "without",
    "you", "your",
}

def text_language(value, fallback=None):
    lowered = str(value or "").lower()
    folded = lowered.translate(str.maketrans("áéíóúü", "aeiouu"))
    tokens = re.findall(r"[a-zñ']+", folded)
    spanish = 2 if re.search(r"[áéíóúüñ¿¡]", lowered) else 0
    english = 0
    for token in tokens:
        spanish += int(token in SPANISH_WORDS)
        english += int(token in ENGLISH_WORDS)
    if spanish >= english + 1:
        return "es"
    if english >= spanish + 1:
        return "en"
    return fallback

def transcription_kwargs(language=None):
    options = {
        "path_or_hf_repo": model,
        "word_timestamps": True,
        "verbose": False,
        "condition_on_previous_text": False,
        "temperature": 0,
        "hallucination_silence_threshold": 1.2,
    }
    if language:
        options["language"] = language
    return options

def detect_song_language(audio):
    """Vote over the loudest vocal windows, not Whisper's first 30 seconds.

    An instrumental or whispered intro used to decide the language for the
    whole song; a Spanish song detected as English is translated, not heard.
    """
    import mlx.core as mx
    import numpy as np
    from mlx_whisper.audio import N_FRAMES, N_SAMPLES, log_mel_spectrogram, pad_or_trim
    from mlx_whisper.transcribe import ModelHolder

    whisper = ModelHolder.get_model(model, mx.float16)
    audio = np.array(audio, dtype=np.float32)
    starts = list(range(0, max(1, len(audio) - N_SAMPLES + 1), N_SAMPLES // 2))
    energy = [float(np.sqrt(np.mean(np.square(audio[start:start + N_SAMPLES])))) for start in starts]
    totals = {}
    for index in sorted(range(len(starts)), key=energy.__getitem__, reverse=True)[:4]:
        window = audio[starts[index]:starts[index] + N_SAMPLES]
        mel = log_mel_spectrogram(window, n_mels=whisper.dims.n_mels, padding=N_SAMPLES)
        _, probabilities = whisper.detect_language(pad_or_trim(mel, N_FRAMES, axis=-2).astype(mx.float16))
        for code, probability in probabilities.items():
            totals[code] = totals.get(code, 0.0) + probability
    return max(totals, key=totals.get) if totals else None

def without_repeated_decodes(words):
    """Drop words a looping decode emitted again over the same audio."""
    kept = []
    for word in sorted(words, key=lambda item: (item["startMs"], item["endMs"])):
        if kept:
            previous = kept[-1]
            overlap = min(previous["endMs"], word["endMs"]) - max(previous["startMs"], word["startMs"])
            shortest = min(previous["endMs"] - previous["startMs"], word["endMs"] - word["startMs"])
            # Loops often emit zero-length copies stacked on one instant.
            if overlap >= 0 and (overlap > 0.5 * shortest or shortest == 0):
                if word["confidence"] > previous["confidence"]:
                    kept[-1] = word
                continue
        kept.append(word)
    return kept

raw_words = []
result_language = requested_language
segment_serial = 0

def append_result(result, offset_seconds=0.0, core_start=None, core_end=None, language=None):
    global segment_serial
    resolved_language = language or str(result.get("language") or "en")
    for segment in result.get("segments", []):
        current_segment = segment_serial
        segment_serial += 1
        for word in segment.get("words") or []:
            text = str(word.get("word", "")).strip()
            start = word.get("start")
            end = word.get("end")
            if not text or start is None or end is None:
                continue
            absolute_start = float(start) + offset_seconds
            absolute_end = float(end) + offset_seconds
            midpoint = (absolute_start + absolute_end) / 2
            if core_start is not None and midpoint < core_start - 0.05:
                continue
            if core_end is not None and midpoint >= core_end + 0.05:
                continue
            raw_words.append({
                "text": text,
                "startMs": max(0, round(absolute_start * 1000)),
                "endMs": max(0, round(absolute_end * 1000)),
                "confidence": max(0.0, min(1.0, float(word.get("probability", 0.0) or 0.0))),
                "_segment": current_segment,
                "_language": resolved_language if resolved_language in ("en", "es") else None,
            })

if requested_language != "en-es":
    audio = load_audio(audio_path)
    forced_language = requested_language if requested_language in ("en", "es") else detect_song_language(audio)
    result = mlx_whisper.transcribe(audio, **transcription_kwargs(forced_language))
    result_language = str(result.get("language") or requested_language)
    append_result(result, language=result_language)
else:
    audio = load_audio(audio_path)
    duration = len(audio) / SAMPLE_RATE
    timed_hints = []
    last_language = None
    for hint in language_hints:
        start_ms = hint.get("startMs")
        end_ms = hint.get("endMs")
        if start_ms is None or end_ms is None or end_ms <= start_ms:
            continue
        detected = text_language(hint.get("text", ""), last_language)
        if detected:
            last_language = detected
        timed_hints.append({
            "start": max(0.0, float(start_ms) / 1000),
            "end": min(duration, float(end_ms) / 1000),
            "language": detected,
        })

    # Resolve leading/isolated vocalizations from the nearest real lyric.
    next_language = None
    for hint in reversed(timed_hints):
        if hint["language"]:
            next_language = hint["language"]
        elif next_language:
            hint["language"] = next_language

    windows = []
    for hint in timed_hints:
        language = hint["language"] or "en"
        if (
            windows
            and windows[-1]["language"] == language
            and hint["start"] - windows[-1]["end"] <= 4.0
            and hint["end"] - windows[-1]["start"] <= 26.0
        ):
            windows[-1]["end"] = max(windows[-1]["end"], hint["end"])
        else:
            windows.append({"start": hint["start"], "end": hint["end"], "language": language})

    if not windows:
        # No synchronized provider was available. Re-detect every overlapping
        # chunk so a language change cannot poison the rest of the song.
        start = 0.0
        previous_language = None
        while start < duration:
            chunk_end = min(duration, start + 16.0)
            core_start = 0.0 if start == 0 else start + 2.0
            core_end = duration if chunk_end >= duration else start + 14.0
            windows.append({
                "start": core_start,
                "end": core_end,
                "decodeStart": start,
                "decodeEnd": chunk_end,
                "language": previous_language,
                "auto": True,
            })
            start += 12.0

    previous_language = None
    for window_index, window in enumerate(windows):
        core_start = max(0.0, window["start"])
        core_end = min(duration, window["end"])
        previous_window = windows[window_index - 1] if window_index > 0 else None
        next_window = windows[window_index + 1] if window_index + 1 < len(windows) else None
        incoming_switch = previous_window is None or previous_window.get("language") != window.get("language")
        outgoing_switch = next_window is None or next_window.get("language") != window.get("language")
        # Crowd-sourced LRC line starts are commonly about a second late. At a
        # language handoff keep both decodes briefly; the canonical token
        # matcher will retain the correct language and discard the translation.
        accept_start = max(0.0, core_start - (1.4 if incoming_switch else 0.0))
        accept_end = min(duration, core_end + (0.5 if outgoing_switch else 0.0))
        decode_start = max(0.0, window.get("decodeStart", accept_start - 0.35))
        decode_end = min(duration, window.get("decodeEnd", accept_end + 0.35))
        first_sample = max(0, round(decode_start * SAMPLE_RATE))
        last_sample = min(len(audio), round(decode_end * SAMPLE_RATE))
        if last_sample - first_sample < SAMPLE_RATE // 3:
            continue
        chunk = audio[first_sample:last_sample]
        language = window.get("language") if not window.get("auto") else None
        result = mlx_whisper.transcribe(chunk, **transcription_kwargs(language))
        detected = str(result.get("language") or language or previous_language or "en")
        if detected not in ("en", "es"):
            detected = previous_language or "en"
            result = mlx_whisper.transcribe(chunk, **transcription_kwargs(detected))
        previous_language = detected
        append_result(result, decode_start, accept_start, accept_end, detected)

    raw_words.sort(key=lambda word: (word["startMs"], word["endMs"]))
    result_language = "en-es"

raw_words = without_repeated_decodes(raw_words)
lines = []
current = []
current_chars = 0
def flush():
    global current, current_chars
    if not current:
        return
    languages = [word.get("_language") for word in current if word.get("_language")]
    line_language = max(set(languages), key=languages.count) if languages else None
    lines.append({
        "text": " ".join(word["text"] for word in current),
        "startMs": current[0]["startMs"],
        "endMs": current[-1]["endMs"],
        "language": line_language,
        "words": current,
    })
    current = []
    current_chars = 0

for word_index, word in enumerate(raw_words):
    gap = word["startMs"] - current[-1]["endMs"] if current else 0
    projected = current_chars + (1 if current else 0) + len(word["text"])
    previous = current[-1] if current else None
    changed_segment = bool(previous and word["_segment"] != previous["_segment"])
    changed_language = bool(previous and word.get("_language") != previous.get("_language"))
    phrase_starters = {
        "pero", "porque", "cada", "me", "mis", "ahora", "cuando", "si", "lo", "en",
        "and", "but", "because", "then", "well", "when", "if",
    }
    normalized_word = re.sub(r"^[^\wáéíóúüñ]+|[^\wáéíóúüñ]+$", "", word["text"].lower())
    next_word = raw_words[word_index + 1]["text"] if word_index + 1 < len(raw_words) else ""
    normalized_next = re.sub(r"^[^\wáéíóúüñ]+|[^\wáéíóúüñ]+$", "", next_word.lower())
    starts_known_phrase = bool(
        current
        and normalized_word in phrase_starters
        and len(current) >= (3 if normalized_word == "lo" else 4)
        and current_chars >= (15 if normalized_word == "lo" else 18)
    )
    starts_y_ya_phrase = bool(
        current
        and normalized_word == "y"
        and normalized_next == "ya"
        and len(current) >= 3
    )
    starts_phrase = bool(
        current
        and len(current) >= 3
        and word["text"] not in ("I", "A")
        and word["text"][:1].isupper()
        and not current[-1]["text"].isupper()
    )
    closes_phrase = bool(
        previous and re.search(r"[.!?…][\"')\]]?$", previous["text"])
    )
    should_break = bool(current and (
        gap >= 720
        or changed_language
        or (changed_segment and len(current) >= 3 and current_chars >= 24)
        or closes_phrase
        or starts_phrase
        or starts_known_phrase
        or starts_y_ya_phrase
        or len(current) >= 8
        or projected > 42
        or word["startMs"] - current[0]["startMs"] >= 6200
    ))
    if should_break:
        flush()
    current.append(word)
    current_chars += (1 if len(current) > 1 else 0) + len(word["text"])
    if len(current) >= 3 and re.search(r"[.!?…][\"')\]]?$", word["text"]):
        flush()
flush()

for line in lines:
    for word in line["words"]:
        word.pop("_segment", None)
        word.pop("_language", None)

payload = {
    "language": result_language,
    "model": model,
    "lines": lines,
}
with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False)
"#;
        let private_bin = python_for_task
            .parent()
            .ok_or_else(|| "La ruta del motor local no es válida.".to_string())?;
        let existing_path = env::var_os("PATH").unwrap_or_default();
        let mut command_path = private_bin.as_os_str().to_os_string();
        command_path.push(":");
        command_path.push(existing_path);
        let output = Command::new(&python_for_task)
            .arg("-c")
            .arg(script)
            .arg(&vocals_for_task)
            .arg(&result_for_task)
            .arg(&requested_language)
            .arg(LYRICS_MODEL)
            .arg(&language_hints_for_task)
            .env("PATH", command_path)
            .env("HF_HOME", &model_cache_for_task)
            .env("HF_HUB_CACHE", model_cache_for_task.join("hub"))
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "No pude transcribir esta voz. {}",
                error.lines().rev().take(7).collect::<Vec<_>>().join(" ")
            ));
        }
        emit_progress(&app_for_task, "transcription", 1.0, "Texto listo.");
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;

    let contents = fs::read_to_string(&result_path).map_err(|error| error.to_string())?;
    let lyrics: GeneratedLyrics = serde_json::from_str(&contents)
        .map_err(|_| "El transcriptor devolvió un resultado que no pude leer.".to_string())?;
    if lyrics.lines.is_empty() {
        return Err("No pude reconocer palabras cantadas en esta canción.".into());
    }
    Ok(lyrics)
}

#[derive(Clone, Copy, PartialEq)]
enum MfaPass {
    /// Retime words and phones, then measure sustained vowels.
    AlignAndMeasure,
    /// Retime words and phones for a later aligner to build on.
    Align,
    /// Keep the given word edges; add MFA phones only where MFA agrees.
    PhonesOnly,
}

fn align_generated_lyrics(
    app: &AppHandle,
    source: &Path,
    lyrics: &GeneratedLyrics,
    pass: MfaPass,
) -> Result<GeneratedLyrics, String> {
    if !mfa_is_ready(app) || !matches!(lyrics.language.as_str(), "es" | "en" | "en-es") {
        return Ok(lyrics.clone());
    }
    let cache_root = demucs_cache_root(app, source)?;
    let (_, vocals) = locate_stems(&cache_root, source)
        .ok_or_else(|| "No encontré la pista vocal para alinear los fonemas.".to_string())?;
    let job_root = cache_root.join("phoneme-alignment");
    let input_path = job_root.join("lyrics-input.json");
    let output_path = job_root.join("lyrics-aligned.json");
    fs::create_dir_all(&job_root).map_err(|error| error.to_string())?;
    fs::write(
        &input_path,
        serde_json::to_vec(lyrics).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let runtime = mfa_runtime_root(app)?;
    let python = runtime.join("bin/python");
    let mfa_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("mfa-models");
    let script = r#"
import json
import pathlib
import pyphen
import re
import shutil
import subprocess
import sys

vocals_path, input_path, output_path, job_root, language, mode = sys.argv[1:7]
keep_word_edges = mode == "phones-only"
job = pathlib.Path(job_root)
corpora = job / "corpora"
aligned = job / "aligned"
temporary = job / "temporary"
for folder in (corpora, aligned, temporary):
    if folder.exists():
        shutil.rmtree(folder)
aligned.mkdir(parents=True)
temporary.mkdir(parents=True)

with open(input_path, encoding="utf-8") as handle:
    lyrics = json.load(handle)

def clean_token(value):
    return re.sub(r"[^\wáéíóúüñ']+", "", value.lower(), flags=re.UNICODE)

SPANISH_WORDS = {
    "algo", "alguien", "años", "aqui", "asi", "aunque", "cada", "como", "cuando",
    "de", "del", "el", "ella", "en", "eres", "esta", "este", "esto", "habia",
    "hasta", "la", "las", "le", "lejos", "lo", "los", "mano", "mas", "me", "mi",
    "miedo", "nadie", "no", "nos", "otra", "para", "pero", "por", "porque", "que",
    "quiero", "si", "siempre", "sin", "te", "tengo", "todo", "tu", "una", "vez",
    "volver", "ya", "yo",
}
ENGLISH_WORDS = {
    "a", "again", "all", "and", "are", "away", "be", "because", "but", "can",
    "close", "day", "did", "do", "eyes", "feel", "for", "found", "from", "had",
    "her", "here", "hold", "i", "i'm", "if", "in", "inside", "is", "it", "just",
    "know", "left", "love", "me", "my", "no", "not", "of", "on", "one", "that",
    "the", "there", "this", "till", "to", "trust", "was", "when", "with", "without",
    "you", "your",
}

def detect_line_language(value, fallback=None):
    lowered = str(value or "").lower()
    folded = lowered.translate(str.maketrans("áéíóúü", "aeiouu"))
    tokens = re.findall(r"[a-zñ']+", folded)
    spanish = 2 if re.search(r"[áéíóúüñ¿¡]", lowered) else 0
    english = 0
    for token in tokens:
        spanish += int(token in SPANISH_WORDS)
        english += int(token in ENGLISH_WORDS)
    if spanish >= english + 1:
        return "es"
    if english >= spanish + 1:
        return "en"
    return fallback

lyrics_lines = lyrics.get("lines", [])
detected_languages = []
previous_language = language if language in ("en", "es") else None
for line in lyrics_lines:
    explicit = line.get("language") if line.get("language") in ("en", "es") else None
    detected = language if language in ("en", "es") else explicit or detect_line_language(line.get("text", ""), previous_language)
    if detected:
        previous_language = detected
    detected_languages.append(detected)
following_language = None
for index in range(len(detected_languages) - 1, -1, -1):
    if detected_languages[index]:
        following_language = detected_languages[index]
    else:
        detected_languages[index] = following_language or "en"

offsets = {}
clip_ends = {}
line_languages = {}
for index, line in enumerate(lyrics_lines):
    words = line.get("words") or []
    if not words:
        continue
    line_language = detected_languages[index] or "en"
    line["language"] = line_language
    start_ms = max(0, int(words[0].get("startMs", line.get("startMs", 0))))
    # Give MFA a small onset margin only where the preceding lyric leaves room.
    # Including a previous held vowel can attach it to this line's first phone.
    previous_words = (lyrics_lines[index - 1].get("words") or []) if index else []
    previous_end = int(previous_words[-1]["endMs"]) if previous_words else 0
    # A first word Whisper never heard is placed from a provider cue, and
    # crowd-sourced cues often trail the singer; give MFA room to find it.
    onset_margin = 180 if float(words[0].get("confidence", 0) or 0) > 0 else 900
    start_ms = min(start_ms, max(0, start_ms - onset_margin, previous_end))
    end_ms = int(words[-1].get("endMs", line.get("endMs", start_ms + 500)))
    if index + 1 < len(lyrics["lines"]):
        following = lyrics["lines"][index + 1].get("words") or []
        if following:
            next_start = int(following[0].get("startMs", end_ms + 400))
            end_ms = min(end_ms + 320, max(end_ms, next_start - 80))
    else:
        end_ms += 320
    end_ms = max(start_ms + 180, end_ms)
    stem = f"line_{index:04d}"
    corpus = corpora / line_language / "staysound"
    corpus.mkdir(parents=True, exist_ok=True)
    wav = corpus / f"{stem}.wav"
    lab = corpus / f"{stem}.lab"
    transcript = " ".join(clean_token(word.get("text", "")) for word in words).strip()
    lab.write_text(transcript, encoding="utf-8")
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{start_ms / 1000:.3f}",
        "-t", f"{(end_ms - start_ms) / 1000:.3f}", "-i", vocals_path,
        "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", str(wav), "-y",
    ], check=True)
    offsets[stem] = start_ms
    clip_ends[stem] = end_ms
    line_languages[stem] = line_language

languages_used = sorted(set(line_languages.values()))
for current_language in languages_used:
    corpus_root = corpora / current_language
    aligned_root = aligned / current_language
    temporary_root = temporary / current_language
    model = "spanish_mfa" if current_language == "es" else "english_mfa"
    command = [
        str(pathlib.Path(sys.executable).with_name("mfa")), "align_hf", str(corpus_root),
        model, str(aligned_root), "--use_g2p", "--output_format", "json", "--single_speaker",
        "--clean", "--overwrite", "--temporary_directory", str(temporary_root),
    ]
    if current_language == "es":
        command.extend(["--dialect", "spanish_latin_america_mfa"])
    subprocess.run(command, check=True)

def warp_syllables_to_word(word, old_start, old_end):
    """Keep every internal syllable boundary valid after moving word edges."""
    syllables = word.get("syllables") or []
    if not syllables:
        return
    new_start, new_end = int(word["startMs"]), int(word["endMs"])
    count = len(syllables)
    source_duration = max(1, old_end - old_start)
    boundaries = [new_start]
    for index, syllable in enumerate(syllables[:-1]):
        relative = (int(syllable.get("endMs", old_end)) - old_start) / source_duration
        proposed = round(new_start + (new_end - new_start) * max(0.0, min(1.0, relative)))
        minimum = boundaries[-1] + 1
        maximum = new_end - (count - index - 1)
        boundaries.append(max(minimum, min(maximum, proposed)))
    boundaries.append(new_end)
    for index, syllable in enumerate(syllables):
        syllable["startMs"] = boundaries[index]
        syllable["endMs"] = boundaries[index + 1]
        syllable.pop("notes", None)
        syllable.pop("sustained", None)
        syllable.pop("timingConfidence", None)

aligned_count = 0
for index, line in enumerate(lyrics.get("lines", [])):
    stem = f"line_{index:04d}"
    word_language = line_languages.get(stem, line.get("language", "en"))
    result_files = list((aligned / word_language).rglob(f"{stem}.json"))
    if not result_files:
        continue
    data = json.loads(result_files[0].read_text(encoding="utf-8"))
    word_entries = [entry for entry in data["tiers"]["words"]["entries"] if entry[2] not in ("<eps>", "", "spn")]
    phone_entries = [entry for entry in data["tiers"]["phones"]["entries"] if entry[2] not in ("sil", "<eps>")]
    target_words = line.get("words") or []
    if len(word_entries) != len(target_words):
        continue
    offset = offsets[stem] / 1000
    line_window_start = min(offsets[stem], int(line.get("startMs", target_words[0].get("startMs", 0))))
    line_window_end = int(line.get("endMs", target_words[-1].get("endMs", line_window_start + 500)))
    clip_start, clip_end = offsets[stem], clip_ends[stem]
    # Decide every word before writing any: MFA's own intervals never overlap,
    # so a neighbour's stale Whisper time must not veto a measured edge.
    measured = []
    for target, entry in zip(target_words, word_entries):
        begin, end, _ = entry
        word_phones = [(p[0], p[1], p[2]) for p in phone_entries if (p[0] + p[1]) / 2 >= begin and (p[0] + p[1]) / 2 <= end]
        mfa_start = round((begin + offset) * 1000)
        mfa_end = round((end + offset) * 1000)
        original = (int(target.get("startMs", mfa_start)), int(target.get("endMs", mfa_end)))
        interval = trusted_word_interval(
            *original, mfa_start, mfa_end, clip_start, clip_end, word_phones, word_language,
        ) if clean_token(entry[2]) == clean_token(target.get("text", "")) else None
        if keep_word_edges and interval is not None:
            # Word edges were already chosen by a stronger aligner; MFA only
            # contributes phones where it independently agrees with them.
            agrees = abs(interval[0] - original[0]) <= 180 and abs(interval[1] - original[1]) <= 350
            interval = original if agrees else None
        measured.append((interval, word_phones))
    # An unmeasured word yields to measured neighbours; it never pushes a
    # measured edge, and is never squeezed to a flash between two of them.
    intervals = [list(interval) if interval is not None else None for interval, _ in measured]
    fill_gaps(intervals, target_words)
    widen_short_words(intervals)
    for target, span, (interval, word_phones) in zip(target_words, intervals, measured):
        target["startMs"], target["endMs"] = span
        begin = target["startMs"] / 1000 - offset
        end = target["endMs"] / 1000 - offset
        if interval is not None:
            target["measured"] = True
            # Keep measured phone times. Stretching rejected MFA intervals into
            # Whisper slots invents syllable timing even when the words agree.
            word_phones = [(max(begin, a), min(end, b), label)
                           for a, b, label in word_phones if b > begin and a < end]
        else:
            word_phones = []
        local_syllables = make_syllables(target.get("text", ""), begin, end, word_phones, word_language)
        for syllable in local_syllables:
            syllable["startMs"] += round(offset * 1000)
            syllable["endMs"] += round(offset * 1000)
        target["syllables"] = local_syllables
        aligned_count += 1
    for word_index in range(len(target_words) - 1):
        current_word, next_word = target_words[word_index], target_words[word_index + 1]
        if current_word["endMs"] > next_word["startMs"]:
            current_old_start, current_old_end = current_word["startMs"], current_word["endMs"]
            next_old_start, next_old_end = next_word["startMs"], next_word["endMs"]
            safe_low = current_word["startMs"] + 30
            safe_high = next_word["endMs"] - 30
            if safe_low <= safe_high:
                if next_word.get("measured"):
                    preferred = next_word["startMs"]
                elif current_word.get("measured"):
                    preferred = current_word["endMs"]
                else:
                    preferred = round((current_word["endMs"] + next_word["startMs"]) / 2)
                boundary = max(safe_low, min(safe_high, preferred))
                current_word["endMs"] = boundary
                next_word["startMs"] = boundary
                warp_syllables_to_word(current_word, current_old_start, current_old_end)
                warp_syllables_to_word(next_word, next_old_start, next_old_end)
    for word in target_words:
        word.pop("measured", None)
    line["startMs"] = min(line_window_start, target_words[0]["startMs"])
    line["endMs"] = max(line_window_end, target_words[-1]["endMs"])

word_count = sum(len(line.get("words") or []) for line in lyrics.get("lines", []))
if word_count and aligned_count / word_count < 0.65:
    raise RuntimeError(f"MFA aligned only {aligned_count} of {word_count} words")
for line_index in range(len(lyrics.get("lines", [])) - 1):
    current_line, next_line = lyrics["lines"][line_index], lyrics["lines"][line_index + 1]
    overlap_ms = current_line.get("endMs", 0) - next_line.get("startMs", 0)
    # Providers may intentionally overlap consecutive lyric lines for backing or
    # call-and-response vocals. Preserve those ranges; only clean up tiny timing
    # collisions introduced by rounding during alignment.
    if overlap_ms <= 0 or overlap_ms > 250:
        continue
    last_word = (current_line.get("words") or [])[-1]
    first_word = (next_line.get("words") or [])[0]
    safe_low = last_word["startMs"] + 30
    safe_high = first_word["endMs"] - 30
    if safe_low > safe_high:
        continue
    boundary = max(safe_low, min(safe_high, round((last_word["endMs"] + first_word["startMs"]) / 2)))
    last_word["endMs"] = boundary
    current_line["endMs"] = boundary
    first_word["startMs"] = boundary + 1
    next_line["startMs"] = boundary + 1
    if last_word.get("syllables"):
        last_word["syllables"][-1]["endMs"] = boundary
    if first_word.get("syllables"):
        first_word["syllables"][0]["startMs"] = boundary + 1
lyrics["alignment"] = "mfa-bilingual-phoneme-v3" if len(languages_used) > 1 else "mfa-phoneme-v3"
with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(lyrics, handle, ensure_ascii=False)
"#;

    let script = [PHONEME_TIMING_SCRIPT, script].join("\n");
    let mut command_path = runtime.join("bin").into_os_string();
    command_path.push(":");
    command_path.push(env::var_os("PATH").unwrap_or_default());
    let result = Command::new(&python)
        .arg("-c")
        .arg(script)
        .arg(&vocals)
        .arg(&input_path)
        .arg(&output_path)
        .arg(&job_root)
        .arg(&lyrics.language)
        .arg(if pass == MfaPass::PhonesOnly { "phones-only" } else { "align" })
        .env("PATH", command_path)
        .env("MFA_ROOT_DIR", &mfa_root)
        .output()
        .map_err(|error| error.to_string())?;
    if !result.status.success() {
        let error = String::from_utf8_lossy(&result.stderr);
        return Err(format!(
            "No pude alinear los fonemas. {}",
            error.lines().rev().take(8).collect::<Vec<_>>().join(" ")
        ));
    }
    if pass != MfaPass::AlignAndMeasure {
        let aligned = fs::read_to_string(&output_path).map_err(|error| error.to_string())?;
        return serde_json::from_str(&aligned).map_err(|error| error.to_string());
    }
    emit_progress(app, "alignment", 0.72, "Midiendo la voz…");
    let refinement = Command::new(&python)
        .arg("-c")
        .arg(ACOUSTIC_REFINER_SCRIPT)
        .arg(&vocals)
        .arg(&output_path)
        .output()
        .map_err(|error| error.to_string())?;
    if !refinement.status.success() {
        let error = String::from_utf8_lossy(&refinement.stderr);
        return Err(format!(
            "No pude medir las notas sostenidas. {}",
            error.lines().rev().take(8).collect::<Vec<_>>().join(" ")
        ));
    }
    let aligned = fs::read_to_string(&output_path).map_err(|error| error.to_string())?;
    serde_json::from_str(&aligned).map_err(|error| error.to_string())
}

/// `lyrics` carries the MFA word edges; `draft` is the same text before MFA,
/// whose Whisper/provider clock breaks ties between disagreeing aligners.
fn align_experimental_lyrics(
    app: &AppHandle,
    source: &Path,
    lyrics: &GeneratedLyrics,
    draft: &GeneratedLyrics,
) -> Result<GeneratedLyrics, String> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Err("El motor experimental requiere un Mac con Apple Silicon.".into());
    }
    let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?
        .join("lyrics-experimental");
    let bootstrap = app.path().app_cache_dir().map_err(|e| e.to_string())?
        .join("mfa-bootstrap/bin/micromamba");
    let marker = root.join("ready-version");
    if fs::read_to_string(&marker).unwrap_or_default() != "qwen-sofa-v1"
        || !root.join("runtime/bin/python").is_file()
    {
        emit_progress(app, "alignment", 0.30, "Instalando Qwen y SOFA (primera vez; puede tardar varios minutos)…");
        // The normal lyrics setup already supplies this private bootstrap/Python.
        install_mfa_runtime(app)?;
        let result = Command::new(mfa_runtime_root(app)?.join("bin/python"))
            .args(["-c", EXPERIMENTAL_INSTALLER]).arg(&root).arg(&bootstrap)
            .output().map_err(|e| e.to_string())?;
        if !result.status.success() {
            return Err(format!("No pude instalar Qwen/SOFA: {}",
                String::from_utf8_lossy(&result.stderr).lines().rev().take(4).collect::<Vec<_>>().join(" ")));
        }
    }
    let cache = demucs_cache_root(app, source)?;
    let (_, vocals) = locate_stems(&cache, source)
        .ok_or_else(|| "No encontré la pista vocal.".to_string())?;
    let job = cache.join("experimental-alignment");
    fs::create_dir_all(&job).map_err(|e| e.to_string())?;
    let input = job.join("lyrics-input.json");
    let output = job.join("lyrics-aligned.json");
    let draft_path = job.join("lyrics-draft.json");
    fs::write(&input, serde_json::to_vec(lyrics).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::write(&draft_path, serde_json::to_vec(draft).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::write(job.join("phoneme_timing.py"), PHONEME_TIMING_SCRIPT).map_err(|e| e.to_string())?;
    fs::write(job.join("refine_sustains.py"), ACOUSTIC_REFINER_SCRIPT).map_err(|e| e.to_string())?;
    fs::write(job.join("align.py"), EXPERIMENTAL_ALIGNER).map_err(|e| e.to_string())?;
    emit_progress(app, "alignment", 0.45, "Contrastando alineadores palabra por palabra…");
    let mut child = Command::new(root.join("runtime/bin/python"))
        .arg(job.join("align.py")).arg(vocals).arg(input).arg(&output).arg(root.join("assets"))
        .arg("defer-refinement").arg(&draft_path)
        .env("HF_HUB_OFFLINE", "1").env("PYTHONUNBUFFERED", "1")
        .stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| e.to_string())?;
    let stderr = child.stderr.take().ok_or("No pude leer errores del alineador.")?;
    let errors = std::thread::spawn(move || {
        let mut tail = Vec::new();
        stream_segments(stderr, |line| {
            tail.push(line.to_string());
            if tail.len() > 8 { tail.remove(0); }
        });
        tail.join(" ")
    });
    let stdout = child.stdout.take().ok_or("No pude leer el progreso del alineador.")?;
    stream_segments(stdout, |line| {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
            if let (Some(progress), Some(detail)) = (value["progress"].as_f64(), value["detail"].as_str()) {
                emit_progress(app, "alignment", progress as f32, detail);
            }
        }
    });
    let status = child.wait().map_err(|e| e.to_string())?;
    let error = errors.join().unwrap_or_default();
    if !status.success() { return Err(format!("Qwen/SOFA no terminó: {error}")); }
    let mut aligned: GeneratedLyrics = serde_json::from_slice(&fs::read(&output).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    validate_generated_lyrics(&aligned)?;
    // Align Spanish phones against the accepted Qwen edges. Keep English SOFA
    // evidence untouched; MFA's per-line conservative gate still applies.
    let spanish_indices: Vec<usize> = aligned.lines.iter().enumerate()
        .filter(|(_, line)| line.language.as_deref().unwrap_or(&aligned.language) == "es")
        .map(|(index, _)| index).collect();
    if !spanish_indices.is_empty() {
        emit_progress(app, "alignment", 0.95, "Refinando fonemas en español con MFA…");
        let mut spanish = aligned.clone();
        spanish.language = "es".into();
        spanish.lines = spanish_indices.iter().map(|&index| aligned.lines[index].clone()).collect();
        match align_generated_lyrics(app, source, &spanish, MfaPass::PhonesOnly) {
            Ok(refined) if validate_generated_lyrics(&refined).is_ok()
                && refined.lines.len() == spanish_indices.len() => {
                for (&index, line) in spanish_indices.iter().zip(refined.lines) {
                    aligned.lines[index] = line;
                }
                aligned.alignment_notes.push("Fonemas en español refinados con MFA.".into());
            }
            _ => aligned.alignment_notes.push("No se pudieron refinar los fonemas en español; se conservaron los tiempos de palabras.".into()),
        }
    }
    // pYIN runs once, after both languages have their final word/phone edges.
    emit_progress(app, "alignment", 0.96, "Midiendo vocales sostenidas…");
    fs::write(&output, serde_json::to_vec(&aligned).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let refinement = Command::new(root.join("runtime/bin/python"))
        .arg(job.join("refine_sustains.py")).arg(locate_stems(&cache, source).ok_or("Falta la pista vocal.")?.1)
        .arg(&output).output().map_err(|e| e.to_string())?;
    if refinement.status.success() {
        let refined: GeneratedLyrics = serde_json::from_slice(&fs::read(&output).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if validate_generated_lyrics(&refined).is_ok() { aligned = refined; }
    } else {
        aligned.alignment_notes.push("Se conservaron palabras y fonemas; no se pudieron medir las notas sostenidas.".into());
    }
    validate_generated_lyrics(&aligned)?;
    Ok(aligned)
}

#[tauri::command]
pub async fn save_local_generated_lyrics(
    app: AppHandle,
    state: State<'_, MusicLibraryState>,
    path: String,
    lyrics: GeneratedLyrics,
    engine: Option<String>,
) -> Result<GeneratedLyrics, String> {
    let experimental = match engine.as_deref().unwrap_or("mfa") {
        "mfa" => false,
        "qwen-sofa" => true,
        _ => return Err("Motor de sincronización desconocido.".into()),
    };
    let source = authorized_audio_path(&state, &path)?;
    if lyrics.lines.is_empty() || lyrics.lines.iter().all(|line| line.words.is_empty()) {
        return Err("La letra está vacía.".into());
    }
    emit_progress(&app, "alignment", 0.08, "Sincronizando…");
    let app_for_task = app.clone();
    let source_for_task = source.clone();
    let lyrics =
        tauri::async_runtime::spawn_blocking(move || -> Result<GeneratedLyrics, String> {
            let _guard = ALIGNMENT_LOCK.lock().map_err(|_| "El alineador no está disponible.")?;
            let mut fallback = lyrics.clone();
            let pass = if experimental { MfaPass::Align } else { MfaPass::AlignAndMeasure };
            let baseline = align_generated_lyrics(&app_for_task, &source_for_task, &lyrics, pass);
            if let Ok(mut aligned) = baseline {
                if validate_generated_lyrics(&aligned).is_ok() {
                    if experimental {
                        match align_experimental_lyrics(&app_for_task, &source_for_task, &aligned, &lyrics) {
                            Ok(result) => return Ok(result),
                            Err(error) => aligned.alignment_notes.push(format!("Se usó el respaldo MFA. {error}")),
                        }
                    }
                    return Ok(aligned);
                }
            }
            // An internal phoneme/syllable refinement must never trap the user in
            // a modal that can only repeat the same failure. The reviewed word
            // timings are already useful and valid, so persist those as a safe
            // fallback while making the reduced alignment explicit to the UI.
            fallback.alignment = Some("word-timing-fallback".into());
            fallback.acoustic_model = None;
            for line in &mut fallback.lines {
                for word in &mut line.words {
                    word.syllables.clear();
                }
            }
            validate_generated_lyrics(&fallback)?;
            if experimental {
                match align_experimental_lyrics(&app_for_task, &source_for_task, &fallback, &fallback) {
                    Ok(result) => return Ok(result),
                    Err(error) => fallback.alignment_notes.push(format!("Se conservaron los tiempos originales. {error}")),
                }
            }
            Ok(fallback)
        })
        .await
        .map_err(|error| error.to_string())??;
    validate_generated_lyrics(&lyrics)?;
    emit_progress(&app, "alignment", 1.0, "Sincronización lista.");
    let destination = lyrics_file_path(&app, &source)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let contents = serde_json::to_vec(&lyrics).map_err(|error| error.to_string())?;
    fs::write(destination, contents).map_err(|error| error.to_string())?;
    Ok(lyrics)
}

fn validate_generated_lyrics(lyrics: &GeneratedLyrics) -> Result<(), String> {
    if lyrics.lines.is_empty() || lyrics.lines.iter().all(|line| line.words.is_empty()) {
        return Err("La letra está vacía.".into());
    }
    for line in &lyrics.lines {
        if line.end_ms <= line.start_ms {
            return Err(format!("La línea «{}» tiene tiempos inválidos.", line.text));
        }
        for word in &line.words {
            if word.end_ms <= word.start_ms {
                return Err(format!(
                    "La palabra «{}» tiene tiempos inválidos.",
                    word.text
                ));
            }
            if word.start_ms < line.start_ms || word.end_ms > line.end_ms {
                return Err(format!(
                    "La palabra «{}» queda fuera de su línea.",
                    word.text
                ));
            }
            for syllable in &word.syllables {
                if syllable.end_ms <= syllable.start_ms {
                    return Err(format!(
                        "La sílaba «{}» tiene tiempos inválidos.",
                        syllable.text
                    ));
                }
                if syllable.start_ms < word.start_ms || syllable.end_ms > word.end_ms {
                    return Err(format!(
                        "La sílaba «{}» queda fuera de su palabra.",
                        syllable.text
                    ));
                }
                if !syllable.timing_confidence.is_finite()
                    || !(0.0..=1.0).contains(&syllable.timing_confidence)
                {
                    return Err(format!(
                        "La confianza acústica de «{}» es inválida.",
                        syllable.text
                    ));
                }
                for note in &syllable.notes {
                    if note.end_ms <= note.start_ms
                        || note.start_ms < syllable.start_ms
                        || note.end_ms > syllable.end_ms
                        || !note.pitch_midi.is_finite()
                        || !(0.0..=127.0).contains(&note.pitch_midi)
                        || !note.confidence.is_finite()
                        || !(0.0..=1.0).contains(&note.confidence)
                    {
                        return Err(format!(
                            "La evidencia acústica de «{}» tiene tiempos inválidos.",
                            syllable.text
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn persist_local_generated_lyrics(
    app: AppHandle,
    state: State<'_, MusicLibraryState>,
    path: String,
    lyrics: GeneratedLyrics,
) -> Result<GeneratedLyrics, String> {
    let source = authorized_audio_path(&state, &path)?;
    validate_generated_lyrics(&lyrics)?;
    let destination = lyrics_file_path(&app, &source)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let contents = serde_json::to_vec(&lyrics).map_err(|error| error.to_string())?;
        fs::write(destination, contents).map_err(|error| error.to_string())?;
        Ok(lyrics)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn load_local_generated_lyrics(
    app: AppHandle,
    state: State<'_, MusicLibraryState>,
    path: String,
) -> Result<Option<GeneratedLyrics>, String> {
    // Asked once per track the moment the lyrics view mounts, so it sits right
    // on the path the user is looking at: read and parse it off the main thread.
    let source = authorized_audio_path(&state, &path)?;
    let file = lyrics_file_path(&app, &source)?;
    tauri::async_runtime::spawn_blocking(move || {
        if !file.is_file() {
            return Ok(None);
        }
        let contents = fs::read_to_string(file).map_err(|error| error.to_string())?;
        serde_json::from_str(&contents)
            .map(Some)
            .map_err(|_| "La letra local guardada está dañada.".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn fallback_genre(metadata_genre: &str, title: &str, artist: &str) -> KaraokeGenre {
    let haystack = format!("{metadata_genre} {title} {artist}").to_lowercase();
    if ["reggaeton", "urbano", "latin urban", "dembow"]
        .iter()
        .any(|value| haystack.contains(value))
    {
        KaraokeGenre::Reggaeton
    } else if ["disco", "funk", "boogie"]
        .iter()
        .any(|value| haystack.contains(value))
    {
        KaraokeGenre::Disco
    } else if [
        "electronic",
        "electronica",
        "edm",
        "house",
        "techno",
        "dance",
    ]
    .iter()
    .any(|value| haystack.contains(value))
    {
        KaraokeGenre::Electronic
    } else if [
        "folk",
        "country",
        "americana",
        "acoustic",
        "singer-songwriter",
    ]
    .iter()
    .any(|value| haystack.contains(value))
    {
        KaraokeGenre::Folk
    } else if ["rock", "metal", "punk", "grunge", "alternative"]
        .iter()
        .any(|value| haystack.contains(value))
    {
        KaraokeGenre::Rock
    } else {
        KaraokeGenre::Pop
    }
}

fn fallback_visual_plan(genre: &KaraokeGenre) -> KaraokeVisualPlan {
    match genre {
        KaraokeGenre::Rock => KaraokeVisualPlan {
            intro: "clouds".into(),
            verse: "grid".into(),
            chorus: "blaze".into(),
            bridge: "liquid".into(),
            outro: "laser".into(),
        },
        KaraokeGenre::Reggaeton => KaraokeVisualPlan {
            intro: "liquid".into(),
            verse: "grid".into(),
            chorus: "blaze".into(),
            bridge: "liquid".into(),
            outro: "laser".into(),
        },
        KaraokeGenre::Folk => KaraokeVisualPlan {
            intro: "clouds".into(),
            verse: "liquid".into(),
            chorus: "droplets".into(),
            bridge: "clouds".into(),
            outro: "laser".into(),
        },
        KaraokeGenre::Disco => KaraokeVisualPlan {
            intro: "laser".into(),
            verse: "liquid".into(),
            chorus: "blaze".into(),
            bridge: "grid".into(),
            outro: "laser".into(),
        },
        KaraokeGenre::Electronic => KaraokeVisualPlan {
            intro: "clouds".into(),
            verse: "grid".into(),
            chorus: "laser".into(),
            bridge: "liquid".into(),
            outro: "laser".into(),
        },
        KaraokeGenre::Pop => KaraokeVisualPlan {
            intro: "clouds".into(),
            verse: "liquid".into(),
            chorus: "blaze".into(),
            bridge: "grid".into(),
            outro: "laser".into(),
        },
    }
}

#[tauri::command]
pub async fn classify_karaoke_genre(
    app: AppHandle,
    title: String,
    artist: String,
    album: String,
    metadata_genre: Option<String>,
) -> Result<KaraokeGenreResult, String> {
    let metadata_genre = metadata_genre.unwrap_or_default();
    let fallback = || {
        let genre = fallback_genre(&metadata_genre, &title, &artist);
        KaraokeGenreResult {
            visual_plan: fallback_visual_plan(&genre),
            genre,
            confidence: 0.45,
            reason: "Dirección local basada en los metadatos de la canción.".into(),
            source: "local".into(),
        }
    };
    let Some(api_key) = read_settings(&app).gemini_api_key else {
        return Ok(fallback());
    };

    let prompt = format!(
        "Actúa como director visual de karaoke para esta canción individual. Clasifica primero \
         en uno de estos estilos tipográficos: pop, rock, reggaeton, folk, disco, electronic. \
         Después diseña un arco usando sólo estos motores: clouds (niebla atmosférica), liquid \
         (fluido orgánico), blaze (fuego y chispas), grid (geometría rítmica), droplets (vidrio \
         lluvioso e íntimo), laser (línea luminosa futurista). Elige intro, verse, chorus, bridge \
         y outro según la identidad y arco emocional de esta canción; no uses una fórmula fija \
         por género y puedes repetir un motor si la coherencia lo pide. Canción: {title}. \
         Artista: {artist}. Álbum: {album}. Género embebido: {metadata_genre}."
    );
    let payload = serde_json::json!({
        "contents": [{
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 180,
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "genre": {
                        "type": "STRING",
                        "enum": ["pop", "rock", "reggaeton", "folk", "disco", "electronic"]
                    },
                    "confidence": { "type": "NUMBER" },
                    "reason": { "type": "STRING" },
                    "visualPlan": {
                        "type": "OBJECT",
                        "properties": {
                            "intro": {
                                "type": "STRING",
                                "enum": ["clouds", "liquid", "blaze", "grid", "droplets", "laser"]
                            },
                            "verse": {
                                "type": "STRING",
                                "enum": ["clouds", "liquid", "blaze", "grid", "droplets", "laser"]
                            },
                            "chorus": {
                                "type": "STRING",
                                "enum": ["clouds", "liquid", "blaze", "grid", "droplets", "laser"]
                            },
                            "bridge": {
                                "type": "STRING",
                                "enum": ["clouds", "liquid", "blaze", "grid", "droplets", "laser"]
                            },
                            "outro": {
                                "type": "STRING",
                                "enum": ["clouds", "liquid", "blaze", "grid", "droplets", "laser"]
                            }
                        },
                        "required": ["intro", "verse", "chorus", "bridge", "outro"]
                    }
                },
                "required": ["genre", "confidence", "reason", "visualPlan"]
            }
        }
    });
    let endpoint = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    );
    let response = reqwest::Client::new()
        .post(endpoint)
        .header("x-goog-api-key", api_key)
        .json(&payload)
        .send()
        .await;
    let Ok(response) = response else {
        return Ok(fallback());
    };
    if !response.status().is_success() {
        return Ok(fallback());
    }
    let Ok(response) = response.json::<GeminiResponse>().await else {
        return Ok(fallback());
    };
    let Some(text): Option<String> = response
        .candidates
        .and_then(|candidates| candidates.into_iter().next())
        .and_then(|candidate| {
            candidate
                .content
                .parts
                .into_iter()
                .find_map(|part| part.text)
        })
    else {
        return Ok(fallback());
    };
    let Ok(mut result) = serde_json::from_str::<KaraokeGenreResult>(&text) else {
        return Ok(fallback());
    };
    result.confidence = result.confidence.clamp(0.0, 1.0);
    result.source = "gemini".into();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_percentage_out_of_a_demucs_bar() {
        let bar = " 42%|████▏     | 116.0/275.0 [00:24<00:33, 4.8seconds/s]";
        assert_eq!(parse_tqdm_percent(bar), Some(0.42));
        assert_eq!(parse_tqdm_percent("  0%|          | 0/275 [00:00<?, ?it/s]"), Some(0.0));
        assert_eq!(parse_tqdm_percent("Separated tracks will be stored in /tmp"), None);
    }

    #[test]
    fn reads_the_remaining_time_out_of_a_demucs_bar() {
        let bar = " 42%|████▏     | 116.0/275.0 [00:24<01:33, 4.8seconds/s]";
        assert_eq!(parse_tqdm_eta_ms(bar), Some(93_000));
        // An unknown remaining time must not be reported as zero.
        assert_eq!(parse_tqdm_eta_ms("  0%|          | 0/275 [00:00<?, ?it/s]"), None);
    }

    #[test]
    fn parses_clock_values() {
        assert_eq!(parse_clock_ms("01:30"), Some(90_000));
        assert_eq!(parse_clock_ms("0:00:09"), Some(9_000));
        assert_eq!(parse_clock_ms("?"), None);
    }

    #[test]
    fn turns_pip_output_into_progress() {
        let mut packages = 0f32;
        let mut current = String::new();

        let collecting = pip_progress_line("Collecting demucs==4.0.1", &mut packages, &mut current)
            .expect("a Collecting line reports progress");
        assert_eq!(current, "demucs");
        assert_eq!(collecting.2.as_deref(), Some("Resolviendo demucs"));
        assert!(collecting.0 > 0.22);

        let downloading = pip_progress_line(
            "Downloading torch-2.2.0-cp311-none-macosx_11_0_arm64.whl (61.0 MB)",
            &mut packages,
            &mut current,
        )
        .expect("a Downloading line reports progress");
        assert_eq!(downloading.2.as_deref(), Some("Descargando demucs · 61.0 MB"));

        let bar = pip_progress_line(
            "   ━━━━━━━━ 12.4/61.0 MB 5.1 MB/s eta 0:00:09",
            &mut packages,
            &mut current,
        )
        .expect("a pip bar reports progress");
        assert_eq!(bar.2.as_deref(), Some("demucs · 12.4/61.0 MB"));
        assert_eq!(bar.3, Some(9_000));

        assert!(pip_progress_line("Using cached wheel", &mut packages, &mut current).is_none());
    }

    #[test]
    fn splits_carriage_returns_and_newlines_into_segments() {
        let payload = "first line\n 10%|# | 1/10\r 20%|## | 2/10\rtail";
        let mut segments: Vec<String> = Vec::new();
        stream_segments(payload.as_bytes(), |segment| segments.push(segment.to_string()));
        assert_eq!(segments.len(), 4);
        assert_eq!(segments[0], "first line");
        assert_eq!(segments[3], "tail");
    }
}
