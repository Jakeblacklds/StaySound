import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import {
  createAsciify,
  type AsciifyOptions,
} from '../vendor/canvasui/AsciifyVanilla';
import {
  createBend,
  type BendOptions,
} from '../vendor/canvasui/BendVanilla';
import {
  createBlaze,
  type BlazeOptions,
} from '../vendor/canvasui/BlazeVanilla';
import {
  createBubble,
  type BubbleOptions,
} from '../vendor/canvasui/BubbleVanilla';
import {
  createCloth,
  type ClothOptions,
} from '../vendor/canvasui/ClothVanilla';
import {
  createClouds,
  type CloudsOptions,
} from '../vendor/canvasui/CloudsVanilla';
import {
  createDroplets,
  type DropletsOptions,
} from '../vendor/canvasui/DropletsVanilla';
import {
  createGlass,
  type GlassOptions,
} from '../vendor/canvasui/GlassVanilla';
import {
  createGlitch,
  type GlitchOptions,
} from '../vendor/canvasui/GlitchVanilla';
import {
  createGrid,
  type GridOptions,
} from '../vendor/canvasui/GridVanilla';
import {
  createHexFloat,
  type HexFloatOptions,
} from '../vendor/canvasui/HexFloatVanilla';
import {
  createLiquid,
  type LiquidOptions,
} from '../vendor/canvasui/LiquidVanilla';
import {
  createLaser,
  type LaserOptions,
} from '../vendor/canvasui/LaserVanilla';
import {
  createMagnify,
  type MagnifyOptions,
} from '../vendor/canvasui/MagnifyVanilla';
import {
  createParticleReveal,
  type ParticleRevealOptions,
} from '../vendor/canvasui/ParticleRevealVanilla';
import {
  createRetroDither,
  type RetroDitherOptions,
} from '../vendor/canvasui/RetroDitherVanilla';
import {
  createRipple,
  type RippleOptions,
} from '../vendor/canvasui/RippleVanilla';
import {
  createShatter,
  type ShatterOptions,
} from '../vendor/canvasui/ShatterVanilla';
import {
  createVHS,
  type VHSOptions,
} from '../vendor/canvasui/VHSVanilla';

export type CanvasUiEffectName =
  | 'asciify'
  | 'bend'
  | 'blaze'
  | 'bubble'
  | 'cloth'
  | 'clouds'
  | 'droplets'
  | 'glass'
  | 'glitch'
  | 'grid'
  | 'hex-float'
  | 'laser'
  | 'liquid'
  | 'magnify'
  | 'particle-reveal'
  | 'retro-dither'
  | 'ripple'
  | 'shatter'
  | 'vhs';

export interface CanvasUiAudioFrame {
  bass: number;
  mid: number;
  treble: number;
  level: number;
  vocal: number;
  kick: number;
  hit: number;
  glow: number;
}

export interface CanvasUiPalette {
  background: string;
  backgroundAlt: string;
  primary: string;
  secondary: string;
  accent: string;
}

interface CanvasUiEffectStageProps {
  effect: CanvasUiEffectName;
  palette: CanvasUiPalette;
  sampleAudio: () => CanvasUiAudioFrame;
  className?: string;
  contentStyle?: CSSProperties;
  contentImageUrl?: string | null;
}

type CanvasUiOptions =
  | AsciifyOptions
  | BendOptions
  | BlazeOptions
  | BubbleOptions
  | ClothOptions
  | CloudsOptions
  | DropletsOptions
  | GlassOptions
  | GlitchOptions
  | GridOptions
  | HexFloatOptions
  | LaserOptions
  | LiquidOptions
  | MagnifyOptions
  | ParticleRevealOptions
  | RetroDitherOptions
  | RippleOptions
  | ShatterOptions
  | VHSOptions
  ;

interface CanvasUiInstance {
  setOptions(options: CanvasUiOptions): void;
  resize(): void;
  destroy(): void;
}

interface CanvasUiElements {
  source: HTMLCanvasElement;
  content: HTMLElement;
  output: HTMLCanvasElement;
}

