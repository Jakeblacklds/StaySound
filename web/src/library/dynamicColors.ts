import type { Track } from '@staysound/types/audio';

export interface WebDynamicPalette {
  background: string;
  /** Deep second stop for the base gradient */
  backgroundAlt: string;
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  muted: string;
  /** Full multi-stop background gradient, ready to assign to `background` */
  gradient: string;
}

const FALLBACK_SEEDS: Array<[string, string, string]> = [
  ['#6ee7b7', '#5b9dfd', '#fde68a'],
  ['#67e8f9', '#a7f3d0', '#facc15'],
  ['#fbbf24', '#34d399', '#93c5fd'],
];

const paletteCache = new Map<string, WebDynamicPalette>();
const MAX_PALETTE_CACHE_ENTRIES = 64;

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clamp(value: number, min = 0, max = 255): number {
  return Math.max(min, Math.min(max, value));
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map(value => clamp(Math.round(value)).toString(16).padStart(2, '0'))
    .join('')}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function mix(left: string, right: string, amount: number): string {
  const [lr, lg, lb] = hexToRgb(left);
  const [rr, rg, rb] = hexToRgb(right);
  return rgbToHex(
    lr + (rr - lr) * amount,
    lg + (rg - lg) * amount,
    lb + (rb - lb) * amount,
  );
}

function brighten(hex: string, amount: number): string {
  return mix(hex, '#ffffff', amount);
}

