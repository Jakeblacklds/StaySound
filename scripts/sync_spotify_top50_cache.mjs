import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env');
const TOP50_KEY = 'top50_global';
const TOP50_PLAYLIST_ID = '37i9dQZEVXbMDoHDwVN2tF';
const TOP50_PLAYLIST_URL = `https://open.spotify.com/playlist/${TOP50_PLAYLIST_ID}`;
const PLAYWRIGHT_EXECUTABLE_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function decodeHtml(value) {
  return value
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function htmlToPlain(value) {
  if (!value) return '';
  return decodeHtml(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${text.slice(0, 300)}`);
  }
  return text;
}

async function fetchTrackMeta(trackId) {
  const html = await fetchText(`https://open.spotify.com/track/${trackId}`);
  const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
  const description = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
  const artwork = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  const spotifyUrl = html.match(/<meta property="og:url" content="([^"]+)"/)?.[1] ?? `https://open.spotify.com/track/${trackId}`;
  const normalizedDescription = htmlToPlain(description);
  const [artist = 'Unknown Artist', album = 'Unknown Album'] = normalizedDescription
    .split(' · ')
    .slice(0, 2);

  if (!title) {
    throw new Error(`Missing title for track ${trackId}`);
  }

  return {
    id: `spotify_${trackId}`,
    spotifyId: trackId,
    spotifyUri: `spotify:track:${trackId}`,
    spotifyUrl,
    uri: `spotify://track/${trackId}`,
    title: decodeHtml(title),
    artist,
    album,
    artwork,
    duration: 0,
    source: 'spotify',
    cloudOnly: true,
    dateAdded: Date.now(),
  };
}

function findChromiumExecutable() {
  return PLAYWRIGHT_EXECUTABLE_CANDIDATES.find(candidate => fs.existsSync(candidate)) ?? null;
}

function parseSpotifyTrackId(trackHref) {
  return trackHref.match(/\/track\/([a-zA-Z0-9]+)/)?.[1] ?? null;
}

function parseDurationMs(durationText) {
  const parts = durationText
    .split(':')
    .map(part => Number.parseInt(part, 10))
    .filter(part => !Number.isNaN(part));

  if (parts.length === 2) {
    return ((parts[0] * 60) + parts[1]) * 1000;
  }

  if (parts.length === 3) {
    return ((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000;
  }

  return 0;
}

async function scrapeTop50WithBrowser() {
  const executablePath = findChromiumExecutable();
  if (!executablePath) {
    throw new Error('No Chrome/Edge executable found for Playwright. Set PLAYWRIGHT_CHROMIUM_PATH if needed.');
  }

  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1200 },
      locale: 'es-MX',
    });

    await page.goto(TOP50_PLAYLIST_URL, {
      waitUntil: 'networkidle',
      timeout: 120000,
    });

    const viewport = page.locator('.main-view-container__scroll-node [data-overlayscrollbars-viewport]').first();
    const name = decodeHtml(await page.locator('meta[property="og:title"]').getAttribute('content') ?? 'Top 50 - Global');
    const description = htmlToPlain(await page.locator('meta[property="og:description"]').getAttribute('content') ?? '');
    const artwork = await page.locator('meta[property="og:image"]').getAttribute('content')
      ?? 'https://charts-images.scdn.co/assets/locale_en/regional/daily/region_global_default.jpg';

    const seenTracks = new Map();
    let stalledPasses = 0;

    for (let step = 0; step < 40; step += 1) {
      const rows = await page.locator('[data-testid="tracklist-row"]').evaluateAll(nodes => nodes.map(node => {
        const trackLink = node.querySelector('a[href*="/track/"]');
        const albumLink = node.querySelector('a[href*="/album/"]');
        const artistLinks = Array.from(node.querySelectorAll('a[href*="/artist/"]'));
        const artworkImage = node.querySelector('img[src]');
        const durationNode = Array.from(node.querySelectorAll('[data-encore-id="text"]'))
          .find(element => /^\d+:\d{2}(?::\d{2})?$/.test(element.textContent?.trim() ?? ''));

        return {
          trackHref: trackLink?.getAttribute('href') ?? null,
          title: trackLink?.textContent?.trim() ?? null,
          artists: artistLinks.map(link => link.textContent?.trim()).filter(Boolean),
          album: albumLink?.textContent?.trim() ?? null,
          artwork: artworkImage?.getAttribute('src') ?? null,
          durationText: durationNode?.textContent?.trim() ?? null,
        };
      }));

      const beforeCount = seenTracks.size;
      for (const row of rows) {
        if (!row.trackHref || !row.title) continue;

        const trackId = parseSpotifyTrackId(row.trackHref);
        if (!trackId || seenTracks.has(trackId)) continue;

        seenTracks.set(trackId, {
          id: `spotify_${trackId}`,
          spotifyId: trackId,
          spotifyUri: `spotify:track:${trackId}`,
          spotifyUrl: `https://open.spotify.com/track/${trackId}`,
          uri: `spotify://track/${trackId}`,
          title: decodeHtml(row.title),
          artist: row.artists.join(', ') || 'Unknown Artist',
          album: row.album || name,
          artwork: row.artwork || artwork,
          duration: parseDurationMs(row.durationText ?? ''),
          source: 'spotify',
          cloudOnly: true,
          dateAdded: Date.now(),
          trackNumber: seenTracks.size + 1,
        });
      }

      if (seenTracks.size >= 50) {
        break;
      }

      stalledPasses = seenTracks.size === beforeCount ? stalledPasses + 1 : 0;
      await viewport.evaluate((node, amount) => node.scrollBy(0, amount), 1200);
      await page.waitForTimeout(stalledPasses > 0 ? 700 : 350);

      if (stalledPasses >= 4) {
        break;
      }
    }

    const tracks = Array.from(seenTracks.values()).slice(0, 50);

    if (tracks.length === 0) {
      throw new Error('Could not extract any Spotify tracks from the rendered playlist page.');
    }

    return {
      name,
      description,
      artwork,
      tracks,
    };
  } finally {
    await browser.close();
  }
}

async function scrapeTop50() {
  const { name, description, artwork, tracks } = await scrapeTop50WithBrowser();

  return {
    chart_key: TOP50_KEY,
    name,
    description,
    artwork,
    external_url: TOP50_PLAYLIST_URL,
    payload: {
      tracks,
      trackIds: tracks.map(track => track.id),
      source: 'spotify-public-page',
    },
    fetched_at: new Date().toISOString(),
  };
}

async function upsertCache(row) {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/app_spotify_chart_cache?on_conflict=chart_key`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([row]),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${text}`);
  }
}

async function main() {
  loadEnvFile(ENV_PATH);
  const row = await scrapeTop50();
  await upsertCache(row);
  console.log(`Cached ${row.payload.tracks.length} Spotify tracks to Supabase.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
