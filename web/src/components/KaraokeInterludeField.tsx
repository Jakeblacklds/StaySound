import DottedBackground, {
  type DottedAudioSignal,
} from '@staysound/components/originkit/ui/dotmatrix';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KaraokeMixer } from '../karaoke/KaraokeMixer';
import type { WebDynamicPalette } from '../library/dynamicColors';

interface KaraokeInterludeFieldProps {
  mixer: KaraokeMixer;
  palette: WebDynamicPalette;
  isPlaying: boolean;
  /** `false` starts the fade-out; the parent unmounts once it has finished. */
  active: boolean;
}

/** Time constant follower — frame-rate independent, no per-fps tuning. */
function approach(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function withAlpha(color: string, alpha: string): string {
  const normalized = color.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? `${normalized}${alpha}` : normalized;
}

/**
 * The OriginKit dot field, mounted only while the singer has nothing to sing —
 * a real interlude or a long intro. It is the answer to the old "get ready in
 * 3, 2, 1" card: instead of a loader counting at you, the room itself takes
 * over the screen and keeps moving with the instrumental until the voice comes
 * back.
 *
 * It reads the karaoke mixer rather than the app's shared reactor, because in
 * karaoke the audio runs through the stem mixer's own graph — the global
 * spectrum engine hears silence there.
 */
export function KaraokeInterludeField({
  mixer,
  palette,
  isPlaying,
  active,
}: KaraokeInterludeFieldProps) {
  const signalRef = useRef<DottedAudioSignal>({
    bass: 0,
    mid: 0,
    treble: 0,
    level: 0,
    pulse: 0,
    swell: 0,
    pulseAge: 4,
  });
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;
  // A transition cannot run on the frame an element is inserted, so the field
  // is painted transparent once and only then told to come up — which also
  // hides the shader compile behind the start of the fade.
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(rafId);
  }, []);

  const colors = useMemo(() => [
    withAlpha(palette.secondary, 'DC'),
    withAlpha(palette.primary, 'A8'),
    withAlpha(palette.background, '00'),
  ], [palette.background, palette.primary, palette.secondary]);

  useEffect(() => {
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const signal = signalRef.current;
    let previousOnset = 0;
    let lastFrame = performance.now();
    let rafId = 0;

    const frame = (time: number) => {
      rafId = requestAnimationFrame(frame);
      const dt = Math.min(0.1, Math.max(1 / 240, (time - lastFrame) / 1_000));
      lastFrame = time;
      if (document.hidden) return;

      const audible = playingRef.current && !reduceMotion;
      const sampled = audible ? mixer.sampleSpectrum() : null;
      const bass = sampled?.bass ?? 0;
      const mid = sampled?.mid ?? 0;
      const treble = sampled?.treble ?? 0;
      const level = sampled?.level ?? 0;
      // The mixer already hands out a percussive `kick`, so the onset work the
      // app reactor does against a rolling bass floor is done for us here.
      const onset = sampled?.kick ?? 0;

      signal.bass = approach(signal.bass, bass, dt, bass > signal.bass ? 0.06 : 0.30);
      signal.mid = approach(signal.mid, mid, dt, mid > signal.mid ? 0.07 : 0.34);
      signal.treble = approach(signal.treble, treble, dt, treble > signal.treble ? 0.07 : 0.38);
      signal.level = approach(signal.level, level, dt, level > signal.level ? 0.10 : 0.42);
      signal.pulse = approach(signal.pulse ?? 0, onset, dt, onset > (signal.pulse ?? 0) ? 0.045 : 0.38);
      signal.swell = approach(signal.swell ?? 0, level, dt, level > (signal.swell ?? 0) ? 0.55 : 1.4);

      // One wavefront per hit, not a flash on every frame above the threshold.
      const age = signal.pulseAge ?? 4;
      signal.pulseAge = onset > 0.3 && onset > previousOnset + 0.015 && age > 0.2
        ? 0
        : Math.min(8, age + dt);
      previousOnset = onset;
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [mixer]);

  return (
    <div
      className={`karaoke-interlude-field${active && entered ? ' is-active' : ''}`}
      aria-hidden="true"
    >
      <DottedBackground
        frequency={1}
        speed={2}
        bgColor="transparent"
        colors={colors}
        cellSize={22}
        gamma={4}
        paletteBias={10}
        useGlyphAtlas={false}
        audioSignalRef={signalRef}
        reactivity={0.9}
        fps={60}
        maxDpr={2}
      />
    </div>
  );
}