type CaptureCanvas = HTMLCanvasElement & {
  onpaint?: (() => void) | null;
  requestPaint?: () => void;
};

type CaptureContext = CanvasRenderingContext2D & {
  drawElementImage?: (element: Element, x: number, y: number) => void;
  reset?: () => void;
};

type EffectFactory = (
  elements: CanvasUiElements,
  options?: CanvasUiOptions,
) => CanvasUiInstance | null;

interface EffectSlot {
  root: HTMLDivElement;
  content: HTMLDivElement;
  effect: CanvasUiEffectName;
  instance: CanvasUiInstance;
  lastKick: number;
}

const EFFECT_FACTORIES: Record<CanvasUiEffectName, EffectFactory> = {
  asciify: createAsciify as unknown as EffectFactory,
  bend: createBend as unknown as EffectFactory,
  blaze: createBlaze as unknown as EffectFactory,
  bubble: createBubble as unknown as EffectFactory,
  cloth: createCloth as unknown as EffectFactory,
  clouds: createClouds as unknown as EffectFactory,
  droplets: createDroplets as unknown as EffectFactory,
  glass: createGlass as unknown as EffectFactory,
  glitch: createGlitch as unknown as EffectFactory,
  grid: createGrid as unknown as EffectFactory,
  'hex-float': createHexFloat as unknown as EffectFactory,
  laser: createLaser as unknown as EffectFactory,
  liquid: createLiquid as unknown as EffectFactory,
  magnify: createMagnify as unknown as EffectFactory,
  'particle-reveal': createParticleReveal as unknown as EffectFactory,
  'retro-dither': createRetroDither as unknown as EffectFactory,
  ripple: createRipple as unknown as EffectFactory,
  shatter: createShatter as unknown as EffectFactory,
  vhs: createVHS as unknown as EffectFactory,
};

const POINTER_DRIVEN_EFFECTS = new Set<CanvasUiEffectName>([
  'asciify',
  'bend',
  'bubble',
  'cloth',
  'clouds',
  'droplets',
  'glass',
  'grid',
  'hex-float',
  'liquid',
  'magnify',
  'particle-reveal',
  'retro-dither',
  'ripple',
  'shatter',
]);

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '').trim();
  const expanded = normalized.length === 3
    ? normalized.split('').map(character => character + character).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  const value = Number.parseInt(expanded, 16);
  if (!Number.isFinite(value)) return [1, 1, 1];
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

function interpolateColor(
  left: [number, number, number],
  right: [number, number, number],
  amount: number,
): [number, number, number] {
  return left.map((value, index) => (
    value + (right[index] - value) * amount
  )) as [number, number, number];
}

/**
 * WKWebView does not expose CanvasUI's experimental drawElementImage API.
 * For artwork stages we only need to capture one normal album image, so this
 * fallback paints it into CanvasUI's source canvas and lets the original
 * shaders consume a real texture instead of their transparent placeholder.
 */
function installArtworkCaptureFallback(
  source: HTMLCanvasElement,
  content: HTMLElement,
): () => void {
  const image = content.querySelector<HTMLImageElement>('[data-canvasui-image]');
  const context = source.getContext('2d') as CaptureContext | null;
  const paintable = source as CaptureCanvas;
  const slot = content.closest('.canvasui-effect-slot');
  if (
    !image
    || !context
    || (
      typeof context.drawElementImage === 'function'
      && typeof paintable.requestPaint === 'function'
    )
  ) return () => undefined;

  let paintFrame = 0;
  if (typeof context.reset !== 'function') {
    context.reset = () => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, source.width, source.height);
    };
  }
  context.drawElementImage = () => {
    const width = Math.max(1, source.width);
    const height = Math.max(1, source.height);
    context.clearRect(0, 0, width, height);
    if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) return;
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.drawImage(
      image,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
    try {
      // A cross-origin image can draw successfully but taint the canvas. Only
      // allow opaque shader replacement after proving the texture is readable.
      context.getImageData(0, 0, 1, 1);
      slot?.classList.add('has-image-texture');
    } catch {
      slot?.classList.remove('has-image-texture');
    }
  };
  paintable.requestPaint = () => {
    window.cancelAnimationFrame(paintFrame);
    paintFrame = window.requestAnimationFrame(() => paintable.onpaint?.());
  };
  const repaint = () => paintable.requestPaint?.();
  image.addEventListener('load', repaint);

  return () => {
    window.cancelAnimationFrame(paintFrame);
    image.removeEventListener('load', repaint);
    slot?.classList.remove('has-image-texture');
    paintable.onpaint = null;
  };
}

