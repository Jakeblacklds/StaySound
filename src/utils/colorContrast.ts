type Rgb = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function parseHexColor(value: string): Rgb | null {
  const hex = value.trim().replace('#', '');

  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }

  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }

  return null;
}

function parseRgbColor(value: string): Rgb | null {
  const match = value.trim().match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;

  const r = clamp(Number(match[1]), 0, 255);
  const g = clamp(Number(match[2]), 0, 255);
  const b = clamp(Number(match[3]), 0, 255);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b };
}

function parseColor(value?: string): Rgb | null {
  if (!value) return null;
  if (value.startsWith('#')) return parseHexColor(value);
  if (value.startsWith('rgb')) return parseRgbColor(value);
  return null;
}

function rgbToHex({ r, g, b }: Rgb) {
  return `#${[r, g, b]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function toLinear(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

export function getRelativeLuminance(color?: string): number | null {
  const rgb = parseColor(color);
  if (!rgb) return null;

  return (
    0.2126 * toLinear(rgb.r)
    + 0.7152 * toLinear(rgb.g)
    + 0.0722 * toLinear(rgb.b)
  );
}

export function getContrastRatio(foreground?: string, background?: string): number {
  const fg = getRelativeLuminance(foreground);
  const bg = getRelativeLuminance(background);

  if (fg === null || bg === null) return 1;

  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

export function pickReadableColor(
  background: string,
  candidates: Array<string | undefined>,
  fallbackCandidates: string[] = ['#111111', '#FFFFFF'],
) {
  const pool = [...candidates, ...fallbackCandidates].filter(
    (value): value is string => Boolean(value && parseColor(value)),
  );

  if (pool.length === 0) return fallbackCandidates[0] ?? '#111111';

  let best = pool[0];
  let bestRatio = getContrastRatio(pool[0], background);

  for (const candidate of pool.slice(1)) {
    const ratio = getContrastRatio(candidate, background);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }

  return best;
}

export function normalizeHexColor(value?: string, fallback = '#FFFFFF') {
  const parsed = parseColor(value) ?? parseColor(fallback);
  return parsed ? rgbToHex(parsed) : fallback;
}

export function mixHexColors(from: string, to: string, amount: number) {
  const source = parseColor(from);
  const target = parseColor(to);

  if (!source || !target) {
    return normalizeHexColor(from, to);
  }

  const t = clamp(amount, 0, 1);

  return rgbToHex({
    r: source.r + (target.r - source.r) * t,
    g: source.g + (target.g - source.g) * t,
    b: source.b + (target.b - source.b) * t,
  });
}

export function withAlpha(color: string, alpha: number) {
  const parsed = parseColor(color);
  if (!parsed) return color;

  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${clamp(alpha, 0, 1)})`;
}

type EnsureColorContrastOptions = {
  minRatio?: number;
  targetColor?: string;
  fallbackColor?: string;
};

export function ensureColorContrast(
  foreground: string | undefined,
  background: string | undefined,
  options?: EnsureColorContrastOptions,
) {
  const normalizedBackground = normalizeHexColor(background, '#080B12');
  const contrastTarget = normalizeHexColor(
    options?.targetColor,
    (getRelativeLuminance(normalizedBackground) ?? 0) > 0.42 ? '#0F1728' : '#FFFFFF',
  );
  const fallback = normalizeHexColor(options?.fallbackColor, contrastTarget);
  const normalizedForeground = normalizeHexColor(foreground, fallback);
  const minRatio = options?.minRatio ?? 4.5;

  if (getContrastRatio(normalizedForeground, normalizedBackground) >= minRatio) {
    return normalizedForeground;
  }

  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHexColors(normalizedForeground, contrastTarget, step / 20);
    if (getContrastRatio(candidate, normalizedBackground) >= minRatio) {
      return candidate;
    }
  }

  return contrastTarget;
}
