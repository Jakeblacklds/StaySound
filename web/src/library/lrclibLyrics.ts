/** Native LRCLIB lookup. Kept outside <am-lyrics> so StaySound can validate
 * the recording before accepting the first search result. */

const LRCLIB_API = 'https://lrclib.net/api';
const LRCLIB_CLIENT = 'StaySound v1.0 (https://github.com/Jakeblacklds/StaySound)';
const REQUEST_TIMEOUT_MS = 8_000;

let blockedUntil = 0;

export interface LrclibLookupMetadata {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
}

interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LrclibSyllable {
  text: string;
  part?: boolean;
  timestamp?: number;
  endtime?: number;
}

export interface LrclibLine {
  text: LrclibSyllable[];
  timestamp: number;
  endtime: number;
  isWordSynced: boolean;
  background: false;
  backgroundText: [];
  oppositeTurn: false;
}

export interface LrclibSource {
  lines: LrclibLine[];
  source: 'LRCLIB';
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bigramSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;
  if (left.length === 1 || right.length === 1) return left === right ? 1 : 0;
  const remaining = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const pair = left.slice(index, index + 2);
    remaining.set(pair, (remaining.get(pair) ?? 0) + 1);
  }
  let matches = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const pair = right.slice(index, index + 2);
    const count = remaining.get(pair) ?? 0;
    if (count > 0) {
      matches += 1;
      remaining.set(pair, count - 1);
    }
  }
  return (2 * matches) / (left.length + right.length - 2);
}

function metadataSimilarity(leftValue: string, rightValue: string): number {
  const left = normalize(leftValue);
  const right = normalize(rightValue);
  if (left === right) return left ? 1 : 0;
  if (!left || !right) return 0;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  const contained = longer.includes(shorter) && shorter.length / longer.length >= 0.6
    ? 0.9 * (shorter.length / longer.length) + 0.1
    : 0;

  const leftTokens = new Set(left.split(' ').filter(token => !['and', 'the'].includes(token)));
  const rightTokens = new Set(right.split(' ').filter(token => !['and', 'the'].includes(token)));
  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
  const tokenDice = leftTokens.size + rightTokens.size > 0
    ? (2 * intersection) / (leftTokens.size + rightTokens.size)
    : 0;

  return Math.max(contained, tokenDice, bigramSimilarity(left, right));
}

function durationSimilarity(expectedMs: number | undefined, actualSeconds: number): number | null {
  if (!expectedMs || expectedMs <= 0 || !Number.isFinite(actualSeconds)) return null;
  const difference = Math.abs(expectedMs / 1000 - actualSeconds);
  if (difference <= 2) return 1;
  if (difference <= 5) return 0.82;
  if (difference <= 10) return 0.45;
  if (difference <= 15) return 0.15;
  return -1;
}

function recordScore(record: LrclibRecord, metadata: LrclibLookupMetadata): number {
  const title = metadataSimilarity(metadata.title, record.trackName);
  const artist = metadataSimilarity(metadata.artist, record.artistName);
  const duration = durationSimilarity(metadata.durationMs, record.duration);
  if (title < 0.68 || artist < 0.55 || duration === -1) return -1;

  const parts = [
    { value: title, weight: 0.48 },
    { value: artist, weight: 0.34 },
  ];
  if (metadata.album && record.albumName) {
    parts.push({ value: metadataSimilarity(metadata.album, record.albumName), weight: 0.08 });
  }
  if (duration !== null) parts.push({ value: duration, weight: 0.12 });

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const weighted = parts.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight;
  return weighted + (record.syncedLyrics?.trim() ? 0.025 : 0);
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 30_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : 30_000;
}

async function requestJson<T>(url: URL): Promise<T | null> {
  if (Date.now() < blockedUntil) return null;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Lrclib-Client': LRCLIB_CLIENT,
      },
      signal: controller.signal,
    });
    if (response.status === 429) {
      blockedUntil = Date.now() + parseRetryAfter(response.headers.get('Retry-After'));
      return null;
    }
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function timestampMs(minutes: string, seconds: string, fraction?: string): number {
  const fractionMs = !fraction
    ? 0
    : fraction.length === 1
      ? Number(fraction) * 100
      : fraction.length === 2
        ? Number(fraction) * 10
        : Number(fraction.slice(0, 3));
  return Number(minutes) * 60_000 + Number(seconds) * 1000 + fractionMs;
}

