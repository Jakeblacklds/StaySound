import DottedBackground, {
  type DottedAudioSignal,
} from '@staysound/components/originkit/ui/dotmatrix';
import { type RefObject, useEffect, useMemo, useRef } from 'react';
import { dotMatrixReactor, type DotMatrixHandle } from '../audio/dotMatrixReactor';
import { perfProbe } from '../debug/perfProbe';
import type { WebDynamicPalette } from '../library/dynamicColors';

export type DotMatrixVariant = 'player' | 'ambient';

interface OriginKitDotMatrixBackgroundProps {
  palette: WebDynamicPalette;
  isPlaying: boolean;
  motionKey?: string | null;
  reactiveTarget?: RefObject<HTMLElement | null>;
  /**
   * `player` is the full-screen deck; `ambient` is the same field running
   * behind the whole app — coarser, slower, and half as reactive so it stays
   * scenery while you are reading a track list.
   */
  variant?: DotMatrixVariant;
  /**
   * Freezes the field on its last frame. The ambient instance runs behind the
   * whole app, so it keeps drawing two full-screen passes per frame even when
   * the full player is covering it — on WKWebView that budget comes straight
   * out of the lyrics and of the player's own field.
   */
  paused?: boolean;
}

interface VariantTuning {
  frequency: number;
  speed: number;
  cellSize: number;
  gamma: number;
  paletteBias: number;
  reactivity: number;
  fps: number;
  maxDpr: number;
  alpha: [string, string];
  /** Player sits on its own opaque base; ambient lets the app gradient through. */
  opaqueBase: boolean;
}

const TUNING: Record<DotMatrixVariant, VariantTuning> = {
  player: {
    frequency: 1,
    speed: 2.4,
    cellSize: 20,
    gamma: 4,
    paletteBias: 10,
    reactivity: 1,
    fps: 60,
    maxDpr: 2,
    alpha: ['E8', 'B8'],
    opaqueBase: true,
  },
  ambient: {
    frequency: 1,
    speed: 1.5,
    cellSize: 30,
    gamma: 5,
    paletteBias: 8,
    reactivity: 0.55,
    fps: 30,
    maxDpr: 1.5,
    alpha: ['C4', '8E'],
    opaqueBase: false,
  },
};

/** Stable across renders so the field's frame loop never sees a new callback. */
const reportSlowSubmit = {
  player: (ms: number) => perfProbe.note(`dotmatrix player: GPU tardó ${Math.round(ms)}ms en aceptar un frame`),
  ambient: (ms: number) => perfProbe.note(`dotmatrix ambient: GPU tardó ${Math.round(ms)}ms en aceptar un frame`),
} satisfies Record<DotMatrixVariant, (ms: number) => void>;

function withAlpha(color: string, alpha: string): string {
  const normalized = color.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? `${normalized}${alpha}` : normalized;
}

/**
 * The OriginKit WebGL field, themed with the current album palette and driven
 * by the shared beat reactor. Audio never moves the field directly: it bends
 * the noise velocity, tightens the surface tension so dots fuse into blobs on
 * a transient, and sends one soft wavefront out from the centre per onset.
 */
export function OriginKitDotMatrixBackground({
  palette,
  isPlaying,
  motionKey,
  reactiveTarget,
  variant = 'player',
  paused = false,
}: OriginKitDotMatrixBackgroundProps) {
  const tuning = TUNING[variant];
  const handleRef = useRef<DotMatrixHandle | null>(null);
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;
  // The reactor's signal object outlives any single mount, so the shader can
  // keep this reference even across a StrictMode remount.
  const audioSignalRef = useRef<DottedAudioSignal>(dotMatrixReactor.current);

  const colors = useMemo(() => [
    withAlpha(palette.secondary, tuning.alpha[0]),
    withAlpha(palette.primary, tuning.alpha[1]),
    withAlpha(palette.background, '00'),
  ], [palette.background, palette.primary, palette.secondary, tuning.alpha]);

  useEffect(() => {
    const handle = dotMatrixReactor.acquire();
    handleRef.current = handle;
    handle.setPlaying(playingRef.current);
    return () => {
      handle.release();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    handleRef.current?.setPlaying(isPlaying);
  }, [isPlaying]);

  // A new track must not inherit the previous one's envelope, or its opening
  // bar lands on whatever the last song's outro left behind.
  useEffect(() => {
    handleRef.current?.reset();
  }, [motionKey]);

  useEffect(() => {
    const target = reactiveTarget?.current;
    if (!target || paused) return;
    const signal = dotMatrixReactor.current;

    let rafId = 0;
    const written = new Map<string, string>();
    const frame = () => {
      rafId = requestAnimationFrame(frame);
      if (document.hidden) return;
      const values: Array<[string, number]> = [
        ['--atmo-bass', signal.bass],
        ['--atmo-mid', signal.mid],
        ['--atmo-treble', signal.treble],
        ['--atmo-bass-smooth', signal.bass],
        ['--atmo-mid-smooth', signal.mid],
        ['--atmo-treble-smooth', signal.treble],
        ['--atmo-swell', signal.swell],
        ['--atmo-beat', signal.pulse * 0.14],
      ];
      for (const [name, value] of values) {
        const serialized = value.toFixed(2);
        if (written.get(name) === serialized) continue;
        written.set(name, serialized);
        target.style.setProperty(name, serialized);
      }
    };
    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [reactiveTarget, paused]);

  return (
    <div className={`origin-kit-dot-matrix ${variant}`} aria-hidden="true">
      <DottedBackground
        frequency={tuning.frequency}
        speed={tuning.speed}
        bgColor={tuning.opaqueBase ? palette.background : 'transparent'}
        colors={colors}
        cellSize={tuning.cellSize}
        gamma={tuning.gamma}
        paletteBias={tuning.paletteBias}
        useGlyphAtlas={false}
        audioSignalRef={audioSignalRef}
        reactivity={tuning.reactivity}
        fps={tuning.fps}
        maxDpr={tuning.maxDpr}
        paused={paused}
        onSlowFrame={reportSlowSubmit[variant]}
      />
    </div>
  );
}
