/** Pure normalizers from TIDAL API payloads to the app models. */
import { TidalAlbum, TidalArtist, TidalCatalogSearch, TidalPlaylist, TidalSearchResult, TidalTrack } from "../../types/audio";
import type { TidalAlbumApiResponse, TidalArtistApiResponse, TidalPlaylistApiResponse, TidalTrackApiResponse } from "../../features/tidal/data/tidalApiTypes";
import { TIDAL_ARTWORK_BASE } from "./constants";
import { TidalUnifiedSearchApiResponse } from "./types";

export function withVersion(title: string, version?: string | null): string {
  const trimmed = version?.trim();
  if (!title || !trimmed || title.toLowerCase().includes(trimmed.toLowerCase())) return title;
  return `${title} (${trimmed})`;
}

export function normalizeSearchItem(item: TidalTrackApiResponse): TidalSearchResult {
  const quality = item.audioQuality ?? "LOSSLESS";
  const tags = item.mediaMetadata?.tags ?? [];
  const isHiRes =
    tags.includes("HIRES_LOSSLESS") || quality === "HI_RES_LOSSLESS";
  const primaryArtist =
    item.artist?.name ?? item.artists?.[0]?.name ?? "Unknown Artist";
  const albumTitle = item.album?.title ?? "Unknown Album";
  const coverUuid = item.album?.cover ?? null;

  return {
    id: item.id,
    // "DtMF" y "DtMF (Live)" son canciones distintas, y Soulseek busca por título.
    title: withVersion(item.title, item.version),
    artist: primaryArtist,
    album: albumTitle,
    durationMs: Math.max(0, Math.round((item.duration ?? 0) * 1000)),
    quality,
    isHiRes,
    coverUuid,
    artworkUrl: getArtworkUrl(coverUuid),
    trackNumber: item.trackNumber,
    isrc: item.isrc,
    explicit: item.explicit,
    popularity: item.popularity,
    artistId: item.artist?.id,
    albumId: item.album?.id,
  };
}

export function normalizeArtistItem(item: TidalArtistApiResponse): TidalArtist {
  const picture = item.picture || undefined;
  const artworkUrl = getArtworkUrl(picture);

  return {
    id: item.id,
    name: item.name,
    picture: typeof picture === "string" ? picture : undefined,
    artworkUrl,
    popularity: item.popularity,
  };
}

export function normalizeArtistMatchName(value?: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeAlbumItem(item: TidalAlbumApiResponse): TidalAlbum {
  return {
    id: item.id,
    title: withVersion(item.title, item.version),
    type: item.type,
    popularity: item.popularity,
    artistId: item.artist?.id ?? item.artists?.[0]?.id,
    artistName:
      item.artist?.name ?? item.artists?.[0]?.name ?? "Artista Desconocido",
    releaseDate: item.releaseDate,
    year: item.releaseDate
      ? new Date(item.releaseDate).getFullYear()
      : undefined,
    numberOfTracks: item.numberOfTracks,
    explicit: item.explicit,
    artworkUrl: getArtworkUrl(item.cover ?? undefined),
  };
}

export function normalizePlaylistItem(item: TidalPlaylistApiResponse): TidalPlaylist {
  const rawImage = item.image || item.cover || item.picture || item.squareImage;
  let artworkUrl = undefined;

  if (rawImage) {
    if (rawImage.startsWith("http")) {
      artworkUrl = rawImage;
    } else {
      artworkUrl = getPlaylistArtworkUrl(rawImage);
    }
  }

  return {
    uuid: item.uuid,
    title: item.title,
    description: item.description,
    numberOfTracks: item.numberOfTracks,
    artworkUrl,
  };
}

export function normalizeArtistTrack(
  track: TidalTrackApiResponse,
  fallbackArtist?: TidalArtist,
): TidalTrack {
  const normalized = normalizeSearchItem(track);
  return {
    ...normalized,
    artistId: normalized.artistId ?? fallbackArtist?.id,
    artist: normalized.artist || fallbackArtist?.name || "Unknown Artist",
  };
}

export function getArtworkUrl(coverUuid?: string | null): string | undefined {
  if (
    !coverUuid ||
    coverUuid === "00000000-0000-0000-0000-000000000000" ||
    coverUuid === "null"
  )
    return undefined;
  if (coverUuid.startsWith("http")) return coverUuid;

  const normalized = coverUuid.replace(/-/g, "/");
  return `${TIDAL_ARTWORK_BASE}/${normalized}/640x640.jpg`;
}

export function getPlaylistArtworkUrl(
  playlistImageId?: string | null,
): string | undefined {
  if (!playlistImageId) return undefined;

  // Some playlist images are direct square hashes, while others follow the UUID pattern
  // If it's a UUID style (with dashes), we normalize it
  const normalized = playlistImageId.includes("-")
    ? playlistImageId.replace(/-/g, "/")
    : playlistImageId;

  return `${TIDAL_ARTWORK_BASE}/${normalized}/640x640.jpg`;
}

export function normalizeTopHit(hit: TidalUnifiedSearchApiResponse["topHit"]): TidalCatalogSearch["top"] {
  if (!hit?.value?.id) return null;
  if (hit.type === "ARTISTS" && hit.value.name) return { kind: "artist", artist: normalizeArtistItem(hit.value) };
  if (hit.type === "TRACKS" && hit.value.title) return { kind: "track", track: normalizeSearchItem(hit.value) };
  if (hit.type === "ALBUMS" && hit.value.title) return { kind: "album", album: normalizeAlbumItem(hit.value) };
  return null;
}

export function uniqueById<T extends { id: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  return items.filter(item => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

export function byReleaseDesc(a: TidalAlbum, b: TidalAlbum): number {
  const aDate = a.releaseDate ? Date.parse(a.releaseDate) : 0;
  const bDate = b.releaseDate ? Date.parse(b.releaseDate) : 0;
  return bDate - aDate || (b.year ?? 0) - (a.year ?? 0);
}

export function extractAlbumsFromTracks(tracks: TidalTrack[]): TidalAlbum[] {
  const albumsMap = new Map<number, TidalAlbum>();

  tracks.forEach((track) => {
    if (!track.albumId) return;
    if (albumsMap.has(track.albumId)) return;

    albumsMap.set(track.albumId, {
      id: track.albumId,
      title: track.album,
      artistId: track.artistId,
      artistName: track.artist,
      coverUuid: track.coverUuid,
      artworkUrl: track.artworkUrl,
    });
  });

  return Array.from(albumsMap.values());
}