function effectOptions(
  effect: CanvasUiEffectName,
  audio: CanvasUiAudioFrame,
  palette: CanvasUiPalette,
): CanvasUiOptions {
  const primary = hexToRgb(palette.primary);
  const secondary = hexToRgb(palette.secondary);
  const accent = hexToRgb(palette.accent);

  switch (effect) {
    case 'asciify':
      return {
        radius: 0.48 + audio.bass * 0.22,
        softness: 0.72,
        scale: 2.2 + audio.treble * 1.5,
        spacing: 1,
        charset: audio.treble > 0.56 ? 'binary' : 'ascii',
        background: hexToRgb(palette.background),
        backgroundOpacity: 0.18 + audio.bass * 0.2,
        contrast: 0.86 + audio.level * 0.55,
        brightness: -0.04 + audio.glow * 0.08,
        invert: 0,
        strength: 0.58 + audio.level * 0.36,
        baseStrength: 0.1 + audio.level * 0.2,
        followSpeed: 1.4 + audio.mid * 2.4,
      } satisfies AsciifyOptions;
    case 'bend':
      return {
        zone: 190 + audio.bass * 150,
        angle: 18 + audio.bass * 30,
        rounding: 120 + audio.mid * 150,
        perspective: 1_150 + audio.level * 550,
        direction: 'in',
        ease: 520,
        smoothing: 0.34,
        top: true,
        bottom: true,
        tumble: 0.08 + audio.kick * 0.28,
        tilt: 0.24 + audio.mid * 0.52,
      } satisfies BendOptions;
    case 'bubble':
      return {
        size: 24 + audio.bass * 34,
        trail: 18 + Math.round(audio.treble * 6),
        follow: 0.2 + audio.mid * 0.34,
        blend: 9 + audio.level * 13,
        speed: 0.7 + audio.mid * 1.8,
        refraction: 38 + audio.bass * 80,
        dispersion: 0.35 + audio.treble * 1.15,
        frost: audio.vocal * 0.18,
        shine: 0.24 + audio.treble * 0.46,
        rim: 0.38 + audio.glow * 0.5,
        iridescence: 0.7 + audio.treble * 1.2,
        intensity: 0.58 + audio.level * 0.55,
        tint: primary,
        tintStrength: 0.18 + audio.glow * 0.32,
        colorA: primary,
        colorB: secondary,
        fallbackOpacity: 0.86,
      } satisfies BubbleOptions;
    case 'cloth':
      return {
        pin: 'top',
        wind: 1.3 + audio.mid * 4.8,
        speed: 0.28 + audio.mid * 0.82,
        amplitude: 18 + audio.bass * 46,
        drape: 26 + audio.bass * 52,
        brush: 0.55 + audio.hit * 1.8,
        brushSize: 180 + audio.bass * 160,
        damping: 1.25 - audio.mid * 0.5,
        light: 0.38 + audio.glow * 0.45,
        sheen: 0.12 + audio.treble * 0.42,
        shadow: 0.18 + audio.bass * 0.22,
        cornerRadius: 0,
        backing: hexToRgb(palette.background),
        perspective: 1_350,
      } satisfies ClothOptions;
    case 'clouds':
      return {
        scale: 1.05 - audio.bass * 0.14,
        speed: 0.24 + audio.mid * 0.72,
        cover: 0.12 + audio.vocal * 0.18,
        density: 1.9 + audio.bass * 1.8,
        shading: 0.08 + audio.treble * 0.16,
        color: interpolateColor(primary, secondary, audio.glow),
        opacity: 0.36 + audio.level * 0.38,
        shadow: 0.04 + audio.bass * 0.13,
        wind: 0.18 + audio.mid * 1.4,
        refraction: audio.hit * 0.16,
        fogBlur: 0.2 + audio.level * 0.65,
        quality: 0.72,
      } satisfies CloudsOptions;
    case 'liquid':
      return {
        densityDissipation: 0.945 + audio.mid * 0.035,
        velocityDissipation: 0.975 + audio.bass * 0.02,
        pressure: 0.72 + audio.bass * 0.24,
        curl: 1.4 + audio.mid * 9,
        radius: 0.18 + audio.bass * 0.22,
        force: 0.62 + audio.bass * 2.8,
        intensity: 0.7 + audio.level * 2.4,
        distortion: 0.12 + audio.kick * 0.42,
        blend: 2.4 + audio.vocal * 2.8,
        color: interpolateColor(primary, secondary, audio.treble),
        rainbow: false,
      } satisfies LiquidOptions;
    case 'blaze':
      return {
        height: 0.72 + audio.bass * 0.24,
        distortion: 0.18 + audio.mid * 0.7,
        distortionScale: 0.34 + audio.treble * 0.48,
        speed: 0.46 + audio.mid * 1.35,
        sparks: 0.18 + audio.treble * 1.25,
        sparkDensity: 1.25 + audio.treble * 2.2,
        sparkSize: 0.65 + audio.glow * 1.1,
        layers: 4,
        smoke: 0.18 + audio.mid * 0.72,
        glow: 0.5 + audio.kick * 2.3 + audio.bass * 0.7,
        sparkColor: accent,
        smokeColor: interpolateColor(primary, accent, 0.62),
      } satisfies BlazeOptions;
    case 'grid':
      return {
        tileSize: 112,
        gap: 3,
        cornerRadius: 12,
        amplitude: 0.7 + audio.bass * 3.6,
        waveSpeed: 0.34 + audio.mid * 0.68,
        frequency: 8 + audio.treble * 12,
        waveWidth: 0.05 + audio.kick * 0.09,
        fadeTime: 0.35 + audio.level * 0.5,
        maxLift: 0.45 + audio.bass * 0.55,
        jitter: 0.06 + audio.treble * 0.28,
        liftHeight: 28 + audio.bass * 78,
        perspective: 1_100,
        tilt: 0.28 + audio.mid * 0.5,
        shading: 0.14 + audio.level * 0.32,
        tint: interpolateColor(primary, secondary, audio.glow),
        tintStrength: 0.28 + audio.level * 0.55,
        idleRipples: 2.4,
      } satisfies GridOptions;
    case 'droplets':
      return {
        intensity: 0.36 + audio.treble * 0.56,
        speed: 0.42 + audio.mid * 0.86,
        scale: 0.44 + audio.bass * 0.22,
        dropWidth: 0.8 + audio.treble * 0.74,
        dropLength: 0.9 + audio.mid * 1.15,
        refraction: 0.16 + audio.kick * 0.42,
        blur: 0.08 + audio.vocal * 0.26,
        vignette: 0.34,
        fallSpeed: 0.48 + audio.mid * 1.5,
        wiggle: 0.45 + audio.treble * 1.4,
        staticDrops: 0.24 + audio.treble * 0.46,
        interactive: true,
        interactionRadius: 0.24 + audio.bass * 0.12,
        interactionStrength: 0.46 + audio.level * 0.34,
        interactionDistortion: 1.2 + audio.kick * 3.2,
        tint: interpolateColor(primary, secondary, audio.glow),
        tintStrength: 0.18 + audio.level * 0.34,
      } satisfies DropletsOptions;
    case 'glass':
      return {
        shape: 'circle',
        size: 190 + audio.bass * 130,
        aspect: 1.7,
        corner: 54,
        ior: 1.28 + audio.bass * 0.28,
        edge: 0.62,
        bevel: 3 + audio.treble * 4,
        depth: 160 + audio.bass * 220,
        aberration: 0.45 + audio.treble * 1.8,
        blur: audio.vocal * 0.9,
        reflection: 0.5 + audio.glow * 0.85,
        shine: 0.18 + audio.treble * 0.55,
        zoom: 1.08 + audio.level * 0.38,
        targets: '[data-canvasui-content]',
        follow: 0.1 + audio.mid * 0.16,
      } satisfies GlassOptions;
    case 'glitch':
      return {
        intensity: 0.62 + audio.hit * 1.05 + audio.treble * 0.4,
        interval: 1.4 - audio.level * 0.5,
        duration: 0.48 + audio.hit * 0.3,
        slices: 30 - Math.round(audio.bass * 12),
        shift: 10 + audio.kick * 42,
        rgbShift: 1.2 + audio.treble * 5.4,
        blocks: 0.16 + audio.hit * 0.62,
        noise: 0.08 + audio.treble * 0.38,
      } satisfies GlitchOptions;
    case 'laser':
      return {
        speed: 0.22 + audio.mid * 0.72,
        offset: 120 + audio.bass * 90,
        color: interpolateColor(primary, accent, audio.glow),
        thickness: 2 + audio.kick * 7,
        core: 0.72 + audio.hit * 0.8,
        radius: 22 + audio.bass * 54,
        glow: 0.9 + audio.level * 1.8,
        wave: 4 + audio.mid * 22,
        width: 0.48 + audio.vocal * 0.34,
        flicker: 0.08 + audio.treble * 0.42,
        reveal: 240 + audio.level * 260,
        heat: 0.32 + audio.kick * 0.85,
        shimmer: 3 + audio.treble * 16,
        sparkle: 0.08 + audio.treble * 1.1,
        reactivity: 0.45 + audio.bass * 1.5,
      } satisfies LaserOptions;
    case 'hex-float':
      return {
        size: 116 + audio.bass * 82,
        gap: 1.5 + audio.treble * 2.5,
        bevel: 1.1 + audio.glow * 1.8,
        tilt: 12 + audio.mid * 16,
        perspective: 0.38 + audio.bass * 0.28,
        float: 0.12 + audio.bass * 0.48,
        speed: 0.36 + audio.mid * 0.9,
        shine: 0.28 + audio.treble * 0.8,
        lift: 0.12 + audio.kick * 0.5,
        radius: 520 + audio.bass * 520,
        flow: 0.35 + audio.mid * 1.4,
        swirl: 1.2 + audio.mid * 6.5,
        trail: 0.28 + audio.level * 0.42,
        iridescence: 0.45 + audio.treble * 1.2,
        bloom: 0.12 + audio.glow * 0.42,
        grain: 0.08 + audio.treble * 0.18,
        gapColor: hexToRgb(palette.background),
      } satisfies HexFloatOptions;
    case 'magnify':
      return {
        size: 150 + audio.bass * 120,
        zoom: 1.08 + audio.level * 0.62,
        color: accent,
        follow: 0.1 + audio.mid * 0.18,
        hud: 0.25 + audio.treble * 0.48,
        ring: true,
        crosshair: false,
        ticks: true,
        brackets: false,
        dot: true,
        grid: audio.treble > 0.5,
        readout: false,
        aberration: 0.25 + audio.treble * 1.3,
        haze: 0.08 + audio.vocal * 0.3,
        ripples: true,
        rippleSpeed: 560 + audio.mid * 480,
        rippleWidth: 1.5 + audio.treble * 2,
        rippleBendWidth: 90 + audio.bass * 80,
        rippleBend: 8 + audio.kick * 28,
        rippleGlow: 0.35 + audio.glow * 0.9,
        rippleLife: 1.15,
      } satisfies MagnifyOptions;
    case 'particle-reveal':
      return {
        radius: 380 + audio.bass * 360,
        softness: 0.65 + audio.mid * 0.2,
        size: 1.2 + audio.treble * 1.5,
        scatter: 18 + audio.treble * 58,
        drift: 0.28 + audio.mid * 1.15,
        aberration: 8 + audio.treble * 32,
        bend: 16 + audio.bass * 54,
        fade: 0.58 + audio.level * 0.3,
        threshold: 0.06,
        background: palette.background,
        smoothing: 0.42,
      } satisfies ParticleRevealOptions;
    case 'retro-dither':
      return {
        radius: 0.48 + audio.bass * 0.2,
        softness: 0.7,
        pixelSize: 1.5 + audio.treble * 2.4,
        levels: 4 + Math.round(audio.level * 3),
        darkColor: hexToRgb(palette.background),
        lightColor: interpolateColor(primary, secondary, audio.glow),
        colorize: 0.58 + audio.glow * 0.32,
        contrast: 0.55 + audio.level * 0.55,
        brightness: -0.04 + audio.glow * 0.08,
        strength: 0.48 + audio.level * 0.38,
        baseStrength: 0.08 + audio.level * 0.2,
        invert: 0,
        scanlines: 0.05 + audio.treble * 0.24,
        followSpeed: 1.25 + audio.mid * 2,
      } satisfies RetroDitherOptions;
    case 'ripple':
      return {
        amplitude: 0.26 + audio.bass * 1.15,
        speed: 0.38 + audio.mid * 0.62,
        wavelength: 90 - audio.treble * 38,
        rings: 2 + Math.round(audio.level * 2),
        decay: 1.15 - audio.level * 0.38,
        refraction: 34 + audio.bass * 92,
        dispersion: 0.12 + audio.treble * 0.5,
        shine: 0.22 + audio.glow * 0.72,
        trigger: 'hover',
        interval: 1.8 - audio.level * 0.8,
      } satisfies RippleOptions;
    case 'shatter':
      return {
        radius: 0.42 + audio.bass * 0.18,
        softness: 0.74,
        tileSize: 92 + audio.bass * 70,
        shards: 0.72 + audio.treble * 0.28,
        corner: 2,
        lift: 10 + audio.bass * 38,
        tilt: 0.65 + audio.mid * 1.5,
        scatter: 2 + audio.kick * 16,
        perspective: 1_650,
        gapColor: hexToRgb(palette.background),
        shadow: 0.2 + audio.bass * 0.34,
        shading: 0.26 + audio.glow * 0.5,
        refraction: 0.4 + audio.level * 0.9,
        dispersion: 0.08 + audio.treble * 0.42,
        floatSpeed: 0.42 + audio.mid * 1.05,
        strength: 0.42 + audio.level * 0.48,
        baseStrength: 0.05 + audio.bass * 0.16,
        followSpeed: 1.4 + audio.mid * 1.8,
      } satisfies ShatterOptions;
    case 'vhs':
      return {
        speed: 0.42 + audio.mid * 0.82,
        wave: 0.48 + audio.bass * 0.9,
        jitter: 0.14 + audio.treble * 0.52,
        crease: 0.09 + audio.hit * 0.42,
        switching: 0.02 + audio.kick * 0.22,
        switchingHeight: 0.018 + audio.bass * 0.016,
        bloom: 0.16 + audio.glow * 0.44,
        aberration: 0.7 + audio.treble * 3.8,
        acBeat: 0.25 + audio.bass * 0.7,
        grain: 0.07 + audio.treble * 0.2,
        scanlines: 0.07 + audio.treble * 0.16,
        vignette: 0.12,
        barrel: 0.05 + audio.bass * 0.08,
        saturation: 0.9 + audio.glow * 0.3,
        exposure: 0.94 + audio.level * 0.14,
      } satisfies VHSOptions;
  }
}

