/**
 * StaySound's icon language, drawn as motion. Source of truth for web/Tauri; the Android
 * port (modules/player-chrome/.../StayIcons.kt) is pinned to it by a golden fixture
 * (scripts/tests/stay-icons-golden-cases.ts → StayIconsGoldenTest). Change both together.
 *
 * Everything is built from the S logo: its -20° lean, round 2.1–2.4 strokes, solid wedges and
 * slabs, the tapered speed tail. 24-unit grid. Inputs:
 *  - press: squashes/winds back while held and swings past rest on the spring release;
 *  - flourish: runs 0→1 once per tap and rests at 1, where every pose is its rest pose;
 *  - state: an icon's own 0..1 (heart filled, tab selected, play→pause morph, volume level).
 */

/** Drawing surface. Transforms pre-concatenate like Canvas; shape calls append to one current path. */
export interface IconPen {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(degrees: number, px: number, py: number): void;
  scale(sx: number, sy: number, px: number, py: number): void;
  skewX(k: number): void;
  begin(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadTo(x1: number, y1: number, x: number, y: number): void;
  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  /** Appends an arc of the circle (cx, cy, r); clockwise for positive sweep (degrees, y down). */
  arc(cx: number, cy: number, r: number, start: number, sweep: number): void;
  circle(cx: number, cy: number, r: number): void;
  roundRect(left: number, top: number, right: number, bottom: number, radius: number): void;
  /** Appends SVG path data (used for the S mark, authored in its own 1024 space). */
  svgPath(d: string): void;
  close(): void;
  stroke(width: number, opacity?: number): void;
  fill(opacity?: number): void;
  /** Fill plus a round-joined stroke, which softens hard polygon corners. */
  solid(round?: number, opacity?: number): void;
  /** Strokes the leading `end` fraction (0..1) of the current path. */
  strokeTrim(width: number, end: number): void;
}

const W = 2.1;
/** tan(-20°): the logo's forward lean. */
export const ITALIC = -0.36397;
const DIAGONAL = 0.70710677;

/** assets/images/icon.png traced in its 1024 space, centred on (503, 511). */
export const S_MARK =
  'M198 510C250 508 280 500 300 490C380 440 430 340 580 320L808 320L715 400C700 412 680 418 660 418'
  + 'L515 418C470 418 452 448 458 470C462 486 478 493 495 493L690 493C715 495 722 515 715 535'
  + 'C700 570 650 640 560 680C520 698 470 702 430 702L232 702L365 592L490 592C540 592 568 565 572 540'
  + 'C574 522 560 512 540 512L198 512Z';

// ── beats ───────────────────────────────────────────────────────────────────────────────
/** Local 0..1 progress of a beat that starts at `start` and lasts `duration` of the flourish. */
export const seg = (f: number, start: number, duration: number) => Math.min(1, Math.max(0, (f - start) / duration));
/** One arc up and back down; zero outside its beat. */
export function hop(f: number, start: number, duration: number) {
  const u = seg(f, start, duration);
  return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u);
}
/** A decaying one-and-a-half swing; zero outside its beat. */
export function wobble(f: number, start: number, duration: number) {
  const u = seg(f, start, duration);
  return u <= 0 || u >= 1 ? 0 : Math.exp(-4.2 * u) * Math.sin(2 * Math.PI * 1.6 * u);
}
const outCubic = (u: number) => 1 - (1 - u) ** 3;
function outBack(u: number) { const c = 1.7; const v = u - 1; return 1 + (c + 1) * v * v * v + c * v * v; }

// ── catalogue ───────────────────────────────────────────────────────────────────────────
const ALIASES: Record<string, string> = {
  'chevron-down': 'down', 'chevron-right': 'forward', 'arrow-left': 'back',
  'dots-horizontal': 'more', 'dots-vertical': 'more-vertical',
  'heart-outline': 'heart', 'trash-can-outline': 'trash',
  'playlist-play': 'queue', 'playlist-music': 'lyrics', 'playlist-plus': 'playlist-add',
  'layers-outline': 'layers', 'format-font': 'font', magnify: 'search',
  'account-music': 'artist', person: 'artist', album: 'disc', 'music-note': 'music',
  'share-variant': 'share', 'star-four-points': 'stardust', cricket: 'neon',
  candle: 'ember', water: 'silk', blur: 'aurora', 'spotlight-beam': 'columns',
  'sine-wave': 'caustics', 'diamond-stone': 'refraction',
  'circle-outline': 'circle', done: 'check', success: 'check', 'skip-next': 'next',
  'skip-previous': 'previous', 'repeat-once': 'repeat-one',
};

export const KINDS = [
  'back', 'forward', 'down', 'close', 'add', 'more', 'more-vertical', 'check', 'search',
  'settings', 'refresh', 'download', 'heart', 'trash', 'drag', 'queue', 'lyrics', 'playlist',
  'playlist-add', 'disc', 'artist', 'music', 'edit', 'playing', 'play', 'pause', 'shuffle',
  'next', 'previous', 'error', 'alert', 'warning', 'info', 'equalizer', 'share', 'layers',
  'check-circle', 'circle', 'font', 'stardust', 'aurora', 'neon', 'ember', 'silk', 'columns',
  'caustics', 'refraction',
  // Dock, transport and desktop-only kinds.
  'tab-home', 'tab-library', 'tab-search', 'tab-playlists', 'play-pause', 'repeat', 'repeat-one',
  'volume', 'volume-mute', 'mic', 'seek-back', 'seek-forward', 'keyboard', 'phone', 'folder',
  'sync', 'spinner', 'undo', 'redo',
] as const;
export type StayIconKind = (typeof KINDS)[number];

