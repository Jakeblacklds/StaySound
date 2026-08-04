import { RefObject, useEffect, useRef } from 'react';
import type { WebDynamicPalette } from '../library/dynamicColors';
import type { KaraokeGenre } from '../karaoke/karaokeDesktop';
import type { KaraokeMixer } from '../karaoke/KaraokeMixer';
import { createStageRenderer, type StageAudio } from '../karaoke/stageScenes';
import { createStageGlRenderer } from '../karaoke/stageGlRenderer';

interface KaraokeStageCanvasProps {
  genre: KaraokeGenre;
  palette: WebDynamicPalette;
  mixer: KaraokeMixer;
  isPlaying: boolean;
  targetRef: RefObject<HTMLElement | null>;
}

const IDLE_SAMPLE = {
  bass: 0,
  mid: 0,
  treble: 0,
  level: 0,
  vocalPitch: 0.5,
  vocalEnergy: 0,
  kick: 0,
  midHit: 0,
  sparkle: 0,
};

export function KaraokeStageCanvas({
  genre,
  palette,
  mixer,
  isPlaying,
  targetRef,
}: KaraokeStageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const genreRef = useRef(genre);
  const paletteRef = useRef(palette);
  const playingRef = useRef(isPlaying);
  genreRef.current = genre;
  paletteRef.current = palette;
  playingRef.current = isPlaying;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const glRenderer = createStageGlRenderer(canvas);
    const fallbackContext = glRenderer ? null : canvas.getContext('2d');
    const fallbackRenderer = fallbackContext ? createStageRenderer() : null;
    if (!glRenderer && (!fallbackContext || !fallbackRenderer)) return;
    let width = 0;
    let height = 0;
    let raf = 0;
    let previousFrame = 0;
    let previousAudioFrame = 0;
    let quietVocalMs = 0;
    let instrumentalPresence = 0;
    let renderCost = 0;
    let measuredFrames = 0;
    let qualityCooldown = 0;
    const hardwareThreads = navigator.hardwareConcurrency || 4;
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    let resolutionQuality = reduceMotion
      ? 0.58
      : hardwareThreads <= 4 || deviceMemory <= 4
        ? 0.76
        : 1;

    // Two smoothing stages: the bands ease gently in both directions, while
    // the transient envelopes keep a fast attack and a musical ~300ms release
    // so both the canvas and the lyric CSS receive motion that never jitters.
    const slow = { bass: 0, mid: 0, treble: 0, level: 0, vocal: 0, pitch: 0.5 };
    let beat = 0;
    let hit = 0;
    let glow = 0;
    const follow = (current: number, target: number, up: number, down: number) =>
      current + (target - current) * (target > current ? up : down);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(1.35, window.devicePixelRatio || 1) * resolutionQuality;
      width = Math.max(1, Math.round(rect.width * scale));
      height = Math.max(1, Math.round(rect.height * scale));
      canvas.width = width;
      canvas.height = height;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      const minimumFrame = playingRef.current && !reduceMotion ? 30 : 66;
      if (time - previousFrame < minimumFrame) return;
      previousFrame = time;
      const sample = playingRef.current ? mixer.sampleSpectrum() : IDLE_SAMPLE;
      const elapsed = previousAudioFrame ? Math.min(100, time - previousAudioFrame) : 33;
      previousAudioFrame = time;

      slow.bass = follow(slow.bass, sample.bass, 0.14, 0.05);
      slow.mid = follow(slow.mid, sample.mid, 0.12, 0.05);
      slow.treble = follow(slow.treble, sample.treble, 0.14, 0.05);
      slow.level = follow(slow.level, sample.level, 0.12, 0.05);
      slow.vocal = follow(slow.vocal, sample.vocalEnergy, 0.16, 0.06);
      slow.pitch += (sample.vocalPitch - slow.pitch) * 0.08;
      if (reduceMotion) {
        beat = 0;
        hit = 0;
        glow = 0;
      } else {
        beat = follow(beat, sample.kick, 0.5, 0.12);
        hit = follow(hit, sample.midHit, 0.45, 0.12);
        glow = follow(glow, sample.sparkle, 0.4, 0.1);
      }
      const hasMusic = playingRef.current && sample.level > 0.045;
      const vocalIsQuiet = sample.vocalEnergy < 0.058;
      if (hasMusic && vocalIsQuiet) {
        quietVocalMs = Math.min(4_000, quietVocalMs + elapsed);
      } else {
        quietVocalMs = Math.max(0, quietVocalMs - elapsed * 3.2);
      }
      const instrumentalTarget = quietVocalMs > 720
        ? Math.min(1, (quietVocalMs - 720) / 780)
        : 0;
      instrumentalPresence = follow(instrumentalPresence, instrumentalTarget, 0.11, 0.24);

      const target = targetRef.current;
      if (target) {
        target.style.setProperty('--karaoke-bass', slow.bass.toFixed(3));
        target.style.setProperty('--karaoke-mid', slow.mid.toFixed(3));
        target.style.setProperty('--karaoke-treble', slow.treble.toFixed(3));
        target.style.setProperty('--karaoke-level', slow.level.toFixed(3));
        target.style.setProperty('--karaoke-pitch', slow.pitch.toFixed(3));
        target.style.setProperty('--karaoke-vocal', slow.vocal.toFixed(3));
        target.style.setProperty('--karaoke-beat', beat.toFixed(3));
        target.style.setProperty('--karaoke-hit', hit.toFixed(3));
        target.style.setProperty('--karaoke-glow', glow.toFixed(3));
        // Legacy names kept for any style still reading them; they now carry
        // the smoothed envelopes instead of the raw per-frame transients.
        target.style.setProperty('--karaoke-pulse', beat.toFixed(3));
        target.style.setProperty('--karaoke-kick', beat.toFixed(3));
        target.style.setProperty('--karaoke-mid-hit', hit.toFixed(3));
        target.style.setProperty('--karaoke-spark', glow.toFixed(3));
        target.style.setProperty('--karaoke-instrumental', instrumentalPresence.toFixed(3));
      }

      const stageAudio: StageAudio = {
        bass: slow.bass,
        mid: slow.mid,
        treble: slow.treble,
        level: slow.level,
        vocal: slow.vocal,
        pitch: slow.pitch,
        beat,
        hit,
        glow,
        instrumental: reduceMotion ? Math.min(.5, instrumentalPresence) : instrumentalPresence,
      };
      const renderStarted = performance.now();
      const frame = {
        time,
        width,
        height,
        genre: genreRef.current,
        palette: paletteRef.current,
        audio: stageAudio,
      };
      if (glRenderer) {
        glRenderer.render(frame);
      } else if (fallbackContext && fallbackRenderer) {
        fallbackContext.clearRect(0, 0, width, height);
        fallbackRenderer(fallbackContext, frame);
      }
      const frameCost = performance.now() - renderStarted;
      renderCost += (frameCost - renderCost) * 0.08;
      measuredFrames += 1;
      qualityCooldown = Math.max(0, qualityCooldown - 1);

      // The atmosphere is allowed to lose resolution before it can disturb
      // playback or lyric motion. It recovers slowly after a sustained calm.
      if (qualityCooldown === 0 && measuredFrames > 48) {
        const previousQuality = resolutionQuality;
        if (renderCost > 9 && resolutionQuality > 0.58) {
          resolutionQuality = Math.max(0.58, resolutionQuality - 0.18);
          qualityCooldown = 150;
        } else if (renderCost < 4.2 && resolutionQuality < 1 && measuredFrames > 260) {
          resolutionQuality = Math.min(1, resolutionQuality + 0.12);
          qualityCooldown = 240;
        }
        if (previousQuality !== resolutionQuality) {
          resize();
          targetRef.current?.setAttribute(
            'data-karaoke-vfx-quality',
            resolutionQuality < 0.7 ? 'light' : resolutionQuality < 0.9 ? 'balanced' : 'high',
          );
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      glRenderer?.destroy();
    };
  }, [mixer, targetRef]);

  return <canvas ref={canvasRef} className="karaoke-stage-canvas" aria-hidden="true" />;
}
