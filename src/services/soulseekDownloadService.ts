import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  cancelSoulseekNativeOperations,
  downloadSoulseekNativeFile,
  isSoulseekNativeAvailable,
  type SoulseekNativeConfig,
  type SoulseekNativeMatch,
  searchSoulseekNative,
} from 'soulseek-native';

import { TidalQuality, TidalTrack, Track } from '../types/audio';
import { FileSystemStorage } from './storage';
import { isValidAudioFile } from './tidalService';

const SOULSEEK_DOWNLOADS_DIR = `${FileSystem.documentDirectory ?? ''}StaySound/Soulseek/`;
const SOULSEEK_SERVICE_LOG = '[SoulseekService]';

type SoulseekRuntimeConfig = SoulseekNativeConfig & {
  searchTimeoutMs: number;
  maxResults: number;
};

type SoulseekStoredCredentials = {
  username: string;
  password: string;
};

type SoulseekBackend = 'native' | 'bridge';

const SOULSEEK_CREDENTIALS_STORAGE_KEY = 'soulseek-native-credentials';
let soulseekCredentialsCache: SoulseekStoredCredentials | null = null;

export type SoulseekTrackMatch = {
  id?: string;
  username: string;
  filename: string;
  size?: number;
  extension?: string;
  format?: string;
  codec?: string;
  bitRate?: number;
  sampleRate?: number;
  bitDepth?: number;
  durationMs?: number;
  slotsFree?: boolean;
  queueLength?: number;
  speed?: number;
  host?: string;
  port?: number;
  downloadUrl?: string;
  raw?: unknown;
};

export type SoulseekSearchResult = {
  track: TidalTrack;
  match: SoulseekTrackMatch;
};

type SoulseekDownloadOptions = {
  allowCompressedFallback?: boolean;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
};

const PEER_RETRY_LIMIT = 6;
const MIN_SOULSEEK_MATCH_SCORE = 68;
// Soulseek peers appear and disappear quickly. Avoid retrying stale users.
const SOULSEEK_MATCH_CACHE_TTL_MS = 30 * 1000;
const soulseekTrackMatchCache = new Map<string, {
  expiresAt: number;
  promise: Promise<SoulseekTrackMatch[]>;
}>();

export class SoulseekCompressedFallbackError extends Error {
  match: SoulseekTrackMatch;

  constructor(match: SoulseekTrackMatch) {
    super('No hay FLAC disponible. Descargar en calidad comprimida.');
    this.name = 'SoulseekCompressedFallbackError';
    this.match = match;
  }
}

