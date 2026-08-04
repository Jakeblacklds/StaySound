use serde::{Deserialize, Serialize};
use std::{
    collections::hash_map::DefaultHasher,
    env, fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::Command,
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
const ACOUSTIC_REFINER_SCRIPT: &str = include_str!("../python/refine_sustains.py");

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
    let _ = app.emit(
        "karaoke://progress",
        KaraokeProgress {
            stage: stage.to_string(),
            progress,
            detail: detail.to_string(),
        },
    );
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

#[tauri::command]
pub fn karaoke_capabilities(app: AppHandle) -> Result<KaraokeCapabilities, String> {
    let python = find_python(&app, false);
    Ok(KaraokeCapabilities {
        demucs_ready: find_python(&app, true).is_some(),
        transcription_ready: python.as_deref().is_some_and(transcription_is_ready),
        alignment_ready: mfa_is_ready(&app),
        gemini_configured: read_settings(&app)
            .gemini_api_key
            .is_some_and(|value| !value.trim().is_empty()),
        python_version: python.as_deref().and_then(python_version),
    })
}

#[tauri::command]
pub async fn install_local_lyrics_runtime(app: AppHandle) -> Result<KaraokeCapabilities, String> {
    let python = find_python(&app, true)
        .ok_or_else(|| "Primero necesito preparar el motor vocal local de Demucs.".to_string())?;
    if transcription_is_ready(&python) && mfa_is_ready(&app) {
        return karaoke_capabilities(app);
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

    karaoke_capabilities(app)
}

#[tauri::command]
pub fn save_gemini_api_key(app: AppHandle, api_key: String) -> Result<bool, String> {
    let api_key = api_key.trim().to_string();
    if !api_key.is_empty() && api_key.len() < 20 {
        return Err("La clave de Gemini no parece válida.".into());
    }
    let mut settings = read_settings(&app);
    settings.gemini_api_key = (!api_key.is_empty()).then_some(api_key);
    write_settings(&app, &settings)?;
    Ok(settings.gemini_api_key.is_some())
}

#[tauri::command]
pub async fn install_demucs_runtime(app: AppHandle) -> Result<KaraokeCapabilities, String> {
    if find_python(&app, true).is_some() {
        return karaoke_capabilities(app);
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
        let install = Command::new(&runtime_python)
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
            .output()
            .map_err(|error| error.to_string())?;
        if !install.status.success() {
            let error = String::from_utf8_lossy(&install.stderr);
            return Err(format!(
                "No pude instalar Demucs. {}",
                error.lines().rev().take(4).collect::<Vec<_>>().join(" ")
            ));
        }
        install_private_ffmpeg(&runtime_python)?;
        emit_progress(&app_for_task, "runtime", 1.0, "Audio listo.");
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;

    karaoke_capabilities(app)
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
        emit_progress(&app_for_task, "separation", 0.08, "Aislando la voz…");
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
        let output = command
            .arg("-o")
            .arg(&cache_for_task)
            .arg(&source_for_task)
            .env("PATH", command_path)
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Demucs no pudo separar esta canción. {}",
                error.lines().rev().take(5).collect::<Vec<_>>().join(" ")
            ));
        }
        emit_progress(&app_for_task, "separation", 0.98, "Terminando audio…");
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
    forced_language = requested_language if requested_language in ("en", "es") else None
    result = mlx_whisper.transcribe(audio_path, **transcription_kwargs(forced_language))
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

fn align_generated_lyrics(
    app: &AppHandle,
    source: &Path,
    lyrics: &GeneratedLyrics,
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

vocals_path, input_path, output_path, job_root, language = sys.argv[1:6]
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
line_languages = {}
for index, line in enumerate(lyrics_lines):
    words = line.get("words") or []
    if not words:
        continue
    line_language = detected_languages[index] or "en"
    line["language"] = line_language
    # Never include the previous lyric in this clip: on singing, MFA can
    # otherwise assign a held vowel from the outgoing line to the first phone
    # of the new line. Whisper's onset is the hard handoff boundary here.
    start_ms = max(0, int(words[0].get("startMs", line.get("startMs", 0))))
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

hyphenators = {
    "en": pyphen.Pyphen(lang="en_US"),
    "es": pyphen.Pyphen(lang="es"),
}
english_vowels = ("AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW")
spanish_vowels = {"a", "e", "i", "o", "u", "ã", "ẽ", "ĩ", "õ", "ũ"}

def is_vowel(label, word_language):
    plain = re.sub(r"\d", "", label).upper()
    return plain.startswith(english_vowels) if word_language == "en" else label in spanish_vowels

def make_syllables(text, begin, end, phones, word_language):
    match = re.match(r"^(\W*)(.*?)(\W*)$", text, flags=re.UNICODE)
    prefix, core, suffix = match.groups() if match else ("", text, "")
    pieces = [piece for piece in hyphenators[word_language].inserted(core).split("-") if piece] or [core]
    pieces[0] = prefix + pieces[0]
    pieces[-1] += suffix
    nuclei = [phone for phone in phones if is_vowel(phone[2], word_language)]
    if len(pieces) == len(nuclei) and len(pieces) > 1:
        boundaries = [begin]
        for left, right in zip(nuclei, nuclei[1:]):
            boundaries.append((left[1] + right[0]) / 2)
        boundaries.append(end)
    else:
        weights = [max(1, len(clean_token(piece))) for piece in pieces]
        total = sum(weights)
        boundaries = [begin]
        cursor = begin
        for weight in weights[:-1]:
            cursor += (end - begin) * weight / total
            boundaries.append(cursor)
        boundaries.append(end)
    syllables = []
    for index, piece in enumerate(pieces):
        syllable_start, syllable_end = boundaries[index], boundaries[index + 1]
        labels = [label for phone_start, phone_end, label in phones
                  if label not in ("sil", "spn") and (phone_start + phone_end) / 2 >= syllable_start
                  and (phone_start + phone_end) / 2 <= syllable_end]
        syllables.append({
            "text": piece,
            "startMs": round(syllable_start * 1000),
            "endMs": max(round(syllable_start * 1000) + 1, round(syllable_end * 1000)),
            "phones": labels,
        })
    return syllables

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
    line_window_start = int(line.get("startMs", target_words[0].get("startMs", 0)))
    line_window_end = int(line.get("endMs", target_words[-1].get("endMs", line_window_start + 500)))
    for target_index, (target, entry) in enumerate(zip(target_words, word_entries)):
        begin, end, _ = entry
        word_phones = [(p[0], p[1], p[2]) for p in phone_entries if (p[0] + p[1]) / 2 >= begin and (p[0] + p[1]) / 2 <= end]
        mfa_start = round((begin + offset) * 1000)
        mfa_end = round((end + offset) * 1000)
        original_start = int(target.get("startMs", mfa_start))
        original_end = int(target.get("endMs", mfa_end))
        confidence = float(target.get("confidence", 0) or 0)
        if confidence > 0.15:
            # Whisper is the stable onset anchor. MFA is allowed to extend a
            # held ending, but never to push a recognized word later/earlier.
            anchored_start = max(line_window_start, original_start)
            next_start = int(target_words[target_index + 1].get("startMs", line_window_end)) if target_index + 1 < len(target_words) else line_window_end
            end_limit = max(anchored_start + 40, min(line_window_end, next_start))
            anchored_end = min(end_limit, max(original_end, mfa_end))
            local_begin = anchored_start / 1000 - offset
            local_end = anchored_end / 1000 - offset
            source_duration = max(0.001, end - begin)
            target_duration = max(0.001, local_end - local_begin)
            scale = target_duration / source_duration
            word_phones = [
                (local_begin + (phone_start - begin) * scale,
                 local_begin + (phone_end - begin) * scale,
                 label)
                for phone_start, phone_end, label in word_phones
            ]
            begin, end = local_begin, local_end
            target["startMs"] = anchored_start
            target["endMs"] = anchored_end
        else:
            # A provider-only word has no trustworthy acoustic identity. Keep
            # its interpolated slot and use MFA only to distribute its phones;
            # accepting MFA's word location can steal the following recognized
            # word and invert that word's internal syllable boundaries.
            target["startMs"] = max(line_window_start, original_start)
            next_start = int(target_words[target_index + 1].get("startMs", line_window_end)) if target_index + 1 < len(target_words) else line_window_end
            target["endMs"] = min(line_window_end, next_start, max(target["startMs"] + 40, original_end))
            local_begin = target["startMs"] / 1000 - offset
            local_end = target["endMs"] / 1000 - offset
            source_duration = max(0.001, end - begin)
            target_duration = max(0.001, local_end - local_begin)
            scale = target_duration / source_duration
            word_phones = [
                (local_begin + (phone_start - begin) * scale,
                 local_begin + (phone_end - begin) * scale,
                 label)
                for phone_start, phone_end, label in word_phones
            ]
            begin, end = local_begin, local_end
        local_syllables = make_syllables(target.get("text", ""), begin, end, word_phones, word_language) if word_phones else []
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
                current_confidence = float(current_word.get("confidence", 0) or 0)
                next_confidence = float(next_word.get("confidence", 0) or 0)
                if next_confidence > 0.15:
                    preferred = next_word["startMs"]
                elif current_confidence > 0.15:
                    preferred = current_word["endMs"]
                else:
                    preferred = round((current_word["endMs"] + next_word["startMs"]) / 2)
                boundary = max(safe_low, min(safe_high, preferred))
                current_word["endMs"] = boundary
                next_word["startMs"] = boundary
                warp_syllables_to_word(current_word, current_old_start, current_old_end)
                warp_syllables_to_word(next_word, next_old_start, next_old_end)
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
lyrics["alignment"] = "mfa-bilingual-phoneme-v1" if len(languages_used) > 1 else "mfa-phoneme-v1"
with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(lyrics, handle, ensure_ascii=False)
"#;

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

#[tauri::command]
pub async fn save_local_generated_lyrics(
    app: AppHandle,
    state: State<'_, MusicLibraryState>,
    path: String,
    lyrics: GeneratedLyrics,
) -> Result<GeneratedLyrics, String> {
    let source = authorized_audio_path(&state, &path)?;
    if lyrics.lines.is_empty() || lyrics.lines.iter().all(|line| line.words.is_empty()) {
        return Err("La letra está vacía.".into());
    }
    emit_progress(&app, "alignment", 0.08, "Sincronizando…");
    let app_for_task = app.clone();
    let source_for_task = source.clone();
    let lyrics =
        tauri::async_runtime::spawn_blocking(move || -> Result<GeneratedLyrics, String> {
            let mut fallback = lyrics.clone();
            let aligned = align_generated_lyrics(&app_for_task, &source_for_task, &lyrics)?;
            if validate_generated_lyrics(&aligned).is_ok() {
                return Ok(aligned);
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
pub fn persist_local_generated_lyrics(
    app: AppHandle,
    state: State<'_, MusicLibraryState>,
    path: String,
    lyrics: GeneratedLyrics,
) -> Result<GeneratedLyrics, String> {
    let source = authorized_audio_path(&state, &path)?;
    validate_generated_lyrics(&lyrics)?;
    let destination = lyrics_file_path(&app, &source)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let contents = serde_json::to_vec(&lyrics).map_err(|error| error.to_string())?;
    fs::write(destination, contents).map_err(|error| error.to_string())?;
    Ok(lyrics)
}

#[tauri::command]
pub fn load_local_generated_lyrics(
    app: AppHandle,
    state: State<'_, MusicLibraryState>,
    path: String,
) -> Result<Option<GeneratedLyrics>, String> {
    let source = authorized_audio_path(&state, &path)?;
    let file = lyrics_file_path(&app, &source)?;
    if !file.is_file() {
        return Ok(None);
    }
    let contents = fs::read_to_string(file).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|_| "La letra local guardada está dañada.".to_string())
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
