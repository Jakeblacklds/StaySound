/**
 * The Android ChromeMotion values, on requestAnimationFrame: a timed curve, and a physical
 * spring (Android's SpringForce: stiffness/mass, damping ratio damping/(2√(k·m))) that
 * keeps its velocity when retargeted mid-flight.
 */
export class Motion {
  value: number;
  private velocity = 0;
  private frame = 0;
  constructor(initial: number, private readonly changed: () => void) { this.value = initial; }

  snap(target: number) { this.cancel(); this.velocity = 0; this.set(target); }
  cancel() { if (this.frame) cancelAnimationFrame(this.frame); this.frame = 0; }

  curve(target: number, duration: number, easing: (t: number) => number = t => t, then?: () => void) {
    this.cancel();
    if (reducedMotion()) { this.snap(target); then?.(); return; }
    const from = this.value; const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      this.set(from + (target - from) * easing(t));
      this.velocity = 0;
      if (t < 1) this.frame = requestAnimationFrame(step); else { this.frame = 0; then?.(); }
    };
    this.frame = requestAnimationFrame(step);
  }

  spring(target: number, damping: number, stiffness: number, mass: number) {
    this.cancel();
    if (reducedMotion()) { this.snap(target); return; }
    const k = stiffness / mass; const c = 2 * Math.sqrt(k) * (damping / (2 * Math.sqrt(stiffness * mass)));
    let last = performance.now();
    const step = (now: number) => {
      let dt = Math.min(0.064, (now - last) / 1000); last = now;
      // Semi-implicit Euler in 2 ms substeps: stable for these stiffnesses.
      while (dt > 0) {
        const h = Math.min(0.002, dt); dt -= h;
        this.velocity += (-k * (this.value - target) - c * this.velocity) * h;
        this.value += this.velocity * h;
      }
      this.changed();
      if (Math.abs(this.value - target) < 0.001 && Math.abs(this.velocity) < 0.01) { this.velocity = 0; this.set(target); this.frame = 0; }
      else this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private set(value: number) { this.value = value; this.changed(); }
}

/** cubic-bezier(x1, y1, x2, y2) as an easing function. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const bez = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    let lo = 0; let hi = 1;
    for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (bez(mid, x1, x2) < x) lo = mid; else hi = mid; }
    return bez((lo + hi) / 2, y1, y2);
  };
}

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