function getExtraConfig() {
  return (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<string, any>;
}

function normalizeCredentialField(value: string): string {
  return value.trim();
}

async function readStoredSoulseekCredentials(): Promise<SoulseekStoredCredentials | null> {
  if (soulseekCredentialsCache) return soulseekCredentialsCache;

  try {
    const raw = await FileSystemStorage.getItem(SOULSEEK_CREDENTIALS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SoulseekStoredCredentials>;
    const username = normalizeCredentialField(parsed.username ?? '');
    const password = normalizeCredentialField(parsed.password ?? '');
    if (!username || !password) return null;
    soulseekCredentialsCache = { username, password };
    return soulseekCredentialsCache;
  } catch {
    return null;
  }
}

export async function getSoulseekCredentials(): Promise<SoulseekStoredCredentials | null> {
  return readStoredSoulseekCredentials();
}

export async function setSoulseekCredentials(username: string, password: string): Promise<void> {
  const normalizedUsername = normalizeCredentialField(username);
  const normalizedPassword = normalizeCredentialField(password);

  if (!normalizedUsername || !normalizedPassword) {
    throw new Error('Usuario y password son obligatorios.');
  }

  const payload: SoulseekStoredCredentials = {
    username: normalizedUsername,
    password: normalizedPassword,
  };

  await FileSystemStorage.setItem(SOULSEEK_CREDENTIALS_STORAGE_KEY, JSON.stringify(payload));
  soulseekCredentialsCache = payload;
}

function mapNativeConfig(raw: unknown): SoulseekRuntimeConfig {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const username = typeof source.username === 'string' ? source.username.trim() : '';
  const password = typeof source.password === 'string' ? source.password.trim() : '';

  if (!username || !password) {
    throw new Error('Configura SOULSEEK_USERNAME y SOULSEEK_PASSWORD en app.config.js para usar Soulseek nativo.');
  }

  const toInt = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  };

  const serverHost = typeof source.serverHost === 'string' && source.serverHost.trim()
    ? source.serverHost.trim()
    : 'server.slsknet.org';

  return {
    username,
    password,
    serverHost,
    serverPort: Math.min(65535, Math.max(1, toInt(source.serverPort, 2242))),
    listenPort: Math.min(65535, Math.max(0, toInt(source.listenPort, 2234))),
    clientVersion: Math.min(9999, Math.max(1, toInt(source.clientVersion, 160))),
    searchTimeoutMs: Math.min(30_000, Math.max(2_500, toInt(source.searchTimeoutMs, 9_000))),
    maxResults: Math.min(40, Math.max(1, toInt(source.maxResults, 24))),
  };
}

function getSoulseekNativeConfig(): SoulseekRuntimeConfig {
  const extra = getExtraConfig();
  return mapNativeConfig(extra.soulseek);
}

function getSoulseekBridgeUrl(): string | null {
  const extra = getExtraConfig();
  const soulseek = (extra.soulseek && typeof extra.soulseek === 'object')
    ? extra.soulseek as Record<string, unknown>
    : {};
  const rawUrl = typeof soulseek.bridgeUrl === 'string' ? soulseek.bridgeUrl.trim() : '';
  return rawUrl ? rawUrl.replace(/\/+$/, '') : null;
}

async function getSoulseekNativeConfigAsync(): Promise<SoulseekRuntimeConfig> {
  const extra = getExtraConfig();
  const staticConfig = (extra.soulseek && typeof extra.soulseek === 'object')
    ? extra.soulseek as Record<string, unknown>
    : {};

  const stored = await readStoredSoulseekCredentials();
  if (stored) {
    return mapNativeConfig({
      ...staticConfig,
      username: stored.username,
      password: stored.password,
    });
  }

  const staticUsername = typeof staticConfig.username === 'string' ? staticConfig.username.trim() : '';
  const staticPassword = typeof staticConfig.password === 'string' ? staticConfig.password.trim() : '';

  if (staticUsername && staticPassword) {
    return getSoulseekNativeConfig();
  }

  throw new Error('Inicia sesion en la pestaña Soulseek con tu usuario y password.');
}

function getSoulseekBackend(): SoulseekBackend {
  if (Platform.OS === 'android' && isSoulseekNativeAvailable()) return 'native';
  if (getSoulseekBridgeUrl()) return 'bridge';

  if (Platform.OS === 'ios') {
    throw new Error('Configura EXPO_PUBLIC_SOULSEEK_BRIDGE_URL para descargar desde Soulseek en iOS.');
  }

  throw new Error('El motor Soulseek no esta disponible en esta build y no hay un bridge configurado.');
}

function ensureNotAborted(signal?: AbortSignal, message = 'Descarga cancelada') {
  if (signal?.aborted) {
    throw new Error(message);
  }
}

function bindAbort(signal?: AbortSignal): () => void {
  if (!signal) return () => {};

  const onAbort = () => {
    void cancelSoulseekNativeOperations();
  };

  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

function wantsLossless(quality: TidalQuality): boolean {
  return quality === 'LOSSLESS' || quality === 'HI_RES_LOSSLESS';
}

function normalizeExtension(value?: string): string {
  const normalized = (value ?? '').trim().toLowerCase().replace(/^\./, '');
  if (normalized === 'mpeg') return 'mp3';
  if (normalized === 'aac') return 'm4a';
  return normalized;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripFileExtension(value: string): string {
  return value.replace(/\.[a-z0-9]+$/i, '');
}

function splitSoulseekPath(filename: string): string[] {
  return filename
    .replace(/\//g, '\\')
    .split('\\')
    .map(part => normalizeWhitespace(part))
    .filter(Boolean);
}

function pickLeafName(filename: string): string {
  const segments = splitSoulseekPath(filename);
  if (segments.length === 0) return normalizeWhitespace(filename);
  return segments[segments.length - 1];
}

function isLikelyTrackNumberPrefix(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return /^(\+)?\d{1,3}$/.test(normalized) || /^(track|trk)\s*\d{1,3}$/.test(normalized);
}

function cleanSoulseekTitle(value: string): string {
  return normalizeWhitespace(
    stripFileExtension(value)
      .replace(/^[@#]+/g, '')
      .replace(/[_]+/g, ' ')
      .replace(/^\++\s*/, '')
      .replace(/^\d{1,3}\s*[-._)\]]\s*/, '')
      .replace(/^(track|trk)\s*\d{1,3}\s*[-._)\]]\s*/i, ''),
  );
}

function isGenericFolderName(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return true;
  return [
    'music',
    'musica',
    'downloads',
    'download',
    'soulseek downloads',
    'soulseek complete',
    'complete',
    'shared',
    'shares',
  ].includes(normalized);
}

function pickArtistFromPath(filename: string): string {
  const segments = splitSoulseekPath(filename);
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    const candidate = normalizeWhitespace(segments[i]);
    if (!candidate || isGenericFolderName(candidate)) continue;
    if (candidate.startsWith('@@')) continue;
    return candidate;
  }
  return '';
}

function parseArtistAndTitleFromLeaf(leaf: string): { title: string; artist: string } {
  const cleaned = cleanSoulseekTitle(leaf);
  if (!cleaned) return { title: '', artist: '' };

  const parts = cleaned.split(/\s+-\s+/);
  if (parts.length < 2) {
    return { title: cleaned, artist: '' };
  }

  const first = normalizeWhitespace(parts.shift() ?? '');
  const rest = normalizeWhitespace(parts.join(' - '));

  if (!rest) {
    return { title: cleaned, artist: '' };
  }

  if (isLikelyTrackNumberPrefix(first)) {
    return { title: rest, artist: '' };
  }

  return { title: rest, artist: first };
}

function getMatchExtension(match: SoulseekTrackMatch): string {
  const fromExtension = normalizeExtension(match.extension || match.format || '');
  if (fromExtension) return fromExtension;

  const filenameMatch = match.filename.match(/\.([a-z0-9]+)$/i);
  return filenameMatch ? normalizeExtension(filenameMatch[1]) : '';
}

function isLosslessMatch(match: SoulseekTrackMatch): boolean {
  const extension = getMatchExtension(match);
  return extension === 'flac';
}

function isMp3Match(match: SoulseekTrackMatch): boolean {
  return getMatchExtension(match) === 'mp3';
}

function isSupportedSoulseekFormat(match: SoulseekTrackMatch): boolean {
  const extension = getMatchExtension(match);
  return extension === 'flac' || extension === 'mp3';
}

function isCompatibleSoulseekFormat(
  match: SoulseekTrackMatch,
  qualityPreference: TidalQuality,
  allowCompressedFallback = false,
): boolean {
  if (!isSupportedSoulseekFormat(match)) return false;
  if (wantsLossless(qualityPreference)) {
    return isLosslessMatch(match) || (allowCompressedFallback && isMp3Match(match));
  }
  return isMp3Match(match);
}

function sanitizeFileSegment(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'track';
}

function parseSoulseekQuery(query: string): { title: string; artist: string } {
  const trimmed = normalizeWhitespace(query);
  if (!trimmed) return { title: '', artist: '' };

  const parts = trimmed.split(/\s+-\s+/);
  if (parts.length >= 2) {
    const artist = normalizeWhitespace(parts.shift() ?? '');
    const title = normalizeWhitespace(parts.join(' - '));
    return { title, artist };
  }

  return { title: trimmed, artist: '' };
}

function normalizeComparableText(value: string): string {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function comparableTokens(value: string): Set<string> {
  return new Set(
    normalizeComparableText(value)
      .split(' ')
      .filter(token => token.length >= 2),
  );
}

function tokenOverlapScore(source: string, candidate: string, weight: number): number {
  const sourceTokens = comparableTokens(source);
  const candidateTokens = comparableTokens(candidate);
  if (sourceTokens.size === 0 || candidateTokens.size === 0) return 0;

  let shared = 0;
  for (const token of sourceTokens) {
    if (candidateTokens.has(token)) shared += 1;
  }

  return Math.round((shared / sourceTokens.size) * weight);
}

function includesVersionTerm(value: string, terms: string[]): boolean {
  const normalized = ` ${normalizeComparableText(value)} `;
  return terms.some(term => normalized.includes(` ${term} `));
}

const VERSION_TERMS = [
  'live',
  'remix',
  'instrumental',
  'karaoke',
  'cover',
  'acoustic',
  'sped up',
  'slowed',
  'nightcore',
  'radio edit',
  'edit',
  'clean',
];

function hasForeignVersionTerm(source: TidalTrack, match: SoulseekTrackMatch): boolean {
  const sourceText = `${source.title} ${source.album ?? ''}`;
  const matchText = `${match.filename} ${inferTrackTextFromMatch(match, {
    title: source.title,
    artist: source.artist,
  }).title}`;

  return VERSION_TERMS.some(term => includesVersionTerm(matchText, [term]) && !includesVersionTerm(sourceText, [term]));
}

function scoreSoulseekMatch(
  tidalTrack: TidalTrack,
  match: SoulseekTrackMatch,
  qualityPreference: TidalQuality,
  allowCompressedFallback = false,
): number {
  if (!isCompatibleSoulseekFormat(match, qualityPreference, allowCompressedFallback)) return -1_000;

  const inferred = inferTrackTextFromMatch(match, {
    title: tidalTrack.title,
    artist: tidalTrack.artist,
  });
  const sourceTitle = normalizeComparableText(tidalTrack.title);
  const sourceArtist = normalizeComparableText(tidalTrack.artist);
  const candidateTitle = normalizeComparableText(inferred.title);
  const candidateArtist = normalizeComparableText(inferred.artist);
  const filenameText = normalizeComparableText(stripFileExtension(pickLeafName(match.filename || '')));
  let score = 0;

  if (sourceTitle && candidateTitle) {
    if (sourceTitle === candidateTitle) score += 58;
    else if (candidateTitle.includes(sourceTitle) || sourceTitle.includes(candidateTitle)) score += 30;
    score += tokenOverlapScore(sourceTitle, `${candidateTitle} ${filenameText}`, 28);
  }

  if (sourceArtist && candidateArtist) {
    if (sourceArtist === candidateArtist) score += 42;
    else if (candidateArtist.includes(sourceArtist) || sourceArtist.includes(candidateArtist)) score += 22;
    score += tokenOverlapScore(sourceArtist, `${candidateArtist} ${match.filename}`, 20);
  }

  if (tidalTrack.durationMs > 0 && (match.durationMs ?? 0) > 0) {
    const delta = Math.abs(tidalTrack.durationMs - (match.durationMs ?? 0));
    if (delta <= 2_500) score += 20;
    else if (delta <= 7_000) score += 10;
    else if (delta >= 25_000) score -= 70;
    else if (delta >= 12_000) score -= 30;
  }

  if (isLosslessMatch(match)) score += wantsLossless(qualityPreference) ? 28 : -10;
  if (isMp3Match(match)) score += wantsLossless(qualityPreference) ? -18 : 24;
  if ((match.size ?? 0) > 0) score += 4;
  if (hasForeignVersionTerm(tidalTrack, match)) score -= 55;

  // Prefer peers that can start immediately and finish sooner. These values
  // come from the Soulseek search reply; Monochrome remains catalog-only.
  if (match.slotsFree === true) score += 90;
  else if (match.slotsFree === false) score -= 45;

  if (typeof match.queueLength === 'number') {
    if (match.queueLength <= 0) score += 18;
    else score -= Math.min(45, match.queueLength * 6);
  }

  if ((match.speed ?? 0) > 0) {
    const speed = match.speed ?? 0;
    const estimatedSeconds = (match.size ?? 0) > 0
      ? (match.size ?? 0) / speed
      : Number.POSITIVE_INFINITY;
    if (estimatedSeconds <= 30) score += 55;
    else if (estimatedSeconds <= 90) score += 35;
    else if (estimatedSeconds <= 240) score += 15;
    score += Math.min(25, Math.log10(Math.max(1, speed)) * 4);
  }

  return score;
}

function rankSoulseekMatches(
  tidalTrack: TidalTrack,
  matches: SoulseekTrackMatch[],
  qualityPreference: TidalQuality,
  allowCompressedFallback = false,
): SoulseekTrackMatch[] {
  return matches
    .map(match => ({ match, score: scoreSoulseekMatch(tidalTrack, match, qualityPreference, allowCompressedFallback) }))
    .filter(entry => entry.score >= MIN_SOULSEEK_MATCH_SCORE)
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.match);
}

function buildTrackSearchQueries(
  tidalTrack: TidalTrack,
  qualityPreference: TidalQuality,
  allowCompressedFallback = false,
): string[] {
  const base = `${tidalTrack.artist} - ${tidalTrack.title}`.trim();
  const plain = normalizeWhitespace(base || `${tidalTrack.artist} ${tidalTrack.title}`);
  const formats = wantsLossless(qualityPreference)
    ? (allowCompressedFallback ? ['flac', 'mp3'] : ['flac'])
    : ['mp3'];
  const queries = formats.flatMap(format => [
    `${plain} ${format}`,
    `${tidalTrack.artist} ${tidalTrack.title} ${format}`.trim(),
  ]);
  queries.push(plain);

  return Array.from(new Set(queries.map(normalizeWhitespace).filter(Boolean)));
}

async function searchRankedMatchesForTrackUncached(
  tidalTrack: TidalTrack,
  qualityPreference: TidalQuality,
  allowCompressedFallback = false,
  signal?: AbortSignal,
): Promise<SoulseekTrackMatch[]> {
  const collected: SoulseekTrackMatch[] = [];
  console.log(`${SOULSEEK_SERVICE_LOG} ranked search start`, {
    id: tidalTrack.id,
    title: tidalTrack.title,
    artist: tidalTrack.artist,
    qualityPreference,
    allowCompressedFallback,
  });
  for (const query of buildTrackSearchQueries(tidalTrack, qualityPreference, allowCompressedFallback)) {
    ensureNotAborted(signal, 'Busqueda cancelada');
    console.log(`${SOULSEEK_SERVICE_LOG} query`, {
      query,
      qualityPreference,
      allowCompressedFallback,
    });
    const matches = await searchSoulseekMatches(query, signal).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${SOULSEEK_SERVICE_LOG} query error`, {
        query,
        message,
      });
      if (canContinueAfterSearchError(error)) return [] as SoulseekTrackMatch[];
      throw error;
    });
    console.log(`${SOULSEEK_SERVICE_LOG} query result`, {
      query,
      matches: matches.length,
    });
    collected.push(...matches);
    const ranked = rankSoulseekMatches(
      tidalTrack,
      dedupeMatches(collected),
      qualityPreference,
      allowCompressedFallback,
    );
    console.log(`${SOULSEEK_SERVICE_LOG} ranked candidates`, {
      query,
      collected: collected.length,
      ranked: ranked.length,
      top: ranked[0] ? {
        username: ranked[0].username,
        filename: ranked[0].filename,
        extension: getMatchExtension(ranked[0]),
        durationMs: ranked[0].durationMs,
      } : null,
    });
    if (ranked.length >= PEER_RETRY_LIMIT) return ranked.slice(0, PEER_RETRY_LIMIT);
  }

  const finalRanked = rankSoulseekMatches(
    tidalTrack,
    dedupeMatches(collected),
    qualityPreference,
    allowCompressedFallback,
  ).slice(0, PEER_RETRY_LIMIT);
  console.log(`${SOULSEEK_SERVICE_LOG} ranked search final`, {
    collected: collected.length,
    ranked: finalRanked.length,
  });
  return finalRanked;
}

function getSoulseekTrackCacheKey(
  tidalTrack: TidalTrack,
  qualityPreference: TidalQuality,
  allowCompressedFallback: boolean,
): string {
  return [
    normalizeComparableText(tidalTrack.artist),
    normalizeComparableText(tidalTrack.title),
    tidalTrack.durationMs || 0,
    qualityPreference,
    allowCompressedFallback ? 'compressed' : 'strict',
  ].join('|');
}

async function searchRankedMatchesForTrack(
  tidalTrack: TidalTrack,
  qualityPreference: TidalQuality,
  allowCompressedFallback = false,
  signal?: AbortSignal,
): Promise<SoulseekTrackMatch[]> {
  ensureNotAborted(signal, 'Busqueda cancelada');
  const key = getSoulseekTrackCacheKey(tidalTrack, qualityPreference, allowCompressedFallback);
  const cached = soulseekTrackMatchCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    const matches = await cached.promise;
    ensureNotAborted(signal, 'Busqueda cancelada');
    return matches;
  }
  if (cached) soulseekTrackMatchCache.delete(key);

  const promise = searchRankedMatchesForTrackUncached(
    tidalTrack,
    qualityPreference,
    allowCompressedFallback,
    signal,
  ).catch(error => {
    soulseekTrackMatchCache.delete(key);
    throw error;
  });

  soulseekTrackMatchCache.set(key, {
    expiresAt: Date.now() + SOULSEEK_MATCH_CACHE_TTL_MS,
    promise,
  });
  return promise;
}

export function prefetchSoulseekTrack(
  tidalTrack: TidalTrack,
  qualityPreference: TidalQuality,
): void {
  void searchRankedMatchesForTrack(
    tidalTrack,
    qualityPreference,
    wantsLossless(qualityPreference),
  ).catch(() => undefined);
}

function inferTrackTextFromMatch(
  match: SoulseekTrackMatch,
  fallback: { title: string; artist: string },
): { title: string; artist: string } {
  const leaf = pickLeafName(match.filename || '');
  const fromLeaf = parseArtistAndTitleFromLeaf(leaf);
  const folderArtist = pickArtistFromPath(match.filename || '');
  const fallbackArtist = normalizeWhitespace(fallback.artist || '');
  const fallbackTitle = normalizeWhitespace(fallback.title || '');

  const title = normalizeWhitespace(fromLeaf.title || cleanSoulseekTitle(leaf) || fallbackTitle || 'Track');
  if (!title) {
    return {
      title: fallbackTitle || 'Track',
      artist: fallbackArtist || 'Soulseek',
    };
  }

  let artist = normalizeWhitespace(fromLeaf.artist || '');

  if (!artist || isLikelyTrackNumberPrefix(artist)) {
    artist = fallbackArtist || folderArtist || normalizeWhitespace(match.username || '') || 'Soulseek';
  }

  if (artist.startsWith('@@')) {
    artist = fallbackArtist || folderArtist || 'Soulseek';
  }

  return {
    title,
    artist,
  };
}

function toVirtualTrackId(match: SoulseekTrackMatch): number {
  const seed = `${match.id ?? ''}|${match.username}|${match.filename}|${match.size ?? 0}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }

  const normalized = Math.abs(hash) || 1;
  return -normalized;
}

function toSoulseekVirtualTrack(
  match: SoulseekTrackMatch,
  fallback: { title: string; artist: string },
  qualityPreference: TidalQuality,
): TidalTrack {
  const extension = getMatchExtension(match);
  const inferred = inferTrackTextFromMatch(match, fallback);
  const hiRes = (match.sampleRate ?? 0) >= 88_200 || (match.bitDepth ?? 0) >= 24;
  const quality = isLosslessMatch(match)
    ? (hiRes ? 'HI_RES_LOSSLESS' : 'LOSSLESS')
    : (qualityPreference === 'LOW' ? 'LOW' : 'HIGH');

  return {
    id: toVirtualTrackId(match),
    title: inferred.title || fallback.title || 'Track',
    artist: inferred.artist || fallback.artist || 'Soulseek',
    album: '',
    durationMs: match.durationMs ?? 0,
    quality,
    isHiRes: hiRes,
    trackNumber: undefined,
    year: undefined,
    codec: match.codec ?? extension.toUpperCase(),
    sampleRate: match.sampleRate,
    bitDepth: match.bitDepth,
  };
}

async function ensureDirectoryExists(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
  }
}

