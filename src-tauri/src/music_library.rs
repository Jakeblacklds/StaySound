use serde::Serialize;
use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, UNIX_EPOCH},
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

/// Tauri runs a command declared as a plain `fn` on the application's main
/// thread — the same thread that owns the window and drives the webview's
/// paint. Anything that touches the disk from there stops the picture: the
/// lyrics stop advancing and the dot matrix stops drawing for exactly as long
/// as the syscall takes, while the audio (which lives on its own thread) keeps
/// playing. Every command below is therefore `async` and hands its blocking
/// work to `spawn_blocking`; only the cheap argument validation stays inline.
fn walk_music_folder(root: PathBuf) -> Result<Vec<NativeMusicFile>, String> {
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
pub async fn scan_music_folder(
    state: State<'_, MusicLibraryState>,
) -> Result<Vec<NativeMusicFile>, String> {
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || walk_music_folder(root))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn read_music_file(
    state: State<'_, MusicLibraryState>,
    path: String,
) -> Result<Response, String> {
    let root = current_root(&state)?;
    // A whole FLAC is tens of megabytes; reading one here rather than on a
    // blocking thread is the single longest stall the desktop build can put in
    // front of the compositor.
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(path)
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !source.starts_with(&root) || !source.is_file() || !is_audio(&source) {
            return Err("El archivo no pertenece a la carpeta de música autorizada.".to_string());
        }
        fs::read(source)
            .map(Response::new)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
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

const TIDAL_CLIENT_ID: &str = "txNoH4kkV41MfH25";
const TIDAL_CLIENT_SECRET: &str = "dQjy0MinCEvxi1O4UmxvxWnDjt4cgHBPw8ll6nYBk98=";

/// One HTTP client and one catalog token for the whole session. Search-as-you-type
/// fires a request every few keystrokes; authenticating on each of them used to
/// double the latency of every result the user saw.
fn tidal_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

fn tidal_token_slot() -> &'static Mutex<Option<(String, Instant)>> {
    static TOKEN: OnceLock<Mutex<Option<(String, Instant)>>> = OnceLock::new();
    TOKEN.get_or_init(|| Mutex::new(None))
}

async fn tidal_token(force_refresh: bool) -> Result<String, String> {
    if !force_refresh {
        if let Ok(slot) = tidal_token_slot().lock() {
            if let Some((token, expires_at)) = slot.as_ref() {
                if Instant::now() < *expires_at {
                    return Ok(token.clone());
                }
            }
        }
    }

    let response = tidal_client()
        .post("https://auth.tidal.com/v1/oauth2/token")
        .basic_auth(TIDAL_CLIENT_ID, Some(TIDAL_CLIENT_SECRET))
        .form(&[
            ("client_id", TIDAL_CLIENT_ID),
            ("client_secret", TIDAL_CLIENT_SECRET),
            ("grant_type", "client_credentials"),
        ])
        .send()
        .await
        .map_err(|error| format!("No se pudo autenticar el catálogo TIDAL: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("La autenticación TIDAL falló ({})", response.status()));
    }
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;
    let token = payload
        .get("access_token")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "TIDAL no devolvió un token de catálogo.".to_string())?
        .to_owned();
    // Refresh a minute early so a request never races the expiry.
    let lifetime = payload
        .get("expires_in")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(3600)
        .saturating_sub(60)
        .max(60);
    if let Ok(mut slot) = tidal_token_slot().lock() {
        *slot = Some((token.clone(), Instant::now() + Duration::from_secs(lifetime)));
    }
    Ok(token)
}

async fn tidal_get(path: &str, params: &[(String, String)]) -> Result<serde_json::Value, String> {
    let url = format!("https://api.tidal.com/v1/{path}");
    let mut query: Vec<(&str, &str)> = vec![("countryCode", "US")];
    query.extend(params.iter().map(|(key, value)| (key.as_str(), value.as_str())));

    for attempt in 0..2 {
        let token = tidal_token(attempt > 0).await?;
        let response = tidal_client()
            .get(&url)
            .bearer_auth(token)
            .query(&query)
            .send()
            .await
            .map_err(|error| format!("No se pudo consultar el catálogo TIDAL: {error}"))?;
        // A revoked or clock-skewed token answers 401; mint a fresh one once.
        if response.status() == reqwest::StatusCode::UNAUTHORIZED && attempt == 0 {
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("El catálogo TIDAL respondió {}", response.status()));
        }
        return response
            .json::<serde_json::Value>()
            .await
            .map_err(|error| error.to_string());
    }
    Err("TIDAL rechazó el token de catálogo.".into())
}

