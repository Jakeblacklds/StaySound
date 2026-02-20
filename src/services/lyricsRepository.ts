import {
  configureSupabase,
  createCanonicalLyricsKey,
  forceRefreshLyrics as nativeForceRefreshLyrics,
  getLrcLibLyrics as nativeGetLrcLibLyrics,
  getLyrics as nativeGetLyrics,
  normalizeLyricsKeyPart,
} from 'karaoke-view';
import type { KaraokeLyricsJSON } from '../types';
import { lrcLibService } from './lrcLibService';
import { FileSystemStorage } from './storage';

export interface LyricsPayload extends KaraokeLyricsJSON { }

class LyricsRepositoryService {
  private isConfigured = false;
  private readonly LRC_CACHE_PREFIX = 'lrc-lib-cache-v1';

  private getLrcCacheKey(songTitle: string, artist: string): string {
    const canonical = this.canonicalKey(songTitle, artist);
    return `${this.LRC_CACHE_PREFIX}-${encodeURIComponent(canonical)}`;
  }

  private hasLyrics(payload: KaraokeLyricsJSON | null | undefined): payload is KaraokeLyricsJSON {
    return Boolean(payload && Array.isArray(payload.lyrics) && payload.lyrics.length > 0);
  }

  async getCachedLrcLibLyrics(songTitle: string, artist: string): Promise<LyricsPayload | null> {
    if (!songTitle.trim() || !artist.trim()) return null;

    const cacheKey = this.getLrcCacheKey(songTitle, artist);
    const raw = await FileSystemStorage.getItem(cacheKey);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as LyricsPayload;
      if (this.hasLyrics(parsed)) {
        console.log('[LyricsRepository] LRC cache hit:', cacheKey);
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async saveCachedLrcLibLyrics(songTitle: string, artist: string, payload: LyricsPayload): Promise<void> {
    if (!this.hasLyrics(payload)) return;
    const cacheKey = this.getLrcCacheKey(songTitle, artist);
    await FileSystemStorage.setItem(cacheKey, JSON.stringify(payload));
    console.log('[LyricsRepository] LRC cache saved:', cacheKey);
  }

  private configureIfNeeded(): void {
    if (this.isConfigured) return;

    const url = process.env.SUPABASE_URL?.trim() || 'https://ucrtwqwaaadgjoerhgwg.supabase.co';
    const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || 'sb_secret_BBp0Tb2nAaMRP-etSv26GQ_mbR_hQ_p';

    if (url && secretKey) {
      configureSupabase(url, secretKey);
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
  async getLrcLibLyrics(songTitle: string, artist: string, durationSec?: number): Promise<LyricsPayload | null> {
    if (!songTitle.trim() || !artist.trim()) return null;
    console.log(`[LyricsRepository] getLrcLibLyrics: "${songTitle}" / "${artist}" / ${durationSec}s`);

    const cached = await this.getCachedLrcLibLyrics(songTitle, artist);
    if (cached) {
      return cached;
    }

    try {
      const nativeResult = await nativeGetLrcLibLyrics(songTitle, artist, durationSec);
      if (this.hasLyrics(nativeResult)) {
        console.log('[LyricsRepository] Native LRCLIB result: OK', nativeResult.lyrics.length);
        await this.saveCachedLrcLibLyrics(songTitle, artist, nativeResult as LyricsPayload);
        return nativeResult as LyricsPayload;
      }
      console.log('[LyricsRepository] Native LRCLIB result: null/empty');
    } catch (error) {
      console.warn('[LyricsRepository] Native LRCLIB failed, using JS fallback:', error);
    }

    const jsResult = await lrcLibService.fetchLyrics(songTitle, artist, durationSec);
    console.log('[LyricsRepository] JS LRCLIB result:', jsResult ? `OK (${jsResult.lyrics?.length} lines)` : 'null');
    if (this.hasLyrics(jsResult)) {
      await this.saveCachedLrcLibLyrics(songTitle, artist, jsResult as LyricsPayload);
    }
    return jsResult as LyricsPayload | null;
  }
}

export const LyricsRepository = new LyricsRepositoryService();
