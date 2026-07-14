const DEFAULT_MANIFEST_URL =
  'https://yuoaayhogopuzkjttmzr.supabase.co/storage/v1/object/public/staysound-releases/android/prod/manifest.json';

const MANIFEST_URL =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_APP_RELEASES_MANIFEST_URL ||
  DEFAULT_MANIFEST_URL;

export interface AppReleaseInfo {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  publishedAt: string;
}

export async function fetchLatestAppRelease(): Promise<AppReleaseInfo | null> {
  try {
    const response = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const payload = await response.json();
    if (typeof payload?.apkUrl !== 'string' || typeof payload?.versionName !== 'string') {
      return null;
    }

    return {
      versionName: payload.versionName,
      versionCode: Number(payload.versionCode) || 0,
      apkUrl: payload.apkUrl,
      publishedAt: typeof payload.publishedAt === 'string' ? payload.publishedAt : '',
    };
  } catch {
    return null;
  }
}
