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

export async function ensureDesktopSoulseekBridge(): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  return invoke<boolean>('ensure_soulseek_bridge');
}

export function desktopMusicFileUrl(path: string): string {
  return convertFileSrc(path);
}
