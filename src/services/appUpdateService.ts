import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import {
  canRequestPackageInstalls,
  getInstalledVersion,
  inspectDownloadedApk,
  installDownloadedApk,
  isApkUpdaterAvailable,
  openUnknownSourcesSettings,
} from '@/modules/apk-updater';
import { useAppUpdateStore, useNotificationStore, useUIStore } from '@/src/stores';
import type {
  AndroidReleaseManifest,
  AppUpdateCheckSource,
  AppUpdateRuntimeConfig,
} from '@/src/types';

const APK_DOWNLOAD_DIR = `${FileSystem.documentDirectory ?? ''}updates`;

let activeCheckPromise: Promise<void> | null = null;
let activeInstallPromise: Promise<void> | null = null;

function getExtraConfig() {
  return (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<string, any>;
}

export function getAppUpdateConfig(): AppUpdateRuntimeConfig {
  const extra = getExtraConfig();
  const config = (extra.appUpdates ?? {}) as Record<string, any>;

  return {
    otaChannel: typeof config.otaChannel === 'string' ? config.otaChannel.trim() : '',
    otaUrl: typeof config.otaUrl === 'string' ? config.otaUrl.trim() : '',
    runtimeVersion: typeof config.runtimeVersion === 'string' ? config.runtimeVersion.trim() : '',
    releaseManifestUrl:
      typeof config.releaseManifestUrl === 'string' ? config.releaseManifestUrl.trim() : '',
    binaryChannel: typeof config.binaryChannel === 'string' ? config.binaryChannel.trim() : 'prod',
    binaryUpdatesEnabled: Boolean(config.binaryUpdatesEnabled),
    packageName: typeof config.packageName === 'string' ? config.packageName.trim() : '',
  };
}

export function getInstalledVersionLabel(): string {
  const storeVersion = useAppUpdateStore.getState().installedVersion;
  if (storeVersion?.versionName && storeVersion.versionCode != null) {
    return `${storeVersion.versionName} (${storeVersion.versionCode})`;
  }

  const versionName = Constants.nativeApplicationVersion || Constants.expoConfig?.version || '1.0.0';
  const versionCode = Constants.nativeBuildVersion || '';
  return versionCode ? `${versionName} (${versionCode})` : versionName;
}

function shouldHandleAppUpdates(config = getAppUpdateConfig()): boolean {
  if (Platform.OS !== 'android') {
    return false;
  }

  if (!config.binaryUpdatesEnabled) {
    return false;
  }

  return true;
}

function canHandleBinaryUpdates(config = getAppUpdateConfig()): boolean {
  return shouldHandleAppUpdates(config) && isApkUpdaterAvailable();
}

async function refreshInstalledVersionInfo() {
  if (!canHandleBinaryUpdates()) {
    return null;
  }

  const installedVersion = await getInstalledVersion();
  useAppUpdateStore.getState().setInstalledVersion(installedVersion);
  return installedVersion;
}

function buildManifestUrl(baseUrl: string, channel: string): string {
  const url = new URL(baseUrl);
  if (!url.searchParams.has('channel')) {
    url.searchParams.set('channel', channel);
  }
  return url.toString();
}

async function fetchBinaryManifest(config: AppUpdateRuntimeConfig): Promise<AndroidReleaseManifest | null> {
  if (!config.releaseManifestUrl) {
    return null;
  }

  const response = await fetch(buildManifestUrl(config.releaseManifestUrl, config.binaryChannel), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`No se pudo consultar la version remota (${response.status}).`);
  }

  const payload = (await response.json()) as Partial<AndroidReleaseManifest>;
  if (
    typeof payload.versionCode !== 'number' ||
    typeof payload.versionName !== 'string' ||
    typeof payload.runtimeVersion !== 'string' ||
    typeof payload.apkUrl !== 'string' ||
    typeof payload.sha256 !== 'string'
  ) {
    throw new Error('El manifiesto remoto de StaySound esta incompleto.');
  }

  return {
    versionCode: payload.versionCode,
    versionName: payload.versionName.trim(),
    runtimeVersion: payload.runtimeVersion.trim(),
    apkUrl: payload.apkUrl.trim(),
    sha256: payload.sha256.trim().toLowerCase(),
    mandatory: Boolean(payload.mandatory),
    notes: typeof payload.notes === 'string' ? payload.notes.trim() : '',
    publishedAt: typeof payload.publishedAt === 'string' ? payload.publishedAt : '',
  };
}

