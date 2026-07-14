// Artwork belongs to the same durable catalog database as tracks and file
// handles. Keeping it in a separate IndexedDB database made startup ordering
// observable: the UI could receive tracks before their covers were available.
import {
  clearLibraryArtworkCache,
  loadLibraryArtworkUrls,
  saveLibraryArtworkBlob,
} from './webPersistence';

export const saveArtworkBlob = saveLibraryArtworkBlob;
export const loadArtworkUrls = loadLibraryArtworkUrls;
export const clearArtworkCache = clearLibraryArtworkCache;

/**
 * Turn a remote cover into a durable local Blob before adding it to the
 * catalog. The returned object URL is only for this session; `key` is what
 * makes the image survive reopen and work without the remote URL later.
 */
export async function cacheRemoteArtwork(key: string, url?: string): Promise<string | undefined> {
  if (!key || !url || url.startsWith('blob:')) return undefined;
  try {
    // TIDAL serves images for <img>, but does not grant canvas CORS access.
    // Route those through our same-origin proxy so we can persist the Blob and
    // extract its real colors for the dynamic theme.
    const source = /^https:\/\/resources\.tidal\.com\/images\//i.test(url)
      ? `/api/artwork?url=${encodeURIComponent(url)}`
      : url;
    const response = await fetch(source, { cache: 'force-cache' });
    if (!response.ok) return undefined;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || blob.size > 2_500_000) return undefined;
    await saveArtworkBlob(key, blob);
    return URL.createObjectURL(blob);
  } catch {
    return undefined;
  }
}
