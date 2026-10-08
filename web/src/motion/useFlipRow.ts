import { useLayoutEffect, useRef, type RefObject } from 'react';
import { MOTION } from './motionSystem';

/**
 * FLIP for a horizontal row of keyed children (`data-flip-key`): when the order
 * changes, tiles that stay slide to their new slot and new ones grow in. The
 * first render never animates, so opening Home does not replay it.
 */
export function useFlipRow<T extends HTMLElement>(signature: string, enabled: boolean): RefObject<T | null> {
  const rowRef = useRef<T | null>(null);
  const previous = useRef<Map<string, number> | null>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || !enabled) return;
    const items = Array.from(row.querySelectorAll<HTMLElement>(':scope > [data-flip-key]'));
    for (const item of items) {
      item.getAnimations().forEach(animation => {
        if ((animation as Animation & { id: string }).id === 'flip') animation.cancel();
      });
    }

    const origin = row.getBoundingClientRect().left - row.scrollLeft;
    const next = new Map<string, number>();
    for (const item of items) next.set(item.dataset.flipKey!, item.getBoundingClientRect().left - origin);

    const before = previous.current;
    previous.current = next;
    if (!before || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    for (const item of items) {
      const key = item.dataset.flipKey!;
      const from = before.get(key);
      const to = next.get(key)!;
      if (from === undefined) {
        item.animate(
          [
            { opacity: 0, transform: 'scale(0.82) translateY(10px)' },
            { opacity: 1, transform: 'scale(1) translateY(0)' },
          ],
          { id: 'flip', duration: MOTION.transform, easing: MOTION.easeEnter, delay: 120, fill: 'backwards' },
        );
      } else if (Math.abs(from - to) > 1) {
        item.animate(
          [{ transform: `translateX(${from - to}px)` }, { transform: 'translateX(0)' }],
          { id: 'flip', duration: MOTION.transform + 80, easing: MOTION.easeEnter },
        );
      }
    }
  }, [signature, enabled]);

  return rowRef;
}