function recordSuccessfulCheck() {
  const store = useAppUpdateStore.getState();
  store.setLastCheckedAt(new Date().toISOString());
  store.setLastError(null);
}

function normalizeSha256(value: string): string {
  return value.trim().toLowerCase();
}

function hasMatchingSigner(currentSigners: string[], candidateSigners: string[]): boolean {
  const current = new Set(currentSigners.map(normalizeSha256));
  return candidateSigners.some((signer) => current.has(normalizeSha256(signer)));
}

async function deleteFileIfExists(fileUri: string | null | undefined) {
  if (!fileUri) {
    return;
  }

  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (info.exists) {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
    }
  } catch {
    // Best effort cleanup only.
  }
}

function buildBinaryPromptMessage(release: AndroidReleaseManifest): string {
  const versionLine = `Version ${release.versionName} disponible para instalar.`;
  const notes = release.notes ? `\n\n${release.notes}` : '';
  return `${versionLine}${notes}`;
}

function promptForDownloadedOtaUpdate() {
  useUIStore.getState().openConfirmModal({
    title: 'Actualizacion lista',
    message: 'Hay una actualizacion de StaySound lista para aplicar. Reiniciar ahora cargara la version nueva.',
    confirmLabel: 'Reiniciar',
    cancelLabel: 'Luego',
    onConfirm: () => {
      void applyDownloadedOtaUpdate();
    },
  });
}

function promptForBinaryUpdate(release: AndroidReleaseManifest) {
  const store = useAppUpdateStore.getState();
  if (store.promptedBinaryVersionCode === release.versionCode) {
    return;
  }

  store.setPromptedBinaryVersionCode(release.versionCode);
  useUIStore.getState().openConfirmModal({
    title: release.mandatory ? 'Actualizacion requerida' : 'Nueva version disponible',
    message: buildBinaryPromptMessage(release),
    confirmLabel: 'Actualizar',
    cancelLabel: 'Ahora no',
    onConfirm: () => {
      void downloadAndInstallBinaryUpdate();
    },
  });
}

async function checkOtaUpdate(source: AppUpdateCheckSource): Promise<boolean> {
  if (!Updates.isEnabled) {
    return false;
  }

  const result = await Updates.checkForUpdateAsync();
  if (!result.isAvailable) {
    return false;
  }

  const fetchResult = await Updates.fetchUpdateAsync();
  if (!fetchResult.isNew) {
    return false;
  }

  const store = useAppUpdateStore.getState();
  store.setOtaReady(true);
  store.setStatus('ota-ready', source);
  recordSuccessfulCheck();
  promptForDownloadedOtaUpdate();
  return true;
}

async function checkBinaryUpdate(
  config: AppUpdateRuntimeConfig,
  source: AppUpdateCheckSource,
): Promise<boolean> {
  if (!canHandleBinaryUpdates(config)) {
    useAppUpdateStore.getState().setAvailableBinaryRelease(null);
    return false;
  }

  const release = await fetchBinaryManifest(config);
  const installedVersion =
    useAppUpdateStore.getState().installedVersion ?? (await refreshInstalledVersionInfo());

  if (!release || !installedVersion) {
    useAppUpdateStore.getState().setAvailableBinaryRelease(null);
    return false;
  }

  if (release.versionCode <= installedVersion.versionCode) {
    useAppUpdateStore.getState().setAvailableBinaryRelease(null);
    return false;
  }

  useAppUpdateStore.getState().setAvailableBinaryRelease(release);
  useAppUpdateStore.getState().setStatus('binary-available', source);
  recordSuccessfulCheck();
  promptForBinaryUpdate(release);
  return true;
}

export async function bootstrapAppUpdates(): Promise<void> {
  const store = useAppUpdateStore.getState();
  if (store.startupCheckCompleted) {
    return;
  }

  try {
    await checkForAppUpdates('startup');
  } finally {
    useAppUpdateStore.getState().setStartupCheckCompleted(true);
  }
}

