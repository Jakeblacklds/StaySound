export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'ota-ready'
  | 'binary-available'
  | 'downloading'
  | 'awaiting-install-permission'
  | 'installing'
  | 'error';

export type AppUpdateCheckSource = 'startup' | 'manual';

export type AndroidReleaseManifest = {
  versionCode: number;
  versionName: string;
  runtimeVersion: string;
  apkUrl: string;
  sha256: string;
  mandatory: boolean;
  notes: string;
  publishedAt: string;
};

export type AppUpdateRuntimeConfig = {
  otaChannel: string;
  otaUrl: string;
  runtimeVersion: string;
  releaseManifestUrl: string;
  binaryChannel: string;
  binaryUpdatesEnabled: boolean;
  packageName: string;
};
