/**
 * Pure edits for the lyrics timing editor.
 *
 * Every operation takes the lines as they were when a gesture began plus a
 * total delta, never the previous frame's result, so a drag that wanders and
 * comes back lands exactly where it started. Words are only ever constrained
 * by neighbours in their own line: lines overlap legitimately (a held note
 * under the next phrase), and the renderer handles that.
 *
 * A line has two layers, the lead vocal and the backing vocal ("coro", the
 * parenthesised echoes Apple renders small under the line). Each layer is
 * its own sequence: a backing word may sit on top of a lead word, but never
 * on top of another backing word. Within a layer, array order is time order.
 *
 * Two neighbouring words that touch share one boundary. Sung text is mostly
 * legato, so "this word starts later" nearly always means "the previous one
 * ends later" too — dragging one side of a shared edge moves both.
 */
import type {
  GeneratedLyrics,
  GeneratedLyricsLine,
  GeneratedLyricsSyllable,
  GeneratedLyricsWord,
} from './karaokeDesktop';

export const MIN_WORD_MS = 40;
/** Words closer than this are treated as one shared boundary. */
const TOUCH_MS = 2;
/** A tap this close after the previous word ended was meant as legato. */
const TAP_LEGATO_MS = 220;
/** Length given to a word the user adds, when there is room for it. */
const NEW_WORD_MS = 400;
/** Backing words closer than this belong to one parenthesised phrase. */
const BACKING_PHRASE_GAP_MS = 700;

export interface WordRef {
  line: number;
  word: number;
}

export type WordEdge = 'start' | 'end';

export function isBackingWord(word: GeneratedLyricsWord): boolean {
  return word.background === true;
}

function touches(left: GeneratedLyricsWord, right: GeneratedLyricsWord): boolean {
  return right.startMs - left.endMs <= TOUCH_MS;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The nearest word in the same layer, or -1. */
function layerNeighbour(words: GeneratedLyricsWord[], index: number, direction: 1 | -1): number {
  const layer = isBackingWord(words[index]);
  for (let other = index + direction; other >= 0 && other < words.length; other += direction) {
    if (isBackingWord(words[other]) === layer) return other;
  }
  return -1;
}

/**
 * Re-times a word and carries its phonetic detail with it: syllables and
 * pitch evidence are stretched linearly into the new span. If rounding makes
 * any of them degenerate the detail is dropped rather than saved invalid —
 * the renderer then animates the word whole, which is what it does for most
 * words anyway.
 */
export function retimeWord(word: GeneratedLyricsWord, startMs: number, endMs: number): GeneratedLyricsWord {
  const start = Math.round(startMs);
  const end = Math.max(start + 1, Math.round(endMs));
  if (start === word.startMs && end === word.endMs) return word;
  const syllables = word.syllables ?? [];
  if (!syllables.length) return { ...word, startMs: start, endMs: end };

  const sourceSpan = Math.max(1, word.endMs - word.startMs);
  const scale = (end - start) / sourceSpan;
  const map = (time: number) => clamp(Math.round(start + (time - word.startMs) * scale), start, end);
  const mapped: GeneratedLyricsSyllable[] = syllables.map(syllable => {
    const syllableStart = map(syllable.startMs);
    const syllableEnd = map(syllable.endMs);
    return {
      ...syllable,
      startMs: syllableStart,
      endMs: syllableEnd,
      notes: syllable.notes
        ?.map(note => ({ ...note, startMs: Math.max(syllableStart, map(note.startMs)), endMs: Math.min(syllableEnd, map(note.endMs)) }))
        .filter(note => note.endMs > note.startMs),
    };
  });
  const valid = mapped.every(syllable => syllable.endMs > syllable.startMs);
  return { ...word, startMs: start, endMs: end, syllables: valid ? mapped : [] };
}

/** An edited line spans exactly its words, so the saved file always validates. */
function withWords(line: GeneratedLyricsLine, words: GeneratedLyricsWord[], text = line.text): GeneratedLyricsLine {
  if (!words.length) return { ...line, text, words };
  return {
    ...line,
    text,
    words,
    startMs: Math.min(...words.map(word => word.startMs)),
    endMs: Math.max(...words.map(word => word.endMs)),
  };
}

function replaceLine(
  lines: GeneratedLyricsLine[],
  lineIndex: number,
  words: GeneratedLyricsWord[],
  text?: string,
): GeneratedLyricsLine[] {
  const next = lines.slice();
  next[lineIndex] = withWords(lines[lineIndex], words, text);
  return next;
}

function lineText(words: GeneratedLyricsWord[]): string {
  return words.map(word => word.text).join(' ');
}

/**
 * Slides a word. Touching neighbours stretch or shrink to stay attached;
 * a neighbour across a gap is a wall the word can reach but not cross.
 */
export function moveWord(origin: GeneratedLyricsLine[], ref: WordRef, deltaMs: number): GeneratedLyricsLine[] {
  const words = origin[ref.line]?.words;
  const word = words?.[ref.word];
  if (!words || !word) return origin;
  const previousIndex = layerNeighbour(words, ref.word, -1);
  const followingIndex = layerNeighbour(words, ref.word, 1);
  const previous = words[previousIndex];
  const following = words[followingIndex];

  let low = -word.startMs;
  let high = Number.POSITIVE_INFINITY;
  if (previous) {
    low = Math.max(low, touches(previous, word)
      ? previous.startMs + MIN_WORD_MS - word.startMs
      : previous.endMs - word.startMs);
  }
  if (following) {
    high = Math.min(high, touches(word, following)
      ? following.endMs - MIN_WORD_MS - word.endMs
      : following.startMs - word.endMs);
  }
  const delta = Math.round(clamp(deltaMs, Math.min(0, low), Math.max(0, high)));
  if (!delta) return origin;

  const next = words.slice();
  next[ref.word] = retimeWord(word, word.startMs + delta, word.endMs + delta);
  if (previous && touches(previous, word)) {
    next[previousIndex] = retimeWord(previous, previous.startMs, word.startMs + delta);
  }
  if (following && touches(word, following)) {
    next[followingIndex] = retimeWord(following, word.endMs + delta, following.endMs);
  }
  return replaceLine(origin, ref.line, next);
}

/** Drags one edge of a word; a shared edge moves the neighbour's too. */
export function moveWordEdge(
  origin: GeneratedLyricsLine[],
  ref: WordRef,
  edge: WordEdge,
  deltaMs: number,
): GeneratedLyricsLine[] {
  const words = origin[ref.line]?.words;
  const word = words?.[ref.word];
  if (!words || !word) return origin;
  const next = words.slice();

  if (edge === 'start') {
    const previousIndex = layerNeighbour(words, ref.word, -1);
    const previous = words[previousIndex];
    const shared = previous ? touches(previous, word) : false;
    const low = previous
      ? shared ? previous.startMs + MIN_WORD_MS : previous.endMs
      : 0;
    const start = Math.round(clamp(word.startMs + deltaMs, low, word.endMs - MIN_WORD_MS));
    if (start === word.startMs) return origin;
    next[ref.word] = retimeWord(word, start, word.endMs);
    if (previous && shared) next[previousIndex] = retimeWord(previous, previous.startMs, start);
  } else {
    const followingIndex = layerNeighbour(words, ref.word, 1);
    const following = words[followingIndex];
    const shared = following ? touches(word, following) : false;
    const high = following
      ? shared ? following.endMs - MIN_WORD_MS : following.startMs
      : Number.POSITIVE_INFINITY;
    const end = Math.round(clamp(word.endMs + deltaMs, word.startMs + MIN_WORD_MS, high));
    if (end === word.endMs) return origin;
    next[ref.word] = retimeWord(word, word.startMs, end);
    if (following && shared) next[followingIndex] = retimeWord(following, end, following.endMs);
  }
  return replaceLine(origin, ref.line, next);
}

/** Moves a whole line — the usual fix when a phrase is right but late. */
export function shiftLine(origin: GeneratedLyricsLine[], lineIndex: number, deltaMs: number): GeneratedLyricsLine[] {
  const line = origin[lineIndex];
  if (!line?.words.length) return origin;
  const earliest = Math.min(...line.words.map(word => word.startMs));
  const delta = Math.round(Math.max(-earliest, deltaMs));
  if (!delta) return origin;
  return replaceLine(
    origin,
    lineIndex,
    line.words.map(word => retimeWord(word, word.startMs + delta, word.endMs + delta)),
  );
}

export function renameWord(origin: GeneratedLyricsLine[], ref: WordRef, text: string): GeneratedLyricsLine[] {
  const line = origin[ref.line];
  const word = line?.words[ref.word];
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!line || !word || !trimmed || trimmed === word.text) return origin;
  // Phones belong to the old spelling; keep their timing, relabel the part.
  const words = line.words.slice();
  const syllables = word.syllables ?? [];
  words[ref.word] = {
    ...word,
    text: trimmed,
    syllabic: undefined,
    syllables: syllables.length > 1 ? [] : syllables.map(syllable => ({ ...syllable, text: trimmed })),
  };
  return replaceLine(origin, ref.line, words, lineText(words));
}

