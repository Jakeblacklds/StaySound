import type { TidalTrack } from '@staysound/types/audio';
import type { CatalogAlbum, CatalogArtist } from './monochromeCatalog';

/**
 * "Búsquedas recientes" de Descargas, como las de Spotify: no guarda solo el
 * texto que se escribió, sino lo que se terminó abriendo (el artista, el álbum,
 * la canción), con su carátula, para volver a ello con un clic.
 */

export type RecentCatalogItem =
  | { kind: 'artist'; artist: CatalogArtist }
  | { kind: 'album'; album: CatalogAlbum }
  | { kind: 'track'; track: TidalTrack }
  | { kind: 'query'; query: string };

const RECENT_ITEMS_KEY = 'staysound.web.downloads.recent-items.v2';
const LEGACY_RECENT_SEARCHES_KEY = 'staysound.web.downloads.recent-searches.v1';
const RECENT_ITEMS_LIMIT = 12;

export function recentItemKey(item: RecentCatalogItem): string {
  switch (item.kind) {
    case 'artist': return `artist:${item.artist.id}`;
    case 'album': return `album:${item.album.id}`;
    case 'track': return `track:${item.track.id}`;
    case 'query': return `query:${item.query.trim().toLowerCase()}`;
  }
}

function isRecentItem(value: unknown): value is RecentCatalogItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const entity = (key: string) => {
    const nested = item[key] as Record<string, unknown> | undefined;
    return Boolean(nested && typeof nested.id === 'number');
  };
  switch (item.kind) {
    case 'artist': return entity('artist');
    case 'album': return entity('album');
    case 'track': return entity('track');
    case 'query': return typeof item.query === 'string' && item.query.trim().length > 0;
    default: return false;
  }
}

export function loadRecentCatalogItems(): RecentCatalogItem[] {
  try {
    const raw = window.localStorage.getItem(RECENT_ITEMS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isRecentItem).slice(0, RECENT_ITEMS_LIMIT) : [];
    }
    // Las búsquedas de texto de la versión anterior siguen apareciendo.
    const legacy: unknown = JSON.parse(window.localStorage.getItem(LEGACY_RECENT_SEARCHES_KEY) ?? '[]');
    return Array.isArray(legacy)
      ? legacy
        .filter((query): query is string => typeof query === 'string' && query.trim().length > 0)
        .map(query => ({ kind: 'query' as const, query }))
        .slice(0, RECENT_ITEMS_LIMIT)
      : [];
  } catch {
    return [];
  }
}

/** Guarda y devuelve la lista ya recortada, para usarla directo como estado. */
export function saveRecentCatalogItems(items: RecentCatalogItem[]): RecentCatalogItem[] {
  const next = items.slice(0, RECENT_ITEMS_LIMIT);
  try {
    window.localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(next));
  } catch {
    // Modo privado: la búsqueda funciona igual sin historial.
  }
  return next;
}
