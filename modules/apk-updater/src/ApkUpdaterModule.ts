import { requireNativeModule } from 'expo-modules-core';

import type { ApkFileInfo, InstalledApkInfo } from './ApkUpdater.types';

interface NativeApkUpdaterModule {
  isAvailable(): boolean;
  canRequestPackageInstalls(): boolean;
  openUnknownSourcesSettings(): Promise<void>;
  installDownloadedApk(fileUri: string): Promise<void>;
  getInstalledVersion(): Promise<InstalledApkInfo>;
  inspectDownloadedApk(fileUri: string): Promise<ApkFileInfo>;
}

const NativeModule = requireNativeModule<NativeApkUpdaterModule>('ApkUpdater');

export function isApkUpdaterAvailable(): boolean {
  return NativeModule.isAvailable();
}

export function canRequestPackageInstalls(): boolean {
  return NativeModule.canRequestPackageInstalls();
}

export async function openUnknownSourcesSettings(): Promise<void> {
  return NativeModule.openUnknownSourcesSettings();
}

export async function installDownloadedApk(fileUri: string): Promise<void> {
  return NativeModule.installDownloadedApk(fileUri);
}

export async function getInstalledVersion(): Promise<InstalledApkInfo> {
  return NativeModule.getInstalledVersion();
}

export async function inspectDownloadedApk(fileUri: string): Promise<ApkFileInfo> {
  return NativeModule.inspectDownloadedApk(fileUri);
}

export default NativeModule;
