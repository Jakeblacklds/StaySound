export type LyricsFontId = 'newsreader' | 'classic' | 'syne' | 'grotesk' | 'fraunces' | 'nunito';

export type LyricsFontOption = {
  id: LyricsFontId;
  label: string;
};

// Keep ids and labels aligned with web/src/library/lyricsFonts.ts (Tauri).
export const LYRICS_FONT_OPTIONS: LyricsFontOption[] = [
  { id: 'newsreader', label: 'Sala de escucha' },
  { id: 'classic', label: 'Clásica' },
  { id: 'syne', label: 'Syne' },
  { id: 'grotesk', label: 'Space Grotesk' },
  { id: 'fraunces', label: 'Fraunces' },
  { id: 'nunito', label: 'Nunito' },
];

export function sanitizeLyricsFont(value: unknown): LyricsFontId {
  return LYRICS_FONT_OPTIONS.some(option => option.id === value)
    ? value as LyricsFontId
    : 'classic';
}
