import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatDuration } from '@staysound/services/metadataService';
import type { TrackWaveform } from '../../audio/trackWaveform';

/** Bar + gap, in CSS pixels. Constant pitch, so the wave reads the same at any width. */
const BAR_PITCH = 6;
const BAR_GAP = 2.6;
const MIN_BARS = 32;
const THUMB_RADIUS = 7;
/** Crossfade from the placeholder to the decoded envelope, once, on arrival. */
const REVEAL_MS = 620;
/** Tone is quantised onto a small colour ramp — see `buildRamp`. */
const TONE_STEPS = 16;
/** Headroom, so the loudest bars stop short of the edges instead of butting into them. */
const MAX_BAR_FILL = 0.94;

type Rgb = [number, number, number];

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The shape shown while a file is still being decoded (and the permanent shape
 * for sources we don't analyse, like remote streams). Seeded by duration so it
 * is at least stable for a given track instead of reshuffling every render.
 */
function placeholderBars(seed: number, count: number): Float32Array {
  const out = new Float32Array(count);
  let x = seed * 9301 + 49297;
  for (let index = 0; index < count; index += 1) {
    x = (x * 233280 + 9301) % 2147483647;
    const r = (x % 1000) / 1000;
    out[index] = 0.18 + 0.62 * Math.abs(Math.sin(index * 0.55 + seed)) * (0.45 + 0.55 * r);
  }
  return out;
}

/**
 * Resamples a fixed-resolution envelope onto however many bars are on screen.
 * Height takes each slice's peak so transients survive the reduction; tone
 * takes its mean, because a colour is a summary of the stretch rather than of
 * its loudest instant.
 */
function resample(source: Float32Array, count: number, mode: 'peak' | 'mean'): Float32Array {
  const out = new Float32Array(count);
  const step = source.length / count;
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(index * step);
    const end = Math.max(start + 1, Math.min(source.length, Math.floor((index + 1) * step)));

    let value = 0;
    for (let sample = start; sample < end; sample += 1) {
      value = mode === 'peak' ? Math.max(value, source[sample]) : value + source[sample];
    }
    out[index] = mode === 'peak' ? value : value / (end - start);
  }
  return out;
}

