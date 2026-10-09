import { FileSystemStorage } from '@/src/services/storage';
import { useCallback, useEffect, useState } from 'react';

/**
 * "Búsquedas recientes" al estilo Spotify: no solo el texto escrito, sino lo que
 * se terminó abriendo (artista, álbum, canción) con su carátula, para volver a
 * ello con un toque. Las búsquedas de texto de la versión anterior se migran.
 */
export type TidalRecentItem = {
    kind: 'query' | 'artist' | 'album' | 'track';
    id: string;
    title: string;
    subtitle: string;
    artwork?: string;
};

const STORAGE_KEY = 'tidal-recent-items-v2';
const LEGACY_STORAGE_KEY = 'tidal-recent-searches';
const MAX_RECENT_ITEMS = 12;

export const recentItemKey = (item: Pick<TidalRecentItem, 'kind' | 'id'>) =>
    `${item.kind}:${item.kind === 'query' ? item.id.trim().toLowerCase() : item.id}`;

function sanitize(value: unknown): TidalRecentItem[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry): TidalRecentItem[] => {
        if (typeof entry === 'string') {
            const query = entry.trim();
            return query ? [{ kind: 'query', id: query, title: query, subtitle: 'Búsqueda' }] : [];
        }
        if (!entry || typeof entry !== 'object') return [];
        const item = entry as Partial<TidalRecentItem>;
        if (!item.kind || !['query', 'artist', 'album', 'track'].includes(item.kind)) return [];
        if (typeof item.id !== 'string' || !item.id || typeof item.title !== 'string') return [];
        return [{
            kind: item.kind, id: item.id, title: item.title,
            subtitle: typeof item.subtitle === 'string' ? item.subtitle : '',
            artwork: typeof item.artwork === 'string' ? item.artwork : undefined,
        }];
    }).slice(0, MAX_RECENT_ITEMS);
}

export function useTidalRecentItems() {
    const [recentItems, setRecentItems] = useState<TidalRecentItem[]>([]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const raw = await FileSystemStorage.getItem(STORAGE_KEY)
                ?? await FileSystemStorage.getItem(LEGACY_STORAGE_KEY);
            if (!raw || cancelled) return;
            try {
                const saved = sanitize(JSON.parse(raw));
                if (!cancelled) setRecentItems(saved);
            } catch {
                // Un historial inválido se ignora y se reemplaza en la siguiente búsqueda.
            }
        })().catch(() => {
            // El historial es opcional; un fallo de almacenamiento no bloquea la búsqueda.
        });
        return () => { cancelled = true; };
    }, []);

    const update = useCallback((change: (current: TidalRecentItem[]) => TidalRecentItem[]) => {
        setRecentItems(current => {
            const next = change(current).slice(0, MAX_RECENT_ITEMS);
            void FileSystemStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    }, []);

    const rememberRecentItem = useCallback((item: TidalRecentItem) => {
        if (!item.id.trim()) return;
        const key = recentItemKey(item);
        update(current => [item, ...current.filter(entry => recentItemKey(entry) !== key)]);
    }, [update]);

    const forgetRecentItem = useCallback((key: string) => {
        update(current => current.filter(entry => recentItemKey(entry) !== key));
    }, [update]);

    const clearRecentItems = useCallback(() => update(() => []), [update]);

    return { recentItems, rememberRecentItem, forgetRecentItem, clearRecentItems };
}
