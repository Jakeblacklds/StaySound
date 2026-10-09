//! Exact seeking for FLAC.
//!
//! The desktop player is a WKWebView media element, and WebKit opens files
//! through AVFoundation without asking for precise timing. For FLAC that
//! means a seek lands wherever the average bitrate says it should — measured
//! at +6.2 s, +1.7 s and −3.9 s on one song — while `currentTime` reports the
//! time that was asked for. Lyrics, the karaoke and the timing editor all
//! follow `currentTime`, so after any seek they drift away from the voice.
//!
//! ALAC in an MP4 container carries a packet table and seeks exactly, and
//! macOS converts to it losslessly in well under a second. This keeps such a
//! copy per song in the cache; the player switches to it on the first seek.

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    time::SystemTime,
};
use tauri::{AppHandle, Manager, State};

use crate::karaoke::{authorized_audio_path, cache_key};
use crate::music_library::MusicLibraryState;

/// The copies are as large as the FLAC they replace; keep a few dozen songs.
const CACHE_LIMIT_BYTES: u64 = 2 * 1024 * 1024 * 1024;

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|path| path.join("precise-playback"))
        .map_err(|error| error.to_string())
}

/// Bits per sample from the FLAC STREAMINFO block, which always comes first.
fn flac_bits_per_sample(source: &Path) -> Option<u32> {
    let mut bytes = [0u8; 26];
    fs::File::open(source).ok()?.read_exact(&mut bytes).ok()?;
    if &bytes[0..4] != b"fLaC" {
        return None;
    }
    // STREAMINFO body starts at 8; bits 100..104 of it hold bits-per-sample − 1.
    let packed = u64::from_be_bytes(bytes[18..26].try_into().ok()?);
    Some((((packed >> 36) & 0x1f) + 1) as u32)
}

/// Oldest-used copies go first once the cache is over its limit.
fn prune(dir: &Path, keep: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut files: Vec<(PathBuf, u64, SystemTime)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            let used = metadata.modified().ok()?;
            metadata.is_file().then(|| (entry.path(), metadata.len(), used))
        })
        .collect();
    let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
    files.sort_by_key(|(_, _, used)| *used);
    for (path, size, _) in files {
        if total <= CACHE_LIMIT_BYTES {
            break;
        }
        if path != keep && fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

fn convert(source: &Path, destination: &Path) -> Result<(), String> {
    // ALAC's format flag is its source depth: 1 = 16, 2 = 20, 3 = 24, 4 = 32 bit.
    let depth_flag = match flac_bits_per_sample(source).unwrap_or(16) {
        0..=16 => 1,
        17..=20 => 2,
        21..=24 => 3,
        _ => 4,
    };
    let partial = destination.with_extension("partial.m4a");
    let status = Command::new("/usr/bin/afconvert")
        .args(["-f", "m4af", "-d", &format!("alac/{depth_flag}")])
        .arg(source)
        .arg(&partial)
        .status()
        .map_err(|error| error.to_string())?;
    if !status.success() {
        let _ = fs::remove_file(&partial);
        return Err("No pude preparar la copia precisa de esta canción.".into());
    }
    fs::rename(&partial, destination).map_err(|error| error.to_string())
}

/// A copy of the song that seeks exactly, or `None` when the original
/// already does (anything but FLAC) or this system cannot make one.
#[tauri::command]
pub async fn precise_playback_path(
    app: AppHandle,
    state: State<'_, MusicLibraryState>,
    path: String,
) -> Result<Option<String>, String> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    let source = authorized_audio_path(&state, &path)?;
    let is_flac = source
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("flac"));
    if !is_flac {
        return Ok(None);
    }
    let dir = cache_dir(&app)?;
    let destination = dir.join(format!("{}.m4a", cache_key(&source)?));
    app.asset_protocol_scope()
        .allow_directory(&dir, false)
        .map_err(|error| error.to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        if destination.is_file() {
            // Mark it recently used so pruning takes other songs first.
            if let Ok(file) = fs::File::options().append(true).open(&destination) {
                let _ = file.set_modified(SystemTime::now());
            }
        } else {
            convert(&source, &destination)?;
            prune(&dir, &destination);
        }
        Ok(Some(destination.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| error.to_string())?
}