/** Kinds that play a bespoke beat on release; the rest only squash under the finger. */
export const ANIMATED = new Set<string>([
  'back', 'forward', 'down', 'close', 'add', 'more', 'more-vertical', 'check', 'search',
  'settings', 'refresh', 'download', 'heart', 'trash', 'queue', 'lyrics', 'playlist',
  'playlist-add', 'disc', 'artist', 'music', 'edit', 'share', 'equalizer', 'play', 'next',
  'previous', 'shuffle', 'check-circle', 'stardust', 'aurora', 'neon', 'ember', 'silk',
  'columns', 'caustics', 'refraction',
  'tab-home', 'tab-library', 'tab-search', 'tab-playlists', 'play-pause', 'repeat', 'repeat-one',
  'volume', 'volume-mute', 'mic', 'seek-back', 'seek-forward', 'sync', 'undo', 'redo',
]);

/** Kinds that wind back themselves, so they skip the generic squash. */
const SELF_PRESSED = new Set<string>([
  'back', 'forward', 'search', 'play', 'pause', 'next', 'previous', 'shuffle', 'queue', 'download', 'share',
  'playlist', 'playlist-add', 'tab-home', 'tab-library', 'tab-search', 'tab-playlists', 'play-pause', 'repeat',
  'repeat-one', 'undo', 'redo',
]);

const KIND_SET = new Set<string>(KINDS);
export function resolveIcon(name: string): StayIconKind | null {
  const kind = ALIASES[name] ?? name;
  return KIND_SET.has(kind) ? (kind as StayIconKind) : null;
}
/** Icons whose filled variant is expressed through the state input. */
export const stateOf = (name: string) => (name === 'heart' || name === 'check-circle' ? 1 : 0);

const SLIDER_KNOB = [8, 15.4, 10.4];
const EQ_KNOB = [14, 8, 12.4];
const PLAYING = [7, 14.6, 10.4];
const COLUMNS = [11, 16.4, 8.2];
const SLEEVES = [1, 0.7, 0.45];
const AURORA = [1, 0.72, 0.45];
const TAB_TAIL = [2.8, 4.6, 6.4];
const TAB_HEAD = [20.2, 17, 13.8];
/** Play splits into two quads (a trapezoid and a degenerate tip) so it morphs vertex-for-vertex into pause. */
const PLAY_QUADS = [6.5, 4.5, 13.25, 8.25, 13.25, 15.75, 6.5, 19.5, 13.25, 8.25, 20, 12, 20, 12, 13.25, 15.75];
const PAUSE_QUADS = [5, 4.6, 10.2, 4.6, 10.2, 19.4, 5, 19.4, 13.8, 4.6, 19, 4.6, 19, 19.4, 13.8, 19.4];

