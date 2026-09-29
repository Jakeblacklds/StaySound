/** Catalog reads: search, artist/album/playlist detail and similar items. */
import { TidalAlbum, TidalAlbumDetail, TidalArtist, TidalArtistDetail, TidalCatalogSearch, TidalPlaylist, TidalPlaylistDetail, TidalSearchResult, TidalTrack } from "../../types/audio";
import { dedupeAlbumVariants, rankCatalogSearch } from "../catalogRanking";
import type { TidalAlbumApiResponse, TidalAlbumDetailApiResponse, TidalAlbumSearchApiResponse, TidalArtistApiResponse, TidalArtistDetailApiResponse, TidalArtistSearchApiResponse, TidalPlaylistApiResponse, TidalPlaylistSearchApiResponse, TidalSearchApiResponse, TidalSimilarAlbumsApiResponse, TidalSimilarArtistsApiResponse, TidalTrackApiResponse } from "../../features/tidal/data/tidalApiTypes";
import { getTidalCacheScope, withTidalCache } from "./cache";
import { DETAIL_CACHE_TTL_MS, SEARCH_CACHE_TTL_MS } from "./constants";
import { fetchJson, searchTidalCatalog, tidalCatalogGet } from "./http";
import { byReleaseDesc, extractAlbumsFromTracks, getArtworkUrl, normalizeAlbumItem, normalizeArtistItem, normalizeArtistMatchName, normalizeArtistTrack, normalizePlaylistItem, normalizeSearchItem, normalizeTopHit, uniqueById } from "./normalize";
import { TidalPagedApiResponse, TidalUnifiedSearchApiResponse } from "./types";

async function getSearchBackedArtistDetail(
  artistId: number,
  artistNameHint?: string,
): Promise<TidalArtistDetail | null> {
  const queryTerm = artistNameHint?.trim();
  if (!queryTerm) return null;

  const [artistsResult, tracksResult, albumsResult] = await Promise.allSettled([
    searchTidalArtists(queryTerm),
    searchTidal(queryTerm),
    searchTidalAlbums(queryTerm),
  ]);

  const artistMatches =
    artistsResult.status === "fulfilled" ? artistsResult.value : [];
  const tracksByName =
    tracksResult.status === "fulfilled" ? tracksResult.value : [];
  const albumsByName =
    albumsResult.status === "fulfilled" ? albumsResult.value : [];

  const normalizedHint = normalizeArtistMatchName(queryTerm);
  const matchedArtist =
    artistMatches.find((artist) => artist.id === artistId) ??
    artistMatches.find(
      (artist) => normalizeArtistMatchName(artist.name) === normalizedHint,
    ) ??
    artistMatches[0];

  const artist: TidalArtist = matchedArtist
    ? { ...matchedArtist, id: matchedArtist.id || artistId }
    : { id: artistId, name: queryTerm };

  const artistNames = new Set(
    [queryTerm, artist.name]
      .map(normalizeArtistMatchName)
      .filter(Boolean),
  );

  const mergedTracksMap = new Map<number, TidalTrack>();
  tracksByName
    .filter(
      (track) =>
        track.artistId === artistId ||
        track.artistId === artist.id ||
        artistNames.has(normalizeArtistMatchName(track.artist)),
    )
    .forEach((track) => mergedTracksMap.set(track.id, track));

  const mergedTracks = Array.from(mergedTracksMap.values()).sort(
    (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0),
  );

  const albumsMap = new Map<number, TidalAlbum>();
  albumsByName
    .filter(
      (album) =>
        album.artistId === artistId ||
        album.artistId === artist.id ||
        artistNames.has(normalizeArtistMatchName(album.artistName)),
    )
    .forEach((album) => albumsMap.set(album.id, album));

  extractAlbumsFromTracks(mergedTracks).forEach((album) => {
    if (!albumsMap.has(album.id)) albumsMap.set(album.id, album);
  });

  const albums = Array.from(albumsMap.values()).sort((a, b) => {
    const aDate = a.releaseDate ? Date.parse(a.releaseDate) : 0;
    const bDate = b.releaseDate ? Date.parse(b.releaseDate) : 0;
    return bDate - aDate || (b.year ?? 0) - (a.year ?? 0);
  });

  return {
    artist,
    topTracks: mergedTracks.slice(0, 25),
    albums,
  };
}

