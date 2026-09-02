import type { TidalTrack } from '@staysound/types/audio';
import {
  fetchFromTidalMirrors,
  getTidalArtworkUrl,
  normalizeTidalTrack,
  type TidalTrackApiResponse,
} from '../library/tidalDiscovery';

/**
 * Catálogo navegable de Descargas.
 *
 * El panel de descargas solo sabía buscar canciones sueltas: los álbumes y
 * artistas que mostraba eran agrupaciones derivadas de esos resultados, sin
 * identidad propia ni forma de abrirlos. Este módulo habla con los mismos
 * mirrors de Monochrome que usa el resto de la app (`tidalDiscovery`) para
 * devolver entidades reales — con id — que sí se pueden abrir:
 *
 *   /search/?s=   canciones      /search/?al=  álbumes     /search/?a=  artistas
 *   /album/?id=   álbum + tracks /artist/?id=  ficha del artista
 *
 * El endpoint de artista no devuelve discografía, así que se reconstruye por
 * nombre (búsqueda de álbumes + los álbumes implícitos en sus canciones), igual
 * que hace la app nativa en src/services/tidalService.ts.
 */

export type CatalogAlbum = {
  id: number;
  title: string;
  artist: string;
  artistId?: number;
  artworkUrl?: string;
  releaseDate?: string;
  year?: number;
  trackCount?: number;
  explicit?: boolean;
};

export type CatalogArtist = {
  id: number;
  name: string;
  artworkUrl?: string;
};

export type CatalogSearch = {
  tracks: TidalTrack[];
  albums: CatalogAlbum[];
  artists: CatalogArtist[];
};

export type CatalogAlbumDetail = {
  album: CatalogAlbum;
  tracks: TidalTrack[];
};

export type CatalogArtistDetail = {
  artist: CatalogArtist;
  topTracks: TidalTrack[];
  albums: CatalogAlbum[];
};

type AlbumApiResponse = {
  id?: number;
  title?: string;
  cover?: string | null;
  releaseDate?: string;
  numberOfTracks?: number;
  explicit?: boolean;
  artist?: { id?: number; name?: string };
  artists?: Array<{ id?: number; name?: string }>;
  items?: Array<{ item?: TidalTrackApiResponse } | TidalTrackApiResponse>;
};

type ArtistApiResponse = {
  id?: number;
  name?: string;
  picture?: string | null;
};

type AlbumSearchApiResponse = {
  data?: { albums?: { items?: AlbumApiResponse[] }; items?: AlbumApiResponse[] };
  items?: AlbumApiResponse[];
};

type ArtistSearchApiResponse = {
  data?: { artists?: { items?: ArtistApiResponse[] }; items?: ArtistApiResponse[] };
  items?: ArtistApiResponse[];
};

type TrackSearchApiResponse = {
  data?: { items?: TidalTrackApiResponse[]; tracks?: { items?: TidalTrackApiResponse[] } };
  items?: TidalTrackApiResponse[];
};

