export type LyricsFontId = 'classic' | 'syne' | 'grotesk' | 'fraunces' | 'nunito';

export interface LyricsFontDefinition {
  id: LyricsFontId;
  label: string;
  description: string;
  /** Full CSS font-family stack applied to the am-lyrics host */
  stack: string;
  /**
   * Primary web-font family to await via document.fonts.load before the
   * engine re-measures glyph widths. Omit for system stacks.
   */
  loadFamily?: string;
}

const LYRICS_FONT_STORAGE_KEY = 'staysound.lyricsFont';

export const LYRICS_FONTS: LyricsFontDefinition[] = [
  {
    id: 'classic',
    label: 'Clásica',
    description: 'La tipografía del sistema, limpia y neutra',
    stack: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  {
    id: 'syne',
    label: 'Syne',
    description: 'Display artística, con carácter escénico',
    stack: "'Syne', ui-sans-serif, system-ui, sans-serif",
    loadFamily: 'Syne',
  },
  {
    id: 'grotesk',
    label: 'Space Grotesk',
    description: 'Grotesca técnica de trazo firme',
    stack: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    loadFamily: 'Space Grotesk',
  },
  {
    id: 'fraunces',
    label: 'Fraunces',
    description: 'Serif cálida, aire editorial',
    stack: "'Fraunces', ui-serif, Georgia, serif",
    loadFamily: 'Fraunces',
  },
  {
    id: 'nunito',
    label: 'Nunito',
    description: 'Redondeada y amable, estilo karaoke suave',
    stack: "'Nunito', ui-sans-serif, system-ui, sans-serif",
    loadFamily: 'Nunito',
  },
];

export function getLyricsFont(id: string | null | undefined): LyricsFontDefinition {
  return LYRICS_FONTS.find(font => font.id === id) ?? LYRICS_FONTS[0];
}

export function readStoredLyricsFont(): LyricsFontId {
  try {
    return getLyricsFont(window.localStorage.getItem(LYRICS_FONT_STORAGE_KEY)).id;
  } catch {
    return 'classic';
  }
}

export function storeLyricsFont(id: LyricsFontId): void {
  try {
    window.localStorage.setItem(LYRICS_FONT_STORAGE_KEY, id);
  } catch {
    // Storage unavailable (private mode) — font just won't persist.
  }
}
