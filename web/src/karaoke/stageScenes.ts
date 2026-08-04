/**
 * Karaoke stage scenes — pure canvas renderers, one per genre.
 *
 * Framework-free on purpose: KaraokeStageCanvas drives this inside the app and
 * the design harness can bundle this exact file to preview scenes with
 * synthetic audio. The scenes aim for an immersive concert feel built from
 * several soft light layers; motion stays smooth because audio only modulates
 * intensity and sizes through pre-smoothed envelopes — positions always follow
 * slow autonomous paths.
 */

export type StageGenre = 'pop' | 'rock' | 'reggaeton' | 'folk' | 'disco' | 'electronic';

export interface StagePalette {
  primary: string;
  secondary: string;
  accent: string;
}

export interface StageAudio {
  /** Slow-followed band energies, 0..1. */
  bass: number;
  mid: number;
  treble: number;
  level: number;
  /** Slow-followed vocal envelope and normalized pitch. */
  vocal: number;
  pitch: number;
  /** Attack/release envelopes: kick, mid transient, high-frequency shimmer. */
  beat: number;
  hit: number;
  glow: number;
  /** Fades in only while music is present and the separated vocal is quiet. */
  instrumental: number;
}

export interface StageFrame {
  time: number;
  width: number;
  height: number;
  genre: StageGenre;
  palette: StagePalette;
  audio: StageAudio;
}

export type StageRenderer = (context: CanvasRenderingContext2D, frame: StageFrame) => void;

