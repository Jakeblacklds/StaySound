import type { Track } from '@staysound/types/audio';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { webAudioEngine } from '../audio/webAudioEngine';
import type { GeneratedLyricsLine } from '../karaoke/karaokeDesktop';
import {
  applyTap,
  canJoinAsSyllables,
  copyWords,
  countUnmarkedParenthesised,
  deleteLine,
  deleteWords,
  insertBackingPhrase,
  insertLine,
  insertWord,
  isBackingWord,
  isSyllabicWord,
  joinAsSyllables,
  lineAtTime,
  markParenthesisedAsBacking,
  mergeLineAsBacking,
  moveSyllable,
  moveSyllableEdge,
  moveWordEdge,
  moveWords,
  nextWordRef,
  pasteText,
  pasteWords,
  previousWordRef,
  renameWord,
  setBacking,
  setWordSyllables,
  shiftLine,
  splitBackingToLine,
  splitSyllablesToWords,
  syllableEditText,
  type CopiedWords,
  type WordEdge,
  type WordRef,
} from '../karaoke/lyricsTimingEdit';
import { loadVocalEnvelope, type VocalEnvelope } from '../karaoke/vocalEnvelope';
import {
  NextIcon,
  PlayPauseIcon,
  PlayIcon,
  PlusIcon,
  PreviousIcon,
  RedoIcon,
  RepeatIcon,
  TrashIcon,
  UndoIcon,
} from './icons';
import '../styles/lyrics-timing-editor.css';

type Lines = GeneratedLyricsLine[];

interface History {
  past: Lines[];
  present: Lines;
  future: Lines[];
}

interface LyricsTimingEditorProps {
  /**
   * The letter as last saved. It seeds the editor when it mounts; after that
   * it is only the reference edits are compared against, so saving in place
   * keeps the selection and the undo history.
   */
  savedLines: Lines;
  track: Track;
  nativePath: string;
  /** Every edit, with whether the letter still differs from what was opened. */
  onChange: (lines: Lines, dirty: boolean) => void;
  onSave: () => void;
}

const HISTORY_LIMIT = 150;
/** Audio shown on each side of the selected line. */
const LINE_PADDING_MS = 1_200;
/** Below this the shortest words stop being grabbable. */
const MIN_PX_PER_MS = 0.12;
/** How much lead-in a jump to a line or word gets, so the ear can lock on. */
const PREROLL_MS = 900;
const TAP_PREROLL_MS = 2_200;
const WORD_PREVIEW_PREROLL_MS = 350;
const WORD_PREVIEW_TAIL_MS = 250;
const NUDGE_MS = 20;
const NUDGE_LARGE_MS = 100;
const LINE_SHIFT_MS = 100;

function formatClock(ms: number): string {
  const safe = Math.max(0, ms);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const centis = Math.floor((safe % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

function nowMs(): number {
  return webAudioEngine.getCurrentTime() * 1000;
}

/** Runs every frame with the media clock; the callback may change freely. */
function useMediaFrame(callback: (timeMs: number) => void): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      callbackRef.current(nowMs());
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);
}

function useIsPlaying(): boolean {
  const [playing, setPlaying] = useState(() => webAudioEngine.getState().isPlaying);
  useEffect(() => webAudioEngine.subscribe(state => setPlaying(state.isPlaying)), []);
  return playing;
}

type VoiceKind = 'lead' | 'backing';

interface RenameRequest {
  word: number;
  key: number;
  /** Opens the field in syllable mode, hyphens marking the cuts. */
  syllables: boolean;
}

/** The first line with words at or before `index`, falling forward if none. */
function firstWordRefFrom(lines: Lines, index: number): WordRef {
  for (let line = index; line >= 0; line -= 1) {
    if (lines[line]?.words.length) return { line, word: 0 };
  }
  return firstWordRef(lines);
}

function firstWordRef(lines: Lines): WordRef {
  const line = Math.max(0, lines.findIndex(entry => entry.words.length > 0));
  return { line, word: 0 };
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable);
}

/**
 * Words copied in the editor, with their timing. Module-level so a copy
 * survives closing the editor and opening it on another song. The plain
 * text also goes to the system clipboard; on paste, text that no longer
 * matches it came from somewhere else and is pasted as new words.
 */
let editorClipboard: CopiedWords | null = null;

type SelectMode = 'replace' | 'extend' | 'toggle';
type DragKind = WordEdge | 'move';



