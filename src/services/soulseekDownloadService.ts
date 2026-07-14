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

function ensureNativeAvailable() {
  if (Platform.OS !== 'android') {
    throw new Error('Soulseek nativo solo esta disponible en Android.');
  }

  if (!isSoulseekNativeAvailable()) {
    throw new Error('El modulo nativo Soulseek no esta disponible en esta build. Reinstala el dev build de Android.');
  }
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

async function searchRankedMatchesForTrack(
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
    const matches = await searchNativeMatches(query, signal).catch((error: unknown) => {
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
  const inferred = inferTrackTextFromMatch(match, {
    title: tidalTrack.title,
    artist: tidalTrack.artist,
  });
  const normalizedExtension = normalizeExtension(extension);
  const quality =
    normalizedExtension === 'flac' || normalizedExtension === 'wav'
      ? (tidalTrack.quality || 'LOSSLESS')
      : 'HIGH';

  return {
    id: `tidal_${tidalTrack.id}`,
    uri,
    title: inferred.title || tidalTrack.title,
    artist: inferred.artist || tidalTrack.artist,
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
    message.includes('connection reset') ||
    message.includes('connection closed') ||
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
    raw: match,
  };
}

async function searchNativeMatches(
  query: string,
  signal?: AbortSignal,
): Promise<SoulseekTrackMatch[]> {
  ensureNativeAvailable();
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
    const matches = await searchNativeMatches(`${baseQuery} ${format}`, signal).catch((error: unknown) => {
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

  ensureNativeAvailable();
  ensureNotAborted(options.signal);

  const extension = getMatchExtension(match);
  await ensureDirectoryExists(SOULSEEK_DOWNLOADS_DIR);

  const filename = `${sanitizeFileSegment(tidalTrack.artist)} - ${sanitizeFileSegment(tidalTrack.title)}.${extension}`;
  const outputUri = `${SOULSEEK_DOWNLOADS_DIR}${filename}`;
  const existing = await FileSystem.getInfoAsync(outputUri);
  if (existing.exists) {
    await FileSystem.deleteAsync(outputUri, { idempotent: true });
  }

  const nativeConfig = await getSoulseekNativeConfigAsync();
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
    } satisfies SoulseekNativeMatch;

  options.onProgress?.(0.1);
  const unbindAbort = bindAbort(options.signal);

  try {
    ensureNotAborted(options.signal);

    const outputPath = normalizeFileUriToPath(outputUri);
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

    options.onProgress?.(0.95);
    ensureNotAborted(options.signal);

    const savedUri = normalizeNativePathToUri(nativeResult.path || outputPath);

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
