import { flushSync } from 'react-dom';

export type MotionDirection = 'forward' | 'backward' | 'vertical';

export const MOTION = {
  quick: 140,
  standard: 240,
  transform: 440,
  exit: 280,
  easeStandard: 'cubic-bezier(.2, 0, 0, 1)',
  easeEnter: 'cubic-bezier(.16, 1, .3, 1)',
  easeExit: 'cubic-bezier(.4, 0, 1, 1)',
} as const;

interface SharedElementSpec {
  source: Element | null;
  destination: string;
  kind?: 'surface' | 'text';
}

interface MotionTransitionOptions {
  direction?: MotionDirection;
  shared?: SharedElementSpec[];
}

function reduceMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function setDirection(direction: MotionDirection): void {
  document.documentElement.dataset.motionDirection = direction;
}

function copyForFlight(source: Element, kind: 'surface' | 'text') {
  const rect = source.getBoundingClientRect();
  const computed = window.getComputedStyle(source);
  const clone = source.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, {
    position: 'fixed',
    // Desktop flights stay below the persistent player (40).
    zIndex: document.querySelector('.circ-app-shell') ? '30' : '10000',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    pointerEvents: 'none',
    transformOrigin: 'top left',
    overflow: kind === 'surface' ? 'hidden' : 'visible',
    borderRadius: computed.borderRadius,
    color: computed.color,
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    fontWeight: computed.fontWeight,
    lineHeight: computed.lineHeight,
    letterSpacing: computed.letterSpacing,
    textAlign: computed.textAlign,
    whiteSpace: computed.whiteSpace,
    backgroundColor: kind === 'surface' ? computed.backgroundColor : 'transparent',
    boxShadow: kind === 'surface' ? computed.boxShadow : 'none',
    viewTransitionName: 'none',
    contain: 'paint',
    willChange: 'transform, opacity',
  });
  clone.setAttribute('aria-hidden', 'true');
  document.body.appendChild(clone);
  return { clone, rect, borderRadius: computed.borderRadius, kind };
}

/**
 * Runs a route transition with a native View Transition when available and a
 * WAAPI FLIP fallback for WKWebView. The fallback is what keeps Tauri/macOS
 * spatially continuous even though Safari does not expose shared elements.
 */
export function runMotionTransition(
  update: () => void,
  { direction = 'forward', shared = [] }: MotionTransitionOptions = {},
): void {
  setDirection(direction);
  if (reduceMotion()) {
    flushSync(update);
    return;
  }

  const transitionDocument = document as Document & {
    startViewTransition?: (callback: () => void) => unknown;
  };
  const forceFallback = new URLSearchParams(window.location.search).has('motionFallback');
  if (transitionDocument.startViewTransition && !forceFallback) {
    document.documentElement.dataset.motionEngine = 'native';
    transitionDocument.startViewTransition(() => flushSync(update));
    return;
  }

  document.documentElement.dataset.motionEngine = 'fallback';

  const flights = shared
    .filter((item): item is SharedElementSpec & { source: Element } => Boolean(item.source))
    .map(item => ({ ...copyForFlight(item.source, item.kind ?? 'surface'), destination: item.destination }));

  flushSync(update);
  const resolvedFlights = flights.map(flight => {
    const destinationElement = document.querySelector<HTMLElement>(flight.destination);
    if (destinationElement) destinationElement.style.opacity = '0';
    return { ...flight, destinationElement };
  });

  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const flight of resolvedFlights) {
      const destination = flight.destinationElement;
      if (!destination) {
        flight.clone.remove();
        continue;
      }

      const target = destination.getBoundingClientRect();
      const targetStyle = window.getComputedStyle(destination);
      const translateX = target.left - flight.rect.left;
      const translateY = target.top - flight.rect.top;
      const scaleX = flight.rect.width > 0 ? target.width / flight.rect.width : 1;
      const scaleY = flight.rect.height > 0 ? target.height / flight.rect.height : 1;
      const animation = flight.clone.animate([
        {
          transform: 'translate3d(0, 0, 0) scale(1, 1)',
          borderRadius: flight.borderRadius,
          opacity: 1,
        },
        {
          transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`,
          borderRadius: targetStyle.borderRadius,
          opacity: 1,
        },
      ], {
        duration: MOTION.transform,
        easing: MOTION.easeEnter,
        fill: 'forwards',
      });

      animation.finished.catch(() => undefined).finally(() => {
        flight.clone.remove();
        destination.style.opacity = '';
        destination.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: MOTION.quick, easing: MOTION.easeStandard },
        );
      });
    }
  }));
}