export function LyricsTimingEditor({ savedLines, track, nativePath, onChange, onSave }: LyricsTimingEditorProps) {
  const [history, setHistory] = useState<History>(() => ({ past: [], present: savedLines, future: [] }));
  const lines = history.present;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  // Opens where the song is: whatever sounded wrong is usually right here.
  const [selected, setPrimary] = useState<WordRef>(() => {
    const current = lineAtTime(savedLines, nowMs());
    return current >= 0 ? { line: current, word: 0 } : firstWordRef(savedLines);
  });
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  /** Other words selected with the primary one, always on its line. */
  const [extra, setExtra] = useState<{ line: number; words: number[] }>({ line: -1, words: [] });
  const selection = useMemo(() => {
    const count = lines[selected.line]?.words.length ?? 0;
    const words = extra.line === selected.line ? [...extra.words, selected.word] : [selected.word];
    return [...new Set(words)].filter(index => index >= 0 && index < count).sort((a, b) => a - b);
  }, [extra, lines, selected]);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [showShortcuts, setShowShortcuts] = useState(false);
  /** A syllable of the primary word, when one was picked inside a fused word. */
  const [selectedSyllable, setSelectedSyllable] = useState<number | null>(null);
  const selectedSyllableRef = useRef(selectedSyllable);
  selectedSyllableRef.current = selectedSyllable;

  /** Every selection change goes through here, so stale extras never linger. */
  const select = useCallback((ref: WordRef, others: number[] = [], syllable: number | null = null) => {
    setPrimary(ref);
    setExtra({ line: ref.line, words: others });
    setSelectedSyllable(syllable);
  }, []);
  const [playheadLine, setPlayheadLine] = useState(-1);
  const [loopLine, setLoopLine] = useState(false);
  const [tapMode, setTapMode] = useState(false);
  const [tapCursor, setTapCursor] = useState<WordRef | null>(null);
  const [tapHolding, setTapHolding] = useState(false);
  const [envelope, setEnvelope] = useState<VocalEnvelope | null>(null);
  const [envelopeState, setEnvelopeState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const playing = useIsPlaying();
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const loopRef = useRef(loopLine);
  loopRef.current = loopLine;
  const tapModeRef = useRef(tapMode);
  tapModeRef.current = tapMode;
  const clockRef = useRef<HTMLOutputElement | null>(null);
  /** Pauses a word or line preview when it reaches its end. */
  const stopAtRef = useRef<number | null>(null);
  const dragOriginRef = useRef<Lines | null>(null);
  const tapRef = useRef<{ ref: WordRef; downAt: number; origin: Lines } | null>(null);
  /**
   * Playback follows the song line by line, but not right after the user
   * picked a line: the lead-in starts inside the previous one, and following
   * it there would undo their choice. Follow resumes once the playhead has
   * reached the line they picked.
   */
  const followRef = useRef({ armed: true, lastLine: -1 });

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    onChangeRef.current(lines, lines !== savedLines);
  }, [lines, savedLines]);

  useEffect(() => {
    let active = true;
    setEnvelopeState('loading');
    void loadVocalEnvelope(nativePath, track).then(result => {
      if (!active) return;
      setEnvelope(result);
      setEnvelopeState(result ? 'ready' : 'missing');
    });
    return () => {
      active = false;
    };
  }, [nativePath, track]);

  /* ------------------------------------------------------------ history */

  const commit = useCallback((update: (current: Lines) => Lines) => {
    setHistory(current => {
      const next = update(current.present);
      if (next === current.present) return current;
      return { past: [...current.past, current.present].slice(-HISTORY_LIMIT), present: next, future: [] };
    });
  }, []);

  /** Replaces the present without an undo step — the live frames of a gesture. */
  const preview = useCallback((next: Lines) => {
    setHistory(current => (next === current.present ? current : { ...current, present: next }));
  }, []);

  const checkpoint = useCallback(() => {
    setHistory(current => ({
      past: [...current.past, current.present].slice(-HISTORY_LIMIT),
      present: current.present,
      future: [],
    }));
  }, []);

  /** Drops the checkpoint of a gesture that ended up changing nothing. */
  const settle = useCallback(() => {
    setHistory(current => (
      current.past.at(-1) === current.present ? { ...current, past: current.past.slice(0, -1) } : current
    ));
  }, []);

  const undo = useCallback(() => {
    setHistory(current => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory(current => {
      const [next, ...rest] = current.future;
      if (!next) return current;
      return { past: [...current.past, current.present], present: next, future: rest };
    });
  }, []);

  /* ----------------------------------------------------------- playback */

  /**
   * Where the editor itself last sent the song. A `seeking` event that does
   * not land there came from outside — the player's bar, the keyboard, the
   * system media keys — and the editor has to go where the song went.
   */
  const ownSeekRef = useRef<number | null>(null);

  const seekTo = useCallback((ms: number) => {
    const target = Math.max(0, Math.round(ms));
    ownSeekRef.current = target;
    webAudioEngine.seek(target);
  }, []);

  const seek = useCallback((ms: number) => {
    stopAtRef.current = null;
    seekTo(ms);
  }, [seekTo]);

  const playRange = useCallback((fromMs: number, stopAtMs: number | null) => {
    seekTo(fromMs);
    stopAtRef.current = stopAtMs;
    void webAudioEngine.play();
  }, [seekTo]);

  const togglePlayback = useCallback(() => {
    stopAtRef.current = null;
    webAudioEngine.toggle();
  }, []);

  /* ---------------------------------------------------------- selection */

  const selectWord = useCallback((ref: WordRef, mode: SelectMode = 'replace', syllable: number | null = null) => {
    const current = selectedRef.current;
    if (mode === 'replace' && ref.line === current.line) {
      select(ref, [], syllable);
      return;
    }
    if (ref.line !== current.line) {
      followRef.current = { armed: false, lastLine: -2 };
      select(ref);
      return;
    }
    if (mode === 'extend') {
      // Shift extends from the word picked last, like any list.
      const from = Math.min(current.word, ref.word);
      const to = Math.max(current.word, ref.word);
      select(ref, Array.from({ length: to - from + 1 }, (_, offset) => from + offset));
    } else if (mode === 'toggle') {
      const chosen = selectionRef.current;
      if (chosen.includes(ref.word) && chosen.length > 1) {
        const rest = chosen.filter(index => index !== ref.word);
        select({ line: ref.line, word: rest[rest.length - 1] }, rest);
      } else {
        select(ref, chosen);
      }
    } else {
      select(ref);
    }
  }, [select]);

  const selectMany = useCallback((indices: number[], additive: boolean) => {
    const lineIndex = selectedRef.current.line;
    const words = additive ? [...selectionRef.current, ...indices] : indices;
    if (!words.length) return;
    select({ line: lineIndex, word: indices[indices.length - 1] ?? words[0] }, words);
  }, [select]);

  const goToLine = useCallback((lineIndex: number) => {
    const line = linesRef.current[lineIndex];
    if (!line?.words.length) return;
    followRef.current = { armed: false, lastLine: -2 };
    select({ line: lineIndex, word: 0 });
    seek(line.startMs - PREROLL_MS);
  }, [seek]);

  const stepLine = useCallback((direction: 1 | -1) => {
    const all = linesRef.current;
    for (let index = selectedRef.current.line + direction; index >= 0 && index < all.length; index += direction) {
      if (all[index].words.length) {
        goToLine(index);
        return;
      }
    }
  }, [goToLine]);

  const stepWord = useCallback((direction: 1 | -1, extend = false) => {
    const ref = direction > 0
      ? nextWordRef(linesRef.current, selectedRef.current)
      : previousWordRef(linesRef.current, selectedRef.current);
    if (!ref) return;
    if (extend && ref.line === selectedRef.current.line) {
      select(ref, [...selectionRef.current, ref.word]);
    } else {
      selectWord(ref);
    }
  }, [select, selectWord]);

  const selectAllInLine = useCallback(() => {
    const lineIndex = selectedRef.current.line;
    const count = linesRef.current[lineIndex]?.words.length ?? 0;
    if (count) select(selectedRef.current, Array.from({ length: count }, (_, index) => index));
  }, [select]);

  /* -------------------------------------------------------------- edits */

  const nudgeSelected = useCallback((deltaMs: number) => {
    const syllable = selectedSyllableRef.current;
    commit(current => (syllable != null && selectionRef.current.length === 1
      ? moveSyllable(current, selectedRef.current, syllable, deltaMs)
      : moveWords(current, selectedRef.current.line, selectionRef.current, deltaMs)));
  }, [commit]);

  const nudgeSelectedEdge = useCallback((edge: WordEdge, deltaMs: number) => {
    const syllable = selectedSyllableRef.current;
    commit(current => (syllable != null
      ? moveSyllableEdge(current, selectedRef.current, syllable, edge, deltaMs)
      : moveWordEdge(current, selectedRef.current, edge, deltaMs)));
  }, [commit]);

  const shiftSelectedLine = useCallback((deltaMs: number) => {
    commit(current => shiftLine(current, selectedRef.current.line, deltaMs));
  }, [commit]);

  const dragGroupRef = useRef<number[]>([]);

  const beginDrag = useCallback((group: number[]) => {
    dragOriginRef.current = linesRef.current;
    dragGroupRef.current = group;
    checkpoint();
  }, [checkpoint]);

  const drag = useCallback((kind: DragKind, wordIndex: number, deltaMs: number, syllable: number | null = null) => {
    const origin = dragOriginRef.current;
    if (!origin) return;
    const ref = { line: selectedRef.current.line, word: wordIndex };
    if (syllable != null) {
      preview(kind === 'move'
        ? moveSyllable(origin, ref, syllable, deltaMs)
        : moveSyllableEdge(origin, ref, syllable, kind, deltaMs));
      return;
    }
    preview(kind === 'move'
      ? moveWords(origin, ref.line, dragGroupRef.current, deltaMs)
      : moveWordEdge(origin, ref, kind, deltaMs));
  }, [preview]);

  /** Ends a drag; dropping on the other lane moves the words to that voice. */
  const endDrag = useCallback((dropBackground: boolean | null) => {
    const group = dragGroupRef.current;
    dragOriginRef.current = null;
    dragGroupRef.current = [];
    if (dropBackground != null && group.length) {
      const lineIndex = selectedRef.current.line;
      const result = setBacking(linesRef.current, lineIndex, group, dropBackground);
      if (result.lines !== linesRef.current) {
        preview(result.lines);
        select({ line: lineIndex, word: result.words[result.words.length - 1] ?? 0 }, result.words);
      }
    }
    settle();
  }, [preview, select, settle]);

  const rename = useCallback((wordIndex: number, text: string, syllables: boolean) => {
    const ref = { line: selectedRef.current.line, word: wordIndex };
    commit(current => (syllables ? setWordSyllables(current, ref, text) : renameWord(current, ref, text)));
  }, [commit]);

  /** Adds a word at `timeMs` and returns where it landed, for the rename field. */
  const addWord = useCallback((timeMs: number, background: boolean): number | null => {
    const lineIndex = selectedRef.current.line;
    const result = insertWord(linesRef.current, lineIndex, timeMs, background);
    if (!result) return null;
    commit(() => result.lines);
    select(result.ref);
    return result.ref.word;
  }, [commit]);

  /** The toolbar's add: at the playhead when it is on this line, else after the selection. */
  const [renameRequest, setRenameRequest] = useState<RenameRequest | null>(null);

  /** Opens the syllable field ("co-ra-zón") on the selected word. */
  const editSyllables = useCallback(() => {
    setRenameRequest({ word: selectedRef.current.word, key: Date.now(), syllables: true });
  }, []);

  const joinSelected = useCallback(() => {
    const lineIndex = selectedRef.current.line;
    const result = joinAsSyllables(linesRef.current, lineIndex, selectionRef.current);
    if (!result) return;
    commit(() => result.lines);
    select(result.ref);
  }, [commit, select]);

  const splitSelectedSyllables = useCallback(() => {
    const result = splitSyllablesToWords(linesRef.current, selectedRef.current);
    if (!result) return;
    commit(() => result.lines);
    select({ line: selectedRef.current.line, word: result.words[0] }, result.words);
  }, [commit, select]);
  const addWordHere = useCallback(() => {
    const lineIndex = selectedRef.current.line;
    const line = linesRef.current[lineIndex];
    const word = line?.words[selectedRef.current.word];
    if (!line || !word) return;
    const time = nowMs();
    const onThisLine = time >= line.startMs - LINE_PADDING_MS && time <= line.endMs + LINE_PADDING_MS;
    const index = addWord(onThisLine ? time : word.endMs, isBackingWord(word));
    if (index != null) setRenameRequest({ word: index, key: Date.now(), syllables: false });
  }, [addWord]);

  const deleteSelected = useCallback(() => {
    const lineIndex = selectedRef.current.line;
    const chosen = selectionRef.current;
    const next = deleteWords(linesRef.current, lineIndex, chosen);
    if (next === linesRef.current) return;
    commit(() => next);
    if (next.length < linesRef.current.length) {
      select(firstWordRefFrom(next, Math.min(lineIndex, next.length - 1)));
    } else {
      select({ line: lineIndex, word: Math.max(0, Math.min(chosen[0], next[lineIndex].words.length - 1)) });
    }
  }, [commit, select]);

  const toggleSelectedBacking = useCallback(() => {
    const lineIndex = selectedRef.current.line;
    const words = linesRef.current[lineIndex]?.words ?? [];
    const chosen = selectionRef.current;
    // Mixed selections go to the backing voice; all-backing ones come back.
    const toBacking = chosen.some(index => words[index] && !isBackingWord(words[index]));
    const result = setBacking(linesRef.current, lineIndex, chosen, toBacking);
    if (result.lines === linesRef.current) return;
    commit(() => result.lines);
    select({ line: lineIndex, word: result.words[result.words.length - 1] ?? 0 }, result.words);
  }, [commit, select]);

  const copySelection = useCallback(() => {
    const copied = copyWords(linesRef.current, selectedRef.current.line, selectionRef.current);
    if (!copied) return false;
    editorClipboard = copied;
    void navigator.clipboard?.writeText(copied.text).catch(() => undefined);
    return true;
  }, []);

  const cutSelection = useCallback(() => {
    if (copySelection()) deleteSelected();
  }, [copySelection, deleteSelected]);

  /** Where pasted words start: the playhead on this line, else after the selection. */
  const pasteTime = useCallback(() => {
    const line = linesRef.current[selectedRef.current.line];
    if (!line) return 0;
    const time = nowMs();
    if (time >= line.startMs - LINE_PADDING_MS && time <= line.endMs + LINE_PADDING_MS) return time;
    const chosen = selectionRef.current.map(index => line.words[index]).filter(Boolean);
    return chosen.length ? Math.max(...chosen.map(word => word.endMs)) : line.endMs;
  }, []);

  const pasteClipboard = useCallback(async () => {
    const lineIndex = selectedRef.current.line;
    const at = pasteTime();
    let external: string | null = null;
    try {
      external = (await navigator.clipboard?.readText()) ?? null;
    } catch {
      external = null;
    }
    const internal = editorClipboard;
    const result = internal && (external == null || external.trim() === internal.text.trim())
      ? pasteWords(linesRef.current, lineIndex, internal, at)
      : external?.trim()
        ? pasteText(linesRef.current, lineIndex, external.replace(/\s+/g, ' '), at)
        : null;
    if (!result) return;
    commit(() => result.lines);
    select({ line: lineIndex, word: result.words[result.words.length - 1] ?? 0 }, result.words);
  }, [commit, pasteTime, select]);

  const markParenthesised = useCallback(() => {
    commit(current => markParenthesisedAsBacking(current));
  }, [commit]);

  /* -------------------------------------------------------------- lines */

  /** The line a new lead line goes after, or the line a new backing phrase joins. */
  const [composer, setComposer] = useState<{ anchor: number; kind: VoiceKind } | null>(null);

  const selectLineQuietly = useCallback((ref: WordRef) => {
    followRef.current = { armed: false, lastLine: -2 };
    select(ref);
  }, []);

  const openComposer = useCallback((anchor: number, kind: VoiceKind) => {
    setComposer({ anchor, kind });
  }, []);

  const submitComposer = useCallback((text: string, kind: VoiceKind) => {
    const anchor = composer?.anchor ?? selectedRef.current.line;
    if (kind === 'lead') {
      const result = insertLine(linesRef.current, anchor, text, nowMs());
      if (!result) return;
      commit(() => result.lines);
      selectLineQuietly({ line: result.line, word: 0 });
    } else {
      const result = insertBackingPhrase(linesRef.current, Math.max(0, anchor), text, nowMs());
      if (!result) return;
      commit(() => result.lines);
      selectLineQuietly(result.ref);
    }
    setComposer(null);
  }, [commit, composer, selectLineQuietly]);

  const makeLineBacking = useCallback(() => {
    const result = mergeLineAsBacking(linesRef.current, selectedRef.current.line);
    if (!result) return;
    commit(() => result.lines);
    const words = result.lines[result.line].words;
    selectLineQuietly({ line: result.line, word: Math.max(0, words.findIndex(isBackingWord)) });
  }, [commit, selectLineQuietly]);

  const splitSelectedBacking = useCallback(() => {
    const result = splitBackingToLine(linesRef.current, selectedRef.current.line);
    if (!result) return;
    commit(() => result.lines);
    selectLineQuietly({ line: result.line, word: 0 });
  }, [commit, selectLineQuietly]);

  const deleteSelectedLine = useCallback(() => {
    const index = selectedRef.current.line;
    const next = deleteLine(linesRef.current, index);
    if (next === linesRef.current) return;
    commit(() => next);
    selectLineQuietly(firstWordRefFrom(next, Math.min(index, next.length - 1)));
  }, [commit, selectLineQuietly]);

  const playSelectedWord = useCallback(() => {
    const word = linesRef.current[selectedRef.current.line]?.words[selectedRef.current.word];
    if (word) playRange(word.startMs - WORD_PREVIEW_PREROLL_MS, word.endMs + WORD_PREVIEW_TAIL_MS);
  }, [playRange]);

  const playSelectedLine = useCallback(() => {
    const line = linesRef.current[selectedRef.current.line];
    if (line) playRange(line.startMs - PREROLL_MS, loopRef.current ? null : line.endMs + WORD_PREVIEW_TAIL_MS);
  }, [playRange]);

  /* ------------------------------------------------------ tap to rhythm */

  const tapCursorRef = useRef(tapCursor);
  tapCursorRef.current = tapCursor;

  const startTapMode = useCallback(() => {
    const selectedWord = linesRef.current[selectedRef.current.line]?.words[selectedRef.current.word];
    // Backing words overlap the lead, so a single key cannot mark both.
    const ref = selectedWord && isBackingWord(selectedWord)
      ? nextWordRef(linesRef.current, selectedRef.current, { leadOnly: true })
      : selectedRef.current;
    const word = ref ? linesRef.current[ref.line]?.words[ref.word] : null;
    if (!ref || !word) return;
    // The whole take is one undo step, however many words it marks.
    checkpoint();
    setLoopLine(false);
    setTapCursor(ref);
    setTapMode(true);
    playRange(word.startMs - TAP_PREROLL_MS, null);
  }, [checkpoint, playRange]);

  const tapDown = useCallback(() => {
    const cursor = tapCursorRef.current;
    if (!cursor || tapRef.current) return;
    const at = nowMs();
    tapRef.current = { ref: cursor, downAt: at, origin: linesRef.current };
    setTapHolding(true);
    select(cursor);
    preview(applyTap(linesRef.current, cursor, at, at));
  }, [preview]);

  const tapUp = useCallback(() => {
    const tap = tapRef.current;
    if (!tap) return;
    tapRef.current = null;
    setTapHolding(false);
    const marked = applyTap(tap.origin, tap.ref, tap.downAt, nowMs());
    preview(marked);
    const next = nextWordRef(marked, tap.ref, { leadOnly: true });
    setTapCursor(next);
    if (next) {
      select(next);
    } else {
      setTapMode(false);
      settle();
    }
  }, [preview, settle]);

  const stopTapMode = useCallback(() => {
    if (tapRef.current) tapUp();
    setTapMode(false);
    setTapCursor(null);
    webAudioEngine.pause();
    settle();
  }, [settle, tapUp]);

  /* ---------------------------------------------------------- the clock */

  useMediaFrame(time => {
    if (clockRef.current) clockRef.current.textContent = formatClock(time);
    if (stopAtRef.current != null && time >= stopAtRef.current) {
      stopAtRef.current = null;
      webAudioEngine.pause();
    }
    const tap = tapRef.current;
    if (tap) preview(applyTap(tap.origin, tap.ref, tap.downAt, time));

    const current = lineAtTime(linesRef.current, time);
    setPlayheadLine(current);
    if (!playingRef.current || dragOriginRef.current || tapModeRef.current) return;

    const line = linesRef.current[selectedRef.current.line];
    if (loopRef.current && line) {
      if (time > line.endMs + 450) seekTo(line.startMs - PREROLL_MS);
      return;
    }
    const follow = followRef.current;
    if (current === follow.lastLine) return;
    follow.lastLine = current;
    if (!follow.armed) {
      if (current === selectedRef.current.line) follow.armed = true;
      return;
    }
    if (current >= 0 && current !== selectedRef.current.line) select({ line: current, word: 0 });
  });

  /* ------------------------------------------------------------ keyboard */

  const keysRef = useRef({
    undo, redo, onSave, togglePlayback, tapDown, tapUp, stopTapMode, startTapMode,
    stepWord, stepLine, nudgeSelected, playSelectedWord, setLoopLine,
    addWordHere, deleteSelected, toggleSelectedBacking, openComposer,
    copySelection, cutSelection, pasteClipboard, selectAllInLine, setShowShortcuts,
    editSyllables, joinSelected,
  });
  keysRef.current = {
    undo, redo, onSave, togglePlayback, tapDown, tapUp, stopTapMode, startTapMode,
    stepWord, stepLine, nudgeSelected, playSelectedWord, setLoopLine,
    addWordHere, deleteSelected, toggleSelectedBacking, openComposer,
    copySelection, cutSelection, pasteClipboard, selectAllInLine, setShowShortcuts,
    editSyllables, joinSelected,
  };

  useEffect(() => {
    // Capture phase on window runs before the player's own shortcuts on
    // document, so Space and the arrows mean "editor" while it is open.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const keys = keysRef.current;
      const command = event.metaKey || event.ctrlKey;
      let handled = true;
      if (command && event.code === 'KeyZ') {
        if (event.shiftKey) keys.redo();
        else keys.undo();
      } else if (command && event.code === 'KeyY') {
        keys.redo();
      } else if (command && event.code === 'KeyS') {
        keys.onSave();
      } else if (command && tapModeRef.current) {
        handled = false;
      } else if (command && event.code === 'KeyC') {
        keys.copySelection();
      } else if (command && event.code === 'KeyX') {
        keys.cutSelection();
      } else if (command && event.code === 'KeyV') {
        void keys.pasteClipboard();
      } else if (command && event.code === 'KeyA') {
        keys.selectAllInLine();
      } else if (command) {
        handled = false;
      } else if (event.code === 'Space') {
        // A focused button would also "click" on release.
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
        if (!event.repeat) {
          if (tapModeRef.current && playingRef.current) keys.tapDown();
          else keys.togglePlayback();
        }
      } else if (event.code === 'Escape') {
        // Never let it reach the full player: closing it would drop the edits.
        if (tapModeRef.current) keys.stopTapMode();
        else keys.setShowShortcuts(false);
      } else if (event.key === '?') {
        keys.setShowShortcuts(open => !open);
      } else if (tapModeRef.current) {
        handled = false;
      } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        const direction = event.code === 'ArrowLeft' ? -1 : 1;
        if (event.altKey) keys.nudgeSelected(direction * (event.shiftKey ? NUDGE_LARGE_MS : NUDGE_MS));
        else keys.stepWord(direction, event.shiftKey);
      } else if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        keys.stepLine(event.code === 'ArrowUp' ? -1 : 1);
      } else if (event.code === 'Enter') {
        keys.playSelectedWord();
      } else if (event.code === 'KeyT') {
        keys.startTapMode();
      } else if (event.code === 'KeyL') {
        keys.setLoopLine(loop => !loop);
      } else if (event.code === 'KeyN') {
        keys.openComposer(selectedRef.current.line, 'lead');
      } else if (event.code === 'KeyA') {
        keys.addWordHere();
      } else if (event.code === 'KeyS') {
        keys.editSyllables();
      } else if (event.code === 'KeyJ') {
        keys.joinSelected();
      } else if (event.code === 'KeyC') {
        keys.toggleSelectedBacking();
      } else if (event.code === 'Backspace' || event.code === 'Delete') {
        keys.deleteSelected();
      } else {
        handled = false;
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isTypingTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      keysRef.current.tapUp();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, []);

  // A jump made outside the editor (the player's bar, media keys) moves the
  // editor with it. Without this, a line picked earlier kept follow switched
  // off until playback happened to reach that line again, so after scrubbing
  // elsewhere the editor sat on a line the song was no longer playing.
  useEffect(() => {
    const audio = webAudioEngine.getAudioElement();
    const handleSeeking = () => {
      const time = audio.currentTime * 1000;
      const own = ownSeekRef.current;
      ownSeekRef.current = null;
      if (own != null && Math.abs(time - own) < 250) return;
      stopAtRef.current = null;
      const all = linesRef.current;
      const lineIndex = lineAtTime(all, time);
      followRef.current = { armed: true, lastLine: lineIndex };
      if (tapModeRef.current || dragOriginRef.current || lineIndex < 0) return;
      if (loopRef.current && lineIndex !== selectedRef.current.line) setLoopLine(false);
      const words = all[lineIndex].words;
      const sung = words.findIndex(word => !isBackingWord(word) && word.endMs > time);
      select({ line: lineIndex, word: Math.max(0, sung) });
    };
    audio.addEventListener('seeking', handleSeeking);
    return () => audio.removeEventListener('seeking', handleSeeking);
  }, [select]);

  // Leaving mid-preview must not leave a pause armed for later playback.
  useEffect(() => () => {
    stopAtRef.current = null;
  }, []);

  const line = lines[selected.line];
  const word = line?.words[selected.word];
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  const tapWord = tapMode && tapCursor?.line === selected.line ? tapCursor.word : null;
  const unmarkedParenthesised = useMemo(() => countUnmarkedParenthesised(lines), [lines]);

  return (
    <div className="lte">
      <LineList
        lines={lines}
        selectedLine={selected.line}
        playheadLine={playheadLine}
        onSelect={goToLine}
        onAddAfter={anchor => openComposer(anchor, 'lead')}
      />

      <section className="lte-stage" aria-label="Ajuste de tiempos">
        {line ? (
          <>
            <header className="lte-stage-head">
              <span className="lte-stage-title">
                Línea {selected.line + 1} de {lines.length}
                <span aria-hidden="true">·</span>
                {formatClock(line.startMs)} – {formatClock(line.endMs)}
              </span>
              <div className="lte-stage-tools">
                <div className="lte-voice" role="radiogroup" aria-label="Voz de esta línea">
                  <button type="button" role="radio" aria-checked="true" className="active">Voz principal</button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked="false"
                    disabled={tapMode || firstWordRef(lines).line === selected.line}
                    onClick={makeLineBacking}
                    title="Esta línea es el coro de la anterior: se mostrará pequeña debajo de ella"
                  >
                    Coro de la anterior
                  </button>
                </div>
                {line.words.some(isBackingWord) && !line.words.every(isBackingWord) ? (
                  <button type="button" className="lte-chip" onClick={splitSelectedBacking} disabled={tapMode} title="Pasar el coro a su propia línea">
                    Separar coro
                  </button>
                ) : null}
                <button
                  type="button"
                  className="lte-chip"
                  onClick={() => openComposer(selected.line, 'lead')}
                  disabled={tapMode}
                  title="Añadir una línea o un coro · N"
                >
                  <PlusIcon size={13} /> Línea
                </button>
                <button
                  type="button"
                  className="lte-chip"
                  onClick={deleteSelectedLine}
                  disabled={tapMode || lines.filter(entry => entry.words.length).length < 2}
                  aria-label="Borrar línea"
                  title="Borrar esta línea"
                >
                  <TrashIcon size={13} />
                </button>
              </div>
            </header>

            {composer && !tapMode ? (
              <LineComposer
                key={`${composer.anchor}-${composer.kind}`}
                anchorText={lines[composer.anchor]?.text ?? ''}
                initialKind={composer.kind}
                canBeBacking={composer.anchor >= 0 && !!lines[composer.anchor]?.words.length}
                onSubmit={submitComposer}
                onCancel={() => setComposer(null)}
              />
            ) : null}

            {unmarkedParenthesised > 0 && !tapMode ? (
              <div className="lte-notice">
                <span>
                  {unmarkedParenthesised === 1
                    ? 'Hay 1 palabra entre paréntesis cantada como voz principal.'
                    : `Hay ${unmarkedParenthesised} palabras entre paréntesis cantadas como voz principal.`}
                </span>
                <button type="button" className="lte-chip" onClick={markParenthesised}>Pasarlas al coro</button>
              </div>
            ) : null}

            <LinePreview
              line={line}
              selectedWord={selected.word}
              tapWord={tapWord}
              onSelectWord={wordIndex => selectWord({ line: selected.line, word: wordIndex })}
            />

            <Timeline
              lines={lines}
              lineIndex={selected.line}
              selectedWord={selected.word}
              selection={selection}
              tapWord={tapWord}
              envelope={envelope}
              envelopeState={envelopeState}
              playing={playing}
              interactive={!tapMode}
              selectedSyllable={selectedSyllable}
              canFuse={selection.length > 1 && canJoinAsSyllables(lines, selected.line, selection)}
              onFuse={joinSelected}
              onSelectWord={(wordIndex, mode, syllable) => selectWord({ line: selected.line, word: wordIndex }, mode, syllable)}
              onSelectMany={selectMany}
              onSeek={seek}
              onBeginDrag={beginDrag}
              onDrag={drag}
              onEndDrag={endDrag}
              onRename={rename}
              onInsert={addWord}
              renameRequest={renameRequest}
              language={line.language ?? null}
            />

            {tapMode ? (
              <div className={`lte-tap ${tapHolding ? 'holding' : ''}`}>
                <button
                  type="button"
                  className="lte-tap-pad"
                  onPointerDown={event => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    if (playing) tapDown();
                    else togglePlayback();
                  }}
                  onPointerUp={tapUp}
                  onPointerCancel={tapUp}
                >
                  <span className="lte-tap-word">
                    {tapCursor ? lines[tapCursor.line]?.words[tapCursor.word]?.text : ''}
                  </span>
                  <span className="lte-tap-hint">
                    {playing
                      ? 'Mantén pulsada la barra espaciadora mientras suena cada palabra'
                      : 'Pulsa espacio para continuar'}
                  </span>
                </button>
                <button type="button" className="lte-chip" onClick={stopTapMode}>Terminar · Esc</button>
              </div>
            ) : word ? (
              <div className="lte-inspector">
                {selection.length > 1 ? (
                  <>
                    <div className="lte-word-name">
                      <span>Selección</span>
                      <strong>{selection.length} palabras</strong>
                      <small>⌘C copiar · ⌘X cortar · ⌘V pegar</small>
                    </div>
                    <TimeStepper
                      label="Mover juntas"
                      valueMs={Math.min(...selection.map(index => line.words[index].startMs))}
                      onStep={nudgeSelected}
                    />
                    <button
                      type="button"
                      className="lte-chip lte-join"
                      onClick={joinSelected}
                      disabled={!canJoinAsSyllables(lines, selected.line, selection)}
                      title="Las palabras seleccionadas pasan a ser las sílabas de una sola palabra, cada una con su tiempo · J"
                    >
                      Fusionar en palabra
                    </button>
                  </>
                ) : selectedSyllable != null && isSyllabicWord(word) && word.syllables![selectedSyllable] ? (
                  <>
                    <div className="lte-word-name">
                      <span>Sílaba de «{word.text}»</span>
                      <strong>{word.syllables![selectedSyllable].text}</strong>
                      <small>
                        {selectedSyllable + 1} de {word.syllables!.length} ·{' '}
                        {Math.round(word.syllables![selectedSyllable].endMs - word.syllables![selectedSyllable].startMs)} ms
                      </small>
                    </div>
                    <TimeStepper
                      label="Empieza"
                      valueMs={word.syllables![selectedSyllable].startMs}
                      onStep={delta => nudgeSelectedEdge('start', delta)}
                    />
                    <TimeStepper
                      label="Termina"
                      valueMs={word.syllables![selectedSyllable].endMs}
                      onStep={delta => nudgeSelectedEdge('end', delta)}
                    />
                  </>
                ) : (
                  <>
                    <div className="lte-word-name">
                      <span>Palabra</span>
                      <strong>{isSyllabicWord(word) ? word.syllables!.map(syllable => syllable.text).join('·') : word.text}</strong>
                      <small>
                        {isSyllabicWord(word) ? `${word.syllables!.length} sílabas · ` : ''}
                        {Math.round(word.endMs - word.startMs)} ms
                      </small>
                    </div>
                    <TimeStepper
                      label="Empieza"
                      valueMs={word.startMs}
                      onStep={delta => nudgeSelectedEdge('start', delta)}
                    />
                    <TimeStepper
                      label="Termina"
                      valueMs={word.endMs}
                      onStep={delta => nudgeSelectedEdge('end', delta)}
                    />
                  </>
                )}
                <div className="lte-inspector-actions">
                  <button
                    type="button"
                    className={`lte-chip lte-backing-toggle ${selection.every(index => isBackingWord(line.words[index])) ? 'active' : ''}`}
                    aria-pressed={selection.every(index => isBackingWord(line.words[index]))}
                    onClick={toggleSelectedBacking}
                    title="Voz de fondo: se muestra debajo de la línea y puede cruzarse con ella · C"
                  >
                    Coro
                  </button>
                  {selection.length === 1 ? (
                    <button
                      type="button"
                      className={`lte-chip ${isSyllabicWord(word) ? 'active' : ''}`}
                      onClick={editSyllables}
                      title="Dividir la palabra en sílabas, cada una con su tiempo · S"
                    >
                      Sílabas
                    </button>
                  ) : null}
                  {selection.length === 1 && isSyllabicWord(word) ? (
                    <button type="button" className="lte-chip" onClick={splitSelectedSyllables} title="Cada sílaba vuelve a ser una palabra suelta">
                      Separar sílabas
                    </button>
                  ) : null}
                  <button type="button" className="lte-chip" onClick={addWordHere} title="Añadir una palabra en el cursor · A">
                    <PlusIcon size={13} /> Palabra
                  </button>
                  <button
                    type="button"
                    className="lte-chip"
                    onClick={deleteSelected}
                    aria-label={selection.length > 1 ? 'Borrar palabras' : 'Borrar palabra'}
                    title="Borrar · ⌫"
                  >
                    <TrashIcon size={13} />
                  </button>
                  <button type="button" className="lte-chip" onClick={playSelectedWord}>
                    <PlayIcon size={13} /> Palabra
                  </button>
                  <button type="button" className="lte-chip" onClick={playSelectedLine}>
                    <PlayIcon size={13} /> Línea
                  </button>
                  <div className="lte-line-shift" role="group" aria-label="Mover toda la línea">
                    <button type="button" onClick={() => shiftSelectedLine(-LINE_SHIFT_MS)} title="Adelantar la línea 0.1 s">−0.1 s</button>
                    <span>Línea</span>
                    <button type="button" onClick={() => shiftSelectedLine(LINE_SHIFT_MS)} title="Atrasar la línea 0.1 s">+0.1 s</button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        <footer className="lte-transport">
          <div className="lte-transport-group">
            <button type="button" className="lte-icon-button" onClick={() => stepLine(-1)} aria-label="Línea anterior" title="Línea anterior · ↑">
              <PreviousIcon size={16} />
            </button>
            <button type="button" className="lte-icon-button lte-play" onClick={togglePlayback} aria-label={playing ? 'Pausar' : 'Reproducir'} title="Reproducir o pausar · Espacio">
              <PlayPauseIcon playing={playing} size={17} />
            </button>
            <button type="button" className="lte-icon-button" onClick={() => stepLine(1)} aria-label="Línea siguiente" title="Línea siguiente · ↓">
              <NextIcon size={16} />
            </button>
            <output ref={clockRef} className="lte-clock">0:00.00</output>
          </div>
          <div className="lte-transport-group">
            <button
              type="button"
              className={`lte-chip ${loopLine ? 'active' : ''}`}
              aria-pressed={loopLine}
              onClick={() => setLoopLine(loop => !loop)}
              title="Repetir la línea seleccionada · L"
            >
              <RepeatIcon size={13} /> Repetir línea
            </button>
            <button
              type="button"
              className={`lte-chip lte-tap-toggle ${tapMode ? 'active' : ''}`}
              aria-pressed={tapMode}
              onClick={() => (tapMode ? stopTapMode() : startTapMode())}
              title="Marca cada palabra al ritmo con la barra espaciadora · T"
            >
              <span className="lte-rec-dot" aria-hidden="true" /> Marcar al ritmo
            </button>
            <button type="button" className="lte-icon-button" onClick={undo} disabled={!canUndo} aria-label="Deshacer" title="Deshacer · ⌘Z">
              <UndoIcon size={16} />
            </button>
            <button type="button" className="lte-icon-button" onClick={redo} disabled={!canRedo} aria-label="Rehacer" title="Rehacer · ⇧⌘Z">
              <RedoIcon size={16} />
            </button>
            <button
              type="button"
              className={`lte-icon-button lte-help-button ${showShortcuts ? 'active' : ''}`}
              onClick={() => setShowShortcuts(open => !open)}
              aria-label="Atajos de teclado"
              aria-expanded={showShortcuts}
              title="Atajos de teclado · ?"
            >
              ?
            </button>
          </div>
        </footer>
        {showShortcuts ? <ShortcutsPanel onClose={() => setShowShortcuts(false)} /> : (
          <p className="lte-hints">
            Arrastra para mover · arrastra al otro carril para cambiar de voz · ⇧ o ⌘ clic, o un recuadro, para
            elegir varias · ⌘C ⌘V copiar y pegar · ⌘Z deshacer · ? todos los atajos
          </p>
        )}
      </section>
    </div>
  );
}

/* ================================================================ line list */

const LineList = memo(function LineList({
  lines,
  selectedLine,
  playheadLine,
  onSelect,
  onAddAfter,
}: {
  lines: Lines;
  selectedLine: number;
  playheadLine: number;
  onSelect: (line: number) => void;
  onAddAfter: (line: number) => void;
}) {
  const listRef = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    const row = listRef.current?.children[selectedLine] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedLine]);

  return (
    <div className="lte-sidebar">
      <ol className="lte-lines" ref={listRef} aria-label="Líneas">
        {lines.map((line, index) => {
          const allBacking = line.words.length > 0 && line.words.every(isBackingWord);
          const lead = allBacking ? line.words : line.words.filter(word => !isBackingWord(word));
          const backing = allBacking ? [] : line.words.filter(isBackingWord);
          return (
            <li key={index}>
              <button
                type="button"
                disabled={!line.words.length}
                className={[
                  'lte-line-row',
                  index === selectedLine ? 'selected' : '',
                  index === playheadLine ? 'playing' : '',
                ].join(' ')}
                aria-current={index === selectedLine ? 'true' : undefined}
                onClick={() => onSelect(index)}
              >
                <time>{formatClock(line.startMs).slice(0, -3)}</time>
                <span className="lte-line-text">
                  <span>{lead.map(word => word.text).join(' ')}</span>
                  {backing.length ? <small>{backing.map(word => word.text).join(' ')}</small> : null}
                </span>
              </button>
              <button
                type="button"
                className="lte-line-add"
                onClick={() => onAddAfter(index)}
                aria-label="Añadir una línea debajo"
                title="Añadir una línea debajo"
              >
                <PlusIcon size={12} />
              </button>
            </li>
          );
        })}
      </ol>
      <button type="button" className="lte-add-line" onClick={() => onAddAfter(lines.length - 1)}>
        <PlusIcon size={13} /> Añadir línea al final
      </button>
    </div>
  );
});

function LineComposer({
  anchorText,
  initialKind,
  canBeBacking,
  onSubmit,
  onCancel,
}: {
  anchorText: string;
  initialKind: VoiceKind;
  canBeBacking: boolean;
  onSubmit: (text: string, kind: VoiceKind) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<VoiceKind>(canBeBacking ? initialKind : 'lead');
  const anchor = anchorText.length > 42 ? `${anchorText.slice(0, 40)}…` : anchorText;
  return (
    <form
      className="lte-composer"
      onSubmit={event => {
        event.preventDefault();
        if (text.trim()) onSubmit(text, kind);
      }}
    >
      <div className="lte-voice" role="radiogroup" aria-label="Qué voz es">
        <button type="button" role="radio" aria-checked={kind === 'lead'} className={kind === 'lead' ? 'active' : ''} onClick={() => setKind('lead')}>
          Voz principal
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={kind === 'backing'}
          className={kind === 'backing' ? 'active' : ''}
          disabled={!canBeBacking}
          onClick={() => setKind('backing')}
        >
          Coro
        </button>
      </div>
      <input
        value={text}
        autoFocus
        placeholder={kind === 'lead' ? 'Escribe la nueva línea…' : 'Escribe el coro, por ejemplo: oh, oh'}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        aria-label={kind === 'lead' ? 'Texto de la nueva línea' : 'Texto del coro'}
      />
      <button type="submit" className="lte-chip active" disabled={!text.trim()}>Añadir</button>
      <button type="button" className="lte-chip" onClick={onCancel}>Cancelar</button>
      <small>
        {kind === 'lead'
          ? anchor ? `Irá después de «${anchor}». Luego márcala al ritmo o arrastra sus palabras.` : 'Irá al principio de la canción.'
          : `Se mostrará pequeño debajo de «${anchor}», en la misma línea.`}
      </small>
    </form>
  );
}

/* ============================================================ line preview */

function LinePreview({
  line,
  selectedWord,
  tapWord,
  onSelectWord,
}: {
  line: GeneratedLyricsLine;
  selectedWord: number;
  tapWord: number | null;
  onSelectWord: (word: number) => void;
}) {
  // One fill per part: the whole word, or each syllable of a split word,
  // exactly as the player will fill it.
  const partsRef = useRef(new Map<string, HTMLSpanElement>());
  useMediaFrame(time => {
    line.words.forEach((word, index) => {
      const parts = isSyllabicWord(word) ? word.syllables! : [word];
      parts.forEach((part, partIndex) => {
        const span = partsRef.current.get(`${index}:${partIndex}`);
        if (!span) return;
        const progress = Math.min(1, Math.max(0, (time - part.startMs) / Math.max(1, part.endMs - part.startMs)));
        span.style.setProperty('--fill', `${(progress * 100).toFixed(1)}%`);
      });
    });
  });

  // Mirrors the player: a line that is all backing is sung as the lead.
  const backing = line.words.map(isBackingWord);
  const allBacking = backing.every(Boolean);
  const renderWord = (index: number) => {
    const word = line.words[index];
    const parts = isSyllabicWord(word) ? word.syllables!.map(syllable => syllable.text) : [word.text];
    return (
      <button
        key={index}
        type="button"
        className={[
          'lte-preview-word',
          index === selectedWord ? 'selected' : '',
          index === tapWord ? 'tap' : '',
          parts.length > 1 ? 'syllabic' : '',
        ].join(' ')}
        onClick={() => onSelectWord(index)}
      >
        {parts.map((text, partIndex) => (
          <span
            key={partIndex}
            className="lte-preview-part"
            ref={element => {
              const key = `${index}:${partIndex}`;
              if (element) partsRef.current.set(key, element);
              else partsRef.current.delete(key);
            }}
          >
            {text}
          </span>
        ))}
      </button>
    );
  };
  const indices = line.words.map((_, index) => index);
  const leadIndices = allBacking ? indices : indices.filter(index => !backing[index]);
  const backingIndices = allBacking ? [] : indices.filter(index => backing[index]);

  return (
    <div className="lte-preview" aria-label="Vista previa de la línea">
      <div className="lte-preview-lead">{leadIndices.map(renderWord)}</div>
      {backingIndices.length ? (
        <div className="lte-preview-backing">{backingIndices.map(renderWord)}</div>
      ) : null}
    </div>
  );
}

/* ================================================================ timeline */

interface TimelineProps {
  lines: Lines;
  lineIndex: number;
  selectedWord: number;
  tapWord: number | null;
  envelope: VocalEnvelope | null;
  envelopeState: 'loading' | 'ready' | 'missing';
  playing: boolean;
  interactive: boolean;
  /** Every selected word of the line, the primary one included. */
  selection: number[];
  /** The syllable picked inside the primary word, if it is a fused word. */
  selectedSyllable: number | null;
  /** Whether the selection can be fused into one word; shows the button over it. */
  canFuse: boolean;
  onFuse: () => void;
  onSelectWord: (word: number, mode: SelectMode, syllable?: number | null) => void;
  onSelectMany: (words: number[], additive: boolean) => void;
  onSeek: (ms: number) => void;
  onBeginDrag: (group: number[]) => void;
  onDrag: (kind: DragKind, word: number, deltaMs: number, syllable?: number | null) => void;
  /** `drop` is the voice the words were dropped on, when it differs from theirs. */
  onEndDrag: (drop: boolean | null) => void;
  onRename: (word: number, text: string, syllables: boolean) => void;
  /** Adds a word; returns its index so it opens for typing. */
  onInsert: (timeMs: number, background: boolean) => number | null;
  /** Opens the rename field on a word the toolbar just added, or for its syllables. */
  renameRequest: RenameRequest | null;
  /** Language of the line, for the first guess at syllables. */
  language: string | null;
}

interface TimeWindow {
  startMs: number;
  endMs: number;
}

/* Track geometry, in px from the top; mirrored in lyrics-timing-editor.css. */
const LANES_TOP = 44;
const BACKING_LANE_TOP = 118;
const LEAD_WORD_BAND: [number, number] = [56, 104];
const BACKING_WORD_BAND: [number, number] = [124, 150];

interface DragState {
  kind: DragKind;
  word: number;
  /** The syllable being dragged inside a fused word, if any. */
  syllable: number | null;
  group: number[];
  startX: number;
  startY: number;
  moved: boolean;
  fromBacking: boolean;
  /** A plain click inside a multi-selection narrows it on release, not on press. */
  collapseOnClick: boolean;
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  additive: boolean;
  active: boolean;
}

function lineWindow(line: GeneratedLyricsLine): TimeWindow {
  return {
    startMs: Math.max(0, line.startMs - LINE_PADDING_MS),
    endMs: line.endMs + LINE_PADDING_MS,
  };
}

function envelopePath(envelope: VocalEnvelope, window: TimeWindow, width: number, height: number): string {
  const span = window.endMs - window.startMs;
  if (width <= 0 || span <= 0) return '';
  const step = 2;
  const top: string[] = [];
  const bottom: string[] = [];
  const middle = height / 2;
  for (let x = 0; x <= width; x += step) {
    const from = Math.floor((window.startMs + (x / width) * span) / envelope.binMs);
    const to = Math.max(from + 1, Math.floor((window.startMs + ((x + step) / width) * span) / envelope.binMs));
    let level = 0;
    for (let bin = from; bin < to && bin < envelope.levels.length; bin += 1) {
      if (bin >= 0) level = Math.max(level, envelope.levels[bin]);
    }
    const half = Math.max(0.5, level * middle * 0.94);
    top.push(`${x.toFixed(1)},${(middle - half).toFixed(1)}`);
    bottom.push(`${x.toFixed(1)},${(middle + half).toFixed(1)}`);
  }
  return `M${top.join('L')}L${bottom.reverse().join('L')}Z`;
}

const Timeline = memo(function Timeline({
  lines,
  lineIndex,
  selectedWord,
  selection,
  selectedSyllable,
  canFuse,
  onFuse,
  tapWord,
  envelope,
  envelopeState,
  playing,
  interactive,
  onSelectWord,
  onSelectMany,
  onSeek,
  onBeginDrag,
  onDrag,
  onEndDrag,
  onRename,
  onInsert,
  renameRequest,
  language,
}: TimelineProps) {
  const line = lines[lineIndex];
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [viewWidth, setViewWidth] = useState(0);
  // A drag re-times the line it is looking at; the view holds still until
  // the pointer is released, or the ground would move under the cursor.
  const [frozenWindow, setFrozenWindow] = useState<TimeWindow | null>(null);
  const [renaming, setRenaming] = useState<{ word: number; syllables: boolean } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  /** How far the dragged words hang below or above their lane, and where they would land. */
  const [dragLift, setDragLift] = useState<{ group: number[]; dy: number; drop: boolean | null } | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  const liveWindow = useMemo(() => lineWindow(line), [line]);
  const view = frozenWindow ?? liveWindow;
  const spanMs = view.endMs - view.startMs;
  const pxPerMs = Math.max(viewWidth / Math.max(1, spanMs), MIN_PX_PER_MS);
  const trackWidth = Math.max(viewWidth, Math.round(spanMs * pxPerMs));
  const toX = useCallback((ms: number) => (ms - view.startMs) * pxPerMs, [view.startMs, pxPerMs]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => setViewWidth(scroller.clientWidth));
    observer.observe(scroller);
    setViewWidth(scroller.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setRenaming(null);
    if (scrollerRef.current) scrollerRef.current.scrollLeft = 0;
  }, [lineIndex]);

  useEffect(() => {
    if (renameRequest) setRenaming({ word: renameRequest.word, syllables: renameRequest.syllables });
  }, [renameRequest]);

  // Keep the selected word in view on long lines.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const word = line.words[selectedWord];
    if (!scroller || !word || playing) return;
    const left = toX(word.startMs);
    const right = toX(word.endMs);
    if (left < scroller.scrollLeft || right > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = Math.max(0, left - scroller.clientWidth * 0.3);
    }
  }, [line, selectedWord, toX, playing]);

  useMediaFrame(time => {
    const playhead = playheadRef.current;
    const scroller = scrollerRef.current;
    if (!playhead || !scroller) return;
    const x = toX(time);
    const visible = x >= 0 && x <= trackWidth;
    playhead.style.opacity = visible ? '1' : '0';
    playhead.style.transform = `translateX(${x.toFixed(1)}px)`;
    if (visible && playing && !dragRef.current && trackWidth > scroller.clientWidth) {
      if (x < scroller.scrollLeft || x > scroller.scrollLeft + scroller.clientWidth * 0.85) {
        scroller.scrollLeft = Math.max(0, x - scroller.clientWidth * 0.2);
      }
    }
  });

  const wave = useMemo(
    () => (envelope ? envelopePath(envelope, view, trackWidth, 64) : ''),
    [envelope, view, trackWidth],
  );

  const ticks = useMemo(() => {
    const minor = pxPerMs * 100 >= 14 ? 100 : 250;
    const result: Array<{ ms: number; major: boolean }> = [];
    for (let ms = Math.ceil(view.startMs / minor) * minor; ms <= view.endMs; ms += minor) {
      result.push({ ms, major: ms % 1000 === 0 });
    }
    return result;
  }, [view.startMs, view.endMs, pxPerMs]);

  const context = useMemo(() => {
    const neighbours: Array<{ key: string; text: string; startMs: number; endMs: number }> = [];
    lines.forEach((entry, index) => {
      if (index === lineIndex || entry.endMs < view.startMs || entry.startMs > view.endMs) return;
      entry.words.forEach((word, wordIndex) => {
        if (word.endMs > view.startMs && word.startMs < view.endMs) {
          neighbours.push({ key: `${index}-${wordIndex}`, text: word.text, startMs: word.startMs, endMs: word.endMs });
        }
      });
    });
    return neighbours;
  }, [lines, lineIndex, view.startMs, view.endMs]);

  const trackPoint = (clientX: number, clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const timeAt = (clientX: number) => view.startMs + trackPoint(clientX, 0).x / pxPerMs;

  const handleWordPointerDown = (event: ReactPointerEvent<HTMLDivElement>, wordIndex: number) => {
    if (event.button !== 0 || !interactive || renaming != null) return;
    event.stopPropagation();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      onSelectWord(wordIndex, event.shiftKey ? 'extend' : 'toggle');
      return;
    }
    const target = event.target as HTMLElement;
    const kind = (target.dataset.handle as DragKind | undefined) ?? 'move';
    const syllableElement = target.closest<HTMLElement>('[data-syllable]');
    const inSelection = selectedSet.has(wordIndex) && selection.length > 1;
    // Inside a fused word a syllable is its own block, unless it is being
    // dragged along with other selected words.
    const syllable = syllableElement && !inSelection ? Number(syllableElement.dataset.syllable) : null;
    // Edges trim one word; a body drag carries the whole selection with it.
    const group = kind === 'move' && inSelection ? selection : [wordIndex];
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind,
      word: wordIndex,
      syllable,
      group,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      fromBacking: isBackingWord(line.words[wordIndex]),
      collapseOnClick: inSelection,
    };
    setFrozenWindow(view);
    if (!inSelection) onSelectWord(wordIndex, 'replace', syllable);
    onBeginDrag(group);
  };

  const handleWordPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved && Math.abs(dx) < 3 && Math.abs(dy) < 6) return;
    current.moved = true;
    onDrag(current.kind, current.word, dx / pxPerMs, current.syllable);
    // A syllable stays in its word; only whole words change voice.
    if (current.kind !== 'move' || current.syllable != null) return;
    const { y } = trackPoint(event.clientX, event.clientY);
    const overBacking = y >= BACKING_LANE_TOP - 2;
    setDragLift({
      group: current.group,
      dy: Math.abs(dy) > 8 ? dy : 0,
      drop: overBacking !== current.fromBacking ? overBacking : null,
    });
  };

  const handleWordPointerUp = () => {
    const current = dragRef.current;
    if (!current) return;
    dragRef.current = null;
    const drop = current.moved ? dragLift?.drop ?? null : null;
    setDragLift(null);
    setFrozenWindow(null);
    onEndDrag(drop);
    if (!current.moved) {
      if (current.collapseOnClick) onSelectWord(current.word, 'replace');
      // A plain click puts the playhead on the word (or syllable), ready for Space.
      const word = line.words[current.word];
      const part = current.syllable != null ? word?.syllables?.[current.syllable] : word;
      if (part && !playing) onSeek(part.startMs);
    }
  };

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const point = trackPoint(event.clientX, event.clientY);
    // The ruler scrubs; the lanes also draw a selection box.
    if (point.y < LANES_TOP || !interactive) {
      onSeek(timeAt(event.clientX));
      return;
    }
    setMarquee({
      x0: point.x,
      y0: point.y,
      x1: point.x,
      y1: point.y,
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
      active: false,
    });
  };

  const handleTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!marquee) return;
    const point = trackPoint(event.clientX, event.clientY);
    const active = marquee.active || Math.abs(point.x - marquee.x0) > 4 || Math.abs(point.y - marquee.y0) > 4;
    // Captured only once it is really a box: capturing on press would steal
    // the double click that adds a word from the lane underneath.
    if (active && !marquee.active) event.currentTarget.setPointerCapture(event.pointerId);
    setMarquee({ ...marquee, x1: point.x, y1: point.y, active });
  };

  const handleTrackPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!marquee) return;
    setMarquee(null);
    if (!marquee.active) {
      onSeek(timeAt(event.clientX));
      return;
    }
    const left = Math.min(marquee.x0, marquee.x1);
    const right = Math.max(marquee.x0, marquee.x1);
    const top = Math.min(marquee.y0, marquee.y1);
    const bottom = Math.max(marquee.y0, marquee.y1);
    const hit = line.words.flatMap((word, index) => {
      const [bandTop, bandBottom] = isBackingWord(word) ? BACKING_WORD_BAND : LEAD_WORD_BAND;
      const x0 = toX(word.startMs);
      const x1 = toX(word.endMs);
      return x1 >= left && x0 <= right && bandBottom >= top && bandTop <= bottom ? [index] : [];
    });
    if (hit.length) onSelectMany(hit, marquee.additive);
  };

  const handleLaneDoubleClick = (event: ReactMouseEvent<HTMLDivElement>, background: boolean) => {
    if (!interactive || event.target !== event.currentTarget) return;
    const index = onInsert(timeAt(event.clientX), background);
    if (index != null) setRenaming({ word: index, syllables: false });
  };

  const renderWord = (word: GeneratedLyricsLine['words'][number], index: number) => {
    const width = Math.max(6, (word.endMs - word.startMs) * pxPerMs);
    const lifted = dragLift?.group.includes(index) ? dragLift : null;
    const syllabic = isSyllabicWord(word);
    return (
      <div
        key={index}
        className={[
          'lte-word',
          index === selectedWord ? 'selected' : selectedSet.has(index) ? 'in-selection' : '',
          index === tapWord ? 'tap' : '',
          width < 34 ? 'narrow' : '',
          lifted ? 'lifted' : '',
          syllabic ? 'syllabic' : '',
        ].join(' ')}
        style={{
          left: toX(word.startMs),
          width,
          transform: lifted?.dy ? `translateY(${lifted.dy}px)` : undefined,
        }}
        title={`${word.text} · ${formatClock(word.startMs)} – ${formatClock(word.endMs)}`}
        onPointerDown={event => handleWordPointerDown(event, index)}
        onPointerMove={handleWordPointerMove}
        onPointerUp={handleWordPointerUp}
        onPointerCancel={handleWordPointerUp}
        onDoubleClick={event => {
          event.stopPropagation();
          // A split word opens with its hyphens, so the cuts can be moved.
          if (interactive) setRenaming({ word: index, syllables: syllabic });
        }}
      >
        {syllabic ? null : <span className="lte-handle start" data-handle="start" />}
        {renaming?.word === index ? (
          <RenameField
            value={renaming.syllables ? syllableEditText(word, language) : word.text}
            syllables={renaming.syllables}
            onDone={text => {
              const mode = renaming.syllables;
              setRenaming(null);
              if (text != null) onRename(index, text, mode);
            }}
          />
        ) : syllabic ? (
          <>
            <span className="lte-fused-head" title="Arrastra para mover la palabra entera">{word.text}</span>
            {word.syllables!.map((syllable, syllableIndex) => (
              <span
                key={syllableIndex}
                data-syllable={syllableIndex}
                className={[
                  'lte-syllable-block',
                  index === selectedWord && selectedSyllable === syllableIndex ? 'selected' : '',
                ].join(' ')}
                style={{
                  left: (syllable.startMs - word.startMs) * pxPerMs,
                  width: Math.max(4, (syllable.endMs - syllable.startMs) * pxPerMs),
                }}
                title={`${syllable.text} · ${formatClock(syllable.startMs)} – ${formatClock(syllable.endMs)}`}
              >
                <span className="lte-handle start" data-handle="start" />
                <span className="lte-syllable-text">{syllable.text}</span>
                <span className="lte-handle end" data-handle="end" />
              </span>
            ))}
          </>
        ) : (
          <span className="lte-word-text">{word.text}</span>
        )}
        {syllabic ? null : <span className="lte-handle end" data-handle="end" />}
      </div>
    );
  };

  return (
    <div className="lte-timeline">
      <div className="lte-timeline-scroller" ref={scrollerRef}>
        <div
          className="lte-track"
          ref={trackRef}
          style={{ width: trackWidth }}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerUp}
          onPointerCancel={() => setMarquee(null)}
        >
          <div className="lte-ruler" aria-hidden="true">
            {ticks.map(tick => (
              <span key={tick.ms} className={tick.major ? 'major' : ''} style={{ left: toX(tick.ms) }}>
                {tick.major ? formatClock(tick.ms).slice(0, -3) : null}
              </span>
            ))}
          </div>

          <div className="lte-context" aria-hidden="true">
            {context.map(word => (
              <span key={word.key} style={{ left: toX(word.startMs), width: Math.max(2, (word.endMs - word.startMs) * pxPerMs) }}>
                {word.text}
              </span>
            ))}
          </div>

          <div
            className={`lte-lane ${dragLift?.drop === false ? 'drop-target' : ''}`}
            onDoubleClick={event => handleLaneDoubleClick(event, false)}
          >
            <svg className="lte-wave" width={trackWidth} height={64} viewBox={`0 0 ${trackWidth} 64`} preserveAspectRatio="none" aria-hidden="true">
              {wave ? <path d={wave} /> : null}
            </svg>
            {line.words.map((word, index) => (isBackingWord(word) ? null : renderWord(word, index)))}
          </div>

          <div
            className={`lte-lane lte-lane-backing ${dragLift?.drop === true ? 'drop-target' : ''}`}
            onDoubleClick={event => handleLaneDoubleClick(event, true)}
            title="Coro: doble clic para añadir una voz de fondo, o arrastra palabras aquí"
          >
            <span className="lte-lane-label" aria-hidden="true">
              {dragLift?.drop === true ? 'Soltar para pasar al coro' : 'Coro'}
            </span>
            {line.words.map((word, index) => (isBackingWord(word) ? renderWord(word, index) : null))}
          </div>

          {canFuse && !dragLift && !marquee ? (() => {
            const chosen = selection.map(index => line.words[index]).filter(Boolean);
            const left = toX(Math.min(...chosen.map(word => word.startMs)));
            const right = toX(Math.max(...chosen.map(word => word.endMs)));
            const backing = chosen.every(isBackingWord);
            return (
              <button
                type="button"
                className={`lte-fuse ${backing ? 'backing' : ''}`}
                style={{ left: (left + right) / 2 }}
                onPointerDown={event => event.stopPropagation()}
                onClick={onFuse}
                title="Las palabras seleccionadas pasan a ser las sílabas de una sola · J"
              >
                Fusionar en palabra
              </button>
            );
          })() : null}

          {marquee?.active ? (
            <div
              className="lte-marquee"
              aria-hidden="true"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
              }}
            />
          ) : null}

          <div className="lte-playhead" ref={playheadRef} aria-hidden="true" />
        </div>
      </div>
      {dragLift?.drop === false ? (
        <span className="lte-drop-hint" aria-hidden="true">Soltar para pasar a voz principal</span>
      ) : null}
      <span className="lte-wave-source">
        {envelopeState === 'loading'
          ? 'Analizando audio…'
          : envelope?.source === 'vocals'
            ? 'Voz aislada'
            : envelope
              ? 'Mezcla completa'
              : 'Sin forma de onda'}
      </span>
    </div>
  );
});

