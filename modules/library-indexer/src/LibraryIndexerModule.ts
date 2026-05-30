import { EventSubscription, requireNativeModule } from 'expo-modules-core';

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

interface NativeLibraryIndexerModule {
  isAvailable(): boolean;
  scanTracks(folderPattern?: string): Promise<NativeScanTrack[]>;
  resolveContentUriToFileUri(contentUri: string): Promise<string | null>;
  addListener(eventName: 'onAudioLibraryChanged', listener: (event: AudioLibraryChangedEvent) => void): EventSubscription;
}

const NativeModule = requireNativeModule<NativeLibraryIndexerModule>('LibraryIndexer');

export type AudioLibraryChangedEvent = {
  uri?: string;
  changedAt: number;
};

export function isLibraryIndexerAvailable(): boolean {
  return NativeModule.isAvailable();
}

export async function scanTracksNative(folderPattern?: string): Promise<NativeScanTrack[]> {
  return NativeModule.scanTracks(folderPattern);
}

export async function resolveContentUriToFileUri(contentUri: string): Promise<string | null> {
  return NativeModule.resolveContentUriToFileUri(contentUri);
}

export function addAudioLibraryChangedListener(
  listener: (event: AudioLibraryChangedEvent) => void
): EventSubscription {
  return NativeModule.addListener('onAudioLibraryChanged', listener);
}
