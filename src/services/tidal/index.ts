/**
 * Public surface of the TIDAL layer. Import from here (or the `tidalService` facade), never from the internal
 * modules: they are free to move as the Kotlin port takes over each responsibility.
 *
 *   constants     static configuration            mirrorPolicy  pure mirror rules
 *   types         shared types                    mirrors       roster, health, rotation (stateful)
 *   net           fetch helpers                   http          catalog + mirror requests
 *   cache         short-lived read cache          normalize     pure API -> app model mappers
 *   catalog       search and detail reads         manifest      track manifest from mirrors
 *   files         pure file/extension helpers     storage       download destinations (SAF, app storage)
 *   download      track downloads                 stream        playable stream tracks and fallbacks
 */
export { TIDAL_API_BASES, TIDAL_MIRROR_NAMES } from "./constants";
export type { TidalMirrorAvailability, TidalMirrorCapability } from "./types";
export { getTidalMirrorAvailability, getTidalMirrorOptions, markTidalMirrorUnavailable } from "./mirrors";
export { extractAlbumsFromTracks, getArtworkUrl, getPlaylistArtworkUrl } from "./normalize";
export {
  getTidalAlbumDetail,
  getTidalArtistDetail,
  getTidalArtistInfo,
  getTidalPlaylistDetail,
  getTidalSimilarAlbums,
  getTidalSimilarArtists,
  searchTidal,
  searchTidalAlbums,
  searchTidalArtists,
  searchTidalCatalogAll,
  searchTidalPlaylists,
} from "./catalog";
export { getTidalTrackManifest } from "./manifest";
export { downloadTidalTrack } from "./download";
export { createTidalStreamTrack } from "./stream";
export { isValidAudioFile } from "../../features/tidal/data/audioFileValidation";