/**
 * Pushes the words after `fromWord` in its layer later wherever they now
 * overlap, keeping each one's length. Used after a tap or an insertion,
 * which may land a word on top of neighbours that still carry old timing.
 */
function pushFollowing(words: GeneratedLyricsWord[], fromWord: number): void {
  let previous = fromWord;
  for (let index = layerNeighbour(words, fromWord, 1); index >= 0; index = layerNeighbour(words, index, 1)) {
    const overlap = words[previous].endMs - words[index].startMs;
    if (overlap <= 0) break;
    words[index] = retimeWord(words[index], words[index].startMs + overlap, words[index].endMs + overlap);
    previous = index;
  }
}

/**
 * Records one tap of "Marcar al ritmo": the key went down at `startMs` and is
 * (or was) released at `endMs`. A tap right after the previous word closes
 * the gap, since legato singing never leaves one; a clear pause is kept.
 */
export function applyTap(
  origin: GeneratedLyricsLine[],
  ref: WordRef,
  startMs: number,
  endMs: number,
): GeneratedLyricsLine[] {
  const line = origin[ref.line];
  const word = line?.words[ref.word];
  if (!line || !word) return origin;
  const start = Math.max(0, Math.round(startMs));
  const end = Math.max(start + MIN_WORD_MS, Math.round(endMs));
  const words = line.words.slice();
  const previousIndex = layerNeighbour(words, ref.word, -1);
  const previous = words[previousIndex];
  if (previous && start - previous.endMs < TAP_LEGATO_MS) {
    words[previousIndex] = retimeWord(previous, previous.startMs, Math.max(previous.startMs + MIN_WORD_MS, start));
  }
  words[ref.word] = retimeWord(word, Math.max(start, words[previousIndex]?.endMs ?? 0), end);
  pushFollowing(words, ref.word);
  return replaceLine(origin, ref.line, words);
}

/**
 * Adds a word at `timeMs` in the given layer — the "ooh" the transcription
 * never heard. Landing inside a word splits that word's time with it; in a
 * gap it takes up to NEW_WORD_MS, pushing later words only if it must.
 */