function toLibraryTrack(
  tidalTrack: TidalTrack,
  match: SoulseekTrackMatch,
  uri: string,
  extension: string,
): Track {
  const normalizedExtension = normalizeExtension(extension);
  const quality =
    normalizedExtension === 'flac' || normalizedExtension === 'wav'
      ? (tidalTrack.quality || 'LOSSLESS')
      : 'HIGH';

  return {
    id: `tidal_${tidalTrack.id}`,
    uri,
    // TIDAL is the canonical catalog. Soulseek only supplies the audio file and
    // technical properties; peer filenames/tags must not replace catalog data.
    title: tidalTrack.title,
    artist: tidalTrack.artist,
    artistId: tidalTrack.artistId ? String(tidalTrack.artistId) : undefined,
    album: tidalTrack.album,
    duration: tidalTrack.durationMs,
    artwork: tidalTrack.artworkUrl,
    trackNumber: tidalTrack.trackNumber,
    year: tidalTrack.year,
    format: normalizedExtension.toUpperCase(),
    codec: match.codec ?? normalizedExtension,
    sampleRate: match.sampleRate ?? tidalTrack.sampleRate,
    bitDepth: match.bitDepth ?? tidalTrack.bitDepth,
    quality,
    source: 'tidal',
    tidalId: tidalTrack.id,
    tidalAlbumId: tidalTrack.albumId,
    isrc: tidalTrack.isrc,
    dateAdded: Date.now(),
  };
}

