export type LyricsThemeId = 'wipe' | 'tide' | 'flare';

export interface LyricsThemeDefinition {
  id: LyricsThemeId;
  label: string;
  description: string;
  /** Extra CSS injected into the am-lyrics shadow root for this theme */
  shadowCss: string;
  /** CSS custom properties applied on the am-lyrics host element */
  hostVars: Record<string, string>;
}

const LYRICS_THEME_STORAGE_KEY = 'staysound.lyricsTheme';

/**
 * Host vars that only themes set (the base view never assigns them), so
 * switching themes can clear leftovers from the previous selection.
 */
export const LYRICS_THEME_HOST_VARS: string[] = [];

/**
 * am-lyrics drives the karaoke fill by writing inline animations by NAME
 * (`wipe`, `start-wipe`, `pre-wipe-char`, …) with the exact per-syllable
 * duration and negative delay. Overriding `animation-name` with !important
 * swaps the fill mechanic for our own keyframes while inheriting the
 * engine's timing, so sync stays sample-accurate.
 *
 * Char-level words (growable / char-rise) carry comma-separated animation
 * lists whose order is [grow-dynamic | rise-char]?, [pre-wipe-char]?, wipe.
 * The name list we substitute must match that length and order, hence the
 * [style*=…] combination rules below.
 */
function fillOverrides(fill: string, pre: string): string {
  return `
    /* Syllable-level fill (words without char animation) */
    .lyrics-line:not(.lyrics-gap) .lyrics-syllable.highlight.no-chars {
      animation-name: ${fill} !important;
    }
    .lyrics-line:not(.lyrics-gap) .lyrics-syllable.pre-highlight.no-chars {
      animation-name: ${pre} !important;
    }

    /* Char-level fill: keep the engine's emphasis animations (grow/rise)
       and only replace the wipe segment of each animation list. */
    span.char[style*="animation"]:not([style*="grow-dynamic"]):not([style*="rise-char"]):not([style*="pre-wipe-char"]) {
      animation-name: ${fill} !important;
    }
    span.char[style*="pre-wipe-char"] {
      animation-name: ${pre}, ${fill} !important;
    }
    span.char[style*="grow-dynamic"] {
      animation-name: grow-dynamic, ${fill} !important;
    }
    span.char[style*="rise-char"] {
      animation-name: rise-char, ${fill} !important;
    }
    span.char[style*="grow-dynamic"][style*="pre-wipe-char"] {
      animation-name: grow-dynamic, ${pre}, ${fill} !important;
    }
    span.char[style*="rise-char"][style*="pre-wipe-char"] {
      animation-name: rise-char, ${pre}, ${fill} !important;
    }
  `;
}