export function insertWord(
  origin: GeneratedLyricsLine[],
  lineIndex: number,
  timeMs: number,
  background: boolean,
  text = 'oh',
): { lines: GeneratedLyricsLine[]; ref: WordRef } | null {
  const line = origin[lineIndex];
  if (!line) return null;
  const words = line.words.slice();
  const at = Math.max(0, Math.round(timeMs));
  const layer = words
    .map((word, index) => ({ word, index }))
    .filter(entry => isBackingWord(entry.word) === background);

  const container = layer.find(({ word }) => word.startMs < at && at < word.endMs);
  let start = at;
  let end = at + NEW_WORD_MS;
  let insertAt: number;
  if (container && at - container.word.startMs >= MIN_WORD_MS && container.word.endMs - at >= MIN_WORD_MS) {
    end = container.word.endMs;
    words[container.index] = retimeWord(container.word, container.word.startMs, at);
    insertAt = container.index + 1;
  } else {
    const previous = [...layer].reverse().find(({ word }) => word.startMs <= at);
    const following = layer.find(({ word }) => word.startMs > at);
    if (previous) start = Math.max(start, previous.word.endMs);
    if (following) end = Math.min(end, following.word.startMs);
    end = Math.max(end, start + MIN_WORD_MS);
    insertAt = previous ? previous.index + 1 : following ? following.index : words.length;
  }

  const added: GeneratedLyricsWord = {
    text,
    startMs: start,
    endMs: end,
    confidence: 0,
    syllables: [],
    ...(background ? { background: true } : {}),
  };
  words.splice(insertAt, 0, added);
  // Keep the whole line in time order so the text reads as it is sung.
  const sorted = sortByStart(words);
  const index = sorted.indexOf(added);
  pushFollowing(sorted, index);
  return {
    lines: replaceLine(origin, lineIndex, sorted, lineText(sorted)),
    ref: { line: lineIndex, word: index },
  };
}

/** Stable sort by start time; each layer is already in order, so this only interleaves them. */
function sortByStart(words: GeneratedLyricsWord[]): GeneratedLyricsWord[] {
  return words
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.startMs - b.entry.startMs || a.index - b.index)
    .map(({ entry }) => entry);
}

export function deleteWord(origin: GeneratedLyricsLine[], ref: WordRef): GeneratedLyricsLine[] {
  const line = origin[ref.line];
  // A line keeps at least one word; an empty line has no time to live at.
  if (!line?.words[ref.word] || line.words.length < 2) return origin;
  const words = line.words.filter((_, index) => index !== ref.word);
  return replaceLine(origin, ref.line, words, lineText(words));
}

function stripParentheses(text: string): string {
  return text.replace(/^\(+/, '').replace(/\)+$/, '');
}

/**
 * Backing phrases are written in parentheses, as every lyrics provider and
 * Apple itself do: "(te quiero)". Re-wraps each run of nearby backing words
 * so the text keeps saying which words are the echo.
 */
function wrapBackingPhrases(words: GeneratedLyricsWord[]): GeneratedLyricsWord[] {
  const result = words.slice();
  const backing = result
    .map((word, index) => ({ word, index }))
    .filter(entry => isBackingWord(entry.word));
  let phraseStart = 0;
  for (let position = 0; position < backing.length; position += 1) {
    const next = backing[position + 1];
    const endsPhrase = !next || next.word.startMs - backing[position].word.endMs > BACKING_PHRASE_GAP_MS;
    if (!endsPhrase) continue;
    for (let member = phraseStart; member <= position; member += 1) {
      const { word, index } = backing[member];
      let text = stripParentheses(word.text);
      if (member === phraseStart) text = `(${text}`;
      if (member === position) text = `${text})`;
      result[index] = { ...word, text };
    }
    phraseStart = position + 1;
  }
  return result;
}

/** Moves one word between the lead and the backing layer. */
export function toggleBacking(
  origin: GeneratedLyricsLine[],
  ref: WordRef,
): { lines: GeneratedLyricsLine[]; ref: WordRef } {
  const word = origin[ref.line]?.words[ref.word];
  if (!word) return { lines: origin, ref };
  const result = setBacking(origin, ref.line, [ref.word], !isBackingWord(word));
  return { lines: result.lines, ref: { line: ref.line, word: result.words[0] ?? ref.word } };
}

/* ------------------------------------------------------------------ lines */

/** Time a typed word gets when nothing better is known. */
const TYPED_WORD_MS = 380;

function normalizedLetters(text: string): number {
  return Math.max(1, text.normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '').length);
}

/** Splits typed text into words spread over [startMs, endMs] by length. */
function wordsFromText(text: string, startMs: number, endMs: number, background: boolean): GeneratedLyricsWord[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const weights = tokens.map(normalizedLetters);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const span = Math.max(tokens.length * MIN_WORD_MS, endMs - startMs);
  let cursor = Math.round(startMs);
  return tokens.map((token, index) => {
    const end = index === tokens.length - 1
      ? Math.round(startMs + span)
      : Math.max(cursor + MIN_WORD_MS, Math.round(cursor + span * weights[index] / total));
    const word: GeneratedLyricsWord = {
      text: token,
      startMs: cursor,
      endMs: end,
      confidence: 0,
      syllables: [],
      ...(background ? { background: true } : {}),
    };
    cursor = end;
    return word;
  });
}

/** Pushes apart words that overlap within a layer; the array must be in time order. */
function pushLayers(sorted: GeneratedLyricsWord[]): GeneratedLyricsWord[] {
  for (const background of [false, true]) {
    let previous = -1;
    for (let index = 0; index < sorted.length; index += 1) {
      if (isBackingWord(sorted[index]) !== background) continue;
      if (previous >= 0 && sorted[previous].endMs > sorted[index].startMs) {
        const overlap = sorted[previous].endMs - sorted[index].startMs;
        sorted[index] = retimeWord(sorted[index], sorted[index].startMs + overlap, sorted[index].endMs + overlap);
      }
      previous = index;
    }
  }
  return sorted;
}

/** Sorts a line by time and pushes apart any words that now overlap in a layer. */
function settleLayers(words: GeneratedLyricsWord[]): GeneratedLyricsWord[] {
  return pushLayers(sortByStart(words));
}

function withLineWords(line: GeneratedLyricsLine, words: GeneratedLyricsWord[]): GeneratedLyricsLine {
  return withWords(line, words, lineText(words));
}

function neighbourLine(lines: GeneratedLyricsLine[], from: number, direction: 1 | -1): GeneratedLyricsLine | null {
  for (let index = from; index >= 0 && index < lines.length; index += direction) {
    if (lines[index].words.length) return lines[index];
  }
  return null;
}