/// Only the read-only catalog routes the Descargas browser needs; the webview
/// can't turn this into a general proxy for the TIDAL API.
fn is_allowed_tidal_path(path: &str) -> bool {
    let segments: Vec<&str> = path.split('/').collect();
    let is_id = |value: &str| !value.is_empty() && value.len() <= 20 && value.bytes().all(|byte| byte.is_ascii_digit());
    match segments.as_slice() {
        ["search"] => true,
        ["artists", id] | ["albums", id] => is_id(id),
        ["artists", id, "toptracks" | "albums" | "similar"] => is_id(id),
        ["albums", id, "items"] => is_id(id),
        _ => false,
    }
}

#[tauri::command]
pub async fn tidal_catalog_request(
    path: String,
    params: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    const ALLOWED_PARAMS: &[&str] = &["query", "types", "limit", "offset", "filter"];
    let path = path.trim_matches('/');
    if !is_allowed_tidal_path(path) {
        return Err("La ruta del catálogo TIDAL no está permitida.".into());
    }
    let params: Vec<(String, String)> = params
        .into_iter()
        .filter(|(key, value)| ALLOWED_PARAMS.contains(&key.as_str()) && value.len() <= 256)
        .collect();
    tidal_get(path, &params).await
}

#[tauri::command]
pub async fn search_tidal_catalog(
    kind: String,
    query: String,
) -> Result<serde_json::Value, String> {
    let endpoint = match kind.as_str() {
        "tracks" | "artists" | "albums" | "playlists" => kind,
        _ => return Err("El tipo de búsqueda TIDAL no está permitido.".into()),
    };
    let query = query.trim();
    if query.is_empty() {
        return Ok(serde_json::json!({ "items": [] }));
    }
    tidal_get(
        &format!("search/{endpoint}"),
        &[
            ("query".to_string(), query.to_string()),
            ("limit".to_string(), "50".to_string()),
        ],
    )
    .await
}

/// Downloads an Apple motion cover once and keeps it in the app cache.
///
/// Streaming these covers straight from Apple's CDN is what makes the full
/// player hitch: the element is a looping `<video>` with `preload="metadata"`,
/// so it re-fetches while playing, `stalled` fires when the CDN goes quiet,
/// and every loop wrap re-seeks a source that is not fully buffered. Each of
/// those stalls the media pipeline, and the picture freezes for as long as it
/// lasts while the music keeps going. Served from disk, the video never
/// touches the network again — the loop is seamless and the cache survives
/// restarts.
#[tauri::command]
pub async fn cache_animated_artwork(app: AppHandle, url: String) -> Result<String, String> {
    const MAX_VIDEO_BYTES: u64 = 40_000_000;

    let source =
        reqwest::Url::parse(&url).map_err(|_| "La URL del vídeo no es válida.".to_string())?;
    // Same allowlist the web side applies before it ever asks for a download.
    if source.scheme() != "https"
        || !source
            .host_str()
            .is_some_and(|host| host.ends_with(".apple.com"))
    {
        return Err("El origen del vídeo no está permitido.".into());
    }

    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    let name = format!("{:016x}.mp4", hasher.finish());

    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("animated-artwork");
    fs::create_dir_all(&cache_root).map_err(|error| error.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&cache_root, false)
        .map_err(|error| error.to_string())?;

    let destination = cache_root.join(&name);
    if destination.is_file() {
        return Ok(destination.to_string_lossy().into_owned());
    }

    let response = reqwest::get(source)
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "No se pudo descargar el vídeo ({}).",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_VIDEO_BYTES)
    {
        return Err("El vídeo es demasiado grande.".into());
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("desconocido")
        .to_string();
    if !content_type.starts_with("video/") {
        // Naming the type matters: an HLS manifest
        // (application/vnd.apple.mpegurl) means the cover is not one file at
        // all but a playlist of segments, and no amount of retrying this
        // download would fix it.
        return Err(format!(
            "La respuesta no es un vídeo (content-type: {content_type})."
        ));
    }

    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_VIDEO_BYTES {
        return Err("El vídeo es demasiado grande.".into());
    }

    // Write beside the target and rename, so a download interrupted halfway
    // never leaves a truncated file that would play once and then fail.
    let staging = cache_root.join(format!("{name}.part"));
    fs::write(&staging, &bytes).map_err(|error| error.to_string())?;
    fs::rename(&staging, &destination).map_err(|error| error.to_string())?;

    Ok(destination.to_string_lossy().into_owned())
}
