import '@uimaxbai/am-lyrics/am-lyrics.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Track } from '@staysound/types/audio';
import { webAudioEngine } from '../audio/webAudioEngine';
import type { WebDynamicPalette } from '../library/dynamicColors';
import {
  getLyricsFont,
  type LyricsFontDefinition,
  type LyricsFontId,
} from '../library/lyricsFonts';
import {
  buildLyricsLookupQuery,
  cleanLyricsLookupMetadata,
} from '../library/lyricsLookupMetadata';
import { lyricsSourcesStore } from '../library/lyricsSources';
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
  palette?: WebDynamicPalette | null;
  /** Positive values display each lyric earlier than its source timestamp. */
  timingOffsetMs?: number;
  onAvailabilityChange?: (hasLyrics: boolean) => void;
}

type AmLyricsElement = HTMLElement & {
  songTitle?: string;
  songArtist?: string;
  songAlbum?: string;
  songDuration?: number;
  songDurationMs?: number;
  isrc?: string;
  query?: string;
  ttml?: string;
  currentTime?: number;
  duration?: number;
  highlightColor?: string;
  fontFamily?: string;
  autoscroll?: boolean;
  interpolate?: boolean;
};

const LYRICS_SEEK_THRESHOLD_MS = 1_000;

/**
 * Largest gap between two frames that still counts as ordinary playback.
 * Anything beyond it (or any step backwards) is the media clock jumping.
 */
const LYRICS_TICK_TOLERANCE_MS = 250;

/**
 * Re-start the per-character wipes that are mid-flight, so the engine's next
 * update anchors them to the seek instead of to where they already were.
 *
 * am-lyrics paints each character as a CSS animation whose `animation-delay`
 * encodes how far into the word the audio already is at the moment the
 * syllable lights up; from then on the wipe runs on the wall clock and nothing
 * re-syncs it to the media element. On a seek the engine recomputes those
 * delays — but CSS animations are keyed by `animation-name`, so writing a new
 * shorthand with the same names *updates* the running animation instead of
 * replacing it, and it keeps the start time it was given before the seek. The
 * engine does blank the shorthand first, yet the blanking and the re-anchor
 * happen inside the same task, so whether the browser ever resolves style in
 * between — and therefore whether the wipe truly restarts — comes down to
 * incidental layout reads and differs between Chromium and the WKWebView that
 * backs the Tauri build. Cancel the wipes here and resolve style once, so the
 * re-anchored animations are always new ones that begin at the seek.
 */
function restartWipeAnimations(
  element: AmLyricsElement,
  fromMs: number,
  toMs: number,
): void {
  const root = element.shadowRoot;
  if (!root) return;

  const low = Math.min(fromMs, toMs);
  const high = Math.max(fromMs, toMs);
  const cleared: HTMLElement[] = [];

  for (const line of root.querySelectorAll<HTMLElement>('.lyrics-line')) {
    const start = Number.parseFloat(line.dataset.startTime ?? '');
    const end = Number.parseFloat(line.dataset.endTime ?? '');
    const spansSeek =
      Number.isFinite(start) && Number.isFinite(end) && end >= low && start <= high;

    // Verses outside the seek keep their animations: a finished wipe holds its
    // end state through `forwards`, so cancelling it would repaint an
    // already-sung line as unsung.
    if (
      !spansSeek &&
      !line.classList.contains('active') &&
      !line.classList.contains('pre-active')
    ) {
      continue;
    }

    for (const node of line.querySelectorAll<HTMLElement>('.lyrics-syllable, span.char')) {
      if (!node.style.animation) continue;
      node.style.animation = 'none';
      cleared.push(node);
    }
  }

  if (cleared.length === 0) return;

  // Resolve style now so the browser observes `none` and drops the running
  // animations. Nothing paints inside this task, so the blank state is never
  // visible.
  void element.offsetWidth;
  for (const node of cleared) node.style.removeProperty('animation');
}

/**
 * am-lyrics identifies a seek by comparing consecutive `currentTime` values.
 * That misses short backward seeks (for example when the user fine-tunes the
 * progress bar), leaving the previous word's wipe active.  Prime the element
 * with an off-timeline value in the same task so its final update is always
 * processed as a seek. Nothing is painted between the two assignments.
 */
