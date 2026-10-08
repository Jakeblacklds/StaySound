/**
 * Release catalog for the "Consigue la app" page.
 *
 * Binaries live in a separate PUBLIC GitHub repo (this one is private, so its own
 * release assets aren't downloadable without a token). Publish a release there and
 * attach the artifacts — the page classifies them by file name, so there is no
 * manifest to keep in sync:
 *
 *   *.apk                        → Android
 *   *.msi / *-setup.exe / *.exe  → Windows
 *   *.dmg / *.app.tar.gz         → macOS
 *
 * Android keeps its legacy path too: if a release carries no .apk we fall back to
 * the Supabase manifest that `npm run android:publish:release` already writes.
 */

const DEFAULT_RELEASES_REPO = 'Jakeblacklds/staysound-releases';

const DEFAULT_ANDROID_MANIFEST_URL =
  'https://ucrtwqwaaadgjoerhgwg.supabase.co/storage/v1/object/public/staysound-releases/android/prod/manifest.json';

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

const RELEASES_REPO = env.VITE_RELEASES_REPO || DEFAULT_RELEASES_REPO;
const ANDROID_MANIFEST_URL = env.VITE_APP_RELEASES_MANIFEST_URL || DEFAULT_ANDROID_MANIFEST_URL;

export const RELEASES_PAGE_URL = `https://github.com/${RELEASES_REPO}/releases`;

export type ReleasePlatform = 'android' | 'windows' | 'macos';

export interface ReleaseAsset {
  /** Original file name, shown on hover so people can verify what they grabbed. */
  fileName: string;
  url: string;
  sizeBytes: number;
  /** Human label for the variant, e.g. "Apple Silicon" or "arm64-v8a". */
  label: string;
  /** Preferred download for this platform when several variants exist. */
  recommended: boolean;
}

export interface PlatformRelease {
  platform: ReleasePlatform;
  version: string;
  publishedAt: string;
  assets: ReleaseAsset[];
}

export interface ReleaseCatalog {
  android: PlatformRelease | null;
  windows: PlatformRelease | null;
  macos: PlatformRelease | null;
  /** Release notes body, used verbatim as "novedades". */
  notes: string;
}

/** Legacy shape still consumed by the sidebar download card. */
export interface AppReleaseInfo {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  publishedAt: string;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  assets?: GitHubAsset[];
}

const CACHE_KEY = 'staysound.web.releases.v1';
const CACHE_TTL_MS = 10 * 60 * 1000;

function readCache(): ReleaseCatalog | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; catalog: ReleaseCatalog };
    if (!parsed?.at || Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.catalog;
  } catch {
    return null;
  }
}

function writeCache(catalog: ReleaseCatalog): void {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), catalog }));
  } catch {
    // Private-mode storage failures just mean we refetch; not worth surfacing.
  }
}

function classify(fileName: string): ReleasePlatform | null {
  const name = fileName.toLowerCase();
  if (name.endsWith('.apk')) return 'android';
  if (name.endsWith('.msi') || name.endsWith('.exe')) return 'windows';
  if (name.endsWith('.dmg') || name.endsWith('.app.tar.gz')) return 'macos';
  return null;
}

/** Signature/manifest sidecars Tauri emits next to the real installers. */
function isUpdaterSidecar(fileName: string): boolean {
  const name = fileName.toLowerCase();
  return name.endsWith('.sig') || name === 'latest.json';
}

function labelFor(platform: ReleasePlatform, fileName: string): { label: string; rank: number } {
  const name = fileName.toLowerCase();
  if (platform === 'macos') {
    if (name.includes('aarch64') || name.includes('arm64')) return { label: 'Apple Silicon', rank: 0 };
    if (name.includes('x64') || name.includes('x86_64') || name.includes('intel')) return { label: 'Intel', rank: 1 };
    return { label: 'Universal', rank: 0 };
  }
  if (platform === 'windows') {
    if (name.endsWith('.msi')) return { label: 'Instalador MSI', rank: 0 };
    return { label: 'Instalador EXE', rank: 1 };
  }
  if (name.includes('arm64') || name.includes('aarch64')) return { label: 'arm64-v8a', rank: 0 };
  if (name.includes('armeabi') || name.includes('v7a')) return { label: 'armeabi-v7a', rank: 1 };
  return { label: 'APK universal', rank: 0 };
}

function buildPlatform(
  platform: ReleasePlatform,
  assets: GitHubAsset[],
  version: string,
  publishedAt: string,
): PlatformRelease | null {
  const ranked = assets
    .map(asset => {
      const { label, rank } = labelFor(platform, asset.name);
      const entry: ReleaseAsset = {
        fileName: asset.name,
        url: asset.browser_download_url,
        sizeBytes: Number(asset.size) || 0,
        label,
        recommended: false,
      };
      return { rank, asset: entry };
    })
    .sort((a, b) => a.rank - b.rank);

  if (ranked.length === 0) return null;
  ranked[0].asset.recommended = true;

  return {
    platform,
    version,
    publishedAt,
    assets: ranked.map(entry => entry.asset),
  };
}

async function fetchAndroidFallback(): Promise<PlatformRelease | null> {
  const info = await fetchLatestAppRelease();
  if (!info) return null;
  return {
    platform: 'android',
    version: info.versionName,
    publishedAt: info.publishedAt,
    assets: [{
      fileName: `StaySound-${info.versionName}.apk`,
      url: info.apkUrl,
      sizeBytes: 0,
      label: 'APK universal',
      recommended: true,
    }],
  };
}

export async function fetchReleaseCatalog(): Promise<ReleaseCatalog> {
  const cached = readCache();
  if (cached) return cached;

  const empty: ReleaseCatalog = { android: null, windows: null, macos: null, notes: '' };
  let release: GitHubRelease | null = null;

  try {
    const response = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (response.ok) release = (await response.json()) as GitHubRelease;
  } catch {
    // Offline, rate-limited, or the repo doesn't exist yet — fall through to the
    // Android manifest so at least the existing pipeline keeps working.
  }

  const version = release?.tag_name?.replace(/^v/i, '') || release?.name || '';
  const publishedAt = release?.published_at ?? '';
  const buckets: Record<ReleasePlatform, GitHubAsset[]> = { android: [], windows: [], macos: [] };

  for (const asset of release?.assets ?? []) {
    if (!asset?.name || !asset.browser_download_url) continue;
    if (isUpdaterSidecar(asset.name)) continue;
    const platform = classify(asset.name);
    if (platform) buckets[platform].push(asset);
  }

  const catalog: ReleaseCatalog = {
    ...empty,
    notes: (release?.body ?? '').trim(),
    android: buildPlatform('android', buckets.android, version, publishedAt),
    windows: buildPlatform('windows', buckets.windows, version, publishedAt),
    macos: buildPlatform('macos', buckets.macos, version, publishedAt),
  };

  if (!catalog.android) {
    catalog.android = await fetchAndroidFallback();
  }

  writeCache(catalog);
  return catalog;
}

/** Legacy Android-only lookup kept for the sidebar card. */
export async function fetchLatestAppRelease(): Promise<AppReleaseInfo | null> {
  try {
    const response = await fetch(`${ANDROID_MANIFEST_URL}?t=${Date.now()}`, {
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

export function detectPlatform(): ReleasePlatform | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  // iPadOS reports as Mac; a .dmg is useless there, so exclude touch-capable "Macs".
  if (/Mac/i.test(ua) && navigator.maxTouchPoints <= 1) return 'macos';
  return null;
}

export function formatReleaseSize(bytes: number): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