export function drawStayIcon(pen: IconPen, kind: StayIconKind, press = 0, flourish = 1, state = 0): void {
  const p = press;
  const f = flourish;
  pen.save();
  // The generic squash: every icon gives a little under the finger.
  const squash = SELF_PRESSED.has(kind) ? 0 : p;
  pen.scale(1 - 0.1 * squash, 1 - 0.1 * squash, 12, 12);
  switch (kind) {
    case 'back': pen.scale(-1, 1, 12, 12); forward(pen, p, f, true); break;
    case 'forward': forward(pen, p, f, false); break;
    case 'down': italic(pen, () => {
      const y = 1.2 * p + 2.2 * hop(f, 0, 0.4) - 0.6 * hop(f, 0.4, 0.25);
      pen.begin(); pen.moveTo(5, 9 + y); pen.lineTo(12, 16 + y); pen.lineTo(19, 9 + y); pen.stroke(2.4);
    }); break;
    case 'close': case 'add': italic(pen, () => {
      pen.rotate(90 * outBack(seg(f, 0, 0.55)) - 90, 12, 12);
      pen.begin();
      if (kind === 'close') { pen.moveTo(6.2, 6.2); pen.lineTo(17.8, 17.8); pen.moveTo(17.8, 6.2); pen.lineTo(6.2, 17.8); }
      else { pen.moveTo(12, 4.5); pen.lineTo(12, 19.5); pen.moveTo(4.5, 12); pen.lineTo(19.5, 12); }
      pen.stroke(2.4);
    }); break;
    case 'more': case 'more-vertical':
      if (kind === 'more-vertical') pen.rotate(90, 12, 12);
      italic(pen, () => {
        for (let i = 0; i <= 2; i++) {
          const x = 3.6 + i * 6.4; const y = -1.8 * hop(f, i * 0.1, 0.35);
          pen.begin(); pen.roundRect(x, 10.3 + y, x + 3.6, 13.7 + y, 1.2); pen.fill();
        }
      }); break;
    case 'check': italic(pen, () => {
      pen.begin(); pen.moveTo(5, 12.6); pen.lineTo(10, 17.6); pen.lineTo(19.6, 6.6);
      pen.strokeTrim(2.5, outCubic(seg(f, 0, 0.45)));
    }); break;
    case 'check-circle': case 'circle': italic(pen, () => {
      pen.begin(); pen.circle(12, 12, 9);
      if (state > 0) pen.fill(0.22 * state);
      pen.stroke(W);
      if (kind === 'check-circle') {
        pen.begin(); pen.moveTo(7.8, 12.4); pen.lineTo(10.8, 15.4); pen.lineTo(16.4, 8.8);
        pen.strokeTrim(2.3, outCubic(seg(f, 0, 0.45)));
      }
    }); break;
    case 'search': italic(pen, () => {
      const dash = hop(f, 0, 0.45);
      const cx = 14.4 - 1.4 * p + 1.6 * dash + 0.6 * wobble(f, 0.3, 0.6);
      pen.begin(); pen.circle(cx, 10.4, 5); pen.stroke(2.4);
      const h = cx + 5.6 * DIAGONAL; const hy = 10.4 + 5.6 * DIAGONAL;
      pen.begin(); pen.moveTo(h, hy); pen.lineTo(h + 3.2, hy + 3.2); pen.stroke(2.6);
      const reach = 2.6 * dash - 1.6 * p;
      streak(pen, 1.6 - reach, cx - 7.2, 8.4, 1.5, 0.9);
      streak(pen, 3.4 - reach, cx - 7.2, 12.6, 1.3, 0.6);
    }); break;
    case 'settings': italic(pen, () => {
      for (let i = 0; i <= 2; i++) {
        const y = 5.5 + i * 6.5;
        pen.begin(); pen.moveTo(3.5, y); pen.lineTo(20.5, y); pen.stroke(1.9, 0.55);
        const x = SLIDER_KNOB[i] + 2.6 * wobble(f, i * 0.1, 0.7) * (i === 1 ? -1 : 1);
        pen.begin(); pen.roundRect(x - 1.8, y - 2.6, x + 1.8, y + 2.6, 1.2); pen.fill();
      }
    }); break;
    case 'equalizer': italic(pen, () => {
      for (let i = 0; i <= 2; i++) {
        const x = 6 + i * 6;
        pen.begin(); pen.moveTo(x, 3.5); pen.lineTo(x, 20.5); pen.stroke(1.9, 0.55);
        const y = EQ_KNOB[i] + 3 * wobble(f, i * 0.1, 0.7) * (i === 1 ? 1 : -1);
        pen.begin(); pen.roundRect(x - 2.6, y - 1.7, x + 2.6, y + 1.7, 1.1); pen.fill();
      }
    }); break;
    case 'refresh': italic(pen, () => {
      pen.rotate(360 * outCubic(seg(f, 0, 0.7)) - 360 + 30 * p, 12, 12);
      pen.begin(); pen.arc(12, 12, 7.4, -50, 272); pen.stroke(2.3);
      arrowOnCircle(pen, 12, 12, 7.4, 230, 1);
    }); break;
    case 'sync': italic(pen, () => {
      // Two half-loops chasing each other; the pair turns half a lap on release.
      pen.rotate(180 * outCubic(seg(f, 0, 0.7)) - 180 + 24 * p, 12, 12);
      for (const start of [200, 20]) {
        pen.begin(); pen.arc(12, 12, 7.2, start, 118); pen.stroke(2.2);
        arrowOnCircle(pen, 12, 12, 7.2, start + 124, 0.85);
      }
    }); break;
    case 'spinner': italic(pen, () => {
      pen.begin(); pen.arc(12, 12, 8.2, -90, 270); pen.stroke(2.3);
      pen.begin(); pen.circle(12 + 8.2, 12, 1.45); pen.fill();
    }); break;
    case 'download': italic(pen, () => {
      const drop = 1.4 * p + 3 * hop(f, 0, 0.35);
      const base = hop(f, 0.28, 0.25);
      pen.begin(); pen.moveTo(12, 3.4 + drop * 0.5); pen.lineTo(12, 12.6 + drop); pen.stroke(2.4);
      wedge(pen, 7, 10.4 + drop, 17, 10.4 + drop, 12, 16.4 + drop);
      pen.begin(); pen.roundRect(4.2 - base, 18.4 + 0.6 * base, 19.8 + base, 21, 1.2); pen.fill();
    }); break;
    case 'heart': italic(pen, () => {
      // The lean throws the lobes right; pull the heart back onto the grid's centre.
      const pump = 0.9 * (1 + 0.2 * hop(f, 0, 0.3) + 0.07 * hop(f, 0.32, 0.22));
      pen.translate(-1.1, 0); pen.scale(pump, pump, 12, 12.5);
      pen.begin(); heart(pen);
      if (state > 0) pen.fill(state);
      pen.stroke(W);
    }); break;
    case 'trash': italic(pen, () => {
      const lift = hop(f, 0, 0.5);
      pen.save(); pen.translate(0, -2.2 * lift); pen.rotate(-14 * lift, 4, 6.4);
      pen.begin(); pen.moveTo(4, 6.4); pen.lineTo(20, 6.4); pen.moveTo(9.4, 6.4); pen.lineTo(9.8, 3.8);
      pen.lineTo(14.2, 3.8); pen.lineTo(14.6, 6.4); pen.stroke(W);
      pen.restore();
      pen.begin(); pen.moveTo(6.1, 8.9); pen.lineTo(7.3, 19.1); pen.quadTo(7.5, 20.8, 9.1, 20.8);
      pen.lineTo(14.9, 20.8); pen.quadTo(16.5, 20.8, 16.7, 19.1); pen.lineTo(17.9, 8.9); pen.stroke(W);
      pen.begin(); pen.moveTo(10.4, 11.6); pen.lineTo(10.6, 17.6); pen.moveTo(13.6, 11.6); pen.lineTo(13.4, 17.6); pen.stroke(1.6, 0.7);
    }); break;
    case 'drag': italic(pen, () => {
      pen.begin(); pen.moveTo(5, 9); pen.lineTo(19, 9); pen.moveTo(5, 15); pen.lineTo(19, 15); pen.stroke(2.3);
    }); break;
    case 'queue': italic(pen, () => {
      strokes(pen, p, f, 2, [20.4, 15.6]);
      const dash = 2 * hop(f, 0.1, 0.4) - p;
      wedge(pen, 14.2 + dash, 13.8, 14.2 + dash, 21.2, 21.2 + dash, 17.5);
    }); break;
    case 'playlist': italic(pen, () => strokes(pen, p, f, 3, [20.2, 17, 13.8])); break;
    case 'playlist-add': italic(pen, () => {
      strokes(pen, p, f, 2, [20.2, 12.6]);
      pen.save(); pen.rotate(90 * outBack(seg(f, 0, 0.55)) - 90, 17.2, 18.2);
      pen.begin(); pen.moveTo(17.2, 14.6); pen.lineTo(17.2, 21.8); pen.moveTo(13.6, 18.2); pen.lineTo(20.8, 18.2);
      pen.stroke(2.3); pen.restore();
    }); break;
    case 'lyrics': italic(pen, () => {
      for (let i = 0; i <= 1; i++) {
        const x = 7.6 + i * 8; const y = -2 * hop(f, i * 0.12, 0.36);
        pen.begin(); pen.circle(x, 8.6 + y, 3.3); pen.fill();
        pen.begin(); pen.moveTo(x + 3.1, 9.2 + y); pen.cubicTo(x + 3, 13.6 + y, x + 0.6, 16.8 + y, x - 3, 18.4 + y);
        pen.stroke(2.3);
      }
    }); break;
    case 'disc': italic(pen, () => {
      pen.begin(); pen.circle(12, 12, 8.6); pen.stroke(W);
      pen.begin(); pen.circle(12, 12, 2.2); pen.fill();
      pen.begin(); pen.arc(12, 12, 5.4, 205 + 720 * outCubic(seg(f, 0, 0.85)), 62); pen.stroke(1.6, 0.65);
    }); break;
    case 'artist': italic(pen, () => {
      const bob = -1.6 * hop(f, 0, 0.34) + 0.5 * hop(f, 0.34, 0.2);
      pen.begin(); pen.circle(12, 7.8 + bob, 3.9); pen.stroke(2.2);
      pen.begin(); pen.moveTo(4.6, 20.2); pen.cubicTo(5.4, 15.8, 8.4, 13.6, 12, 13.6);
      pen.cubicTo(15.6, 13.6, 18.6, 15.8, 19.4, 20.2); pen.stroke(2.2);
    }); break;
    case 'music': italic(pen, () => {
      const air = hop(f, 0, 0.42); const land = hop(f, 0.42, 0.2);
      pen.translate(0, -3 * air);
      pen.scale(1 + 0.08 * land, 1 - 0.12 * land, 12, 20.4);
      pen.begin(); pen.moveTo(11.8, 17.4); pen.lineTo(11.8, 3.8); pen.cubicTo(14.8, 4.6, 17.8, 5.8, 18.4, 9.6); pen.stroke(2.2);
      pen.save(); pen.rotate(-20, 8.6, 17.4);
      pen.begin(); pen.roundRect(5.2, 15, 12, 19.8, 2.4); pen.fill();
      pen.restore();
    }); break;
    case 'mic': italic(pen, () => {
      const lift = -1.6 * hop(f, 0, 0.36) + 0.4 * hop(f, 0.36, 0.2);
      pen.begin(); pen.roundRect(9, 2.8 + lift, 15, 14.2 + lift, 3); pen.fill(0.22 + 0.78 * state); pen.stroke(W);
      pen.begin(); pen.moveTo(5.6, 10.8); pen.quadTo(5.6, 17.6, 12, 17.6); pen.quadTo(18.4, 17.6, 18.4, 10.8); pen.stroke(W);
      pen.begin(); pen.moveTo(12, 17.6); pen.lineTo(12, 21); pen.moveTo(8.6, 21); pen.lineTo(15.4, 21); pen.stroke(W);
    }); break;
    case 'edit': italic(pen, () => {
      pen.rotate(-12 * wobble(f, 0, 0.7), 5, 19);
      pen.begin(); pen.moveTo(14.6, 4.6); pen.lineTo(19.4, 9.4); pen.lineTo(9, 19.8); pen.lineTo(4.2, 19.8);
      pen.lineTo(4.2, 15); pen.close(); pen.stroke(W);
      pen.begin(); pen.moveTo(12.4, 6.8); pen.lineTo(17.2, 11.6); pen.stroke(W);
    }); break;
    case 'playing': case 'columns': italic(pen, () => {
      const heights = kind === 'playing' ? PLAYING : COLUMNS;
      for (let i = 0; i <= 2; i++) {
        const x = 4.2 + i * 5.8;
        const h = heights[i] * (1 + 0.25 * wobble(f, i * 0.08, 0.6));
        pen.begin(); pen.roundRect(x, 20.4 - h, x + 3.6, 20.4, 1.2); pen.fill(kind === 'columns' ? 0.55 + 0.45 * (i % 2) : 1);
      }
    }); break;
    case 'play': case 'pause': italic(pen, () => {
      const dash = hop(f, 0, 0.45);
      pen.translate(-p + 1.2 * dash, 0);
      pen.begin();
      if (kind === 'play') { pen.moveTo(6.5, 4.5); pen.lineTo(20, 12); pen.lineTo(6.5, 19.5); pen.close(); pen.solid(2.2); }
      else { pen.roundRect(5, 4.6, 10.2, 19.4, 1.3); pen.roundRect(13.8, 4.6, 19, 19.4, 1.3); pen.fill(); }
    }); break;
    case 'play-pause': {
      // A leaning wedge that splits into two leaning slabs (state 0 = play, 1 = pause).
      const dash = hop(f, 0, 0.45);
      if (dash > 0.02) italic(pen, () => {
        streak(pen, 1.5 - 2 * dash, 6.5, 9, 1.1, 0.5 * dash);
        streak(pen, 2.5 - 2 * dash, 6.8, 15, 1, 0.4 * dash);
      });
      pen.save();
      pen.translate(-p + 1.2 * dash, 0);
      pen.scale(1 - 0.1 * p + 0.12 * dash, 1 - 0.06 * p - 0.08 * dash, 12, 12);
      italic(pen, () => {
        for (let half = 0; half <= 1; half++) {
          pen.begin();
          for (let corner = 0; corner <= 3; corner++) {
            const i = half * 8 + corner * 2;
            const x = PLAY_QUADS[i] + (PAUSE_QUADS[i] - PLAY_QUADS[i]) * state;
            const y = PLAY_QUADS[i + 1] + (PAUSE_QUADS[i + 1] - PLAY_QUADS[i + 1]) * state;
            if (corner === 0) pen.moveTo(x, y); else pen.lineTo(x, y);
          }
          pen.close(); pen.solid(2.2);
        }
      });
      pen.restore();
    } break;
    case 'next': case 'previous':
      if (kind === 'previous') pen.scale(-1, 1, 12, 12);
      italic(pen, () => {
        const x = -1.6 * p + 2.6 * hop(f, 0, 0.4);
        const reach = 3 * hop(f, 0, 0.4) - 1.5 * p;
        const echo = hop(f, 0.05, 0.5);
        streak(pen, 2.2 - reach, 8.6 + x * 0.4, 9.2, 1.4, 0.75);
        streak(pen, 3.8 - reach, 8.6 + x * 0.4, 14.8, 1.2, 0.5);
        if (echo > 0.02) wedge(pen, 9 + x - 3.4 * echo, 6.5, 9 + x - 3.4 * echo, 17.5, 18 + x - 3.4 * echo, 12, 0.35 * echo);
        wedge(pen, 10 + x, 6, 10 + x, 18, 19.2 + x, 12);
      }); break;
    case 'seek-back': case 'seek-forward':
      italic(pen, () => {
        // Ten seconds either way: a loop that kicks round with the digits riding inside.
        // Only the loop mirrors for seek-back; the digits must still read "10".
        pen.save();
        if (kind === 'seek-back') pen.scale(-1, 1, 12, 12);
        pen.rotate(-26 * p + 30 * wobble(f, 0, 0.7), 12, 12);
        pen.begin(); pen.arc(12, 12, 8.4, -5, 290); pen.stroke(2.2);
        arrowOnCircle(pen, 12, 12, 8.4, 291, 0.9);
        pen.restore();
        pen.begin(); pen.roundRect(8.3, 9.2, 10.1, 15, 0.8); pen.fill();
        pen.begin(); pen.circle(14.1, 12.1, 2.35); pen.stroke(1.8);
      }); break;
    case 'shuffle': italic(pen, () => {
      const head = 18.6 + 1.8 * hop(f, 0, 0.4) - 1.2 * p;
      const slide = 2.2 * wobble(f, 0.05, 0.8);
      for (let lane = 0; lane <= 1; lane++) {
        const y0 = lane === 0 ? 17.2 : 6.8; const y1 = lane === 0 ? 6.8 : 17.2;
        pen.begin(); pen.moveTo(3.2, y0); pen.cubicTo(9 + slide, y0, 12.4 + slide, y1, head - 1.4, y1); pen.stroke(2.3);
        wedge(pen, head - 1.6, y1 - 2.9, head - 1.6, y1 + 2.9, head + 2.2, y1);
      }
    }); break;
    case 'repeat': case 'repeat-one': {
      // A leaning loop whose gap and arrowhead run one full lap on release.
      const s = 1 - 0.1 * p;
      const start = 0.22 + outCubic(seg(f, 0, 0.85));
      pen.save(); pen.scale(s, s, 12, 12);
      italic(pen, () => {
        pen.begin();
        const from = start + 0.02; const to = start + 0.9;
        for (let i = 0; i <= LOOP_SAMPLES; i++) {
          const [x, y] = loopPoint(from + ((to - from) * i) / LOOP_SAMPLES)[0];
          if (i === 0) pen.moveTo(x, y); else pen.lineTo(x, y);
        }
        pen.stroke(2.2);
        const [[hx, hy], angle] = loopPoint(to);
        pen.save(); pen.translate(hx, hy); pen.rotate(angle, 0, 0);
        pen.begin(); pen.moveTo(-1.2, -3); pen.lineTo(3, 0); pen.lineTo(-1.2, 3); pen.close(); pen.solid(1.4);
        pen.restore();
        if (kind === 'repeat-one') { pen.begin(); pen.roundRect(11, 9.6, 13, 14.4, 0.9); pen.fill(); }
      });
      pen.restore();
    } break;
    case 'undo': case 'redo':
      if (kind === 'redo') pen.scale(-1, 1, 12, 12);
      italic(pen, () => {
        const dash = -1.8 * hop(f, 0, 0.4) + 1.2 * p;
        pen.begin(); pen.moveTo(7.4 + dash, 9.4); pen.lineTo(14.6, 9.4); pen.cubicTo(18.2, 9.4, 20.4, 11.8, 20.4, 14.9);
        pen.cubicTo(20.4, 18.1, 18.1, 20.4, 14.6, 20.4); pen.lineTo(10.6, 20.4); pen.stroke(2.2);
        wedge(pen, 8.8 + dash, 5.4, 8.8 + dash, 13.4, 3.4 + dash, 9.4);
      }); break;
    case 'error': case 'alert': case 'info': case 'warning': italic(pen, () => {
      if (kind === 'error') { pen.begin(); pen.circle(12, 12, 9); pen.stroke(W); }
      if (kind === 'warning') {
        pen.begin(); pen.moveTo(12, 3.8); pen.lineTo(21, 19.6); pen.lineTo(3, 19.6); pen.close(); pen.stroke(W);
      }
      const [top, bottom, dot] = kind === 'info' ? [10.6, 17.4, 6.8] : kind === 'warning' ? [9.4, 14.2, 17]
        : kind === 'error' ? [6.8, 13.2, 16.8] : [5, 14, 18.6];
      pen.begin(); pen.roundRect(10.9, top, 13.1, bottom, 1); pen.fill();
      pen.begin(); pen.circle(12, dot, 1.35); pen.fill();
    }); break;
    case 'share': italic(pen, () => {
      const launch = -3 * hop(f, 0, 0.4) + 1.2 * p;
      pen.begin(); pen.moveTo(5, 12.6); pen.lineTo(5, 18.6); pen.quadTo(5, 20.6, 7, 20.6);
      pen.lineTo(17, 20.6); pen.quadTo(19, 20.6, 19, 18.6); pen.lineTo(19, 12.6); pen.stroke(W);
      pen.begin(); pen.moveTo(12, 15.4); pen.lineTo(12, 6 + launch); pen.stroke(2.3);
      wedge(pen, 7.8, 8.6 + launch, 16.2, 8.6 + launch, 12, 3 + launch);
    }); break;
    case 'layers': italic(pen, () => {
      for (let i = 0; i <= 2; i++) {
        const x = 4.2 + (2 - i) * 1.1; const y = 4.8 + i * 5.2;
        pen.begin(); pen.roundRect(x, y, x + 12.6, y + 4, 1.2); pen.fill(SLEEVES[i]);
      }
    }); break;
    case 'font': italic(pen, () => {
      pen.begin(); pen.moveTo(4.6, 20); pen.lineTo(12, 4); pen.lineTo(19.4, 20); pen.moveTo(7.8, 14.4); pen.lineTo(16.2, 14.4);
      pen.stroke(2.3);
    }); break;
    case 'keyboard': italic(pen, () => {
      pen.begin(); pen.roundRect(2.8, 6.4, 21.2, 17.6, 2.4); pen.stroke(W);
      for (let i = 0; i <= 3; i++) { const x = 5.9 + i * 3.6; pen.begin(); pen.roundRect(x, 8.9, x + 1.9, 10.8, 0.6); pen.fill(); }
      pen.begin(); pen.roundRect(8, 13.3, 16, 14.9, 0.8); pen.fill();
    }); break;
    case 'phone': italic(pen, () => {
      pen.begin(); pen.roundRect(7, 2.8, 17, 21.2, 2.6); pen.stroke(W);
      pen.begin(); pen.roundRect(10.4, 17.3, 13.6, 18.5, 0.6); pen.fill();
    }); break;
    case 'folder': italic(pen, () => {
      pen.begin(); pen.moveTo(3.4, 7); pen.quadTo(3.4, 5.4, 5, 5.4); pen.lineTo(9.2, 5.4); pen.lineTo(11.2, 7.8);
      pen.lineTo(19, 7.8); pen.quadTo(20.6, 7.8, 20.6, 9.4); pen.lineTo(20.6, 17.4); pen.quadTo(20.6, 19, 19, 19);
      pen.lineTo(5, 19); pen.quadTo(3.4, 19, 3.4, 17.4); pen.close(); pen.stroke(W);
    }); break;
    case 'volume': case 'volume-mute': italic(pen, () => {
      speaker(pen);
      if (kind === 'volume-mute') {
        pen.save(); pen.rotate(90 * outBack(seg(f, 0, 0.55)) - 90, 17.6, 12);
        pen.begin(); pen.moveTo(15.2, 9.6); pen.lineTo(20, 14.4); pen.moveTo(20, 9.6); pen.lineTo(15.2, 14.4); pen.stroke(2.2);
        pen.restore();
      } else {
        // state is the level: the near wave shows from 0, the far one fades in past half.
        for (let i = 0; i <= 1; i++) {
          const level = i === 0 ? Math.min(1, state * 3) : Math.max(0, state * 2 - 1);
          if (level <= 0.01) continue;
          const r = (i === 0 ? 4.2 : 7.6) + 1.2 * hop(f, i * 0.12, 0.4);
          pen.begin(); pen.arc(11.4, 12, r, -48, 96); pen.stroke(2.1, level);
        }
      }
    }); break;
    case 'tab-home': {
      // The S itself: winds back (upright, drawn in) while held, dashes forward trailing speed lines.
      const dash = hop(f, 0, 0.5);
      if (dash > 0.01) {
        streak(pen, 1.2 - 2.2 * dash, 7.6, 9.2, 1.2, 0.55 * dash);
        streak(pen, 2.6 - 2.2 * dash, 8.4, 14.8, 1.1, 0.4 * dash);
      }
      pen.save();
      pen.translate(12 - 1.2 * p + 1.4 * dash, 12);
      pen.skewX(Math.tan(((14 * p - 11 * dash) * Math.PI) / 180));
      pen.scale(1 - 0.1 * p + 0.12 * dash, 1, 0, 0);
      pen.scale(S_SCALE, S_SCALE, 0, 0);
      pen.translate(-503, -511);
      pen.begin(); pen.svgPath(S_MARK); pen.fill();
      pen.restore();
    } break;
    case 'tab-library':
      // Three sleeves in a crate, the front one brightest; flicked forward in turn on release.
      for (let i = 0; i <= 2; i++) {
        const flick = hop(f, i * 0.1, 0.34);
        const x = 3.8 + (2 - i) * 1.2 - 1.3 * p * (1 + i * 0.3) + 1.8 * flick;
        const y = 4.6 + i * 5.4;
        italic(pen, () => {
          if (flick > 0.05) streak(pen, x - 6 * flick, x - 0.9, y + 2.1, 0.9, 0.55 * flick);
          pen.begin(); pen.roundRect(x, y, x + 13, y + 4.2, 1.2); pen.fill(SLEEVES[i]);
        });
      }
      break;
    case 'tab-search': italic(pen, () => {
      // A lens on the move: pulls back while held, lunges forward on release and settles.
      const dash = hop(f, 0, 0.45);
      const cx = 14.4 - 1.4 * p + 1.6 * dash + 0.6 * wobble(f, 0.3, 0.6);
      const r = 5 * (1 - 0.06 * p);
      pen.begin(); pen.circle(cx, 10.4, r);
      if (state > 0) pen.fill(0.22 * state);
      pen.stroke(2.5);
      const hx = cx + (r + 0.6) * DIAGONAL; const hy = 10.4 + (r + 0.6) * DIAGONAL;
      const handle = 3.2 * (1 - 0.3 * p);
      pen.begin(); pen.moveTo(hx, hy); pen.lineTo(hx + handle, hy + handle); pen.stroke(2.7);
      const reach = 2.6 * dash - 1.6 * p;
      streak(pen, 1.6 - reach, cx - r - 2.2, 8.4, 1.5, 0.9);
      streak(pen, 3.4 - reach, cx - r - 2.2, 12.6, 1.3, 0.6);
    }); break;
    case 'tab-playlists':
      // The S's tail three times: heads draw in while held, then the strokes whip out in turn.
      for (let i = 0; i <= 2; i++) {
        const x0 = TAB_TAIL[i]; const x1 = TAB_HEAD[i];
        const head = x1 - 1.8 * p * (1 + 0.2 * i) + (x1 - x0) * 0.14 * wobble(f, i * 0.09, 0.6);
        const tail = x0 + 1.2 * p - 1.6 * hop(f, i * 0.09, 0.35);
        italic(pen, () => streak(pen, tail, head, 5.8 + i * 6.2, 2.5, 1));
      }
      break;
    case 'stardust': italic(pen, () => {
      const tw = 1 + 0.3 * hop(f, 0, 0.35); const tw2 = 1 + 0.5 * hop(f, 0.18, 0.35);
      star(pen, 10.4, 13, 7.6 * tw); pen.fill();
      star(pen, 18.6, 5.2, 3.2 * tw2); pen.fill(0.7);
    }); break;
    case 'aurora': case 'silk': case 'caustics': italic(pen, () => {
      const phase = 3 * wobble(f, 0, 0.8);
      if (kind === 'aurora') {
        for (let i = 0; i <= 2; i++) {
          const y = 6.4 + i * 5.6; const sh = phase * (1 - i * 0.3);
          pen.begin(); pen.moveTo(3, y + 1.6); pen.cubicTo(8 + sh, y - 3, 13 + sh, y + 4.4, 21, y - 0.6);
          pen.stroke(2.2, AURORA[i]);
        }
      } else if (kind === 'silk') {
        for (let i = 0; i <= 1; i++) {
          const y = 9 + i * 6;
          pen.begin(); pen.moveTo(3, y); pen.cubicTo(8 + phase, y - 5, 12 - phase, y + 5, 21, y - 1.8);
          pen.stroke(i === 0 ? 2.3 : 1.8, i === 0 ? 1 : 0.6);
        }
      } else {
        pen.begin(); pen.moveTo(2.4, 12); pen.cubicTo(5.4, 4.6 + phase, 8.6, 4.6 + phase, 12, 12);
        pen.cubicTo(15.4, 19.4 - phase, 18.6, 19.4 - phase, 21.6, 12); pen.stroke(2.3);
      }
    }); break;
    case 'neon': italic(pen, () => {
      const flick = 1 - 0.6 * hop(f, 0.05, 0.12) + 0.4 * hop(f, 0.2, 0.2);
      pen.begin(); pen.moveTo(3, 15.4); pen.lineTo(7.6, 8.4); pen.lineTo(12.2, 15.4); pen.lineTo(16.8, 8.4); pen.lineTo(21, 13);
      pen.stroke(5.4, 0.18 * flick); pen.stroke(2.3, Math.min(1, flick));
    }); break;
    case 'ember': italic(pen, () => {
      const flick = hop(f, 0, 0.3) - 0.5 * hop(f, 0.3, 0.3);
      pen.scale(1 - 0.06 * flick, 1 + 0.14 * flick, 12, 20.5);
      pen.begin(); pen.moveTo(12, 3); pen.cubicTo(16.2, 7.8, 18.6, 11, 18.6, 14.4);
      pen.cubicTo(18.6, 18, 15.6, 20.8, 12, 20.8); pen.cubicTo(8.4, 20.8, 5.4, 18, 5.4, 14.4);
      pen.cubicTo(5.4, 11.6, 7.2, 9.6, 8.8, 8.2); pen.cubicTo(9.2, 10.6, 10.4, 11.6, 11.6, 12);
      pen.cubicTo(10.8, 9, 11, 6, 12, 3); pen.close(); pen.fill();
    }); break;
    case 'refraction': italic(pen, () => {
      pen.rotate(8 * wobble(f, 0, 0.7), 12, 12);
      pen.begin(); pen.moveTo(4.6, 9.2); pen.lineTo(8.8, 4.4); pen.lineTo(15.2, 4.4); pen.lineTo(19.4, 9.2);
      pen.lineTo(12, 20.2); pen.close(); pen.stroke(W);
      pen.begin(); pen.moveTo(4.6, 9.2); pen.lineTo(19.4, 9.2); pen.moveTo(8.8, 4.4); pen.lineTo(12, 9.2);
      pen.lineTo(15.2, 4.4); pen.moveTo(12, 9.2); pen.lineTo(12, 20.2); pen.stroke(1.5, 0.6);
    }); break;
  }
  pen.restore();
}

