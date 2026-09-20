type VercelRequest = { query: Record<string, string | string[] | undefined> };
type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => void;
  json: (body: unknown) => void;
  end: (body?: string) => void;
};

// artwork.boidu.dev already does the part we cannot do from the browser: it
// talks to amp-api.music.apple.com (the web player's private catalog API, the
// only place `editorialVideo` is exposed — the documented api.music.apple.com
// silently drops `extend=editorialVideo`) and hands back plain JSON with CORS.
// We still front it with this endpoint so the provider is one line of ours to
// change, and so the HLS-to-MP4 resolution below happens once on the edge
// instead of costing every client two extra round trips.
const PROVIDER = 'https://artwork.boidu.dev/';

// Motion covers are served from Apple's media CDN. Nothing else is followed.
function isAppleMedia(url: URL): boolean {
  return url.protocol === 'https:' && (url.hostname === 'apple.com' || url.hostname.endsWith('.apple.com'));
}

type Variant = { url: string; width: number; height: number };

/**
 * Picks the cheapest rendition that still covers the tile.
 *
 * Two filters matter and both are easy to get wrong:
 * - HEVC (`hvc1`) variants are roughly half the bytes but Chrome on most
 *   desktops will not decode them, so only `avc1` is safe for the web build.
 * - I-frame (trickPlay) variants parse as ordinary streams but contain no
 *   playable video, so they have to be dropped before the size comparison.
 */
function selectVariant(master: string, masterUrl: string, targetWidth: number): Variant | null {
  const lines = master.split('\n').map(line => line.trim());
  const variants: Variant[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const codecs = line.match(/CODECS="([^"]+)"/)?.[1] || '';
    if (!codecs.includes('avc1')) continue;
    const resolution = line.match(/RESOLUTION=(\d+)x(\d+)/);
    const uri = lines[index + 1];
    if (!resolution || !uri || uri.startsWith('#')) continue;
    try {
      const resolved = new URL(uri, masterUrl);
      if (!isAppleMedia(resolved)) continue;
      variants.push({ url: resolved.href, width: Number(resolution[1]), height: Number(resolution[2]) });
    } catch {
      continue;
    }
  }

  if (variants.length === 0) return null;
  variants.sort((left, right) => left.width - right.width);
  // Smallest rendition that still covers the tile; if the target is larger than
  // anything on offer, the largest is the closest we can get.
  return variants.find(variant => variant.width >= targetWidth) || variants[variants.length - 1];
}

/**
 * Turns a variant playlist into a single plain MP4 URL.
 *
 * Apple's variants are byte-range HLS over one fragmented MP4: every segment
 * points at the same file, and `#EXT-X-MAP` names it. Fetching that file whole
 * gives a normal progressive MP4 that every browser plays from `<video src>`,
 * which is why this endpoint exists at all — it means the web build needs no
 * HLS player and no media-source plumbing for a looping album cover.
 */
function mp4FromVariant(playlist: string, variantUrl: string): string | null {
  const mapUri = playlist.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1];
  if (!mapUri) return null;
  try {
    const resolved = new URL(mapUri, variantUrl);
    return isAppleMedia(resolved) ? resolved.href : null;
  } catch {
    return null;
  }
}

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const title = single(req.query.title);
  const artist = single(req.query.artist);
  const requestedWidth = Number(single(req.query.size)) || 360;
  const targetWidth = Math.min(1080, Math.max(120, Math.round(requestedWidth)));

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!title || !artist || title.length > 300 || artist.length > 300) {
    res.status(400).setHeader('Cache-Control', 'no-store');
    res.json({ error: 'title and artist are required' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const lookup = new URL(PROVIDER);
    lookup.searchParams.set('s', title);
    lookup.searchParams.set('a', artist);
    const found = JSON.parse(await fetchText(lookup.href, controller.signal)) as {
      albumId?: unknown;
      static?: unknown;
      animated?: unknown;
      videoUrl?: unknown;
    };

    const poster = typeof found.static === 'string' ? found.static : null;
    const albumId = typeof found.albumId === 'string' ? found.albumId : null;
    const masterUrl = typeof found.animated === 'string' ? found.animated : null;

    // A miss is a real, cacheable answer: most albums have no motion cover, and
    // re-asking on every render is how this turns into a request storm.
    if (!masterUrl) {
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
      res.status(200).json({ albumId, poster, mp4: null, width: null, height: null });
      return;
    }

    if (!isAppleMedia(new URL(masterUrl))) throw new Error('Motion cover host is not Apple media');

    const variant = selectVariant(await fetchText(masterUrl, controller.signal), masterUrl, targetWidth);
    const mp4 = variant ? mp4FromVariant(await fetchText(variant.url, controller.signal), variant.url) : null;

    if (!mp4 || !variant) {
      // The full-resolution MP4 the provider hands back is ~16 MB at 2160x2160.
      // It is a correct answer but a terrible one for a grid tile, so it is only
      // the fallback for when variant resolution fails outright.
      const full = typeof found.videoUrl === 'string' ? found.videoUrl : null;
      const usable = full && isAppleMedia(new URL(full)) ? full : null;
      res.setHeader('Cache-Control', usable ? 'public, max-age=604800, s-maxage=2592000' : 'public, max-age=3600');
      res.status(200).json(
        usable
          ? { albumId, poster, mp4: usable, width: 2160, height: 2160, downscaled: false }
          : { albumId, poster, mp4: null, width: null, height: null, tentative: true },
      );
      return;
    }

    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400');
    res.status(200).json({
      albumId,
      poster,
      mp4,
      width: variant.width,
      height: variant.height,
      downscaled: true,
    });
  } catch {
    // A failed lookup is answered as a short-lived miss, not an error. The
    // provider takes ~20s on some albums it cannot match, and a library full of
    // local rips is mostly those: returning 502 leaves the answer uncacheable,
    // so every hover pays the timeout again. An hour of "no motion cover" is
    // the cheaper wrong answer, and `tentative` tells the client not to hold it
    // as long as a real miss.
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.status(200).json({ albumId: null, poster: null, mp4: null, width: null, height: null, tentative: true });
  } finally {
    clearTimeout(timeout);
  }
}
