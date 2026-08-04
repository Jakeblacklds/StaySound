import type { Track } from '@staysound/types/audio';
import {
  generatedWordDisplayParts,
  getKaraokeTrackPath,
  loadLocalGeneratedLyrics,
  type GeneratedLyrics,
} from './karaokeDesktop';

export interface KaraokeWord {
  id: string;
  text: string;
  begin: number;
  end: number;
  background: boolean;
  part?: boolean;
}

export interface KaraokeLine {
  id: string;
  begin: number;
  end: number;
  words: KaraokeWord[];
}

export interface KaraokeStanza {
  id: string;
  begin: number;
  end: number;
  part: string;
  lines: KaraokeLine[];
}

function localGeneratedLyricsToStanzas(lyrics: GeneratedLyrics): KaraokeStanza[] {
  const lines = lyrics.lines
    .filter(line => line.words.length > 0)
    .map((line, lineIndex): KaraokeLine => ({
      id: `local-line-${lineIndex}`,
      begin: line.startMs,
      end: line.endMs,
      words: line.words.flatMap((word, wordIndex) => {
      const syllables = generatedWordDisplayParts(word);
        return syllables.map((syllable, syllableIndex) => ({
          id: `local-line-${lineIndex}-word-${wordIndex}-syllable-${syllableIndex}`,
          text: syllable.text,
          begin: syllable.startMs,
          end: Math.max(syllable.startMs + 30, syllable.endMs),
          background: false,
          part: syllableIndex < syllables.length - 1,
        }));
      }),
    }));
  if (!lines.length) return [];
  return [{
    id: 'local-generated',
    begin: lines[0].begin,
    end: lines.at(-1)?.end ?? lines[0].end,
    part: '',
    lines,
  }];
}

const LYRICS_TIMEOUT_MS = 9_000;
const LYRICS_CACHE_DB_NAME = 'staysound_lyrics_cache_v1';
const LYRICS_CACHE_STORE_NAME = 'ttml';
const LYRICS_CACHE_DB_VERSION = 1;
const LYRICS_TIMING_OFFSETS_KEY = 'staysound_lyrics_timing_offsets_v1';
const MAX_LYRICS_TIMING_OFFSET_MS = 10_000;
let lyricsCacheDbPromise: Promise<IDBDatabase | null> | null = null;

interface LyricsCacheRecord {
  key: string;
  ttml: string;
  savedAt: number;
}

function normalizeLyricsCachePart(value: string | undefined | null): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)|\s*\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLyricsCacheKey(track: Track): string {
  return `${normalizeLyricsCachePart(track.artist)}::${normalizeLyricsCachePart(track.title)}`;
}