const LRC_TIMESTAMP = /\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g;
const ENHANCED_TIMESTAMP = /<(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?>/g;

interface LrcEvent {
  timestamp: number;
  text: string;
}

function enhancedParts(text: string, lineStart: number, lineEnd: number): LrclibSyllable[] | null {
  const matches = [...text.matchAll(ENHANCED_TIMESTAMP)];
  if (matches.length < 2) return null;
  const parts: LrclibSyllable[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = timestampMs(match[1], match[2], match[3]);
    const end = index + 1 < matches.length
      ? timestampMs(matches[index + 1][1], matches[index + 1][2], matches[index + 1][3])
      : lineEnd;
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd = matches[index + 1]?.index ?? text.length;
    const content = text.slice(contentStart, contentEnd);
    if (!content || start < lineStart - 250 || start >= lineEnd) continue;
    parts.push({
      text: content,
      part: index < matches.length - 1,
      timestamp: Math.max(lineStart, start),
      endtime: Math.max(start + 30, Math.min(lineEnd, end)),
    });
  }
  if (parts.length < 2 || !parts.map(part => part.text).join('').trim()) return null;
  if (parts.at(-1)) parts.at(-1)!.part = false;
  return parts;
}

export function parseLrclibSyncedLyrics(value: string, durationMs?: number): LrclibLine[] {
  const offsetMatch = value.match(/^\s*\[offset:([+-]?\d+)\]\s*$/im);
  const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
  const events: LrcEvent[] = [];

  for (const rawLine of value.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(LRC_TIMESTAMP)];
    if (!matches.length) continue;
    const text = rawLine.slice((matches.at(-1)?.index ?? 0) + matches.at(-1)![0].length).trimEnd();
    for (const match of matches) {
      events.push({
        timestamp: Math.max(0, timestampMs(match[1], match[2], match[3]) + offset),
        text,
      });
    }
  }

  events.sort((left, right) => left.timestamp - right.timestamp);
  const unique = events.filter((event, index) => (
    index === 0 || event.timestamp !== events[index - 1].timestamp || event.text !== events[index - 1].text
  ));
  const lines: LrclibLine[] = [];

  for (let index = 0; index < unique.length; index += 1) {
    const event = unique[index];
    if (!event.text.replace(ENHANCED_TIMESTAMP, '').trim()) continue;
    const nextEvent = unique.slice(index + 1).find(candidate => candidate.timestamp > event.timestamp);
    const naturalEnd = nextEvent?.timestamp
      ?? (durationMs && durationMs > event.timestamp ? durationMs : event.timestamp + 6_000);
    // LRC stores line starts, not ends. Do not keep a line highlighted across
    // a long instrumental gap (or the entire outro) when there is no explicit
    // empty timestamp marking its end.
    const endtime = Math.max(event.timestamp + 80, Math.min(naturalEnd, event.timestamp + 12_000));
    const enhanced = enhancedParts(event.text, event.timestamp, endtime);
    const plainText = event.text.replace(ENHANCED_TIMESTAMP, '');
    lines.push({
      text: enhanced ?? [{
        text: plainText.trim(),
        timestamp: event.timestamp,
        endtime,
      }],
      timestamp: event.timestamp,
      endtime,
      isWordSynced: Boolean(enhanced),
      background: false,
      backgroundText: [],
      oppositeTurn: false,
    });
  }

  return lines;
}

function parsePlainLyrics(value: string): LrclibLine[] {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(text => ({
    text: [{ text }],
    timestamp: 0,
    endtime: 0,
    isWordSynced: false,
    background: false as const,
    backgroundText: [] as [],
    oppositeTurn: false as const,
  }));
}

function sourceFromRecord(record: LrclibRecord, metadata: LrclibLookupMetadata): LrclibSource | null {
  if (record.instrumental) return null;
  const synced = record.syncedLyrics?.trim();
  const plain = record.plainLyrics?.trim();
  let lines = synced ? parseLrclibSyncedLyrics(synced, metadata.durationMs) : [];
  if (!lines.length && plain) lines = parsePlainLyrics(plain);
  return lines.length ? { lines, source: 'LRCLIB' } : null;
}

function exactLookupUrl(metadata: LrclibLookupMetadata): URL | null {
  if (!metadata.album || !metadata.durationMs || metadata.durationMs <= 0) return null;
  const url = new URL(`${LRCLIB_API}/get`);
  url.searchParams.set('track_name', metadata.title);
  url.searchParams.set('artist_name', metadata.artist);
  url.searchParams.set('album_name', metadata.album);
  url.searchParams.set('duration', String(metadata.durationMs / 1000));
  return url;
}

function searchLookupUrl(metadata: LrclibLookupMetadata): URL {
  const url = new URL(`${LRCLIB_API}/search`);
  url.searchParams.set('track_name', metadata.title);
  url.searchParams.set('artist_name', metadata.artist);
  return url;
}

export async function fetchLyricsFromLrclib(
  metadata: LrclibLookupMetadata,
): Promise<LrclibSource | null> {
  const exactUrl = exactLookupUrl(metadata);
  const exact = exactUrl ? await requestJson<LrclibRecord>(exactUrl) : null;
  if (exact?.syncedLyrics?.trim()) {
    const source = sourceFromRecord(exact, metadata);
    if (source) return source;
  }

  // Search only when the exact recording did not provide synchronized lyrics.
  // This keeps normal lookups to one request and avoids hammering the public API.
  const results = await requestJson<LrclibRecord[]>(searchLookupUrl(metadata));
  const candidates = [
    ...(exact ? [exact] : []),
    ...(Array.isArray(results) ? results : []),
  ].filter((record, index, records) => records.findIndex(entry => entry.id === record.id) === index);

  const best = candidates
    .map(record => ({ record, score: recordScore(record, metadata) }))
    .filter(candidate => candidate.score >= 0.72)
    .sort((left, right) => right.score - left.score)[0]?.record;
  return best ? sourceFromRecord(best, metadata) : null;
}