/**
 * Adds a lead line after `afterLine` (-1 for the top). It goes into the gap
 * before the next line — at the playhead if the playhead is in that gap —
 * with its words spread by length, ready to be marked to the rhythm.
 */
export function insertLine(
  origin: GeneratedLyricsLine[],
  afterLine: number,
  text: string,
  playheadMs: number,
): { lines: GeneratedLyricsLine[]; line: number } | null {
  const count = text.trim().split(/\s+/).filter(Boolean).length;
  if (!count) return null;
  const wanted = count * TYPED_WORD_MS;
  const previous = neighbourLine(origin, afterLine, -1);
  const following = neighbourLine(origin, afterLine + 1, 1);
  let start: number;
  let end: number;
  if (!previous) {
    end = following ? following.startMs : wanted;
    start = Math.max(0, end - wanted);
    end = Math.max(end, start + count * MIN_WORD_MS);
  } else {
    const gapEnd = following ? following.startMs : previous.endMs + wanted + 1_000;
    start = playheadMs >= previous.endMs && playheadMs < gapEnd ? playheadMs : previous.endMs;
    const room = gapEnd - start;
    // Squeezing a phrase into a sliver helps nobody; overlap instead and
    // let the user place it.
    end = start + (room >= count * 150 ? Math.min(wanted, room) : wanted);
  }
  const words = wordsFromText(text, start, end, false);
  const line: GeneratedLyricsLine = withLineWords(
    { text: '', startMs: start, endMs: end, language: previous?.language ?? following?.language ?? null, words: [] },
    words,
  );
  const next = origin.slice();
  next.splice(afterLine + 1, 0, line);
  return { lines: next, line: afterLine + 1 };
}

/**
 * Adds a typed backing phrase to a line, in parentheses: at the playhead
 * when it is on this line, otherwise right after the lead finishes.
 */
export function insertBackingPhrase(
  origin: GeneratedLyricsLine[],
  lineIndex: number,
  text: string,
  playheadMs: number,
): { lines: GeneratedLyricsLine[]; ref: WordRef } | null {
  const line = origin[lineIndex];
  const count = text.trim().split(/\s+/).filter(Boolean).length;
  if (!line || !count) return null;
  const lead = line.words.filter(word => !isBackingWord(word));
  const leadEnd = lead.length ? Math.max(...lead.map(word => word.endMs)) : line.endMs;
  const onLine = playheadMs >= line.startMs - 1_200 && playheadMs <= line.endMs + 1_200;
  const start = onLine ? playheadMs : leadEnd;
  const added = wordsFromText(text, start, start + count * TYPED_WORD_MS, true);
  const words = wrapBackingPhrases(settleLayers([...line.words, ...added]));
  const first = words.findIndex(word => isBackingWord(word) && word.startMs >= Math.round(start));
  const next = origin.slice();
  next[lineIndex] = withLineWords(line, words);
  return { lines: next, ref: { line: lineIndex, word: Math.max(0, first) } };
}

export function deleteLine(origin: GeneratedLyricsLine[], lineIndex: number): GeneratedLyricsLine[] {
  if (!origin[lineIndex] || origin.filter(line => line.words.length).length < 2) return origin;
  return origin.filter((_, index) => index !== lineIndex);
}

/**
 * Makes a separate line the backing vocal of the line before it — how a
 * provider's "(it sent you to me without wings)" row becomes the small
 * echo under the phrase it answers, as Apple renders it.
 */
export function mergeLineAsBacking(
  origin: GeneratedLyricsLine[],
  lineIndex: number,
): { lines: GeneratedLyricsLine[]; line: number } | null {
  const line = origin[lineIndex];
  let target = lineIndex - 1;
  while (target >= 0 && !origin[target].words.length) target -= 1;
  if (!line?.words.length || target < 0) return null;
  const echo = line.words.map(word => ({ ...word, text: stripParentheses(word.text), background: true }));
  const words = wrapBackingPhrases(settleLayers([...origin[target].words, ...echo]));
  const next = origin.slice();
  next[target] = withLineWords(origin[target], words);
  next.splice(lineIndex, 1);
  return { lines: next, line: target };
}

/** The reverse: a line's backing vocal becomes its own lead line after it. */
export function splitBackingToLine(
  origin: GeneratedLyricsLine[],
  lineIndex: number,
): { lines: GeneratedLyricsLine[]; line: number } | null {
  const line = origin[lineIndex];
  const backing = line?.words.filter(isBackingWord) ?? [];
  if (!line || !backing.length || backing.length === line.words.length) return null;
  const lead = line.words.filter(word => !isBackingWord(word));
  const echo = backing.map(word => {
    const { background: _background, ...rest } = word;
    return rest;
  });
  const next = origin.slice();
  next[lineIndex] = withLineWords(line, lead);
  next.splice(lineIndex + 1, 0, withLineWords({ ...line, words: [] }, echo));
  return { lines: next, line: lineIndex + 1 };
}

/* -------------------------------------------------------------- selections */

/**
 * Slides several words of one line together. The selection moves as a
 * block: unselected neighbours that touch it stretch or shrink, those
 * across a gap are walls, exactly as for a single word.
 */