function normalizeFileUriToPath(fileUri: string): string {
  if (fileUri.startsWith('file://')) {
    return decodeURIComponent(fileUri.replace(/^file:\/\//, ''));
  }
  return decodeURIComponent(fileUri);
}

function normalizeSoulseekErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).toLowerCase();
}

function isSoulseekTimeoutError(error: unknown): boolean {
  const message = normalizeSoulseekErrorMessage(error);
  return (
    message.includes('sockettimeoutexception') ||
    message.includes('read timed out') ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
}

function canContinueAfterSearchError(error: unknown): boolean {
  const message = normalizeSoulseekErrorMessage(error);
  return message.includes('tardo demasiado') || message.includes('timed out') || message.includes('timeout');
}

function isRetryablePeerError(error: unknown): boolean {
  const message = normalizeSoulseekErrorMessage(error);
  return (
    message.includes('socket cerrado') ||
    message.includes('peer cerro') ||
    // Node's Soulseek client reports a peer-side reset as `read ECONNRESET`.
    // Treat it the same as the more human-readable reset messages so the
    // caller can try the next verified match instead of failing the download.
    message.includes('econnreset') ||
    message.includes('connection reset') ||
    message.includes('connection closed') ||
    message.includes('connection refused') ||
    message.includes('broken pipe') ||
    message.includes('user not exist') ||
    message.includes('canal p directo ni indirecto') ||
    message.includes('queueupload') ||
    message.includes('no pudo iniciar la descarga') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('queued') ||
    message.includes('cola')
  );
}

function dedupeMatches(matches: SoulseekTrackMatch[]): SoulseekTrackMatch[] {
  const seen = new Set<string>();
  const output: SoulseekTrackMatch[] = [];

  for (const match of matches) {
    const key = `${match.username}::${match.filename}::${match.size ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(match);
  }

  return output;
}

async function buildFallbackMatches(
  tidalTrack: TidalTrack,
  baseMatch: SoulseekTrackMatch,
  qualityPreference: TidalQuality,
  signal?: AbortSignal,
  allowCompressedFallback = false,
): Promise<SoulseekTrackMatch[]> {
  const extras = await searchRankedMatchesForTrack(
    tidalTrack,
    qualityPreference,
    allowCompressedFallback,
    signal,
  ).catch((error: unknown) => {
    if (canContinueAfterSearchError(error)) return [] as SoulseekTrackMatch[];
    throw error;
  });
  const merged = dedupeMatches([baseMatch, ...extras]);
  const ranked = rankSoulseekMatches(tidalTrack, merged, qualityPreference, allowCompressedFallback);

  if (ranked.length > 0) {
    return ranked.slice(0, PEER_RETRY_LIMIT);
  }

  return isSupportedSoulseekFormat(baseMatch) ? [baseMatch] : [];
}

function normalizeNativePathToUri(path: string): string {
  if (path.startsWith('file://')) return path;
  const normalized = path.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

function startSoulseekFileProgressPolling(
  fileUri: string,
  expectedSize: number,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): () => void {
  if (!onProgress) return () => {};

  let stopped = false;
  let inFlight = false;
  let lastProgress = 0.1;
  const startedAt = Date.now();

  const tick = async () => {
    if (stopped || signal?.aborted || inFlight) return;

    inFlight = true;
    try {
      const info = await FileSystem.getInfoAsync(fileUri);
      if (!info.exists || !info.size || info.size <= 0) return;

      const bytesProgress = expectedSize > 0
        ? Math.min(info.size / expectedSize, 1)
        : Math.min(Math.log10(info.size + 1) / 9, 1);
      const elapsedProgress = Math.min((Date.now() - startedAt) / 90_000, 0.18);
      const nextProgress = Math.min(
        0.94,
        Math.max(lastProgress, 0.1 + (bytesProgress * 0.82) + elapsedProgress),
      );

      if (nextProgress > lastProgress + 0.005) {
        lastProgress = nextProgress;
        onProgress(nextProgress);
      }
    } catch {
      // The file may not exist until the peer starts sending bytes.
    } finally {
      inFlight = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, 700);
  void tick();

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

function fromNativeMatch(match: SoulseekNativeMatch): SoulseekTrackMatch {
  return {
    username: match.username,
    filename: match.filename,
    size: typeof match.size === 'number' ? match.size : undefined,
    extension: match.extension,
    format: match.format,
    codec: match.codec,
    bitRate: match.bitRate,
    sampleRate: match.sampleRate,
    bitDepth: match.bitDepth,
    durationMs: match.durationMs,
    slotsFree: match.slotsFree,
    queueLength: match.queueLength,
    speed: match.speed,
    host: match.host,
    port: match.port,
    raw: match,
  };
}

function fromBridgeMatch(raw: unknown): SoulseekTrackMatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const match = raw as Record<string, unknown>;
  const username = typeof match.username === 'string' ? match.username.trim() : '';
  const filename = typeof match.filename === 'string' ? match.filename.trim() : '';
  if (!username || !filename) return null;

  const optionalNumber = (value: unknown): number | undefined => (
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  );

  return {
    id: typeof match.id === 'string' ? match.id : undefined,
    username,
    filename,
    size: optionalNumber(match.size),
    extension: typeof match.extension === 'string' ? match.extension : undefined,
    format: typeof match.format === 'string' ? match.format : undefined,
    codec: typeof match.codec === 'string' ? match.codec : undefined,
    bitRate: optionalNumber(match.bitRate),
    sampleRate: optionalNumber(match.sampleRate),
    bitDepth: optionalNumber(match.bitDepth),
    durationMs: optionalNumber(match.durationMs),
    slotsFree: typeof match.slotsFree === 'boolean'
      ? match.slotsFree
      : (typeof match.slots === 'boolean' ? match.slots : undefined),
    queueLength: optionalNumber(match.queueLength),
    speed: optionalNumber(match.speed),
    host: typeof match.host === 'string' ? match.host : undefined,
    port: optionalNumber(match.port),
    raw,
  };
}

async function readSoulseekBridgeResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error?: unknown }).error ?? '')
      : '';
    throw new Error(error || `Soulseek bridge respondio ${response.status}.`);
  }

  return payload as T;
}

async function searchBridgeMatches(
  query: string,
  signal?: AbortSignal,
): Promise<SoulseekTrackMatch[]> {
  const bridgeUrl = getSoulseekBridgeUrl();
  if (!bridgeUrl) throw new Error('No hay un bridge Soulseek configurado.');
  const config = await getSoulseekNativeConfigAsync();
  ensureNotAborted(signal, 'Busqueda cancelada');

  const response = await fetch(`${bridgeUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      timeoutMs: config.searchTimeoutMs,
      maxResults: config.maxResults,
      credentials: { username: config.username, password: config.password },
    }),
    signal,
  });
  const payload = await readSoulseekBridgeResponse<{ results?: unknown[] }>(response);
  ensureNotAborted(signal, 'Busqueda cancelada');
  return (payload.results ?? [])
    .map(fromBridgeMatch)
    .filter((match): match is SoulseekTrackMatch => !!match);
}

