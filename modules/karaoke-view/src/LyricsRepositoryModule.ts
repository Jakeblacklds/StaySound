import { requireNativeModule } from 'expo-modules-core';
import type { LyricsJSON } from './KaraokeView.types';

export interface NativeLyricsRecord {
  canonicalKey: string;
  payloadJson: string;
  updatedAt?: string | null;
}

interface NativeLyricsRepositoryModule {
  normalizeKeyPart(value: string): string;
  canonicalKey(songTitle: string, artist: string): string;
  getLyrics(songTitle: string, artist: string): Promise<NativeLyricsRecord | null>;
  forceRefreshLyrics(songTitle: string, artist: string): Promise<NativeLyricsRecord | null>;
  getLrcLibLyrics(songTitle: string, artist: string, durationSec?: number): Promise<string | null>;
}

const NativeModule = requireNativeModule<NativeLyricsRepositoryModule>('KaraokeView');

export function normalizeLyricsKeyPart(value: string): string {
  return NativeModule.normalizeKeyPart(value);
}

export function createCanonicalLyricsKey(songTitle: string, artist: string): string {
  return NativeModule.canonicalKey(songTitle, artist);
}

function parsePayload(payloadJson: string): LyricsJSON | null {
  try {
    return JSON.parse(payloadJson) as LyricsJSON;
  } catch {
    return null;
  }
}

export async function getLyrics(
  songTitle: string,
  artist: string,
): Promise<{ payload: LyricsJSON; canonicalKey: string; updatedAt?: string | null } | null> {
  const result = await NativeModule.getLyrics(songTitle, artist);
  if (!result) return null;

  const payload = parsePayload(result.payloadJson);
  if (!payload) return null;

  return {
    payload,
    canonicalKey: result.canonicalKey,
    updatedAt: result.updatedAt,
  };
}

export async function forceRefreshLyrics(
  songTitle: string,
  artist: string,
): Promise<{ payload: LyricsJSON; canonicalKey: string; updatedAt?: string | null } | null> {
  const result = await NativeModule.forceRefreshLyrics(songTitle, artist);
  if (!result) return null;

  const payload = parsePayload(result.payloadJson);
  if (!payload) return null;

  return {
    payload,
    canonicalKey: result.canonicalKey,
    updatedAt: result.updatedAt,
  };
}

export async function getLrcLibLyrics(
  songTitle: string,
  artist: string,
  durationSec?: number,
): Promise<LyricsJSON | null> {
  const jsonStr = await NativeModule.getLrcLibLyrics(songTitle, artist, durationSec);
  if (!jsonStr) return null;
  return parsePayload(jsonStr);
}
