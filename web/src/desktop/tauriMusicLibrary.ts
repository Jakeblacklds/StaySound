import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export type NativeMusicFile = {
  path: string;
  relativePath: string;
  name: string;
  size: number;
  lastModified: number;
  mimeType: string;
};

export function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function pickDesktopMusicFolder(): Promise<string | null> {
  if (!isTauriDesktop()) return null;
  const selected = await open({
    directory: true,
    multiple: false,
    recursive: true,
    title: 'Selecciona tu carpeta de música',
  });
  if (typeof selected !== 'string') return null;
  return invoke<string>('remember_music_folder', { path: selected });
}

export async function getDesktopMusicFolder(): Promise<string | null> {
  if (!isTauriDesktop()) return null;
  return invoke<string | null>('get_music_folder');
}

export async function scanDesktopMusicFolder(): Promise<NativeMusicFile[]> {
  if (!isTauriDesktop()) return [];
  return invoke<NativeMusicFile[]>('scan_music_folder');
}

export async function readDesktopMusicFile(path: string): Promise<Uint8Array> {
  const response = await invoke<ArrayBuffer | Uint8Array | number[]>('read_music_file', { path });
  if (response instanceof Uint8Array) return response;
  if (response instanceof ArrayBuffer) return new Uint8Array(response);
  return new Uint8Array(response);
}

export async function fetchDesktopTidalArtwork(url: string): Promise<Uint8Array> {
  const response = await invoke<ArrayBuffer | Uint8Array | number[]>('fetch_tidal_artwork', { url });
  if (response instanceof Uint8Array) return response;
  if (response instanceof ArrayBuffer) return new Uint8Array(response);
  return new Uint8Array(response);
}

export async function searchDesktopTidalCatalog(kind: 'tracks' | 'artists' | 'albums' | 'playlists', query: string): Promise<{ items?: unknown[] }> {
  return invoke<{ items?: unknown[] }>('search_tidal_catalog', { kind, query });
}

export async function ensureDesktopSoulseekBridge(): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  return invoke<boolean>('ensure_soulseek_bridge');
}

export function desktopMusicFileUrl(path: string): string {
  return convertFileSrc(path);
}

export interface AlacMigration {
  /** converted · renamed (an MP4 named .flac) · trashed-empty (no audio) · skipped */
  outcome: 'converted' | 'renamed' | 'trashed-empty' | 'skipped';
  newPath: string | null;
  reason: string | null;
}

/**
 * Converts one FLAC of the library to ALAC, verifies the audio is identical,
 * moves its generated lyrics and stems along, and sends the FLAC to the Trash.
 */
export async function migrateDesktopFlacToAlac(path: string): Promise<AlacMigration> {
  return invoke<AlacMigration>('migrate_flac_to_alac', { path });
}

/**
 * A copy of the file that seeks exactly, for formats WKWebView seeks by
 * estimate (FLAC). Null when the original is already exact.
 */
export async function desktopPrecisePlaybackUrl(path: string): Promise<string | null> {
  const precise = await invoke<string | null>('precise_playback_path', { path });
  return precise ? convertFileSrc(precise) : null;
}

/**
 * Read-only TIDAL catalog routes (search, artist, album) proxied by the native
 * side, which keeps one cached catalog token for the whole session. The Rust
 * command allowlists the paths, so this can't be used as a general proxy.
 */
export async function tidalCatalogRequest<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const stringParams = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  return invoke<T>('tidal_catalog_request', { path, params: stringParams });
}
