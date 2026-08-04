import type { Track } from '@staysound/types/audio';
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDynamicPalette, paletteToCssVars, type WebDynamicPalette } from '../library/dynamicColors';
import {
  classifyKaraokeGenre,
  getKaraokeCapabilities,
  getKaraokeTrackPath,
  installDemucsRuntime,
  listenToKaraokeProgress,
  prepareKaraokeStems,
  saveGeminiApiKey,
  type KaraokeGenre,
  type KaraokeGenreResult,
  type KaraokeProgress,
} from '../karaoke/karaokeDesktop';
import {
  fetchKaraokeLyrics,
  getStoredLyricsTimingOffset,
  setStoredLyricsTimingOffset,
  type KaraokeLine,
  type KaraokeStanza,
} from '../karaoke/karaokeLyrics';
import { KaraokeMixer, type KaraokePlaybackMode } from '../karaoke/KaraokeMixer';
import { webAudioEngine } from '../audio/webAudioEngine';
import {
  resolveKaraokeStageEffect,
  type KaraokeStageMoment,
} from '../karaoke/karaokeStageDirection';
import { KaraokeCanvasUiStage } from './KaraokeCanvasUiStage';
import {
  CloseIcon,
  MicrophoneIcon,
  PauseIcon,
  PlayIcon,
  SeekBackIcon,
  SeekForwardIcon,
  SpinnerIcon,
} from './icons';

type KaraokePhase = 'checking' | 'gemini-setup' | 'preparing' | 'ready' | 'error';

interface KaraokeExperienceProps {
  track: Track;
  initialPosition: number;
  duration: number;
  volume: number;
  wasPlaying: boolean;
  onPauseMain: () => void;
  onExit: (position: number, resumePlayback: boolean) => void;
}

const GENRE_LABELS: Record<KaraokeGenre, string> = {
  pop: 'Pop',
  rock: 'Rock',
  reggaeton: 'Reggaetón',
  folk: 'Folk',
  disco: 'Disco',
  electronic: 'Electrónica',
};

const EMPTY_PALETTE: WebDynamicPalette = {
  background: '#080b12',
  backgroundAlt: '#111827',
  primary: '#8ce8ff',
  secondary: '#d6a8ff',
  accent: '#ffe48f',
  text: '#f8fbff',
  muted: 'rgba(248,251,255,.62)',
  gradient: 'linear-gradient(145deg, #080b12, #111827)',
};

const TRUE_INTERLUDE_MIN_MS = 6_000;
const INTERLUDE_HANDOFF_MS = 2_000;
const SHORT_ENTRY_CUE_MIN_MS = 1_500;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

type KaraokeLineVariant = 'active' | 'departing' | 'upcoming';

interface KaraokeDisplayState {
  moment: KaraokeStageMoment;
  visibleLines: Array<{ line: KaraokeLine; variant: KaraokeLineVariant }>;
  nextLine: KaraokeLine | null;
  waitMs: number;
  gapMs: number;
  countdown: number | null;
}

