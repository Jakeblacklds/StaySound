import {
  createCanonicalLyricsKey,
  forceRefreshLyrics as nativeForceRefreshLyrics,
  getLrcLibLyrics as nativeGetLrcLibLyrics,
  getLyrics as nativeGetLyrics,
  normalizeLyricsKeyPart,
} from 'karaoke-view';
import type { KaraokeLyricsJSON } from '../types';
import { appleWordLyricsService, type AppleWordLyricsOption } from './appleWordLyricsService';
import { lrcLibService } from './lrcLibService';
import {
  DEFAULT_LYRICS_SOURCE_IDS,
  getLyricsSourceMeta,
  type LyricsSourceId,
  sanitizeLyricsSourceIds,
} from './lyricsSources';
import { FileSystemStorage } from './storage';

export interface LyricsPayload extends KaraokeLyricsJSON { }
export interface AppleWordLyricsCandidate {
  id: string;
  label: string;
  source: 'binimum' | 'kpoe' | 'lrclib';
  sourceId: LyricsSourceId;
  providerLabel: string;
  wordLevel: boolean;
  payload: LyricsPayload;
  lyricsUrl?: string;
  timingType?: string;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  durationSec?: number;
  isExactMatch: boolean;
}

type AppleWordLyricsCachePayload = {
  options: AppleWordLyricsCandidate[];
  /** Which sources were queried when this entry was written (for cache invalidation). */
  attemptedSources?: LyricsSourceId[];
  /** Epoch ms when this entry was written (used to expire negative/empty results). */
  savedAt?: number;
};

