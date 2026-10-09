/**
 * Latest public build. Binaries live in the public `staysound-releases` repo (the app repo is
 * private, so its own release assets aren't downloadable); the web app's "Consigue la app"
 * page reads the same release — see web/src/appDownload.ts.
 */
const RELEASES_REPO = process.env.NEXT_PUBLIC_RELEASES_REPO || 'Jakeblacklds/staysound-releases';

export const RELEASES_URL = `https://github.com/${RELEASES_REPO}/releases`;
/** Where "star us" points: the public repo. The source repo is private. */
export const REPO_URL = `https://github.com/${RELEASES_REPO}`;

export interface Download {
  fileName: string;
  url: string;
  sizeBytes: number;
}

export interface Release {
  version: string;
  publishedAt: string;
  android: Download | null;
  macos: Download | null;
}

/** Shown when GitHub is unreachable or rate-limited at render time. */
const FALLBACK: Release = {
  version: '1.0.0',
  publishedAt: '2026-08-04T04:53:02Z',
  android: {
    fileName: 'StaySound-1.0.0-android.apk',
    url: `${RELEASES_URL}/download/v1.0.0/StaySound-1.0.0-android.apk`,
    sizeBytes: 73852753,
  },
  macos: {
    fileName: 'StaySound-1.0.0-macos-aarch64.dmg',
    url: `${RELEASES_URL}/download/v1.0.0/StaySound-1.0.0-macos-aarch64.dmg`,
    sizeBytes: 29926716,
  },
};

interface GitHubAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

function pick(assets: GitHubAsset[], extension: string): Download | null {
  const asset = assets.find(entry => entry.name?.toLowerCase().endsWith(extension) && entry.browser_download_url);
  if (!asset?.name || !asset.browser_download_url) return null;
  return { fileName: asset.name, url: asset.browser_download_url, sizeBytes: Number(asset.size) || 0 };
}

export async function fetchRelease(): Promise<Release> {
  try {
    const response = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return FALLBACK;
    const payload = (await response.json()) as { tag_name?: string; published_at?: string; assets?: GitHubAsset[] };
    const assets = payload.assets ?? [];
    const android = pick(assets, '.apk');
    const macos = pick(assets, '.dmg');
    if (!android && !macos) return FALLBACK;
    return {
      version: (payload.tag_name ?? '').replace(/^v/i, '') || FALLBACK.version,
      publishedAt: payload.published_at ?? '',
      android,
      macos,
    };
  } catch {
    return FALLBACK;
  }
}

export function formatSize(bytes: number): string {
  return bytes ? `${Math.round(bytes / (1024 * 1024))} MB` : '';
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}
