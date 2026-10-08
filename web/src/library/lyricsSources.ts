/**
 * Lyric source discovery for the full player.
 *
 * `<am-lyrics>` already queries several providers, but it does so as a chain
 * that stops as soon as one of them answers well enough: BiniLyrics first,
 * Unison only if nothing word-synced came back, KPoe only if there still isn't,
 * LRCLIB/Genius only as last resorts. Every request has an 8s timeout, so a
 * single slow or briefly unavailable provider early in the chain is enough to
 * end the run on a line-synced result — which is why the same song can be
 * word-by-word one day and plain lines the next.
 *
 * This module runs the providers independently, with native lrc.red and LRCLIB
 * clients that validate the recording before accepting a result. It
 * keeps every result as a candidate and caches the set so a track that was
 * resolved well once stays resolved.
 */

import type { Track } from '@staysound/types/audio';
import { useSyncExternalStore } from 'react';
import {
  getKaraokeTrackPath,
  generatedLineLayers,
  generatedWordDisplayParts,
  loadLocalGeneratedLyrics,
  type GeneratedLyrics,
} from '../karaoke/karaokeDesktop';
import {
  readCachedLyrics,
  writeCachedLyrics,
  type CachedLyricsEntry,
} from '../storage/webLyricsCache';
import { fetchLyricsFromLrclib } from './lrclibLyrics';
import { fetchLyricsFromLrcRed } from './lrcRedLyrics';

export type LyricsSyncKind = 'word' | 'line' | 'plain';

/** Only the fields we inspect are typed; the rest is passed back untouched. */
export interface EngineSyllable {
  text?: string;
  part?: boolean;
  timestamp?: number;
  endtime?: number;
}

export interface EngineLine {
  text?: EngineSyllable[];
  timestamp?: number;
  endtime?: number;
  isWordSynced?: boolean;
  background?: boolean;
  backgroundText?: EngineSyllable[];
  oppositeTurn?: boolean;
}

interface EngineSource {
  lines: EngineLine[];
  source: string;
  songwriters?: string;
}

interface EngineMetadata {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
}

export interface LyricsCandidate {
  id: string;
  source: string;
  syncKind: LyricsSyncKind;
  lineCount: number;
  /** First sung line, used to tell near-identical candidates apart. */
  preview: string;
  songwriters?: string;
  lines: EngineLine[];
}

export interface CanonicalLyricsDraft {
  source: string;
  syncKind: LyricsSyncKind;
  phrases: Array<{
    text: string;
    startMs?: number;
    endMs?: number;
  }>;
}

export type LyricsSourcesStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface LyricsSourcesState {
  trackKey: string;
  status: LyricsSourcesStatus;
  candidates: LyricsCandidate[];
  selectedId: string | null;
  /** When the cached set was fetched, for the "en caché" hint. */
  fetchedAt: number | null;
  fromCache: boolean;
  /** True while a candidate is being handed to the element. */
  canSearch: boolean;
}

/**
 * The element's own fetch resets `lyrics` when it starts, so a cached
 * selection can only be applied once that run has settled. Poll rather than
 * hook the internals: `isLoading` is Lit state with no public event.
 */
const APPLY_POLL_MS = 120;
const APPLY_SETTLE_MS = 2_000;
const APPLY_TIMEOUT_MS = 20_000;

/**
 * Applying a candidate is not enough on its own: the element's own provider
 * chain awaits up to five sequential requests with an 8s timeout each and only
 * checks its abort signal once, right after metadata resolution. A chain that
 * was already past that point when we applied keeps running and, when it
 * finishes, overwrites `lyrics`/`availableSources` wholesale — which is how a
 * locally generated word-by-word letter silently reverted to the line-synced
 * or plain fallback the providers happened to return. Hold the selection for
 * longer than that chain can possibly take.
 */
const SELECTION_HOLD_MS = 60_000;
const SELECTION_HOLD_POLL_MS = 200;

/**
 * A plain/line-only response is a fallback, not a durable answer. Providers can
 * be temporarily rate-limited, so retry it on the next session instead of
 * letting (for example) Genius permanently hide word-synchronised lyrics.
 */
function hasWordSyncedCandidate(candidates: LyricsCandidate[]): boolean {
  return candidates.some(candidate => candidate.syncKind === 'word');
}

type AmLyricsElement = HTMLElement & {
  currentTime?: number;
  ttml?: string;
};

