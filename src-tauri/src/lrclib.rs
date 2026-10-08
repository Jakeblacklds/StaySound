//! Publishes a Lyricsfile (https://lrclib.net/lyricsfile) to LRCLIB.
//!
//! LRCLIB gates writes behind a SHA-256 proof of work: `sha256(prefix + nonce)`
//! must be <= the challenge target. At the base difficulty that is ~16M hashes,
//! seconds natively but minutes through WebCrypto, so it runs here.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;

const LRCLIB_API: &str = "https://lrclib.net/api";
const LRCLIB_CLIENT: &str = "StaySound v1.0 (https://github.com/Jakeblacklds/StaySound)";

#[derive(Deserialize)]
struct Challenge {
    prefix: String,
    target: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishRequest<'a> {
    track_name: &'a str,
    artist_name: &'a str,
    album_name: &'a str,
    duration: f64,
    lyricsfile: &'a str,
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

fn solve_challenge(prefix: &str, target: &[u8]) -> String {
    let mut nonce: u64 = 0;
    loop {
        let mut hasher = Sha256::new();
        hasher.update(prefix.as_bytes());
        hasher.update(nonce.to_string().as_bytes());
        // Big-endian byte comparison, the same order LRCLIB verifies with.
        if hasher.finalize().as_slice() <= target {
            return nonce.to_string();
        }
        nonce += 1;
    }
}

#[tauri::command]
pub async fn publish_lrclib_lyricsfile(
    title: String,
    artist: String,
    album: String,
    duration_ms: u64,
    lyricsfile: String,
) -> Result<(), String> {
    if title.trim().is_empty() || artist.trim().is_empty() || album.trim().is_empty() {
        return Err("LRCLIB necesita título, artista y álbum.".into());
    }
    if duration_ms == 0 {
        return Err("LRCLIB necesita la duración de la canción.".into());
    }
    if lyricsfile.trim().is_empty() {
        return Err("La letra está vacía.".into());
    }

    let client = reqwest::Client::builder()
        .user_agent(LRCLIB_CLIENT)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;

    let challenge = client
        .post(format!("{LRCLIB_API}/request-challenge"))
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|error| format!("No se pudo pedir el reto de LRCLIB: {error}"))?
        .json::<Challenge>()
        .await
        .map_err(|error| format!("Respuesta inesperada de LRCLIB: {error}"))?;

    let target = decode_hex(&challenge.target)
        .filter(|bytes| bytes.len() == 32)
        .ok_or("LRCLIB devolvió un reto inválido.")?;
    let prefix = challenge.prefix.clone();
    let nonce = tauri::async_runtime::spawn_blocking(move || solve_challenge(&prefix, &target))
        .await
        .map_err(|error| error.to_string())?;

    let response = client
        .post(format!("{LRCLIB_API}/publish"))
        .header("X-Publish-Token", format!("{}:{nonce}", challenge.prefix))
        .json(&PublishRequest {
            track_name: title.trim(),
            artist_name: artist.trim(),
            album_name: album.trim(),
            duration: duration_ms as f64 / 1000.0,
            lyricsfile: &lyricsfile,
        })
        .send()
        .await
        .map_err(|error| format!("No se pudo conectar con LRCLIB: {error}"))?;

    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response.text().await.unwrap_or_default();
    Err(format!("LRCLIB rechazó la letra ({status}): {}", body.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solved_nonce_meets_the_target() {
        let target = decode_hex("00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF").unwrap();
        let nonce = solve_challenge("abc", &target);
        let hash = Sha256::digest(format!("abc{nonce}").as_bytes());
        assert!(hash.as_slice() <= target.as_slice());
    }
}