class LyricsRepositoryService {
  private readonly APPLE_CACHE_PREFIX = 'apple-word-cache-v3';
  private readonly TRACK_APPLE_CACHE_PREFIX = 'apple-word-track-cache-v3';
  private readonly LRC_CACHE_PREFIX = 'lrc-lib-cache-v1';
  private readonly TRACK_LRC_CACHE_PREFIX = 'lrc-lib-track-cache-v1';
  // How long a "we tried and Apple/KPoe had nothing" result is trusted before re-checking.
  // Kept short (1 day) because the word service swallows network errors as empty results,
  // so a transient failure could otherwise suppress lyrics for too long.
  private readonly NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  private cleanCacheMetadata(value: string): string {
    return value
      .replace(/\s*[\(\[].*?[\)\]]/g, '')
      .replace(/\s*-\s*(Remastered|Original Mix|Single Version|Edit|Mix|Radio|Official|Lyric|Video).*$/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getLrcCacheKeyForCanonical(canonical: string): string {
    return `${this.LRC_CACHE_PREFIX}-${encodeURIComponent(canonical)}`;
  }

  private getAppleCacheKeyForCanonical(canonical: string): string {
    return `${this.APPLE_CACHE_PREFIX}-${encodeURIComponent(canonical)}`;
  }

  private getTrackLrcCacheKey(trackId: string): string {
    return `${this.TRACK_LRC_CACHE_PREFIX}-${encodeURIComponent(trackId.trim())}`;
  }

  private getTrackAppleCacheKey(trackId: string): string {
    return `${this.TRACK_APPLE_CACHE_PREFIX}-${encodeURIComponent(trackId.trim())}`;
  }

  private getLrcCacheCandidateKeys(songTitle: string, artist: string): string[] {
    const candidates = new Set<string>();
    const titleVariants = [songTitle, this.cleanCacheMetadata(songTitle)].filter(Boolean);
    const artistVariants = [artist, this.cleanCacheMetadata(artist)].filter(Boolean);

    for (const title of titleVariants) {
      for (const artistName of artistVariants) {
        const canonical = this.canonicalKey(title, artistName);
        candidates.add(this.getLrcCacheKeyForCanonical(canonical));
      }
    }

    return [...candidates];
  }

  private getAppleCacheCandidateKeys(songTitle: string, artist: string): string[] {
    const candidates = new Set<string>();
    const titleVariants = [songTitle, this.cleanCacheMetadata(songTitle)].filter(Boolean);
    const artistVariants = [artist, this.cleanCacheMetadata(artist)].filter(Boolean);

    for (const title of titleVariants) {
      for (const artistName of artistVariants) {
        const canonical = this.canonicalKey(title, artistName);
        candidates.add(this.getAppleCacheKeyForCanonical(canonical));
      }
    }

    return [...candidates];
  }

  private hasLyrics(payload: KaraokeLyricsJSON | null | undefined): payload is KaraokeLyricsJSON {
    return Boolean(payload && Array.isArray(payload.lyrics) && payload.lyrics.length > 0);
  }

  private toAppleCandidate(option: AppleWordLyricsOption): AppleWordLyricsCandidate | null {
    if (!this.hasLyrics(option.payload)) return null;
    return {
      id: option.id,
      label: option.label,
      source: option.source,
      sourceId: option.sourceId,
      providerLabel: option.providerLabel,
      wordLevel: option.wordLevel,
      payload: option.payload as LyricsPayload,
      lyricsUrl: option.lyricsUrl,
      timingType: option.timingType,
      trackName: option.trackName,
      artistName: option.artistName,
      albumName: option.albumName,
      durationSec: option.durationSec,
      isExactMatch: option.isExactMatch,
    };
  }

  private hasWordLevelPayload(payload: KaraokeLyricsJSON | null | undefined): boolean {
    const lyrics = payload?.lyrics;
    if (!Array.isArray(lyrics) || lyrics.length === 0) return false;
    return lyrics.some(word => word.n !== true);
  }

  /** Backfill provider fields onto candidates written before multi-source existed. */
  private hydrateCachedOption(option: AppleWordLyricsCandidate): AppleWordLyricsCandidate {
    const sourceId: LyricsSourceId = option.sourceId
      ?? (option.source === 'kpoe' ? 'lyricsplus' : option.source === 'lrclib' ? 'lrclib' : 'apple');
    const meta = getLyricsSourceMeta(sourceId);
    return {
      ...option,
      sourceId,
      providerLabel: option.providerLabel ?? meta?.label ?? sourceId,
      wordLevel: typeof option.wordLevel === 'boolean' ? option.wordLevel : this.hasWordLevelPayload(option.payload),
    };
  }

  private normalizeCachedAppleOptions(rawValue: string): { options: AppleWordLyricsCandidate[]; attemptedSources: LyricsSourceId[] | null; savedAt: number | null } {
    try {
      const parsed = JSON.parse(rawValue) as AppleWordLyricsCachePayload | LyricsPayload;
      if (Array.isArray((parsed as AppleWordLyricsCachePayload).options)) {
        const payload = parsed as AppleWordLyricsCachePayload;
        const options = payload.options
          .filter(option => this.hasLyrics(option?.payload) && typeof option.isExactMatch === 'boolean')
          .map(option => this.hydrateCachedOption(option));
        const attemptedSources = Array.isArray(payload.attemptedSources)
          ? sanitizeLyricsSourceIds(payload.attemptedSources)
          : null;
        const savedAt = typeof payload.savedAt === 'number' ? payload.savedAt : null;
        return { options, attemptedSources, savedAt };
      }

      if (this.hasLyrics(parsed as LyricsPayload)) {
        return {
          options: [this.hydrateCachedOption({
            id: 'legacy-1',
            label: 'Opción 1',
            source: 'binimum',
            sourceId: 'apple',
            providerLabel: 'Apple Music',
            wordLevel: this.hasWordLevelPayload(parsed as LyricsPayload),
            payload: parsed as LyricsPayload,
            isExactMatch: false,
          })],
          attemptedSources: null,
          savedAt: null,
        };
      }
    } catch {
      return { options: [], attemptedSources: null, savedAt: null };
    }

    return { options: [], attemptedSources: null, savedAt: null };
  }

  /**
   * True when we already queried Apple/KPoe for this track recently and got nothing, so
   * there's no point hammering the network again on every replay. Expires after the TTL.
   */
  private async hasFreshEmptyAppleAttempt(songTitle: string, artist: string, trackId: string | undefined, requiredServiceSources: LyricsSourceId[]): Promise<boolean> {
    const required = requiredServiceSources.filter(id => id !== 'lrclib');

    const isFreshNegative = (raw: string | null): boolean => {
      if (!raw) return false;
      const parsed = this.normalizeCachedAppleOptions(raw);
      if (parsed.options.length > 0) return false; // positive entry, not a negative marker
      if (!parsed.attemptedSources || parsed.savedAt == null) return false;
      if (Date.now() - parsed.savedAt > this.NEGATIVE_CACHE_TTL_MS) return false;
      const attempted = new Set(parsed.attemptedSources);
      return required.every(source => attempted.has(source));
    };

    if (trackId?.trim()) {
      if (isFreshNegative(await FileSystemStorage.getItem(this.getTrackAppleCacheKey(trackId)))) {
        return true;
      }
    }
    for (const cacheKey of this.getAppleCacheCandidateKeys(songTitle, artist)) {
      if (isFreshNegative(await FileSystemStorage.getItem(cacheKey))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns cached candidates. When `requiredSources` is provided, the cache only
   * counts as a hit if every requested source was already attempted — otherwise we
   * report a miss so newly-enabled sources get fetched. Returned options are then
   * filtered to the requested sources.
   */
  async getCachedAppleWordLyricsOptions(songTitle: string, artist: string, trackId?: string, requiredSources?: LyricsSourceId[]): Promise<AppleWordLyricsCandidate[]> {
    if (!songTitle.trim() || !artist.trim()) return [];

    // This cache only holds Apple/KPoe candidates — LRCLIB is a separate path — so the
    // coverage check ignores 'lrclib'. Empty after stripping ⇒ no coverage requirement.
    const requiredList: LyricsSourceId[] | null = requiredSources
      ? sanitizeLyricsSourceIds(requiredSources).filter(id => id !== 'lrclib')
      : null;
    const required = requiredList && requiredList.length > 0 ? requiredList : null;

    const accept = (parsed: { options: AppleWordLyricsCandidate[]; attemptedSources: LyricsSourceId[] | null }): AppleWordLyricsCandidate[] | null => {
      if (parsed.options.length === 0) return null;
      if (!required) return parsed.options;

      // Miss when we can't prove every requested source was tried (forces refetch).
      if (!parsed.attemptedSources) return null;
      const attempted = new Set(parsed.attemptedSources);
      if (!required.every(source => attempted.has(source))) return null;

      const requestedSet = new Set(required);
      const filtered = parsed.options.filter(option => requestedSet.has(option.sourceId));
      return filtered.length > 0 ? filtered : null;
    };

    if (trackId?.trim()) {
      const trackCacheKey = this.getTrackAppleCacheKey(trackId);
      const trackRaw = await FileSystemStorage.getItem(trackCacheKey);
      if (trackRaw) {
        const result = accept(this.normalizeCachedAppleOptions(trackRaw));
        if (result) {
          console.log('[LyricsRepository] Apple track cache hit:', trackCacheKey, result.length);
          return result;
        }
      }
    }

    for (const cacheKey of this.getAppleCacheCandidateKeys(songTitle, artist)) {
      const raw = await FileSystemStorage.getItem(cacheKey);
      if (!raw) continue;

      const result = accept(this.normalizeCachedAppleOptions(raw));
      if (result) {
        console.log('[LyricsRepository] Apple cache hit:', cacheKey, result.length);
        return result;
      }
    }

    return [];
  }

  async getCachedLrcLibLyrics(songTitle: string, artist: string, trackId?: string): Promise<LyricsPayload | null> {
    if (!songTitle.trim() || !artist.trim()) return null;

    if (trackId?.trim()) {
      const trackCacheKey = this.getTrackLrcCacheKey(trackId);
      const trackRaw = await FileSystemStorage.getItem(trackCacheKey);
      if (trackRaw) {
        try {
          const parsed = JSON.parse(trackRaw) as LyricsPayload;
          if (this.hasLyrics(parsed)) {
            console.log('[LyricsRepository] LRC track cache hit:', trackCacheKey);
            return parsed;
          }
        } catch {
          // Fall through to canonical cache keys
        }
      }
    }

    for (const cacheKey of this.getLrcCacheCandidateKeys(songTitle, artist)) {
      const raw = await FileSystemStorage.getItem(cacheKey);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw) as LyricsPayload;
        if (this.hasLyrics(parsed)) {
          console.log('[LyricsRepository] LRC cache hit:', cacheKey);
          return parsed;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async saveCachedAppleWordLyricsOptions(songTitle: string, artist: string, options: AppleWordLyricsCandidate[], attemptedSources: LyricsSourceId[], trackId?: string): Promise<void> {
    const safeOptions = options.filter(option => this.hasLyrics(option.payload));
    // Persist even with zero results (a TTL'd negative marker) so we remember we already
    // tried Apple/KPoe and stop re-hitting the network for LRC-only songs on every replay.
    const serialized = JSON.stringify({ options: safeOptions, attemptedSources, savedAt: Date.now() });

    if (trackId?.trim()) {
      const trackCacheKey = this.getTrackAppleCacheKey(trackId);
      await FileSystemStorage.setItem(trackCacheKey, serialized);
      console.log('[LyricsRepository] Apple track cache saved:', trackCacheKey, safeOptions.length);
    }
    for (const cacheKey of this.getAppleCacheCandidateKeys(songTitle, artist)) {
      await FileSystemStorage.setItem(cacheKey, serialized);
      console.log('[LyricsRepository] Apple cache saved:', cacheKey, safeOptions.length);
    }
  }

  private async saveCachedLrcLibLyrics(songTitle: string, artist: string, payload: LyricsPayload, trackId?: string): Promise<void> {
    if (!this.hasLyrics(payload)) return;
    if (trackId?.trim()) {
      const trackCacheKey = this.getTrackLrcCacheKey(trackId);
      await FileSystemStorage.setItem(trackCacheKey, JSON.stringify(payload));
      console.log('[LyricsRepository] LRC track cache saved:', trackCacheKey);
    }
    for (const cacheKey of this.getLrcCacheCandidateKeys(songTitle, artist)) {
      await FileSystemStorage.setItem(cacheKey, JSON.stringify(payload));
      console.log('[LyricsRepository] LRC cache saved:', cacheKey);
    }
  }

  canonicalKey(songTitle: string, artist: string): string {
    return createCanonicalLyricsKey(songTitle, artist);
  }

  normalize(value: string): string {
    return normalizeLyricsKeyPart(value);
  }

  async getLyrics(songTitle: string, artist: string): Promise<LyricsPayload | null> {
    if (!songTitle.trim() || !artist.trim()) return null;

    try {
      const result = await nativeGetLyrics(songTitle, artist);
      return result?.payload ?? null;
    } catch {
      return null;
    }
  }

  async getAppleWordLyrics(songTitle: string, artist: string, album?: string, durationSec?: number, trackId?: string, isrc?: string, sources?: LyricsSourceId[]): Promise<LyricsPayload | null> {
    const options = await this.getAppleWordLyricsOptions(songTitle, artist, album, durationSec, trackId, isrc, sources);
    return options[0]?.payload ?? null;
  }

  /**
   * Wipes every cached Apple/KPoe and LRCLIB entry for a track (track-id key + all
   * canonical title/artist keys, including the negative markers) so the next lookup is a
   * genuine fresh network search. Used by the "buscar de nuevo" action.
   */
  async clearTrackLyricsCache(songTitle: string, artist: string, trackId?: string): Promise<void> {
    const keys = new Set<string>();
    if (trackId?.trim()) {
      keys.add(this.getTrackAppleCacheKey(trackId));
      keys.add(this.getTrackLrcCacheKey(trackId));
    }
    for (const key of this.getAppleCacheCandidateKeys(songTitle, artist)) keys.add(key);
    for (const key of this.getLrcCacheCandidateKeys(songTitle, artist)) keys.add(key);

    await Promise.all([...keys].map(key => FileSystemStorage.removeItem(key).catch(() => { })));
    console.log('[LyricsRepository] Cleared lyrics cache for:', songTitle, '/', artist, `(${keys.size} keys)`);
  }

  /**
   * Aggregated lyrics candidates — one (or more) per enabled source. Apple/KPoe come
   * from the word service; LRCLIB is fetched here so it joins the same picker. The
   * resulting set is cached together with which sources were attempted.
   */
  async getAppleWordLyricsOptions(songTitle: string, artist: string, album?: string, durationSec?: number, trackId?: string, isrc?: string, sources?: LyricsSourceId[]): Promise<AppleWordLyricsCandidate[]> {
    if (!songTitle.trim() || !artist.trim()) return [];

    const enabledSources = sources ? sanitizeLyricsSourceIds(sources) : [...DEFAULT_LYRICS_SOURCE_IDS];

    const cached = await this.getCachedAppleWordLyricsOptions(songTitle, artist, trackId, enabledSources);
    if (cached.length > 0) {
      return cached;
    }

    // Apple (binimum TTML) + KPoe come from the word service as a fast waterfall (it
    // returns the first good source and stops). LRCLIB stays the separate fallback in
    // the hook, so we don't slow this path down waiting on it.
    const serviceSources = enabledSources.filter(source => source !== 'lrclib');
    if (serviceSources.length === 0) return [];

    // Skip the network if we recently tried these exact sources and got nothing — this is
    // what stops LRC-only songs from "reloading" on every replay. Expires after the TTL.
    if (await this.hasFreshEmptyAppleAttempt(songTitle, artist, trackId, serviceSources)) {
      console.log('[LyricsRepository] Apple/KPoe recently empty, skipping network:', songTitle, '/', artist);
      return [];
    }

    const options: AppleWordLyricsCandidate[] = [];
    let fetchFailed = false;
    try {
      const result = await appleWordLyricsService.searchWordLyricsOptions(songTitle, artist, album, durationSec, isrc, serviceSources);
      for (const option of result) {
        const candidate = this.toAppleCandidate(option);
        if (candidate) options.push(candidate);
      }
    } catch (error) {
      fetchFailed = true;
      console.warn('[LyricsRepository] Apple/KPoe lyrics failed:', error);
    }

    // Persist results, and also persist a negative marker on a clean "nothing found" run.
    // A thrown/failed fetch is NOT cached, so transient errors keep retrying next time.
    if (options.length > 0 || !fetchFailed) {
      await this.saveCachedAppleWordLyricsOptions(songTitle, artist, options, serviceSources, trackId);
    }
    return options;
  }

  async forceRefreshLyrics(songTitle: string, artist: string): Promise<LyricsPayload | null> {
    if (!songTitle.trim() || !artist.trim()) return null;

    try {
      const result = await nativeForceRefreshLyrics(songTitle, artist);
      return result?.payload ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Fetches lyrics from LRCLIB.
   * Tries native module first (more stable networking), then JS fallback.
   * durationSec must be in SECONDS (not milliseconds).
   */
  async getLrcLibLyrics(songTitle: string, artist: string, durationSec?: number, trackId?: string): Promise<LyricsPayload | null> {
    if (!songTitle.trim() || !artist.trim()) return null;
    console.log(`[LyricsRepository] getLrcLibLyrics: "${songTitle}" / "${artist}" / ${durationSec}s`);

    const cached = await this.getCachedLrcLibLyrics(songTitle, artist, trackId);
    if (cached) {
      return cached;
    }

    try {
      const nativeResult = await nativeGetLrcLibLyrics(songTitle, artist, durationSec);
      if (this.hasLyrics(nativeResult)) {
        console.log('[LyricsRepository] Native LRCLIB result: OK', nativeResult.lyrics.length);
        await this.saveCachedLrcLibLyrics(songTitle, artist, nativeResult as LyricsPayload, trackId);
        return nativeResult as LyricsPayload;
      }
      console.log('[LyricsRepository] Native LRCLIB result: null/empty');
    } catch (error) {
      console.warn('[LyricsRepository] Native LRCLIB failed, using JS fallback:', error);
    }

    const jsResult = await lrcLibService.fetchLyrics(songTitle, artist, durationSec);
    console.log('[LyricsRepository] JS LRCLIB result:', jsResult ? `OK (${jsResult.lyrics?.length} lines)` : 'null');
    if (this.hasLyrics(jsResult)) {
      await this.saveCachedLrcLibLyrics(songTitle, artist, jsResult as LyricsPayload, trackId);
    }
    return jsResult as LyricsPayload | null;
  }
}

export const LyricsRepository = new LyricsRepositoryService();
