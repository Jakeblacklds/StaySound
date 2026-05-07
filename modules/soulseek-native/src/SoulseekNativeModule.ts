import { requireNativeModule } from 'expo-modules-core';

export type SoulseekNativeConfig = {
  username: string;
  password: string;
  serverHost?: string;
  serverPort?: number;
  listenPort?: number;
  searchTimeoutMs?: number;
  maxResults?: number;
  clientVersion?: number;
};

export type SoulseekNativeMatch = {
  username: string;
  filename: string;
  size: number;
  extension?: string;
  format?: string;
  codec?: string;
  bitRate?: number;
  sampleRate?: number;
  bitDepth?: number;
  durationMs?: number;
  slotsFree?: boolean;
  queueLength?: number;
  speed?: number;
  host?: string;
  port?: number;
};

type SoulseekNativeDownloadResult = {
  path: string;
  bytesWritten: number;
};

interface NativeSoulseekModule {
  isAvailable(): boolean;
  search(config: SoulseekNativeConfig, query: string, timeoutMs: number, maxResults: number): Promise<SoulseekNativeMatch[]>;
  download(config: SoulseekNativeConfig, match: SoulseekNativeMatch, outputPath: string): Promise<SoulseekNativeDownloadResult>;
  cancelActiveOperations(): Promise<void>;
}

const NativeModule = requireNativeModule<NativeSoulseekModule>('SoulseekNative');

export function isSoulseekNativeAvailable(): boolean {
  return NativeModule.isAvailable();
}

export async function searchSoulseekNative(
  config: SoulseekNativeConfig,
  query: string,
  timeoutMs: number,
  maxResults: number,
): Promise<SoulseekNativeMatch[]> {
  return NativeModule.search(config, query, timeoutMs, maxResults);
}

export async function downloadSoulseekNativeFile(
  config: SoulseekNativeConfig,
  match: SoulseekNativeMatch,
  outputPath: string,
): Promise<SoulseekNativeDownloadResult> {
  return NativeModule.download(config, match, outputPath);
}

export async function cancelSoulseekNativeOperations(): Promise<void> {
  return NativeModule.cancelActiveOperations();
}

export default NativeModule;
