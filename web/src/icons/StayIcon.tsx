import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, type SVGProps } from 'react';
import { ANIMATED, drawStayIcon, resolveIcon, stateOf } from './stayIcons';
import { cubicBezier, Motion } from './iconMotion';
import { SvgPen } from './pens';

export type StayIconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  /** Catalogue kind or alias (see stayIcons.ts). */
  name: string;
  size?: number;
  /** The icon's own 0..1 (filled heart, selected tab, play→pause, volume level). Changes spring. */
  state?: number;
  /** Decorative icons (placeholders, status marks) never animate. */
  still?: boolean;
};

const PRESS_IN = cubicBezier(0.33, 1, 0.68, 1);
/** What counts as "the button this icon belongs to", like Android passing a parent's pressed state down. */
const HOST = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], label, summary';

/**
 * An icon from the StaySound catalogue, drawn as SVG in currentColor. Press the control that
 * contains it and it winds in; release and it springs past rest and plays its flourish.
 */
export function StayIcon({ name, size = 20, state, still = false, className, ...rest }: StayIconProps) {
  const kind = resolveIcon(name);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const svg = useRef<SVGSVGElement>(null);
  const motion = useMemo(() => ({
    press: new Motion(0, redraw),
    flourish: new Motion(1, redraw),
    state: new Motion(state ?? stateOf(name), redraw),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // State changes (play→pause, favourite, selection) spring rather than jump.
  const target = state ?? stateOf(name);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) { mounted.current = true; motion.state.snap(target); return; }
    motion.state.spring(target, 17.3, 300, 1);
  }, [target, motion]);

  useEffect(() => {
    const host = svg.current?.parentElement?.closest<HTMLElement>(HOST);
    if (!host || still || !kind) return undefined;
    let held = false;
    const down = () => {
      if (held) return; held = true;
      motion.press.curve(1, 110, PRESS_IN);
    };
    const up = (played: boolean) => {
      if (!held) return; held = false;
      // An underdamped spring (ζ≈.38) swings the icon past rest on release.
      motion.press.spring(0, 15.6, 420, 1);
      if (played && ANIMATED.has(kind)) { motion.flourish.snap(0); motion.flourish.curve(1, 720); }
    };
    const pointerDown = (event: PointerEvent) => { if (event.button === 0 && !isDisabled(host)) down(); };
    const pointerUp = () => up(true);
    const cancel = () => up(false);
    const keyDown = (event: KeyboardEvent) => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) down(); };
    const keyUp = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') up(true); };
    host.addEventListener('pointerdown', pointerDown);
    host.addEventListener('pointerup', pointerUp);
    host.addEventListener('pointercancel', cancel);
    host.addEventListener('pointerleave', cancel);
    host.addEventListener('keydown', keyDown);
    host.addEventListener('keyup', keyUp);
    return () => {
      host.removeEventListener('pointerdown', pointerDown);
      host.removeEventListener('pointerup', pointerUp);
      host.removeEventListener('pointercancel', cancel);
      host.removeEventListener('pointerleave', cancel);
      host.removeEventListener('keydown', keyDown);
      host.removeEventListener('keyup', keyUp);
    };
  }, [kind, still, motion]);

  useEffect(() => () => { motion.press.cancel(); motion.flourish.cancel(); motion.state.cancel(); }, [motion]);

  const pen = new SvgPen();
  if (kind) drawStayIcon(pen, kind, motion.press.value, motion.flourish.value, motion.state.value);
  return (
    <svg
      ref={svg}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      overflow="visible"
      aria-hidden="true"
      className={className ? `stay-icon ${className}` : 'stay-icon'}
      {...rest}
    >
      {pen.shapes.map((shape, index) => (
        <path
          key={index}
          d={shape.d}
          transform={shape.transform}
          fill={shape.fill === undefined ? 'none' : 'currentColor'}
          fillOpacity={shape.fill !== undefined && shape.fill < 1 ? shape.fill : undefined}
          stroke={shape.stroke === undefined ? undefined : 'currentColor'}
          strokeOpacity={shape.stroke !== undefined && shape.stroke < 1 ? shape.stroke : undefined}
          strokeWidth={shape.width}
          strokeLinecap={shape.stroke === undefined ? undefined : 'round'}
          strokeLinejoin={shape.stroke === undefined ? undefined : 'round'}
          pathLength={shape.trim === undefined ? undefined : 1}
          strokeDasharray={shape.trim === undefined ? undefined : `${shape.trim} 2`}
        />
      ))}
    </svg>
  );
}

const isDisabled = (host: HTMLElement) => host.matches(':disabled, [aria-disabled="true"]');
