#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function normalizeKeyPart(rawValue) {
  return rawValue
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createSongId(song, artist) {
  const artistPart = normalizeKeyPart(artist).replace(/\s+/g, '_');
  const songPart = normalizeKeyPart(song).replace(/\s+/g, '_');
  return `${artistPart}_-_${songPart}`;
}

function parseArgs(argv) {
  const options = {
    files: [],
    song: null,
    artist: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--song') {
      options.song = argv[++i] ?? null;
    } else if (arg === '--artist') {
      options.artist = argv[++i] ?? null;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      options.files.push(arg);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Uso:
  node scripts/upload_song_alignment.mjs <archivo-o-carpeta> [mas-archivos] [--song "Titulo"] [--artist "Artista"] [--dry-run]

Ejemplos:
  node scripts/upload_song_alignment.mjs "D:\\Alignr\\u.n.i.json"
  node scripts/upload_song_alignment.mjs "D:\\Alignr\\exports" --dry-run
  node scripts/upload_song_alignment.mjs "./tmp/song.json" --song "U.N.I." --artist "Ed Sheeran"
`);
}

function collectJsonFiles(inputPath) {
  const resolved = path.resolve(inputPath);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    return fs.readdirSync(resolved)
      .filter(name => name.toLowerCase().endsWith('.json'))
      .map(name => path.join(resolved, name));
  }
  return [resolved];
}

function assertLyricsPayload(payload, filePath) {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`JSON invalido en ${filePath}`);
  }
  if (!payload.meta || typeof payload.meta !== 'object') {
    throw new Error(`Falta meta en ${filePath}`);
  }
  if (!Array.isArray(payload.lyrics)) {
    throw new Error(`Falta lyrics[] en ${filePath}`);
  }
}

function readPayload(filePath, overrides) {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assertLyricsPayload(payload, filePath);

  const song = (overrides.song ?? payload.meta.song ?? '').trim();
  const artist = (overrides.artist ?? payload.meta.artist ?? '').trim();

  if (!song || !artist) {
    throw new Error(`No pude determinar song/artist en ${filePath}`);
  }

  payload.meta.song = song;
  payload.meta.artist = artist;

  return {
    song,
    artist,
    songId: createSongId(song, artist),
    payload,
  };
}

function getLyricsSupabaseConfig() {
  const url = (process.env.LYRICS_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const serviceRoleKey = (process.env.LYRICS_SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !serviceRoleKey) {
    throw new Error('Falta configurar LYRICS_SUPABASE_URL o LYRICS_SUPABASE_SERVICE_ROLE_KEY en .env');
  }
  return { url, serviceRoleKey };
}

async function supabaseRequest(url, serviceRoleKey, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase respondio ${response.status}: ${body}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function findExistingRow(baseUrl, serviceRoleKey, song, artist, songId) {
  const bySongIdUrl = `${baseUrl}/rest/v1/song_alignments?select=song_id,song,artist&song_id=eq.${encodeURIComponent(songId)}&limit=1`;
  const bySongId = await supabaseRequest(bySongIdUrl, serviceRoleKey, { method: 'GET' });
  if (Array.isArray(bySongId) && bySongId.length > 0) {
    return bySongId[0];
  }

  const bySongArtistUrl = `${baseUrl}/rest/v1/song_alignments?select=song_id,song,artist&song=eq.${encodeURIComponent(song)}&artist=eq.${encodeURIComponent(artist)}&limit=1`;
  const bySongArtist = await supabaseRequest(bySongArtistUrl, serviceRoleKey, { method: 'GET' });
  if (Array.isArray(bySongArtist) && bySongArtist.length > 0) {
    return bySongArtist[0];
  }

  return null;
}

async function uploadPayload(config, record, dryRun) {
  const row = {
    song_id: record.songId,
    song: record.song,
    artist: record.artist,
    payload: record.payload,
  };

  if (dryRun) {
    return { mode: 'dry-run', row };
  }

  const existing = await findExistingRow(config.url, config.serviceRoleKey, record.song, record.artist, record.songId);

  if (existing?.song_id) {
    const patchUrl = `${config.url}/rest/v1/song_alignments?song_id=eq.${encodeURIComponent(existing.song_id)}`;
    const updated = await supabaseRequest(patchUrl, config.serviceRoleKey, {
      method: 'PATCH',
      body: JSON.stringify(row),
    });
    return { mode: 'updated', row: updated?.[0] ?? row };
  }

  const postUrl = `${config.url}/rest/v1/song_alignments`;
  const inserted = await supabaseRequest(postUrl, config.serviceRoleKey, {
    method: 'POST',
    body: JSON.stringify(row),
  });
  return { mode: 'inserted', row: inserted?.[0] ?? row };
}

async function main() {
  loadDotEnv(path.join(process.cwd(), '.env'));
  const options = parseArgs(process.argv.slice(2));
  if (options.help || options.files.length === 0) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  const config = getLyricsSupabaseConfig();
  const files = options.files.flatMap(collectJsonFiles);

  if (files.length === 0) {
    throw new Error('No encontre archivos .json para subir.');
  }

  for (const filePath of files) {
    const record = readPayload(filePath, options);
    const result = await uploadPayload(config, record, options.dryRun);
    console.log(`[${result.mode}] ${record.artist} - ${record.song}`);
    console.log(`  file: ${filePath}`);
    console.log(`  song_id: ${record.songId}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