export async function searchTidal(query: string): Promise<TidalSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `tracks:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    let response: TidalSearchApiResponse;
    try {
      const catalog = await searchTidalCatalog<TidalTrackApiResponse>("tracks", trimmed);
      response = { data: { items: catalog.items ?? [] } };
    } catch {
      response = await fetchJson<TidalSearchApiResponse>(`/search/?s=${encodeURIComponent(trimmed)}`);
    }

    return (response.data?.items ?? []).map(normalizeSearchItem);
  });
}

export async function searchTidalArtists(
  query: string,
): Promise<TidalArtist[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `artists:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    let response: TidalArtistSearchApiResponse;
    try {
      const catalog = await searchTidalCatalog<TidalArtistApiResponse>("artists", trimmed);
      response = { data: { artists: { items: catalog.items ?? [] } } };
    } catch {
      response = await fetchJson<TidalArtistSearchApiResponse>(`/search/?a=${encodeURIComponent(trimmed)}`);
    }

    const artistItems =
      response.data?.artists?.items ?? response.data?.items ?? [];
    return artistItems.map(normalizeArtistItem);
  });
}

export async function searchTidalPlaylists(
  query: string,
): Promise<TidalPlaylist[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `playlists:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    let response: TidalPlaylistSearchApiResponse;
    try {
      const catalog = await searchTidalCatalog<TidalPlaylistApiResponse>("playlists", trimmed);
      response = { data: { playlists: { items: catalog.items ?? [] } } };
    } catch {
      response = await fetchJson<TidalPlaylistSearchApiResponse>(`/search/?p=${encodeURIComponent(trimmed)}`);
    }

    const playlistItems =
      response.data?.playlists?.items ?? response.data?.items ?? [];
    return playlistItems.map(normalizePlaylistItem);
  });
}

export async function searchTidalAlbums(query: string): Promise<TidalAlbum[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `albums:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    let response: TidalAlbumSearchApiResponse;
    try {
      const catalog = await searchTidalCatalog<TidalAlbumApiResponse>("albums", trimmed);
      response = { data: { albums: { items: catalog.items ?? [] } } };
    } catch {
      response = await fetchJson<TidalAlbumSearchApiResponse>(`/search/?al=${encodeURIComponent(trimmed)}`);
    }

    const albumItems =
      response.data?.albums?.items ?? response.data?.items ?? [];
    return albumItems.map(normalizeAlbumItem);
  });
}

/**
 * Búsqueda estilo Spotify: canciones, artistas y álbumes en una sola petición,
 * ordenados por relevancia (catalogRanking.ts, el mismo ranking de escritorio)
 * y con un "mejor resultado" que puede ser de cualquiera de los tres tipos.
 * Si la API oficial falla se cae a los mirrors, con el mismo ranking.
 */
