import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';
import { spectrumEngine } from '../audio/spectrumEngine';
import {
  CanvasUiEffectStage,
  type CanvasUiAudioFrame,
  type CanvasUiEffectName,
} from '../karaoke/CanvasUiEffectStage';
import type { WebDynamicPalette } from '../library/dynamicColors';
import '../styles/canvasui-karaoke.css';

interface FullPlayerCanvasUiLayerProps {
  albumKey: string;
  palette: WebDynamicPalette;
  isPlaying: boolean;
  placement: 'background' | 'artwork';
  artworkUrl?: string | null;
  reactiveTarget?: RefObject<HTMLElement | null>;
}

const BACKGROUND_EFFECTS: readonly CanvasUiEffectName[] = [
  'clouds',
  'liquid',
  'blaze',
  'grid',
  'droplets',
  'laser',
];

const ARTWORK_EFFECTS: readonly CanvasUiEffectName[] = [
  'asciify',
  'bend',
  'bubble',
  'glass',
  'glitch',
  'hex-float',
  'magnify',
  'particle-reveal',
  'retro-dither',
  'ripple',
  'shatter',
  'vhs',
];

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hashAlbumKey(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function selectFullPlayerCanvasEffect(
  albumKey: string,
  placement: 'background' | 'artwork',
): CanvasUiEffectName {
  const effects = placement === 'background' ? BACKGROUND_EFFECTS : ARTWORK_EFFECTS;
  return effects[hashAlbumKey(albumKey) % effects.length];
}

/**
 * CanvasUI has two deliberately separate jobs in the Full Player:
 *
 * - the original six engines become the large atmosphere when Live Artwork exists;
 * - image-transforming engines animate the square album cover when it does not.
 *
 * Real spectrum data, when available, modulates either treatment. Desktop playback
 * keeps the native audio route untouched and uses deterministic ambient motion.
 */
export function FullPlayerCanvasUiLayer({
  albumKey,
  palette,
  isPlaying,
  placement,
  artworkUrl,
  reactiveTarget,
}: FullPlayerCanvasUiLayerProps) {
  const playingRef = useRef(isPlaying);
  const onsetRef = useRef({
    fastBass: 0,
    slowBass: 0,
    kick: 0,
    armed: true,
    previousLevel: 0,
    lastTime: performance.now(),
  });
  const writtenVarsRef = useRef(new Map<string, string>());
  const albumHash = useMemo(() => hashAlbumKey(albumKey), [albumKey]);
  const effect = useMemo(
    () => selectFullPlayerCanvasEffect(albumKey, placement),
    [albumKey, placement],
  );

  playingRef.current = isPlaying;

  useEffect(() => {
    onsetRef.current = {
      fastBass: 0,
      slowBass: 0,
      kick: 0,
      armed: true,
      previousLevel: 0,
      lastTime: performance.now(),
    };
    writtenVarsRef.current.clear();
  }, [albumKey]);

  useEffect(() => {
    if (isPlaying) spectrumEngine.start();
  }, [isPlaying]);

  const sampleAudio = useCallback((): CanvasUiAudioFrame => {
    const now = performance.now();
    const state = onsetRef.current;
    const dt = Math.min(3, Math.max(0.45, (now - state.lastTime) / 16.7));
    state.lastTime = now;

    const phaseA = (albumHash % 997) / 997 * Math.PI * 2;
    const phaseB = (albumHash % 613) / 613 * Math.PI * 2;
    const motion = playingRef.current ? 1 : 0.28;
    const placementBoost = placement === 'artwork' ? 1.65 : 1;
    const freeBass = clamp(placementBoost * (
      0.1 + motion * (0.05 + (Math.sin(now * 0.00021 + phaseA) + 1) * 0.035)
    ));
    const freeMid = clamp(placementBoost * (
      0.12 + motion * (0.05 + (Math.sin(now * 0.00027 + phaseB) + 1) * 0.04)
    ));
    const freeTreble = clamp(placementBoost * (
      0.08 + motion * (0.035 + (Math.sin(now * 0.00016 + phaseA + phaseB) + 1) * 0.025)
    ));

    const hasSpectrum = playingRef.current && spectrumEngine.isActive;
    const bands = hasSpectrum ? spectrumEngine.sample() : null;
    const bass = clamp(bands ? 0.08 + bands.bass * 0.9 : freeBass);
    const mid = clamp(bands ? 0.1 + bands.mid * 0.82 : freeMid);
    const treble = clamp(bands ? 0.06 + bands.treble * 0.9 : freeTreble);
    const level = clamp(bands
      ? 0.08 + bands.level * 0.9
      : freeBass * 0.42 + freeMid * 0.4 + freeTreble * 0.18);

    if (bands) {
      const fastBlend = 1 - Math.pow(0.42, dt);
      const slowBlend = 1 - Math.pow(0.94, dt);
      state.fastBass += (bands.bass - state.fastBass) * fastBlend;
      state.slowBass += (bands.bass - state.slowBass) * slowBlend;
      const onset = state.fastBass - state.slowBass;
      if (onset < 0.04) state.armed = true;
      if (state.armed && onset > 0.085 && state.fastBass > 0.28) {
        state.armed = false;
        state.kick = Math.max(state.kick, clamp(onset * 3.6));
      }
    }
    state.kick *= Math.pow(0.84, dt);
    const hit = bands
      ? clamp(Math.max(0, bands.level - state.previousLevel) * 5.2)
      : 0;
    state.previousLevel = bands?.level ?? 0;

    const glow = bands
      ? clamp(bass * 0.45 + mid * 0.32 + treble * 0.23)
      : clamp(0.24 + (Math.sin(now * 0.00018 + phaseB) + 1) * 0.12 * motion);

    const target = reactiveTarget?.current;
    if (target) {
      const writeVar = (name: string, value: number) => {
        const serialized = value.toFixed(2);
        if (writtenVarsRef.current.get(name) === serialized) return;
        writtenVarsRef.current.set(name, serialized);
        target.style.setProperty(name, serialized);
      };
      writeVar('--atmo-bass', bass);
      writeVar('--atmo-mid', mid);
      writeVar('--atmo-treble', treble);
      writeVar('--atmo-bass-smooth', bass);
      writeVar('--atmo-mid-smooth', mid);
      writeVar('--atmo-treble-smooth', treble);
      writeVar('--atmo-beat', state.kick);
    }

    return {
      bass,
      mid,
      treble,
      level,
      vocal: clamp(mid * 0.72 + treble * 0.28),
      kick: state.kick,
      hit,
      glow,
    };
  }, [albumHash, placement, reactiveTarget]);

  return (
    <CanvasUiEffectStage
      className={placement === 'background'
        ? 'fp-canvasui-liveart'
        : 'fp-artwork-canvasui'}
      effect={effect}
      palette={palette}
      sampleAudio={sampleAudio}
      contentImageUrl={placement === 'artwork' ? artworkUrl : null}
    />
  );
}
