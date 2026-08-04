type VercelRequest = {
  method?: string;
  query: {
    action?: string | string[];
    id?: string | string[];
    q?: string | string[];
  };
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

const JIOSAAVN_API_URL = 'https://www.jiosaavn.com/api.php';
const MAX_RESPONSE_BYTES = 2_000_000;

function first(value?: string | string[]): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

function buildUpstreamUrl(action: string, query: string, albumId: string): URL | null {
  const url = new URL(JIOSAAVN_API_URL);
  url.searchParams.set('_format', 'json');
  url.searchParams.set('_marker', '0');
  url.searchParams.set('ctx', 'web6dot0');
  url.searchParams.set('api_version', '4');

  if (action === 'album-search') {
    if (!query || query.length > 180) return null;
    url.searchParams.set('__call', 'search.getAlbumResults');
    url.searchParams.set('q', query);
    url.searchParams.set('n', '20');
    url.searchParams.set('p', '1');
    return url;
  }

  if (action === 'album-details') {
    if (!/^\d{1,20}$/.test(albumId)) return null;
    url.searchParams.set('__call', 'content.getAlbumDetails');
    url.searchParams.set('albumid', albumId);
    return url;
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method && req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  const source = buildUpstreamUrl(
    first(req.query.action),
    first(req.query.q),
    first(req.query.id),
  );
  if (!source) {
    res.status(400).end();
    return;
  }

  try {
    const upstream = await fetch(source, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        referer: 'https://www.jiosaavn.com/',
        'user-agent': 'Mozilla/5.0 (compatible; StaySound/1.0)',
      },
    });
    const payload = await upstream.text();
    if (!upstream.ok || payload.length > MAX_RESPONSE_BYTES) {
      res.status(502).end();
      return;
    }

    JSON.parse(payload);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).end(payload);
  } catch {
    res.status(502).end();
  }
}