function findDisplayState(
  lines: KaraokeLine[],
  position: number,
): KaraokeDisplayState {
  if (lines.length === 0) {
    return {
      moment: 'outro',
      visibleLines: [],
      nextLine: null,
      waitMs: 0,
      gapMs: 0,
      countdown: null,
    };
  }

  const activeIndex = lines.findIndex(line => position >= line.begin && position < line.end);
  if (activeIndex >= 0) {
    const activeLine = lines[activeIndex];
    const nextLine = lines[activeIndex + 1] ?? null;
    const waitMs = nextLine ? Math.max(0, nextLine.begin - position) : 0;
    return {
      moment: 'singing',
      visibleLines: [
        { line: activeLine, variant: 'active' },
        ...(nextLine ? [{ line: nextLine, variant: 'upcoming' as const }] : []),
      ],
      nextLine,
      waitMs,
      gapMs: 0,
      countdown: nextLine && waitMs > 0 && waitMs <= 4_000 ? Math.ceil(waitMs / 1_000) : null,
    };
  }

  const nextIndex = lines.findIndex(line => line.begin > position);
  if (nextIndex < 0) {
    const finalLine = lines.at(-1) ?? null;
    const keepFinalLine = finalLine && position - finalLine.end < 1_200;
    return {
      moment: 'outro',
      visibleLines: keepFinalLine ? [{ line: finalLine, variant: 'departing' }] : [],
      nextLine: null,
      waitMs: 0,
      gapMs: 0,
      countdown: null,
    };
  }

  const nextLine = lines[nextIndex];
  const previousLine = nextIndex > 0 ? lines[nextIndex - 1] : null;
  const waitMs = Math.max(0, nextLine.begin - position);
  const isIntro = nextIndex === 0;
  const keepPreviousLine = Boolean(previousLine && position - previousLine.end < 900);
  const totalGapMs = previousLine ? nextLine.begin - previousLine.end : 0;
  const isTrueInterlude = totalGapMs >= TRUE_INTERLUDE_MIN_MS;
  const moment: KaraokeStageMoment = isIntro
    ? 'intro'
    : isTrueInterlude && waitMs > INTERLUDE_HANDOFF_MS
      ? 'interlude'
      : 'handoff';

  return {
    moment,
    visibleLines: [
      ...(keepPreviousLine && previousLine
        ? [{ line: previousLine, variant: 'departing' as const }]
        : []),
      { line: nextLine, variant: 'upcoming' },
    ],
    nextLine,
    waitMs,
    gapMs: totalGapMs,
    countdown: waitMs > 0 && waitMs <= 4_000 ? Math.ceil(waitMs / 1_000) : null,
  };
}

function splitCharacters(value: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(value), part => part.segment);
  }
  return Array.from(value);
}

function isSustainedWord(text: string, begin: number, end: number): boolean {
  const combined = text.replace(/\s+/g, '').trim();
  if (!combined || /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(combined)) return false;
  if (/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\u0590-\u05ff]/u.test(combined)) return false;
  if (combined.includes('-')) return false;
  const duration = Math.max(0, end - begin);
  const length = splitCharacters(combined).length;
  return duration >= 850
    && duration >= length * 200
    && (length >= 4 || duration / Math.max(1, length) >= 550);
}

function KaraokeLineView({
  line,
  position,
  variant,
}: {
  line: KaraokeLine;
  position: number;
  variant: KaraokeLineVariant;
}) {
  return (
    <div className={`karaoke-line ${variant}`} data-line-id={line.id}>
      {line.words.map((word, wordIndex) => {
        const duration = Math.max(100, word.end - word.begin);
        const sustained = isSustainedWord(word.text, word.begin, word.end);
        const noteHold = sustained
          ? clamp((position - word.begin) / duration)
          : 0;
        const wordActive = position >= word.begin && position < word.end;
        const wordComplete = position >= word.end;
        const wordLit = position >= word.begin;
        return (
          <span key={word.id}>
            <span
              className={[
                'karaoke-word',
                word.background ? 'background-vocal' : '',
                sustained ? 'long-note' : '',
                wordLit ? 'is-lit' : '',
                wordActive ? 'is-active' : '',
                wordComplete ? 'is-complete' : '',
              ].filter(Boolean).join(' ')}
              style={{
                '--note-hold': noteHold,
                '--word-progress': clamp((position - word.begin) / duration),
              } as CSSProperties}
            >
              <span className="karaoke-word-face">{word.text.trim()}</span>
              {sustained ? (
                <span className="karaoke-note-tail" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              ) : null}
            </span>
            {wordIndex < line.words.length - 1 && !word.part ? ' ' : null}
          </span>
        );
      })}
    </div>
  );
}