export const LYRICS_THEMES: LyricsThemeDefinition[] = [
  {
    id: 'wipe',
    label: 'Barrido',
    description: 'Karaoke clásico: la luz recorre cada sílaba de izquierda a derecha',
    shadowCss: '',
    hostVars: {},
  },
  {
    id: 'tide',
    label: 'Marea',
    description: 'Las letras se inundan de abajo hacia arriba, como tinta subiendo',
    shadowCss: `
      /* Vertical two-layer fill: a specular crest (near-white gleam core)
         riding the waterline, over a rising body whose top edge is a soft
         meniscus instead of a hard cut. */
      .lyrics-line:not(.lyrics-gap) .lyrics-syllable.highlight.no-chars,
      .lyrics-line:not(.lyrics-gap) .lyrics-syllable.pre-highlight.no-chars,
      .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable span.char,
      .lyrics-line.pre-active:not(.lyrics-gap) .lyrics-syllable span.char {
        background-image:
          linear-gradient(
            0deg,
            transparent 0%,
            color-mix(in srgb, var(--lyplus-text-primary) 62%, white) 40%,
            color-mix(in srgb, var(--lyplus-text-primary) 38%, white) 50%,
            color-mix(in srgb, var(--lyplus-text-primary) 62%, white) 60%,
            transparent 100%
          ),
          linear-gradient(
            0deg,
            var(--lyplus-text-primary) 0%,
            var(--lyplus-text-primary) calc(100% - 0.34em),
            color-mix(in srgb, var(--lyplus-text-primary) 55%, transparent) calc(100% - 0.1em),
            transparent 100%
          ) !important;
        background-repeat: no-repeat !important;
      }

      ${fillOverrides('ss-tide', 'ss-tide-pre')}

      /* Anticipation: a faint sliver of the crest surfaces at the baseline
         just before the syllable sings; ss-tide continues from that state. */
      @keyframes ss-tide-pre {
        from {
          background-size: 100% 0.5em, 100% 0%;
          background-position: 50% calc(100% + 0.5em), 50% 100%;
        }
        to {
          background-size: 100% 0.5em, 100% 0%;
          background-position: 50% calc(100% + 0.14em), 50% 100%;
        }
      }

      /* The body overshoots past the cap height so the soft meniscus ends
         above the glyphs and the syllable lands fully solid — no shimmer
         while waiting for the .finished class. */
      @keyframes ss-tide {
        from {
          background-size: 100% 0.5em, 100% 0%;
          background-position: 50% calc(100% + 0.14em), 50% 100%;
        }
        to {
          background-size: 100% 0.5em, 100% calc(100% + 0.55em);
          background-position: 50% -0.62em, 50% 100%;
        }
      }
    `,
    hostVars: {},
  },
  {
    id: 'flare',
    label: 'Destello',
    description: 'Cada sílaba se enciende con un fulgor que se desvanece mientras suena',
    shadowCss: `
      /* No directional wipe: the fill is a crossfade. Each syllable ignites
         white-hot, settles into the palette color, and the glow decays with
         a fast falloff and a soft tail across the length of the note. */
      .lyrics-line:not(.lyrics-gap) .lyrics-syllable,
      .lyrics-line:not(.lyrics-gap) .lyrics-syllable span.char {
        background-image: none !important;
      }

      .lyrics-line:not(.lyrics-gap) .lyrics-syllable.highlight.no-chars {
        will-change: filter, background-color;
      }

      ${fillOverrides('ss-flare', 'ss-flare-pre')}

      @keyframes ss-flare-pre {
        from {
          background-color: var(--lyplus-text-secondary);
        }
        to {
          background-color: color-mix(
            in srgb,
            var(--lyplus-text-primary) 32%,
            var(--lyplus-text-secondary)
          );
        }
      }

      @keyframes ss-flare {
        0% {
          background-color: var(--lyplus-text-secondary);
          filter: brightness(1)
            drop-shadow(0 0 0 color-mix(in srgb, var(--lyplus-text-primary) 0%, transparent));
        }
        22% {
          background-color: color-mix(in srgb, var(--lyplus-text-primary) 78%, white);
          filter: brightness(1.16)
            drop-shadow(0 0 0.24em color-mix(in srgb, color-mix(in srgb, var(--lyplus-text-primary) 55%, white) 48%, transparent));
        }
        58% {
          background-color: var(--lyplus-text-primary);
          filter: brightness(1.03)
            drop-shadow(0 0 0.1em color-mix(in srgb, var(--lyplus-text-primary) 20%, transparent));
        }
        100% {
          background-color: var(--lyplus-text-primary);
          filter: brightness(1)
            drop-shadow(0 0 0 color-mix(in srgb, var(--lyplus-text-primary) 0%, transparent));
        }
      }
    `,
    hostVars: {},
  },
];

export function getLyricsTheme(id: string | null | undefined): LyricsThemeDefinition {
  return LYRICS_THEMES.find(theme => theme.id === id) ?? LYRICS_THEMES[0];
}

export function readStoredLyricsTheme(): LyricsThemeId {
  try {
    return getLyricsTheme(window.localStorage.getItem(LYRICS_THEME_STORAGE_KEY)).id;
  } catch {
    return 'wipe';
  }
}

export function storeLyricsTheme(id: LyricsThemeId): void {
  try {
    window.localStorage.setItem(LYRICS_THEME_STORAGE_KEY, id);
  } catch {
    // Storage unavailable (private mode) — theme just won't persist.
  }
}
