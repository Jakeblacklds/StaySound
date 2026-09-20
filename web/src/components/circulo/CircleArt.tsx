import type { CSSProperties, KeyboardEvent } from 'react';

/** Deterministic 0-360 hue from an id string, used as the abstract-disc fallback color and
    as a stable seed so the same album always gets the same fallback look. */
export function hueFromId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

interface CircleArtProps {
  size?: number | string;
  src?: string | null;
  hue?: number;
  ring?: boolean;
  ringGap?: number;
  label?: string;
  onClick?: () => void;
  className?: string;
}

/** Círculo's core object: circular artwork with an optional accent ring. Falls back to an
    abstract hue-seeded disc (via CSS custom properties consumed by .circ-art-fallback in
    circulo.css) when there's no real artwork — the same fallback treatment
    `.artist-card .card-artwork` already uses elsewhere in the app, just circular everywhere
    here instead of only for artists.

    Hover is pure CSS (`.circ-art.interactive:hover`), not React state: a rail is a dozen of
    these side by side, and tracking the pointer in state re-rendered the whole row on every
    crossing to paint a border the stylesheet can paint on its own. */
export function CircleArt({ size = 118, src, hue = 30, ring = false, ringGap = 5, label, onClick, className }: CircleArtProps) {
  const fill = typeof size === 'string';

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  }

  return (
    <span
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={`circ-art ${ring ? 'ringed' : ''} ${onClick ? 'interactive' : ''} ${fill ? 'fill' : ''} ${className ?? ''}`}
      style={{
        width: fill ? '100%' : size,
        height: fill ? '100%' : size,
        '--circ-ring-gap': `${ringGap}px`,
      } as CSSProperties}
    >
      <span aria-label={label} className="circ-art-disc" style={!src ? { background: artGradient(hue) } : undefined}>
        {src ? <img src={src} alt="" loading="lazy" /> : null}
      </span>
    </span>
  );
}

export function artGradient(hue: number): string {
  return [
    `radial-gradient(58% 58% at 62% 30%, oklch(0.72 0.19 ${hue}), transparent 62%)`,
    `radial-gradient(70% 70% at 24% 74%, oklch(0.38 0.14 ${(hue + 40) % 360}), transparent 70%)`,
    `conic-gradient(from 210deg at 50% 50%, oklch(0.16 0.05 ${(hue + 300) % 360}), oklch(0.3 0.12 ${hue}), oklch(0.12 0.04 ${(hue + 60) % 360}))`,
  ].join(', ');
}