export async function searchTidalCatalogAll(query: string): Promise<TidalCatalogSearch> {
  const trimmed = query.trim();
  if (!trimmed) return { tracks: [], albums: [], artists: [], top: null };
  const cacheKey = `all:${getTidalCacheScope()}:${trimmed.toLowerCase()}`;
  return withTidalCache(cacheKey, SEARCH_CACHE_TTL_MS, async () => {
    let ranked: TidalCatalogSearch;
    try {
      const payload = await tidalCatalogGet<TidalUnifiedSearchApiResponse>("search", {
        query: trimmed, types: "ARTISTS,ALBUMS,TRACKS", limit: 30,
      });
      ranked = rankCatalogSearch(trimmed, {
        tracks: uniqueById((payload.tracks?.items ?? []).map(normalizeSearchItem)),
        albums: (payload.albums?.items ?? []).map(normalizeAlbumItem),
        artists: (payload.artists?.items ?? []).map(normalizeArtistItem),
      }, normalizeTopHit(payload.topHit));
    } catch {
      const [tracks, albums, artists] = await Promise.allSettled([
        searchTidal(trimmed), searchTidalAlbums(trimmed), searchTidalArtists(trimmed),
      ]);
      if (tracks.status === "rejected" && albums.status === "rejected" && artists.status === "rejected") {
        throw tracks.reason instanceof Error ? tracks.reason : new Error("No se pudo consultar el catálogo.");
      }
      const trackList = tracks.status === "fulfilled" ? tracks.value : [];
      ranked = rankCatalogSearch(trimmed, {
        tracks: trackList,
        albums: albums.status === "fulfilled" ? albums.value : extractAlbumsFromTracks(trackList),
        artists: artists.status === "fulfilled" ? artists.value : [],
      });
    }

    // Si lo buscado es un artista, "Canciones" debe ser lo suyo más escuchado
    // y no las colaboraciones donde solo aparece.
    const top = ranked.top;
    if (top?.kind === "artist") {
      const own = ranked.tracks.slice(0, 4).filter(track => track.artistId === top.artist.id).length;
      if (own < 4) {
        const topTracks = await tidalCatalogGet<TidalPagedApiResponse<TidalTrackApiResponse>>(
          `artists/${top.artist.id}/toptracks`, { limit: 6 },
        ).then(result => (result.items ?? []).map(normalizeSearchItem)).catch(() => [] as TidalTrack[]);
        const ids = new Set(topTracks.map(track => track.id));
        ranked = { ...ranked, tracks: [...topTracks, ...ranked.tracks.filter(track => !ids.has(track.id))] };
      }
    }
    return ranked;
  });
}

async function getCatalogArtistDetail(artistId: number): Promise<TidalArtistDetail> {
  const [artistResult, topResult, albumResult, singleResult] = await Promise.allSettled([
    tidalCatalogGet<TidalArtistApiResponse>(`artists/${artistId}`),
    tidalCatalogGet<TidalPagedApiResponse<TidalTrackApiResponse>>(`artists/${artistId}/toptracks`, { limit: 25 }),
    tidalCatalogGet<TidalPagedApiResponse<TidalAlbumApiResponse>>(`artists/${artistId}/albums`, { limit: 50 }),
    tidalCatalogGet<TidalPagedApiResponse<TidalAlbumApiResponse>>(`artists/${artistId}/albums`, { filter: "EPSANDSINGLES", limit: 50 }),
  ]);
  if (artistResult.status === "rejected" || !artistResult.value?.name) {
    throw artistResult.status === "rejected" ? artistResult.reason : new Error("Artista no encontrado");
  }
  const artist = normalizeArtistItem(artistResult.value);
  const items = <T,>(result: PromiseSettledResult<TidalPagedApiResponse<T>>): T[] =>
    result.status === "fulfilled" ? result.value.items ?? [] : [];
  const releases = dedupeAlbumVariants([...items(albumResult), ...items(singleResult)].map(normalizeAlbumItem))
    .sort(byReleaseDesc);
  return {
    artist,
    topTracks: uniqueById(items(topResult).map(item => normalizeArtistTrack(item, artist))),
    albums: releases.filter(album => album.type !== "SINGLE" && album.type !== "EP"),
    singles: releases.filter(album => album.type === "SINGLE" || album.type === "EP"),
  };
}