function RenameField({
  value,
  syllables = false,
  onDone,
}: {
  value: string;
  syllables?: boolean;
  onDone: (text: string | null) => void;
}) {
  const [text, setText] = useState(value);
  const doneRef = useRef(false);
  const finish = (result: string | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(result);
  };
  const input = (
    <input
      className={`lte-rename ${syllables ? 'syllables' : ''}`}
      value={text}
      autoFocus
      onFocus={event => event.currentTarget.select()}
      onPointerDown={event => event.stopPropagation()}
      onChange={event => setText(event.target.value)}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(text);
        if (event.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(text)}
      aria-label={syllables ? 'Sílabas separadas con guiones' : 'Corregir palabra'}
    />
  );
  if (!syllables) return input;
  return (
    <>
      {input}
      <span className="lte-rename-hint">Separa las sílabas con guiones: co-ra-zón · Intro para aplicar</span>
    </>
  );
}

const SHORTCUT_GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Reproducir',
    items: [
      ['Espacio', 'Reproducir o pausar'],
      ['Intro', 'Escuchar la palabra'],
      ['L', 'Repetir la línea'],
      ['T', 'Marcar al ritmo'],
    ],
  },
  {
    title: 'Moverse',
    items: [
      ['← →', 'Palabra anterior o siguiente'],
      ['↑ ↓', 'Línea anterior o siguiente'],
      ['⇧ ← →', 'Añadir a la selección'],
      ['⌘A', 'Seleccionar la línea'],
    ],
  },
  {
    title: 'Editar',
    items: [
      ['⌥ ← →', 'Mover 20 ms (⇧ 100 ms)'],
      ['C', 'Coro ↔ voz principal'],
      ['A', 'Añadir palabra'],
      ['S', 'Dividir en sílabas'],
      ['J', 'Fusionar en palabra'],
      ['N', 'Añadir línea'],
      ['⌫', 'Borrar'],
    ],
  },
  {
    title: 'Deshacer y portapapeles',
    items: [
      ['⌘Z', 'Deshacer'],
      ['⇧⌘Z · ⌘Y', 'Rehacer'],
      ['⌘C ⌘X ⌘V', 'Copiar, cortar y pegar'],
      ['⌘S', 'Guardar'],
    ],
  },
];

function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="lte-shortcuts" role="dialog" aria-label="Atajos de teclado">
      {SHORTCUT_GROUPS.map(group => (
        <section key={group.title}>
          <h3>{group.title}</h3>
          <dl>
            {group.items.map(([keys, action]) => (
              <div key={keys}>
                <dt><kbd>{keys}</kbd></dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <button type="button" className="lte-chip lte-shortcuts-close" onClick={onClose}>Cerrar</button>
    </div>
  );
}

function TimeStepper({ label, valueMs, onStep }: { label: string; valueMs: number; onStep: (deltaMs: number) => void }) {
  return (
    <div className="lte-stepper">
      <span>{label}</span>
      <div>
        <button
          type="button"
          onClick={event => onStep(event.shiftKey ? -NUDGE_LARGE_MS : -NUDGE_MS)}
          aria-label={`${label} antes`}
          title="Antes · ⇧ para 0.1 s"
        >
          −
        </button>
        <output>{formatClock(valueMs)}</output>
        <button
          type="button"
          onClick={event => onStep(event.shiftKey ? NUDGE_LARGE_MS : NUDGE_MS)}
          aria-label={`${label} después`}
          title="Después · ⇧ para 0.1 s"
        >
          +
        </button>
      </div>
    </div>
  );
}