async function searchNativeMatches(
  query: string,
  signal?: AbortSignal,
): Promise<SoulseekTrackMatch[]> {
  ensureNotAborted(signal, 'Busqueda cancelada');

  const config = await getSoulseekNativeConfigAsync();
  const unbindAbort = bindAbort(signal);
  console.log(`${SOULSEEK_SERVICE_LOG} native search start`, {
    query,
    timeoutMs: config.searchTimeoutMs,
    maxResults: config.maxResults,
  });

  try {
    const matches = await searchSoulseekNative(config, query, config.searchTimeoutMs, config.maxResults);
    ensureNotAborted(signal, 'Busqueda cancelada');
    console.log(`${SOULSEEK_SERVICE_LOG} native search done`, {
      query,
      matches: matches.length,
    });
    return matches.map(fromNativeMatch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toUpperCase().includes('INVALIDPASS')) {
      throw new Error('Soulseek rechazo el login: usuario o password incorrectos.');
    }
    if (message.toLowerCase().includes('cancel')) {
      throw new Error('Busqueda cancelada');
    }
    if (isSoulseekTimeoutError(error)) {
      throw new Error('Soulseek tardo demasiado en responder. Intenta otra vez con una busqueda mas especifica.');
    }
    throw new Error(`Soulseek nativo fallo: ${message}`);
  } finally {
    unbindAbort();
  }
}