async function getCatalogAlbumDetail(albumId: number): Promise<TidalAlbumDetail> {
  const [albumPayload, itemsPayload] = await Promise.all([
    tidalCatalogGet<TidalAlbumApiResponse>(`albums/${albumId}`),
    tidalCatalogGet<TidalPagedApiResponse<{ item?: TidalTrackApiResponse; type?: string }>>(`albums/${albumId}/items`, { limit: 100 }),
  ]);
  const album = normalizeAlbumItem(albumPayload);
  const fallbackArtist = album.artistId ? { id: album.artistId, name: album.artistName } : undefined;
  const entries = (itemsPayload.items ?? [])
    // Los álbumes pueden traer videoclips intercalados.
    .filter(entry => !entry.type || entry.type === "track")
    .map(entry => entry.item)
    .filter((item): item is TidalTrackApiResponse => !!item)
    .sort((a, b) => ((a.volumeNumber ?? 1) - (b.volumeNumber ?? 1)) || ((a.trackNumber ?? 9999) - (b.trackNumber ?? 9999)));
  const tracks = entries.map(item => {
    const track = normalizeArtistTrack(item, fallbackArtist);
    // El endpoint de álbum no siempre repite portada ni álbum en cada pista.
    return {
      ...track,
      album: track.album && track.album !== "Unknown Album" ? track.album : album.title,
      albumId: track.albumId ?? album.id,
      artworkUrl: track.artworkUrl ?? album.artworkUrl,
      coverUuid: track.coverUuid ?? albumPayload.cover ?? null,
    };
  });
  return { album: { ...album, numberOfTracks: album.numberOfTracks ?? tracks.length }, tracks };
}

export async function getTidalAlbumDetail(
  albumId: number,
): Promise<TidalAlbumDetail> {
  const cacheKey = `album-detail:${getTidalCacheScope()}:${albumId}`;
  return withTidalCache(cacheKey, DETAIL_CACHE_TTL_MS, async () => {
    try {
      return await getCatalogAlbumDetail(albumId);
    } catch (error) {
      console.warn(`[TidalService] Catalog album ${albumId} failed; trying mirrors.`, error);
    }
    const response = await fetchJson<TidalAlbumDetailApiResponse>(
      `/album/?id=${albumId}`,
    );

    const albumData = response.data;
    if (!albumData) {
      throw new Error("No se pudo cargar el album de Tidal");
    }

    const album = normalizeAlbumItem(albumData);
    const tracks = (albumData.items ?? [])
      .map((entry) => entry.item)
      .filter((item): item is TidalTrackApiResponse => !!item)
      .map((item) =>
        normalizeArtistTrack(
          item,
          album.artistId
            ? { id: album.artistId, name: album.artistName }
            : undefined,
        ),
      );

    return { album, tracks };
  });
}

export async function getTidalPlaylistDetail(
  playlistUuid: string,
): Promise<TidalPlaylistDetail> {
  const response = await fetchJson<any>(`/playlist/?id=${playlistUuid}`);

  // Try multiple possible paths for the playlist metadata
  const playlistData =
    response.data || response.playlist || (response.uuid ? response : null);

  if (!playlistData) {
    console.error(
      "Tidal Playlist Error: No playlist data in response",
      response,
    );
    throw new Error("No se pudo cargar la playlist de Tidal");
  }

  // Ensure the playlistData has the best image possible
  if (
    !playlistData.image &&
    !playlistData.cover &&
    !playlistData.picture &&
    !playlistData.squareImage
  ) {
    playlistData.image =
      response.image ||
      response.cover ||
      response.picture ||
      response.squareImage;
  }

  // Convert tracks first so we can use their artwork as fallback
  const items =
    response.data?.items ?? response.items ?? playlistData.items ?? [];
  const tracks = items
    .map((entry: any) => entry.item || entry)
    .filter((item: any): item is TidalTrackApiResponse => !!item && !!item.id)
    .map((item: any) => normalizeArtistTrack(item));

  const playlist = normalizePlaylistItem(playlistData);

  // CRITICAL: If playlist still has no artwork, use the artwork from the first track
  if (!playlist.artworkUrl && tracks.length > 0 && tracks[0].artworkUrl) {
    playlist.artworkUrl = tracks[0].artworkUrl;
  }

  return { playlist, tracks };
}

