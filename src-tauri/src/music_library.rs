use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{ipc::Response, AppHandle, Manager, State};

const MUSIC_FOLDER_FILENAME: &str = "music-folder.txt";
const AUDIO_EXTENSIONS: &[&str] = &[
    "aac", "aiff", "alac", "flac", "m4a", "mp3", "mp4", "oga", "ogg", "opus", "wav", "webm",
];

pub struct MusicLibraryState(pub Mutex<Option<PathBuf>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMusicFile {
    path: String,
    relative_path: String,
    name: String,
    size: u64,
    last_modified: u64,
    mime_type: String,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(MUSIC_FOLDER_FILENAME))
        .map_err(|error| error.to_string())
}

fn canonical_directory(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let canonical = path
        .as_ref()
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical.is_dir() {
        return Err("La ruta seleccionada no es una carpeta.".into());
    }
    Ok(canonical)
}

fn allow_music_directory(app: &AppHandle, path: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(path, true)
        .map_err(|error| error.to_string())
}

pub fn initialize(app: &AppHandle) -> MusicLibraryState {
    let root = config_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        // Do not canonicalize the remembered folder during app startup.
        // On macOS that touches privacy-protected folders (Documents, Desktop,
        // Downloads) and causes a permission prompt before the user tries to
        // scan or play anything. Commands that actually access the library
        // still canonicalize and validate their target at the point of use.
        .and_then(|path| {
            let path = path.trim();
            (!path.is_empty()).then(|| PathBuf::from(path))
        });
    if let Some(path) = &root {
        let _ = allow_music_directory(app, path);
    }
    MusicLibraryState(Mutex::new(root))
}

pub(crate) fn current_root(state: &State<'_, MusicLibraryState>) -> Result<PathBuf, String> {
    state
        .0
        .lock()
        .map_err(|_| "No se pudo acceder a la carpeta de música.".to_string())?
        .clone()
        .ok_or_else(|| "Selecciona una carpeta de música primero.".to_string())
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

pub(crate) fn is_audio(path: &Path) -> bool {
    AUDIO_EXTENSIONS.contains(&extension(path).as_str())
}

fn mime_type(path: &Path) -> &'static str {
    match extension(path).as_str() {
        "aac" => "audio/aac",
        "aiff" => "audio/aiff",
        "flac" => "audio/flac",
        "m4a" | "mp4" | "alac" => "audio/mp4",
        "oga" | "ogg" => "audio/ogg",
        "opus" => "audio/opus",
        "wav" => "audio/wav",
        "webm" => "audio/webm",
        _ => "audio/mpeg",
    }
}

#[tauri::command]
pub fn remember_music_folder(
    app: AppHandle,
    state: State<'_, MusicLibraryState>,
    path: String,
) -> Result<String, String> {
    let root = canonical_directory(path)?;
    allow_music_directory(&app, &root)?;

    let destination = config_path(&app)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&destination, root.to_string_lossy().as_bytes())
        .map_err(|error| error.to_string())?;
    *state
        .0
        .lock()
        .map_err(|_| "No se pudo guardar la carpeta de música.".to_string())? = Some(root.clone());
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn get_music_folder(state: State<'_, MusicLibraryState>) -> Result<Option<String>, String> {
    let root = state
        .0
        .lock()
        .map_err(|_| "No se pudo acceder a la carpeta de música.".to_string())?;
    Ok(root
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn scan_music_folder(
    state: State<'_, MusicLibraryState>,
) -> Result<Vec<NativeMusicFile>, String> {
    let root = current_root(&state)?;
    let mut pending = vec![root.clone()];
    let mut files = Vec::new();

    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| error.to_string())?;
        for entry in entries.flatten() {
            let file_type = match entry.file_type() {
                Ok(value) => value,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            if !file_type.is_file() || !is_audio(&path) {
                continue;
            }
            let metadata = match entry.metadata() {
                Ok(value) => value,
                Err(_) => continue,
            };
            let relative_path = path
                .strip_prefix(&root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let last_modified = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_millis() as u64)
                .unwrap_or_default();
            files.push(NativeMusicFile {
                path: path.to_string_lossy().into_owned(),
                relative_path,
                name: entry.file_name().to_string_lossy().into_owned(),
                size: metadata.len(),
                last_modified,
                mime_type: mime_type(&path).to_string(),
            });
        }
    }

    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(files)
}

#[tauri::command]
pub fn read_music_file(
    state: State<'_, MusicLibraryState>,
    path: String,
) -> Result<Response, String> {
    let root = current_root(&state)?;
    let source = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !source.starts_with(&root) || !source.is_file() || !is_audio(&source) {
        return Err("El archivo no pertenece a la carpeta de música autorizada.".into());
    }
    fs::read(source)
        .map(Response::new)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn fetch_tidal_artwork(url: String) -> Result<Response, String> {
    const MAX_ARTWORK_BYTES: u64 = 2_500_000;
    let source =
        reqwest::Url::parse(&url).map_err(|_| "La URL del artwork no es válida.".to_string())?;
    if source.scheme() != "https" || source.host_str() != Some("resources.tidal.com") {
        return Err("El origen del artwork no está permitido.".into());
    }

    let response = reqwest::get(source)
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "No se pudo descargar el artwork ({}).",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_ARTWORK_BYTES)
    {
        return Err("El artwork es demasiado grande.".into());
    }
    let is_image = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("image/"));
    if !is_image {
        return Err("La respuesta de artwork no es una imagen.".into());
    }

    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_ARTWORK_BYTES {
        return Err("El artwork es demasiado grande.".into());
    }
    Ok(Response::new(bytes.to_vec()))
}