export function moveWords(
  origin: GeneratedLyricsLine[],
  lineIndex: number,
  indices: number[],
  deltaMs: number,
): GeneratedLyricsLine[] {
  const words = origin[lineIndex]?.words;
  if (!words || !indices.length) return origin;
  const selected = new Set(indices.filter(index => index >= 0 && index < words.length));
  if (!selected.size) return origin;

  let low = Number.NEGATIVE_INFINITY;
  let high = Number.POSITIVE_INFINITY;
  const startShifts = new Set<number>();
  const endShifts = new Set<number>();
  for (const background of [false, true]) {
    const layer = words.map((word, index) => ({ word, index })).filter(({ word }) => isBackingWord(word) === background);
    layer.forEach(({ word, index }, position) => {
      if (selected.has(index)) low = Math.max(low, -word.startMs);
      const next = layer[position + 1];
      if (!next) return;
      const left = selected.has(index);
      const right = selected.has(next.index);
      if (left === right) return;
      const touching = touches(word, next.word);
      if (left && !touching) high = Math.min(high, next.word.startMs - word.endMs);
      if (right && !touching) low = Math.max(low, word.endMs - next.word.startMs);
      if (left && touching) startShifts.add(next.index);
      if (right && touching) endShifts.add(index);
    });
  }
  // An unselected word attached on one side only changes length.
  for (const index of new Set([...startShifts, ...endShifts])) {
    const length = words[index].endMs - words[index].startMs;
    const starts = startShifts.has(index);
    const ends = endShifts.has(index);
    if (starts && !ends) high = Math.min(high, length - MIN_WORD_MS);
    if (ends && !starts) low = Math.max(low, MIN_WORD_MS - length);
  }
  const delta = Math.round(clamp(deltaMs, Math.min(0, low), Math.max(0, high)));
  if (!delta) return origin;

  const next = words.map((word, index) => {
    if (selected.has(index)) return retimeWord(word, word.startMs + delta, word.endMs + delta);
    const start = startShifts.has(index) ? word.startMs + delta : word.startMs;
    const end = endShifts.has(index) ? word.endMs + delta : word.endMs;
    return retimeWord(word, start, end);
  });
  return replaceLine(origin, lineIndex, next);
}

/**
 * Deletes several words. Emptying a line removes the line, unless it is the
 * last one with words — a letter needs something to show.
 */
export function deleteWords(
  origin: GeneratedLyricsLine[],
  lineIndex: number,
  indices: number[],
): GeneratedLyricsLine[] {
  const line = origin[lineIndex];
  if (!line || !indices.length) return origin;
  const doomed = new Set(indices);
  const words = line.words.filter((_, index) => !doomed.has(index));
  if (words.length === line.words.length) return origin;
  if (!words.length) return deleteLine(origin, lineIndex);
  return replaceLine(origin, lineIndex, words, lineText(words));
}

/**
 * Puts several words in the lead or the backing layer. Words keep their time;
 * the line is re-sorted and each layer pushed apart where the newcomers
 * landed on top of it. Returns where the moved words ended up.
 */
export function setBacking(
  origin: GeneratedLyricsLine[],
  lineIndex: number,
  indices: number[],
  background: boolean,
): { lines: GeneratedLyricsLine[]; words: number[] } {
  const line = origin[lineIndex];
  if (!line) return { lines: origin, words: indices };
  const chosen = new Set(indices);
  const moved: GeneratedLyricsWord[] = [];
  const words = line.words.map((word, index) => {
    if (!chosen.has(index) || isBackingWord(word) === background) return word;
    const next: GeneratedLyricsWord = background
      ? { ...word, background: true }
      : { ...word, text: stripParentheses(word.text), background: undefined };
    moved.push(next);
    return next;
  });
  if (!moved.length) return { lines: origin, words: indices };
  const sorted = sortByStart(words);
  const positions = moved.map(word => sorted.indexOf(word));
  const settled = wrapBackingPhrases(pushLayers(sorted));
  return {
    lines: replaceLine(origin, lineIndex, settled, lineText(settled)),
    words: positions.sort((a, b) => a - b),
  };
}

export interface CopiedWords {
  /** What also goes to the system clipboard, to recognise it on paste. */
  text: string;
  words: Array<{ word: GeneratedLyricsWord; offsetMs: number }>;
}

export function copyWords(lines: GeneratedLyricsLine[], lineIndex: number, indices: number[]): CopiedWords | null {
  const words = [...new Set(indices)]
    .sort((a, b) => a - b)
    .map(index => lines[lineIndex]?.words[index])
    .filter((word): word is GeneratedLyricsWord => !!word);
  if (!words.length) return null;
  const origin = Math.min(...words.map(word => word.startMs));
  return {
    text: words.map(word => word.text).join(' '),
    words: words.map(word => ({ word, offsetMs: word.startMs - origin })),
  };
}

/**
 * Pastes copied words into a line starting at `atMs`, keeping their rhythm
 * and their layer. Words already there are pushed later where needed.
 */
export function pasteWords(
  origin: GeneratedLyricsLine[],
  lineIndex: number,
  copied: CopiedWords,
  atMs: number,
): { lines: GeneratedLyricsLine[]; words: number[] } | null {
  const line = origin[lineIndex];
  if (!line || !copied.words.length) return null;
  const start = Math.max(0, Math.round(atMs));
  const pasted = copied.words.map(({ word, offsetMs }) => (
    retimeWord({ ...word }, start + offsetMs, start + offsetMs + (word.endMs - word.startMs))
  ));
  const sorted = sortByStart([...line.words, ...pasted]);
  const positions = pasted.map(word => sorted.indexOf(word)).sort((a, b) => a - b);
  const settled = pushLayers(sorted);
  return { lines: replaceLine(origin, lineIndex, settled, lineText(settled)), words: positions };
}

/** Text from outside the editor pastes as new lead words, spread by length. */
export function pasteText(
  origin: GeneratedLyricsLine[],
  lineIndex: number,
  text: string,
  atMs: number,
): { lines: GeneratedLyricsLine[]; words: number[] } | null {
  const count = text.trim().split(/\s+/).filter(Boolean).length;
  if (!count) return null;
  const start = Math.max(0, Math.round(atMs));
  const words = wordsFromText(text, start, start + count * TYPED_WORD_MS, false);
  return pasteWords(origin, lineIndex, {
    text,
    words: words.map(word => ({ word, offsetMs: word.startMs - start })),
  }, start);
}

/* --------------------------------------------------------------- syllables */

/** Shortest a hand-made syllable may get while its boundaries are dragged. */
const MIN_SYLLABLE_MS = 30;

/**
 * A word the user split by hand. It is still one word — no space inside,
 * one block in the editor — but the player fills it syllable by syllable,
 * whatever its length, instead of deciding for itself.
 */
export function isSyllabicWord(word: GeneratedLyricsWord): boolean {
  return word.syllabic === true && (word.syllables?.length ?? 0) > 1;
}