const S_SCALE = 19.5 / 610;
const LOOP_SAMPLES = 72;

function italic(pen: IconPen, draw: () => void) {
  pen.save(); pen.translate(-ITALIC * 12, 0); pen.skewX(ITALIC); draw(); pen.restore();
}
/** A chevron that dashes the way it points, leaving a speed line behind. */
function forward(pen: IconPen, p: number, f: number, back: boolean) {
  italic(pen, () => {
    const dash = hop(f, 0, 0.4);
    const x = -1.2 * p + 2.2 * dash;
    if (dash > 0.02) streak(pen, 3 - 2 * dash, 8.2 + x, 12, 1.3, 0.6 * dash);
    pen.begin(); pen.moveTo(9 + x, 5); pen.lineTo(16 + x, 12); pen.lineTo(9 + x, 19);
    pen.stroke(back ? 2.4 : 2.3);
  });
}
/** The dock's Playlists strokes: heads draw in while held and whip out in turn. */
function strokes(pen: IconPen, p: number, f: number, count: number, heads: number[]) {
  for (let i = 0; i < count; i++) {
    const x0 = 2.8 + i * 1.8; const x1 = heads[i];
    const head = x1 - 1.8 * p * (1 + 0.2 * i) + (x1 - x0) * 0.14 * wobble(f, i * 0.09, 0.6);
    const tail = x0 + 1.2 * p - 1.6 * hop(f, i * 0.09, 0.35);
    streak(pen, tail, head, 5.8 + i * 6.2, 2.5, 1);
  }
}
/** The S's speed line: a sharp tail at x0 swelling to a round head at x1. */
export function streak(pen: IconPen, x0: number, x1: number, y: number, thickness: number, opacity: number) {
  const r = thickness / 2;
  pen.begin(); pen.moveTo(x0, y + r * 0.35); pen.lineTo(x1 - r, y - r); pen.arc(x1 - r, y, r, -90, 180); pen.close();
  pen.fill(opacity);
}
function wedge(pen: IconPen, ax: number, ay: number, bx: number, by: number, tipX: number, tipY: number, opacity = 1) {
  pen.begin(); pen.moveTo(ax, ay); pen.lineTo(tipX, tipY); pen.lineTo(bx, by); pen.close(); pen.solid(1.6, opacity);
}
/** An arrowhead sitting on a circle at `angle`, pointing along the clockwise tangent. */
function arrowOnCircle(pen: IconPen, cx: number, cy: number, r: number, angle: number, size: number) {
  const a = (angle * Math.PI) / 180; const c = Math.cos(a); const s = Math.sin(a);
  const ex = cx + r * c; const ey = cy + r * s;
  wedge(pen, ex - 2.9 * size * c, ey - 2.9 * size * s, ex + 2.9 * size * c, ey + 2.9 * size * s, ex - 3.4 * size * s, ey + 3.4 * size * c);
}
function speaker(pen: IconPen) {
  pen.begin(); pen.moveTo(3.4, 9.4); pen.lineTo(6.8, 9.4); pen.lineTo(11.4, 5.2); pen.lineTo(11.4, 18.8);
  pen.lineTo(6.8, 14.6); pen.lineTo(3.4, 14.6); pen.close(); pen.solid(1.6);
}
function heart(pen: IconPen) {
  pen.moveTo(12, 20.4);
  pen.cubicTo(5.2, 15.6, 2.6, 12.2, 2.6, 8.7); pen.cubicTo(2.6, 5.7, 4.9, 3.6, 7.6, 3.6);
  pen.cubicTo(9.5, 3.6, 11, 4.7, 12, 6.3); pen.cubicTo(13, 4.7, 14.5, 3.6, 16.4, 3.6);
  pen.cubicTo(19.1, 3.6, 21.4, 5.7, 21.4, 8.7); pen.cubicTo(21.4, 12.2, 18.8, 15.6, 12, 20.4); pen.close();
}
function star(pen: IconPen, x: number, y: number, r: number) {
  pen.begin(); pen.moveTo(x, y - r);
  pen.quadTo(x + r * 0.16, y - r * 0.16, x + r, y); pen.quadTo(x + r * 0.16, y + r * 0.16, x, y + r);
  pen.quadTo(x - r * 0.16, y + r * 0.16, x - r, y); pen.quadTo(x - r * 0.16, y - r * 0.16, x, y - r); pen.close();
}

