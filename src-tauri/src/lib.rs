mod alac;
mod karaoke;
mod lrclib;
mod music_library;
mod playback;

use std::{
    net::{SocketAddr, TcpStream},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_shell::{process::CommandChild, ShellExt};

struct SoulseekBridge(Mutex<Option<CommandChild>>);

fn soulseek_bridge_is_listening() -> bool {
    // Debe coincidir con el puerto real del sidecar (STAYSOUND_SOULSEEK_BRIDGE_PORT,
    // 4317 por defecto). Si se comprueba otro puerto, ensure_soulseek_bridge mata
    // un bridge sano y se pierden los jobs de descarga en curso.
    let address = SocketAddr::from(([127, 0, 0, 1], 4317));
    TcpStream::connect_timeout(&address, Duration::from_millis(120)).is_ok()
}

#[tauri::command]
fn ensure_soulseek_bridge(
    app: tauri::AppHandle,
    bridge: tauri::State<'_, SoulseekBridge>,
) -> Result<bool, String> {
    if soulseek_bridge_is_listening() {
        return Ok(true);
    }

    let mut child_slot = bridge
        .0
        .lock()
        .map_err(|_| "No se pudo bloquear el estado del bridge".to_string())?;
    if let Some(previous) = child_slot.take() {
        let _ = previous.kill();
    }
    let (_events, child) = app
        .shell()
        .sidecar("staysound-soulseek-bridge")
        .map_err(|error| format!("No se encontró el sidecar Soulseek: {error}"))?
        .spawn()
        .map_err(|error| format!("No se pudo iniciar el sidecar Soulseek: {error}"))?;
    *child_slot = Some(child);
    drop(child_slot);

    for _ in 0..25 {
        if soulseek_bridge_is_listening() {
            return Ok(true);
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("El sidecar arrancó, pero no abrió el puerto 4317".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // AppKit-only crate, so it can't be in the cross-platform builder chain — see the
    // macOS-gated dependency in Cargo.toml.
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_macos_refresh_rate::init());

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let (_events, child) = app.shell().sidecar("staysound-soulseek-bridge")?.spawn()?;
            app.manage(SoulseekBridge(Mutex::new(Some(child))));
            app.manage(music_library::initialize(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            karaoke::karaoke_capabilities,
            karaoke::save_gemini_api_key,
            karaoke::install_demucs_runtime,
            karaoke::install_local_lyrics_runtime,
            karaoke::prepare_karaoke_stems,
            karaoke::cached_karaoke_stems,
            playback::precise_playback_path,
            alac::migrate_flac_to_alac,
            karaoke::transcribe_karaoke_vocals,
            karaoke::save_local_generated_lyrics,
            karaoke::persist_local_generated_lyrics,
            karaoke::load_local_generated_lyrics,
            lrclib::publish_lrclib_lyricsfile,
            karaoke::classify_karaoke_genre,
            music_library::remember_music_folder,
            music_library::get_music_folder,
            music_library::scan_music_folder,
            music_library::read_music_file,
            music_library::fetch_tidal_artwork,
            music_library::search_tidal_catalog,
            music_library::tidal_catalog_request,
            music_library::cache_animated_artwork,
            ensure_soulseek_bridge,
        ])
        .build(tauri::generate_context!())
        .expect("error while building StaySound");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let bridge = app_handle.state::<SoulseekBridge>();
            if let Ok(mut child) = bridge.0.lock() {
                if let Some(child) = child.take() {
                    let _ = child.kill();
                }
            };
        }
    });
}
