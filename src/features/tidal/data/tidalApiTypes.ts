import type * as FileSystem from "expo-file-system/legacy";

export interface TidalTrackApiResponse {
  id: number;
  title: string;
  duration: number;
  trackNumber?: number;
  isrc?: string;
  explicit?: boolean;
  audioQuality?: string;
  mediaMetadata?: { tags?: string[] };
  album?: {
    id?: number;
    title?: string;
    cover?: string | null;
    releaseDate?: string;
    numberOfTracks?: number;
  };
  artist?: { id?: number; name?: string; picture?: string | null };
  artists?: Array<{ id?: number; name?: string; picture?: string | null }>;
  popularity?: number;
  /** "Live", "Remix", "Sped Up"… — TIDAL lo manda aparte del título. */
  version?: string | null;
  volumeNumber?: number;
}

export interface TidalSearchApiResponse {
  data?: {
    items?: TidalTrackApiResponse[];
  };
}

export interface TidalAlbumSearchApiResponse {
  data?: {
    albums?: {
      items?: TidalAlbumApiResponse[];
    };
    items?: TidalAlbumApiResponse[];
  };
}

export interface TidalArtistApiResponse {
  id: number;
  name: string;
  picture?: string | null;
  popularity?: number;
}

export interface TidalArtistSearchApiResponse {
  data?: {
    artists?: {
      items?: TidalArtistApiResponse[];
    };
    items?: TidalArtistApiResponse[];
  };
}

export interface TidalSimilarArtistsApiResponse {
  artists?: TidalArtistApiResponse[];
  items?: TidalArtistApiResponse[];
  data?: {
    artists?: TidalArtistApiResponse[];
    items?: TidalArtistApiResponse[];
  };
}

export interface TidalSimilarAlbumsApiResponse {
  albums?: TidalAlbumApiResponse[];
  items?: TidalAlbumApiResponse[];
  data?: {
    albums?: TidalAlbumApiResponse[];
    items?: TidalAlbumApiResponse[];
  };
}

export interface TidalArtistDetailApiResponse {
  artist?: TidalArtistApiResponse;
  cover?: {
    ["750"]?: string;
  };
}

export interface TidalAlbumApiResponse {
  id: number;
  title: string;
  version?: string | null;
  /** ALBUM, EP, SINGLE o COMPILATION en la API oficial de catálogo. */
  type?: string;
  popularity?: number;
  releaseDate?: string;
  explicit?: boolean;
  numberOfTracks?: number;
  cover?: string | null;
  artist?: {
    id?: number;
    name?: string;
  };
  artists?: Array<{
    id?: number;
    name?: string;
  }>;
}

export interface TidalAlbumDetailApiResponse {
  data?: TidalAlbumApiResponse & {
    items?: Array<{
      item?: TidalTrackApiResponse;
    }>;
  };
}

export interface TidalPlaylistApiResponse {
  uuid: string;
  title: string;
  description?: string;
  numberOfTracks?: number;
  image?: string;
  cover?: string;
  picture?: string;
  squareImage?: string;
}

export interface TidalPlaylistSearchApiResponse {
  data?: {
    playlists?: {
      items?: TidalPlaylistApiResponse[];
    };
    items?: TidalPlaylistApiResponse[];
  };
}

export interface ParsedManifest {
  urls: string[];
  quality: string;
  mimeType?: string;
  codecs?: string;
  isSegmented: boolean;
  sampleRate?: number;
  bitDepth?: number;
  manifestUrl?: string;
}

export interface TidalTrackManifestResponse {
  data?: {
    data?: {
      id?: string;
      type?: string;
      attributes?: {
        trackPresentation?: string;
        previewReason?: string;
        uri?: string;
        formats?: string[];
        trackAudioNormalizationData?: {
          replayGain?: number;
          peakAmplitude?: number;
        };
        albumAudioNormalizationData?: {
          replayGain?: number;
          peakAmplitude?: number;
        };
      };
    };
  };
}

export interface DownloadOptions {
  onProgress?: (progress: number) => void;
  onTask?: (task: FileSystem.DownloadResumable | null) => void;
  qobuzFallback?: boolean;
  qobuzOnly?: boolean;
}
