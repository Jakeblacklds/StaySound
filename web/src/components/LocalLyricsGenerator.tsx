import type { Track } from '@staysound/types/audio';
import { useCallback, useMemo, useState } from 'react';
import {
  getKaraokeCapabilities,
  getKaraokeTrackPath,
  installDemucsRuntime,
  installLocalLyricsRuntime,
  listenToKaraokeProgress,
  persistLocalGeneratedLyrics,
  prepareKaraokeStems,
  saveLocalGeneratedLyrics,
  transcribeKaraokeVocals,
  type GeneratedLyrics,
  type GeneratedLyricsLine,
  type LocalLyricsLanguage,
} from '../karaoke/karaokeDesktop';
import { lyricsSourcesStore } from '../library/lyricsSources';
import { CloseIcon, SpinnerIcon } from './icons';

type GeneratorPhase = 'setup' | 'processing' | 'review' | 'saving' | 'error';
type EditorMode = 'lyrics' | 'json';

interface LocalLyricsGeneratorProps {
  track: Track;
  onClose: () => void;
}

const LANGUAGE_OPTIONS: Array<{
  id: LocalLyricsLanguage;
  label: string;
}> = [
  { id: 'auto', label: 'Automático' },
  { id: 'en-es', label: 'Multiidioma' },
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'Inglés' },
];

export interface RetimedLyrics {
  lines: GeneratedLyricsLine[];
  match: number;
}

function normalizeWord(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9ñ']/g, '');
}

const SPANISH_LANGUAGE_WORDS = new Set([
  'algo', 'alguien', 'anos', 'aqui', 'asi', 'aunque', 'cada', 'como', 'cuando',
  'de', 'del', 'el', 'ella', 'en', 'eres', 'esta', 'este', 'esto', 'habia',
  'hasta', 'la', 'las', 'le', 'lejos', 'lo', 'los', 'mano', 'mas', 'me', 'mi',
  'miedo', 'nadie', 'no', 'nos', 'otra', 'para', 'pero', 'por', 'porque', 'que',
  'quiero', 'si', 'siempre', 'sin', 'te', 'tengo', 'todo', 'tu', 'una', 'vez',
  'volver', 'ya', 'yo',
]);

const ENGLISH_LANGUAGE_WORDS = new Set([
  'a', 'again', 'all', 'and', 'are', 'away', 'be', 'because', 'but', 'can',
  'close', 'day', 'did', 'do', 'eyes', 'feel', 'for', 'found', 'from', 'had',
  'her', 'here', 'hold', 'i', "i'm", 'if', 'in', 'inside', 'is', 'it', 'just',
  'know', 'left', 'love', 'me', 'my', 'no', 'not', 'of', 'on', 'one', 'that',
  'the', 'there', 'this', 'till', 'to', 'trust', 'was', 'when', 'with', 'without',
  'you', 'your',
]);

