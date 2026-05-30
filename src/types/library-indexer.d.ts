declare module 'library-indexer' {
  import type { EventSubscription } from 'expo-modules-core';

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
    artworkEntries?: Array<{ name: string; uri: string }>;
  }

  export interface AudioLibraryChangedEvent {
    uri?: string;
    changedAt: number;
  }

  export function isLibraryIndexerAvailable(): boolean;
  export function resolveContentUriToFileUri(contentUri: string): Promise<string | null>;
  export function scanTracksNative(folderPattern?: string): Promise<NativeScanTrack[]>;
  export function addAudioLibraryChangedListener(listener: (event: AudioLibraryChangedEvent) => void): EventSubscription;
}
