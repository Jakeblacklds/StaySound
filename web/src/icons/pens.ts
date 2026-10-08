import type { IconPen } from './stayIcons';

type Matrix = [number, number, number, number, number, number]; // a b c d e f

/** Shared transform stack + path builder; subclasses decide what a paint call produces. */
abstract class PathPen implements IconPen {
  protected m: Matrix = [1, 0, 0, 1, 0, 0];
  private stack: Matrix[] = [];
  protected d: string[] = [];
  private empty = true;

  private concat(a: number, b: number, c: number, d: number, e: number, f: number) {
    const [A, B, C, D, E, F] = this.m;
    this.m = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
  }
  save() { this.stack.push([...this.m] as Matrix); }
  restore() { this.m = this.stack.pop() ?? [1, 0, 0, 1, 0, 0]; }
  translate(x: number, y: number) { this.concat(1, 0, 0, 1, x, y); }
  rotate(degrees: number, px: number, py: number) {
    const r = (degrees * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r);
    this.translate(px, py); this.concat(c, s, -s, c, 0, 0); this.translate(-px, -py);
  }
  scale(sx: number, sy: number, px: number, py: number) { this.translate(px, py); this.concat(sx, 0, 0, sy, 0, 0); this.translate(-px, -py); }
  skewX(k: number) { this.concat(1, 0, k, 1, 0, 0); }
  begin() { this.d = []; this.empty = true; }
  moveTo(x: number, y: number) { this.d.push(`M${n(x)} ${n(y)}`); this.empty = false; }
  lineTo(x: number, y: number) { this.d.push(`L${n(x)} ${n(y)}`); }
  quadTo(x1: number, y1: number, x: number, y: number) { this.d.push(`Q${n(x1)} ${n(y1)} ${n(x)} ${n(y)}`); }
  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    this.d.push(`C${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x)} ${n(y)}`);
  }
  arc(cx: number, cy: number, r: number, start: number, sweep: number) {
    const at = (deg: number) => { const a = (deg * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const [sx, sy] = at(start);
    this.d.push(`${this.empty ? 'M' : 'L'}${n(sx)} ${n(sy)}`); this.empty = false;
    // SVG arcs are drawn in ≤90° pieces so a sweep near 360° never degenerates.
    let done = 0;
    while (Math.abs(done) < Math.abs(sweep) - 1e-6) {
      const next = Math.abs(sweep - done) <= 90 ? sweep : done + Math.sign(sweep) * 90;
      const [ex, ey] = at(start + next);
      this.d.push(`A${n(r)} ${n(r)} 0 0 ${sweep > 0 ? 1 : 0} ${n(ex)} ${n(ey)}`);
      done = next;
    }
  }
  circle(cx: number, cy: number, r: number) {
    this.d.push(`M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx + r)} ${n(cy)}Z`);
    this.empty = false;
  }
  roundRect(l: number, t: number, r: number, b: number, radius: number) {
    const q = Math.min(radius, (r - l) / 2, (b - t) / 2);
    this.d.push(`M${n(l + q)} ${n(t)}H${n(r - q)}A${n(q)} ${n(q)} 0 0 1 ${n(r)} ${n(t + q)}V${n(b - q)}A${n(q)} ${n(q)} 0 0 1 ${n(r - q)} ${n(b)}`
      + `H${n(l + q)}A${n(q)} ${n(q)} 0 0 1 ${n(l)} ${n(b - q)}V${n(t + q)}A${n(q)} ${n(q)} 0 0 1 ${n(l + q)} ${n(t)}Z`);
    this.empty = false;
  }
  svgPath(d: string) { this.d.push(d); this.empty = false; }
  close() { this.d.push('Z'); }
  abstract stroke(width: number, opacity?: number): void;
  abstract fill(opacity?: number): void;
  abstract solid(round?: number, opacity?: number): void;
  abstract strokeTrim(width: number, end: number): void;
}

const n = (value: number) => String(Math.round(value * 1000) / 1000);

export interface IconShape {
  d: string;
  transform: string;
  fill?: number;
  stroke?: number;
  width?: number;
  /** Fraction of the path to stroke (draw-on); undefined = whole path. */
  trim?: number;
}

/** Collects the shapes an icon paints, ready to render as <path> elements in currentColor. */
export class SvgPen extends PathPen {
  shapes: IconShape[] = [];
  private emit(shape: Omit<IconShape, 'd' | 'transform'>) {
    this.shapes.push({ d: this.d.join(''), transform: `matrix(${this.m.map(n).join(' ')})`, ...shape });
  }
  stroke(width: number, opacity = 1) { this.emit({ stroke: opacity, width }); }
  fill(opacity = 1) { this.emit({ fill: opacity }); }
  solid(round = 2, opacity = 1) { this.emit({ fill: opacity, stroke: opacity, width: round }); }
  strokeTrim(width: number, end: number) { if (end > 0) this.emit({ stroke: 1, width, trim: Math.min(1, end) }); }
}

/** Every call as `op arg…`, numbers rounded; the golden fixture Android replays against. */
export class RecordingPen implements IconPen {
  ops: string[] = [];
  private rec(op: string, ...args: Array<number | string>) {
    this.ops.push([op, ...args.map(a => (typeof a === 'number' ? String(Math.round(a * 1e4) / 1e4) : a))].join(' '));
  }
  save() { this.rec('save'); }
  restore() { this.rec('restore'); }
  translate(x: number, y: number) { this.rec('translate', x, y); }
  rotate(d: number, px: number, py: number) { this.rec('rotate', d, px, py); }
  scale(sx: number, sy: number, px: number, py: number) { this.rec('scale', sx, sy, px, py); }
  skewX(k: number) { this.rec('skewX', k); }
  begin() { this.rec('begin'); }
  moveTo(x: number, y: number) { this.rec('moveTo', x, y); }
  lineTo(x: number, y: number) { this.rec('lineTo', x, y); }
  quadTo(a: number, b: number, x: number, y: number) { this.rec('quadTo', a, b, x, y); }
  cubicTo(a: number, b: number, c: number, d: number, x: number, y: number) { this.rec('cubicTo', a, b, c, d, x, y); }
  arc(cx: number, cy: number, r: number, s: number, w: number) { this.rec('arc', cx, cy, r, s, w); }
  circle(cx: number, cy: number, r: number) { this.rec('circle', cx, cy, r); }
  roundRect(l: number, t: number, r: number, b: number, q: number) { this.rec('roundRect', l, t, r, b, q); }
  svgPath(d: string) { this.rec('svgPath', d.length); }
  close() { this.rec('close'); }
  stroke(w: number, o = 1) { this.rec('stroke', w, o); }
  fill(o = 1) { this.rec('fill', o); }
  solid(r = 2, o = 1) { this.rec('solid', r, o); }
  strokeTrim(w: number, e: number) { this.rec('strokeTrim', w, e); }
}