export async function checkForAppUpdates(source: AppUpdateCheckSource = 'manual'): Promise<void> {
  if (activeCheckPromise) {
    return activeCheckPromise;
  }

  activeCheckPromise = (async () => {
    const config = getAppUpdateConfig();
    if (!shouldHandleAppUpdates(config)) {
      return;
    }

    const store = useAppUpdateStore.getState();
    store.setStatus('checking', source);
    store.setLastError(null);

    try {
      await refreshInstalledVersionInfo();

      const handledOta = await checkOtaUpdate(source);
      if (handledOta) {
        return;
      }

      const handledBinary = await checkBinaryUpdate(config, source);
      if (handledBinary) {
        return;
      }

      store.setOtaReady(false);
      store.setStatus('up-to-date', source);
      recordSuccessfulCheck();

      if (source === 'manual') {
        useNotificationStore.getState().showNotification('StaySound ya esta al dia.', 'success');
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo revisar si hay actualizaciones.';
      store.setStatus('error', source);
      store.setLastError(message);
      if (source === 'manual') {
        useNotificationStore.getState().showNotification(message, 'error');
      }
    }
  })();

  try {
    await activeCheckPromise;
  } finally {
    activeCheckPromise = null;
  }
}

export async function applyDownloadedOtaUpdate(): Promise<void> {
  useAppUpdateStore.getState().setStatus('installing');
  await Updates.reloadAsync();
}

export async function downloadAndInstallBinaryUpdate(): Promise<void> {
  if (activeInstallPromise) {
    return activeInstallPromise;
  }

  activeInstallPromise = (async () => {
    const config = getAppUpdateConfig();
    const store = useAppUpdateStore.getState();
    const release = store.availableBinaryRelease;
    const installedVersion = store.installedVersion ?? (await refreshInstalledVersionInfo());

    if (!canHandleBinaryUpdates(config) || !release || !installedVersion) {
      return;
    }

    if (!canRequestPackageInstalls()) {
      store.setStatus('awaiting-install-permission');
      useNotificationStore.getState().showNotification(
        'Activa el permiso para instalar APKs de StaySound y vuelve a tocar Actualizar.',
        'warning',
      );
      await openUnknownSourcesSettings();
      return;
    }

    let downloadedUri: string | null = null;

    try {
      if (!FileSystem.documentDirectory) {
        throw new Error('StaySound no encontro una carpeta local para guardar el APK.');
      }

      store.setStatus('downloading');
      await FileSystem.makeDirectoryAsync(APK_DOWNLOAD_DIR, { intermediates: true });

      downloadedUri = `${APK_DOWNLOAD_DIR}/staysound-${release.versionName}-${release.versionCode}.apk`;
      await deleteFileIfExists(downloadedUri);

      const result = await FileSystem.downloadAsync(release.apkUrl, downloadedUri);
      downloadedUri = result.uri;

      const apkInfo = await inspectDownloadedApk(downloadedUri);
      const matchesPackage =
        apkInfo.packageName === config.packageName && apkInfo.packageName === installedVersion.packageName;
      if (!matchesPackage) {
        throw new Error('El APK descargado no corresponde al paquete productivo de StaySound.');
      }

      if (apkInfo.versionCode !== release.versionCode) {
        throw new Error('La version interna del APK no coincide con el manifiesto remoto.');
      }

      if (normalizeSha256(apkInfo.fileSha256) !== normalizeSha256(release.sha256)) {
        throw new Error('La integridad del APK no coincide con el SHA-256 esperado.');
      }

      if (!hasMatchingSigner(installedVersion.signerSha256, apkInfo.signerSha256)) {
        throw new Error('La firma del APK no coincide con la app instalada.');
      }

      store.setStatus('installing');
      await installDownloadedApk(downloadedUri);
      useNotificationStore.getState().showNotification(
        'Android abrira el instalador para completar la actualizacion.',
        'info',
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo preparar la instalacion del APK.';
      store.setStatus('error');
      store.setLastError(message);
      useNotificationStore.getState().showNotification(message, 'error');
      await deleteFileIfExists(downloadedUri);
    }
  })();

  try {
    await activeInstallPromise;
  } finally {
    activeInstallPromise = null;
  }
}