/** The repeat loop (a rounded rect) walked clockwise from its top-left straight: point and tangent angle at u (laps). */
function loopPoint(u: number): [[number, number], number] {
  const x0 = 4; const y0 = 6.8; const x1 = 20; const y1 = 17.2; const r = 4.4;
  const w = x1 - x0 - 2 * r; const h = y1 - y0 - 2 * r; const q = (Math.PI * r) / 2;
  const total = 2 * w + 2 * h + 4 * q;
  let d = (((u % 1) + 1) % 1) * total;
  const parts: Array<[kind: 'line' | 'arc', length: number, ox: number, oy: number, angle: number]> = [
    ['line', w, x0 + r, y0, 0], ['arc', q, x1 - r, y0 + r, -90], ['line', h, x1, y0 + r, 90], ['arc', q, x1 - r, y1 - r, 0],
    ['line', w, x1 - r, y1, 180], ['arc', q, x0 + r, y1 - r, 90], ['line', h, x0, y1 - r, 270], ['arc', q, x0 + r, y0 + r, 180],
  ];
  for (const [kind, length, ox, oy, angle] of parts) {
    if (d <= length) {
      if (kind === 'arc') {
        const theta = ((angle + (90 * d) / length) * Math.PI) / 180;
        return [[ox + r * Math.cos(theta), oy + r * Math.sin(theta)], angle + (90 * d) / length + 90];
      }
      const rad = (angle * Math.PI) / 180;
      return [[ox + d * Math.cos(rad), oy + d * Math.sin(rad)], angle];
    }
    d -= length;
  }
  return [[x0 + r, y0], 0];
}