function mulberry32(seedValue: number): () => number {
  let state = seedValue >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const red = Number.parseInt(normalized.slice(0, 2), 16) || 0;
  const green = Number.parseInt(normalized.slice(2, 4), 16) || 0;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) || 0;
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`;
}

interface Mote {
  x: number;
  y: number;
  depth: number;
  phase: number;
  speed: number;
}

interface Ember {
  x: number;
  y: number;
  speed: number;
  phase: number;
  size: number;
}

interface Twinkle {
  x: number;
  y: number;
  phase: number;
  speed: number;
}

interface Ripple {
  born: number;
  strength: number;
}

export function createStageRenderer(): StageRenderer {
  let seededGenre: StageGenre | null = null;
  let motes: Mote[] = [];
  let embers: Ember[] = [];
  let twinkles: Twinkle[] = [];
  let ripples: Ripple[] = [];
  let lastRippleAt = 0;
  let lastTime = 0;

  const seedScene = (genre: StageGenre) => {
    seededGenre = genre;
    const random = mulberry32(genre.length * 2654435761 + genre.charCodeAt(0));
    motes = Array.from({ length: 48 }, () => ({
      x: random(),
      y: 0.06 + random() * 0.86,
      depth: 0.3 + random() * 0.7,
      phase: random() * Math.PI * 2,
      speed: 0.6 + random() * 0.9,
    }));
    embers = Array.from({ length: 48 }, () => ({
      x: random(),
      y: random() * 1.1 - 0.05,
      speed: 0.00004 + random() * 0.00005,
      phase: random() * Math.PI * 2,
      size: 0.5 + random(),
    }));
    twinkles = Array.from({ length: 32 }, () => ({
      x: 0.04 + random() * 0.92,
      y: 0.04 + random() * 0.55,
      phase: random() * Math.PI * 2,
      speed: 0.55 + random() * 0.9,
    }));
    ripples = [];
    lastRippleAt = 0;
  };

  const glowDot = (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: string,
    alpha: number,
  ) => {
    if (alpha <= 0.004) return;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(color, alpha));
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  };

  const lightCone = (
    context: CanvasRenderingContext2D,
    originX: number,
    originY: number,
    angle: number,
    length: number,
    halfSpread: number,
    color: string,
    alpha: number,
  ) => {
    context.save();
    context.translate(originX, originY);
    context.rotate(angle);
    const gradient = context.createLinearGradient(0, 0, 0, length);
    gradient.addColorStop(0, rgba(color, alpha));
    gradient.addColorStop(0.55, rgba(color, alpha * 0.45));
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(-length * halfSpread, length);
    context.lineTo(length * halfSpread, length);
    context.closePath();
    context.fill();
    context.restore();
  };

  const drawInstrumentalArt = (
    context: CanvasRenderingContext2D,
    genre: StageGenre,
    t: number,
    w: number,
    h: number,
    p: StagePalette,
    a: StageAudio,
  ) => {
    const focus = a.instrumental * a.instrumental * (3 - 2 * a.instrumental);
    const presence = 0.16 + focus * 0.84;
    const cx = w * 0.5;
    const cy = h * (0.48 + focus * 0.035);
    const unit = Math.min(w, h);
    context.save();
    context.globalCompositeOperation = 'screen';

    if (genre === 'pop') {
      // An iridescent silk flower: two counter-rotating petal crowns and a
      // breathing pearl. It reads as atmosphere under vocals and opens fully
      // when the singer leaves the arrangement.
      const colors = [p.primary, p.secondary, p.accent];
      for (let crown = 0; crown < 2; crown += 1) {
        const petals = crown ? 9 : 13;
        const radius = unit * (0.12 + crown * 0.055 + focus * 0.045);
        const rotation = t * (crown ? -0.000045 : 0.000034) + crown * 0.3;
        context.save();
        context.translate(cx, cy);
        context.rotate(rotation);
        const petalFills = colors.map((color, colorIndex) => {
          const petal = context.createRadialGradient(0, 0, radius * 0.22, 0, 0, radius * 1.08);
          petal.addColorStop(0, rgba(color, (0.05 + focus * 0.09) * presence));
          petal.addColorStop(0.62, rgba(colors[(colorIndex + 1) % colors.length], (0.075 + a.glow * 0.04) * presence));
          petal.addColorStop(1, 'rgba(0,0,0,0)');
          return petal;
        });
        for (let index = 0; index < petals; index += 1) {
          const angle = (index / petals) * Math.PI * 2;
          const spread = Math.PI / petals * 0.72;
          const inner = radius * 0.22;
          const outer = radius * (1 + a.mid * 0.14 + a.hit * 0.08);
          context.beginPath();
          context.moveTo(Math.cos(angle - spread) * inner, Math.sin(angle - spread) * inner);
          context.bezierCurveTo(
            Math.cos(angle - spread * 0.55) * outer * 0.82,
            Math.sin(angle - spread * 0.55) * outer * 0.82,
            Math.cos(angle + spread * 0.34) * outer * 1.08,
            Math.sin(angle + spread * 0.34) * outer * 1.08,
            Math.cos(angle + spread) * inner,
            Math.sin(angle + spread) * inner,
          );
          context.quadraticCurveTo(0, 0, Math.cos(angle - spread) * inner, Math.sin(angle - spread) * inner);
          context.fillStyle = petalFills[(index + crown) % petalFills.length];
          context.fill();
          context.strokeStyle = rgba('#ffffff', (0.018 + a.glow * 0.045) * presence);
          context.lineWidth = Math.max(0.7, unit * 0.0011);
          context.stroke();
        }
        context.restore();
      }
      glowDot(context, cx, cy, unit * (0.12 + focus * 0.07 + a.beat * 0.025), '#ffffff', (0.08 + focus * 0.12 + a.glow * 0.08) * presence);
      for (let orbit = 0; orbit < 7; orbit += 1) {
        const angle = t * (0.00008 + orbit * 0.000004) + orbit * 2.27;
        const radius = unit * (0.16 + (orbit % 3) * 0.045 + focus * 0.04);
        glowDot(
          context,
          cx + Math.cos(angle) * radius * 1.45,
          cy + Math.sin(angle) * radius * 0.58,
          unit * (0.012 + a.glow * 0.012),
          colors[orbit % colors.length],
          (0.08 + a.glow * 0.18) * presence,
        );
      }
    } else if (genre === 'rock') {
      // Seismic feedback: hand-cut waveform rings, radial amplifier tears and
      // a hot core. No perfect geometry, so the image feels performed.
      context.save();
      context.translate(cx, cy);
      context.rotate(-0.08 + Math.sin(t * 0.00005) * 0.035);
      for (let ring = 0; ring < 4; ring += 1) {
        const points = 84;
        const base = unit * (0.09 + ring * 0.045 + focus * 0.022);
        context.beginPath();
        for (let index = 0; index <= points; index += 1) {
          const angle = (index / points) * Math.PI * 2;
          const serration = Math.sin(index * 1.71 + t * 0.0032) * unit * (0.002 + a.hit * 0.004);
          const bassTear = Math.pow(Math.max(0, Math.sin(angle * 3 - t * 0.001)), 7)
            * unit * (0.006 + a.beat * 0.02);
          const radius = base + serration + bassTear;
          const x = Math.cos(angle) * radius * 1.55;
          const y = Math.sin(angle) * radius * 0.72;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle = rgba(
          ring % 2 ? p.accent : p.primary,
          (0.055 + focus * 0.08 + a.hit * 0.05) * (1 - ring * 0.12),
        );
        context.lineWidth = Math.max(1, unit * (0.0028 - ring * 0.00035 + a.beat * 0.0018));
        context.stroke();
      }
      for (let tear = 0; tear < 11; tear += 1) {
        const angle = (tear / 11) * Math.PI * 2 + t * 0.000018;
        const inner = unit * (0.13 + focus * 0.025);
        const outer = inner + unit * (0.025 + a.beat * 0.085) * (0.45 + (tear % 4) * 0.18);
        context.strokeStyle = rgba(tear % 2 ? p.primary : p.accent, (0.04 + a.beat * 0.16) * presence);
        context.lineWidth = Math.max(1, unit * 0.002);
        context.beginPath();
        context.moveTo(Math.cos(angle) * inner * 1.5, Math.sin(angle) * inner * 0.72);
        context.lineTo(Math.cos(angle + 0.035) * outer * 1.5, Math.sin(angle + 0.035) * outer * 0.72);
        context.stroke();
      }
      context.restore();
      glowDot(context, cx, cy, unit * (0.18 + a.beat * 0.055), p.accent, (0.055 + focus * 0.13 + a.beat * 0.11) * presence);
      glowDot(context, cx, cy, unit * 0.065, '#ffffff', (0.04 + focus * 0.09 + a.glow * 0.08) * presence);
    } else if (genre === 'reggaeton') {
      // Liquid sub-bass sculpture: offset chrome orbits fold around a molten
      // center while the kick sends weight through the lower hemisphere.
      context.save();
      context.translate(cx, cy + unit * 0.025);
      for (let orbit = 0; orbit < 8; orbit += 1) {
        const radius = unit * (0.075 + orbit * 0.026 + focus * 0.025);
        const rotation = Math.sin(t * 0.000055 + orbit * 0.74) * 0.18 + (orbit - 4) * 0.025;
        const start = t * (orbit % 2 ? -0.00011 : 0.00008) + orbit * 0.7;
        context.save();
        context.rotate(rotation);
        context.strokeStyle = rgba(
          orbit % 3 === 0 ? p.accent : orbit % 2 ? p.primary : p.secondary,
          (0.045 + focus * 0.085 + a.beat * 0.045) * (1 - orbit * 0.045),
        );
        context.lineWidth = Math.max(1, unit * (0.0052 - orbit * 0.00042 + a.beat * 0.002));
        context.lineCap = 'round';
        context.beginPath();
        context.ellipse(0, 0, radius * 1.72, radius * (0.42 + orbit * 0.012), 0, start, start + Math.PI * (0.78 + (orbit % 3) * 0.22));
        context.stroke();
        context.restore();
      }
      const lobes = 10;
      context.beginPath();
      for (let index = 0; index <= 100; index += 1) {
        const angle = (index / 100) * Math.PI * 2;
        const liquid = 1 + Math.sin(angle * lobes - t * 0.0012) * (0.045 + a.bass * 0.06);
        const radius = unit * (0.095 + focus * 0.032 + a.beat * 0.018) * liquid;
        const x = Math.cos(angle) * radius * 1.28;
        const y = Math.sin(angle) * radius;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      const molten = context.createRadialGradient(0, -unit * 0.025, 0, 0, 0, unit * 0.16);
      molten.addColorStop(0, rgba('#ffffff', (0.12 + a.glow * 0.15) * presence));
      molten.addColorStop(0.22, rgba(p.accent, (0.15 + focus * 0.08) * presence));
      molten.addColorStop(0.64, rgba(p.primary, (0.09 + a.bass * 0.08) * presence));
      molten.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = molten;
      context.fill();
      context.restore();
    } else if (genre === 'folk') {
      // Resonant botanical rosette: fine string harmonics bloom like pressed
      // petals, with imperfect phase offsets that keep it human.
      context.save();
      context.translate(cx, cy + unit * 0.02);
      context.rotate(Math.sin(t * 0.000018) * 0.06);
      const strands = 7;
      for (let strand = 0; strand < strands; strand += 1) {
        const points = 180;
        context.beginPath();
        for (let index = 0; index <= points; index += 1) {
          const angle = (index / points) * Math.PI * 2;
          const petal = Math.sin(angle * (3 + strand % 3) + t * (0.00008 + strand * 0.000004));
          const radius = unit * (0.08 + strand * 0.012 + focus * 0.018)
            * (1 + petal * (0.28 + a.mid * 0.08));
          const x = Math.cos(angle + strand * 0.11) * radius * 1.38;
          const y = Math.sin(angle) * radius;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();
        context.strokeStyle = rgba(
          strand % 2 ? p.primary : p.accent,
          (0.038 + focus * 0.06 + a.vocal * 0.025) * (1 - strand * 0.065),
        );
        context.lineWidth = Math.max(0.65, unit * (0.0016 - strand * 0.0001));
        context.stroke();
      }
      context.restore();
      glowDot(context, cx, cy, unit * (0.12 + focus * 0.045), p.accent, (0.045 + focus * 0.09) * presence);
      for (let seed = 0; seed < 9; seed += 1) {
        const angle = t * 0.000025 + seed * 2.19;
        const radius = unit * (0.15 + (seed % 3) * 0.025 + focus * 0.02);
        const x = cx + Math.cos(angle) * radius * 1.35;
        const y = cy + Math.sin(angle) * radius * 0.7;
        context.save();
        context.translate(x, y);
        context.rotate(angle + Math.PI * 0.5);
        context.fillStyle = rgba(seed % 2 ? p.accent : p.primary, (0.05 + a.glow * 0.12) * presence);
        context.beginPath();
        context.ellipse(0, 0, unit * 0.008, unit * 0.0032, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    } else if (genre === 'disco') {
      // A faceted kinetic jewel, closer to a couture light installation than
      // a literal disco ball. Every triangular plane catches a different band.
      context.save();
      context.translate(cx, cy);
      context.rotate(t * 0.000035);
      const rings = [
        { count: 8, radius: unit * (0.06 + focus * 0.015) },
        { count: 14, radius: unit * (0.13 + focus * 0.025) },
        { count: 20, radius: unit * (0.205 + focus * 0.035) },
      ];
      const ringPoints = rings.map((ring, ringIndex) =>
        Array.from({ length: ring.count }, (_, index) => {
          const angle = (index / ring.count) * Math.PI * 2 + ringIndex * 0.14;
          return {
            x: Math.cos(angle) * ring.radius * 1.18,
            y: Math.sin(angle) * ring.radius,
            angle,
          };
        }));
      for (let index = 0; index < ringPoints[1].length; index += 1) {
        const inner = ringPoints[0][index % ringPoints[0].length];
        const middle = ringPoints[1][index];
        const outer = ringPoints[2][Math.floor(index * ringPoints[2].length / ringPoints[1].length)];
        const light = 0.5 + 0.5 * Math.sin(t * 0.0011 + middle.angle * 3);
        const color = index % 3 === 0 ? p.primary : index % 3 === 1 ? p.secondary : p.accent;
        context.fillStyle = rgba(color, (0.035 + focus * 0.07 + a.glow * 0.08) * (0.4 + light * 0.6));
        context.beginPath();
        context.moveTo(inner.x, inner.y);
        context.lineTo(middle.x, middle.y);
        context.lineTo(outer.x, outer.y);
        context.closePath();
        context.fill();
        context.strokeStyle = rgba('#ffffff', (0.018 + a.glow * 0.035) * presence);
        context.lineWidth = Math.max(.6, unit * .0009);
        context.stroke();
      }
      context.restore();
      glowDot(context, cx, cy, unit * (0.12 + focus * 0.06 + a.beat * 0.025), '#ffffff', (0.065 + focus * 0.12 + a.glow * 0.13) * presence);
      for (let flare = 0; flare < 4; flare += 1) {
        const angle = t * (flare % 2 ? -0.000075 : 0.00006) + flare * Math.PI * 0.5;
        context.strokeStyle = rgba(flare % 2 ? p.accent : p.primary, (0.035 + a.glow * 0.1) * presence);
        context.lineWidth = Math.max(1, unit * 0.0015);
        context.beginPath();
        context.moveTo(cx - Math.cos(angle) * unit * 0.3, cy - Math.sin(angle) * unit * 0.3);
        context.lineTo(cx + Math.cos(angle) * unit * 0.3, cy + Math.sin(angle) * unit * 0.3);
        context.stroke();
      }
    } else {
      // Electronic holographic torus: layered latitude scans, orbiting data
      // nodes and an audio-shaped equator.
      context.save();
      context.translate(cx, cy);
      const tilt = 0.54 + Math.sin(t * 0.00003) * 0.04;
      for (let latitude = -5; latitude <= 5; latitude += 1) {
        const normalized = latitude / 5;
        const radiusX = unit * (0.17 + focus * 0.04) * Math.sqrt(Math.max(0.05, 1 - normalized * normalized));
        const radiusY = radiusX * tilt * 0.34;
        const y = normalized * unit * (0.115 + focus * 0.02);
        context.strokeStyle = rgba(
          latitude % 2 ? p.secondary : p.primary,
          (0.035 + focus * 0.06 + a.hit * 0.045) * (1 - Math.abs(normalized) * 0.45),
        );
        context.lineWidth = Math.max(.7, unit * .0012);
        context.beginPath();
        context.ellipse(0, y, radiusX * 1.45, radiusY, t * 0.000018, 0, Math.PI * 2);
        context.stroke();
      }
      const nodes = 32;
      context.beginPath();
      for (let index = 0; index <= nodes; index += 1) {
        const angle = (index / nodes) * Math.PI * 2;
        const modulation = 1 + Math.sin(index * 1.31 + t * 0.003) * (0.025 + a.mid * 0.08);
        const radius = unit * (0.19 + focus * 0.045) * modulation;
        const x = Math.cos(angle) * radius * 1.45;
        const y = Math.sin(angle) * radius * 0.42;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
        if (index < nodes && index % 4 === 0) {
          glowDot(context, x, y, unit * (0.012 + a.glow * 0.008), index % 8 ? p.primary : p.accent, (0.07 + a.glow * 0.15) * presence);
        }
      }
      context.closePath();
      context.strokeStyle = rgba(p.accent, (0.08 + focus * 0.12 + a.mid * 0.08) * presence);
      context.lineWidth = Math.max(1, unit * (0.0018 + a.hit * 0.0015));
      context.stroke();
      context.restore();
      glowDot(context, cx, cy, unit * (0.13 + focus * 0.05 + a.beat * 0.025), p.primary, (0.055 + focus * 0.12 + a.beat * 0.09) * presence);
      context.strokeStyle = rgba('#ffffff', (0.03 + a.glow * 0.1) * presence);
      context.lineWidth = Math.max(1, unit * 0.001);
      const scanY = cy + Math.sin(t * 0.0009) * unit * (0.1 + focus * 0.025);
      context.beginPath();
      context.moveTo(cx - unit * 0.27, scanY);
      context.lineTo(cx + unit * 0.27, scanY);
      context.stroke();
    }
    context.restore();
  };

  const drawPop = (
    context: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    p: StagePalette,
    a: StageAudio,
  ) => {
    const breathe = 0.8 + a.level * 0.32 + a.beat * 0.12;
    const size = Math.max(w, h);
    context.globalCompositeOperation = 'screen';
    // Layer 1 — aurora orbs breathing with overall energy.
    const orbs = [
      { color: p.primary, x: 0.26 + Math.sin(t * 0.000021) * 0.08, y: 0.36 + Math.cos(t * 0.000017) * 0.05, r: 0.58, base: 0.16 },
      { color: p.secondary, x: 0.75 + Math.cos(t * 0.000018 + 2.1) * 0.07, y: 0.3 + Math.sin(t * 0.000024 + 1.4) * 0.06, r: 0.52, base: 0.13 },
      { color: p.accent, x: 0.52 + Math.sin(t * 0.000014 + 4.2) * 0.1, y: 0.8 + Math.cos(t * 0.000012 + 3.1) * 0.04, r: 0.56, base: 0.1 },
    ];
    for (const orb of orbs) {
      const radius = size * orb.r;
      const gradient = context.createRadialGradient(orb.x * w, orb.y * h, 0, orb.x * w, orb.y * h, radius);
      gradient.addColorStop(0, rgba(orb.color, orb.base * breathe));
      gradient.addColorStop(0.55, rgba(orb.color, orb.base * 0.38 * breathe));
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, w, h);
    }
    // Layer 2 — aurora curtains: sinuous vertical veils slowly waving.
    const curtainColors = [p.primary, p.secondary, p.accent];
    for (let curtain = 0; curtain < 3; curtain += 1) {
      const phase = t * 0.00006 + curtain * 2.1;
      const drift = Math.sin(t * 0.000019 + curtain * 1.3) * w * 0.05;
      const baseX = w * (0.18 + curtain * 0.3) + drift;
      const top = h * 0.02;
      const bottom = h * 0.62;
      const veilWidth = w * (0.06 + curtain * 0.012);
      const alpha = (0.055 + a.treble * 0.05 + a.glow * 0.03) * breathe;
      context.beginPath();
      const steps = 22;
      for (let step = 0; step <= steps; step += 1) {
        const y = top + ((bottom - top) * step) / steps;
        const x = baseX + Math.sin(y * 0.0042 + phase) * w * 0.045;
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      for (let step = steps; step >= 0; step -= 1) {
        const y = top + ((bottom - top) * step) / steps;
        const x = baseX + veilWidth + Math.sin(y * 0.0042 + phase + 0.5) * w * 0.045;
        context.lineTo(x, y);
      }
      context.closePath();
      const veil = context.createLinearGradient(0, top, 0, bottom);
      veil.addColorStop(0, rgba(curtainColors[curtain], alpha * 0.4));
      veil.addColorStop(0.4, rgba(curtainColors[curtain], alpha));
      veil.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = veil;
      context.fill();
    }
    // Layer 3 — star dust answering the highs.
    for (const dust of twinkles) {
      const flicker = 0.5 + 0.5 * Math.sin(t * 0.0008 * dust.speed + dust.phase * 3);
      glowDot(
        context,
        w * dust.x,
        h * dust.y,
        h * 0.006 * 3,
        dust.phase > Math.PI ? p.secondary : '#ffffff',
        (0.07 + a.glow * 0.22) * flicker,
      );
    }
    // Layer 4 — vocal halo behind the lyric line.
    const halo = context.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.46, size * 0.42);
    halo.addColorStop(0, rgba(p.primary, 0.05 + a.vocal * 0.08));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = halo;
    context.fillRect(0, 0, w, h);
    context.globalCompositeOperation = 'source-over';
  };

  const drawRock = (
    context: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    p: StagePalette,
    a: StageAudio,
  ) => {
    const size = Math.max(w, h);
    context.globalCompositeOperation = 'screen';
    // Layer 1 — warm floor wash tied to the bass bed.
    const floor = context.createRadialGradient(w * 0.5, h * 1.12, 0, w * 0.5, h * 1.12, size * 0.85);
    floor.addColorStop(0, rgba(p.primary, 0.13 + a.bass * 0.1));
    floor.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = floor;
    context.fillRect(0, 0, w, h);
    // Layer 2 — drifting smoke banks catching the light.
    for (let wisp = 0; wisp < 6; wisp += 1) {
      const x = (((wisp * 0.23 + t * 0.000006 * (1 + (wisp % 3))) % 1.24) - 0.12) * w;
      const y = h * (0.28 + ((wisp * 37) % 40) / 100);
      const radius = size * (0.16 + (wisp % 3) * 0.05);
      glowDot(context, x, y, radius, wisp % 2 ? p.accent : p.primary, 0.028 + a.mid * 0.02);
    }
    // Layer 3 — one center spot plus two side spots slowly sweeping.
    const spotX = w * (0.5 + Math.sin(t * 0.00004) * 0.03);
    const spot = context.createRadialGradient(spotX, -h * 0.34, 0, spotX, -h * 0.34, size * 0.95);
    spot.addColorStop(0, `rgba(255,255,255,${0.08 + a.beat * 0.06})`);
    spot.addColorStop(0.6, `rgba(255,255,255,${0.028 + a.beat * 0.022})`);
    spot.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = spot;
    context.fillRect(0, 0, w, h);
    lightCone(
      context, w * 0.08, -h * 0.06,
      0.34 + Math.sin(t * 0.00005) * 0.1,
      h * 1.25, 0.16, p.accent, 0.055 + a.beat * 0.05,
    );
    lightCone(
      context, w * 0.92, -h * 0.06,
      -0.34 + Math.sin(t * 0.000045 + 2) * 0.1,
      h * 1.25, 0.16, p.primary, 0.055 + a.beat * 0.05,
    );
    // Layer 4 — embers rising; shimmer sets how brightly they catch fire.
    for (const ember of embers) {
      const x = w * (ember.x + Math.sin(t * 0.0004 + ember.phase) * 0.014);
      const y = h * ember.y;
      const edge = Math.max(0, Math.min(1, (1.02 - ember.y) * 5, (ember.y + 0.04) * 2.4));
      const alpha = (0.1 + a.glow * 0.22 + a.beat * 0.05) * edge * (0.5 + ember.size * 0.4);
      const radius = h * (0.0024 + ember.size * 0.0034) * 3.4;
      glowDot(context, x, y, radius, ember.size > 1 ? p.accent : p.primary, alpha);
    }
    context.globalCompositeOperation = 'source-over';
  };

  const drawReggaeton = (
    context: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    p: StagePalette,
    a: StageAudio,
  ) => {
    context.globalCompositeOperation = 'screen';
    // Layer 1 — warm tide breathing with the sub bass.
    const tide = context.createLinearGradient(0, h, 0, h * 0.4);
    tide.addColorStop(0, rgba(p.primary, 0.17 + a.bass * 0.12));
    tide.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = tide;
    context.fillRect(0, 0, w, h);
    // Layer 2 — dual side glows for depth.
    glowDot(context, w * 0.08, h * 0.6, Math.max(w, h) * 0.44, p.secondary, 0.085 + a.mid * 0.05);
    glowDot(context, w * 0.92, h * 0.54, Math.max(w, h) * 0.44, p.accent, 0.085 + a.mid * 0.05);
    // Layer 3 — neon streaks gliding across the lower half.
    for (let streak = 0; streak < 4; streak += 1) {
      const y = h * (0.5 + streak * 0.11);
      const x = (((t * 0.00003 * (1 + streak * 0.24) + streak * 0.37) % 1.32) - 0.16) * w;
      const length = w * 0.3;
      const color = streak % 2 ? p.accent : p.secondary;
      const alpha = 0.075 + a.bass * 0.06;
      const beam = context.createLinearGradient(x, 0, x + length, 0);
      beam.addColorStop(0, 'rgba(0,0,0,0)');
      beam.addColorStop(0.5, rgba(color, alpha));
      beam.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = beam;
      context.fillRect(x, y - h * 0.006, length, h * 0.012);
      context.fillRect(x, y - h * 0.0015, length, h * 0.003);
    }
    // Layer 4 — heat sparks floating up from the tide.
    for (const ember of embers) {
      if (ember.size < 0.8) continue;
      const x = w * (ember.x + Math.sin(t * 0.00035 + ember.phase) * 0.02);
      const y = h * (0.35 + ember.y * 0.65);
      const edge = Math.max(0, Math.min(1, (1.02 - ember.y) * 4, (ember.y + 0.04) * 2.4));
      glowDot(context, x, y, h * 0.008 * 3, ember.phase > Math.PI ? p.secondary : p.accent, (0.06 + a.glow * 0.12) * edge);
    }
    // Layer 5 — the beat lands as expanding rings from a grounded core.
    if (a.beat > 0.5 && t - lastRippleAt > 420 && ripples.length < 5) {
      ripples.push({ born: t, strength: Math.min(1, a.beat) });
      lastRippleAt = t;
    }
    ripples = ripples.filter(ripple => t - ripple.born < 2600);
    for (const ripple of ripples) {
      const progress = (t - ripple.born) / 2600;
      const eased = 1 - Math.pow(1 - progress, 2.2);
      const radiusX = w * (0.07 + eased * 0.48);
      const alpha = Math.pow(1 - progress, 2) * 0.26 * ripple.strength;
      context.strokeStyle = rgba(p.primary, alpha);
      context.lineWidth = Math.max(1.5, h * 0.005 * (1 - progress * 0.5));
      context.beginPath();
      context.ellipse(w * 0.5, h * 0.68, radiusX, radiusX * 0.32, 0, 0, Math.PI * 2);
      context.stroke();
    }
    glowDot(context, w * 0.5, h * 0.68, w * (0.11 + a.beat * 0.05), p.accent, 0.1 + a.beat * 0.14);
    context.globalCompositeOperation = 'source-over';
  };

  const drawFolk = (
    context: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    p: StagePalette,
    a: StageAudio,
  ) => {
    const size = Math.max(w, h);
    context.globalCompositeOperation = 'screen';
    // Layer 1 — the off-frame window/candle breathes with the held vocal.
    glowDot(context, w * 0.84, h * 0.24, size * 0.72, p.accent, 0.065 + a.vocal * 0.055);
    glowDot(context, w * 0.9, h * 0.14, size * 0.24, '#ffffff', 0.025 + a.glow * 0.035);
    // Layer 2 — sparse imperfect rays across the photographed room.
    for (let ray = 0; ray < 3; ray += 1) {
      lightCone(
        context, w * (0.82 + ray * 0.04), -h * 0.08,
        0.38 + (ray - 1) * 0.13 + Math.sin(t * 0.000018 + ray * 1.9) * 0.025,
        h * 1.18, 0.1, p.accent, 0.018 + a.vocal * 0.018,
      );
    }
    // Layer 3 — dust and seed-fibres drift slowly instead of pulsing.
    for (const [index, mote] of motes.entries()) {
      const x = w * (mote.x + Math.sin(t * 0.00003 * mote.speed + mote.phase) * 0.045 * mote.depth);
      const y = h * (mote.y + Math.cos(t * 0.000024 * mote.speed + mote.phase * 1.7) * 0.03 * mote.depth);
      const twinkleWave = 0.62 + 0.38 * Math.sin(t * 0.0005 * mote.speed + mote.phase * 3);
      const fibre = index % 7 === 0;
      if (fibre) {
        context.save();
        context.translate(x, y);
        context.rotate(Math.sin(t * 0.00005 + mote.phase) * 0.55);
        context.strokeStyle = rgba(p.accent, (0.12 + a.glow * 0.08) * twinkleWave);
        context.lineWidth = Math.max(0.65, h * 0.0007);
        context.beginPath();
        context.moveTo(-h * 0.008, 0);
        context.quadraticCurveTo(0, -h * 0.005, h * 0.012, h * 0.002);
        context.stroke();
        context.restore();
      } else {
        context.fillStyle = rgba(
          index % 3 ? p.accent : '#ffffff',
          (0.08 + a.glow * 0.09) * mote.depth * twinkleWave,
        );
        context.beginPath();
        context.arc(x, y, Math.max(0.7, h * 0.0014 * mote.depth), 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalCompositeOperation = 'source-over';
  };

  const drawDisco = (
    context: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    p: StagePalette,
    a: StageAudio,
  ) => {
    const size = Math.max(w, h);
    context.globalCompositeOperation = 'screen';
    const beamColors = [p.primary, '#ffffff', p.secondary, p.accent];
    const spread = 0.085;
    // Layer 1 — prism sweeps: a slow main fan plus a counter-rotating echo.
    context.save();
    context.translate(w * 0.5, h * 0.42);
    for (let index = 0; index < 4; index += 1) {
      const angle = t * 0.00005 + index * (Math.PI / 2) + Math.sin(t * 0.000021 + index) * 0.05;
      const length = size * 1.15;
      const alpha = 0.085 + a.glow * 0.06;
      context.save();
      context.rotate(angle);
      const gradient = context.createLinearGradient(0, 0, length, 0);
      gradient.addColorStop(0, rgba(beamColors[index], alpha * 0.9));
      gradient.addColorStop(0.3, rgba(beamColors[index], alpha * 0.5));
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = gradient;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(length, -length * spread);
      context.lineTo(length, length * spread);
      context.closePath();
      context.fill();
      context.restore();
    }
    for (let index = 0; index < 3; index += 1) {
      const angle = -t * 0.000034 + index * ((Math.PI * 2) / 3) + 0.7;
      const length = size * 1.1;
      const alpha = 0.045 + a.glow * 0.035;
      context.save();
      context.rotate(angle);
      const gradient = context.createLinearGradient(0, 0, length, 0);
      gradient.addColorStop(0, rgba(beamColors[(index + 2) % 4], alpha));
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = gradient;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(length, -length * spread * 0.7);
      context.lineTo(length, length * spread * 0.7);
      context.closePath();
      context.fill();
      context.restore();
    }
    context.restore();
    // Layer 2 — mirror reflections sweeping the walls in elliptical paths.
    for (let ring = 0; ring < 2; ring += 1) {
      const count = 14;
      const radiusX = w * (0.32 + ring * 0.17);
      const radiusY = h * (0.24 + ring * 0.16);
      for (let index = 0; index < count; index += 1) {
        const angle = t * 0.00005 * (ring ? -1 : 1) + index * ((Math.PI * 2) / count) + ring * 0.4;
        const x = w * 0.5 + Math.cos(angle) * radiusX;
        const y = h * 0.42 + Math.sin(angle) * radiusY;
        const flicker = 0.45 + 0.55 * Math.sin(index * 1.7 + t * 0.0012);
        glowDot(context, x, y, h * 0.011 * 3, '#ffffff', (0.06 + a.glow * 0.12) * flicker);
      }
    }
    // Layer 3 — sparse mirror glints answering the highs.
    for (const twinkle of twinkles) {
      const brightness = Math.pow(Math.max(0, Math.sin(t * 0.0009 * twinkle.speed + twinkle.phase)), 6)
        * (0.2 + a.glow * 0.45);
      if (brightness <= 0.01) continue;
      const x = w * twinkle.x;
      const y = h * twinkle.y;
      const radius = h * 0.007 * 3;
      const glint = context.createRadialGradient(x, y, 0, x, y, radius);
      glint.addColorStop(0, `rgba(255,255,255,${brightness})`);
      glint.addColorStop(0.4, rgba(p.secondary, brightness * 0.4));
      glint.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = glint;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    // Layer 4 — velvet floor sheen pulsing with the beat.
    const sheen = context.createLinearGradient(0, h, 0, h * 0.64);
    sheen.addColorStop(0, rgba(p.secondary, 0.09 + a.beat * 0.05));
    sheen.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = sheen;
    context.fillRect(0, 0, w, h);
    context.globalCompositeOperation = 'source-over';
  };

  const drawElectronic = (
    context: CanvasRenderingContext2D,
    t: number,
    w: number,
    h: number,
    p: StagePalette,
    a: StageAudio,
  ) => {
    context.globalCompositeOperation = 'screen';
    // Layer 1 — thin phosphor scan planes. They move in discrete steps so the
    // atmosphere shares the lyric lock-on language.
    const scanOffset = Math.floor(t / 90) % 6;
    context.lineWidth = Math.max(0.55, h * 0.0007);
    for (let line = scanOffset; line < h; line += Math.max(7, Math.round(h / 54))) {
      const emphasis = line % 5 === 0 ? 1.5 : 1;
      context.strokeStyle = rgba(p.primary, (0.025 + a.treble * 0.04) * emphasis);
      context.beginPath();
      context.moveTo(0, line);
      context.lineTo(w, line);
      context.stroke();
    }

    // Layer 2 — brutalist light gates recede off-centre in hard perspective.
    for (let gate = 0; gate < 7; gate += 1) {
      const depth = gate / 7;
      const gateWidth = w * (0.52 - depth * 0.43);
      const gateHeight = h * (0.68 - depth * 0.53);
      const x = w * (0.72 + depth * 0.19) - gateWidth * 0.5;
      const y = h * (0.16 + depth * 0.27);
      const steppedHit = Math.round(a.hit * 4) / 4;
      context.strokeStyle = rgba(
        gate % 3 === 0 ? p.secondary : p.primary,
        0.045 + steppedHit * 0.075 + (1 - depth) * 0.018,
      );
      context.lineWidth = Math.max(1, h * (0.0028 - depth * 0.0017));
      context.strokeRect(x, y, gateWidth, gateHeight);
    }

    // Layer 3 — data dust travels horizontally rather than floating like a
    // starfield. Large hits briefly split the RGB channels.
    for (const [index, mote] of motes.entries()) {
      const lane = (index % 9) / 8;
      const speed = 0.000012 + mote.speed * 0.000009;
      const x = w * ((mote.x + t * speed) % 1);
      const y = h * (0.08 + lane * 0.76 + Math.sin(mote.phase + t * 0.0001) * 0.008);
      const length = w * (0.002 + mote.depth * 0.012 + a.mid * 0.009);
      const alpha = (0.05 + a.treble * 0.15) * mote.depth;
      context.fillStyle = rgba(index % 5 === 0 ? p.secondary : p.primary, alpha);
      context.fillRect(x, y, length, Math.max(1, h * 0.0012 * mote.depth));
      if (a.hit > 0.3 && index % 6 === 0) {
        context.fillStyle = rgba(p.accent, alpha * a.hit);
        context.fillRect(x + h * 0.006, y, length, Math.max(1, h * 0.0008));
      }
    }

    // Layer 4 — one scanning horizon follows pitch and snaps on mid hits.
    const scanY = h * (0.2 + a.pitch * 0.56);
    const scan = context.createLinearGradient(0, 0, w, 0);
    scan.addColorStop(0, 'rgba(0,0,0,0)');
    scan.addColorStop(0.28, rgba(p.primary, 0.04 + a.mid * 0.08));
    scan.addColorStop(0.72, rgba(p.accent, 0.08 + a.hit * 0.16));
    scan.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = scan;
    context.fillRect(0, scanY, w, Math.max(1.5, h * (0.0018 + a.hit * 0.002)));
    context.globalCompositeOperation = 'source-over';
  };

  return (context, frame) => {
    const { time, width, height, genre, palette, audio } = frame;
    if (seededGenre !== genre) seedScene(genre);
    const dt = lastTime ? Math.min(80, time - lastTime) : 16;
    lastTime = time;
    // Embers advance on real time so pauses simply freeze them in place.
    for (const ember of embers) {
      ember.y -= ember.speed * dt;
      if (ember.y < -0.06) {
        ember.y = 1.05;
        ember.x = (ember.x + 0.37) % 1;
      }
    }
    switch (genre) {
      case 'rock':
        drawRock(context, time, width, height, palette, audio);
        break;
      case 'reggaeton':
        drawReggaeton(context, time, width, height, palette, audio);
        break;
      case 'folk':
        drawFolk(context, time, width, height, palette, audio);
        break;
      case 'disco':
        drawDisco(context, time, width, height, palette, audio);
        break;
      case 'electronic':
        drawElectronic(context, time, width, height, palette, audio);
        break;
      default:
        drawPop(context, time, width, height, palette, audio);
    }
    // The high-detail mood plate carries material and depth. Canvas owns only
    // the inexpensive, audio-reactive motion above it; avoid reintroducing a
    // central genre icon that competes with the lyric line.
  };
}