/** Runtime view of the private members this module drives. */
type AmLyricsInternals = {
  isLoading?: boolean;
  lyrics?: EngineLine[];
  lyricsSource?: string | null;
  songwriters?: string;
  availableSources?: EngineSource[];
  currentSourceIndex?: number;
  hasFetchedAllProviders?: boolean;
  applySourceAtIndex?: (index: number) => Promise<void>;
  resolveSongMetadata?: () => Promise<{
    metadata?: EngineMetadata;
    catalogIsrc?: string;
  }>;
  requestUpdate?: () => void;
};

type AmLyricsConstructor = {
  parseTTML?: (ttml: string) => { lines: EngineLine[]; songwriters?: string } | null;
  fetchLyricsFromBiniLyrics?: (
    title: string,
    artist: string,
    isrc?: string,
    metadata?: EngineMetadata,
  ) => Promise<EngineSource | null>;
  fetchLyricsFromUnison?: (metadata: EngineMetadata) => Promise<EngineSource | null>;
  fetchLyricsFromYouLyPlus?: (
    title: string,
    artist: string,
    isrc?: string,
    metadata?: EngineMetadata,
    skipBiniCache?: boolean,
  ) => Promise<EngineSource[]>;
  fetchLyricsFromGenius?: (metadata: EngineMetadata) => Promise<EngineSource | null>;
  mergeAndSortSources?: (sources: EngineSource[]) => EngineSource[];
};

export function getLyricsTrackKey(track: Track): string {
  return `${track.artist.trim().toLowerCase()}::${track.title.trim().toLowerCase()}`;
}

export function describeSyncKind(kind: LyricsSyncKind): string {
  if (kind === 'word') return 'Palabra por palabra';
  if (kind === 'line') return 'Por líneas';
  return 'Sin sincronizar';
}

function getEngineClass(): AmLyricsConstructor | null {
  const ctor = typeof customElements !== 'undefined'
    ? customElements.get('am-lyrics')
    : undefined;
  return (ctor as AmLyricsConstructor | undefined) ?? null;
}

function classifySync(lines: EngineLine[]): LyricsSyncKind {
  const isWordSynced = lines.some(
    line => line.isWordSynced || (Array.isArray(line.text) && line.text.length > 1),
  );
  if (isWordSynced) return 'word';

  const isTimed = lines.some(line => (line.timestamp ?? 0) > 0 || (line.endtime ?? 0) > 0);
  return isTimed ? 'line' : 'plain';
}

function buildPreview(lines: EngineLine[]): string {
  for (const line of lines) {
    const text = (line.text ?? []).map(syllable => syllable.text ?? '').join('').trim();
    if (text.length > 1) {
      return text.length > 52 ? `${text.slice(0, 51).trimEnd()}…` : text;
    }
  }
  return '';
}

function lineText(line: EngineLine): string {
  return (line.text ?? []).map(part => part.text ?? '').join('').trim();
}

function removeRepeatedParentheticalEcho(value: string): string {
  const match = value.match(/^(.*?)\s+\(([^()]*)\)\s*$/);
  if (!match) return value;
  const normalize = (text: string) => text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
  const main = normalize(match[1]);
  const echo = normalize(match[2]);
  return echo && main.endsWith(echo) ? match[1].trim() : value;
}

function splitDisplayPhrase(value: string): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= 8 && value.length <= 52) return [value];
  const minimum = Math.max(2, Math.min(4, words.length - 3));
  const maximum = Math.max(minimum, Math.min(words.length - 3, 8));
  const target = Math.min(7, Math.ceil(words.length / 2));
  const preferred: number[] = [];
  for (let index = minimum; index <= maximum; index += 1) {
    const previous = words[index - 1];
    const next = words[index]?.toLowerCase().replace(/[^a-záéíóúüñ]/g, '');
    if (/[,:;.!?…]$/.test(previous) || ['pero', 'porque', 'aunque', 'cuando', 'mientras'].includes(next)) {
      preferred.push(index);
    }
  }
  const splitAt = (preferred.length ? preferred : Array.from(
    { length: maximum - minimum + 1 },
    (_, index) => minimum + index,
  )).reduce((best, index) => (
    Math.abs(index - target) < Math.abs(best - target) ? index : best
  ));
  return [words.slice(0, splitAt).join(' '), ...splitDisplayPhrase(words.slice(splitAt).join(' '))];
}

