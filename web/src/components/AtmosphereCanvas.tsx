import { RefObject, useEffect, useRef } from 'react';
import { spectrumEngine, type SpectrumBands } from '../audio/spectrumEngine';
import type { WebDynamicPalette } from '../library/dynamicColors';

interface AtmosphereCanvasProps {
  palette: WebDynamicPalette | null;
  isPlaying: boolean;
  motionKey?: string | null;
  /** Element that receives live --atmo-bass/--atmo-mid/--atmo-treble vars. */
  reactiveTarget?: RefObject<HTMLElement | null>;
}

type Rgb = [number, number, number];

const ZERO_BANDS: SpectrumBands = { bass: 0, mid: 0, treble: 0, level: 0 };
const PALETTE_STEPS = 36;

function hexToRgbTuple(value: string): Rgb {
  const normalized = value.replace('#', '');
  if (normalized.length !== 6) return [255, 255, 255];
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function mixRgb(left: Rgb, right: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return [
    Math.round(left[0] + (right[0] - left[0]) * t),
    Math.round(left[1] + (right[1] - left[1]) * t),
    Math.round(left[2] + (right[2] - left[2]) * t),
  ];
}

function rgbCss([red, green, blue]: Rgb): string {
  return `rgb(${red} ${green} ${blue})`;
}

function hashGrid(x: number, y: number): number {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const top = hashGrid(ix, iy) * (1 - ux) + hashGrid(ix + 1, iy) * ux;
  const bottom = hashGrid(ix, iy + 1) * (1 - ux) + hashGrid(ix + 1, iy + 1) * ux;
  return top * (1 - uy) + bottom * uy;
}

function fbm(x: number, y: number): number {
  let total = 0;
  let amplitude = 0.54;
  let px = x;
  let py = y;
  for (let octave = 0; octave < 3; octave += 1) {
    total += smoothNoise(px, py) * amplitude;
    px = px * 2.02 + 4.17;
    py = py * 2.02 + 1.31;
    amplitude *= 0.5;
  }
  return total;
}

function followVisual(current: number, target: number, dt: number, attack = 0.075, release = 0.035): number {
  const rate = target > current ? attack : release;
  const blend = 1 - Math.pow(1 - rate, dt);
  return current + (target - current) * blend;
}

function compressBand(value: number, amount = 0.82, ceiling = 0.86): number {
  return Math.min(ceiling, Math.pow(Math.max(0, value), amount));
}

function buildDotPalette(palette: WebDynamicPalette): string[] {
  const primary = hexToRgbTuple(palette.primary);
  const secondary = hexToRgbTuple(palette.secondary);
  const accent = hexToRgbTuple(palette.accent);
  return Array.from({ length: PALETTE_STEPS }, (_, index) => {
    const position = index / (PALETTE_STEPS - 1);
    const color = position < 0.5
      ? mixRgb(secondary, primary, position * 2)
      : mixRgb(primary, accent, (position - 0.5) * 2);
    return rgbCss(color);
  });
}

/**
 * OriginKit Dot Matrix adapted to StaySound's existing spectrum engine. The
 * broad domain-warped waves decide where the matrix is visible; audio only nudges
 * radius, luminance and a high-inertia flow vector, so transients never shake it.
 */
export function AtmosphereCanvas({ palette, isPlaying, motionKey, reactiveTarget }: AtmosphereCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef(palette);
  const playingRef = useRef(isPlaying);
  const motionKeyRef = useRef(motionKey);

  paletteRef.current = palette;
  playingRef.current = isPlaying;
  motionKeyRef.current = motionKey;

  useEffect(() => {
    if (isPlaying) spectrumEngine.start();
  }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let rafId = 0;
    let width = 0;
    let height = 0;
    let lastFrameTime = performance.now();
    let visualBands = { ...ZERO_BANDS };
    let shapeBands = { ...ZERO_BANDS };
    let activeMotionKey = motionKeyRef.current;
    let flowVelocityX = 0;
    let flowVelocityY = 0;
    let flowX = 0;
    let flowY = 0;
    let paletteKey = '';
    let dotPalette: string[] = [];
    let topologySeed = 0;
    const lastWrittenVars = new Map<string, string>();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(320, Math.round(rect.width));
      height = Math.max(240, Math.round(rect.height));
      canvas.width = width;
      canvas.height = height;
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const writeSpectrumVars = (rawBands: SpectrumBands) => {
      const target = reactiveTarget?.current;
      if (!target) return;
      const values: Array<[string, number]> = [
        ['--atmo-bass', rawBands.bass],
        ['--atmo-mid', rawBands.mid],
        ['--atmo-treble', rawBands.treble],
        ['--atmo-bass-smooth', visualBands.bass],
        ['--atmo-mid-smooth', visualBands.mid],
        ['--atmo-treble-smooth', visualBands.treble],
        ['--atmo-beat', visualBands.bass * 0.22],
      ];
      values.forEach(([name, value]) => {
        const serialized = value.toFixed(2);
        if (lastWrittenVars.get(name) === serialized) return;
        lastWrittenVars.set(name, serialized);
        target.style.setProperty(name, serialized);
      });
    };

    const draw = (time: number) => {
      rafId = requestAnimationFrame(draw);
      if (document.hidden || width === 0 || height === 0) {
        lastFrameTime = time;
        return;
      }

      const currentPalette = paletteRef.current;
      if (!currentPalette) return;
      const minimumFrameMs = playingRef.current ? 32 : 64;
      if (time - lastFrameTime < minimumFrameMs) return;

      const frameMs = Math.min(64, Math.max(8, time - lastFrameTime || 16.7));
      const dt = frameMs / 16.7;
      lastFrameTime = time;

      if (activeMotionKey !== motionKeyRef.current) {
        activeMotionKey = motionKeyRef.current;
        visualBands = { ...ZERO_BANDS };
        shapeBands = { ...ZERO_BANDS };
        flowVelocityX = 0;
        flowVelocityY = 0;
      }

      const debugBands = import.meta.env.DEV
        ? (window as Window & { __atmoDebugBands?: SpectrumBands | null }).__atmoDebugBands ?? null
        : null;
      const sampled = debugBands ?? (playingRef.current && !reduceMotion ? spectrumEngine.sample() : ZERO_BANDS);
      const rawBands: SpectrumBands = {
        bass: compressBand(sampled.bass, 0.74, 0.94),
        mid: compressBand(sampled.mid, 0.84),
        treble: compressBand(sampled.treble, 1.05, 0.62),
        level: compressBand(sampled.level, 0.84),
      };
      visualBands = {
        bass: followVisual(visualBands.bass, rawBands.bass, dt, 0.15, 0.045),
        mid: followVisual(visualBands.mid, rawBands.mid, dt, 0.1, 0.035),
        treble: followVisual(visualBands.treble, rawBands.treble, dt, 0.12, 0.05),
        level: followVisual(visualBands.level, rawBands.level, dt),
      };
      // A second, deliberately heavy envelope drives geometry. Fast spectrum
      // values may tint the atmosphere, but can never fill the matrix abruptly.
      shapeBands = {
        bass: followVisual(shapeBands.bass, rawBands.bass, dt, 0.022, 0.012),
        mid: followVisual(shapeBands.mid, rawBands.mid, dt, 0.018, 0.01),
        treble: followVisual(shapeBands.treble, rawBands.treble, dt, 0.016, 0.012),
        level: followVisual(shapeBands.level, rawBands.level, dt, 0.02, 0.011),
      };
      writeSpectrumVars(rawBands);

      if (!reduceMotion) {
        const targetVelocityX = 0.018 + (shapeBands.treble - shapeBands.bass * 0.54) * 0.035;
        const targetVelocityY = 0.009 + (shapeBands.mid - shapeBands.bass * 0.55) * 0.03;
        flowVelocityX = followVisual(flowVelocityX, targetVelocityX, dt, 0.009, 0.006);
        flowVelocityY = followVisual(flowVelocityY, targetVelocityY, dt, 0.008, 0.005);
        flowX += flowVelocityX * frameMs / 1000;
        flowY += flowVelocityY * frameMs / 1000;
      }

      const nextPaletteKey = `${currentPalette.primary}|${currentPalette.secondary}|${currentPalette.accent}`;
      if (nextPaletteKey !== paletteKey) {
        paletteKey = nextPaletteKey;
        dotPalette = buildDotPalette(currentPalette);
        const [seedR, seedG, seedB] = hexToRgbTuple(currentPalette.primary);
        topologySeed = (seedR * 0.017 + seedG * 0.031 + seedB * 0.047) % (Math.PI * 2);
      }

      context.globalCompositeOperation = 'source-over';
      context.globalAlpha = 1;
      context.fillStyle = currentPalette.background;
      context.fillRect(0, 0, width, height);

      const minSide = Math.min(width, height);
      const cell = Math.max(14, Math.min(34, minSide / 28));
      const columns = Math.ceil(width / cell);
      const rows = Math.ceil(height / cell);
      const aspect = width / height;
      const paths = Array.from({ length: PALETTE_STEPS }, () => new Path2D());
      // Dot size belongs to the procedural surface, not to the beat meter. Only
      // a nearly imperceptible breath remains; music primarily sculpts topology.
      const audioRadius = 1 + shapeBands.level * 0.012;
      // Incommensurate rates keep the topology evolving without a visible loop.
      // Audio changes the pace slightly, never the continuity of the field.
      const morphTime = reduceMotion
        ? topologySeed
        : topologySeed + time * 0.0001 * (1 + shapeBands.mid * 0.1);
      const angle = Math.sin(morphTime * 0.71) * 0.48
        + Math.cos(morphTime * 0.37) * 0.22
        + (shapeBands.treble - shapeBands.bass) * 0.09;
      const angleCos = Math.cos(angle);
      const angleSin = Math.sin(angle);
      const familyBlendRaw = 0.5 + 0.5 * Math.sin(morphTime * 0.23 + Math.sin(morphTime * 0.11) * 1.7);
      const familyBlendBase = familyBlendRaw * familyBlendRaw * (3 - 2 * familyBlendRaw);
      const familyBlend = Math.max(0, Math.min(1, familyBlendBase + (shapeBands.treble - shapeBands.mid) * 0.055));

      for (let row = 0; row < rows; row += 1) {
        const y = (row + 0.5) * cell;
        const uvY = y / height - 0.5;
        for (let column = 0; column < columns; column += 1) {
          const x = (column + 0.5) * cell;
          const uvX = (x / width - 0.5) * aspect;
          const rotatedX = uvX * angleCos - uvY * angleSin;
          const rotatedY = uvX * angleSin + uvY * angleCos;
          const scaleX = 1 + Math.sin(morphTime * 0.29) * 0.18 + shapeBands.bass * 0.045;
          const scaleY = 1 + Math.cos(morphTime * 0.19) * 0.16 + shapeBands.mid * 0.04;
          const warpX = fbm(
            rotatedX * 1.32 * scaleX + flowX * 0.42 + Math.sin(morphTime * 0.43) * 0.8 + 3.2,
            rotatedY * 1.32 * scaleY - flowY * 0.28 + Math.cos(morphTime * 0.31) * 0.7 + 6.7,
          ) - 0.5;
          const warpY = fbm(
            rotatedX * 1.08 * scaleY - flowX * 0.31 + Math.cos(morphTime * 0.27) * 0.9 + 8.1,
            rotatedY * 1.08 * scaleX + flowY * 0.36 + Math.sin(morphTime * 0.39) * 0.75 + 1.4,
          ) - 0.5;
          const warpStrength = 0.78 + shapeBands.mid * 0.16 + shapeBands.bass * 0.055;
          const phaseA = (rotatedX + warpX * warpStrength) * (6.4 + Math.sin(morphTime * 0.43) * 1.1)
            + (rotatedY + warpY * 0.62) * (2.0 + Math.cos(morphTime * 0.31) * 1.15)
            + Math.sin((rotatedY + warpY * 0.42) * (7.2 + Math.cos(morphTime * 0.17)) + morphTime * 0.7)
              * (1.25 + shapeBands.treble * 0.14);
          const phaseB = (rotatedY - warpY * 0.72) * (5.1 + Math.cos(morphTime * 0.41) * 1.05)
            - (rotatedX + warpX * 0.55) * (2.7 + Math.sin(morphTime * 0.33) * 0.9)
            + Math.sin((rotatedX - warpX * 0.36) * 6.1 - morphTime * 0.53) * 1.08;
          const waveA = 0.5 + 0.5 * Math.sin(phaseA);
          const waveB = 0.5 + 0.5 * Math.sin(phaseB);
          const organic = fbm(
            rotatedX * 2.05 + Math.sin(morphTime * 0.21) * 1.2 + 5.6,
            rotatedY * 2.05 + Math.cos(morphTime * 0.16) * 1.1 + 2.2,
          );
          const organicMix = 0.26 + shapeBands.bass * 0.065;
          const wave = (waveA * (1 - familyBlend) + waveB * familyBlend) * (1 - organicMix)
            + organic * organicMix;
          const ridge = Math.max(0, Math.min(1, (wave - 0.22) / 0.54));
          const shaped = ridge * ridge * (3 - 2 * ridge);
          const signal = Math.pow(Math.max(0, Math.min(1, shaped * (0.88 + organic * 0.2))), 1.08);
          const radius = cell * (0.045 + signal * 0.39) * audioRadius;
          const palettePosition = Math.max(0, Math.min(1, 0.08 + signal * 0.92));
          const paletteIndex = Math.min(PALETTE_STEPS - 1, Math.round(palettePosition * (PALETTE_STEPS - 1)));
          paths[paletteIndex].moveTo(x + radius, y);
          paths[paletteIndex].arc(x, y, radius, 0, Math.PI * 2);
        }
      }

      context.globalCompositeOperation = 'lighter';
      context.globalAlpha = 0.54 + visualBands.level * 0.13 + visualBands.treble * 0.035;
      paths.forEach((path, index) => {
        context.fillStyle = dotPalette[index];
        context.fill(path);
      });
      context.globalCompositeOperation = 'source-over';
      context.globalAlpha = 1;
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [reactiveTarget]);

  return <canvas ref={canvasRef} className="atmosphere-canvas" aria-hidden="true" />;
}
