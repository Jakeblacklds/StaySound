/**
 * Lyricsfile 1.0 (https://lrclib.net/lyricsfile) export, used to contribute
 * word-synced letters to LRCLIB.
 *
 * Backing vocals have no standard field yet (an open question upstream), so
 * they become their own overlapping line — which the spec allows — tagged with
 * `role: background`, as proposed in tranxuanthang/lyricsfile#3. Readers that
 * do not know the field ignore it.
 */

import type { GeneratedLyrics, GeneratedLyricsWord } from './karaokeDesktop';

export interface LyricsfileMetadata {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
}

interface LyricsfileSegment {
  text: string;
  startMs: number;
  endMs: number;
}

interface LyricsfileLine {
  text: string;
  startMs: number;
  endMs: number;
  background: boolean;
  words: LyricsfileSegment[];
}

const ms = (value: number) => Math.max(0, Math.round(value));

/** JSON strings are valid YAML double-quoted scalars. */
const quote = (value: string) => JSON.stringify(value);

function segmentsFor(words: GeneratedLyricsWord[]): LyricsfileSegment[] {
  const segments: LyricsfileSegment[] = [];
  words.forEach((word, index) => {
    const space = index < words.length - 1 ? ' ' : '';
    const syllables = word.syllables ?? [];
    // Only hand-split words fill syllable by syllable; everything else fills
    // as a whole word, same as the renderer.
    const splitBySyllable = word.syllabic
      && syllables.length > 1
      && syllables.map(syllable => syllable.text).join('') === word.text;
    if (splitBySyllable) {
      syllables.forEach((syllable, syllableIndex) => segments.push({
        text: syllable.text + (syllableIndex === syllables.length - 1 ? space : ''),
        startMs: ms(syllable.startMs),
        endMs: ms(Math.max(syllable.startMs, syllable.endMs)),
      }));
    } else {
      segments.push({
        text: word.text + space,
        startMs: ms(word.startMs),
        endMs: ms(Math.max(word.startMs, word.endMs)),
      });
    }
  });
  return segments;
}

function lineFrom(words: GeneratedLyricsWord[], background: boolean): LyricsfileLine | null {
  const timed = words.filter(word => word.text.trim());
  if (!timed.length) return null;
  const segments = segmentsFor(timed);
  const startMs = Math.min(...segments.map(segment => segment.startMs));
  const endMs = Math.max(...segments.map(segment => segment.endMs));
  return {
    text: segments.map(segment => segment.text).join(''),
    startMs,
    endMs: Math.max(startMs, endMs),
    background,
    words: segments,
  };
}

export function toLyricsfileLines(lyrics: GeneratedLyrics): LyricsfileLine[] {
  const lines: LyricsfileLine[] = [];
  for (const line of lyrics.lines) {
    const lead = lineFrom(line.words.filter(word => !word.background), false);
    const backing = lineFrom(line.words.filter(word => word.background), true);
    if (lead) lines.push(lead);
    if (backing) lines.push(backing);
  }
  return lines.sort((left, right) => left.startMs - right.startMs);
}

function lyricsLanguage(lyrics: GeneratedLyrics): string | null {
  const code = lyrics.language?.toLowerCase().split(/[-_]/)[0];
  return code && /^[a-z]{2}$/.test(code) ? code : null;
}

export function buildLyricsfile(lyrics: GeneratedLyrics, metadata: LyricsfileMetadata): string {
  const lines = toLyricsfileLines(lyrics);
  const language = lyricsLanguage(lyrics);
  const out: string[] = ['version: "1.0"', 'metadata:'];
  out.push(`  title: ${quote(metadata.title)}`);
  out.push(`  artist: ${quote(metadata.artist)}`);
  if (metadata.album) out.push(`  album: ${quote(metadata.album)}`);
  if (metadata.durationMs && metadata.durationMs > 0) out.push(`  duration_ms: ${ms(metadata.durationMs)}`);
  if (language) out.push(`  language: ${quote(language)}`);

  out.push('lines:');
  for (const line of lines) {
    out.push(`  - text: ${quote(line.text)}`);
    out.push(`    start_ms: ${line.startMs}`);
    out.push(`    end_ms: ${line.endMs}`);
    if (line.background) out.push('    role: background');
    out.push('    words:');
    for (const word of line.words) {
      out.push(`      - text: ${quote(word.text)}`);
      out.push(`        start_ms: ${word.startMs}`);
      out.push(`        end_ms: ${word.endMs}`);
    }
  }

  // Plain keeps the lead and backing together, the way the letter reads.
  const plain = lyrics.lines.map(line => line.text.trim()).filter(Boolean);
  if (plain.length) {
    out.push('plain: |');
    for (const text of plain) out.push(`  ${text}`);
  }
  return `${out.join('\n')}\n`;
}
