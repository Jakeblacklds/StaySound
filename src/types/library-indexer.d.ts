declare module 'library-indexer' {
  export interface NativeScanTrack {
    id: string;
    uri: string;
    title: string;
    artist: string;
    album: string;
    durationMs: number;
    dateAddedMs: number;
    dateModifiedMs: number;
    size: number;
    artwork?: string;
    albumId?: string;
    relativePath?: string;
    displayName?: string;
  }

  export function isLibraryIndexerAvailable(): boolean;
  export function scanTracksNative(folderPattern?: string): Promise<NativeScanTrack[]>;
}
