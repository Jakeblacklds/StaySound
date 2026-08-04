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
 * This module runs the providers independently, with a native LRCLIB client
 * that validates title, artist and duration before accepting a result. It
 * keeps every result as a candidate and caches the set so a track that was
 * resolved well once stays resolved.
 */

import type { Track } from '@staysound/types/audio';
import { useSyncExternalStore } from 'react';
import {
  getKaraokeTrackPath,
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

export type LyricsSyncKind = 'word' | 'line' | 'plain';

/** Only the fields we inspect are typed; the rest is passed back untouched. */
interface EngineSyllable {
  text?: string;
  part?: boolean;
  timestamp?: number;
  endtime?: number;
}

interface EngineLine {
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

const LOCAL_GENERATED_CANDIDATE_ID = 'staysound-ia-local';

function generatedLyricsCandidate(lyrics: GeneratedLyrics): LyricsCandidate {
  const lines: EngineLine[] = lyrics.lines
    .filter(line => line.words.length > 0)
    .map(line => ({
      text: line.words.flatMap((word, wordIndex) => {
        const syllables = generatedWordDisplayParts(word);
        return syllables.map((syllable, syllableIndex) => {
          const isLastSyllable = syllableIndex === syllables.length - 1;
          return {
            text: `${syllable.text}${isLastSyllable && wordIndex < line.words.length - 1 ? ' ' : ''}`,
            part: !isLastSyllable,
            timestamp: syllable.startMs,
            endtime: Math.max(syllable.startMs + 30, syllable.endMs),
          };
        });
      }),
      timestamp: line.startMs,
      endtime: Math.max(line.startMs + 80, line.endMs),
      isWordSynced: true,
      background: false,
      backgroundText: [],
      oppositeTurn: false,
    }));

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

function generatedLyricsTtml(lyrics: GeneratedLyrics): string {
  const lines = lyrics.lines.filter(line => line.words.length > 0);
  const body = lines.map((line, lineIndex) => {
    const spans = line.words.flatMap((word, wordIndex) => {
      const parts = generatedWordDisplayParts(word);
      return parts.map((part, partIndex) => {
        const isWordEnd = partIndex === parts.length - 1;
        const space = isWordEnd && wordIndex < line.words.length - 1 ? ' ' : '';
        return `<span begin="${ttmlTime(part.startMs)}" end="${ttmlTime(part.endMs)}">${xmlEscape(part.text)}</span>${space}`;
      });
    }).join('');
    return `<p begin="${ttmlTime(line.startMs)}" end="${ttmlTime(line.endMs)}" itunes:key="L${lineIndex + 1}">${spans}</p>`;
  }).join('');
  const duration = lines.at(-1)?.endMs ?? 0;
  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word" xml:lang="${xmlEscape(lyrics.language)}"><body dur="${ttmlTime(duration)}"><div>${body}</div></body></tt>`;
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
  return toCandidates(engine.mergeAndSortSources?.(collected) ?? collected);
}

function applyToElement(
  element: AmLyricsElement,
  candidates: LyricsCandidate[],
  index: number,
): void {
  const candidate = candidates[index];
  if (!candidate) return;

  const internal = element as AmLyricsInternals;
  internal.availableSources = candidates.map(entry => ({
    lines: entry.lines,
    source: entry.source,
    songwriters: entry.songwriters,
  }));
  // We have already asked every provider; stop the element's own footer
  // switcher from running the whole discovery chain again.
  internal.hasFetchedAllProviders = true;
  internal.isLoading = false;

  if (typeof internal.applySourceAtIndex === 'function') {
    void internal.applySourceAtIndex(index);
    return;
  }

  // If upstream renames that method, assigning the reactive state still swaps
  // the rendered lyrics; only the scroll reset and romanization pass are lost.
  internal.currentSourceIndex = index;
  internal.lyrics = candidate.lines;
  internal.lyricsSource = candidate.source;
  if (candidate.songwriters) internal.songwriters = candidate.songwriters;
  internal.requestUpdate?.();
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

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): LyricsSourcesState => this.state;

  private setState(patch: Partial<LyricsSourcesState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private cancelPendingApply(): void {
    if (this.applyTimer) {
      window.clearInterval(this.applyTimer);
      this.applyTimer = 0;
    }
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

    // A reused <am-lyrics> element must not carry the previous track's local
    // payload while this track's file is being resolved.
    element.ttml = undefined;

    const trackKey = getLyricsTrackKey(track);
    this.state = { ...EMPTY_STATE, trackKey, canSearch: true };
    for (const listener of this.listeners) listener();

    const nativePath = getKaraokeTrackPath(track);
    const localLyrics = nativePath
      ? loadLocalGeneratedLyrics(nativePath).catch(() => null)
      : Promise.resolve(null);

    void Promise.all([readCachedLyrics(trackKey), localLyrics]).then(([entry, generated]) => {
      if (token !== this.token) return;
      let candidates = entry?.candidates as unknown as LyricsCandidate[] | undefined;
      candidates = Array.isArray(candidates) ? candidates : [];
      if (generated?.lines?.length) {
        element.ttml = generatedLyricsTtml(generated);
        candidates = [
          generatedLyricsCandidate(generated),
          ...candidates.filter(candidate => candidate.id !== LOCAL_GENERATED_CANDIDATE_ID),
        ];
      }
      if (candidates.length === 0) return;

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
      if (index !== -1) applyToElement(element, this.state.candidates, index);
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

    applyToElement(element, candidates, selectedIndex);
    void writeCachedLyrics(this.toCacheEntry(trackKey, candidates, selected.id, fetchedAt));
  }

  select(candidateId: string): void {
    const element = this.element;
    const index = this.state.candidates.findIndex(entry => entry.id === candidateId);
    if (!element || index === -1) return;

    this.cancelPendingApply();
    this.setState({ selectedId: candidateId });
    applyToElement(element, this.state.candidates, index);
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

  saveGenerated(lyrics: GeneratedLyrics): void {
    const element = this.element;
    if (!element || !this.track || !lyrics.lines.length) return;

    const generated = generatedLyricsCandidate(lyrics);
    element.ttml = generatedLyricsTtml(lyrics);
    const candidates = [
      generated,
      ...this.state.candidates.filter(candidate => candidate.id !== generated.id),
    ];
    const fetchedAt = Date.now();
    this.cancelPendingApply();
    this.setState({
      status: 'ready',
      candidates,
      selectedId: generated.id,
      fetchedAt,
      fromCache: false,
    });
    applyToElement(element, candidates, 0);
    void writeCachedLyrics(this.toCacheEntry(this.state.trackKey, candidates, generated.id, fetchedAt));
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
