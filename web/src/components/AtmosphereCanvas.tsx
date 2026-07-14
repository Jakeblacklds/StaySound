import { RefObject, useEffect, useRef } from 'react';
import { spectrumEngine, type SpectrumBands } from '../audio/spectrumEngine';
import type { WebDynamicPalette } from '../library/dynamicColors';

interface AtmosphereCanvasProps {
  palette: WebDynamicPalette | null;
  isPlaying: boolean;
  motionKey?: string | null;
  /** Element that receives live --atmo-bass/--atmo-mid/--atmo-treble vars */
  reactiveTarget?: RefObject<HTMLElement | null>;
}

interface OrbConfig {
  /** Base position as fraction of viewport */
  x: number;
  y: number;
  /** Drift amplitude as fraction of viewport */
  ampX: number;
  ampY: number;
  /** Drift angular speeds (rad/ms), mirrors the Android orb cycles */
  speedX: number;
  speedY: number;
  phaseX: number;
  phaseY: number;
  /** Radius as fraction of viewport height */
  radius: number;
  alpha: number;
  /** Which band drives this orb's pulse */
  band: 'bass' | 'mid' | 'treble';
}

const ORBS: OrbConfig[] = [
  { x: 0.32, y: 0.3, ampX: 0.16, ampY: 0.12, speedX: 0.000285, speedY: 0.00022, phaseX: 0, phaseY: 0, radius: 0.72, alpha: 0.62, band: 'bass' },
  { x: 0.74, y: 0.68, ampX: 0.18, ampY: 0.14, speedX: 0.00037, speedY: 0.00029, phaseX: 1.1, phaseY: 2.2, radius: 0.58, alpha: 0.5, band: 'mid' },
  { x: 0.2, y: 0.78, ampX: 0.16, ampY: 0.13, speedX: 0.00023, speedY: 0.00019, phaseX: 3.3, phaseY: 0.7, radius: 0.42, alpha: 0.3, band: 'treble' },
];

/** Blob count of the mid-band aurora ribbon */
const RIBBON_SEGMENTS = 6;

interface Spark {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  size: number;
}

/** Soft shockwave emitted from the bass orb on every detected beat */
interface Ripple {
  born: number;
  x: number;
  y: number;
  strength: number;
}

const ZERO_BANDS: SpectrumBands = { bass: 0, mid: 0, treble: 0, level: 0 };
const RIPPLE_LIFE_MS = 1150;

