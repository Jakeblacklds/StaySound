import type { InstalledApkInfo } from '@/modules/apk-updater';
import type { AndroidReleaseManifest, AppUpdateCheckSource, AppUpdateStatus } from '@/src/types';
import { create } from 'zustand';

type AppUpdateState = {
  status: AppUpdateStatus;
  checkSource: AppUpdateCheckSource | null;
  availableBinaryRelease: AndroidReleaseManifest | null;
  installedVersion: InstalledApkInfo | null;
  otaReady: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  startupCheckCompleted: boolean;
  promptedBinaryVersionCode: number | null;
  setStatus: (status: AppUpdateStatus, checkSource?: AppUpdateCheckSource | null) => void;
  setAvailableBinaryRelease: (release: AndroidReleaseManifest | null) => void;
  setInstalledVersion: (installedVersion: InstalledApkInfo | null) => void;
  setOtaReady: (otaReady: boolean) => void;
  setLastCheckedAt: (lastCheckedAt: string | null) => void;
  setLastError: (lastError: string | null) => void;
  setStartupCheckCompleted: (startupCheckCompleted: boolean) => void;
  setPromptedBinaryVersionCode: (promptedBinaryVersionCode: number | null) => void;
};

export const useAppUpdateStore = create<AppUpdateState>((set) => ({
  status: 'idle',
  checkSource: null,
  availableBinaryRelease: null,
  installedVersion: null,
  otaReady: false,
  lastCheckedAt: null,
  lastError: null,
  startupCheckCompleted: false,
  promptedBinaryVersionCode: null,
  setStatus: (status, checkSource = null) => set({ status, checkSource }),
  setAvailableBinaryRelease: (availableBinaryRelease) => set({ availableBinaryRelease }),
  setInstalledVersion: (installedVersion) => set({ installedVersion }),
  setOtaReady: (otaReady) => set({ otaReady }),
  setLastCheckedAt: (lastCheckedAt) => set({ lastCheckedAt }),
  setLastError: (lastError) => set({ lastError }),
  setStartupCheckCompleted: (startupCheckCompleted) => set({ startupCheckCompleted }),
  setPromptedBinaryVersionCode: (promptedBinaryVersionCode) => set({ promptedBinaryVersionCode }),
}));