function initialOptions(
  effect: CanvasUiEffectName,
  palette: CanvasUiPalette,
): CanvasUiOptions {
  return effectOptions(effect, {
    bass: 0.2,
    mid: 0.2,
    treble: 0.16,
    level: 0.2,
    vocal: 0,
    kick: 0,
    hit: 0,
    glow: 0,
  }, palette);
}

function dispatchSyntheticPointer(
  slot: EffectSlot,
  time: number,
  audio: CanvasUiAudioFrame,
): void {
  if (!POINTER_DRIVEN_EFFECTS.has(slot.effect)) return;
  const rect = slot.content.getBoundingClientRect();
  const x = rect.left + rect.width * (
    0.5 + Math.sin(time * 0.00032) * (0.26 + audio.bass * 0.12)
  );
  const y = rect.top + rect.height * (
    0.52 + Math.cos(time * 0.00041) * (0.18 + audio.mid * 0.1)
  );
  slot.content.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: 'mouse',
  }));
}

function makeEffectSlot(
  root: HTMLDivElement,
  effect: CanvasUiEffectName,
  palette: CanvasUiPalette,
  onContextLost?: () => void,
): EffectSlot | null {
  const source = root.querySelector<HTMLCanvasElement>('[data-canvasui-source]');
  const content = root.querySelector<HTMLDivElement>('[data-canvasui-content]');
  const output = root.querySelector<HTMLCanvasElement>('[data-canvasui-output]');
  if (!source || !content || !output) return null;
  const cleanupCapture = installArtworkCaptureFallback(source, content);
  const instance = EFFECT_FACTORIES[effect](
    { source, content, output },
    initialOptions(effect, palette),
  );
  if (!instance) {
    cleanupCapture();
    return null;
  }
  // None of the CanvasUI effects handle a lost GL context: WebKit takes the
  // context back under GPU pressure and the effect stays frozen on its last
  // frame until the next section change swaps slots. preventDefault() asks the
  // browser to restore, and the stage rebuilds this slot on a fresh canvas.
  const handleContextLost = (event: Event) => {
    event.preventDefault();
    onContextLost?.();
  };
  output.addEventListener('webglcontextlost', handleContextLost);
  const destroyInstance = instance.destroy.bind(instance);
  instance.destroy = () => {
    output.removeEventListener('webglcontextlost', handleContextLost);
    cleanupCapture();
    destroyInstance();
  };
  return { root, content, effect, instance, lastKick: 0 };
}