const STRONG_VOWELS = new Set('aeoáéóàèòâêô');
const WEAK_VOWELS = new Set('iuüy');
const STRESSED_WEAK = new Set('íúìù');
/** Consonant pairs that always start a syllable together (Spanish and English). */
const ONSET_CLUSTERS = new Set([
  'pl', 'bl', 'fl', 'cl', 'gl', 'kl', 'pr', 'br', 'fr', 'cr', 'gr', 'kr', 'tr', 'dr',
]);
/** Letter pairs that sound as one consonant. */
const DIGRAPHS = new Set(['ch', 'll', 'rr', 'th', 'sh', 'ph', 'wh', 'ck', 'qu', 'gu']);

function isVowelAt(letters: string, index: number): boolean {
  const letter = letters[index];
  if (!letter) return false;
  if (STRONG_VOWELS.has(letter) || STRESSED_WEAK.has(letter) || letter === 'i' || letter === 'u' || letter === 'ü') {
    // The u of "que", "qui", "gue", "gui" is silent.
    if (letter === 'u' && (letters[index - 1] === 'q' || letters[index - 1] === 'g') && 'eiéí'.includes(letters[index + 1] ?? '')) {
      return false;
    }
    return true;
  }
  // "y" is a vowel when no vowel follows it: "hoy", "my", "baby".
  return letter === 'y' && index > 0 && !isVowelAt(letters, index + 1);
}

function isHiatus(left: string, right: string): boolean {
  return (STRONG_VOWELS.has(left) && STRONG_VOWELS.has(right))
    || STRESSED_WEAK.has(left) || STRESSED_WEAK.has(right)
    || (left === right && WEAK_VOWELS.has(left));
}

/**
 * A first guess at the syllables of a word, returned as pieces that join
 * back into exactly the original text — punctuation stays on the piece it
 * touches. Spanish rules by default; English merges vowel runs ("feel",
 * "does") and skips a silent final e or -es/-ed. The user corrects the rest
 * by moving a hyphen.
 */
export function hyphenate(text: string, language?: string | null): string[] {
  const english = language === 'en';
  const letters = text.toLocaleLowerCase();
  const positions: number[] = [];
  for (let index = 0; index < letters.length; index += 1) {
    if (/\p{L}/u.test(letters[index])) positions.push(index);
  }
  // Vowel nuclei, as [first, last] letter positions (indices into `positions`).
  const nuclei: Array<[number, number]> = [];
  positions.forEach((position, order) => {
    if (!isVowelAt(letters, position)) return;
    const previous = nuclei[nuclei.length - 1];
    const previousPosition = previous ? positions[previous[1]] : -1;
    const joins = english || !isHiatus(letters[previousPosition], letters[position]);
    if (previous && previous[1] === order - 1 && joins) {
      previous[1] = order;
    } else {
      nuclei.push([order, order]);
    }
  });
  if (english && nuclei.length >= 2) {
    // "make", "late", "times", "loved": the last vowel is not sung, unless
    // "-le" ("little") or "-ted"/"-ded" and "-ses"/"-zes" keep it.
    const [first, last] = nuclei[nuclei.length - 1];
    const tail = positions.slice(last + 1).map(position => letters[position]).join('');
    const vowel = letters[positions[first]];
    const before = letters[positions[first - 1]] ?? '';
    const silent = first === last && vowel === 'e' && (
      (tail === '' && before !== 'l')
      || (tail === 'd' && !'td'.includes(before))
      || (tail === 's' && !'szxh'.includes(before))
    );
    if (silent) nuclei.pop();
  }
  if (nuclei.length < 2) return [text];

  const cuts: number[] = [];
  for (let index = 0; index < nuclei.length - 1; index += 1) {
    const consonants = positions.slice(nuclei[index][1] + 1, nuclei[index + 1][0]);
    // Treat digraphs as one sound so they are never torn apart.
    const units: number[][] = [];
    for (let at = 0; at < consonants.length; at += 1) {
      const pair = letters[consonants[at]] + (letters[consonants[at + 1]] ?? '');
      // English doubles split between the letters: "lit-tle", "ar-rows".
      const doubled = english && pair[0] === pair[1];
      if (DIGRAPHS.has(pair) && !doubled && at + 1 < consonants.length) {
        units.push([consonants[at], consonants[at + 1]]);
        at += 1;
      } else {
        units.push([consonants[at]]);
      }
    }
    let onset: number;
    if (units.length === 0) {
      onset = positions[nuclei[index + 1][0]];
    } else if (units.length === 1) {
      onset = units[0][0];
    } else {
      const lastTwo = units.slice(-2).map(unit => unit.map(position => letters[position]).join('')).join('');
      // English "-ble", "-tle", "-dle": the consonant goes with the final "le".
      const finalLe = english && index === nuclei.length - 2 && lastTwo.endsWith('l')
        && positions.slice(nuclei[index + 1][0]).map(position => letters[position]).join('') === 'e';
      const clusterStarts = ONSET_CLUSTERS.has(lastTwo) || finalLe;
      onset = clusterStarts ? units[units.length - 2][0] : units[units.length - 1][0];
    }
    cuts.push(onset);
  }
  const pieces: string[] = [];
  let from = 0;
  for (const cut of cuts) {
    if (cut <= from) continue;
    pieces.push(text.slice(from, cut));
    from = cut;
  }
  pieces.push(text.slice(from));
  return pieces.filter(Boolean);
}

/** What the syllable field shows: the word's syllables joined by hyphens. */
export function syllableEditText(word: GeneratedLyricsWord, language?: string | null): string {
  const pieces = isSyllabicWord(word) ? word.syllables!.map(syllable => syllable.text) : hyphenate(word.text, language);
  return pieces.join('-');
}