async function searchSoulseekMatches(
  query: string,
  signal?: AbortSignal,
): Promise<SoulseekTrackMatch[]> {
  return getSoulseekBackend() === 'native'
    ? searchNativeMatches(query, signal)
    : searchBridgeMatches(query, signal);
}

export async function searchSoulseekTrack(
  tidalTrack: TidalTrack,
  qualityPreference: TidalQuality,
  signal?: AbortSignal,
): Promise<SoulseekTrackMatch> {
  const matches = await searchRankedMatchesForTrack(
    tidalTrack,
    qualityPreference,
    wantsLossless(qualityPreference),
    signal,
  );

  if (!matches.length) {
    const format = wantsLossless(qualityPreference) ? 'FLAC' : 'MP3';
    throw new Error(`No hay una fuente ${format} confiable en Soulseek para esta cancion.`);
  }

  return matches[0];
}

export async function searchSoulseekTracksByQuery(
  query: string,
  qualityPreference: TidalQuality,
  signal?: AbortSignal,
): Promise<SoulseekSearchResult[]> {
  const parsed = parseSoulseekQuery(query);
  if (!parsed.title && !parsed.artist) return [];

  const baseQuery = `${parsed.artist ? `${parsed.artist} - ` : ''}${parsed.title || query.trim()}`.trim();
  const formats = wantsLossless(qualityPreference) ? ['flac', 'mp3'] : ['mp3', 'flac'];
  const collected: SoulseekTrackMatch[] = [];

  for (const format of formats) {
    const matches = await searchSoulseekMatches(`${baseQuery} ${format}`, signal).catch((error: unknown) => {
      if (canContinueAfterSearchError(error)) return [] as SoulseekTrackMatch[];
      throw error;
    });
    collected.push(...matches.filter(isSupportedSoulseekFormat));
  }

  return dedupeMatches(collected).map(match => ({
    match,
    track: toSoulseekVirtualTrack(match, parsed, qualityPreference),
  }));
}