function darken(hex: string, amount: number): string {
  return mix(hex, '#000000', amount);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;
  if (max === rn) hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) hue = ((bn - rn) / delta + 2) / 6;
  else hue = ((rn - gn) / delta + 4) / 6;
  return [hue * 360, saturation, lightness];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));

  if (sat === 0) {
    const gray = light * 255;
    return rgbToHex(gray, gray, gray);
  }

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t: number) => {
    let tc = t;
    if (tc < 0) tc += 1;
    if (tc > 1) tc -= 1;
    if (tc < 1 / 6) return p + (q - p) * 6 * tc;
    if (tc < 1 / 2) return q;
    if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
    return p;
  };
  return rgbToHex(channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255);
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function clampUnit(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Turn three vivid artwork seeds into the player palette. Unlike the previous
 * version, output saturation and lightness *track the source* instead of being
 * pinned to constants — that is what makes a muted sepia cover and a neon pop
 * cover land in visibly different places instead of the same pastel-on-dark
 * look. `vibrant`/`support`/`accent` are expected to already be three distinct
 * hue families (the extractor synthesises spread for monochrome art).
 */
function buildPalette(vibrant: string, support: string, average: string, accentSeed?: string): WebDynamicPalette {
  const [vh, vs, vl] = rgbToHsl(...hexToRgb(vibrant));
  const [sh, ss] = rgbToHsl(...hexToRgb(support));
  const [ah, asat, al] = rgbToHsl(...hexToRgb(average));

  // Legible UI accent (buttons, text-on-scrim). Bright, but its saturation and
  // a touch of its lightness follow the artwork so vivid covers stay punchy and
  // muted covers stay calm.
  const primary = hslToHex(vh, clampUnit(0.42 + vs * 0.5, 0.48, 0.95), clampUnit(0.6 + (vl - 0.5) * 0.24, 0.58, 0.76));

  const secondaryHue = hueDistance(vh, sh) < 26 ? vh + 46 : sh;
  const secondary = hslToHex(secondaryHue, clampUnit(0.38 + ss * 0.55, 0.42, 0.92), 0.68);

  // Prefer a real third color pulled from the artwork; only fall back to a
  // synthetic hue rotation when the image has no distinct third family.
  let accentHue = vh - 42;
  let accentSat = 0.6;
  if (accentSeed) {
    const [seedHue, seedSat] = rgbToHsl(...hexToRgb(accentSeed));
    if (hueDistance(seedHue, vh) > 22 && hueDistance(seedHue, secondaryHue) > 22) {
      accentHue = seedHue;
      accentSat = clampUnit(0.38 + seedSat * 0.58, 0.42, 0.92);
    }
  }
  const accent = hslToHex(accentHue, accentSat, 0.73);

  // Deep gradient stops keep each family's own temperature. Their saturation
  // scales with how saturated the seed actually is, so the background carries
  // the artwork's mood instead of a fixed teal-ish wash. Overall colorfulness
  // also drives the stop opacity: muted covers read subtle, vivid covers glow.
  const gSatV = clampUnit(0.32 + vs * 0.55, 0.34, 0.86);
  const gSatS = clampUnit(0.3 + ss * 0.55, 0.32, 0.82);
  const [, accentSourceSat] = rgbToHsl(...hexToRgb(accentSeed ?? vibrant));
  const gSatA = clampUnit(0.3 + accentSourceSat * 0.55, 0.32, 0.82);
  const punch = clampUnit(0.42 + (vs * 0.5 + ss * 0.3 + asat * 0.2), 0.44, 0.86);

  // Background anchors carry the average temperature but stay dark and legible.
  const background = hslToHex(ah, clampUnit(asat * 0.7 + 0.12, 0.14, 0.6), clampUnit(0.075 + al * 0.03, 0.06, 0.12));
  const backgroundAlt = hslToHex(vh + 16, clampUnit(0.3 + vs * 0.35, 0.28, 0.6), 0.115);

  const gradient = [
    `radial-gradient(120% 90% at 12% 6%, ${hexToRgba(hslToHex(vh, gSatV, 0.32), 0.62 * punch)} 0%, transparent 56%)`,
    `radial-gradient(105% 88% at 88% 12%, ${hexToRgba(hslToHex(secondaryHue, gSatS, 0.29), 0.56 * punch)} 0%, transparent 58%)`,
    `radial-gradient(112% 98% at 86% 94%, ${hexToRgba(hslToHex(accentHue, gSatA, 0.27), 0.52 * punch)} 0%, transparent 60%)`,
    `radial-gradient(150% 112% at 16% 112%, ${hexToRgba(hslToHex(secondaryHue - 18, gSatS * 0.9, 0.24), 0.48 * punch)} 0%, transparent 62%)`,
    `linear-gradient(168deg, ${background} 0%, ${backgroundAlt} 52%, ${darken(background, 0.4)} 100%)`,
  ].join(', ');

  return {
    background,
    backgroundAlt,
    primary,
    secondary,
    accent,
    text: '#f8fbff',
    muted: 'rgba(248, 251, 255, 0.64)',
    gradient,
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function fallbackPalette(track?: Track | null): WebDynamicPalette {
  const key = `${track?.title ?? ''}${track?.artist ?? ''}${track?.album ?? ''}`;
  const [vibrant, support, accentSeed] = FALLBACK_SEEDS[hashString(key) % FALLBACK_SEEDS.length];
  return buildPalette(vibrant, support, darken(vibrant, 0.4), brighten(accentSeed, 0.1));
}

interface HueBucket {
  /** Presence weight — how much of the cover this hue family occupies (ranking). */
  weight: number;
  /** Saturation-weighted colour accumulators — bias the representative toward
   *  the family's most vivid pixels so it never averages down into mud. */
  vividR: number;
  vividG: number;
  vividB: number;
  vividWeight: number;
  bestScore: number;
  bestColor: [number, number, number];
}

function canvasPaletteFromImage(image: HTMLImageElement): WebDynamicPalette {
  const canvas = document.createElement('canvas');
  const size = 96;
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');

  context.drawImage(image, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);

  const buckets = new Map<number, HueBucket>();
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  const center = (size - 1) / 2;
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const index = (y * size + x) * 4;
      const alpha = data[index + 3];
      if (alpha < 80) continue;

      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const distanceFromCenter = Math.hypot(x - center, y - center) / center;
      const positionWeight = 0.55 + Math.max(0, 1 - distanceFromCenter) * 0.55;
      red += r;
      green += g;
      blue += b;
      count += 1;

      const [hue, saturation, lightness] = rgbToHsl(r, g, b);
      if (saturation < 0.12 || lightness < 0.08 || lightness > 0.94) continue;

      // Finer 18° buckets (20 slots) discriminate neighbouring hues better than
      // the old 24° ones, so distinct families don't collapse into one.
      const bucketKey = Math.floor(hue / 18);
      const colorPresence = Math.max(0.12, saturation) * (1 - Math.abs(lightness - 0.48));
      const score = positionWeight * (saturation * 1.2 + (1 - Math.abs(lightness - 0.5)));
      const weight = positionWeight * colorPresence;
      // The representative colour is a saturation² weighted mean: vivid pixels
      // of the family dominate, so the seed stays punchy instead of graying out.
      const vivid = positionWeight * saturation * saturation * (1 - Math.abs(lightness - 0.55));

      const bucket = buckets.get(bucketKey);
      if (!bucket) {
        buckets.set(bucketKey, {
          weight,
          vividR: r * vivid,
          vividG: g * vivid,
          vividB: b * vivid,
          vividWeight: vivid,
          bestScore: score,
          bestColor: [r, g, b],
        });
      } else {
        bucket.weight += weight;
        bucket.vividR += r * vivid;
        bucket.vividG += g * vivid;
        bucket.vividB += b * vivid;
        bucket.vividWeight += vivid;
        if (score > bucket.bestScore) {
          bucket.bestScore = score;
          bucket.bestColor = [r, g, b];
        }
      }
    }
  }

  if (count === 0) throw new Error('No image pixels');
  const average = rgbToHex(red / count, green / count, blue / count);

  const ranked = [...buckets.values()].sort((a, b) => b.weight - a.weight);
  if (ranked.length === 0) {
    // Grayscale cover: build a monochrome palette from the average.
    const [, , lightness] = rgbToHsl(...hexToRgb(average));
    const vibrant = hslToHex(220, 0.16, Math.max(0.5, lightness));
    return buildPalette(vibrant, hslToHex(260, 0.14, 0.5), average);
  }

  // Vivid representative for a bucket, falling back to its peak pixel when the
  // saturation-weighted mean has no weight (very desaturated family).
  const representative = (bucket: HueBucket): string =>
    bucket.vividWeight > 0.0001
      ? rgbToHex(bucket.vividR / bucket.vividWeight, bucket.vividG / bucket.vividWeight, bucket.vividB / bucket.vividWeight)
      : rgbToHex(...bucket.bestColor);

  const dominant = ranked[0];
  const vibrant = representative(dominant);
  const [vibrantHue] = rgbToHsl(...hexToRgb(vibrant));

  const supportBucket = ranked
    .slice(1)
    .find(bucket => hueDistance(rgbToHsl(...hexToRgb(representative(bucket)))[0], vibrantHue) > 38);
  const support = supportBucket
    ? representative(supportBucket)
    : hslToHex(vibrantHue + 52, 0.55, 0.5);
  const supportHue = rgbToHsl(...hexToRgb(support))[0];

  // Third distinct hue family for the accent, when the artwork has one.
  const accentBucket = ranked
    .slice(1)
    .find(bucket => {
      if (bucket === supportBucket) return false;
      const [hue] = rgbToHsl(...hexToRgb(representative(bucket)));
      return hueDistance(hue, vibrantHue) > 24 && hueDistance(hue, supportHue) > 24;
    });

  return buildPalette(vibrant, support, average, accentBucket ? representative(accentBucket) : undefined);
}

/**
 * Ordered list of URLs to try when reading pixels from a cover. Blob/data URLs
 * and same-origin images are already canvas-readable, so they're used as-is.
 * Remote covers are tried directly first (works when the host sends CORS) and
 * then through our same-origin `/api/artwork` proxy — many art CDNs (notably
 * `resources.tidal.com`) serve images to `<img>` but withhold canvas CORS, so
 * without the proxy their palette silently falls back to the brand seeds. This
 * is what made "some songs" show a generic green background regardless of art.
 */
function extractionCandidates(artwork: string): string[] {
  if (/^(blob:|data:)/i.test(artwork)) return [artwork];
  if (artwork.startsWith('/')) return [artwork];
  let url: URL;
  try {
    url = new URL(artwork, typeof location !== 'undefined' ? location.href : undefined);
  } catch {
    return [artwork];
  }
  if (typeof location !== 'undefined' && url.hostname === location.hostname) return [artwork];
  if (url.hostname === 'resources.tidal.com') {
    return [`/api/artwork?url=${encodeURIComponent(url.href)}`, artwork];
  }
  return [artwork, `/api/artwork?url=${encodeURIComponent(url.href)}`];
}

function loadPaletteFrom(src: string): Promise<WebDynamicPalette | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        resolve(canvasPaletteFromImage(image));
      } catch {
        // Tainted canvas / no readable pixels — let the caller try the next src.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export async function getDynamicPalette(track?: Track | null): Promise<WebDynamicPalette> {
  if (!track?.artwork) return fallbackPalette(track);

  const cacheKey = `${track.id}:${track.artwork}`;
  const cached = paletteCache.get(cacheKey);
  if (cached) {
    // Refresh insertion order so frequently played tracks stay warm.
    paletteCache.delete(cacheKey);
    paletteCache.set(cacheKey, cached);
    return cached;
  }

  let palette: WebDynamicPalette | null = null;
  for (const src of extractionCandidates(track.artwork)) {
    palette = await loadPaletteFrom(src);
    if (palette) break;
  }
  const resolved = palette ?? fallbackPalette(track);

  paletteCache.set(cacheKey, resolved);
  while (paletteCache.size > MAX_PALETTE_CACHE_ENTRIES) {
    const oldestKey = paletteCache.keys().next().value;
    if (!oldestKey) break;
    paletteCache.delete(oldestKey);
  }
  return resolved;
}

export function paletteToCssVars(palette: WebDynamicPalette): Record<string, string> {
  return {
    '--fp-bg': palette.background,
    '--fp-bg-alt': palette.backgroundAlt,
    '--fp-primary': palette.primary,
    '--fp-secondary': palette.secondary,
    '--fp-accent': palette.accent,
    '--fp-text': palette.text,
    '--fp-muted': palette.muted,
    '--fp-gradient': palette.gradient,
  };
}