function canonicalPhrases(candidate: LyricsCandidate): CanonicalLyricsDraft['phrases'] {
  return candidate.lines
    .filter(line => !line.background)
    .flatMap(line => {
      const text = lineText(line)
        .replace(/^\s*[[(](?:verse|verso|chorus|coro|bridge|puente|intro|outro|estribillo)[^\])]*[\])]\s*$/i, '')
        .trim();
      if (!text || /^\s*\([^()]+\)\s*$/.test(text)) return [];
      const pieces = splitDisplayPhrase(removeRepeatedParentheticalEcho(text));
      const startMs = line.timestamp ?? 0;
      const endMs = line.endtime ?? 0;
      if (startMs <= 0 || endMs <= startMs) return pieces.map(piece => ({ text: piece }));
      const weights = pieces.map(piece => Math.max(1, piece.replace(/\s+/g, '').length));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let cursor = startMs;
      return pieces.map((piece, index) => {
        const pieceEnd = index === pieces.length - 1
          ? endMs
          : Math.round(cursor + (endMs - startMs) * weights[index] / total);
        const phrase = { text: piece, startMs: cursor, endMs: pieceEnd };
        cursor = pieceEnd;
        return phrase;
      });
    });
}

function canonicalProviderRank(candidate: LyricsCandidate): number {
  const source = candidate.source.toLowerCase();
  if (source.includes('lrc.red') && candidate.syncKind === 'word') return 0;
  if (source.includes('bini') && candidate.syncKind !== 'plain') return 0;
  if (source.includes('lrclib') && candidate.syncKind !== 'plain') return 1;
  if (source.includes('genius')) return 2;
  if (source.includes('bini')) return 3;
  if (source.includes('lrclib')) return 4;
  return 5;
}

/**
 * `mergeAndSortSources` already dedupes by normalized source label, so the
 * label is a stable id across re-searches — which is what lets a saved choice
 * survive a later sweep.
 */
function buildCandidateId(source: string): string {
  return source.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'source';
}

export const LOCAL_GENERATED_CANDIDATE_ID = 'staysound-ia-local';

function generatedEngineSyllables(words: GeneratedLyrics['lines'][number]['words']): EngineSyllable[] {
  return words.flatMap((word, wordIndex) => {
    const syllables = generatedWordDisplayParts(word);
    return syllables.map((syllable, syllableIndex) => {
      const isLastSyllable = syllableIndex === syllables.length - 1;
      return {
        text: `${syllable.text}${isLastSyllable && wordIndex < words.length - 1 ? ' ' : ''}`,
        part: !isLastSyllable,
        timestamp: syllable.startMs,
        endtime: Math.max(syllable.startMs + 30, syllable.endMs),
      };
    });
  });
}