function parseRgb(value: string, fallback: Rgb): Rgb {
  // Only the rgb()/rgba() form is parsed: a browser that hands back oklch() or
  // color(...) would otherwise be read as three meaningless channel numbers.
  if (!value.startsWith('rgb')) return fallback;
  const match = value.match(/(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)/);
  if (!match) return fallback;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = clamp01(amount);
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function css(colour: Rgb): string {
  return `rgb(${Math.round(colour[0])},${Math.round(colour[1])},${Math.round(colour[2])})`;
}

function sameColour(a: Rgb, b: Rgb): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * The ramp that carries the frequency content. A stretch weighted towards the
 * low end is drawn deep and dense; one weighted towards the high end (cymbals,
 * strings, sibilance) is drawn light and airy; the track's ordinary balance
 * sits on the base colour in between. `darken`/`lighten` set how far each end
 * travels, which is what keeps the played half reading as accent and the
 * unplayed half as grey.
 */
function buildRamp(base: Rgb, darken: number, lighten: number): string[] {
  const deep = mix(base, BLACK, darken);
  const bright = mix(base, WHITE, lighten);
  const ramp: string[] = [];
  for (let step = 0; step <= TONE_STEPS; step += 1) {
    const tone = step / TONE_STEPS;
    ramp.push(css(tone < 0.5 ? mix(deep, base, tone * 2) : mix(base, bright, (tone - 0.5) * 2)));
  }
  return ramp;
}

interface WaveformProps {
  /** Playhead, in seconds. */
  value: number;
  /** Track length, in seconds. */
  max: number;
  /** The decoded envelope, or null while it is being analysed / unavailable. */
  waveform?: TrackWaveform | null;
  analysing?: boolean;
  isPlaying?: boolean;
  seed?: number;
  height?: number;
  onSeek?: (value: number) => void;
  ariaLabel?: string;
}

/**
 * The Círculo scrubber, drawn on a canvas from the track's real analysis (see
 * audio/trackWaveform.ts). The shape is *static* — a portrait of the song, not
 * a meter — and it carries two dimensions at once:
 *
 *   - bar height: how loud that stretch of the track is,
 *   - bar colour: how much of its energy sits in the high band, so a bright
 *     chorus and a low, dense breakdown look different even when they are
 *     equally loud.
 *
 * The only thing that moves is the playhead, and it is interpolated between
 * `timeupdate` events so it glides instead of stepping four times a second.
 */
export function Waveform({
  value,
  max,
  waveform = null,
  analysing = false,
  isPlaying = false,
  seed = 7,
  height = 34,
  onSeek,
  ariaLabel = 'Progreso',
}: WaveformProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const accentProbeRef = useRef<HTMLSpanElement | null>(null);
  const restProbeRef = useRef<HTMLSpanElement | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  // Everything the draw loop reads lives in refs: the loop must not restart on
  // every position tick, and React state at 60 Hz would be the expensive way to
  // move one playhead.
  const positionRef = useRef({ seconds: value, at: performance.now() });
  const maxRef = useRef(max);
  const playingRef = useRef(isPlaying);
  const analysingRef = useRef(analysing);
  const waveformRef = useRef<TrackWaveform | null>(waveform);
  const revealRef = useRef(0);
  const hoverRef = useRef<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const seedRef = useRef(seed);
  /** Set on every render so a settled bar can stop repainting. */
  const invalidatedRef = useRef(true);

  // Only a genuine position change may restart the extrapolation clock: a
  // re-render from hovering must not freeze the playhead.
  if (positionRef.current.seconds !== value) {
    positionRef.current = { seconds: value, at: performance.now() };
  }
  maxRef.current = Math.max(max, 1);
  playingRef.current = isPlaying;
  analysingRef.current = analysing;
  seedRef.current = seed;
  hoverRef.current = hoverRatio;
  dragRef.current = dragRatio;
  invalidatedRef.current = true;

  // A decoded envelope crossfades in over the placeholder it replaces — once,
  // on arrival.
  if (waveformRef.current !== waveform) {
    waveformRef.current = waveform;
    revealRef.current = performance.now();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    let frame = 0;
    let cssWidth = wrapper.clientWidth;
    let cssHeight = height;
    let accent: Rgb = [255, 163, 26];
    let rest: Rgb = [74, 74, 74];
    let playedRamp = buildRamp(accent, 0.5, 0.6);
    let restRamp = buildRamp(rest, 0.34, 0.5);
    let lastProbe = 0;
    let lastDraw = 0;

    const resize = () => {
      const ratio = Math.min(2.5, window.devicePixelRatio || 1);
      cssWidth = Math.max(1, wrapper.clientWidth);
      cssHeight = Math.max(1, height);
      canvas.width = Math.round(cssWidth * ratio);
      canvas.height = Math.round(cssHeight * ratio);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const readColors = (now: number) => {
      // --accent is repainted per track from the artwork palette, so it has to
      // be re-read; resolving it through probe elements avoids parsing whatever
      // var() chain the token currently points at. The ramps are rebuilt only
      // when a colour actually changed.
      if (now - lastProbe < 400) return;
      lastProbe = now;

      if (accentProbeRef.current) {
        const next = parseRgb(window.getComputedStyle(accentProbeRef.current).color, accent);
        if (!sameColour(next, accent)) {
          accent = next;
          playedRamp = buildRamp(accent, 0.5, 0.6);
        }
      }
      if (restProbeRef.current) {
        const next = parseRgb(window.getComputedStyle(restProbeRef.current).color, rest);
        if (!sameColour(next, rest)) {
          rest = next;
          restRamp = buildRamp(rest, 0.34, 0.5);
        }
      }
    };

    // Resampling 320 stored values onto ~120 bars is cheap, but it is pointless
    // to redo it for a shape that only changes with the track or the width.
    const barsCache: {
      count: number;
      source: TrackWaveform | null;
      levels: Float32Array | null;
      tone: Float32Array | null;
    } = { count: 0, source: null, levels: null, tone: null };

    const barsFor = (count: number) => {
      const source = waveformRef.current;
      if (barsCache.count === count && barsCache.source === source) return barsCache;
      barsCache.count = count;
      barsCache.source = source;
      barsCache.levels = source ? resample(source.levels, count, 'peak') : null;
      barsCache.tone = source ? resample(source.tone, count, 'mean') : null;
      return barsCache;
    };

    const placeholderCache: { count: number; seed: number; bars: Float32Array } = {
      count: 0,
      seed: -1,
      bars: new Float32Array(0),
    };
    const placeholderFor = (count: number) => {
      if (placeholderCache.count !== count || placeholderCache.seed !== seedRef.current) {
        placeholderCache.count = count;
        placeholderCache.seed = seedRef.current;
        placeholderCache.bars = placeholderBars(seedRef.current, count);
      }
      return placeholderCache.bars;
    };

    const draw = (now: number) => {
      readColors(now);
      context.clearRect(0, 0, cssWidth, cssHeight);
      if (cssWidth < 8) return;

      const count = Math.max(MIN_BARS, Math.floor(cssWidth / BAR_PITCH));
      const pitch = cssWidth / count;
      const barWidth = Math.max(1.5, pitch - BAR_GAP);
      const radius = Math.min(barWidth / 2, 2);
      const centre = cssHeight / 2;

      const duration = maxRef.current;
      const { seconds, at } = positionRef.current;
      // Between `timeupdate` events the element keeps playing, so extrapolate
      // from the wall clock rather than letting the playhead sit still.
      const elapsed = playingRef.current ? (now - at) / 1000 : 0;
      const playedRatio = clamp01(Math.min(duration, seconds + elapsed) / duration);
      // Hovering only draws a guide; the fill and the thumb stay on the real
      // playhead until the pointer is actually dragging it.
      const guide = hoverRef.current ?? dragRef.current;
      const headRatio = dragRef.current ?? playedRatio;

      const resolved = barsFor(count);
      const placeholder = placeholderFor(count);
      const reveal = resolved.levels ? easeOut(clamp01((now - revealRef.current) / REVEAL_MS)) : 0;

      // An un-analysed shape is provisional, and says so by sitting back rather
      // than by animating.
      context.globalAlpha = analysingRef.current ? 0.45 + 0.55 * reveal : 1;

      for (let index = 0; index < count; index += 1) {
        const real = resolved.levels ? resolved.levels[index] : 0;
        const amplitude = clamp01(placeholder[index] * (1 - reveal) + real * reveal);
        const barHeight = Math.max(3, amplitude * cssHeight * MAX_BAR_FILL);

        // With no analysis there is no tonal information to show, so the
        // placeholder sits on the middle of the ramp instead of inventing one.
        const tone = resolved.tone ? 0.5 + (resolved.tone[index] - 0.5) * reveal : 0.5;
        const step = Math.round(clamp01(tone) * TONE_STEPS);
        context.fillStyle = (index + 0.5) / count <= headRatio ? playedRamp[step] : restRamp[step];

        const x = index * pitch + (pitch - barWidth) / 2;
        const y = centre - barHeight / 2;
        context.beginPath();
        if (typeof context.roundRect === 'function') {
          context.roundRect(x, y, barWidth, barHeight, radius);
        } else {
          context.rect(x, y, barWidth, barHeight);
        }
        context.fill();
      }

      context.globalAlpha = 1;

      if (guide !== null) {
        context.fillStyle = 'rgba(255,255,255,0.34)';
        context.fillRect(Math.min(cssWidth - 1, guide * cssWidth), 0, 1, cssHeight);
      }

      // The thumb sits in a clear ring, the way the CSS version used a
      // background-coloured box-shadow — punched out rather than painted over,
      // so it stays correct on any surface the bar is placed on.
      const thumbX = Math.min(cssWidth - 1, headRatio * cssWidth);
      context.save();
      context.globalCompositeOperation = 'destination-out';
      context.beginPath();
      context.arc(thumbX, centre, THUMB_RADIUS + 3, 0, Math.PI * 2);
      context.fillStyle = '#000';
      context.fill();
      context.restore();

      context.beginPath();
      context.arc(thumbX, centre, THUMB_RADIUS, 0, Math.PI * 2);
      context.fillStyle = css(accent);
      context.fill();
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (document.hidden) return;
      // Nothing in the bars moves, so a frame is only worth painting while the
      // playhead is travelling, a pointer is on the scrubber, or the decoded
      // shape is still fading in.
      const settling = now - revealRef.current < REVEAL_MS;
      const busy =
        playingRef.current || settling || hoverRef.current !== null || dragRef.current !== null;
      // The idle repaint is not decoration: --dyn-accent is written after the
      // artwork palette resolves, which can land while playback is paused and
      // nothing else would ask for a frame.
      if (!busy && !invalidatedRef.current && now - lastDraw < 500) return;
      invalidatedRef.current = false;
      lastDraw = now;
      draw(now);
    };

    resize();
    const observer = new ResizeObserver(() => {
      resize();
      invalidatedRef.current = true;
    });
    observer.observe(wrapper);
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // The loop reads live values through refs; only the drawing surface's own
    // fixed inputs belong here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  const ratioFromEvent = (event: PointerEvent<HTMLDivElement>): number => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp01((event.clientX - rect.left) / rect.width);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragRatio(ratioFromEvent(event));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const ratio = ratioFromEvent(event);
    setHoverRatio(ratio);
    if (dragRatio !== null) setDragRatio(ratio);
  };

  const handlePointerUp = () => {
    // Only a press that started on the scrubber seeks: releasing here after
    // pressing the play button must not throw the playhead across the track.
    if (!onSeek || dragRatio === null) return;
    setDragRatio(null);
    onSeek(dragRatio * max);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    if (event.key === 'ArrowRight') onSeek(Math.min(max, value + max / 20));
    if (event.key === 'ArrowLeft') onSeek(Math.max(0, value - max / 20));
  };

  const preview = dragRatio ?? hoverRatio;

  return (
    <div
      ref={wrapperRef}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={formatDuration(value * 1000)}
      tabIndex={0}
      className="circ-waveform"
      style={{ height, cursor: onSeek ? 'pointer' : 'default' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDragRatio(null)}
      onPointerLeave={() => setHoverRatio(null)}
      onKeyDown={handleKeyDown}
    >
      <canvas ref={canvasRef} className="circ-waveform-canvas" aria-hidden="true" />
      <span ref={accentProbeRef} className="circ-waveform-probe accent" aria-hidden="true" />
      <span ref={restProbeRef} className="circ-waveform-probe rest" aria-hidden="true" />
      {preview !== null && onSeek ? (
        <span className="circ-waveform-tip" style={{ left: `${preview * 100}%` }} aria-hidden="true">
          {formatDuration(preview * max * 1000)}
        </span>
      ) : null}
    </div>
  );
}
