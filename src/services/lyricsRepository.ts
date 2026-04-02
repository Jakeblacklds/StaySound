import {
  configureSupabase,
  createCanonicalLyricsKey,
  forceRefreshLyrics as nativeForceRefreshLyrics,
  getLrcLibLyrics as nativeGetLrcLibLyrics,
  getLyrics as nativeGetLyrics,
  normalizeLyricsKeyPart,
} from 'karaoke-view';
import type { KaraokeLyricsJSON } from '../types';
import { appleWordLyricsService } from './appleWordLyricsService';
import { lrcLibService } from './lrcLibService';
import { FileSystemStorage } from './storage';

export interface LyricsPayload extends KaraokeLyricsJSON { }

class LyricsRepositoryService {
  private isConfigured = false;
  private readonly APPLE_CACHE_PREFIX = 'apple-word-cache-v1';
  private readonly TRACK_APPLE_CACHE_PREFIX = 'apple-word-track-cache-v1';
  private readonly LRC_CACHE_PREFIX = 'lrc-lib-cache-v1';
  private readonly TRACK_LRC_CACHE_PREFIX = 'lrc-lib-track-cache-v1';

  private resolveSupabaseConfig(): { url: string; key: string } | null {
    const lyricsUrl =
      process.env.EXPO_PUBLIC_LYRICS_SUPABASE_URL?.trim() ||
      process.env.LYRICS_SUPABASE_URL?.trim() ||
      '';
    const defaultUrl =
      process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ||
      process.env.SUPABASE_URL?.trim() ||
      '';
    const url = lyricsUrl || defaultUrl;
    if (!url) return null;

    const dedicatedLyricsKey =
      process.env.EXPO_PUBLIC_LYRICS_SUPABASE_ANON_KEY?.trim() ||
      process.env.LYRICS_SUPABASE_ANON_KEY?.trim() ||
      process.env.LYRICS_SUPABASE_PUBLISHABLE_KEY?.trim() ||
      process.env.LYRICS_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      '';
    const defaultKey =
      process.env.EXPO_PUBLIC_AUTH_SUPABASE_ANON_KEY?.trim() ||
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
      '';
    const usesDedicatedLyricsProject = Boolean(lyricsUrl && lyricsUrl !== defaultUrl);
    const key = usesDedicatedLyricsProject
      ? dedicatedLyricsKey
      : (dedicatedLyricsKey || defaultKey);

    if (!key) {
      console.warn('[LyricsRepository] Lyrics Supabase is configured without a matching access key.');
      return null;
    }

    return { url, key };
  }

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

  private async getCachedAppleWordLyrics(songTitle: string, artist: string, trackId?: string): Promise<LyricsPayload | null> {
    if (!songTitle.trim() || !artist.trim()) return null;

    if (trackId?.trim()) {
      const trackCacheKey = this.getTrackAppleCacheKey(trackId);
      const trackRaw = await FileSystemStorage.getItem(trackCacheKey);
      if (trackRaw) {
        try {
          const parsed = JSON.parse(trackRaw) as LyricsPayload;
          if (this.hasLyrics(parsed)) {
            console.log('[LyricsRepository] Apple track cache hit:', trackCacheKey);
            return parsed;
          }
        } catch {
          // Fall through to canonical cache keys
        }
      }
    }

    for (const cacheKey of this.getAppleCacheCandidateKeys(songTitle, artist)) {
      const raw = await FileSystemStorage.getItem(cacheKey);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw) as LyricsPayload;
        if (this.hasLyrics(parsed)) {
          console.log('[LyricsRepository] Apple cache hit:', cacheKey);
          return parsed;
        }
      } catch {
        continue;
      }
    }

    return null;
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

  private async saveCachedAppleWordLyrics(songTitle: string, artist: string, payload: LyricsPayload, trackId?: string): Promise<void> {
    if (!this.hasLyrics(payload)) return;
    if (trackId?.trim()) {
      const trackCacheKey = this.getTrackAppleCacheKey(trackId);
      await FileSystemStorage.setItem(trackCacheKey, JSON.stringify(payload));
      console.log('[LyricsRepository] Apple track cache saved:', trackCacheKey);
    }
    for (const cacheKey of this.getAppleCacheCandidateKeys(songTitle, artist)) {
      await FileSystemStorage.setItem(cacheKey, JSON.stringify(payload));
      console.log('[LyricsRepository] Apple cache saved:', cacheKey);
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

  private configureIfNeeded(): void {
    if (this.isConfigured) return;

    const config = this.resolveSupabaseConfig();

    if (config) {
      configureSupabase(config.url, config.key);
    }

    this.isConfigured = true;
  }

  canonicalKey(songTitle: string, artist: string): string {
    return createCanonicalLyricsKey(songTitle, artist);
  }

  normalize(value: string): string {
    return normalizeLyricsKeyPart(value);
  }

  async getLyrics(songTitle: string, artist: string): Promise<LyricsPayload | null> {
    if (!songTitle.trim() || !artist.trim()) return null;
    this.configureIfNeeded();

    try {
      const result = await nativeGetLyrics(songTitle, artist);
      return result?.payload ?? null;
    } catch {
      return null;
    }
  }

  async getAppleWordLyrics(songTitle: string, artist: string, album?: string, durationSec?: number, trackId?: string, isrc?: string): Promise<LyricsPayload | null> {
    if (!songTitle.trim() || !artist.trim()) return null;

    const cached = await this.getCachedAppleWordLyrics(songTitle, artist, trackId);
    if (cached) {
      return cached;
    }

    try {
      const result = await appleWordLyricsService.searchWordLyrics(songTitle, artist, album, durationSec, isrc);
      if (this.hasLyrics(result)) {
        await this.saveCachedAppleWordLyrics(songTitle, artist, result as LyricsPayload, trackId);
        return result as LyricsPayload;
      }
    } catch (error) {
      console.warn('[LyricsRepository] Apple/KPoe lyrics failed:', error);
    }

    return null;
  }

  async forceRefreshLyrics(songTitle: string, artist: string): Promise<LyricsPayload | null> {
    if (!songTitle.trim() || !artist.trim()) return null;
    this.configureIfNeeded();

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
