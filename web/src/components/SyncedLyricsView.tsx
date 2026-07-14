import '@uimaxbai/am-lyrics/am-lyrics.js';
import { useEffect, useMemo, useRef } from 'react';
import type { Track } from '@staysound/types/audio';
import { webAudioEngine } from '../audio/webAudioEngine';
import {
  getLyricsFont,
  type LyricsFontDefinition,
  type LyricsFontId,
} from '../library/lyricsFonts';
import {
  getLyricsTheme,
  LYRICS_THEME_HOST_VARS,
  type LyricsThemeId,
} from '../library/lyricsThemes';

interface SyncedLyricsViewProps {
  currentTrack: Track;
  isPlaying: boolean;
  position: number;
  duration: number;
  onSeek: (position: number) => void;
  theme?: LyricsThemeId;
  font?: LyricsFontId;
}

type AmLyricsElement = HTMLElement & {
  songTitle?: string;
  songArtist?: string;
  songAlbum?: string;
  songDuration?: number;
  query?: string;
  currentTime?: number;
  duration?: number;
  highlightColor?: string;
  fontFamily?: string;
  autoscroll?: boolean;
  interpolate?: boolean;
};

const LYRICS_POLISH_STYLE_ID = 'staysound-lyrics-polish';

function buildLyricsQuery(track: Track): string {
  return [track.title, track.artist, track.album]
    .filter(value => value && !/^unknown/i.test(value))
    .join(' ');
}

function getTrackDuration(currentTrack: Track, duration: number): number {
  return duration || currentTrack.duration || 0;
}

function readSolidCssColor(element: HTMLElement, variableName: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(variableName).trim();
  if (!value) return fallback;

  const test = new Option().style;
  test.color = value;
  return test.color ? value : fallback;
}

/**
 * am-lyrics measures per-char glyph widths with canvas measureText using
 * `getComputedStyle(syllable).font`, but Chrome serializes that shorthand as
 * an empty string, so `ctx.font = ''` is a no-op and every wipe was being
 * timed with the canvas default font instead of the rendered one. Shadow the
 * engine's `_getTextWidth` to rebuild a canvas-valid font string from the
 * longhands whenever the shorthand comes in empty. If upstream renames the
 * method the patch silently no-ops, which just leaves upstream behavior.
 */
function patchCharMeasurement(element: AmLyricsElement): void {
  const internal = element as unknown as {
    _getTextWidth?: (text: string, font: string) => number;
    __ssMeasurePatched?: boolean;
  };
  if (internal.__ssMeasurePatched || typeof internal._getTextWidth !== 'function') return;

  const original = internal._getTextWidth.bind(element);
  internal._getTextWidth = (text: string, font: string) => {
    let effective = font;
    if (!effective || !effective.trim()) {
      const syllable = element.shadowRoot?.querySelector('.lyrics-syllable');
      if (syllable) {
        const style = getComputedStyle(syllable);
        effective = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      }
    }
    return original(text, effective);
  };
  internal.__ssMeasurePatched = true;
}

/**
 * The engine only re-measures char widths when its `lyrics` state changes —
 * never on font changes, and its own measuring pass can run before the web
 * font (or the lyrics DOM) is actually ready. After the font loads we either
 * re-assign the same lines (full refresh, re-applies the active line's
 * inline animations) or, when lyrics haven't arrived yet, watch for them and
 * re-run the measuring pass directly. Returns a cancel function.
 */
function recalibrateFillMetrics(
  element: AmLyricsElement,
  font: LyricsFontDefinition,
): () => void {
  let cancelled = false;
  let watchTimer = 0;

  const internal = element as unknown as {
    lyrics?: object[];
    _updateCharTimingData?: () => void;
  };

  const fontReady = font.loadFamily
    ? // Lyrics render at font-weight: bold; load that face specifically.
      document.fonts.load(`bold 32px "${font.loadFamily}"`).then(() => true, () => false)
    : Promise.resolve(true);

  void fontReady.then(loaded => {
    // On load failure the fallback font renders; its metrics were already
    // measured, so skipping keeps the timing consistent with what's shown.
    if (!loaded || cancelled || !element.isConnected) return;

    if (Array.isArray(internal.lyrics)) {
      internal.lyrics = [...internal.lyrics];
      return;
    }

    // Lyrics are still being fetched: re-measure as soon as they render,
    // since the engine's own pass may have already run against a font that
    // wasn't loaded at that point.
    watchTimer = window.setInterval(() => {
      if (cancelled || !element.isConnected) {
        window.clearInterval(watchTimer);
        return;
      }
      if (Array.isArray(internal.lyrics) && element.shadowRoot?.querySelector('.lyrics-syllable')) {
        window.clearInterval(watchTimer);
        internal._updateCharTimingData?.();
      }
    }, 250);
  });

  return () => {
    cancelled = true;
    if (watchTimer) window.clearInterval(watchTimer);
  };
}