function hexToRgbTuple(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function followVisual(current: number, target: number, dt: number, attack = 0.075, release = 0.035): number {
  const rate = target > current ? attack : release;
  const blend = 1 - Math.pow(1 - rate, dt);
  return current + (target - current) * blend;
}

function compressBand(value: number, amount = 0.82, ceiling = 0.86): number {
  return Math.min(ceiling, Math.pow(Math.max(0, value), amount));
}

/**
 * Canvas port of the Android KaraokeAmbientBackgroundRenderer with a legible
 * per-band language: bass beats punch the main orb and emit soft shockwave
 * ripples, mids light and undulate a flowing aurora ribbon (and speed up the
 * orb drift), treble scatters short glitter sparks across the upper field.
 * Rendered at reduced resolution and blurred via CSS for the soft look.
 */
export function AtmosphereCanvas({ palette, isPlaying, motionKey, reactiveTarget }: AtmosphereCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef(palette);
  const playingRef = useRef(isPlaying);
  const motionKeyRef = useRef(motionKey);
  const sparksRef = useRef<Spark[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);

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
    let previousFrameTime = performance.now();
    let visualBands = { ...ZERO_BANDS };
    let activeMotionKey = motionKeyRef.current;
    // Accumulated drift phase in ms. Advanced per-frame so the mid-band only
    // modulates drift *velocity*; scaling absolute time would teleport the
    // orbs whenever the band energy shifts (worse the longer the session).
    let flowTime = 0;
    // Bass onset detector: a fast follower compared against a slow baseline,
    // edge-triggered on their difference so sustained bass (pads, basslines)
    // never retriggers. `audibleMs` gates a warm-up after silence/pauses so
    // resuming playback doesn't burst-fire ripples. A beat kicks `beatPunch`
    // (decays each frame) and, when strong, spawns a ripple from the bass orb.
    let bassFast = 0;
    let bassSlow = 0;
    let onsetArmed = true;
    let audibleMs = 0;
    let lastBeatTime = 0;
    let beatPunch = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // Quarter resolution: gradients stay soft and the CSS blur hides banding.
      width = Math.max(160, Math.round(rect.width / 4));
      height = Math.max(120, Math.round(rect.height / 4));
      canvas.width = width;
      canvas.height = height;
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = (time: number) => {
      rafId = requestAnimationFrame(draw);
      const currentPalette = paletteRef.current;
      if (!currentPalette || width === 0) return;

      if (activeMotionKey !== motionKeyRef.current) {
        activeMotionKey = motionKeyRef.current;
        visualBands = { ...ZERO_BANDS };
        sparksRef.current = [];
        ripplesRef.current = [];
        bassFast = 0;
        bassSlow = 0;
        audibleMs = 0;
        onsetArmed = true;
        beatPunch = 0;
      }

      const debugBands = import.meta.env.DEV
        ? (window as Window & { __atmoDebugBands?: SpectrumBands | null }).__atmoDebugBands ?? null
        : null;
      const sampledBands = debugBands ?? (playingRef.current && !reduceMotion
        ? spectrumEngine.sample()
        : ZERO_BANDS);
      const rawBands = {
        bass: compressBand(sampledBands.bass, 0.74, 0.94),
        mid: compressBand(sampledBands.mid, 0.84),
        treble: compressBand(sampledBands.treble, 1.05, 0.62),
        level: compressBand(sampledBands.level, 0.84),
      };
      const frameMs = Math.min(58.4, Math.max(8.35, time - previousFrameTime || 16.7));
      const dt = frameMs / 16.7;
      previousFrameTime = time;
      flowTime += frameMs * (1 + visualBands.mid * 0.55);
      visualBands = {
        bass: followVisual(visualBands.bass, rawBands.bass, dt, 0.17, 0.052),
        mid: followVisual(visualBands.mid, rawBands.mid, dt, 0.11, 0.04),
        treble: followVisual(visualBands.treble, rawBands.treble, dt, 0.13, 0.055),
        level: followVisual(visualBands.level, rawBands.level, dt),
      };

      // Onset detection on the uncompressed bass band.
      const bassSignal = sampledBands.bass;
      bassFast = followVisual(bassFast, bassSignal, dt, 0.5, 0.28);
      bassSlow = followVisual(bassSlow, bassSignal, dt, 0.045, 0.045);
      audibleMs = bassFast < 0.06 ? 0 : audibleMs + frameMs;
      const onset = bassFast - bassSlow;
      if (onset < 0.045) onsetArmed = true;
      const ripples = ripplesRef.current;
      if (
        !reduceMotion &&
        onsetArmed &&
        onset > 0.075 &&
        bassFast > 0.3 &&
        audibleMs > 650 &&
        time - lastBeatTime > 320
      ) {
        onsetArmed = false;
        lastBeatTime = time;
        beatPunch = Math.min(1, 0.3 + onset * 2.2);
        if (beatPunch > 0.45 && ripples.length < 2) {
          ripples.push({ born: time, x: 0, y: 0, strength: beatPunch });
        }
      }
      beatPunch *= Math.pow(0.925, dt);

      // Expose live band energies as CSS vars (artwork pulse, glow, etc.).
      const target = reactiveTarget?.current;
      if (target) {
        target.style.setProperty('--atmo-bass', rawBands.bass.toFixed(3));
        target.style.setProperty('--atmo-mid', rawBands.mid.toFixed(3));
        target.style.setProperty('--atmo-treble', rawBands.treble.toFixed(3));
        target.style.setProperty('--atmo-bass-smooth', visualBands.bass.toFixed(3));
        target.style.setProperty('--atmo-mid-smooth', visualBands.mid.toFixed(3));
        target.style.setProperty('--atmo-treble-smooth', visualBands.treble.toFixed(3));
        target.style.setProperty('--atmo-beat', beatPunch.toFixed(3));
      }

      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';

      const colors = [currentPalette.primary, currentPalette.secondary, currentPalette.accent]
        .map(hexToRgbTuple);
      const driftTime = flowTime;
      let bassOrbX = width * ORBS[0].x;
      let bassOrbY = height * ORBS[0].y;

      for (let index = 0; index < ORBS.length; index += 1) {
        const orb = ORBS[index];
        const [r, g, b] = colors[index % colors.length];
        const energy = orb.band === 'treble'
          ? visualBands.treble * 0.5 + visualBands.level * 0.12
          : visualBands[orb.band];
        const punch = orb.band === 'bass' ? beatPunch : 0;

        const cx = (orb.x + orb.ampX * Math.sin(driftTime * orb.speedX + orb.phaseX)) * width;
        const cy = (orb.y + orb.ampY * Math.cos(driftTime * orb.speedY + orb.phaseY)) * height;
        if (orb.band === 'bass') {
          bassOrbX = cx;
          bassOrbY = cy;
        }
        const radius = orb.radius * height * (1 + energy * 0.3 + punch * 0.1 + visualBands.level * 0.06);
        const alpha = orb.alpha * (0.34 + energy * 0.6 + punch * 0.12);

        const gradientFill = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradientFill.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha)})`);
        gradientFill.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha * 0.35)})`);
        gradientFill.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = gradientFill;
        context.beginPath();
        context.arc(cx, cy, radius, 0, Math.PI * 2);
        context.fill();
      }

      // Bass shockwaves: soft annular waves expanding from the bass orb.
      const [br, bg, bb] = colors[0];
      for (let index = ripples.length - 1; index >= 0; index -= 1) {
        const ripple = ripples[index];
        if (ripple.x === 0 && ripple.y === 0) {
          ripple.x = bassOrbX;
          ripple.y = bassOrbY;
        }
        const age = (time - ripple.born) / RIPPLE_LIFE_MS;
        if (age >= 1) {
          ripples.splice(index, 1);
          continue;
        }
        const radius = (0.2 + age * 1.05) * height;
        const fade = (1 - age) * (1 - age) * 0.22 * ripple.strength;
        const wave = context.createRadialGradient(ripple.x, ripple.y, radius * 0.66, ripple.x, ripple.y, radius);
        wave.addColorStop(0, 'rgba(0, 0, 0, 0)');
        wave.addColorStop(0.72, `rgba(${br}, ${bg}, ${bb}, ${fade})`);
        wave.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = wave;
        context.beginPath();
        context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        context.fill();
      }

      // Mid aurora ribbon: a flowing band across the lower field that lights
      // up and undulates harder as the mids push.
      const ribbonEnergy = visualBands.mid;
      if (ribbonEnergy > 0.03) {
        const [mr, mg, mb] = colors[1];
        const ribbonRadius = height * (0.19 + ribbonEnergy * 0.13);
        const ribbonAlpha = Math.min(0.5, 0.05 + ribbonEnergy * 0.5);
        for (let index = 0; index <= RIBBON_SEGMENTS; index += 1) {
          const t = index / RIBBON_SEGMENTS;
          const x = (t * 1.24 - 0.12) * width;
          const y = height * (
            0.62 +
            Math.sin(flowTime * 0.00042 + t * Math.PI * 2.3) * (0.05 + ribbonEnergy * 0.09) +
            Math.sin(flowTime * 0.00019 + t * Math.PI * 4.7) * 0.025
          );
          const blob = context.createRadialGradient(x, y, 0, x, y, ribbonRadius);
          blob.addColorStop(0, `rgba(${mr}, ${mg}, ${mb}, ${ribbonAlpha})`);
          blob.addColorStop(0.6, `rgba(${mr}, ${mg}, ${mb}, ${ribbonAlpha * 0.3})`);
          blob.addColorStop(1, 'rgba(0, 0, 0, 0)');
          context.fillStyle = blob;
          context.beginPath();
          context.arc(x, y, ribbonRadius, 0, Math.PI * 2);
          context.fill();
        }
      }

      // Treble glitter: short-lived glints scattered across the upper field.
      const sparks = sparksRef.current;
      if (visualBands.treble > 0.1 && sparks.length < 12 && Math.random() < visualBands.treble * 0.3) {
        sparks.push({
          x: Math.random() * width,
          y: Math.random() * height * 0.62,
          life: 0,
          maxLife: 26 + Math.random() * 40,
          size: (1.4 + Math.random() * 2.4) * (0.7 + visualBands.treble),
        });
      }

      const [ar, ag, ab] = colors[2];
      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index];
        spark.life += dt;
        if (spark.life >= spark.maxLife) {
          sparks.splice(index, 1);
          continue;
        }
        const progress = spark.life / spark.maxLife;
        const fade = Math.sin(progress * Math.PI) * (0.4 + visualBands.treble * 0.5);
        const sparkGradient = context.createRadialGradient(
          spark.x, spark.y, 0,
          spark.x, spark.y, spark.size * 4,
        );
        sparkGradient.addColorStop(0, `rgba(255, 255, 255, ${0.32 * fade})`);
        sparkGradient.addColorStop(0.4, `rgba(${ar}, ${ag}, ${ab}, ${0.26 * fade})`);
        sparkGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = sparkGradient;
        context.beginPath();
        context.arc(spark.x, spark.y, spark.size * 4, 0, Math.PI * 2);
        context.fill();
      }

      context.globalCompositeOperation = 'source-over';
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [reactiveTarget]);

  return <canvas ref={canvasRef} className="atmosphere-canvas" aria-hidden="true" />;
}