/** Spreads contiguous syllables over [startMs, endMs] by letter count. */
function spreadSyllables(pieces: string[], startMs: number, endMs: number): GeneratedLyricsSyllable[] {
  const weights = pieces.map(normalizedLetters);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const span = Math.max(pieces.length * MIN_SYLLABLE_MS, endMs - startMs);
  let cursor = Math.round(startMs);
  return pieces.map((text, index) => {
    const end = index === pieces.length - 1
      ? Math.round(startMs + span)
      : Math.max(cursor + MIN_SYLLABLE_MS, Math.round(cursor + span * weights[index] / total));
    const syllable: GeneratedLyricsSyllable = { text, startMs: cursor, endMs: end, phones: [] };
    cursor = end;
    return syllable;
  });
}

/**
 * Sets a word's syllables from typed text, hyphens marking the cuts:
 * "co-ra-zón". Same number of pieces keeps the current timing; otherwise
 * the word's span is shared out by length. One piece makes it whole again.
 */
export function setWordSyllables(origin: GeneratedLyricsLine[], ref: WordRef, typed: string): GeneratedLyricsLine[] {
  const line = origin[ref.line];
  const word = line?.words[ref.word];
  const pieces = typed.replace(/\s+/g, '').split('-').filter(Boolean);
  if (!line || !word || !pieces.length) return origin;
  const text = pieces.join('');
  let next: GeneratedLyricsWord;
  if (pieces.length === 1) {
    next = { ...word, text, syllabic: undefined, syllables: [] };
  } else {
    const current = word.syllables ?? [];
    const keepTiming = current.length === pieces.length
      && current.every(syllable => syllable.endMs > syllable.startMs && syllable.startMs >= word.startMs && syllable.endMs <= word.endMs);
    const syllables = keepTiming
      ? current.map((syllable, index) => ({ ...syllable, text: pieces[index] }))
      : spreadSyllables(pieces, word.startMs, word.endMs);
    next = { ...word, text, syllabic: true, syllables };
  }
  const words = line.words.slice();
  words[ref.word] = next;
  return replaceLine(origin, ref.line, words, lineText(words));
}

/** Whether these words can be fused: two or more neighbours in one voice. */
export function canJoinAsSyllables(lines: GeneratedLyricsLine[], lineIndex: number, indices: number[]): boolean {
  const line = lines[lineIndex];
  const chosen = [...new Set(indices)].sort((a, b) => a - b);
  if (!line || chosen.length < 2) return false;
  const parts = chosen.map(index => line.words[index]);
  if (parts.some(word => !word)) return false;
  const background = isBackingWord(parts[0]);
  if (parts.some(word => isBackingWord(word) !== background)) return false;
  // Only neighbours in their voice: fusing across another word would swallow it.
  const layer = line.words.map((word, index) => ({ word, index })).filter(({ word }) => isBackingWord(word) === background);
  const first = layer.findIndex(entry => entry.index === chosen[0]);
  return layer.slice(first, first + chosen.length).every((entry, offset) => entry.index === chosen[offset])
    && first + chosen.length <= layer.length;
}

/**
 * Fuses neighbouring words of one voice into a single word whose syllables
 * are those words — for a word placed syllable by syllable. Each syllable
 * keeps exactly the time it was given, gaps included.
 */
export function joinAsSyllables(
  origin: GeneratedLyricsLine[],
  lineIndex: number,
  indices: number[],
): { lines: GeneratedLyricsLine[]; ref: WordRef } | null {
  const line = origin[lineIndex];
  const chosen = [...new Set(indices)].sort((a, b) => a - b);
  if (!line || !canJoinAsSyllables(origin, lineIndex, chosen)) return null;
  const parts = chosen.map(index => line.words[index]);
  const background = isBackingWord(parts[0]);

  const pieces = parts.flatMap(word => (
    isSyllabicWord(word)
      ? word.syllables!.map(syllable => ({ ...syllable, notes: syllable.notes }))
      : [{ text: word.text, startMs: word.startMs, endMs: word.endMs, phones: (word.syllables ?? []).flatMap(syllable => syllable.phones) }]
  ));
  const joined: GeneratedLyricsWord = {
    text: pieces.map(piece => piece.text).join(''),
    startMs: pieces[0].startMs,
    endMs: pieces[pieces.length - 1].endMs,
    confidence: Math.min(...parts.map(word => word.confidence)),
    syllabic: true,
    syllables: pieces,
    ...(background ? { background: true } : {}),
  };
  const words = line.words.filter((_, index) => !chosen.includes(index) || index === chosen[0]);
  const at = words.indexOf(line.words[chosen[0]]);
  words[at] = joined;
  return { lines: replaceLine(origin, lineIndex, words, lineText(words)), ref: { line: lineIndex, word: at } };
}

/** The reverse of joining: every syllable becomes its own word. */
export function splitSyllablesToWords(
  origin: GeneratedLyricsLine[],
  ref: WordRef,
): { lines: GeneratedLyricsLine[]; words: number[] } | null {
  const line = origin[ref.line];
  const word = line?.words[ref.word];
  if (!line || !word || !isSyllabicWord(word)) return null;
  const pieces: GeneratedLyricsWord[] = word.syllables!.map(syllable => ({
    text: syllable.text,
    startMs: syllable.startMs,
    endMs: syllable.endMs,
    confidence: word.confidence,
    syllables: [],
    ...(isBackingWord(word) ? { background: true } : {}),
  }));
  const words = [...line.words.slice(0, ref.word), ...pieces, ...line.words.slice(ref.word + 1)];
  return {
    lines: replaceLine(origin, ref.line, words, lineText(words)),
    words: pieces.map((_, offset) => ref.word + offset),
  };
}

function retimeSyllable(syllable: GeneratedLyricsSyllable, startMs: number, endMs: number): GeneratedLyricsSyllable {
  if (syllable.startMs === startMs && syllable.endMs === endMs) return syllable;
  const scale = (endMs - startMs) / Math.max(1, syllable.endMs - syllable.startMs);
  const map = (time: number) => clamp(Math.round(startMs + (time - syllable.startMs) * scale), startMs, endMs);
  return {
    ...syllable,
    startMs,
    endMs,
    notes: syllable.notes
      ?.map(note => ({ ...note, startMs: map(note.startMs), endMs: map(note.endMs) }))
      .filter(note => note.endMs > note.startMs),
  };
}

