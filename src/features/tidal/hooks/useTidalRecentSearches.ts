import { FileSystemStorage } from '@/src/services/storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'tidal-recent-searches';
const MAX_RECENT_SEARCHES = 8;

function sanitizeRecentSearches(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.trim())
        .filter(Boolean)
        .slice(0, MAX_RECENT_SEARCHES);
}

export function useTidalRecentSearches() {
    const [recentSearches, setRecentSearches] = useState<string[]>([]);

    useEffect(() => {
        let cancelled = false;

        void FileSystemStorage.getItem(STORAGE_KEY)
            .then(raw => {
                if (!raw || cancelled) return;

                try {
                    const savedSearches = sanitizeRecentSearches(JSON.parse(raw));
                    if (!cancelled) setRecentSearches(savedSearches);
                } catch {
                    // Invalid history is ignored and replaced on the next search.
                }
            })
            .catch(() => {
                // Search history is optional; storage failures do not block discovery.
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const rememberRecentSearch = useCallback((query: string) => {
        const trimmed = query.trim();
        if (!trimmed) return;

        setRecentSearches(current => {
            const next = [
                trimmed,
                ...current.filter(entry => entry.toLowerCase() !== trimmed.toLowerCase()),
            ].slice(0, MAX_RECENT_SEARCHES);

            void FileSystemStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    }, []);

    return { recentSearches, rememberRecentSearch };
}
