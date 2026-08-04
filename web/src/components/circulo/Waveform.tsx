import { useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react';

function seededBars(seed: number, count: number): number[] {
  const out: number[] = [];
  let x = seed * 9301 + 49297;
  for (let index = 0; index < count; index += 1) {
    x = (x * 233280 + 9301) % 2147483647;
    const r = (x % 1000) / 1000;
    out.push(0.18 + 0.82 * Math.abs(Math.sin(index * 0.55 + seed)) * (0.45 + 0.55 * r));
  }
  return out;
}

interface WaveformProps {
  value: number;
  max: number;
  seed?: number;
  barCount?: number;
  height?: number;
  onSeek?: (value: number) => void;
  ariaLabel?: string;
}

/** The Círculo scrubber: a seeded pseudo-waveform (no real peak data yet, same placeholder
    approach the design kit ships with) filled up to the playhead. Click/drag/arrow-key seek. */
export function Waveform({ value, max, seed = 7, barCount = 88, height = 34, onSeek, ariaLabel = 'Progreso' }: WaveformProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const heights = useMemo(() => seededBars(seed, barCount), [seed, barCount]);
  const pct = max ? Math.min(1, Math.max(0, value / max)) : 0;

  function seekFromEvent(event: MouseEvent<HTMLDivElement>) {
    if (!onSeek || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    onSeek(Math.round(((event.clientX - rect.left) / rect.width) * max));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!onSeek) return;
    if (event.key === 'ArrowRight') onSeek(Math.min(max, value + max / 20));
    if (event.key === 'ArrowLeft') onSeek(Math.max(0, value - max / 20));
  }

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className="circ-waveform"
      style={{ height, cursor: onSeek ? 'pointer' : 'default' }}
      onClick={seekFromEvent}
      onKeyDown={handleKeyDown}
    >
      {heights.map((barHeight, index) => (
        <span
          key={index}
          className={index / barCount <= pct ? 'played' : ''}
          style={{ height: Math.max(3, barHeight * height) }}
        />
      ))}
      <span aria-hidden="true" className="circ-waveform-thumb" style={{ left: `calc(${pct * 100}% - 7px)` }} />
    </div>
  );
}
