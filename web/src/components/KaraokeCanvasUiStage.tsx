import { RefObject, useCallback, useRef } from 'react';
import type { WebDynamicPalette } from '../library/dynamicColors';
import {
  CanvasUiEffectStage,
  type CanvasUiAudioFrame,
  type CanvasUiEffectName,
} from '../karaoke/CanvasUiEffectStage';
import type { KaraokeMixer, KaraokeSpectrumFrame } from '../karaoke/KaraokeMixer';
import '../styles/canvasui-karaoke.css';

interface KaraokeCanvasUiStageProps {
  effect: CanvasUiEffectName;
  palette: WebDynamicPalette;
  mixer: KaraokeMixer;
  isPlaying: boolean;
  targetRef: RefObject<HTMLElement | null>;
}

const IDLE_FRAME: KaraokeSpectrumFrame = {
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

export function KaraokeCanvasUiStage({
  effect,
  palette,
  mixer,
  isPlaying,
  targetRef,
}: KaraokeCanvasUiStageProps) {
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;

  const sampleAudio = useCallback((): CanvasUiAudioFrame => {
    const frame = playingRef.current ? mixer.sampleSpectrum() : IDLE_FRAME;
    const target = targetRef.current;
    if (target) {
      target.style.setProperty('--karaoke-bass', frame.bass.toFixed(3));
      target.style.setProperty('--karaoke-mid', frame.mid.toFixed(3));
      target.style.setProperty('--karaoke-treble', frame.treble.toFixed(3));
      target.style.setProperty('--karaoke-level', frame.level.toFixed(3));
      target.style.setProperty('--karaoke-pitch', frame.vocalPitch.toFixed(3));
      target.style.setProperty('--karaoke-vocal', frame.vocalEnergy.toFixed(3));
      target.style.setProperty('--karaoke-beat', frame.kick.toFixed(3));
      target.style.setProperty('--karaoke-hit', frame.midHit.toFixed(3));
      target.style.setProperty('--karaoke-glow', frame.sparkle.toFixed(3));
      target.style.setProperty('--karaoke-pulse', frame.kick.toFixed(3));
      target.style.setProperty('--karaoke-kick', frame.kick.toFixed(3));
      target.style.setProperty('--karaoke-mid-hit', frame.midHit.toFixed(3));
      target.style.setProperty('--karaoke-spark', frame.sparkle.toFixed(3));
    }
    return {
      bass: frame.bass,
      mid: frame.mid,
      treble: frame.treble,
      level: frame.level,
      vocal: frame.vocalEnergy,
      kick: frame.kick,
      hit: frame.midHit,
      glow: frame.sparkle,
    };
  }, [mixer, targetRef]);

  return (
    <CanvasUiEffectStage
      className="karaoke-canvasui-stage"
      effect={effect}
      palette={{
        background: palette.background,
        backgroundAlt: palette.backgroundAlt,
        primary: palette.primary,
        secondary: palette.secondary,
        accent: palette.accent,
      }}
      sampleAudio={sampleAudio}
    />
  );
}