function installLyricsPolish(element: AmLyricsElement, themeCss: string): void {
  const root = element.shadowRoot;
  if (!root) return;

  let style = root.querySelector<HTMLStyleElement>(`style[data-id="${LYRICS_POLISH_STYLE_ID}"]`);
  if (!style) {
    style = document.createElement('style');
    style.dataset.id = LYRICS_POLISH_STYLE_ID;
    root.appendChild(style);
  }

  style.textContent = `
    .lyrics-container {
      padding-inline: clamp(22px, 3.2vw, 46px);
    }

    .lyrics-line-container {
      max-width: 100%;
    }

    @media (max-width: 820px) {
      .lyrics-container {
        padding-inline: clamp(18px, 6vw, 34px);
      }
    }

    ${themeCss}
  `;
}

export function SyncedLyricsView({
  currentTrack,
  isPlaying,
  position,
  duration,
  onSeek,
  theme = 'wipe',
  font = 'classic',
}: SyncedLyricsViewProps) {
  const lyricsRef = useRef<AmLyricsElement | null>(null);
  const safeDuration = getTrackDuration(currentTrack, duration);
  const query = useMemo(() => buildLyricsQuery(currentTrack), [currentTrack]);
  const activeTheme = useMemo(() => getLyricsTheme(theme), [theme]);
  const activeFont = useMemo(() => getLyricsFont(font), [font]);

  useEffect(() => {
    const element = lyricsRef.current;
    if (!element) return;

    element.songTitle = currentTrack.title;
    element.songArtist = currentTrack.artist;
    element.songAlbum = currentTrack.album;
    element.songDuration = safeDuration;
    element.query = query;
    element.currentTime = position;
    element.duration = safeDuration;
    const lyricsPrimary = readSolidCssColor(element, '--fp-primary', '#f8fbff');
    const lyricsSecondary = `color-mix(in srgb, ${lyricsPrimary} 42%, transparent)`;

    element.highlightColor = lyricsPrimary;
    element.fontFamily = activeFont.stack;
    element.autoscroll = true;
    element.interpolate = true;
    element.style.setProperty('--lyplus-font-size-base', 'clamp(32px, 3.8vh, 46px)');
    element.style.setProperty('--lyplus-font-size-base-grow', '24.5');
    element.style.setProperty('--char-rise-y', 'calc(-0.035 * var(--lyplus-font-size-base))');
    element.style.setProperty('--am-lyrics-highlight-color', lyricsPrimary);
    element.style.setProperty('--highlight-color', lyricsPrimary);
    element.style.setProperty('--lyplus-lyrics-palette', lyricsPrimary);
    element.style.setProperty('--lyplus-text-primary', lyricsPrimary);
    element.style.setProperty('--lyplus-text-secondary', lyricsSecondary);

    // Reset any vars a previously selected theme set, then apply the
    // current theme's overrides on top of the defaults above.
    for (const varName of LYRICS_THEME_HOST_VARS) {
      if (!(varName in activeTheme.hostVars)) element.style.removeProperty(varName);
    }
    for (const [varName, value] of Object.entries(activeTheme.hostVars)) {
      element.style.setProperty(varName, value);
    }
    installLyricsPolish(element, activeTheme.shadowCss);

    const polishTimer = window.setTimeout(() => installLyricsPolish(element, activeTheme.shadowCss), 160);
    return () => window.clearTimeout(polishTimer);
  }, [currentTrack, position, query, safeDuration, activeTheme, activeFont]);

  useEffect(() => {
    const element = lyricsRef.current;
    if (!element) return;

    // Apply the stack synchronously so the engine's next measurement (and the
    // recalibration below) reads the new computed font.
    element.fontFamily = activeFont.stack;
    element.style.fontFamily = activeFont.stack;
    patchCharMeasurement(element);
    return recalibrateFillMetrics(element, activeFont);
  }, [activeFont, currentTrack]);

  useEffect(() => {
    const element = lyricsRef.current;
    if (!element) return;

    const handleLineClick = (event: Event) => {
      const detail = (event as CustomEvent<{ timestamp?: number }>).detail;
      if (typeof detail?.timestamp !== 'number') return;
      onSeek(detail.timestamp);
      void webAudioEngine.play();
    };

    element.addEventListener('line-click', handleLineClick);
    return () => element.removeEventListener('line-click', handleLineClick);
  }, [onSeek]);

  useEffect(() => {
    const element = lyricsRef.current;
    if (!element) return;

    let rafId = 0;
    const syncTime = () => {
      element.currentTime = Math.round(webAudioEngine.getCurrentTime() * 1000);
      rafId = requestAnimationFrame(syncTime);
    };

    if (isPlaying) {
      rafId = requestAnimationFrame(syncTime);
      return () => cancelAnimationFrame(rafId);
    }

    element.currentTime = position;
    return undefined;
  }, [isPlaying, position]);

  return (
    <div className="synced-lyrics-view">
      <am-lyrics
        key={currentTrack.id}
        ref={lyricsRef}
        song-title={currentTrack.title}
        song-artist={currentTrack.artist}
        song-album={currentTrack.album}
        song-duration={safeDuration}
        query={query}
        current-time={position}
        duration={safeDuration}
        highlight-color="var(--fp-primary)"
        font-family={activeFont.stack}
        autoscroll
        interpolate
      />
    </div>
  );
}