function detectLyricsLineLanguage(value: string): 'en' | 'es' | null {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
  const tokens = normalized.match(/[a-zñ']+/g) ?? [];
  if (!tokens.length) return null;
  let spanish = /[áéíóúüñ¿¡]/i.test(value) ? 2 : 0;
  let english = 0;
  for (const token of tokens) {
    if (SPANISH_LANGUAGE_WORDS.has(token)) spanish += 1;
    if (ENGLISH_LANGUAGE_WORDS.has(token)) english += 1;
  }
  if (spanish >= english + 1) return 'es';
  if (english >= spanish + 1) return 'en';
  return null;
}

function detectLyricsRowsLanguages(rows: string[]): Array<'en' | 'es' | null> {
  const detected = rows.map(detectLyricsLineLanguage);
  return detected.map((language, index) => {
    if (language) return language;
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      if (detected[previous]) return detected[previous];
    }
    for (let following = index + 1; following < detected.length; following += 1) {
      if (detected[following]) return detected[following];
    }
    return null;
  });
}

function editDistance(left: string, right: string): number {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const previous = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return row[right.length];
}

function wordSimilarity(left: string, right: string): number {
  const a = normalizeWord(left);
  const b = normalizeWord(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

function alignTokens(canonical: string[], heard: string[]): Array<number | null> {
  const rows = canonical.length + 1;
  const columns = heard.length + 1;
  const scores = new Float64Array(rows * columns);
  const trace = new Uint8Array(rows * columns);
  const at = (row: number, column: number) => row * columns + column;
  for (let row = 1; row < rows; row += 1) scores[at(row, 0)] = -1.1 * row;
  for (let column = 1; column < columns; column += 1) scores[at(0, column)] = -0.8 * column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const similarity = wordSimilarity(canonical[row - 1], heard[column - 1]);
      const tokenScore = similarity === 1 ? 3 : similarity >= 0.8 ? 1.7 : similarity >= 0.58 ? 0.35 : -1.55;
      const diagonal = scores[at(row - 1, column - 1)] + tokenScore;
      const skipCanonical = scores[at(row - 1, column)] - 1.1;
      const skipHeard = scores[at(row, column - 1)] - 0.8;
      if (diagonal >= skipCanonical && diagonal >= skipHeard) {
        scores[at(row, column)] = diagonal;
        trace[at(row, column)] = 1;
      } else if (skipCanonical >= skipHeard) {
        scores[at(row, column)] = skipCanonical;
        trace[at(row, column)] = 2;
      } else {
        scores[at(row, column)] = skipHeard;
        trace[at(row, column)] = 3;
      }
    }
  }

  const matches: Array<number | null> = Array(canonical.length).fill(null);
  let row = canonical.length;
  let column = heard.length;
  while (row > 0 || column > 0) {
    const direction = trace[at(row, column)];
    if (row > 0 && column > 0 && direction === 1) {
      if (wordSimilarity(canonical[row - 1], heard[column - 1]) >= 0.58) {
        matches[row - 1] = column - 1;
      }
      row -= 1;
      column -= 1;
    } else if (row > 0 && (direction === 2 || column === 0)) {
      row -= 1;
    } else {
      column -= 1;
    }
  }
  return matches;
}

export function buildEditedLyricsLines(lines: GeneratedLyricsLine[], text: string): RetimedLyrics {
  const editedRows = text
    .split(/\r?\n/)
    .map(row => row.trim())
    .filter(Boolean);
  if (!editedRows.length || !lines.length) return { lines: [], match: 0 };

  const heardWords = lines.flatMap(line => line.words);
  const heardWordLines = lines.flatMap((line, lineIndex) => line.words.map(() => lineIndex));
  const canonical = editedRows.flatMap((row, lineIndex) => row.split(/\s+/).filter(Boolean).map(word => ({ word, lineIndex })));
  if (!heardWords.length || !canonical.length) return { lines: [], match: 0 };
  const matches = alignTokens(canonical.map(token => token.word), heardWords.map(word => word.text));
  const similarities = matches.map((heardIndex, index) => (
    heardIndex == null ? 0 : wordSimilarity(canonical[index].word, heardWords[heardIndex].text)
  ));
  const match = similarities.reduce((sum, value) => sum + value, 0) / canonical.length;

  const timedWords = canonical.map((token, index) => {
    const heardIndex = matches[index];
    if (heardIndex != null) {
      const heard = heardWords[heardIndex];
      return { ...heard, text: token.word, syllables: [] };
    }
    let previous = index - 1;
    while (previous >= 0 && matches[previous] == null) previous -= 1;
    let following = index + 1;
    while (following < matches.length && matches[following] == null) following += 1;
    const previousIsSameLine = previous >= 0 && canonical[previous].lineIndex === token.lineIndex;
    const followingIsSameLine = following < canonical.length
      && canonical[following].lineIndex === token.lineIndex;
    let previousEnd = previous >= 0 && matches[previous] != null
      ? heardWords[matches[previous]!].endMs
      : Math.max(0, (following < matches.length && matches[following] != null
        ? heardWords[matches[following]!].startMs
        : lines[0].startMs) - (following - index) * 260);
    let followingStart = following < matches.length && matches[following] != null
      ? heardWords[matches[following]!].startMs
      : previousEnd + (following - previous) * 260;
    let interpolationStart = previous;
    let interpolationEnd = following;

    // If the missing words are at the beginning/end of a provider phrase,
    // constrain them to the Whisper phrase containing the nearest match.
    // Otherwise a mismatch such as "Y entonces" vs "Si es" can absorb the
    // whole instrumental gap before the line and MFA will align into silence.
    if (!previousIsSameLine && followingIsSameLine && matches[following] != null) {
      const canonicalLineStart = canonical.findIndex(entry => entry.lineIndex === token.lineIndex);
      const heardLine = lines[heardWordLines[matches[following]!]];
      const missingCount = following - canonicalLineStart;
      previousEnd = Math.min(
        heardLine.startMs,
        followingStart - Math.max(100, missingCount * 100),
      );
      interpolationStart = canonicalLineStart - 1;
    } else if (previousIsSameLine && !followingIsSameLine && matches[previous] != null) {
      let canonicalLineEnd = index;
      while (canonicalLineEnd < canonical.length && canonical[canonicalLineEnd].lineIndex === token.lineIndex) {
        canonicalLineEnd += 1;
      }
      const heardLine = lines[heardWordLines[matches[previous]!]];
      const missingCount = canonicalLineEnd - previous - 1;
      followingStart = Math.max(
        heardLine.endMs,
        previousEnd + Math.max(100, missingCount * 100),
      );
      interpolationEnd = canonicalLineEnd;
    }
    const position = index - interpolationStart;
    const slots = interpolationEnd - interpolationStart;
    const startMs = Math.round(previousEnd + (followingStart - previousEnd) * (position - 1) / slots);
    const endMs = Math.round(previousEnd + (followingStart - previousEnd) * position / slots);
    return {
      text: token.word,
      startMs: Math.max(0, startMs),
      endMs: Math.max(startMs + 60, endMs),
      confidence: 0,
      syllables: [],
    };
  });

  for (let index = 0; index < timedWords.length - 1; index += 1) {
    const current = timedWords[index];
    const next = timedWords[index + 1];
    if (current.endMs <= next.startMs) continue;
    const boundary = Math.round((current.endMs + next.startMs) / 2);
    current.endMs = Math.max(current.startMs + 40, boundary);
    next.startMs = Math.min(next.endMs - 40, boundary);
  }

  const rowLanguages = detectLyricsRowsLanguages(editedRows);
  const rebuilt = editedRows.map((row, lineIndex) => {
    const words = timedWords.filter((_, wordIndex) => canonical[wordIndex].lineIndex === lineIndex);
    return {
      text: row,
      startMs: words[0].startMs,
      endMs: words.at(-1)?.endMs ?? words[0].endMs,
      language: rowLanguages[lineIndex],
      words,
    };
  });
  return { lines: rebuilt, match };
}

export function applyProviderPhraseWindows(
  lines: GeneratedLyricsLine[],
  phrases: Array<{ startMs?: number; endMs?: number }>,
): GeneratedLyricsLine[] {
  return lines.map((line, lineIndex) => {
    const phrase = phrases[lineIndex];
    const startMs = phrase?.startMs ?? 0;
    const endMs = phrase?.endMs ?? 0;
    if (startMs <= 0 || endMs <= startMs || !line.words.length) return line;
    // LRC timestamps are human-authored line cues and can trail the actual
    // vocal onset. Treat them as guard rails; a confident Whisper word may
    // correct the edge without being clipped to the provider timestamp.
    const acousticStart = Math.max(0, startMs - 1_800);
    const acousticEnd = endMs + 900;
    const weights = line.words.map(word => Math.max(1, normalizeWord(word.text).length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const hasConfidentLineTiming = line.words.some(word => (
      word.confidence > 0.15
      && word.endMs > acousticStart
      && word.startMs < acousticEnd
    ));
    let cursor = startMs;
    const words = line.words.map((word, wordIndex) => {
      const fallbackStart = cursor;
      const fallbackEnd = wordIndex === line.words.length - 1
        ? endMs
        : Math.round(cursor + (endMs - startMs) * weights[wordIndex] / total);
      const overlapsWindow = word.endMs > acousticStart && word.startMs < acousticEnd;
      const anchoredStart = Math.max(acousticStart, word.startMs);
      const anchoredEnd = Math.min(acousticEnd, word.endMs);
      const keepWhisperTiming = (word.confidence > 0.15 || hasConfidentLineTiming)
        && overlapsWindow
        && anchoredEnd - anchoredStart >= 40;
      const timed = {
        ...word,
        startMs: keepWhisperTiming ? anchoredStart : fallbackStart,
        endMs: keepWhisperTiming ? anchoredEnd : Math.max(fallbackStart + 40, fallbackEnd),
        syllables: [],
      };
      cursor = fallbackEnd;
      return timed;
    });
    // Overlapping multilingual chunks can offer the right words in a slightly
    // different order. If the global token match creates a temporal inversion,
    // keep the canonical word order and redistribute only this phrase; MFA will
    // recover the acoustic boundaries from its exact transcript afterward.
    if (words.some((word, index) => index > 0 && word.startMs < words[index - 1].startMs)) {
      const phraseStart = Math.min(...words.map(word => word.startMs));
      const phraseEnd = Math.max(...words.map(word => word.endMs));
      const phraseDuration = Math.max(words.length * 40, phraseEnd - phraseStart);
      let phraseCursor = phraseStart;
      words.forEach((word, wordIndex) => {
        const wordEnd = wordIndex === words.length - 1
          ? phraseStart + phraseDuration
          : Math.round(phraseCursor + phraseDuration * weights[wordIndex] / total);
        word.startMs = phraseCursor;
        word.endMs = Math.max(phraseCursor + 40, wordEnd);
        phraseCursor = word.endMs;
      });
    }
    for (let wordIndex = 1; wordIndex < words.length; wordIndex += 1) {
      const previous = words[wordIndex - 1];
      const current = words[wordIndex];
      if (previous.endMs <= current.startMs) continue;
      const safeLow = previous.startMs + 40;
      const safeHigh = current.endMs - 40;
      if (safeLow <= safeHigh) {
        const preferred = Math.round((previous.endMs + current.startMs) / 2);
        const boundary = Math.max(safeLow, Math.min(safeHigh, preferred));
        previous.endMs = boundary;
        current.startMs = boundary;
      }
    }
    return {
      ...line,
      startMs: Math.min(startMs, ...words.map(word => word.startMs)),
      endMs: Math.max(endMs, ...words.map(word => word.endMs)),
      words,
    };
  });
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'No pude generar la letra de esta canción.';
}

function formatLyricsJson(lyrics: GeneratedLyrics): string {
  return JSON.stringify(lyrics, null, 2);
}

export function LocalLyricsGenerator({ track, onClose }: LocalLyricsGeneratorProps) {
  const [phase, setPhase] = useState<GeneratorPhase>('setup');
  const [language, setLanguage] = useState<LocalLyricsLanguage>('auto');
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<GeneratedLyrics | null>(null);
  const [editedText, setEditedText] = useState('');
  const [editedJson, setEditedJson] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('lyrics');
  const [savedAligned, setSavedAligned] = useState(false);
  const [jsonDirty, setJsonDirty] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const nativePath = useMemo(() => getKaraokeTrackPath(track), [track]);
  const sustainedCount = useMemo(() => draft?.lines.reduce(
    (total, line) => total + line.words.reduce(
      (wordTotal, word) => wordTotal + (word.syllables ?? []).filter(syllable => syllable.sustained).length,
      0,
    ),
    0,
  ) ?? 0, [draft]);

  const startGeneration = useCallback(async () => {
    if (!nativePath || phase === 'processing') return;
    setPhase('processing');
    setError('');
    setProgress(0.02);
    setDetail('Preparando…');
    setSavedNotice('');
    const canonicalLyrics = lyricsSourcesStore.getCanonicalLyrics().catch(() => null);

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listenToKaraokeProgress(event => {
        const stageBase = event.stage === 'separation'
          ? 0.28
          : event.stage === 'transcription'
            ? 0.58
            : event.stage === 'transcription-runtime'
              ? 0.16
              : 0.02;
        const stageSpan = event.stage === 'separation'
          ? 0.28
          : event.stage === 'transcription'
            ? 0.4
            : 0.14;
        setProgress(Math.min(0.98, stageBase + event.progress * stageSpan));
        setDetail(event.detail);
      });

      let capabilities = await getKaraokeCapabilities();
      if (!capabilities.demucsReady) {
        setDetail('Preparando audio…');
        capabilities = await installDemucsRuntime();
      }
      if (!capabilities.transcriptionReady || !capabilities.alignmentReady) {
        setDetail('Preparando sincronización…');
        capabilities = await installLocalLyricsRuntime();
      }
      if (!capabilities.demucsReady || !capabilities.transcriptionReady || !capabilities.alignmentReady) {
        throw new Error('Los motores locales no quedaron disponibles.');
      }

      setProgress(0.3);
      setDetail('Aislando la voz…');
      await prepareKaraokeStems(nativePath);

      setProgress(0.58);
      setDetail('Transcribiendo…');
      const canonical = await canonicalLyrics;
      const languageHints = language === 'en-es'
        ? canonical?.phrases.map(phrase => ({
            text: phrase.text,
            startMs: phrase.startMs,
            endMs: phrase.endMs,
          })) ?? []
        : [];
      const result = await transcribeKaraokeVocals(nativePath, language, languageHints);
      let prepared = result;
      if (canonical) {
        const canonicalText = canonical.phrases.map(phrase => phrase.text).join('\n');
        const retimed = buildEditedLyricsLines(result.lines, canonicalText);
        if (retimed.match >= 0.38) {
          const providerTimedLines = canonical.syncKind === 'plain'
            ? retimed.lines
            : applyProviderPhraseWindows(retimed.lines, canonical.phrases);
          prepared = {
            ...result,
            textSource: canonical.source,
            textMatch: retimed.match,
            lines: providerTimedLines,
          };
        }
      }
      setDraft(prepared);
      setEditedText(prepared.lines.map(line => line.text).join('\n'));
      setEditedJson(formatLyricsJson(prepared));
      setEditorMode('lyrics');
      setSavedAligned(false);
      setJsonDirty(false);
      setProgress(1);
      setPhase('review');
    } catch (generationError) {
      setError(errorMessage(generationError));
      setPhase('error');
    } finally {
      unlisten?.();
    }
  }, [language, nativePath, phase]);

  const saveDraft = useCallback(async () => {
    if (!draft || !nativePath) return;
    let edited: GeneratedLyrics;
    try {
      if (editorMode === 'json') {
        edited = JSON.parse(editedJson) as GeneratedLyrics;
        if (!Array.isArray(edited.lines)) throw new Error('El JSON no contiene lines.');
      } else {
        const retimed = buildEditedLyricsLines(draft.lines, editedText);
        if (!retimed.lines.length) throw new Error('La letra no puede quedar vacía.');
        const unchanged = editedText.trim() === draft.lines.map(line => line.text).join('\n').trim();
        edited = {
          ...draft,
          textMatch: unchanged ? draft.textMatch : retimed.match,
          alignment: null,
          lines: retimed.lines,
        };
      }
    } catch (parseError) {
      setError(errorMessage(parseError));
      return;
    }
    setPhase('saving');
    setProgress(0.02);
    const saveExactJson = editorMode === 'json' && savedAligned;
    setDetail(saveExactJson ? 'Guardando…' : 'Sincronizando…');
    let unlisten: (() => void) | undefined;
    try {
      if (!saveExactJson) {
        unlisten = await listenToKaraokeProgress(event => {
          if (event.stage !== 'alignment') return;
          setProgress(event.progress);
          setDetail(event.detail);
        });
      }
      const aligned = saveExactJson
        ? await persistLocalGeneratedLyrics(nativePath, edited)
        : await saveLocalGeneratedLyrics(nativePath, edited);
      lyricsSourcesStore.saveGenerated(aligned);
      setDraft(aligned);
      setEditedText(aligned.lines.map(line => line.text).join('\n'));
      setEditedJson(formatLyricsJson(aligned));
      setEditorMode('json');
      setSavedAligned(true);
      setJsonDirty(false);
      setSavedNotice(saveExactJson
        ? 'Guardado.'
        : aligned.alignment === 'word-timing-fallback'
          ? 'Guardado con tiempos de palabras.'
          : 'Sincronización lista.');
      setError('');
      setProgress(1);
      setPhase('review');
    } catch (saveError) {
      setError(errorMessage(saveError));
      setPhase('review');
    } finally {
      unlisten?.();
    }
  }, [draft, editedJson, editedText, editorMode, nativePath, savedAligned]);

  const selectEditorMode = useCallback((mode: EditorMode) => {
    if (!draft || mode === editorMode) return;
    setError('');
    setSavedNotice('');
    if (mode === 'json') {
      const retimed = savedAligned ? null : buildEditedLyricsLines(draft.lines, editedText);
      const unchanged = editedText.trim() === draft.lines.map(line => line.text).join('\n').trim();
      const preview = retimed?.lines.length
        ? {
          ...draft,
          textMatch: unchanged ? draft.textMatch : retimed.match,
          alignment: null,
          lines: retimed.lines,
        }
        : draft;
      setEditedJson(formatLyricsJson(preview));
      setJsonDirty(false);
    } else if (jsonDirty) {
      try {
        const parsed = JSON.parse(editedJson) as GeneratedLyrics;
        if (!Array.isArray(parsed.lines)) throw new Error('El JSON no contiene lines.');
        setDraft(parsed);
        setEditedText(parsed.lines.map(line => line.text).join('\n'));
        setJsonDirty(false);
      } catch (parseError) {
        setError(errorMessage(parseError));
        return;
      }
    }
    setEditorMode(mode);
  }, [draft, editedJson, editedText, editorMode, jsonDirty, savedAligned]);

  const modalTitle = phase === 'review'
    ? 'Letra'
    : phase === 'saving'
      ? 'Sincronizando'
      : phase === 'processing'
        ? 'Analizando'
        : 'Crear letra';
  const editorPhase = phase === 'review';

  return (
    <div
      className="local-lyrics-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
      onClick={() => {
        if (phase !== 'processing' && phase !== 'saving') onClose();
      }}
    >
      <div
        className={`local-lyrics-modal ${editorPhase ? 'editor' : 'compact'}`}
        onClick={event => event.stopPropagation()}
      >
        <header className="local-lyrics-titlebar">
          <div>
            <h2>{modalTitle}</h2>
            <p>{track.title}<span aria-hidden="true">·</span>{track.artist}</p>
          </div>
        <button
          type="button"
          className="local-lyrics-close"
          onClick={onClose}
          disabled={phase === 'processing' || phase === 'saving'}
          aria-label="Cerrar"
        >
          <CloseIcon size={18} />
        </button>
        </header>

        {phase === 'setup' || phase === 'error' ? (
          <div className="local-lyrics-setup">
            <div className="local-lyrics-field">
              <span className="local-lyrics-field-label">Idioma</span>
              <div className="local-lyrics-language" role="radiogroup" aria-label="Idioma de la canción">
                {LANGUAGE_OPTIONS.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={language === option.id}
                    className={language === option.id ? 'active' : ''}
                    onClick={() => setLanguage(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {error ? <p className="local-lyrics-error">{error}</p> : null}
            {!nativePath ? (
              <p className="local-lyrics-error">Esta función requiere una canción de tu biblioteca local.</p>
            ) : null}
            <div className="local-lyrics-actions">
              <button
                type="button"
                className="local-lyrics-primary"
                disabled={!nativePath}
                onClick={() => void startGeneration()}
              >
                {phase === 'error' ? 'Reintentar' : 'Crear'}
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'processing' || phase === 'saving' ? (
          <div className="local-lyrics-processing">
            <div className="local-lyrics-status">
              <SpinnerIcon size={16} />
              <span>{detail}</span>
              <output>{Math.round(progress * 100)}%</output>
            </div>
            <div className="local-lyrics-progress" aria-label="Progreso">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        ) : null}

        {phase === 'review' && draft ? (
          <div className="local-lyrics-review">
            <div className="local-lyrics-toolbar">
              <div className="local-lyrics-editor-meta" aria-label="Información de la letra">
                <span>{editedText.split(/\r?\n/).filter(line => line.trim()).length} líneas</span>
                <span>{draft.textSource ?? 'Transcripción'}</span>
                {draft.textMatch != null ? <span>{Math.round(draft.textMatch * 100)}%</span> : null}
                {savedAligned && sustainedCount > 0 ? <span>{sustainedCount} sostenidas</span> : null}
              </div>
              <div className="local-lyrics-editor-tabs" role="tablist" aria-label="Vista del editor">
                <button type="button" role="tab" aria-selected={editorMode === 'lyrics'} className={editorMode === 'lyrics' ? 'active' : ''} onClick={() => selectEditorMode('lyrics')}>Texto</button>
                <button type="button" role="tab" aria-selected={editorMode === 'json'} className={editorMode === 'json' ? 'active' : ''} onClick={() => selectEditorMode('json')}>Tiempos</button>
              </div>
            </div>
            {editorMode === 'lyrics' ? (
              <label className="local-lyrics-editor">
                <span>Letra completa</span>
                <textarea
                  value={editedText}
                  onChange={event => {
                    setEditedText(event.target.value);
                    setSavedAligned(false);
                    setSavedNotice('');
                  }}
                  spellCheck
                  autoFocus
                />
              </label>
            ) : (
              <label className="local-lyrics-editor local-lyrics-json-editor">
                <span>JSON de tiempos</span>
                <textarea
                  value={editedJson}
                  onChange={event => {
                    setEditedJson(event.target.value);
                    setJsonDirty(true);
                    setSavedNotice('');
                  }}
                  spellCheck={false}
                />
              </label>
            )}
            {savedNotice ? <p className="local-lyrics-saved">{savedNotice}</p> : null}
            {error ? <p className="local-lyrics-error">{error}</p> : null}
            <div className="local-lyrics-actions local-lyrics-review-actions">
              <button
                type="button"
                className="local-lyrics-primary"
                onClick={() => {
                  if (savedAligned && !jsonDirty) onClose();
                  else void saveDraft();
                }}
              >
                {savedAligned && !jsonDirty ? 'Listo' : editorMode === 'json' && savedAligned ? 'Guardar' : 'Sincronizar'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