type AlbumDetailApiResponse = { data?: AlbumApiResponse } & AlbumApiResponse;
type ArtistDetailApiResponse = {
  artist?: ArtistApiResponse;
  cover?: Record<string, string | undefined>;
  data?: ArtistApiResponse;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 60;

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** Memoiza por sesión: navegar atrás y adelante no debe volver a pegarle a la red. */
function withCatalogCache<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as Promise<T>;

  const value = loader().catch(error => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { at: Date.now(), value });
  if (cache.size > CACHE_LIMIT) {
    const oldest = [...cache.entries()].sort((left, right) => left[1].at - right[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return value;
}

function normalizeAlbum(item: AlbumApiResponse): CatalogAlbum | null {
  if (!item?.id || !item.title) return null;
  return {
    id: item.id,
    title: item.title,
    artist: item.artist?.name ?? item.artists?.[0]?.name ?? 'Artista desconocido',
    artistId: item.artist?.id ?? item.artists?.[0]?.id,
    artworkUrl: getTidalArtworkUrl(item.cover ?? undefined),
    releaseDate: item.releaseDate,
    year: item.releaseDate ? new Date(item.releaseDate).getFullYear() || undefined : undefined,
    trackCount: item.numberOfTracks,
    explicit: item.explicit,
  };
}

function normalizeArtist(item: ArtistApiResponse): CatalogArtist | null {
  if (!item?.id || !item.name) return null;
  return {
    id: item.id,
    name: item.name,
    artworkUrl: getTidalArtworkUrl(item.picture ?? undefined),
  };
}

function unwrapAlbumTrack(entry: { item?: TidalTrackApiResponse } | TidalTrackApiResponse): TidalTrackApiResponse {
  return entry && 'item' in entry && entry.item ? entry.item : (entry as TidalTrackApiResponse);
}

function comparableName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function dedupeTracks(tracks: TidalTrack[]): TidalTrack[] {
  const seen = new Set<number>();
  return tracks.filter(track => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

function dedupeAlbums(albums: CatalogAlbum[]): CatalogAlbum[] {
  const byId = new Map<number, CatalogAlbum>();
  for (const album of albums) {
    const current = byId.get(album.id);
    // Los álbumes derivados de canciones no traen año ni número de pistas; si
    // después llega la versión completa del endpoint de álbumes, gana esa.
    if (!current) byId.set(album.id, album);
    else byId.set(album.id, { ...album, ...current, year: current.year ?? album.year, trackCount: current.trackCount ?? album.trackCount });
  }
  return [...byId.values()];
}

/** Álbumes implícitos en un set de canciones, para cuando /search/?al= no responde. */
export function albumsFromTracks(tracks: TidalTrack[]): CatalogAlbum[] {
  const albums = new Map<number, CatalogAlbum>();
  for (const track of tracks) {
    if (!track.albumId || albums.has(track.albumId)) continue;
    albums.set(track.albumId, {
      id: track.albumId,
      title: track.album,
      artist: track.artist,
      artistId: track.artistId,
      artworkUrl: track.artworkUrl,
    });
  }
  return [...albums.values()];
}

/** Artistas implícitos en un set de canciones (mismo motivo que albumsFromTracks). */
export function artistsFromTracks(tracks: TidalTrack[]): CatalogArtist[] {
  const artists = new Map<number, CatalogArtist>();
  for (const track of tracks) {
    if (!track.artistId || artists.has(track.artistId)) continue;
    artists.set(track.artistId, { id: track.artistId, name: track.artist });
  }
  return [...artists.values()];
}

async function searchCatalogTracks(query: string): Promise<TidalTrack[]> {
  const payload = await fetchFromTidalMirrors<TrackSearchApiResponse>(`/search/?s=${encodeURIComponent(query)}`);
  const items = payload.data?.items ?? payload.data?.tracks?.items ?? payload.items ?? [];
  return dedupeTracks(items.map(normalizeTidalTrack).filter((track): track is TidalTrack => Boolean(track)));
}

async function searchCatalogAlbums(query: string): Promise<CatalogAlbum[]> {
  const payload = await fetchFromTidalMirrors<AlbumSearchApiResponse>(`/search/?al=${encodeURIComponent(query)}`);
  const items = payload.data?.albums?.items ?? payload.data?.items ?? payload.items ?? [];
  return dedupeAlbums(items.map(normalizeAlbum).filter((album): album is CatalogAlbum => Boolean(album)));
}

async function searchCatalogArtists(query: string): Promise<CatalogArtist[]> {
  const payload = await fetchFromTidalMirrors<ArtistSearchApiResponse>(`/search/?a=${encodeURIComponent(query)}`);
  const items = payload.data?.artists?.items ?? payload.data?.items ?? payload.items ?? [];
  const artists = items.map(normalizeArtist).filter((artist): artist is CatalogArtist => Boolean(artist));
  const byId = new Map(artists.map(artist => [artist.id, artist] as const));
  return [...byId.values()];
}

/**
 * Una sola búsqueda alimenta las tres pestañas del catálogo. Cada endpoint va
 * por separado (allSettled) porque los mirrors no siempre implementan los tres:
 * si el de álbumes o artistas falla, se reconstruye desde las canciones en vez
 * de dejar la pestaña vacía.
 */
export async function searchCatalog(query: string): Promise<CatalogSearch> {
  const trimmed = query.trim();
  if (!trimmed) return { tracks: [], albums: [], artists: [] };

  return withCatalogCache(`search:${trimmed.toLowerCase()}`, async () => {
    const [trackResult, albumResult, artistResult] = await Promise.allSettled([
      searchCatalogTracks(trimmed),
      searchCatalogAlbums(trimmed),
      searchCatalogArtists(trimmed),
    ]);

    if (trackResult.status === 'rejected' && albumResult.status === 'rejected' && artistResult.status === 'rejected') {
      throw trackResult.reason instanceof Error
        ? trackResult.reason
        : new Error('No se pudo consultar el catálogo de Monochrome.');
    }

    const tracks = trackResult.status === 'fulfilled' ? trackResult.value : [];
    const searchedAlbums = albumResult.status === 'fulfilled' ? albumResult.value : [];
    const searchedArtists = artistResult.status === 'fulfilled' ? artistResult.value : [];

    return {
      tracks,
      albums: dedupeAlbums([...searchedAlbums, ...albumsFromTracks(tracks)]),
      artists: searchedArtists.length > 0
        ? searchedArtists
        : artistsFromTracks(tracks),
    };
  });
}

/** Álbum completo con su tracklist en orden de disco. */
export async function getCatalogAlbum(albumId: number): Promise<CatalogAlbumDetail> {
  return withCatalogCache(`album:${albumId}`, async () => {
    const payload = await fetchFromTidalMirrors<AlbumDetailApiResponse>(`/album/?id=${albumId}`);
    const data = payload.data ?? payload;
    const album = normalizeAlbum(data);
    if (!album) throw new Error('Monochrome no devolvió información de este álbum.');

    const tracks = (data.items ?? [])
      .map(unwrapAlbumTrack)
      .map(normalizeTidalTrack)
      .filter((track): track is TidalTrack => Boolean(track))
      // El endpoint de álbum no siempre repite el artista ni la portada dentro
      // de cada canción, y Soulseek busca justamente por "artista - título"
      // (además de que la portada se guarda junto al archivo descargado).
      .map(track => ({
        ...track,
        artist: track.artist && track.artist !== 'Unknown Artist' ? track.artist : album.artist,
        album: track.album && track.album !== 'Unknown Album' ? track.album : album.title,
        albumId: track.albumId ?? album.id,
        artistId: track.artistId ?? album.artistId,
        artworkUrl: track.artworkUrl ?? album.artworkUrl,
      }))
      .sort((left, right) => (left.trackNumber ?? 9999) - (right.trackNumber ?? 9999));

    return {
      album: { ...album, trackCount: album.trackCount ?? tracks.length },
      tracks,
    };
  });
}

/**
 * Ficha del artista: nombre + foto del endpoint dedicado, y discografía y
 * canciones populares reconstruidas por nombre (el endpoint no las expone).
 */
export async function getCatalogArtist(artistId: number, nameHint?: string): Promise<CatalogArtistDetail> {
  return withCatalogCache(`artist:${artistId}:${nameHint?.toLowerCase() ?? ''}`, async () => {
    const detail = await fetchFromTidalMirrors<ArtistDetailApiResponse>(`/artist/?id=${artistId}`)
      .catch(() => null);

    const apiArtist = detail?.artist ?? detail?.data;
    const coverVariants = detail?.cover;
    const remoteCover = coverVariants?.['750'] ?? coverVariants?.['640'] ?? coverVariants?.['480'];
    const artist: CatalogArtist = {
      id: apiArtist?.id ?? artistId,
      name: apiArtist?.name ?? nameHint ?? 'Artista',
      artworkUrl: remoteCover?.startsWith('http')
        ? remoteCover
        : getTidalArtworkUrl(remoteCover ?? apiArtist?.picture ?? undefined),
    };

    const queryTerm = (nameHint?.trim() || artist.name).trim();
    if (!queryTerm) return { artist, topTracks: [], albums: [] };

    const [trackResult, albumResult] = await Promise.allSettled([
      searchCatalogTracks(queryTerm),
      searchCatalogAlbums(queryTerm),
    ]);
    const comparableArtist = comparableName(artist.name);
    const belongsToArtist = (candidateId: number | undefined, candidateName: string) => (
      candidateId === artistId || comparableName(candidateName) === comparableArtist
    );

    const topTracks = (trackResult.status === 'fulfilled' ? trackResult.value : [])
      .filter(track => belongsToArtist(track.artistId, track.artist))
      .sort((left, right) => (right.popularity ?? 0) - (left.popularity ?? 0))
      .slice(0, 25);

    const searchedAlbums = (albumResult.status === 'fulfilled' ? albumResult.value : [])
      .filter(album => belongsToArtist(album.artistId, album.artist));

    const albums = dedupeAlbums([...searchedAlbums, ...albumsFromTracks(topTracks)])
      .sort((left, right) => {
        const leftDate = left.releaseDate ? Date.parse(left.releaseDate) : 0;
        const rightDate = right.releaseDate ? Date.parse(right.releaseDate) : 0;
        return (rightDate - leftDate) || ((right.year ?? 0) - (left.year ?? 0));
      });

    // Sin nombre útil no hay forma de reconstruir nada: mejor avisar que
    // pintar una ficha vacía que parece un error de la app.
    if (!apiArtist && topTracks.length === 0 && albums.length === 0) {
      throw new Error('No pude cargar la información de este artista en Monochrome.');
    }

    return { artist, topTracks, albums };
  });
}
