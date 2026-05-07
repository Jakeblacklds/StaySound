export type ApkSignerInfo = {
  sha256: string;
};

export type InstalledApkInfo = {
  packageName: string;
  versionCode: number;
  versionName: string;
  runtimeVersion?: string | null;
  signerSha256: string[];
};

export type ApkFileInfo = {
  packageName: string;
  versionCode: number;
  versionName: string;
  fileSha256: string;
  signerSha256: string[];
};
