import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Track } from '@staysound/types/audio';
import { isTauriDesktop } from '../desktop/tauriMusicLibrary';
import type { CanvasUiEffectName } from './CanvasUiEffectStage';

export type KaraokeGenre = 'pop' | 'rock' | 'reggaeton' | 'folk' | 'disco' | 'electronic';

export interface KaraokeCapabilities {
  demucsReady: boolean;
  transcriptionReady: boolean;
  alignmentReady: boolean;
  geminiConfigured: boolean;
  pythonVersion: string | null;
}

export interface KaraokeProgress {
  stage: 'runtime' | 'separation' | string;
  progress: number;
  detail: string;
}

export interface KaraokeStems {
  instrumentalPath: string;
  vocalsPath: string;
  cached: boolean;
  model: string;
}

export type LocalLyricsLanguage = 'auto' | 'en-es' | 'es' | 'en';

export interface LyricsLanguageHint {
  text: string;
  startMs?: number;
  endMs?: number;
}

export interface GeneratedLyricsWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  syllables?: GeneratedLyricsSyllable[];
}

export interface GeneratedLyricsSyllable {
  text: string;
  startMs: number;
  endMs: number;
  phones: string[];
  sustained?: boolean;
  timingConfidence?: number;
  notes?: GeneratedLyricsNote[];
}

export interface GeneratedLyricsNote {
  startMs: number;
  endMs: number;
  pitchMidi: number;
  confidence: number;
}

export interface GeneratedLyricsLine {
  text: string;
  startMs: number;
  endMs: number;
  /** Per-line language used by the bilingual MFA pass. */
  language?: 'en' | 'es' | null;
  words: GeneratedLyricsWord[];
}

export interface GeneratedLyrics {
  language: string;
  model: string;
  alignment?: string | null;
  textSource?: string | null;
  textMatch?: number | null;
  acousticModel?: string | null;
  lines: GeneratedLyricsLine[];
}

/**
 * Apple/BiniLyrics ELRC usually animates a whole word and only exposes
 * internal syllable spans when a genuinely long, melodic word benefits from
 * them. Keep the phonetic detail in JSON, but feed the renderer the same
 * restrained shape so short words do not flicker syllable by syllable.
 */
export function generatedWordDisplayParts(word: GeneratedLyricsWord): GeneratedLyricsSyllable[] {
  const syllables = word.syllables ?? [];
  const wordDuration = word.endMs - word.startMs;
  const hasReliableMelodicParts = wordDuration >= 1_100
    && syllables.length > 1
    && syllables.every(syllable => (
      syllable.startMs >= word.startMs
      && syllable.endMs <= word.endMs
      && syllable.endMs - syllable.startMs >= 80
      && syllable.phones.length > 0
    ));
  if (hasReliableMelodicParts) return syllables;
  return [{
    text: word.text,
    startMs: word.startMs,
    endMs: word.endMs,
    phones: syllables.flatMap(syllable => syllable.phones),
  }];
}

export interface KaraokeGenreResult {
  genre: KaraokeGenre;
  confidence: number;
  reason: string;
  source: 'gemini' | 'local' | string;
  visualPlan: KaraokeVisualPlan;
}

export interface KaraokeVisualPlan {
  intro: CanvasUiEffectName;
  verse: CanvasUiEffectName;
  chorus: CanvasUiEffectName;
  bridge: CanvasUiEffectName;
  outro: CanvasUiEffectName;
}

type DesktopTrack = Track & {
  nativePath?: string;
};

const KARAOKE_DIRECTION_CACHE_KEY = 'staysound_karaoke_direction_v1';
const CANVAS_UI_EFFECTS = new Set<CanvasUiEffectName>([
  'clouds',
  'liquid',
  'blaze',
  'grid',
  'droplets',
  'laser',
]);

function directionCacheKey(track: Track): string {
  return [track.artist, track.title, track.album]
    .map(value => (value ?? '').trim().toLowerCase())
    .join('::');
}

function hasValidVisualPlan(result: KaraokeGenreResult): boolean {
  const plan = result.visualPlan;
  return Boolean(
    plan
    && CANVAS_UI_EFFECTS.has(plan.intro)
    && CANVAS_UI_EFFECTS.has(plan.verse)
    && CANVAS_UI_EFFECTS.has(plan.chorus)
    && CANVAS_UI_EFFECTS.has(plan.bridge)
    && CANVAS_UI_EFFECTS.has(plan.outro),
  );
}