/**
 * Edits one syllable of a fused word as if it were a word of its own: the
 * word is opened up into its syllables, the ordinary word edit runs on that
 * line — shared edges, walls, minimum length and all — and the syllables are
 * folded back into the word, which then spans exactly them.
 */
function editSyllable(
  origin: GeneratedLyricsLine[],
  ref: WordRef,
  edit: (lines: GeneratedLyricsLine[], syllableRef: WordRef) => GeneratedLyricsLine[],
  syllableIndex: number,
): GeneratedLyricsLine[] {
  const line = origin[ref.line];
  const word = line?.words[ref.word];
  if (!line || !word || !isSyllabicWord(word) || !word.syllables![syllableIndex]) return origin;
  const syllables = word.syllables!;
  const opened: GeneratedLyricsWord[] = syllables.map(syllable => ({
    text: syllable.text,
    startMs: syllable.startMs,
    endMs: syllable.endMs,
    confidence: word.confidence,
    syllables: [],
    ...(isBackingWord(word) ? { background: true } : {}),
  }));
  const openedLines = origin.slice();
  openedLines[ref.line] = {
    ...line,
    words: [...line.words.slice(0, ref.word), ...opened, ...line.words.slice(ref.word + 1)],
  };
  const edited = edit(openedLines, { line: ref.line, word: ref.word + syllableIndex });
  if (edited === openedLines) return origin;
  const editedWords = edited[ref.line].words;
  const pieces = editedWords.slice(ref.word, ref.word + syllables.length);
  const folded: GeneratedLyricsWord = {
    ...word,
    startMs: pieces[0].startMs,
    endMs: pieces[pieces.length - 1].endMs,
    syllables: syllables.map((syllable, index) => retimeSyllable(syllable, pieces[index].startMs, pieces[index].endMs)),
  };
  const words = [...editedWords.slice(0, ref.word), folded, ...editedWords.slice(ref.word + syllables.length)];
  return replaceLine(origin, ref.line, words);
}

/** Slides one syllable of a fused word; neighbours behave as for words. */
export function moveSyllable(
  origin: GeneratedLyricsLine[],
  ref: WordRef,
  syllableIndex: number,
  deltaMs: number,
): GeneratedLyricsLine[] {
  return editSyllable(origin, ref, (lines, target) => moveWords(lines, target.line, [target.word], deltaMs), syllableIndex);
}

/** Drags one edge of one syllable of a fused word. */
export function moveSyllableEdge(
  origin: GeneratedLyricsLine[],
  ref: WordRef,
  syllableIndex: number,
  edge: WordEdge,
  deltaMs: number,
): GeneratedLyricsLine[] {
  return editSyllable(origin, ref, (lines, target) => moveWordEdge(lines, target, edge, deltaMs), syllableIndex);
}

/** Words inside parentheses that are not yet marked as backing vocals. */
export function countUnmarkedParenthesised(lines: GeneratedLyricsLine[]): number {
  let count = 0;
  for (const line of lines) {
    const marks = parenthesisedWords(line.words);
    // A line that is all parentheses is sung as the lead ("(Oh, oh, oh)").
    if (marks.every(Boolean)) continue;
    count += line.words.filter((word, index) => marks[index] && !isBackingWord(word)).length;
  }
  return count;
}

function parenthesisedWords(words: GeneratedLyricsWord[]): boolean[] {
  let depth = 0;
  return words.map(word => {
    const opens = (word.text.match(/\(/g) ?? []).length;
    const closes = (word.text.match(/\)/g) ?? []).length;
    const inside = depth > 0 || word.text.startsWith('(');
    depth = Math.max(0, depth + opens - closes);
    return inside;
  });
}

/**
 * Marks every parenthesised word as a backing vocal, the convention lyrics
 * sites use for them. Lines that are wholly parenthesised stay lead: they
 * are the only thing sung at that moment.
 */
export function markParenthesisedAsBacking(lines: GeneratedLyricsLine[]): GeneratedLyricsLine[] {
  let changed = false;
  const next = lines.map(line => {
    const marks = parenthesisedWords(line.words);
    if (!marks.some(Boolean) || marks.every(Boolean)) return line;
    const words = line.words.map((word, index) => {
      if (!marks[index] || isBackingWord(word)) return word;
      changed = true;
      return { ...word, background: true };
    });
    return { ...line, words };
  });
  return changed ? next : lines;
}

export interface NextWordOptions {
  /** Tap mode walks the lead vocal only; backing words overlap it. */
  leadOnly?: boolean;
}

export function nextWordRef(lines: GeneratedLyricsLine[], ref: WordRef, options: NextWordOptions = {}): WordRef | null {
  const accept = (word: GeneratedLyricsWord) => !options.leadOnly || !isBackingWord(word);
  for (let line = ref.line, word = ref.word + 1; line < lines.length; line += 1, word = 0) {
    const words = lines[line].words;
    for (; word < words.length; word += 1) {
      if (accept(words[word])) return { line, word };
    }
  }
  return null;
}

export function previousWordRef(lines: GeneratedLyricsLine[], ref: WordRef): WordRef | null {
  if (ref.word > 0) return { line: ref.line, word: ref.word - 1 };
  for (let line = ref.line - 1; line >= 0; line -= 1) {
    if (lines[line].words.length) return { line, word: lines[line].words.length - 1 };
  }
  return null;
}

/** The line whose phrase is under the playhead: the last one already begun. */
export function lineAtTime(lines: GeneratedLyricsLine[], timeMs: number): number {
  let found = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].words.length) continue;
    if (lines[index].startMs <= timeMs) found = index;
    else break;
  }
  return found;
}

/** The letter as it is saved: the edited lines, nothing else changed. */
export function finalizeTimedLyrics(lyrics: GeneratedLyrics, lines: GeneratedLyricsLine[]): GeneratedLyrics {
  return { ...lyrics, lines: lines.filter(line => line.words.length > 0) };
}
