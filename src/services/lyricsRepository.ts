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
import { FileSystemStorage } from './storage';

export interface LyricsPayload extends KaraokeLyricsJSON { }
export interface AppleWordLyricsCandidate {
  id: string;
  label: string;
  source: 'binimum' | 'kpoe';
  payload: LyricsPayload;
  lyricsUrl?: string;
  timingType?: string;
}

type AppleWordLyricsCachePayload = {
  options: AppleWordLyricsCandidate[];
};

class LyricsRepositoryService {
  private readonly APPLE_CACHE_PREFIX = 'apple-word-cache-v2';
  private readonly TRACK_APPLE_CACHE_PREFIX = 'apple-word-track-cache-v2';
  private readonly LRC_CACHE_PREFIX = 'lrc-lib-cache-v1';
  private readonly TRACK_LRC_CACHE_PREFIX = 'lrc-lib-track-cache-v1';

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
      payload: option.payload as LyricsPayload,
      lyricsUrl: option.lyricsUrl,
      timingType: option.timingType,
    };
  }

  private normalizeCachedAppleOptions(rawValue: string): AppleWordLyricsCandidate[] {
    try {
      const parsed = JSON.parse(rawValue) as AppleWordLyricsCachePayload | LyricsPayload;
      if (Array.isArray((parsed as AppleWordLyricsCachePayload).options)) {
        return (parsed as AppleWordLyricsCachePayload).options.filter(option => this.hasLyrics(option?.payload));
      }

      if (this.hasLyrics(parsed as LyricsPayload)) {
        return [{
          id: 'legacy-1',
          label: 'Opción 1',
          source: 'binimum',
          payload: parsed as LyricsPayload,
        }];
      }
    } catch {
      return [];
    }

    return [];
  }

  async getCachedAppleWordLyricsOptions(songTitle: string, artist: string, trackId?: string): Promise<AppleWordLyricsCandidate[]> {
    if (!songTitle.trim() || !artist.trim()) return [];

    if (trackId?.trim()) {
      const trackCacheKey = this.getTrackAppleCacheKey(trackId);
      const trackRaw = await FileSystemStorage.getItem(trackCacheKey);
      if (trackRaw) {
        const parsedOptions = this.normalizeCachedAppleOptions(trackRaw);
        if (parsedOptions.length > 0) {
          console.log('[LyricsRepository] Apple track cache hit:', trackCacheKey, parsedOptions.length);
          return parsedOptions;
        }
      }
    }

    for (const cacheKey of this.getAppleCacheCandidateKeys(songTitle, artist)) {
      const raw = await FileSystemStorage.getItem(cacheKey);
      if (!raw) continue;

      const parsedOptions = this.normalizeCachedAppleOptions(raw);
      if (parsedOptions.length > 0) {
        console.log('[LyricsRepository] Apple cache hit:', cacheKey, parsedOptions.length);
        return parsedOptions;
      }
    }

    return [];
  }

  private async getCachedAppleWordLyrics(songTitle: string, artist: string, trackId?: string): Promise<LyricsPayload | null> {
    const options = await this.getCachedAppleWordLyricsOptions(songTitle, artist, trackId);
    return options[0]?.payload ?? null;
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

  private async saveCachedAppleWordLyricsOptions(songTitle: string, artist: string, options: AppleWordLyricsCandidate[], trackId?: string): Promise<void> {
    const safeOptions = options.filter(option => this.hasLyrics(option.payload));
    if (safeOptions.length === 0) return;
    const serialized = JSON.stringify({ options: safeOptions });

    if (trackId?.trim()) {
      const trackCacheKey = this.getTrackAppleCacheKey(trackId);
      await FileSystemStorage.setItem(trackCacheKey, serialized);
      console.log('[LyricsRepository] Apple track cache saved:', trackCacheKey);
    }
    for (const cacheKey of this.getAppleCacheCandidateKeys(songTitle, artist)) {
      await FileSystemStorage.setItem(cacheKey, serialized);
      console.log('[LyricsRepository] Apple cache saved:', cacheKey);
    }
  }

  private async saveCachedAppleWordLyrics(songTitle: string, artist: string, payload: LyricsPayload, trackId?: string): Promise<void> {
    await this.saveCachedAppleWordLyricsOptions(songTitle, artist, [{
      id: 'legacy-1',
      label: 'Opción 1',
      source: 'binimum',
      payload,
    }], trackId);
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

  async getAppleWordLyrics(songTitle: string, artist: string, album?: string, durationSec?: number, trackId?: string, isrc?: string): Promise<LyricsPayload | null> {
    const options = await this.getAppleWordLyricsOptions(songTitle, artist, album, durationSec, trackId, isrc);
    return options[0]?.payload ?? null;
  }

  async getAppleWordLyricsOptions(songTitle: string, artist: string, album?: string, durationSec?: number, trackId?: string, isrc?: string): Promise<AppleWordLyricsCandidate[]> {
    if (!songTitle.trim() || !artist.trim()) return [];

    const cached = await this.getCachedAppleWordLyricsOptions(songTitle, artist, trackId);
    if (cached.length > 0) {
      return cached;
    }

    try {
      const result = await appleWordLyricsService.searchWordLyricsOptions(songTitle, artist, album, durationSec, isrc);
      const options = result
        .map(option => this.toAppleCandidate(option))
        .filter((option): option is AppleWordLyricsCandidate => Boolean(option));

      if (options.length > 0) {
        await this.saveCachedAppleWordLyricsOptions(songTitle, artist, options, trackId);
        return options;
      }
    } catch (error) {
      console.warn('[LyricsRepository] Apple/KPoe lyrics failed:', error);
    }

    return [];
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