function readCachedDirection(track: Track): KaraokeGenreResult | null {
  try {
    const cache = JSON.parse(
      window.localStorage.getItem(KARAOKE_DIRECTION_CACHE_KEY) ?? '{}',
    ) as Record<string, KaraokeGenreResult>;
    const result = cache[directionCacheKey(track)];
    return result?.source === 'gemini' && hasValidVisualPlan(result) ? result : null;
  } catch {
    return null;
  }
}

function cacheDirection(track: Track, result: KaraokeGenreResult): void {
  if (result.source !== 'gemini' || !hasValidVisualPlan(result)) return;
  try {
    const cache = JSON.parse(
      window.localStorage.getItem(KARAOKE_DIRECTION_CACHE_KEY) ?? '{}',
    ) as Record<string, KaraokeGenreResult>;
    cache[directionCacheKey(track)] = result;
    window.localStorage.setItem(KARAOKE_DIRECTION_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // The direction still works for the current session if persistence fails.
  }
}

export function getKaraokeTrackPath(track: Track): string | null {
  const nativePath = (track as DesktopTrack).nativePath?.trim();
  if (nativePath) return nativePath;

  try {
    const url = new URL(track.uri);
    if (url.protocol !== 'asset:') return null;
    const decoded = decodeURIComponent(url.pathname);
    return decoded.startsWith('/') ? decoded : `/${decoded}`;
  } catch {
    return null;
  }
}

export async function getKaraokeCapabilities(): Promise<KaraokeCapabilities> {
  if (!isTauriDesktop()) {
    return {
      demucsReady: false,
      transcriptionReady: false,
      alignmentReady: false,
      geminiConfigured: false,
      pythonVersion: null,
    };
  }
  return invoke<KaraokeCapabilities>('karaoke_capabilities');
}

export async function saveGeminiApiKey(apiKey: string): Promise<boolean> {
  return invoke<boolean>('save_gemini_api_key', { apiKey });
}

export async function installDemucsRuntime(): Promise<KaraokeCapabilities> {
  return invoke<KaraokeCapabilities>('install_demucs_runtime');
}

export async function installLocalLyricsRuntime(): Promise<KaraokeCapabilities> {
  return invoke<KaraokeCapabilities>('install_local_lyrics_runtime');
}

export async function prepareKaraokeStems(path: string): Promise<KaraokeStems> {
  return invoke<KaraokeStems>('prepare_karaoke_stems', { path });
}

export async function transcribeKaraokeVocals(
  path: string,
  language: LocalLyricsLanguage,
  languageHints: LyricsLanguageHint[] = [],
): Promise<GeneratedLyrics> {
  return invoke<GeneratedLyrics>('transcribe_karaoke_vocals', { path, language, languageHints });
}

export async function saveLocalGeneratedLyrics(
  path: string,
  lyrics: GeneratedLyrics,
): Promise<GeneratedLyrics> {
  return invoke<GeneratedLyrics>('save_local_generated_lyrics', { path, lyrics });
}

export async function persistLocalGeneratedLyrics(
  path: string,
  lyrics: GeneratedLyrics,
): Promise<GeneratedLyrics> {
  return invoke<GeneratedLyrics>('persist_local_generated_lyrics', { path, lyrics });
}

export async function loadLocalGeneratedLyrics(path: string): Promise<GeneratedLyrics | null> {
  return invoke<GeneratedLyrics | null>('load_local_generated_lyrics', { path });
}

export async function classifyKaraokeGenre(track: Track): Promise<KaraokeGenreResult> {
  const cached = readCachedDirection(track);
  if (cached) return cached;
  const result = await invoke<KaraokeGenreResult>('classify_karaoke_genre', {
    title: track.title,
    artist: track.artist,
    album: track.album,
    metadataGenre: track.genre ?? null,
  });
  cacheDirection(track, result);
  return result;
}

export async function listenToKaraokeProgress(
  listener: (progress: KaraokeProgress) => void,
): Promise<UnlistenFn> {
  return listen<KaraokeProgress>('karaoke://progress', event => listener(event.payload));
}

export function karaokeStemUrl(path: string): string {
  return convertFileSrc(path);
}