function getLyricsCacheDb(): Promise<IDBDatabase | null> {
  if (lyricsCacheDbPromise) return lyricsCacheDbPromise;
  lyricsCacheDbPromise = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(LYRICS_CACHE_DB_NAME, LYRICS_CACHE_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(LYRICS_CACHE_STORE_NAME)) {
        request.result.createObjectStore(LYRICS_CACHE_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return lyricsCacheDbPromise;
}

async function readCachedLyrics(key: string): Promise<string | null> {
  const database = await getLyricsCacheDb();
  if (!database) return null;
  return new Promise(resolve => {
    const transaction = database.transaction(LYRICS_CACHE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(LYRICS_CACHE_STORE_NAME).get(key);
    request.onsuccess = () => {
      const record = request.result as LyricsCacheRecord | undefined;
      resolve(record?.ttml?.trim() || null);
    };
    request.onerror = () => resolve(null);
  });
}

async function writeCachedLyrics(key: string, ttml: string): Promise<void> {
  const database = await getLyricsCacheDb();
  if (!database) return;
  await new Promise<void>(resolve => {
    const transaction = database.transaction(LYRICS_CACHE_STORE_NAME, 'readwrite');
    transaction.objectStore(LYRICS_CACHE_STORE_NAME).put({
      key,
      ttml,
      savedAt: Date.now(),
    } satisfies LyricsCacheRecord);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

function getLyricsTimingKey(track: Track): string {
  return `${track.artist.trim().toLowerCase()}::${track.title.trim().toLowerCase()}`;
}

export function getStoredLyricsTimingOffset(track: Track): number {
  try {
    const offsets = JSON.parse(
      window.localStorage.getItem(LYRICS_TIMING_OFFSETS_KEY) ?? '{}',
    ) as Record<string, number>;
    const offset = offsets[getLyricsTimingKey(track)];
    return Number.isFinite(offset) ? offset : 0;
  } catch {
    return 0;
  }
}

export function setStoredLyricsTimingOffset(track: Track, offsetMs: number): number {
  const clampedOffset = Math.max(
    -MAX_LYRICS_TIMING_OFFSET_MS,
    Math.min(MAX_LYRICS_TIMING_OFFSET_MS, Math.round(offsetMs)),
  );
  try {
    const offsets = JSON.parse(
      window.localStorage.getItem(LYRICS_TIMING_OFFSETS_KEY) ?? '{}',
    ) as Record<string, number>;
    offsets[getLyricsTimingKey(track)] = clampedOffset;
    window.localStorage.setItem(LYRICS_TIMING_OFFSETS_KEY, JSON.stringify(offsets));
  } catch {
    // The caller still keeps the in-memory adjustment for this session.
  }
  return clampedOffset;
}

function parseTtmlTime(value: string | null, fallback = 0): number {
  if (!value) return fallback;
  const parts = value.trim().split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part))) return fallback;
  if (parts.length === 1) return parts[0] * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
}

function elementChildrenByTag(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter(child => child.localName === localName);
}

function isBackgroundVocal(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    const role = current.getAttributeNS('http://www.w3.org/ns/ttml#metadata', 'role')
      ?? current.getAttribute('ttm:role');
    if (role === 'x-bg') return true;
    current = current.parentElement;
  }
  return false;
}

interface TimedSyllable {
  text: string;
  begin: number;
  end: number;
  continuesWord: boolean;
  background: boolean;
}

function getTimedLeafSpans(element: Element): Element[] {
  return Array.from(element.getElementsByTagNameNS('*', 'span'))
    .filter(span => span.hasAttribute('begin'))
    .filter(span => !Array.from(span.getElementsByTagNameNS('*', 'span'))
      .some(child => child !== span && child.hasAttribute('begin')));
}

function readSyllableText(span: Element): string {
  let text = span.textContent ?? '';
  const nextNode = span.nextSibling;
  if (
    nextNode
    && nextNode.nodeType === 3
    && /^\s/.test(nextNode.textContent ?? '')
    && !text.endsWith(' ')
  ) {
    text += ' ';
  }
  return text;
}

function groupSyllablesIntoWords(
  syllables: TimedSyllable[],
  lineIndex: number,
): KaraokeWord[] {
  const words: KaraokeWord[] = [];
  let group: TimedSyllable[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const text = group.map(syllable => syllable.text).join('').replace(/\s+/g, ' ').trim();
    if (text) {
      words.push({
        id: `line-${lineIndex}-word-${words.length}`,
        text,
        begin: group[0].begin,
        end: group.at(-1)?.end ?? group[0].end,
        background: group.every(syllable => syllable.background),
      });
    }
    group = [];
  };

  syllables.forEach((syllable, index) => {
    const previous = group.at(-1);
    if (previous && previous.background !== syllable.background) flush();
    group.push(syllable);
    const next = syllables[index + 1];
    if (
      !next
      || !syllable.continuesWord
      || syllable.background !== next.background
    ) {
      flush();
    }
  });
  flush();
  return words;
}

function parseLine(element: Element, lineIndex: number): KaraokeLine | null {
  const begin = parseTtmlTime(element.getAttribute('begin'));
  const end = parseTtmlTime(element.getAttribute('end'), begin + 2_500);
  const spanElements = getTimedLeafSpans(element);
  const syllables = spanElements.map((span, syllableIndex) => {
    const syllableBegin = parseTtmlTime(span.getAttribute('begin'), begin);
    const nextBegin = spanElements[syllableIndex + 1]
      ? parseTtmlTime(spanElements[syllableIndex + 1].getAttribute('begin'), end)
      : end;
    const syllableEnd = parseTtmlTime(
      span.getAttribute('end'),
      Math.max(syllableBegin + 80, nextBegin),
    );
    const text = readSyllableText(span);
    return {
      text,
      begin: syllableBegin,
      end: syllableEnd,
      continuesWord: !/\s$/.test(text),
      background: isBackgroundVocal(span),
    };
  }).filter(syllable => syllable.text.trim().length > 0);
  const words = groupSyllablesIntoWords(syllables, lineIndex);

  if (words.length === 0) {
    const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!text) return null;
    words.push({
      id: `line-${lineIndex}-word-0`,
      text,
      begin,
      end,
      background: false,
    });
  }

  return {
    id: element.getAttributeNS('http://music.apple.com/lyric-ttml-internal', 'key')
      ?? element.getAttribute('itunes:key')
      ?? `line-${lineIndex}`,
    begin,
    end,
    words,
  };
}

export function parseKaraokeTtml(ttml: string): KaraokeStanza[] {
  const document = new DOMParser().parseFromString(ttml, 'application/xml');
  if (document.querySelector('parsererror')) return [];
  const body = document.getElementsByTagNameNS('*', 'body')[0];
  if (!body) return [];
  const divs = Array.from(body.getElementsByTagNameNS('*', 'div'));
  let lineIndex = 0;

  const stanzas = divs.map((div, stanzaIndex) => {
    const lines = elementChildrenByTag(div, 'p')
      .map(element => parseLine(element, lineIndex++))
      .filter((line): line is KaraokeLine => Boolean(line));
    if (lines.length === 0) return null;
    return {
      id: `stanza-${stanzaIndex}`,
      begin: parseTtmlTime(div.getAttribute('begin'), lines[0].begin),
      end: parseTtmlTime(div.getAttribute('end'), lines.at(-1)?.end ?? lines[0].end),
      part: div.getAttributeNS('http://music.apple.com/lyric-ttml-internal', 'songPart')
        ?? div.getAttribute('itunes:songPart')
        ?? '',
      lines,
    };
  }).filter((stanza): stanza is KaraokeStanza => Boolean(stanza));

  if (stanzas.length > 0) return stanzas;
  const looseLines = Array.from(body.getElementsByTagNameNS('*', 'p'))
    .map(element => parseLine(element, lineIndex++))
    .filter((line): line is KaraokeLine => Boolean(line));
  return looseLines.length > 0
    ? [{
      id: 'stanza-0',
      begin: looseLines[0].begin,
      end: looseLines.at(-1)?.end ?? looseLines[0].end,
      part: '',
      lines: looseLines,
    }]
    : [];
}

export async function fetchKaraokeLyrics(
  track: Track,
  durationMs: number,
  signal?: AbortSignal,
): Promise<KaraokeStanza[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), LYRICS_TIMEOUT_MS);

  try {
    const nativePath = getKaraokeTrackPath(track);
    if (nativePath) {
      const localLyrics = await loadLocalGeneratedLyrics(nativePath).catch(() => null);
      if (localLyrics?.lines?.length) {
        return localGeneratedLyricsToStanzas(localLyrics);
      }
    }

    const cacheKey = getLyricsCacheKey(track);
    const cachedTtml = await readCachedLyrics(cacheKey);
    if (controller.signal.aborted) return [];
    if (cachedTtml) return parseKaraokeTtml(cachedTtml);

    const params = new URLSearchParams({
      track: track.title,
      artist: track.artist,
    });
    if (track.album && !/^unknown/i.test(track.album)) params.set('album', track.album);
    if (durationMs > 0) params.set('duration', String(Math.round(durationMs / 1000)));
    const search = await fetch(`https://lyrics-api.binimum.org/?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!search.ok) return [];
    const payload = await search.json() as {
      results?: Array<{ lyricsUrl?: string }>;
    };
    // Match FullPlayer exactly: both views must use the first compatible TTML,
    // otherwise equally named editions can carry different timestamps.
    const result = payload.results?.find(item => item.lyricsUrl);
    if (!result?.lyricsUrl) return [];
    const response = await fetch(result.lyricsUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/ttml, application/xml, text/xml, */*' },
    });
    if (!response.ok) return [];
    const ttml = await response.text();
    if (!ttml.trim().startsWith('<')) return [];
    await writeCachedLyrics(cacheKey, ttml);
    return parseKaraokeTtml(ttml);
  } catch {
    return [];
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
