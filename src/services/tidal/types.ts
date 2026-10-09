/** Shared types for the TIDAL mirror layer. */
import type { TidalAlbumApiResponse, TidalArtistApiResponse, TidalTrackApiResponse } from "../../features/tidal/data/tidalApiTypes";

export type MirrorProvider = "tidal";

export type TidalMirrorCapability = "search" | "stream" | "download";

export type TidalMirrorAvailability = {
  status: "available" | "slow" | "unavailable";
  latencyMs?: number;
  checkedAt: number;
  statusCode?: number;
  provider: MirrorProvider;
  supportsSearch: boolean;
  supportsStream: boolean;
  supportsDownload: boolean;
  priority?: number;
  lastError?: string | null;
  source: "probe" | "static" | "remote";
};

export type TidalMirrorCategory = "api" | "streaming";

export type TidalMirrorCatalogEntry = {
  baseUrl: string;
  provider: MirrorProvider;
  enabled: boolean;
  priority: number;
  supportsSearch: boolean;
  supportsStream: boolean;
  supportsDownload: boolean;
  status: "available" | "slow" | "unavailable";
  latencyMs?: number;
  lastCheckedAt?: number;
  lastError?: string | null;
  source: "static" | "remote";
};

export type DynamicMirrorCatalog = {
  api: TidalMirrorCatalogEntry[];
  streaming: TidalMirrorCatalogEntry[];
  all: TidalMirrorCatalogEntry[];
  fetchedAt: number;
  source: "static" | "remote";
};

export type MirrorJsonResult<T> = {
  data: T;
  base: string;
};

export type PersistedPublicDownloadsPermission = {
  directoryUri: string;
};

export type TidalPagedApiResponse<T> = { items?: T[]; totalNumberOfItems?: number };

export type TidalUnifiedSearchApiResponse = {
  artists?: { items?: TidalArtistApiResponse[] };
  albums?: { items?: TidalAlbumApiResponse[] };
  tracks?: { items?: TidalTrackApiResponse[] };
  topHit?: { type?: string; value?: TidalArtistApiResponse & TidalAlbumApiResponse & TidalTrackApiResponse };
};
