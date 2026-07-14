type VercelRequest = { query: { url?: string | string[] } };
type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => void;
  end: (body?: Uint8Array) => void;
};

// Hosts we never proxy — private/loopback/link-local/metadata targets. The
// proxy fetches server-side, so without this an attacker could probe the
// internal network (SSRF). We only serve real image bytes from public https
// hosts back to the browser.
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  // Bare hostnames (no dot) and *.local resolve to internal machines.
  if (!host.includes('.') || host.endsWith('.local')) return true;
  // IPv6 literals — block loopback/link-local/unique-local.
  if (host.includes(':')) return /^(::1|fe80:|fc|fd)/i.test(host) || host === '::';
  // IPv4 literal in a private / loopback / link-local range.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

// Same-origin image proxy for covers whose host serves images to <img> but
// withholds canvas CORS headers (e.g. resources.tidal.com), so the web player
// can read their pixels and derive the dynamic theme. Public https images only.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const rawUrl = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  if (!rawUrl) {
    res.status(400).end();
    return;
  }

  let source: URL;
  try {
    source = new URL(rawUrl);
  } catch {
    res.status(400).end();
    return;
  }

  if (source.protocol !== 'https:' || isBlockedHostname(source.hostname)) {
    res.status(400).end();
    return;
  }

  try {
    const upstream = await fetch(source, { headers: { accept: 'image/*' } });
    const contentType = upstream.headers.get('content-type') || '';
    const length = Number(upstream.headers.get('content-length') || 0);
    if (!upstream.ok || !contentType.startsWith('image/') || length > 2_500_000) {
      res.status(502).end();
      return;
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > 2_500_000) {
      res.status(502).end();
      return;
    }
    res.setHeader('Content-Type', contentType);
    // Let the browser read the proxied pixels back onto a canvas.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).end(bytes);
  } catch {
    res.status(502).end();
  }
}