function generatedLyricsCandidate(lyrics: GeneratedLyrics): LyricsCandidate {
  const lines: EngineLine[] = lyrics.lines
    .filter(line => line.words.length > 0)
    .map(line => {
      const { lead, backing } = generatedLineLayers(line);
      return {
        text: generatedEngineSyllables(lead),
        timestamp: line.startMs,
        endtime: Math.max(line.startMs + 80, line.endMs),
        isWordSynced: true,
        background: backing.length > 0,
        backgroundText: generatedEngineSyllables(backing),
        oppositeTurn: false,
      };
    });

  return {
    id: LOCAL_GENERATED_CANDIDATE_ID,
    source: 'StaySound · Local',
    syncKind: 'word',
    lineCount: lines.length,
    preview: lyrics.lines[0]?.text ?? '',
    lines,
  };
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function ttmlTime(milliseconds: number): string {
  return (Math.max(0, milliseconds) / 1000).toFixed(3);
}

function generatedTtmlSpans(words: GeneratedLyrics['lines'][number]['words']): string {
  return words.flatMap((word, wordIndex) => {
    const parts = generatedWordDisplayParts(word);
    return parts.map((part, partIndex) => {
      const isWordEnd = partIndex === parts.length - 1;
      const space = isWordEnd && wordIndex < words.length - 1 ? ' ' : '';
      return `<span begin="${ttmlTime(part.startMs)}" end="${ttmlTime(part.endMs)}">${xmlEscape(part.text)}</span>${space}`;
    });
  }).join('');
}

export function generatedLyricsTtml(lyrics: GeneratedLyrics): string {
  const lines = lyrics.lines.filter(line => line.words.length > 0);
  const body = lines.map((line, lineIndex) => {
    const { lead, backing } = generatedLineLayers(line);
    const backingSpan = backing.length
      ? ` <span ttm:role="x-bg">${generatedTtmlSpans(backing)}</span>`
      : '';
    return `<p begin="${ttmlTime(line.startMs)}" end="${ttmlTime(line.endMs)}" itunes:key="L${lineIndex + 1}">${generatedTtmlSpans(lead)}${backingSpan}</p>`;
  }).join('');
  const duration = lines.at(-1)?.endMs ?? 0;
  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word" xml:lang="${xmlEscape(lyrics.language)}"><body dur="${ttmlTime(duration)}"><div>${body}</div></body></tt>`;
}

export interface LocalGeneratedLyrics {
  lyrics: GeneratedLyrics;
  /** The same payload as TTML, ready to hand to `<am-lyrics ttml>`. */
  ttml: string;
}

/**
 * One lookup per audio file, shared by everyone who needs it.
 *
 * The lyrics view has to know whether a track carries a locally generated
 * letter *before* it mounts `<am-lyrics>` — the element starts its provider
 * chain from `connectedCallback()`, and that chain checks its abort signal
 * only once, so anything it began before the local payload arrived still
 * overwrites the rendered lyrics when it finishes. Mounting with the TTML
 * already set makes the element take its local branch and never start the
 * chain at all. The store asks for the same file a moment later; memoizing
 * keeps that to a single IPC round trip.
 */
const localGeneratedByPath = new Map<string, Promise<LocalGeneratedLyrics | null>>();

/** Keeps the memo to the handful of tracks a listener moves between. */
const LOCAL_GENERATED_MEMO_LIMIT = 8;

function memoizeLocalGenerated(
  path: string,
  request: Promise<LocalGeneratedLyrics | null>,
): void {
  localGeneratedByPath.set(path, request);
  for (const key of localGeneratedByPath.keys()) {
    if (localGeneratedByPath.size <= LOCAL_GENERATED_MEMO_LIMIT) break;
    localGeneratedByPath.delete(key);
  }
}

export function loadLocalGeneratedLyricsFor(track: Track): Promise<LocalGeneratedLyrics | null> {
  const path = getKaraokeTrackPath(track);
  if (!path) return Promise.resolve(null);

  const pending = localGeneratedByPath.get(path);
  if (pending) return pending;

  const request: Promise<LocalGeneratedLyrics | null> = loadLocalGeneratedLyrics(path)
    .then(lyrics => (lyrics?.lines?.length
      ? { lyrics, ttml: generatedLyricsTtml(lyrics) }
      : null))
    .catch(() => null)
    .then(result => {
      // "No local letter" is also what a transient failure looks like — the
      // desktop rejects the read until the music folder is authorized. Only a
      // real letter is worth remembering; anything else is asked again.
      if (!result && localGeneratedByPath.get(path) === request) {
        localGeneratedByPath.delete(path);
      }
      return result;
    });
  memoizeLocalGenerated(path, request);
  return request;
}

/** Replaces the memoized entry after the generator writes a new letter. */
function rememberLocalGenerated(track: Track, lyrics: GeneratedLyrics): void {
  const path = getKaraokeTrackPath(track);
  if (!path) return;
  memoizeLocalGenerated(
    path,
    Promise.resolve({ lyrics, ttml: generatedLyricsTtml(lyrics) }),
  );
}

function toCandidates(sources: EngineSource[]): LyricsCandidate[] {
  const seen = new Set<string>();
  const candidates: LyricsCandidate[] = [];

  for (const source of sources) {
    if (!Array.isArray(source?.lines) || source.lines.length === 0) continue;
    const baseId = buildCandidateId(source.source);
    let id = baseId;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(id);

    candidates.push({
      id,
      source: source.source,
      syncKind: classifySync(source.lines),
      lineCount: source.lines.length,
      preview: buildPreview(source.lines),
      songwriters: source.songwriters,
      lines: source.lines,
    });
  }

  return candidates;
}

async function resolveMetadata(
  element: AmLyricsElement,
  track: Track,
): Promise<{ metadata: EngineMetadata; isrc?: string }> {
  const internal = element as AmLyricsInternals;
  const fallback: EngineMetadata = {
    title: track.title.trim(),
    artist: track.artist.trim(),
    album: track.album?.trim() || undefined,
    durationMs: track.duration ? Math.round(track.duration) : undefined,
  };

  // The element's resolver adds the Apple catalog ISRC, which is what unlocks
  // the word-synced Apple lyrics on most tracks. If it is unavailable we can
  // still search by title/artist, just with a lower hit rate.
  if (typeof internal.resolveSongMetadata !== 'function') {
    return { metadata: fallback, isrc: track.isrc };
  }

  try {
    const resolved = await internal.resolveSongMetadata();
    const metadata = resolved?.metadata;
    if (!metadata?.title || !metadata?.artist) {
      return { metadata: fallback, isrc: resolved?.catalogIsrc ?? track.isrc };
    }
    return {
      metadata: {
        ...metadata,
        album: metadata.album ?? fallback.album,
        durationMs: metadata.durationMs ?? fallback.durationMs,
      },
      isrc: resolved.catalogIsrc ?? track.isrc,
    };
  } catch {
    return { metadata: fallback, isrc: track.isrc };
  }
}

/**
 * Queries every provider in parallel and returns them ranked by the engine's
 * own ordering (word-synced first), so candidate 0 is always the best match.
 */
async function sweepProviders(
  element: AmLyricsElement,
  track: Track,
): Promise<LyricsCandidate[]> {
  const engine = getEngineClass();
  if (!engine) return [];

  const { metadata, isrc } = await resolveMetadata(element, track);
  if (!metadata.title || !metadata.artist) return [];

  const { title, artist } = metadata;
  const results = await Promise.allSettled<EngineSource | EngineSource[] | null>([
    ('__TAURI_INTERNALS__' in window ? fetchLyricsFromLrcRed(metadata, isrc, engine) : null),
    engine.fetchLyricsFromBiniLyrics?.(title, artist, isrc, metadata) ?? null,
    engine.fetchLyricsFromUnison?.(metadata) ?? null,
    engine.fetchLyricsFromYouLyPlus?.(title, artist, isrc, metadata, true) ?? null,
    fetchLyricsFromLrclib(metadata),
    engine.fetchLyricsFromGenius?.(metadata) ?? null,
  ]);

  const collected: EngineSource[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const values = Array.isArray(result.value) ? result.value : [result.value];
    for (const value of values) {
      if (value && Array.isArray(value.lines) && value.lines.length > 0) collected.push(value);
    }
  }

  if (collected.length === 0) return [];
  const candidates = toCandidates(engine.mergeAndSortSources?.(collected) ?? collected);
  // lrc.red matches a specific recording and serves its original word timing.
  candidates.sort((left, right) => Number(right.source === 'lrc.red' && right.syncKind === 'word')
    - Number(left.source === 'lrc.red' && left.syncKind === 'word'));
  return candidates;
}

/**
 * Installs a candidate and returns the source list it installed, so the caller
 * can later tell its own list apart from one the element replaced.
 */
function applyToElement(
  element: AmLyricsElement,
  candidates: LyricsCandidate[],
  index: number,
): EngineSource[] | null {
  const candidate = candidates[index];
  if (!candidate) return null;

  const internal = element as AmLyricsInternals;
  const sources: EngineSource[] = candidates.map(entry => ({
    lines: entry.lines,
    source: entry.source,
    songwriters: entry.songwriters,
  }));
  internal.availableSources = sources;
  // We have already asked every provider; stop the element's own footer
  // switcher from running the whole discovery chain again.
  internal.hasFetchedAllProviders = true;
  internal.isLoading = false;

  if (typeof internal.applySourceAtIndex === 'function') {
    void internal.applySourceAtIndex(index);
    return sources;
  }

  // If upstream renames that method, assigning the reactive state still swaps
  // the rendered lyrics; only the scroll reset and romanization pass are lost.
  internal.currentSourceIndex = index;
  internal.lyrics = candidate.lines;
  internal.lyricsSource = candidate.source;
  if (candidate.songwriters) internal.songwriters = candidate.songwriters;
  internal.requestUpdate?.();
  return sources;
}

const EMPTY_STATE: LyricsSourcesState = {
  trackKey: '',
  status: 'idle',
  candidates: [],
  selectedId: null,
  fetchedAt: null,
  fromCache: false,
  canSearch: false,
};

class LyricsSourcesStore {
  private listeners = new Set<() => void>();

  private state: LyricsSourcesState = EMPTY_STATE;

  private element: AmLyricsElement | null = null;

  private track: Track | null = null;

  /** Invalidates in-flight sweeps and deferred applies after a track change. */
  private token = 0;

  private applyTimer = 0;

  private holdTimer = 0;

  /** The selection currently defended against a late provider-chain write. */
  private held: {
    candidateId: string;
    sources: EngineSource[];
    lines: EngineLine[];
  } | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): LyricsSourcesState => this.state;

  /**
   * Returns the exact lyric currently rendered by `<am-lyrics>`. The element
   * can complete its built-in lookup before the optional provider sweep has
   * populated `state.candidates`, so consumers such as Karaoke must not infer
   * that no lyric exists from an empty candidate list alone.
   */
  getRenderedCandidate(track: Track): LyricsCandidate | null {
    if (!this.element || this.state.trackKey !== getLyricsTrackKey(track)) return null;
    const internal = this.element as AmLyricsInternals;
    const lines = internal.lyrics;
    if (!Array.isArray(lines) || lines.length === 0) return null;
    const source = internal.lyricsSource?.trim() || 'Player';
    return {
      id: `rendered-${buildCandidateId(source)}`,
      source,
      syncKind: classifySync(lines),
      lineCount: lines.length,
      preview: buildPreview(lines),
      songwriters: internal.songwriters,
      lines,
    };
  }

  private setState(patch: Partial<LyricsSourcesState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private cancelPendingApply(): void {
    if (this.applyTimer) {
      window.clearInterval(this.applyTimer);
      this.applyTimer = 0;
    }
    this.releaseSelection();
  }

  private releaseSelection(): void {
    if (this.holdTimer) {
      window.clearInterval(this.holdTimer);
      this.holdTimer = 0;
    }
    this.held = null;
  }

  /**
   * Applies a candidate and keeps it applied for as long as the element's own
   * provider chain could still finish and overwrite it.
   *
   * The element replaces `availableSources` with a brand new array whenever
   * that chain lands, so a changed identity means the chain won, while our own
   * array with a different index means the user cycled sources in the
   * element's footer — and their choice is the one that must stand.
   */
  private applyAndHold(candidates: LyricsCandidate[], index: number, token: number): void {
    const element = this.element;
    if (!element) return;

    const sources = applyToElement(element, candidates, index);
    if (!sources) return;

    this.releaseSelection();
    this.held = { candidateId: candidates[index].id, sources, lines: candidates[index].lines };

    // A locally generated letter is the user's own work and has no better
    // answer to wait for, so it is defended for as long as this element lives
    // rather than for the window a provider chain needs to unwind.
    const deadline = candidates[index].id === LOCAL_GENERATED_CANDIDATE_ID
      ? Number.POSITIVE_INFINITY
      : Date.now() + SELECTION_HOLD_MS;
    this.holdTimer = window.setInterval(() => {
      const held = this.held;
      if (!held || token !== this.token || !element.isConnected || Date.now() > deadline) {
        this.releaseSelection();
        return;
      }

      const internal = element as AmLyricsInternals;
      if (internal.lyrics === held.lines) return;
      if (internal.availableSources === held.sources) {
        this.releaseSelection();
        return;
      }

      const position = this.state.candidates.findIndex(entry => entry.id === held.candidateId);
      if (position === -1) {
        this.releaseSelection();
        return;
      }
      const restored = applyToElement(element, this.state.candidates, position);
      if (!restored) {
        this.releaseSelection();
        return;
      }
      this.held = {
        candidateId: held.candidateId,
        sources: restored,
        lines: this.state.candidates[position].lines,
      };
    }, SELECTION_HOLD_POLL_MS);
  }

  attach(element: AmLyricsElement | null, track: Track | null): void {
    this.cancelPendingApply();
    this.token += 1;
    const token = this.token;

    this.element = element;
    this.track = track;

    if (!element || !track) {
      this.state = EMPTY_STATE;
      for (const listener of this.listeners) listener();
      return;
    }

    const trackKey = getLyricsTrackKey(track);
    this.state = { ...EMPTY_STATE, trackKey, canSearch: true };
    for (const listener of this.listeners) listener();

    void Promise.all([
      readCachedLyrics(trackKey),
      loadLocalGeneratedLyricsFor(track),
    ]).then(([entry, local]) => {
      if (token !== this.token) return;
      let candidates = entry?.candidates as unknown as LyricsCandidate[] | undefined;
      candidates = Array.isArray(candidates) ? candidates : [];
      const generated = local?.lyrics ?? null;
      if (local) {
        // The view mounts the element with this exact payload, so assigning it
        // again would only restart the element's fetch cycle. Assign it solely
        // when the element is carrying something else — a reused element, or a
        // letter that was generated after this one mounted.
        if (element.ttml !== local.ttml) element.ttml = local.ttml;
        candidates = [
          generatedLyricsCandidate(local.lyrics),
          ...candidates.filter(candidate => candidate.id !== LOCAL_GENERATED_CANDIDATE_ID),
        ];
      } else if (element.ttml) {
        // A reused element must not keep the previous track's local payload.
        element.ttml = undefined;
      }
      if (candidates.length === 0) {
        if ('__TAURI_INTERNALS__' in window && !generated?.lines?.length) void this.refresh();
        return;
      }

      // Do not restore an old fallback over the element's own live lookup.
      // In particular, this prevents a cached Genius response from replacing a
      // freshly available BiniLyrics/Apple result. Re-run the independent
      // provider sweep so a temporary KPoe outage heals itself automatically.
      if (!hasWordSyncedCandidate(candidates) && !generated?.lines?.length) {
        void this.refresh();
        return;
      }

      const selectedId = generated?.lines?.length
        ? LOCAL_GENERATED_CANDIDATE_ID
        : entry?.selectedId && candidates.some(c => c.id === entry.selectedId)
          ? entry.selectedId
          : null;

      this.setState({
        status: 'ready',
        candidates,
        selectedId,
        fetchedAt: entry?.fetchedAt ?? Date.now(),
        fromCache: Boolean(entry),
      });

      if (selectedId) this.applyWhenSettled(selectedId, token);
    });
  }

  detach(element: AmLyricsElement | null): void {
    if (element && this.element !== element) return;
    this.cancelPendingApply();
    this.token += 1;
    this.element = null;
    this.track = null;
    this.state = EMPTY_STATE;
    for (const listener of this.listeners) listener();
  }

  /**
   * Waits for the element's own lookup to finish before overriding it —
   * applying earlier would just be overwritten when that fetch resolves.
   */
  private applyWhenSettled(candidateId: string, token: number): void {
    const element = this.element;
    if (!element) return;

    const startedAt = Date.now();
    let sawLoading = false;

    this.cancelPendingApply();
    this.applyTimer = window.setInterval(() => {
      if (token !== this.token || !element.isConnected) {
        this.cancelPendingApply();
        return;
      }

      const internal = element as AmLyricsInternals;
      const elapsed = Date.now() - startedAt;
      if (internal.isLoading) sawLoading = true;

      const settled = !internal.isLoading && (sawLoading || elapsed >= APPLY_SETTLE_MS);
      if (!settled && elapsed < APPLY_TIMEOUT_MS) return;

      this.cancelPendingApply();
      const index = this.state.candidates.findIndex(entry => entry.id === candidateId);
      if (index !== -1) this.applyAndHold(this.state.candidates, index, token);
    }, APPLY_POLL_MS);
  }

  async refresh(): Promise<void> {
    const element = this.element;
    const track = this.track;
    if (!element || !track || this.state.status === 'loading') return;

    const token = this.token;
    const trackKey = this.state.trackKey;
    this.cancelPendingApply();
    this.setState({ status: 'loading' });

    let candidates: LyricsCandidate[] = [];
    try {
      candidates = await sweepProviders(element, track);
    } catch {
      if (token === this.token) this.setState({ status: 'error' });
      return;
    }
    if (token !== this.token) return;

    const localCandidate = this.state.candidates.find(
      candidate => candidate.id === LOCAL_GENERATED_CANDIDATE_ID,
    );
    if (localCandidate) {
      candidates = [
        localCandidate,
        ...candidates.filter(candidate => candidate.id !== LOCAL_GENERATED_CANDIDATE_ID),
      ];
    }

    if (candidates.length === 0) {
      this.setState({ status: 'empty', fromCache: false, fetchedAt: Date.now() });
      return;
    }

    // Keep the user's pick when the same source comes back; otherwise fall to
    // the best-ranked result, which is the point of searching again.
    const previousId = this.state.selectedId;
    const keptIndex = previousId ? candidates.findIndex(entry => entry.id === previousId) : -1;
    const shouldUpgrade =
      keptIndex === -1 ||
      (candidates[keptIndex].syncKind !== 'word' && candidates[0].syncKind === 'word');
    const selectedIndex = shouldUpgrade ? 0 : keptIndex;
    const selected = candidates[selectedIndex];

    const fetchedAt = Date.now();
    this.setState({
      status: 'ready',
      candidates,
      selectedId: selected.id,
      fetchedAt,
      fromCache: false,
    });

    this.applyAndHold(candidates, selectedIndex, token);
    void writeCachedLyrics(this.toCacheEntry(trackKey, candidates, selected.id, fetchedAt));
  }

  select(candidateId: string): void {
    const element = this.element;
    const index = this.state.candidates.findIndex(entry => entry.id === candidateId);
    if (!element || index === -1) return;

    this.cancelPendingApply();
    this.setState({ selectedId: candidateId });
    this.applyAndHold(this.state.candidates, index, this.token);
    void writeCachedLyrics(
      this.toCacheEntry(
        this.state.trackKey,
        this.state.candidates,
        candidateId,
        this.state.fetchedAt ?? Date.now(),
      ),
    );
  }

  async getCanonicalLyrics(): Promise<CanonicalLyricsDraft | null> {
    let remote = this.state.candidates.filter(
      candidate => candidate.id !== LOCAL_GENERATED_CANDIDATE_ID,
    );
    const hasSyncedBini = remote.some(candidate => (
      candidate.source.toLowerCase().includes('bini') && candidate.syncKind !== 'plain'
    ));
    if ((!remote.length || !hasSyncedBini) && this.element && this.track) {
      await this.refresh();
      remote = this.state.candidates.filter(
        candidate => candidate.id !== LOCAL_GENERATED_CANDIDATE_ID,
      );
    }
    const ranked = [...remote].sort((left, right) => {
      const provider = canonicalProviderRank(left) - canonicalProviderRank(right);
      if (provider !== 0) return provider;
      if (left.id === this.state.selectedId) return -1;
      if (right.id === this.state.selectedId) return 1;
      return right.lineCount - left.lineCount;
    });
    for (const candidate of ranked) {
      const phrases = canonicalPhrases(candidate);
      if (phrases.length >= 2) {
        return { source: candidate.source, syncKind: candidate.syncKind, phrases };
      }
    }
    return null;
  }

  saveGenerated(track: Track, lyrics: GeneratedLyrics): void {
    if (!lyrics.lines.length) return;

    const trackKey = getLyricsTrackKey(track);
    const generated = generatedLyricsCandidate(lyrics);
    const fetchedAt = Date.now();
    const element = this.element;
    // The next mount must see this letter, not the one on disk when the player
    // first asked for it.
    rememberLocalGenerated(track, lyrics);

    if (element && this.state.trackKey === trackKey) {
      element.ttml = generatedLyricsTtml(lyrics);
      const candidates = [
        generated,
        ...this.state.candidates.filter(candidate => candidate.id !== generated.id),
      ];
      this.cancelPendingApply();
      this.setState({
        status: 'ready',
        candidates,
        selectedId: generated.id,
        fetchedAt,
        fromCache: false,
      });
      this.applyAndHold(candidates, 0, this.token);
      void writeCachedLyrics(this.toCacheEntry(trackKey, candidates, generated.id, fetchedAt));
      return;
    }

    // The generator can be opened with the lyrics panel closed, so there may be
    // no element to drive. The choice still has to be recorded, or the next
    // play would silently fall back to whatever the providers return.
    void readCachedLyrics(trackKey).then(entry => {
      const previous = ((entry?.candidates ?? []) as unknown as LyricsCandidate[])
        .filter(candidate => candidate.id !== generated.id);
      void writeCachedLyrics(
        this.toCacheEntry(trackKey, [generated, ...previous], generated.id, fetchedAt),
      );
    });
  }

  private toCacheEntry(
    trackKey: string,
    candidates: LyricsCandidate[],
    selectedId: string | null,
    fetchedAt: number,
  ): CachedLyricsEntry {
    return {
      trackKey,
      fetchedAt,
      selectedId,
      candidates: candidates.map(entry => ({
        id: entry.id,
        source: entry.source,
        syncKind: entry.syncKind,
        lineCount: entry.lineCount,
        preview: entry.preview,
        songwriters: entry.songwriters,
        lines: entry.lines as unknown[],
      })),
    };
  }
}

export const lyricsSourcesStore = new LyricsSourcesStore();

export function useLyricsSources(): LyricsSourcesState {
  return useSyncExternalStore(lyricsSourcesStore.subscribe, lyricsSourcesStore.getState);
}
