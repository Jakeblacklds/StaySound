import { requireOptionalNativeModule } from 'expo-modules-core';

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

const NativeModule = requireOptionalNativeModule<NativeSoulseekModule>('SoulseekNative');

function requireSoulseekNativeModule(): NativeSoulseekModule {
  if (!NativeModule) {
    throw new Error('El motor nativo de Soulseek no esta disponible en esta plataforma.');
  }

  return NativeModule;
}

export function isSoulseekNativeAvailable(): boolean {
  return NativeModule?.isAvailable() ?? false;
}

export async function searchSoulseekNative(
  config: SoulseekNativeConfig,
  query: string,
  timeoutMs: number,
  maxResults: number,
): Promise<SoulseekNativeMatch[]> {
  return requireSoulseekNativeModule().search(config, query, timeoutMs, maxResults);
}

export async function downloadSoulseekNativeFile(
  config: SoulseekNativeConfig,
  match: SoulseekNativeMatch,
  outputPath: string,
): Promise<SoulseekNativeDownloadResult> {
  return requireSoulseekNativeModule().download(config, match, outputPath);
}

export async function cancelSoulseekNativeOperations(): Promise<void> {
  if (!NativeModule) return;
  return NativeModule.cancelActiveOperations();
}

export default NativeModule;