export async function getTidalArtistInfo(
  artistId: number,
  artistNameHint?: string,
): Promise<TidalArtist> {
  const hintKey = artistNameHint?.trim().toLowerCase() || "none";
  const cacheKey = `artist-info:${getTidalCacheScope()}:${artistId}:${hintKey}`;
  return withTidalCache(cacheKey, DETAIL_CACHE_TTL_MS, async () => {
    try {
      const catalogArtist = await tidalCatalogGet<TidalArtistApiResponse>(`artists/${artistId}`);
      if (catalogArtist?.name) return normalizeArtistItem(catalogArtist);
    } catch {
      // Los mirrors siguen como respaldo.
    }
    try {
      const response = await fetchJson<TidalArtistDetailApiResponse>(
        `/artist/?id=${artistId}`,
      );

      const apiArtist = response.artist;
      if (!apiArtist) {
        throw new Error("Artista no encontrado");
      }

      const coverVariants = response.cover as
        | Record<string, string | undefined>
        | undefined;
      const artworkCandidate =
        coverVariants?.["750"] ||
        coverVariants?.["640"] ||
        coverVariants?.["480"];
      return {
        ...normalizeArtistItem(apiArtist),
        artworkUrl:
          (typeof artworkCandidate === "string" && artworkCandidate.startsWith("http")) 
            ? artworkCandidate 
            : getArtworkUrl(artworkCandidate || apiArtist.picture),
      };
    } catch (error) {
      const fallbackDetail = await getSearchBackedArtistDetail(
        artistId,
        artistNameHint,
      );
      if (fallbackDetail) {
        console.warn(
          `[TidalService] Artist info endpoint failed for ${artistId}; using search-backed artist.`,
          error,
        );
        return fallbackDetail.artist;
      }
      throw error;
    }
  });
}

export async function getTidalArtistDetail(
  artistId: number,
  artistNameHint?: string,
): Promise<TidalArtistDetail> {
  const hintKey = artistNameHint?.trim().toLowerCase() || "none";
  const cacheKey = `artist-detail:${getTidalCacheScope()}:${artistId}:${hintKey}`;
  return withTidalCache(cacheKey, DETAIL_CACHE_TTL_MS, async () => {
    try {
      // Top tracks y discografía reales (álbumes y sencillos por separado); la
      // reconstrucción por nombre de abajo queda como respaldo.
      return await getCatalogArtistDetail(artistId);
    } catch (error) {
      console.warn(`[TidalService] Catalog artist ${artistId} failed; trying mirrors.`, error);
    }
    try {
      const artistResponse = await fetchJson<TidalArtistDetailApiResponse>(
        `/artist/?id=${artistId}`,
      );

      const apiArtist = artistResponse.artist;
      if (!apiArtist) {
        throw new Error("No se pudo cargar el artista de Tidal");
      }

      const artist: TidalArtist = {
        ...normalizeArtistItem(apiArtist),
        artworkUrl:
          artistResponse.cover?.["750"] ??
          getArtworkUrl(apiArtist.picture ?? undefined),
      };

      const queryTerm = artistNameHint?.trim() || artist.name;
      const [tracksByName, albumsByName] = await Promise.all([
        searchTidal(queryTerm),
        searchTidalAlbums(queryTerm),
      ]);

      const mergedTracksMap = new Map<number, TidalTrack>();
      tracksByName
        .filter(
          (track) =>
            track.artistId === artistId ||
            track.artist.toLowerCase() === artist.name.toLowerCase(),
        )
        .forEach((track) => mergedTracksMap.set(track.id, track));

      const mergedTracks = Array.from(mergedTracksMap.values());
      mergedTracks.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

      const albumsMap = new Map<number, TidalAlbum>();
      albumsByName
        .filter(
          (album) =>
            album.artistId === artistId ||
            album.artistName.toLowerCase() === artist.name.toLowerCase(),
        )
        .forEach((album) => albumsMap.set(album.id, album));

      extractAlbumsFromTracks(mergedTracks).forEach((album) => {
        if (!albumsMap.has(album.id)) albumsMap.set(album.id, album);
      });

      const albums = Array.from(albumsMap.values()).sort((a, b) => {
        const aDate = a.releaseDate ? Date.parse(a.releaseDate) : 0;
        const bDate = b.releaseDate ? Date.parse(b.releaseDate) : 0;
        return bDate - aDate || (b.year ?? 0) - (a.year ?? 0);
      });
      const topTracks = mergedTracks.slice(0, 25);

      return { artist, topTracks, albums };
    } catch (error) {
      const fallbackDetail = await getSearchBackedArtistDetail(
        artistId,
        artistNameHint,
      );
      if (fallbackDetail) {
        console.warn(
          `[TidalService] Artist detail endpoint failed for ${artistId}; using search-backed detail.`,
          error,
        );
        return fallbackDetail;
      }
      throw error;
    }
  });
}

