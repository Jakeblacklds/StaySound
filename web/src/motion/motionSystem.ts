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

/** Position of an element ignoring every transform on it and its ancestors, so a
    destination that is still mid-reveal (the player bar slides up on first play)
    can be targeted at the place it is about to settle. */
function layoutRect(element: HTMLElement) {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = element;
  while (node) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { left, top, width: element.offsetWidth, height: element.offsetHeight };
}

/**
 * Lifts the artwork of `source` off the page and lands it on `destinationSelector`
 * once `update` has rendered it. The destination is expected to be a *new* element
 * (the player bar keys its art on the track), which is how we know the update landed.
 * Always WAAPI, never a View Transition: WKWebView's shared-element support is
 * unreliable and this has to look the same everywhere.
 */
export function flyArtwork(
  source: HTMLElement | null,
  destinationSelector: string,
  update: () => void,
): void {
  const disc = source?.querySelector<HTMLElement>('.circ-art-disc') ?? null;
  if (!disc || !disc.isConnected || reduceMotion()) {
    update();
    return;
  }

  const barExisted = Boolean(document.querySelector('.circ-player-bar'));
  const previousDestination = document.querySelector(destinationSelector);
  const rect = disc.getBoundingClientRect();
  const clone = disc.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, {
    position: 'fixed',
    zIndex: '60',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    borderRadius: '50%',
    overflow: 'hidden',
    pointerEvents: 'none',
    transformOrigin: 'top left',
    willChange: 'transform',
  });
  clone.setAttribute('aria-hidden', 'true');
  document.body.appendChild(clone);
  document.documentElement.dataset.artFlight = '1';

  let finished = false;
  let destination: HTMLElement | null = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    clone.remove();
    delete document.documentElement.dataset.artFlight;
    if (destination) {
      destination.style.visibility = '';
      destination.animate(
        [
          { transform: 'scale(1.14)', filter: 'brightness(1.25)' },
          { transform: 'scale(1)', filter: 'brightness(1)' },
        ],
        { duration: 420, easing: MOTION.easeEnter },
      );
    }
  };

  update();

  const startedAt = performance.now();
  const poll = () => {
    if (finished) return;
    const candidate = document.querySelector<HTMLElement>(destinationSelector);
    if (candidate && candidate !== previousDestination) {
      destination = candidate;
      destination.style.visibility = 'hidden';
      const target = barExisted ? destination.getBoundingClientRect() : layoutRect(destination);
      const scale = rect.width > 0 ? target.width / rect.width : 1;
      const translateX = target.left - rect.left;
      const translateY = target.top - rect.top;
      const animation = clone.animate(
        [
          { transform: 'translate3d(0, 0, 0) scale(1)', boxShadow: '0 0 0 rgba(0,0,0,0)' },
          {
            offset: 0.16,
            transform: 'translate3d(0, -8px, 0) scale(1.07)',
            boxShadow: '0 18px 34px rgba(0,0,0,0.55)',
          },
          {
            transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`,
            boxShadow: '0 4px 10px rgba(0,0,0,0.25)',
          },
        ],
        { duration: barExisted ? 560 : 780, easing: 'cubic-bezier(.3, 0, .15, 1)', fill: 'forwards' },
      );
      animation.finished.catch(() => undefined).finally(finish);
      return;
    }
    if (performance.now() - startedAt > 1400) {
      finish();
      return;
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}