export function CanvasUiEffectStage({
  effect,
  palette,
  sampleAudio,
  className,
  contentStyle,
  contentImageUrl,
}: CanvasUiEffectStageProps) {
  const rootsRef = useRef<Array<HTMLDivElement | null>>([]);
  const slotsRef = useRef<Array<EffectSlot | null>>([null, null]);
  const activeIndexRef = useRef(0);
  // Bumping this re-keys the slots so React hands the effects brand new
  // canvases: a canvas whose context was lost keeps handing back that same
  // dead context, so the element itself has to be replaced.
  const [glEpoch, setGlEpoch] = useState(0);
  const glRecoveryRef = useRef({ attempts: 0, lastLostAt: 0, timer: 0 });
  const transitionTimerRef = useRef(0);
  const audioFrameRef = useRef(0);
  const effectRef = useRef(effect);
  const paletteRef = useRef(palette);
  const sampleAudioRef = useRef(sampleAudio);

  paletteRef.current = palette;
  sampleAudioRef.current = sampleAudio;

  const requestGlRebuild = useCallback(() => {
    const recovery = glRecoveryRef.current;
    if (recovery.timer) return;
    // A context that dies again straight after a rebuild means the GPU is
    // still under pressure, so each loss inside five seconds of the last one
    // backs the retry off instead of spinning.
    const now = performance.now();
    recovery.attempts = now - recovery.lastLostAt < 5_000 ? recovery.attempts + 1 : 0;
    recovery.lastLostAt = now;
    const delay = Math.min(1_500, 120 * Math.pow(3, recovery.attempts));
    recovery.timer = window.setTimeout(() => {
      recovery.timer = 0;
      setGlEpoch(epoch => epoch + 1);
    }, delay);
  }, []);

  useEffect(() => () => {
    if (glRecoveryRef.current.timer) window.clearTimeout(glRecoveryRef.current.timer);
  }, []);

  useEffect(() => {
    const root = rootsRef.current[0];
    if (!root) return;
    const slot = makeEffectSlot(root, effectRef.current, paletteRef.current, requestGlRebuild);
    if (!slot) return;
    slotsRef.current[0] = slot;
    // A rebuild restarts from slot 0, so the other slot must not stay lit.
    activeIndexRef.current = 0;
    rootsRef.current[1]?.classList.remove('is-active');
    root.classList.add('is-active');
    let previousOptionsUpdate = 0;

    const tick = (time: number) => {
      audioFrameRef.current = window.requestAnimationFrame(tick);
      if (time - previousOptionsUpdate < 32) return;
      previousOptionsUpdate = time;
      const audio = sampleAudioRef.current();
      for (const liveSlot of slotsRef.current) {
        if (!liveSlot) continue;
        liveSlot.instance.setOptions(
          effectOptions(liveSlot.effect, audio, paletteRef.current),
        );
        dispatchSyntheticPointer(liveSlot, time, audio);
        if (audio.kick > 0.72 && liveSlot.lastKick <= 0.72) {
          const rect = liveSlot.content.getBoundingClientRect();
          liveSlot.content.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true,
            clientX: rect.left + rect.width * 0.5,
            clientY: rect.top + rect.height * 0.52,
            pointerId: 1,
            pointerType: 'mouse',
          }));
        }
        liveSlot.lastKick = audio.kick;
      }
    };
    audioFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(audioFrameRef.current);
      window.clearTimeout(transitionTimerRef.current);
      for (const liveSlot of slotsRef.current) liveSlot?.instance.destroy();
      slotsRef.current = [null, null];
    };
  }, [glEpoch, requestGlRebuild]);

  useEffect(() => {
    if (effectRef.current === effect) return;
    effectRef.current = effect;
    const previousIndex = activeIndexRef.current;
    const nextIndex = previousIndex === 0 ? 1 : 0;
    const nextRoot = rootsRef.current[nextIndex];
    const previousSlot = slotsRef.current[previousIndex];
    if (!nextRoot) return;

    slotsRef.current[nextIndex]?.instance.destroy();
    const nextSlot = makeEffectSlot(nextRoot, effect, paletteRef.current, requestGlRebuild);
    if (!nextSlot) return;
    slotsRef.current[nextIndex] = nextSlot;
    activeIndexRef.current = nextIndex;

    nextRoot.classList.remove('is-active');
    void nextRoot.offsetWidth;
    window.requestAnimationFrame(() => {
      nextRoot.classList.add('is-active');
      previousSlot?.root.classList.remove('is-active');
    });

    window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = window.setTimeout(() => {
      previousSlot?.instance.destroy();
      if (slotsRef.current[previousIndex] === previousSlot) {
        slotsRef.current[previousIndex] = null;
      }
    }, 1_300);
  }, [effect]);

  return (
    <div className={['canvasui-effect-stage', className].filter(Boolean).join(' ')}>
      {[0, 1].map(index => (
        <div
          className="canvasui-effect-slot"
          key={`${index}-${glEpoch}`}
          ref={node => {
            rootsRef.current[index] = node;
          }}
        >
          <canvas data-canvasui-source aria-hidden="true" />
          <div
            data-canvasui-content
            aria-hidden="true"
            style={{
              background: `
                radial-gradient(circle at 22% 18%, ${palette.primary}44, transparent 38%),
                radial-gradient(circle at 78% 72%, ${palette.secondary}3d, transparent 42%),
                linear-gradient(145deg, ${palette.background}, ${palette.backgroundAlt})
              `,
              ...contentStyle,
            }}
          >
            {contentImageUrl ? (
              <img
                data-canvasui-image
                src={contentImageUrl}
                alt=""
                draggable={false}
              />
            ) : null}
          </div>
          <canvas data-canvasui-output aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
