/**
 * Ranking del buscador de catálogo (Descargas en escritorio/web y Buscar en
 * Android: ambos importan este módulo, así que ordenan igual).
 *
 * TIDAL (y los mirrors) devuelven cada lista en su propio orden y sin relación
 * entre ellas: la "mejor" canción podía ser un karaoke, un artista exacto
 * quedaba debajo de sus colaboraciones y el primer resultado siempre era una
 * canción aunque se buscara a un artista. Aquí se reordena todo con una sola
 * medida, parecida a la de Spotify:
 *
 *   relevancia textual (qué tan bien coincide lo escrito)  → lo que más pesa
 *   popularidad del catálogo                              → desempata versiones
 *   posición original de TIDAL                             → su señal de relevancia
 *
 * y se castigan las versiones que casi nunca son lo que se busca (karaoke,
 * tributos, sped up…) salvo que la búsqueda las pida explícitamente.
 */

/** Lo mínimo que el ranking necesita de cada entidad; cada app tiene sus propios tipos. */
export type RankableTrack = {
  id: number;
  title: string;
  artist: string;
  artistId?: number;
  durationMs: number;
  explicit?: boolean;
  popularity?: number;
};

export type RankableAlbum = {
  id: number;
  title: string;
  /** Web usa `artist`, Android `artistName`. */
  artist?: string;
  artistName?: string;
  type?: string;
  popularity?: number;
  explicit?: boolean;
};

export type RankableArtist = { id: number; name: string; popularity?: number };

export type RankedTopResult<T, A, R> =
  | { kind: 'artist'; artist: R }
  | { kind: 'track'; track: T }
  | { kind: 'album'; album: A };

export type RankedSearch<T, A, R> = {
  tracks: T[];
  albums: A[];
  artists: R[];
  top: RankedTopResult<T, A, R> | null;
};

function albumArtist(album: RankableAlbum): string {
  return album.artist ?? album.artistName ?? '';
}

export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokensOf(value: string): string[] {
  return value ? value.split(' ').filter(Boolean) : [];
}

/** Distancia de edición acotada: solo necesitamos saber si es ≤ max. */
function withinEdits(left: string, right: string, max: number): boolean {
  if (Math.abs(left.length - right.length) > max) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return false;
    previous = current;
  }
  return previous[right.length] <= max;
}

/** Un token de la búsqueda "toca" uno del texto: prefijo (se está escribiendo) o errata. */
function tokenHits(queryToken: string, textToken: string): 'prefix' | 'typo' | null {
  if (textToken.startsWith(queryToken)) return 'prefix';
  if (queryToken.length >= 4) {
    const allowed = queryToken.length >= 8 ? 2 : 1;
    // Comparar contra el mismo largo cubre las erratas en palabras a medio escribir.
    const candidate = textToken.slice(0, Math.max(queryToken.length, Math.min(textToken.length, queryToken.length + allowed)));
    if (withinEdits(queryToken, candidate, allowed) || withinEdits(queryToken, textToken, allowed)) return 'typo';
  }
  return null;
}

/**
 * 0..1: qué tan bien describe `query` a `text`. Exacto > empieza igual > todas
 * las palabras presentes (en cualquier orden) > contenido > erratas.
 */
export function textMatch(query: string, text: string): number {
  const q = foldText(query);
  const t = foldText(text);
  if (!q || !t) return 0;
  if (t === q) return 1;

  const qCompact = q.replace(/ /g, '');
  const tCompact = t.replace(/ /g, '');
  // "acdc" ↔ "AC/DC", "blink182" ↔ "blink-182".
  if (qCompact === tCompact) return 0.97;

  const extra = Math.max(0, t.length - q.length);
  const lengthPenalty = Math.min(0.14, extra / 90);
  if (t.startsWith(q)) return 0.9 - lengthPenalty;

  const qTokens = tokensOf(q);
  const tTokens = tokensOf(t);
  let prefixHits = 0;
  let typoHits = 0;
  for (const token of qTokens) {
    const hits = tTokens.map(textToken => tokenHits(token, textToken));
    if (hits.includes('prefix')) prefixHits += 1;
    else if (hits.includes('typo')) typoHits += 1;
  }
  if (prefixHits === qTokens.length) return 0.8 - lengthPenalty;
  if (tCompact.includes(qCompact)) return 0.62 - lengthPenalty;
  if (prefixHits + typoHits === qTokens.length) return 0.7 - lengthPenalty;
  return ((prefixHits + typoHits * 0.8) / qTokens.length) * 0.5;
}

