import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasUiEffectStage,
  type CanvasUiAudioFrame,
  type CanvasUiEffectName,
  type CanvasUiPalette,
} from './CanvasUiEffectStage';
import '../styles/canvasui-karaoke.css';
import '../styles/karaoke-canvasui-prototype.css';

interface PrototypeScene {
  id: string;
  label: string;
  effect: CanvasUiEffectName;
  start: number;
  end: number;
  activeLine?: string;
  nextLine?: string;
  intensity: number;
  state: 'wait' | 'sing' | 'instrumental' | 'finish';
}

const TOTAL_DURATION = 48;
const BPM = 104;

const PALETTE: CanvasUiPalette = {
  background: '#090812',
  backgroundAlt: '#11192b',
  primary: '#75dfff',
  secondary: '#d98cff',
  accent: '#ffd56b',
};

const SCENES: PrototypeScene[] = [
  {
    id: 'intro',
    label: 'Intro',
    effect: 'clouds',
    start: 0,
    end: 8,
    nextLine: 'Cuando la ciudad se apaga',
    intensity: 0.42,
    state: 'wait',
  },
  {
    id: 'verse',
    label: 'Verso',
    effect: 'liquid',
    start: 8,
    end: 19,
    activeLine: 'Cuando la ciudad se apaga',
    nextLine: 'queda una luz entre los dos',
    intensity: 0.58,
    state: 'sing',
  },
  {
    id: 'chorus',
    label: 'Coro',
    effect: 'blaze',
    start: 19,
    end: 29,
    activeLine: 'TODO VUELVE A RESPIRAR',
    nextLine: 'cuando cantamos sin mirar atrás',
    intensity: 1,
    state: 'sing',
  },
  {
    id: 'interlude',
    label: 'Interludio',
    effect: 'droplets',
    start: 29,
    end: 36,
    nextLine: 'Cruzamos todas las señales',
    intensity: 0.72,
    state: 'instrumental',
  },
  {
    id: 'bridge',
    label: 'Puente',
    effect: 'grid',
    start: 36,
    end: 43,
    activeLine: 'Cruzamos todas las señales',
    nextLine: 'para encontrarnos otra vez',
    intensity: 0.82,
    state: 'sing',
  },
  {
    id: 'outro',
    label: 'Outro',
    effect: 'laser',
    start: 43,
    end: TOTAL_DURATION,
    activeLine: 'para encontrarnos otra vez',
    intensity: 0.48,
    state: 'finish',
  },
];

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function getScene(elapsed: number): PrototypeScene {
  return SCENES.find(scene => elapsed >= scene.start && elapsed < scene.end)
    ?? SCENES[SCENES.length - 1];
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function lyricWords(line: string, progress: number) {
  const words = line.split(/\s+/);
  return words.map((word, index) => {
    const start = index / words.length;
    const end = (index + 1) / words.length;
    const wordProgress = clamp((progress - start) / Math.max(0.001, end - start));
    return (
      <span key={`${word}-${index}`}>
        <span
          className="canvasui-prototype-word"
          style={{ '--word-progress': wordProgress } as CSSProperties}
        >
          {word}
        </span>
        {index < words.length - 1 ? ' ' : null}
      </span>
    );
  });
}

export function KaraokeCanvasUiPrototype() {
  const startTimeRef = useRef(performance.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const update = () => {
      setElapsed(((performance.now() - startTimeRef.current) / 1_000) % TOTAL_DURATION);
    };
    update();
    const timer = window.setInterval(update, 80);
    return () => window.clearInterval(timer);
  }, []);

  const scene = getScene(elapsed);
  const sceneProgress = clamp((elapsed - scene.start) / (scene.end - scene.start));
  const songProgress = elapsed / TOTAL_DURATION;
  const secondsToEntry = scene.nextLine
    ? Math.max(0, Math.ceil(scene.end - elapsed))
    : 0;

  const sampleAudio = useCallback((): CanvasUiAudioFrame => {
    const nowSeconds = (performance.now() - startTimeRef.current) / 1_000;
    const liveElapsed = nowSeconds % TOTAL_DURATION;
    const liveScene = getScene(liveElapsed);
    const beatPhase = (nowSeconds * BPM / 60) % 1;
    const kick = Math.pow(Math.max(0, Math.cos(beatPhase * Math.PI * 2)), 16);
    const offBeat = Math.pow(Math.max(0, Math.cos((beatPhase + 0.5) * Math.PI * 2)), 20);
    const motion = 0.5 + Math.sin(nowSeconds * 0.73) * 0.5;
    const intensity = liveScene.intensity;
    return {
      bass: clamp((0.24 + kick * 0.68 + motion * 0.08) * intensity),
      mid: clamp((0.28 + offBeat * 0.34 + Math.sin(nowSeconds * 1.3) * 0.08) * intensity),
      treble: clamp((0.2 + Math.pow(Math.max(0, Math.sin(nowSeconds * 4.7)), 9) * 0.62) * intensity),
      level: clamp((0.34 + kick * 0.36 + offBeat * 0.16) * intensity),
      vocal: liveScene.state === 'sing' ? 0.58 + Math.sin(nowSeconds * 2.1) * 0.22 : 0.04,
      kick,
      hit: Math.max(kick, offBeat * 0.72),
      glow: Math.pow(Math.max(0, Math.sin(nowSeconds * 2.35)), 12),
    };
  }, []);

  const jumpToScene = (nextScene: PrototypeScene) => {
    startTimeRef.current = performance.now() - nextScene.start * 1_000;
    setElapsed(nextScene.start);
  };

  const sceneCss = useMemo(() => ({
    '--scene-primary': PALETTE.primary,
    '--scene-secondary': PALETTE.secondary,
    '--scene-accent': PALETTE.accent,
    '--song-progress': songProgress,
    '--outro-lyric-opacity': scene.id === 'outro'
      ? clamp((0.72 - sceneProgress) / 0.18)
      : 1,
  }) as CSSProperties, [scene.id, sceneProgress, songProgress]);

  return (
    <main className={`canvasui-prototype scene-${scene.id}`} style={sceneCss}>
      <CanvasUiEffectStage
        effect={scene.effect}
        palette={PALETTE}
        sampleAudio={sampleAudio}
      />
      <div className="canvasui-prototype-scrim" aria-hidden="true" />

      <header className="canvasui-prototype-header">
        <div>
          <span className="canvasui-prototype-live" />
          <strong>Canvas UI × StaySound</strong>
        </div>
        <span>Midnight Signal · Prototype</span>
      </header>

      <nav className="canvasui-prototype-scenes" aria-label="Momentos de la canción">
        {SCENES.map(item => (
          <button
            className={item.id === scene.id ? 'active' : ''}
            key={item.id}
            onClick={() => jumpToScene(item)}
          >
            <span>{item.label}</span>
            <small>{item.effect}</small>
          </button>
        ))}
      </nav>

      <section className={`canvasui-prototype-performance state-${scene.state}`}>
        {scene.state === 'wait' || scene.state === 'instrumental' ? (
          <div className="canvasui-prototype-cue">
            <span>{scene.state === 'wait' ? 'Tu entrada' : 'Interludio'}</span>
            {secondsToEntry <= 4 ? (
              <strong key={secondsToEntry}>{Math.max(1, secondsToEntry)}</strong>
            ) : (
              <div className="canvasui-prototype-spectrum" aria-hidden="true">
                {Array.from({ length: 13 }, (_, index) => <i key={index} />)}
              </div>
            )}
          </div>
        ) : null}

        {scene.activeLine ? (
          <h1>{lyricWords(scene.activeLine, sceneProgress)}</h1>
        ) : null}

        {scene.nextLine ? (
          <p className="canvasui-prototype-next">{scene.nextLine}</p>
        ) : null}

        {scene.state === 'finish' && sceneProgress > 0.68 ? (
          <div className="canvasui-prototype-finish">
            <span>Final</span>
            <strong>Midnight Signal</strong>
          </div>
        ) : null}
      </section>

      <footer className="canvasui-prototype-footer">
        <span>{formatTime(elapsed)}</span>
        <div className="canvasui-prototype-timeline">
          <i style={{ transform: `scaleX(${songProgress})` }} />
          {SCENES.slice(1).map(item => (
            <b key={item.id} style={{ left: `${item.start / TOTAL_DURATION * 100}%` }} />
          ))}
        </div>
        <span>{formatTime(TOTAL_DURATION)}</span>
        <div className="canvasui-prototype-now">
          <small>Escena</small>
          <strong>{scene.label} · {scene.effect}</strong>
        </div>
      </footer>
    </main>
  );
}