async function downloadSoulseekBridgeFile(
  match: SoulseekTrackMatch,
  filename: string,
  outputUri: string,
  options: SoulseekDownloadOptions,
): Promise<string> {
  const bridgeUrl = getSoulseekBridgeUrl();
  if (!bridgeUrl) throw new Error('No hay un bridge Soulseek configurado.');
  const config = await getSoulseekNativeConfigAsync();
  const rawMatch = match.raw && typeof match.raw === 'object'
    ? match.raw as Record<string, unknown>
    : {};
  const bridgeMatch = {
    ...rawMatch,
    username: match.username,
    filename: match.filename,
    size: match.size,
    extension: match.extension,
    bitRate: match.bitRate,
  };

  ensureNotAborted(options.signal);
  const response = await fetch(`${bridgeUrl}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      match: bridgeMatch,
      filename,
      credentials: { username: config.username, password: config.password },
    }),
    signal: options.signal,
  });
  const payload = await readSoulseekBridgeResponse<{ url?: string }>(response);
  if (!payload.url) throw new Error('El bridge Soulseek no devolvio el archivo descargado.');
  ensureNotAborted(options.signal);

  const payloadUrl = new URL(payload.url, `${bridgeUrl}/`);
  const bridgeOrigin = new URL(bridgeUrl).origin;
  const fileUrl = payloadUrl.pathname.startsWith('/files/')
    ? `${bridgeOrigin}${payloadUrl.pathname}${payloadUrl.search}`
    : payloadUrl.toString();
  const task = FileSystem.createDownloadResumable(
    fileUrl,
    outputUri,
    {},
    progress => {
      if (!progress.totalBytesExpectedToWrite) return;
      const fraction = progress.totalBytesWritten / progress.totalBytesExpectedToWrite;
      options.onProgress?.(Math.min(0.95, 0.12 + (fraction * 0.83)));
    },
  );
  const cancelDownload = () => {
    void task.cancelAsync();
  };
  options.signal?.addEventListener('abort', cancelDownload, { once: true });

  try {
    const result = await task.downloadAsync();
    ensureNotAborted(options.signal);
    if (!result?.uri) throw new Error('El bridge Soulseek no pudo transferir el archivo al dispositivo.');
    return result.uri;
  } finally {
    options.signal?.removeEventListener('abort', cancelDownload);
  }
}

async function downloadSoulseekTrackWithMatch(
  tidalTrack: TidalTrack,
  qualityPreference: TidalQuality,
  match: SoulseekTrackMatch,
  options: SoulseekDownloadOptions = {},
): Promise<Track> {
  if (!isSupportedSoulseekFormat(match)) {
    throw new Error('Soulseek solo descargara FLAC o MP3.');
  }

  if (wantsLossless(qualityPreference) && !isLosslessMatch(match) && !options.allowCompressedFallback) {
    throw new SoulseekCompressedFallbackError(match);
  }

  if (!wantsLossless(qualityPreference) && !isMp3Match(match)) {
    throw new Error('La descarga Soulseek en esta calidad solo acepta MP3.');
  }

  const backend = getSoulseekBackend();
  ensureNotAborted(options.signal);

  const extension = getMatchExtension(match);
  await ensureDirectoryExists(SOULSEEK_DOWNLOADS_DIR);

  const filename = `${sanitizeFileSegment(tidalTrack.artist)} - ${sanitizeFileSegment(tidalTrack.title)}.${extension}`;
  const outputUri = `${SOULSEEK_DOWNLOADS_DIR}${filename}`;
  const existing = await FileSystem.getInfoAsync(outputUri);
  if (existing.exists) {
    await FileSystem.deleteAsync(outputUri, { idempotent: true });
  }

  const nativeMatch = (match.raw && typeof match.raw === 'object')
    ? (match.raw as SoulseekNativeMatch)
    : {
      username: match.username,
      filename: match.filename,
      size: match.size ?? 0,
      extension: match.extension,
      format: match.format,
      codec: match.codec,
      bitRate: match.bitRate,
      sampleRate: match.sampleRate,
      bitDepth: match.bitDepth,
      durationMs: match.durationMs,
      slotsFree: match.slotsFree,
      queueLength: match.queueLength,
      speed: match.speed,
      host: match.host,
      port: match.port,
    } satisfies SoulseekNativeMatch;

  options.onProgress?.(0.1);
  const unbindAbort = backend === 'native' ? bindAbort(options.signal) : () => {};

  try {
    ensureNotAborted(options.signal);

    const outputPath = normalizeFileUriToPath(outputUri);
    let savedUri: string;

    if (backend === 'native') {
      const nativeConfig = await getSoulseekNativeConfigAsync();
      const expectedSize = nativeMatch.size || match.size || 0;
      const stopProgressPolling = startSoulseekFileProgressPolling(
        outputUri,
        expectedSize,
        options.onProgress,
        options.signal,
      );
      let nativeResult: Awaited<ReturnType<typeof downloadSoulseekNativeFile>>;

      try {
        nativeResult = await downloadSoulseekNativeFile(nativeConfig, nativeMatch, outputPath);
      } finally {
        stopProgressPolling();
      }
      savedUri = normalizeNativePathToUri(nativeResult.path || outputPath);
    } else {
      savedUri = await downloadSoulseekBridgeFile(match, filename, outputUri, options);
    }

    options.onProgress?.(0.95);
    ensureNotAborted(options.signal);

    const info = await FileSystem.getInfoAsync(savedUri);
    if (!info.exists || !info.size || info.size <= 0) {
      throw new Error('Soulseek devolvio un archivo vacio.');
    }

    if (!(await isValidAudioFile(savedUri, extension))) {
      await FileSystem.deleteAsync(savedUri, { idempotent: true });
      throw new Error(`Soulseek devolvio un archivo ${extension.toUpperCase()} invalido.`);
    }

    options.onProgress?.(1);
    return toLibraryTrack(tidalTrack, match, savedUri, extension);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toUpperCase().includes('INVALIDPASS')) {
      throw new Error('Soulseek rechazo el login: usuario o password incorrectos.');
    }
    if (message.toLowerCase().includes('queued') || message.toLowerCase().includes('cola')) {
      throw new Error('El archivo quedo en cola del peer. Espera un poco y vuelve a intentar.');
    }
    if (message.toLowerCase().includes('socket cerrado')) {
      throw new Error('El peer cerro la conexion durante la descarga. Reintenta con otra fuente.');
    }
    if (message.toLowerCase().includes('cancel')) {
      throw new Error('Descarga cancelada');
    }
    throw error;
  } finally {
    unbindAbort();
  }
}

export async function downloadSoulseekTrackFromMatch(
  tidalTrack: TidalTrack,
  qualityPreference: TidalQuality,
  match: SoulseekTrackMatch,
  options: SoulseekDownloadOptions = {},
): Promise<Track> {
  options.onProgress?.(0.02);
  let lastError: unknown;

  // Download the selected match directly; the fallback search below is only
  // worth its cost (extra logins + full search timeouts) after this peer fails.
  if (isSupportedSoulseekFormat(match)) {
    try {
      return await downloadSoulseekTrackWithMatch(tidalTrack, qualityPreference, match, options);
    } catch (error) {
      if (!isRetryablePeerError(error)) throw error;
      lastError = error;
      console.log(`${SOULSEEK_SERVICE_LOG} direct match failed, searching fallbacks`, {
        username: match.username,
        filename: match.filename,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const triedKey = `${match.username}::${match.filename}::${match.size ?? 0}`;
  const candidates = (await buildFallbackMatches(
    tidalTrack,
    match,
    qualityPreference,
    options.signal,
    options.allowCompressedFallback,
  )).filter(candidate => `${candidate.username}::${candidate.filename}::${candidate.size ?? 0}` !== triedKey);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      const progressBase = 0.02 + (index / Math.max(candidates.length, 1)) * 0.18;
      options.onProgress?.(progressBase);
      return await downloadSoulseekTrackWithMatch(tidalTrack, qualityPreference, candidate, options);
    } catch (error) {
      lastError = error;
      if (!isRetryablePeerError(error) || index >= candidates.length - 1) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('No se pudo descargar desde los peers probados.');
}

export async function downloadSoulseekTrack(
  tidalTrack: TidalTrack,
  qualityPreference: TidalQuality,
  options: SoulseekDownloadOptions = {},
): Promise<Track> {
  options.onProgress?.(0.02);
  console.log(`${SOULSEEK_SERVICE_LOG} download track start`, {
    id: tidalTrack.id,
    title: tidalTrack.title,
    artist: tidalTrack.artist,
    qualityPreference,
    allowCompressedFallback: Boolean(options.allowCompressedFallback),
  });
  const match = await searchSoulseekTrack(tidalTrack, qualityPreference, options.signal);
  console.log(`${SOULSEEK_SERVICE_LOG} selected match`, {
    username: match.username,
    filename: match.filename,
    extension: getMatchExtension(match),
    durationMs: match.durationMs,
    size: match.size,
  });
  return downloadSoulseekTrackFromMatch(tidalTrack, qualityPreference, match, options);
}