const NOISE_VERSION = /\b(karaoke|instrumental|tribute|originally performed|made famous|in the style of|cover|covers|sped up|speed up|slowed|reverb|nightcore|8d|lullaby|piano version|ringtone)\b/;
const MILD_VERSION = /\b(remix|mix|live|en vivo|acoustic|acustico|edit|version|demo|mono|remaster|remastered)\b/;
const NOISE_ARTIST = /\b(karaoke|tribute|lullaby|rockabye baby|kidz bop|string quartet|cover band|covers|hits|8d|8 bit|piano|orchestra|twinkle)\b/;
const ALBUM_VARIANT = /\s*[([]\s*(dolby atmos|360 reality audio|explicit|clean|explicit version|clean version)\s*[)\]]\s*/gi;

/** Multiplicador por versiones que casi nadie busca a propósito. */
function versionPenalty(query: string, title: string, artist = ''): number {
  const q = foldText(query);
  const t = foldText(title);
  const a = foldText(artist);
  let factor = 1;
  const noise = t.match(NOISE_VERSION)?.[0];
  if (noise && !q.includes(noise)) factor *= 0.5;
  const mild = t.match(MILD_VERSION)?.[0];
  if (mild && !q.includes(mild)) factor *= mild.startsWith('remaster') ? 0.97 : 0.88;
  const noisyArtist = a.match(NOISE_ARTIST)?.[0];
  if (noisyArtist && !q.includes(noisyArtist)) factor *= 0.55;
  return factor;
}

/** 1 para el primer resultado de TIDAL, bajando suavemente hasta 0. */
function positionPrior(index: number): number {
  return Math.max(0, 1 - index / 30);
}

function popularity(value?: number): number {
  return Math.max(0, Math.min(1, (value ?? 0) / 100));
}

type Scored<T> = { item: T; score: number; text: number };

function scoreTrack<T extends RankableTrack>(query: string, track: T, index: number): Scored<T> {
  const title = textMatch(query, track.title);
  // La gente escribe "bad bunny titi" o "titi bad bunny": se prueban ambos órdenes.
  const combined = Math.max(
    textMatch(query, `${track.title} ${track.artist}`),
    textMatch(query, `${track.artist} ${track.title}`),
  );
  // Buscar solo al artista también debe traer sus canciones más escuchadas.
  const byArtist = textMatch(query, track.artist) * 0.78;
  const text = Math.max(title, combined * 0.96, byArtist);
  const score = (text * 0.56 + popularity(track.popularity) * 0.26 + positionPrior(index) * 0.18)
    * versionPenalty(query, track.title, track.artist);
  return { item: track, score, text };
}

function scoreAlbum<A extends RankableAlbum>(query: string, album: A, index: number): Scored<A> {
  const artist = albumArtist(album);
  const title = textMatch(query, album.title);
  const combined = Math.max(
    textMatch(query, `${album.title} ${artist}`),
    textMatch(query, `${artist} ${album.title}`),
  );
  const byArtist = textMatch(query, artist) * 0.74;
  const text = Math.max(title, combined * 0.96, byArtist);
  // Un sencillo que se llama igual que la búsqueda suele ser la canción, no el disco.
  const typeFactor = album.type === 'SINGLE' ? 0.9 : 1;
  const score = (text * 0.56 + popularity(album.popularity) * 0.24 + positionPrior(index) * 0.2)
    * versionPenalty(query, album.title, artist) * typeFactor;
  return { item: album, score, text };
}

function scoreArtist<R extends RankableArtist>(query: string, artist: R, index: number): Scored<R> {
  const text = textMatch(query, artist.name);
  // La búsqueda de artistas de TIDAL solo informa popularidad del primero; la
  // posición pesa más que en canciones para no hundir al resto.
  const score = (text * 0.6 + popularity(artist.popularity) * 0.14 + positionPrior(index) * 0.26)
    * versionPenalty(query, '', artist.name);
  return { item: artist, score, text };
}

function rank<T>(scored: Array<Scored<T>>): Array<Scored<T>> {
  return scored.sort((left, right) => right.score - left.score);
}

function trackKey(track: RankableTrack): string {
  return `${foldText(track.title)}|${foldText(track.artist)}|${Math.round((track.durationMs || 0) / 3000)}`;
}

/** Misma canción publicada como explícita y limpia, o en el álbum y el sencillo. */
function dedupeRankedTracks<T extends RankableTrack>(ranked: Array<Scored<T>>): Array<Scored<T>> {
  const byKey = new Map<string, Scored<T>>();
  const ids = new Set<number>();
  for (const entry of ranked) {
    if (ids.has(entry.item.id)) continue;
    ids.add(entry.item.id);
    const key = trackKey(entry.item);
    const current = byKey.get(key);
    // Ya viene ordenado: el primero gana, salvo que el siguiente sea la versión
    // explícita de la misma canción (la original, casi siempre).
    if (!current) byKey.set(key, entry);
    else if (!current.item.explicit && entry.item.explicit && entry.score > current.score * 0.9) {
      byKey.set(key, { ...entry, score: current.score });
    }
  }
  return [...byKey.values()].sort((left, right) => right.score - left.score);
}