export async function getTidalSimilarArtists(
  artistId: number,
): Promise<TidalArtist[]> {
  try {
    const catalog = await tidalCatalogGet<TidalPagedApiResponse<TidalArtistApiResponse>>(
      `artists/${artistId}/similar`, { limit: 12 },
    );
    const similar = (catalog.items ?? []).filter(item => item.id !== artistId).map(normalizeArtistItem);
    if (similar.length) return similar;
  } catch {
    // Los mirrors siguen como respaldo.
  }
  try {
    const response = await fetchJson<TidalSimilarArtistsApiResponse>(
      `/artist/similar/?id=${artistId}`,
    );
    const items =
      response.artists || response.data?.artists || response.items || [];
    // Use normalizeArtistItem to ensure consistent artwork URL generation
    return items.map(normalizeArtistItem);
  } catch (error) {
    console.warn(
      `[TidalService] Failed to fetch similar artists for ${artistId}:`,
      error,
    );
    return [];
  }
}

export async function getTidalSimilarAlbums(
  albumId: number,
): Promise<TidalAlbum[]> {
  // "Más de este artista": el resto de su discografía desde la API de catálogo
  // (el endpoint de álbumes similares solo existe en los mirrors).
  try {
    const album = await tidalCatalogGet<TidalAlbumApiResponse>(`albums/${albumId}`);
    const artistId = album.artist?.id ?? album.artists?.[0]?.id;
    if (artistId) {
      const own = normalizeAlbumItem(album);
      const [albums, singles] = await Promise.allSettled([
        tidalCatalogGet<TidalPagedApiResponse<TidalAlbumApiResponse>>(`artists/${artistId}/albums`, { limit: 50 }),
        tidalCatalogGet<TidalPagedApiResponse<TidalAlbumApiResponse>>(`artists/${artistId}/albums`, { filter: "EPSANDSINGLES", limit: 20 }),
      ]);
      const releases = [albums, singles]
        .flatMap(result => (result.status === "fulfilled" ? result.value.items ?? [] : []))
        .map(normalizeAlbumItem);
      const others = dedupeAlbumVariants([own, ...releases])
        .filter(candidate => candidate.id !== albumId && candidate.title !== own.title);
      if (others.length) return others;
    }
  } catch {
    // Los mirrors siguen como respaldo.
  }
  try {
    const response = await fetchJson<TidalSimilarAlbumsApiResponse>(
      `/album/similar/?id=${albumId}`,
    );
    const items =
      response.albums || response.data?.albums || response.items || [];
    // Use normalizeAlbumItem to ensure consistent artwork URL generation
    return items.map(normalizeAlbumItem);
  } catch (error) {
    console.warn(
      `[TidalService] Failed to fetch similar albums for ${albumId}:`,
      error,
    );
    return [];
  }
}