function setLyricsTime(
  element: AmLyricsElement,
  timeMs: number,
  forceSeek = false,
): void {
  const target = Math.max(0, Math.round(timeMs));
  const current = Number(element.currentTime ?? 0);

  if (!forceSeek) {
    element.currentTime = target;
    return;
  }

  if (Math.abs(target - current) <= LYRICS_SEEK_THRESHOLD_MS) {
    element.currentTime = target + LYRICS_SEEK_THRESHOLD_MS + 1;
  }

  restartWipeAnimations(element, current, target);
  element.currentTime = target;
}

const LYRICS_POLISH_STYLE_ID = 'staysound-lyrics-polish';

function buildLyricsQuery(track: Track): string {
  return buildLyricsLookupQuery(track);
}

function getTrackDuration(currentTrack: Track, duration: number): number {
  return duration || currentTrack.duration || 0;
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
 * font (or the lyrics DOM) is actually ready. Re-run only the measurement
 * pass once both are ready; replacing `lyrics` here would re-render the whole
 * shadow tree and restart the active line's animations.
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

    if (Array.isArray(internal.lyrics) && element.shadowRoot?.querySelector('.lyrics-syllable')) {
      internal._updateCharTimingData?.();
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
    /* am-lyrics renders its own footer credit — "am-lyrics v1.5.6 · Star me on
       GitHub", linking out to the library's repo. It was the only outbound link
       in StaySound and it sat on the full player, the screen you look at while
       listening. The songwriter credit right above it is real attribution and
       stays. */
    .version-info { display: none !important; }

    .lyrics-container {
      /* The shadow viewport should run edge-to-edge vertically.  The previous
         large top/bottom insets made the lyrics look like they were inside a
         separate card and could clip the first/last verses. */
      padding-inline: clamp(8px, 1.4vw, 24px);
      padding-top: 0;
      padding-bottom: clamp(16px, 4vh, 56px);
      border-radius: 0;
    }

    .lyrics-line {
      /* Keep the stanza rhythm without adding a second vertical container. */
      padding-block: clamp(16px, 2.8vh, 30px);
      /* Avoid a permanent compositor layer for every verse. */
      mix-blend-mode: normal;
      will-change: auto;
    }

    /* When the next line begins a few milliseconds before the outgoing
       line's final syllable ends, preserve the active paint just long enough
       for that wipe to finish. The observer below removes this class at the
       source line's real end time; only then does the normal soft release run. */
    .lyrics-line.ss-tail-finishing {
      opacity: 1 !important;
      filter: none !important;
    }

    .lyrics-line.ss-tail-finishing:not(.lyrics-gap) .lyrics-syllable {
      transition:
        transform 1s ease,
        background-color 0.5s,
        color 0.5s;
    }

    .lyrics-line.ss-tail-finishing:not(.lyrics-gap)
      .lyrics-syllable.highlight.no-chars,
    .lyrics-line.ss-tail-finishing:not(.lyrics-gap)
      .lyrics-syllable.pre-highlight.no-chars {
      background-repeat: no-repeat;
      background-image: linear-gradient(
        90deg,
        var(--lyplus-text-primary, #fff) 0%,
        var(--lyplus-text-primary, #fff)
          calc(100% - var(--wipe-gradient-width, 0.75em)),
        transparent 100%
      );
      background-position: left;
    }

    .lyrics-line.ss-tail-finishing:not(.lyrics-gap)
      .lyrics-syllable.highlight.rtl-text,
    .lyrics-line.ss-tail-finishing:not(.lyrics-gap)
      .lyrics-syllable.pre-highlight.rtl-text {
      direction: rtl;
      background-image: linear-gradient(
        -90deg,
        var(--lyplus-text-primary, #fff) 0%,
        var(--lyplus-text-primary, #fff)
          calc(100% - var(--wipe-gradient-width, 0.75em)),
        transparent 100%
      );
      background-position: right 0%;
    }

    .lyrics-line.ss-tail-finishing .lyrics-syllable span.char {
      background-clip: text;
      -webkit-background-clip: text;
      background-repeat: no-repeat;
      background-image:
        linear-gradient(
          90deg,
          transparent 0%,
          var(--lyplus-text-primary, #fff) 50%,
          transparent 100%
        ),
        linear-gradient(
          90deg,
          var(--lyplus-text-primary, #fff) 100%,
          transparent 100%
        );
      background-size:
        var(--wipe-gradient-width, 0.75em) 100%,
        0% 100%;
      background-position:
        calc(-1 * var(--wipe-gradient-width, 0.75em)) 0%,
        left;
    }

    .lyrics-line.ss-tail-finishing .lyrics-syllable span.char.highlight {
      background-image: linear-gradient(
        -90deg,
        var(--lyplus-text-primary, #fff) 0%,
        var(--lyplus-text-primary, #fff)
          calc(100% - var(--wipe-gradient-width, 0.75em)),
        transparent 100%
      );
    }

    .lyrics-line.ss-tail-finishing .lyrics-syllable.finished,
    .lyrics-line.ss-tail-finishing .lyrics-syllable.finished span.char {
      background-color: var(--lyplus-text-primary) !important;
    }

    /* Once the wipe has reached the source line end, collapse any remaining
       per-character gradient into one solid highlight. This prevents the last
       word from dimming during the tiny gap before the line scrolls upward. */
    .lyrics-line.ss-tail-complete .lyrics-syllable,
    .lyrics-line.ss-tail-complete .lyrics-syllable span.char {
      background-image: none !important;
      background-color: var(--lyplus-text-primary) !important;
    }

    /* Line-synced TTML represents a whole phrase rather than timed words.
       am-lyrics deliberately paints those phrases with the color property and resets
       the background shorthand, which also resets background-clip to the
       element box. Never feed the word-level completion background into that
       mode: it would render as a solid rectangle behind the previous phrase.
       Phrase lyrics transition through text color only. */
    .lyrics-syllable.line-synced,
    .lyrics-syllable.line-synced.finished,
    .lyrics-line.ss-tail-finishing .lyrics-syllable.line-synced,
    .lyrics-line.ss-tail-complete .lyrics-syllable.line-synced {
      background: transparent !important;
      background-image: none !important;
      background-color: transparent !important;
      color: var(--lyplus-text-secondary) !important;
    }

    .lyrics-line.active .lyrics-syllable.line-synced,
    .lyrics-line.pre-active .lyrics-syllable.line-synced,
    .lyrics-line.ss-tail-finishing .lyrics-syllable.line-synced,
    .lyrics-line.ss-tail-complete .lyrics-syllable.line-synced {
      color: var(--lyplus-text-primary) !important;
    }

    /* Animate the inner text wrapper, never .lyrics-line itself: am-lyrics
       owns the line transform for autoscroll and must remain uninterrupted. */
    .lyrics-line-container {
      animation: staysound-line-reveal 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .lyrics-line:nth-child(2) .lyrics-line-container { animation-delay: 35ms; }
    .lyrics-line:nth-child(3) .lyrics-line-container { animation-delay: 70ms; }
    .lyrics-line:nth-child(4) .lyrics-line-container { animation-delay: 105ms; }
    .lyrics-line:nth-child(5) .lyrics-line-container { animation-delay: 140ms; }
    .lyrics-line:nth-child(6) .lyrics-line-container { animation-delay: 175ms; }
    .lyrics-line:nth-child(7) .lyrics-line-container { animation-delay: 210ms; }
    .lyrics-line:nth-child(n + 8) .lyrics-line-container { animation-delay: 245ms; }

    @keyframes staysound-line-reveal {
      from {
        opacity: 0;
        transform: translate3d(0, 14px, 0);
        filter: blur(4px);
      }
      to {
        opacity: 1;
        transform: translate3d(0, 0, 0);
        filter: blur(0);
      }
    }

    /* am-lyrics intentionally keeps the finished markers around until an
       outgoing line has crossed the reading anchor. With large StaySound
       type that can leave the previous stanza fully lit beside the new one.
       Preserve the markers (and therefore the motion state), but let their
       color settle softly as soon as the line itself stops being active.

       line-synced syllables are excluded for the reason spelled out above:
       they paint through the color property with background-clip reset to the
       element box, so any background-color here renders as a solid rectangle
       behind the phrase. This selector outranks the .lyrics-syllable
       .line-synced guard, so the exclusion has to live here rather than
       relying on that guard to win the cascade. */
    .lyrics-container:not(.is-unsynced)
      .lyrics-line:not(.active):not(.pre-active):not(.ss-tail-finishing):not(.lyrics-gap)
      .lyrics-syllable.finished:not(.line-synced),
    .lyrics-container:not(.is-unsynced)
      .lyrics-line:not(.active):not(.pre-active):not(.ss-tail-finishing):not(.lyrics-gap)
      .lyrics-syllable.finished:not(.line-synced) span.char {
      background-color: var(--lyplus-text-secondary) !important;
      transition:
        background-color 900ms cubic-bezier(0.22, 1, 0.36, 1),
        color 900ms cubic-bezier(0.22, 1, 0.36, 1),
        transform 960ms cubic-bezier(0.22, 1, 0.36, 1) !important;
    }

    /* persist-highlight normally exempts the outgoing stanza from blur.
       Override only the nearest previous line, and only after it is no
       longer active, so blur and color release feel like one long breath. */
    .lyrics-container.blur-inactive-enabled:not(.not-focused)
      .lyrics-line.post-active-line:not(.active):not(.pre-active):not(.ss-tail-finishing):not(.lyrics-gap) {
      filter: blur(var(--lyplus-blur-amount-near)) !important;
      transition:
        opacity 900ms cubic-bezier(0.22, 1, 0.36, 1),
        filter 900ms cubic-bezier(0.22, 1, 0.36, 1),
        transform var(--scroll-duration, 400ms) cubic-bezier(0.41, 0, 0.12, 0.99)
          var(--lyrics-line-delay, 0ms) !important;
    }

    .lyrics-line-container {
      width: 100%;
      max-width: min(100%, 32ch);
      text-wrap: pretty;
    }

    .lyrics-footer {
      /* Leave only enough tail room for the final line to scroll into the
         reading position; do not append a half-screen blank panel. */
      padding-bottom: clamp(16px, 4vh, 56px);
    }

    @media (max-width: 820px) {
      .lyrics-container {
        padding-inline: clamp(18px, 6vw, 34px);
      }

      .lyrics-line-container {
        max-width: min(100%, 26ch);
      }
    }

    @media (min-width: 1800px) and (min-height: 900px) {
      .lyrics-container {
        --lyplus-font-size-base: clamp(48px, 4.8vh, 72px);
        padding-inline: clamp(22px, 2vw, 42px);
      }

      .lyrics-line {
        padding-block: clamp(22px, 3.1vh, 38px);
      }

      .lyrics-line-container {
        max-width: min(100%, 34ch);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .lyrics-line-container {
        animation: none !important;
      }
    }

    ${themeCss}

    /* “Sala de escucha”: readable editorial lyrics. Inactive verses recede
       through tone, never through the heavy blur used by the old scene. */
    .lyrics-container .lyrics-line,
    .lyrics-container.blur-inactive-enabled .lyrics-line,
    .lyrics-container.blur-inactive-enabled:not(.not-focused) .lyrics-line.post-active-line {
      filter: none !important;
    }

    .lyrics-line:not(.active):not(.pre-active) {
      opacity: .34 !important;
    }

    .lyrics-line.active,
    .lyrics-line.pre-active {
      opacity: 1 !important;
    }

    /* The cue is always outside the text box. Keeping it out of layout means
       changing the active line never nudges the lyric horizontally. */
    .lyrics-line:not(.lyrics-gap) .lyrics-line-container {
      position: relative;
    }

    .lyrics-line:not(.lyrics-gap) .lyrics-line-container::before {
      content: '';
      position: absolute;
      left: clamp(-22px, -1.5vw, -14px);
      top: .16em;
      width: 2px;
      height: .78em;
      background: #d86f3f;
      opacity: 0;
      transform: scaleY(.18);
      transform-origin: center;
      transition:
        opacity 160ms cubic-bezier(.2, 0, 0, 1),
        transform 240ms cubic-bezier(.16, 1, .3, 1);
    }

    .lyrics-line.active .lyrics-line-container::before,
    .lyrics-line.pre-active .lyrics-line-container::before {
      opacity: 1;
      transform: scaleY(1);
    }

    @media (prefers-reduced-motion: reduce) {
      .lyrics-line:not(.lyrics-gap) .lyrics-line-container::before {
        transition-duration: 1ms !important;
      }
    }
  `;
}

function installTailCompletionGuard(element: AmLyricsElement): () => void {
  const root = element.shadowRoot;
  if (!root) return () => undefined;

  const releaseTimers = new Map<HTMLElement, number>();
  const release = (line: HTMLElement) => {
    const timer = releaseTimers.get(line);
    if (timer) window.clearTimeout(timer);
    releaseTimers.delete(line);
    line.classList.remove('ss-tail-finishing', 'ss-tail-complete');
  };

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type !== 'attributes' || record.attributeName !== 'class') continue;
      const line = record.target as HTMLElement;
      const wasActive = (record.oldValue ?? '').split(/\s+/).includes('active');
      if (!wasActive || line.classList.contains('active') || line.classList.contains('lyrics-gap')) {
        continue;
      }

      // Phrase-level (line-synced) lyrics have no per-word wipe to protect,
      // and holding them at full opacity past their end time just leaves the
      // outgoing phrase lit next to the new one.
      if (line.querySelector('.lyrics-syllable.line-synced')) continue;

      const lineEnd = Number.parseFloat(line.getAttribute('data-end-time') || '');
      const currentTime = Number(element.currentTime ?? 0);
      if (!Number.isFinite(lineEnd) || !Number.isFinite(currentTime)) continue;

      // A newly active line always owns the reading anchor. The outgoing
      // line may finish only a very short visual tail; it must never remain
      // fully lit while the next lyric has already begun.
      const replacementIsActive = Array.from(
        root.querySelectorAll<HTMLElement>('.lyrics-line.active'),
      ).some(activeLine => activeLine !== line);
      if (replacementIsActive) {
        release(line);
        continue;
      }
      const remaining = Math.min(180, Math.max(0, lineEnd - currentTime));

      release(line);
      line.classList.add('ss-tail-finishing');
      releaseTimers.set(line, window.setTimeout(() => {
        releaseTimers.delete(line);

        // The engine no longer updates this outgoing line, so its last
        // syllable may finish the CSS wipe without receiving `.finished`.
        // Normalize the whole line first, hold the completed highlight for a
        // brief perceptual beat, then hand it to the existing 900ms fade.
        line.querySelectorAll<HTMLElement>('.lyrics-syllable').forEach(syllable => {
          syllable.classList.remove('highlight', 'pre-highlight');
          syllable.classList.add('finished');
        });
        line.classList.add('ss-tail-complete');

        releaseTimers.set(line, window.setTimeout(() => release(line), 100));
      }, remaining));
    }
  });

  observer.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
    attributeOldValue: true,
  });

  return () => {
    observer.disconnect();
    for (const [line, timer] of releaseTimers) {
      window.clearTimeout(timer);
      line.classList.remove('ss-tail-finishing', 'ss-tail-complete');
    }
    releaseTimers.clear();
  };
}

export function SyncedLyricsView({
  currentTrack,
  isPlaying,
  position,
  duration,
  onSeek,
  theme = 'wipe',
  font = 'classic',
  palette = null,
  timingOffsetMs = 0,
  onAvailabilityChange,
}: SyncedLyricsViewProps) {
  // The element is kept in state (not a ref) on purpose: the cache lookup
  // renders a loading placeholder first, so <am-lyrics> mounts on a later
  // render whose effect dependencies haven't changed. Storing it in state
  // re-runs every configuration effect the moment the element actually exists.
  const [lyricsElement, setLyricsElement] = useState<AmLyricsElement | null>(null);
  const safeDuration = getTrackDuration(currentTrack, duration);
  const query = useMemo(() => buildLyricsQuery(currentTrack), [currentTrack]);
  const searchMetadata = useMemo(() => ({
    title: cleanLyricsLookupMetadata(currentTrack.title) || currentTrack.title,
    artist: cleanLyricsLookupMetadata(currentTrack.artist) || currentTrack.artist,
    album: cleanLyricsLookupMetadata(currentTrack.album) || currentTrack.album,
  }), [currentTrack.title, currentTrack.artist, currentTrack.album]);
  const activeTheme = useMemo(() => getLyricsTheme(theme), [theme]);
  const activeFont = useMemo(() => getLyricsFont(font), [font]);
  const attachLyricsElement = useCallback((element: AmLyricsElement | null) => {
    if (element) {
      // FullPlayer is mounted after playback may already be well underway.
      // Seed the custom element from the live media clock during the commit
      // itself, before its fetch/render cycle or the first effect/paint.
      setLyricsTime(
        element,
        Math.round(webAudioEngine.getCurrentTime() * 1000) + timingOffsetMs,
        true,
      );
    }
    setLyricsElement(element);
  }, [currentTrack.id, timingOffsetMs]);

  useEffect(() => {
    const element = lyricsElement;
    if (!element) return;

    // The custom element already receives these values as attributes below.
    // Reassigning them here after connectedCallback() causes am-lyrics to run
    // its full network lookup again when Lit observes the property changes.
    // Keep only the imperative display configuration in this effect.
    // The artwork palette is resolved asynchronously. Passing its concrete
    // colors prevents the web component from freezing the initial CSS-var
    // fallback before extraction finishes.
    const lyricsPrimary = '#e6dfd2';
    const lyricsSecondary = 'rgba(184, 176, 163, .58)';

    element.highlightColor = lyricsPrimary;
    element.fontFamily = activeFont.stack;
    element.autoscroll = true;
    element.interpolate = true;
    element.style.setProperty(
      '--lyplus-font-size-base',
      'clamp(32px, max(3.8vh, 2.4vw), 52px)',
    );
    element.style.setProperty('--lyplus-font-size-base-grow', '24.5');
    element.style.setProperty('--char-rise-y', 'calc(-0.035 * var(--lyplus-font-size-base))');
    // Keep the active stanza above the visual centre so the previous line can
    // finish leaving while there is useful reading space below for the next.
    element.style.setProperty('--lyrics-scroll-padding-top', '38%');
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
  }, [
    lyricsElement,
    currentTrack.id,
    currentTrack.title,
    currentTrack.artist,
    currentTrack.album,
    query,
    safeDuration,
    activeTheme,
    activeFont,
  ]);

  useEffect(() => {
    if (!lyricsElement) return;
    return installTailCompletionGuard(lyricsElement);
  }, [lyricsElement, currentTrack.id]);

  useEffect(() => {
    const element = lyricsElement;
    if (!element || !onAvailabilityChange) return;
    const internal = element as unknown as { isLoading?: boolean; lyrics?: unknown[] };
    let lastValue: boolean | null = null;
    const report = () => {
      if (internal.isLoading) return;
      const hasLyrics = Array.isArray(internal.lyrics) && internal.lyrics.length > 0;
      const showsEmptyState = Boolean(element.shadowRoot?.querySelector('.no-lyrics'));
      if (!hasLyrics && !showsEmptyState) return;
      if (lastValue === hasLyrics) return;
      lastValue = hasLyrics;
      onAvailabilityChange(hasLyrics);
    };
    const observer = element.shadowRoot
      ? new MutationObserver(report)
      : null;
    observer?.observe(element.shadowRoot!, { childList: true, subtree: true });
    const timer = window.setInterval(report, 350);
    report();
    return () => {
      observer?.disconnect();
      window.clearInterval(timer);
    };
  }, [lyricsElement, currentTrack.id, onAvailabilityChange]);

  // Hand the live element to the source store so the settings panel can search
  // again and switch candidates, and so a previously chosen source for this
  // track is restored from cache instead of re-resolved over the network.
  useEffect(() => {
    lyricsSourcesStore.attach(lyricsElement, lyricsElement ? currentTrack : null);
    return () => lyricsSourcesStore.detach(lyricsElement);
  }, [lyricsElement, currentTrack]);

  useEffect(() => {
    const element = lyricsElement;
    if (!element) return;

    // Apply the stack synchronously so the engine's next measurement (and the
    // recalibration below) reads the new computed font.
    element.fontFamily = activeFont.stack;
    element.style.fontFamily = activeFont.stack;
    patchCharMeasurement(element);
    return recalibrateFillMetrics(element, activeFont);
  }, [lyricsElement, activeFont, currentTrack]);

  useEffect(() => {
    const element = lyricsElement;
    if (!element) return;

    const handleLineClick = (event: Event) => {
      const detail = (event as CustomEvent<{ timestamp?: number }>).detail;
      if (typeof detail?.timestamp !== 'number') return;
      // The custom element emits the original TTML timestamp. Convert it to
      // the audio timeline so seeking a lyric remains correct after shifting.
      const target = Math.max(0, detail.timestamp - timingOffsetMs);
      // Update lyrics in the same event as the seek. Waiting for timeupdate
      // leaves a visible (and sometimes persistent) old active line.
      setLyricsTime(element, target + timingOffsetMs, true);
      onSeek(target);
      void webAudioEngine.play();
    };

    element.addEventListener('line-click', handleLineClick);
    return () => element.removeEventListener('line-click', handleLineClick);
  }, [lyricsElement, onSeek, timingOffsetMs]);

  useEffect(() => {
    const element = lyricsElement;
    if (!element) return;

    const audio = webAudioEngine.getAudioElement();
    const syncSeek = () => {
      setLyricsTime(
        element,
        Math.round(audio.currentTime * 1000) + timingOffsetMs,
        true,
      );
    };

    // `seeking` covers slider and media-session seeks immediately; `seeked`
    // reconciles WebKit once it has committed the new media position. Both
    // force the active line back into view, including when seeking backwards.
    audio.addEventListener('seeking', syncSeek);
    audio.addEventListener('seeked', syncSeek);
    return () => {
      audio.removeEventListener('seeking', syncSeek);
      audio.removeEventListener('seeked', syncSeek);
    };
  }, [lyricsElement, currentTrack.id, timingOffsetMs]);

  useEffect(() => {
    const element = lyricsElement;
    if (!element) return;

    // Drive active-line changes from the audio clock every paint frame.
    // am-lyrics interpolates the word wipe internally, but it only advances
    // to a new active line when its currentTime setter receives a fresh value.
    let rafId = 0;
    const syncTime = () => {
      const target = Math.round(webAudioEngine.getCurrentTime() * 1000) + timingOffsetMs;
      // `HTMLMediaElement.currentTime` reports the new position as soon as the
      // slider assigns it, while `seeking` arrives on a later task — under
      // WKWebView often a frame or more later. Left alone, this tick would
      // hand the engine the post-seek position as if it were ordinary
      // playback, and a syllable that is already lit is never re-anchored,
      // so its letters keep filling from the pre-seek position for the rest of
      // the word. Recognise the jump here instead of waiting for the event.
      const step = target - Number(element.currentTime ?? 0);
      const jumped = step < -LYRICS_TICK_TOLERANCE_MS || step > LYRICS_TICK_TOLERANCE_MS;

      setLyricsTime(element, target, jumped);
      rafId = window.requestAnimationFrame(syncTime);
    };

    if (isPlaying) {
      syncTime();
      return () => window.cancelAnimationFrame(rafId);
    }

    return undefined;
  }, [lyricsElement, isPlaying, currentTrack.id, timingOffsetMs]);

  useEffect(() => {
    const element = lyricsElement;
    if (!element || isPlaying) return;
    setLyricsTime(element, position + timingOffsetMs, true);
  }, [lyricsElement, isPlaying, position, currentTrack.id, timingOffsetMs]);

  return (
    <div className="synced-lyrics-view">
      <am-lyrics
        key={currentTrack.id}
        ref={attachLyricsElement}
        song-title={searchMetadata.title}
        song-artist={searchMetadata.artist}
        song-album={searchMetadata.album}
        song-duration={safeDuration}
        isrc={currentTrack.isrc}
        query={query}
        duration={safeDuration}
        highlight-color={palette?.primary ?? 'var(--fp-primary)'}
        font-family={activeFont.stack}
        autoscroll
        interpolate
      />
    </div>
  );
}