export function canonicalAlbumTitle(title: string): string {
  return title.replace(ALBUM_VARIANT, ' ').replace(/\s+/g, ' ').trim();
}

/** Dolby Atmos, 360 y explícito/limpio son el mismo disco para quien descarga. */
export function dedupeAlbumVariants<A extends RankableAlbum>(albums: A[]): A[] {
  const byKey = new Map<string, A>();
  for (const album of albums) {
    const key = `${foldText(canonicalAlbumTitle(album.title))}|${foldText(albumArtist(album))}|${album.type ?? ''}`;
    const current = byKey.get(key);
    const isVariant = canonicalAlbumTitle(album.title) !== album.title;
    if (!current) {
      byKey.set(key, isVariant ? { ...album, title: canonicalAlbumTitle(album.title) } : album);
      continue;
    }
    const currentIsVariant = current.title !== canonicalAlbumTitle(current.title);
    const better = (!isVariant && currentIsVariant)
      || (Boolean(album.explicit) && !current.explicit && !isVariant);
    if (better) byKey.set(key, { ...album, popularity: Math.max(album.popularity ?? 0, current.popularity ?? 0) });
  }
  return [...byKey.values()];
}

function dedupeArtists<R extends RankableArtist>(artists: R[]): R[] {
  const seen = new Set<number>();
  return artists.filter(artist => (seen.has(artist.id) ? false : (seen.add(artist.id), true)));
}

/**
 * Reordena una búsqueda completa y elige el "mejor resultado".
 *
 * `hint` es el topHit de TIDAL cuando existe: se respeta si de verdad coincide
 * con lo escrito; si no (TIDAL a veces propone un artista que solo comparte una
 * palabra), gana el candidato con mejor puntuación propia.
 */
export function rankCatalogSearch<T extends RankableTrack, A extends RankableAlbum, R extends RankableArtist>(
  query: string,
  raw: { tracks: T[]; albums: A[]; artists: R[] },
  hint?: RankedTopResult<T, A, R> | null,
): RankedSearch<T, A, R> {
  const tracks = dedupeRankedTracks(rank(raw.tracks.map((track, index) => scoreTrack(query, track, index))));
  const albums = rank(dedupeAlbumVariants(raw.albums).map((album, index) => scoreAlbum(query, album, index)));
  const artists = rank(dedupeArtists(raw.artists).map((artist, index) => scoreArtist(query, artist, index)));

  const candidates: Array<{ top: RankedTopResult<T, A, R>; score: number; text: number }> = [];
  if (artists[0]) {
    // Escribir el nombre exacto de un artista casi siempre significa "llévame a
    // su página", como en Spotify.
    const exactBonus = artists[0].text >= 0.97 ? 0.2 : artists[0].text >= 0.88 ? 0.08 : 0;
    candidates.push({ top: { kind: 'artist', artist: artists[0].item }, score: artists[0].score + exactBonus, text: artists[0].text });
  }
  if (tracks[0]) candidates.push({ top: { kind: 'track', track: tracks[0].item }, score: tracks[0].score, text: tracks[0].text });
  if (albums[0]) {
    // Un álbum solo encabeza si su título es justo lo buscado.
    const albumTitleMatch = textMatch(query, albums[0].item.title);
    candidates.push({ top: { kind: 'album', album: albums[0].item }, score: albums[0].score - (albumTitleMatch >= 0.97 ? 0.02 : 0.12), text: albums[0].text });
  }

  let top = candidates.sort((left, right) => right.score - left.score)[0]?.top ?? null;
  if (hint) {
    const hintText = hint.kind === 'artist'
      ? textMatch(query, hint.artist.name)
      : hint.kind === 'track'
        ? Math.max(textMatch(query, hint.track.title), textMatch(query, `${hint.track.title} ${hint.track.artist}`), textMatch(query, `${hint.track.artist} ${hint.track.title}`))
        : Math.max(textMatch(query, hint.album.title), textMatch(query, `${hint.album.title} ${albumArtist(hint.album)}`));
    const best = candidates[0];
    if (hintText >= 0.6 || !best || hintText >= best.text - 0.05) top = hint;
  }

  // El artista elegido como mejor resultado encabeza también su lista: buscar
  // "sabrina" no debe poner a tres homónimos desconocidos por delante.
  const rankedArtists = artists.map(entry => entry.item);
  if (top?.kind === 'artist') {
    const topArtist = top.artist;
    const index = rankedArtists.findIndex(artist => artist.id === topArtist.id);
    if (index > 0) rankedArtists.unshift(...rankedArtists.splice(index, 1));
    else if (index < 0) rankedArtists.unshift(topArtist);
  }

  return {
    tracks: tracks.map(entry => entry.item),
    albums: albums.map(entry => entry.item),
    artists: rankedArtists,
    top,
  };
}