export function KaraokeExperience({
  track,
  initialPosition,
  duration,
  volume,
  wasPlaying,
  onPauseMain,
  onExit,
}: KaraokeExperienceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mixerRef = useRef<KaraokeMixer | null>(null);
  const playbackModeRef = useRef<KaraokePlaybackMode>('instrumental');
  const preparationTokenRef = useRef(0);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const [phase, setPhase] = useState<KaraokePhase>('checking');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<KaraokeProgress>({
    stage: 'checking',
    progress: 0.02,
    detail: 'Preparando el escenario…',
  });
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [genreResult, setGenreResult] = useState<KaraokeGenreResult>({
    genre: 'pop',
    confidence: 0,
    reason: '',
    source: 'local',
    visualPlan: {
      intro: 'clouds',
      verse: 'liquid',
      chorus: 'blaze',
      bridge: 'grid',
      outro: 'laser',
    },
  });
  const [palette, setPalette] = useState<WebDynamicPalette>(EMPTY_PALETTE);
  const [stanzas, setStanzas] = useState<KaraokeStanza[]>([]);
  const [position, setPosition] = useState(initialPosition);
  const [karaokeDuration, setKaraokeDuration] = useState(duration);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<KaraokePlaybackMode>('instrumental');
  const [displayedProgress, setDisplayedProgress] = useState(0.02);
  const [lyricsTimingOffsetMs, setLyricsTimingOffsetMs] = useState(
    () => getStoredLyricsTimingOffset(track),
  );

  const prepare = useCallback(async () => {
    const preparationToken = ++preparationTokenRef.current;
    const isCancelled = () => preparationToken !== preparationTokenRef.current;
    const nativePath = getKaraokeTrackPath(track);
    if (!nativePath) {
      setError('Necesito el archivo local de esta canción. Sincroniza la carpeta o vuelve a descargarla.');
      setPhase('error');
      return;
    }
    setPhase('preparing');
    setError('');
    const controller = new AbortController();
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listenToKaraokeProgress(setProgress);
      setProgress({ stage: 'analysis', progress: 0.04, detail: 'Eligiendo el escenario y cargando la letra…' });
      const capabilities = await getKaraokeCapabilities();
      if (isCancelled()) return;
      const genrePromise = classifyKaraokeGenre(track);
      const lyricsPromise = fetchKaraokeLyrics(track, duration, controller.signal);

      if (!capabilities.demucsReady) {
        setProgress({
          stage: 'runtime',
          progress: 0.08,
          detail: 'Instalando el motor vocal local por única vez…',
        });
        await installDemucsRuntime();
        if (isCancelled()) return;
      }

      setProgress({ stage: 'separation', progress: 0.26, detail: 'Separando la voz de la música…' });
      const [stems, nextGenre, nextStanzas, nextPalette] = await Promise.all([
        prepareKaraokeStems(nativePath),
        genrePromise,
        lyricsPromise,
        getDynamicPalette(track),
      ]);
      if (isCancelled()) return;
      setProgress({ stage: 'mix', progress: 0.94, detail: 'Encendiendo el escenario…' });
      const mixer = new KaraokeMixer();
      await mixer.load(stems, initialPosition);
      if (isCancelled()) {
        mixer.destroy();
        return;
      }
      mixer.setMasterVolume(volume);
      mixer.onPosition((nextPosition, nextDuration) => {
        if (playbackModeRef.current !== 'instrumental') return;
        setPosition(nextPosition);
        if (nextDuration > 0) setKaraokeDuration(nextDuration);
      });
      mixerRef.current = mixer;
      setGenreResult(nextGenre);
      setStanzas(nextStanzas);
      setPalette(nextPalette);
      setDisplayedProgress(1);
      setPhase('ready');
      await mixer.play();
      setIsPlaying(true);
    } catch (reason) {
      if (isCancelled()) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message || 'No pude preparar esta versión karaoke.');
      setPhase('error');
    } finally {
      controller.abort();
      unlisten?.();
    }
  }, [duration, initialPosition, track, volume]);

  useEffect(() => {
    onPauseMain();
    let active = true;
    void getDynamicPalette(track).then(nextPalette => {
      if (active) setPalette(nextPalette);
    });
    void getKaraokeCapabilities()
      .then(capabilities => {
        if (!active) return;
        if (!capabilities.geminiConfigured) {
          setPhase('gemini-setup');
          return;
        }
        void prepare();
      })
      .catch(() => {
        if (active) void prepare();
      });
    return () => {
      active = false;
      preparationTokenRef.current += 1;
      webAudioEngine.pause();
      mixerRef.current?.destroy();
      mixerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'preparing') return;
    const timer = window.setInterval(() => {
      setDisplayedProgress(current => {
        const target = progress.stage === 'runtime'
          ? Math.max(0.16, progress.progress * 0.48)
          : progress.stage === 'separation'
            ? Math.max(0.34, 0.3 + progress.progress * 0.58)
            : progress.progress;
        return current + (Math.min(0.96, target) - current) * 0.08;
      });
    }, 80);
    return () => window.clearInterval(timer);
  }, [phase, progress]);

  useEffect(() => {
    if (phase !== 'ready' || playbackMode !== 'original') return;
    let animationFrame = 0;
    const updateOriginalPosition = () => {
      const state = webAudioEngine.getState();
      setPosition(Math.round(webAudioEngine.getCurrentTime() * 1_000));
      if (state.duration > 0) setKaraokeDuration(state.duration);
      animationFrame = window.requestAnimationFrame(updateOriginalPosition);
    };
    animationFrame = window.requestAnimationFrame(updateOriginalPosition);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [phase, playbackMode]);

  const handlePlaybackModeChange = async (mode: KaraokePlaybackMode) => {
    const mixer = mixerRef.current;
    if (!mixer || mode === playbackMode) return;
    try {
      const shouldKeepPlaying = isPlaying;
      if (mode === 'original') {
        const handoffPosition = mixer.getPosition();
        mixer.pause();
        webAudioEngine.seek(handoffPosition);
        playbackModeRef.current = mode;
        setPosition(handoffPosition);
        setPlaybackMode(mode);
        if (shouldKeepPlaying) await webAudioEngine.play();
      } else {
        const handoffPosition = Math.round(webAudioEngine.getCurrentTime() * 1_000);
        webAudioEngine.pause();
        mixer.seek(handoffPosition);
        playbackModeRef.current = mode;
        setPosition(handoffPosition);
        setPlaybackMode(mode);
        if (shouldKeepPlaying) await mixer.play();
      }
      setIsPlaying(shouldKeepPlaying);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pude cambiar a la canción original.');
    }
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setSavingKey(true);
    try {
      await saveGeminiApiKey(apiKey);
      setApiKey('');
      await prepare();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingKey(false);
    }
  };

  const handleToggle = async () => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    if (playbackMode === 'original') {
      if (isPlaying) {
        webAudioEngine.pause();
        setIsPlaying(false);
      } else {
        await webAudioEngine.play();
        setIsPlaying(webAudioEngine.getState().isPlaying);
      }
      return;
    }
    await mixer.toggle();
    setIsPlaying(mixer.isPlaying);
  };

  const handleSeek = (nextPosition: number) => {
    const clampedPosition = Math.max(0, Math.min(karaokeDuration, nextPosition));
    mixerRef.current?.seek(clampedPosition);
    webAudioEngine.seek(clampedPosition);
    setPosition(clampedPosition);
  };

  const handleExit = () => {
    preparationTokenRef.current += 1;
    const mixer = mixerRef.current;
    const finalPosition = playbackModeRef.current === 'original'
      ? Math.round(webAudioEngine.getCurrentTime() * 1_000)
      : mixer?.getPosition() ?? position;
    webAudioEngine.pause();
    mixer?.destroy();
    mixerRef.current = null;
    onExit(finalPosition, wasPlaying);
  };

  const lyricsPosition = Math.max(
    0,
    Math.min(karaokeDuration, position + lyricsTimingOffsetMs),
  );
  const lyricLines = useMemo(
    () => stanzas
      .flatMap(stanza => stanza.lines)
      .sort((left, right) => left.begin - right.begin),
    [stanzas],
  );
  const displayState = useMemo(
    () => findDisplayState(lyricLines, lyricsPosition),
    [lyricLines, lyricsPosition],
  );
  const stageEffect = useMemo(() => resolveKaraokeStageEffect({
    stanzas,
    moment: displayState.moment,
    position,
    duration: karaokeDuration,
    visualPlan: genreResult.visualPlan,
  }), [
    displayState.moment,
    genreResult.visualPlan,
    karaokeDuration,
    position,
    stanzas,
  ]);
  const paletteStyle = paletteToCssVars(palette) as CSSProperties;
  const timelineProgress = karaokeDuration > 0 ? clamp(position / karaokeDuration) : 0;
  const isWaitingForVoice = displayState.moment === 'intro'
    || displayState.moment === 'interlude'
    || (
      displayState.moment === 'handoff'
      && displayState.gapMs >= SHORT_ENTRY_CUE_MIN_MS
      && displayState.countdown !== null
    );
  const entryCueLabel = displayState.moment === 'intro'
    ? 'Tu entrada'
    : displayState.moment === 'interlude'
      ? 'Interludio'
      : 'Prepárate';
  const timingLabel = lyricsTimingOffsetMs === 0
    ? '0.00 s'
    : `${lyricsTimingOffsetMs > 0 ? '+' : '−'}${(Math.abs(lyricsTimingOffsetMs) / 1_000).toFixed(2)} s`;

  const adjustLyricsTiming = (deltaMs: number) => {
    setLyricsTimingOffsetMs(current => (
      setStoredLyricsTimingOffset(track, current + deltaMs)
    ));
  };

  return (
    <div
      ref={rootRef}
      className={[
        'karaoke-experience',
        `karaoke-genre-${genreResult.genre}`,
        `karaoke-effect-${stageEffect}`,
        `phase-${phase}`,
      ].join(' ')}
      data-karaoke-effect={stageEffect}
      style={paletteStyle}
    >
      <div className="karaoke-background" aria-hidden="true">
        <div className="karaoke-background-color" />
        {phase === 'ready' && mixerRef.current ? (
          <KaraokeCanvasUiStage
            effect={stageEffect}
            palette={palette}
            mixer={mixerRef.current}
            isPlaying={isPlaying}
            targetRef={rootRef}
          />
        ) : null}
        <div className="karaoke-background-scrim" />
      </div>

      <button className="karaoke-close" onClick={handleExit} aria-label="Cerrar Karaoke" title="Cerrar">
        <CloseIcon size={21} />
      </button>

      {phase === 'gemini-setup' ? (
        <section className="karaoke-setup-card">
          <div className="karaoke-setup-mark"><MicrophoneIcon size={28} /></div>
          <span className="karaoke-eyebrow">Una sola vez</span>
          <h2>Conecta el selector de escenario</h2>
          <p>
            Gemini solo recibirá título, artista y álbum para elegir entre nuestros seis escenarios.
            La canción nunca sale de tu Mac.
          </p>
          <label>
            <span>Gemini API key</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
              placeholder="AIza…"
            />
          </label>
          {error ? <p className="karaoke-inline-error">{error}</p> : null}
          <button className="karaoke-primary-action" onClick={handleSaveKey} disabled={!apiKey.trim() || savingKey}>
            {savingKey ? <SpinnerIcon size={18} /> : <MicrophoneIcon size={18} />}
            Guardar y preparar Karaoke
          </button>
          <button className="karaoke-secondary-action" onClick={() => void prepare()}>
            Continuar con detección local
          </button>
        </section>
      ) : null}

      {phase === 'checking' || phase === 'preparing' ? (
        <section className="karaoke-preparing" aria-live="polite">
          <div className="karaoke-preparing-orbit">
            <MicrophoneIcon size={28} />
            <span />
          </div>
          <span className="karaoke-eyebrow">Creando versión Karaoke</span>
          <h2>{track.title}</h2>
          <p>{progress.detail}</p>
          <div className="karaoke-progress-track">
            <span style={{ transform: `scaleX(${displayedProgress})` }} />
          </div>
          <small>
            {progress.stage === 'runtime'
              ? 'La primera vez puede tardar un poco más. Después queda instalado.'
              : 'La versión terminada quedará guardada para abrirse al instante.'}
          </small>
        </section>
      ) : null}

      {phase === 'error' ? (
        <section className="karaoke-error-card">
          <span className="karaoke-eyebrow">No se pudo abrir el escenario</span>
          <h2>Algo interrumpió la preparación</h2>
          <p>{error}</p>
          <button className="karaoke-primary-action" onClick={() => void prepare()}>
            Reintentar
          </button>
          <button className="karaoke-secondary-action" onClick={handleExit}>Cerrar</button>
        </section>
      ) : null}

      {phase === 'ready' ? (
        <>
          <header className="karaoke-stage-header">
            <div>
              <span className="karaoke-live-dot" />
              <span>Karaoke · {GENRE_LABELS[genreResult.genre]}</span>
            </div>
            <p>{track.title} · {track.artist}</p>
          </header>

          <main className={`karaoke-lyrics-stage moment-${displayState.moment}`}>
            {lyricLines.length > 0 ? (
              <div className="karaoke-performance">
                {isWaitingForVoice ? (
                  <div className="karaoke-entry-cue" aria-live="polite">
                    <span>{entryCueLabel}</span>
                    {displayState.countdown ? (
                      <strong key={displayState.countdown}>{displayState.countdown}</strong>
                    ) : (
                      <div className="karaoke-spectrum-wait" aria-hidden="true">
                        {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
                      </div>
                    )}
                    <div className="karaoke-cue-dots" aria-hidden="true">
                      {Array.from({ length: 4 }, (_, index) => (
                        <i className={displayState.waitMs <= (4 - index) * 1_000 ? 'filled' : ''} key={index} />
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="karaoke-stanza karaoke-line-stack">
                  {displayState.visibleLines.map(({ line, variant }) => (
                    <KaraokeLineView
                      key={line.id}
                      line={line}
                      position={lyricsPosition}
                      variant={variant}
                    />
                  ))}
                </div>

                {displayState.moment === 'outro' && displayState.visibleLines.length === 0 ? (
                  <div className="karaoke-finish-state" aria-live="polite">
                    <span>Final</span>
                    <strong>{track.title}</strong>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="karaoke-no-lyrics">
                <MicrophoneIcon size={38} />
                <p>La música está lista, pero no encontré letras sincronizadas para esta canción.</p>
              </div>
            )}
          </main>

          <footer className="karaoke-controls">
            <div className="karaoke-transport">
              <button
                className="karaoke-seek-button"
                onClick={() => handleSeek(position - 10_000)}
                aria-label="Retroceder 10 segundos"
              >
                <SeekBackIcon size={23} />
              </button>
              <button className="karaoke-play" onClick={() => void handleToggle()} aria-label={isPlaying ? 'Pausar' : 'Reproducir'}>
                {isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
              </button>
              <button
                className="karaoke-seek-button"
                onClick={() => handleSeek(position + 10_000)}
                aria-label="Adelantar 10 segundos"
              >
                <SeekForwardIcon size={23} />
              </button>
            </div>
            <input
              className="karaoke-timeline"
              type="range"
              min={0}
              max={Math.max(1, karaokeDuration)}
              value={Math.min(position, Math.max(1, karaokeDuration))}
              onInput={event => handleSeek(event.currentTarget.valueAsNumber)}
              style={{ '--val': `${timelineProgress * 100}%` } as CSSProperties}
              aria-label="Posición de la canción"
            />
            <div className="karaoke-timing-control" aria-label="Calibrar sincronización de la letra">
              <button
                onClick={() => adjustLyricsTiming(-250)}
                aria-label="Mostrar la letra 250 milisegundos después"
                title="Letra más tarde"
              >
                −
              </button>
              <output title="Ajuste de sincronización de la letra">
                <span>Letra</span>
                {timingLabel}
              </output>
              <button
                onClick={() => adjustLyricsTiming(250)}
                aria-label="Mostrar la letra 250 milisegundos antes"
                title="Letra más pronto"
              >
                +
              </button>
            </div>
            <div className="karaoke-track-toggle" role="group" aria-label="Versión de la canción">
              <button
                type="button"
                className={playbackMode === 'instrumental' ? 'active' : ''}
                onClick={() => void handlePlaybackModeChange('instrumental')}
                aria-pressed={playbackMode === 'instrumental'}
              >
                Sin voz
              </button>
              <button
                type="button"
                className={playbackMode === 'original' ? 'active' : ''}
                onClick={() => void handlePlaybackModeChange('original')}
                aria-pressed={playbackMode === 'original'}
              >
                Original
              </button>
            </div>
          </footer>
        </>
      ) : null}
    </div>
  );
}
