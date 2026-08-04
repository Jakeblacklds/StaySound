/**
 * Removes presentation labels added by video platforms without erasing the
 * recording identity. Credits and variants such as feat., remix, live,
 * acoustic, remastered and radio edit must reach every lyrics provider.
 */

function normalizeNoiseLabel(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function isPresentationNoise(value: string): boolean {
  const tokens = normalizeNoiseLabel(value);
  if (!tokens.length) return false;
  if (tokens.every(token => ['4k', '8k', 'hd', 'uhd'].includes(token))) return true;

  const mediaTokens = new Set([
    'audio',
    'letra',
    'lyric',
    'lyrics',
    'video',
    'visualiser',
    'visualizer',
  ]);
  const allowedTokens = new Set([
    ...mediaTokens,
    '4k',
    '8k',
    'con',
    'hd',
    'music',
    'musica',
    'musical',
    'oficial',
    'official',
    'uhd',
  ]);
  return tokens.some(token => mediaTokens.has(token))
    && tokens.every(token => allowedTokens.has(token));
}

export function cleanLyricsLookupMetadata(value: string | undefined): string {
  let cleaned = (value ?? '').replace(
    /\s*[\[(]([^\])]+)[\])]/g,
    (full, content: string) => (isPresentationNoise(content) ? '' : full),
  );

  // A platform label may be appended with a dash instead of brackets. Repeat
  // so "Song - Official Video - 4K" is cleaned completely.
  while (true) {
    const suffix = cleaned.match(/^(.*?)\s+-\s+([^\-]+)\s*$/);
    if (!suffix || !isPresentationNoise(suffix[2])) break;
    cleaned = suffix[1];
  }

  return cleaned.replace(/\s+/g, ' ').trim();
}

export function buildLyricsLookupQuery(metadata: {
  title: string;
  artist: string;
  album?: string;
}): string {
  return [metadata.title, metadata.artist, metadata.album]
    .map(value => cleanLyricsLookupMetadata(value) || value || '')
    .filter(value => value && !/^unknown/i.test(value))
    .join(' ');
}
