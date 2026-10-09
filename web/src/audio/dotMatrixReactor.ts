/**
 * Shared musical envelope for the dot matrix backgrounds.
 *
 * The spectrum engine hands out instantaneous band energies; a background that
 * maps those straight onto motion twitches on every transient. This reactor
 * turns them into the three quantities a *calm* visual actually wants:
 *
 *   - `pulse`  a percussive onset envelope (fast attack, long release) that
 *              rides above a rolling baseline, so a steady bass line reads as
 *              silence and only the hits register,
 *   - `swell`  a multi-second loudness envelope for the slow breathing,
 *   - `pulseAge` seconds since the last onset, which lets the shader move a
 *              single wavefront outward instead of flashing the whole field.
 *
 * One rAF loop feeds every subscriber, so the full player and the ambient app
 * background stay phase-locked to the same beat instead of drifting apart.
 */
import { spectrumEngine, type SpectrumBands } from './spectrumEngine';

export interface DotMatrixSignal extends SpectrumBands {
  /** Percussive onset envelope, 0..1. */
  pulse: number;
  /** Slow loudness envelope, 0..1. */
  swell: number;
  /** Seconds since the last detected onset. */
  pulseAge: number;
}

const ZERO_SIGNAL: DotMatrixSignal = {
  bass: 0,
  mid: 0,
  treble: 0,
  level: 0,
  pulse: 0,
  swell: 0,
  pulseAge: 4,
};

/**
 * Resolved once. `matchMedia` parses its argument and allocates a live
 * MediaQueryList on every call, and this used to run inside the frame loop —
 * sixty throwaway objects a second, for an answer that changes when the user
 * opens System Settings.
 */
let reduceMotionQuery: MediaQueryList | null | undefined;

function prefersReducedMotion(): boolean {
  if (reduceMotionQuery === undefined) {
    reduceMotionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
  }
  return reduceMotionQuery?.matches ?? false;
}

/** Time-constant based follower: frame-rate independent, no rate tuning per fps. */
function approach(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

export interface DotMatrixHandle {
  /** Mutated in place every frame — read it, never store it. */
  readonly signal: DotMatrixSignal;
  setPlaying(playing: boolean): void;
  /** Drops the envelopes so a new track does not inherit the last one's beat. */
  reset(): void;
  release(): void;
}

interface Subscriber {
  playing: boolean;
}

class DotMatrixReactor {
  private readonly subscribers = new Set<Subscriber>();
  private readonly signal: DotMatrixSignal = { ...ZERO_SIGNAL };
  private rafId = 0;
  private lastFrame = 0;
  private baseline = 0;
  private previousOnset = 0;

  /**
   * The live signal object. It is stable for the lifetime of the page and
   * mutated in place, so a component can hold on to it across remounts — the
   * handle below only governs whether the loop is running.
   */
  get current(): DotMatrixSignal {
    return this.signal;
  }

  acquire(): DotMatrixHandle {
    const subscriber: Subscriber = { playing: false };
    this.subscribers.add(subscriber);
    this.ensureLoop();
    return {
      signal: this.signal,
      setPlaying: (playing: boolean) => {
        if (subscriber.playing === playing) return;
        subscriber.playing = playing;
        if (playing) spectrumEngine.start();
      },
      reset: () => this.reset(),
      release: () => {
        this.subscribers.delete(subscriber);
        if (this.subscribers.size === 0 && this.rafId) {
          cancelAnimationFrame(this.rafId);
          this.rafId = 0;
          this.reset();
        }
      },
    };
  }

  private reset(): void {
    Object.assign(this.signal, ZERO_SIGNAL);
    this.baseline = 0;
    this.previousOnset = 0;
  }

  private get anyPlaying(): boolean {
    for (const subscriber of this.subscribers) if (subscriber.playing) return true;
    return false;
  }

  private ensureLoop(): void {
    if (this.rafId) return;
    this.lastFrame = performance.now();
    const frame = (time: number) => {
      this.rafId = requestAnimationFrame(frame);
      const dt = Math.min(0.1, Math.max(1 / 240, (time - this.lastFrame) / 1000));
      this.lastFrame = time;
      if (document.hidden) return;
      this.advance(dt);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private advance(dt: number): void {
    const reduceMotion = prefersReducedMotion();
    // Same dev hook AtmosphereCanvas honours: set window.__atmoDebugBands to
    // drive the field by hand (e.g. pulse `bass` to fake a kick) with nothing
    // playing.
    const debugBands = import.meta.env.DEV
      ? (window as Window & { __atmoDebugBands?: SpectrumBands | null }).__atmoDebugBands ?? null
      : null;
    const sampled =
      debugBands ??
      (this.anyPlaying && !reduceMotion && spectrumEngine.isActive
        ? spectrumEngine.sample()
        : ZERO_SIGNAL);

    const signal = this.signal;
    // Visual smoothing on top of the engine's own envelope: still quick enough
    // to feel attached to the music, slow enough that nothing strobes.
    signal.bass = approach(signal.bass, sampled.bass, dt, sampled.bass > signal.bass ? 0.06 : 0.30);
    signal.mid = approach(signal.mid, sampled.mid, dt, sampled.mid > signal.mid ? 0.07 : 0.34);
    signal.treble = approach(signal.treble, sampled.treble, dt, sampled.treble > signal.treble ? 0.07 : 0.38);
    signal.level = approach(signal.level, sampled.level, dt, sampled.level > signal.level ? 0.10 : 0.42);

    // Onsets are what rises *above* the running bass floor. Without this a
    // loud sustained low end would pin the pulse to 1 and the field would
    // simply sit inflated for the whole song.
    this.baseline = approach(this.baseline, sampled.bass, dt, 1.1);
    const flux = Math.max(0, sampled.bass - this.baseline);
    const onset = Math.min(1, Math.max(0, (flux - 0.012) * 4.2));

    if (onset > 0.28 && onset > this.previousOnset + 0.015 && signal.pulseAge > 0.2) {
      signal.pulseAge = 0;
    } else {
      signal.pulseAge = Math.min(8, signal.pulseAge + dt);
    }
    this.previousOnset = onset;

    signal.pulse = approach(signal.pulse, onset, dt, onset > signal.pulse ? 0.045 : 0.38);
    signal.swell = approach(signal.swell, sampled.level, dt, sampled.level > signal.swell ? 0.55 : 1.4);
  }
}

export const dotMatrixReactor = new DotMatrixReactor();
