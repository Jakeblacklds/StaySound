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
 * (`char-wipe`, `char-start-wipe`, `char-pre-wipe`, …) with the exact per-syllable
 * duration and negative delay. Overriding `animation-name` with !important
 * swaps the fill mechanic for our own keyframes while inheriting the
 * engine's timing, so sync stays sample-accurate.
 *
 * Char-level words carry comma-separated animation lists whose order is
 * [grow-dynamic | rise-char | drag-char]?, [char-pre-wipe]?, char-wipe.
 * The name list we substitute must match that length and order, hence the
 * [style*=…] combination rules below.
 */
function fillOverrides(fill: string, pre: string): string {
  return `
    /* Syllable-level fill (words without char animation) */
    .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.highlight.no-chars {
      animation-name: ${fill} !important;
    }
    .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.pre-highlight.no-chars {
      animation-name: ${pre} !important;
    }

    /* Char-level fill: preserve the engine's motion segment and replace only
       its anticipation/fill names. Scoping to .active prevents completed
       characters from being restarted while their line scrolls away. */
    .lyrics-line.active:not(.lyrics-gap)
      span.char:is([style*="char-wipe"], [style*="char-start-wipe"]):not([style*="grow-dynamic"]):not([style*="rise-char"]):not([style*="drag-char"]):not([style*="char-pre-wipe"]) {
      animation-name: ${fill} !important;
    }

    .lyrics-line.active:not(.lyrics-gap)
      span.char:is([style*="char-wipe"], [style*="char-start-wipe"])[style*="char-pre-wipe"]:not([style*="grow-dynamic"]):not([style*="rise-char"]):not([style*="drag-char"]) {
      animation-name: ${pre}, ${fill} !important;
    }

    .lyrics-line.active:not(.lyrics-gap)
      span.char:is([style*="char-wipe"], [style*="char-start-wipe"])[style*="grow-dynamic"]:not([style*="char-pre-wipe"]) {
      animation-name: grow-dynamic, ${fill} !important;
    }

    .lyrics-line.active:not(.lyrics-gap)
      span.char:is([style*="char-wipe"], [style*="char-start-wipe"])[style*="rise-char"]:not([style*="char-pre-wipe"]) {
      animation-name: rise-char, ${fill} !important;
    }

    .lyrics-line.active:not(.lyrics-gap)
      span.char:is([style*="char-wipe"], [style*="char-start-wipe"])[style*="drag-char"]:not([style*="char-pre-wipe"]) {
      animation-name: drag-char, ${fill} !important;
    }

    .lyrics-line.active:not(.lyrics-gap)
      span.char:is([style*="char-wipe"], [style*="char-start-wipe"])[style*="grow-dynamic"][style*="char-pre-wipe"] {
      animation-name: grow-dynamic, ${pre}, ${fill} !important;
    }

    .lyrics-line.active:not(.lyrics-gap)
      span.char:is([style*="char-wipe"], [style*="char-start-wipe"])[style*="rise-char"][style*="char-pre-wipe"] {
      animation-name: rise-char, ${pre}, ${fill} !important;
    }

    .lyrics-line.active:not(.lyrics-gap)
      span.char:is([style*="char-wipe"], [style*="char-start-wipe"])[style*="drag-char"][style*="char-pre-wipe"] {
      animation-name: drag-char, ${pre}, ${fill} !important;
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
      /* A compact crest rides above a saturated body. The effect is scoped to
         the active line so am-lyrics 1.5.6 can own the outgoing 0.7s fade. */
      .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.highlight.no-chars,
      .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.pre-highlight.no-chars,
      .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable span.char,
      .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.no-chars {
        background-image:
          linear-gradient(
            0deg,
            transparent 0%,
            color-mix(in srgb, var(--lyplus-text-primary) 52%, white) 32%,
            color-mix(in srgb, var(--lyplus-text-primary) 24%, white) 50%,
            color-mix(in srgb, var(--lyplus-text-primary) 52%, white) 68%,
            transparent 100%
          ),
          linear-gradient(
            0deg,
            var(--lyplus-text-primary) 0%,
            var(--lyplus-text-primary) calc(100% - 0.28em),
            color-mix(in srgb, var(--lyplus-text-primary) 58%, transparent) calc(100% - 0.07em),
            transparent 100%
          ) !important;
        background-repeat: no-repeat !important;
        will-change: background-size, background-position;
      }

      ${fillOverrides('ss-tide', 'ss-tide-pre')}

      /* Anticipation brings only the crest into view. */
      @keyframes ss-tide-pre {
        from {
          background-size: 100% 0.42em, 100% 0%;
          background-position: 50% calc(100% + 0.46em), 50% 100%;
        }
        to {
          background-size: 100% 0.42em, 100% 0%;
          background-position: 50% calc(100% + 0.1em), 50% 100%;
        }
      }

      /* The body rises through the glyph and carries the crest just beyond
         the cap height, leaving a clean solid finish. */
      @keyframes ss-tide {
        from {
          background-size: 100% 0.42em, 100% 0%;
          background-position: 50% calc(100% + 0.1em), 50% 100%;
        }
        to {
          background-size: 100% 0.42em, 100% calc(100% + 0.42em);
          background-position: 50% -0.48em, 50% 100%;
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
      /* No directional wipe: each active syllable warms into the palette and
         releases a short halo. Inactive lines are left entirely to am-lyrics. */
      .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable,
      .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable span.char {
        background-image: none !important;
      }

      .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable.highlight.no-chars,
      .lyrics-line.active:not(.lyrics-gap) .lyrics-syllable span.char[style*="animation"] {
        will-change: filter, background-color;
      }

      ${fillOverrides('ss-flare', 'ss-flare-pre')}

      @keyframes ss-flare-pre {
        from {
          background-color: var(--lyplus-text-secondary);
          filter: brightness(1) drop-shadow(0 0 0 transparent);
        }
        to {
          background-color: color-mix(
            in srgb,
            var(--lyplus-text-primary) 38%,
            var(--lyplus-text-secondary)
          );
          filter: brightness(1.03)
            drop-shadow(0 0 0.08em color-mix(in srgb, var(--lyplus-text-primary) 18%, transparent));
        }
      }

      @keyframes ss-flare {
        0% {
          background-color: color-mix(in srgb, var(--lyplus-text-primary) 38%, var(--lyplus-text-secondary));
          filter: brightness(1.03)
            drop-shadow(0 0 0.08em color-mix(in srgb, var(--lyplus-text-primary) 18%, transparent));
        }
        18% {
          background-color: color-mix(in srgb, var(--lyplus-text-primary) 68%, white);
          filter: brightness(1.12)
            drop-shadow(0 0 0.2em color-mix(in srgb, var(--lyplus-text-primary) 42%, transparent));
        }
        62% {
          background-color: var(--lyplus-text-primary);
          filter: brightness(1.025)
            drop-shadow(0 0 0.07em color-mix(in srgb, var(--lyplus-text-primary) 14%, transparent));
        }
        100% {
          background-color: var(--lyplus-text-primary);
          filter: brightness(1) drop-shadow(0 0 0 transparent);
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
