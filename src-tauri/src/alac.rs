//! Moves the library from FLAC to ALAC.
//!
//! WKWebView seeks FLAC by estimate — seconds away from the requested time —
//! while ALAC in an MP4 container carries a packet table and seeks exactly
//! (see `playback.rs`). Both are lossless, so the library is converted once
//! instead of keeping a second copy of every song in the cache.
//!
//! A FLAC is only sent to the Trash after its ALAC has been written and its
//! decoded audio compared, sample for sample, with the original's. Everything
//! the app keeps per file is keyed by the file's path, so the generated lyrics
//! and the karaoke stems move to the new file's key with it.

use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager, State};

use crate::karaoke::{authorized_audio_path, cache_key};
use crate::music_library::MusicLibraryState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlacMigration {
    /// "converted", "renamed" (an MP4 that only had a .flac name),
    /// "trashed-empty" (a failed download with no audio) or "skipped".
    outcome: &'static str,
    new_path: Option<String>,
    reason: Option<String>,
}

impl AlacMigration {
    fn skipped(reason: impl Into<String>) -> Self {
        Self { outcome: "skipped", new_path: None, reason: Some(reason.into()) }
    }
}

/// The ffmpeg the lyrics and stem runtimes already installed.
fn find_ffmpeg(app: &AppHandle) -> Option<PathBuf> {
    let data = app.path().app_data_dir().ok()?;
    ["mfa-runtime/bin/ffmpeg", "demucs-runtime/bin/ffmpeg"]
        .iter()
        .map(|relative| data.join(relative))
        .chain(["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].map(PathBuf::from))
        .find(|candidate| candidate.is_file())
}

fn file_magic(path: &Path) -> Option<[u8; 8]> {
    let mut bytes = [0u8; 8];
    fs::File::open(path).ok()?.read_exact(&mut bytes).ok()?;
    Some(bytes)
}

/// MD5 of the decoded audio: equal hashes mean identical samples.
fn pcm_md5(ffmpeg: &Path, path: &Path) -> Result<String, String> {
    let output = Command::new(ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(path)
        .args(["-map", "0:a:0", "-f", "md5", "-"])
        .output()
        .map_err(|error| error.to_string())?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() || !text.starts_with("MD5=") {
        return Err("No pude leer el audio para verificarlo.".into());
    }
    Ok(text)
}

/// Moves what the app keeps under the old file's key to the new file's key.
fn migrate_caches(app: &AppHandle, old_key: &str, new_key: &str) {
    if old_key == new_key {
        return;
    }
    if let Ok(data) = app.path().app_local_data_dir() {
        let lyrics = data.join("generated-lyrics");
        let from = lyrics.join(format!("{old_key}.json"));
        let to = lyrics.join(format!("{new_key}.json"));
        if from.is_file() && !to.exists() {
            let _ = fs::rename(from, to);
        }
    }
    if let Ok(cache) = app.path().app_cache_dir() {
        let karaoke = cache.join("karaoke");
        let from = karaoke.join(old_key);
        let to = karaoke.join(new_key);
        if from.is_dir() && !to.exists() {
            let _ = fs::rename(from, to);
        }
        // The seekable copy of a FLAC that no longer exists is dead weight.
        let _ = fs::remove_file(cache.join("precise-playback").join(format!("{old_key}.m4a")));
    }
}

/// Downloaded songs carry a sidecar describing the file; keep it truthful.
fn update_sidecar_codec(source: &Path) {
    let sidecar = source.with_extension("json");
    let Ok(text) = fs::read_to_string(&sidecar) else { return };
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&text) else { return };
    let is_flac = value
        .get("codec")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|codec| codec.eq_ignore_ascii_case("flac"));
    if is_flac {
        value["codec"] = serde_json::Value::String("alac".into());
        if let Ok(updated) = serde_json::to_string(&value) {
            let _ = fs::write(sidecar, updated);
        }
    }
}

fn keep_modified_time(from: &Path, to: &Path) {
    if let Ok(modified) = fs::metadata(from).and_then(|metadata| metadata.modified()) {
        if let Ok(file) = fs::File::options().append(true).open(to) {
            let _ = file.set_modified(modified);
        }
    }
}

fn convert(ffmpeg: &Path, source: &Path, target: &Path) -> Result<(), String> {
    let partial = target.with_extension("alac-partial");
    let status = Command::new(ffmpeg)
        .args(["-v", "error", "-y", "-i"])
        .arg(source)
        // Audio as ALAC (same bit depth), the embedded cover kept as cover,
        // every tag carried over.
        .args([
            "-map", "0:a:0", "-map", "0:v?", "-c:a", "alac", "-c:v", "copy",
            "-disposition:v", "attached_pic", "-map_metadata", "0", "-f", "ipod",
        ])
        .arg(&partial)
        .status()
        .map_err(|error| error.to_string())?;
    if !status.success() {
        let _ = fs::remove_file(&partial);
        return Err("ffmpeg no pudo convertir el archivo.".into());
    }
    let identical = pcm_md5(ffmpeg, source)? == pcm_md5(ffmpeg, &partial)?;
    if !identical {
        let _ = fs::remove_file(&partial);
        return Err("La copia ALAC no sonaba idéntica; dejé el FLAC intacto.".into());
    }
    fs::rename(&partial, target).map_err(|error| error.to_string())
}

fn migrate(app: &AppHandle, source: &Path) -> Result<AlacMigration, String> {
    let size = fs::metadata(source).map_err(|error| error.to_string())?.len();
    if size == 0 {
        trash::delete(source).map_err(|error| error.to_string())?;
        return Ok(AlacMigration { outcome: "trashed-empty", new_path: None, reason: None });
    }
    let target = source.with_extension("m4a");
    if target.exists() {
        return Ok(AlacMigration::skipped("Ya existe un .m4a con el mismo nombre."));
    }
    let magic = file_magic(source).unwrap_or_default();
    let old_key = cache_key(source)?;

    if &magic[4..8] == b"ftyp" {
        // An MP4 that was only named .flac: the name is the whole fix.
        fs::rename(source, &target).map_err(|error| error.to_string())?;
        migrate_caches(app, &old_key, &cache_key(&target)?);
        return Ok(AlacMigration {
            outcome: "renamed",
            new_path: Some(target.to_string_lossy().into_owned()),
            reason: None,
        });
    }
    if &magic[0..4] != b"fLaC" {
        return Ok(AlacMigration::skipped("No es un FLAC válido."));
    }
    let ffmpeg = find_ffmpeg(app)
        .ok_or("Falta ffmpeg: prepara primero el motor de letras locales.")?;
    convert(&ffmpeg, source, &target)?;
    keep_modified_time(source, &target);
    migrate_caches(app, &old_key, &cache_key(&target)?);
    update_sidecar_codec(source);
    // Only now, with an identical copy in place, does the original go —
    // and to the Trash, where it can still be recovered.
    trash::delete(source).map_err(|error| error.to_string())?;
    Ok(AlacMigration {
        outcome: "converted",
        new_path: Some(target.to_string_lossy().into_owned()),
        reason: None,
    })
}

#[tauri::command]
pub async fn migrate_flac_to_alac(
    app: AppHandle,
    state: State<'_, MusicLibraryState>,
    path: String,
) -> Result<AlacMigration, String> {
    let source = authorized_audio_path(&state, &path)?;
    let is_flac = source
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("flac"));
    if !is_flac {
        return Ok(AlacMigration::skipped("No es un archivo .flac."));
    }
    tauri::async_runtime::spawn_blocking(move || migrate(&app, &source))
        .await
        .map_err(|error| error.to_string())?
}
