import { getPrimaryMirrorOptions } from '@/src/features/tidal/model/tidalScreenUtils';
import {
    getTidalMirrorAvailability,
    getTidalMirrorOptions,
    TIDAL_API_BASES,
    type TidalMirrorAvailability,
} from '@/src/services/tidalService';
import { useCallback, useEffect, useMemo, useState } from 'react';

export type TidalSearchHealth = { tone: 'error' | 'warning' } | null;

export function useTidalMirrorHealth(selectedMirror: string, refreshWhenVisible: boolean) {
    const [availability, setAvailability] = useState<Record<string, TidalMirrorAvailability>>({});
    const [availableMirrors, setAvailableMirrors] = useState<string[]>(() => (
        [...TIDAL_API_BASES].filter((mirror, index, all) => all.indexOf(mirror) === index)
    ));

    const recommendedMirrors = useMemo(
        () => getPrimaryMirrorOptions(availableMirrors),
        [availableMirrors],
    );

    const legacyMirrors = useMemo(
        () => availableMirrors.filter(mirror => !recommendedMirrors.includes(mirror)),
        [availableMirrors, recommendedMirrors],
    );

    const activeAvailability = useMemo(() => {
        if (selectedMirror !== 'auto') {
            return availability[selectedMirror];
        }

        const known = availableMirrors
            .map(mirror => availability[mirror])
            .filter((entry): entry is TidalMirrorAvailability => Boolean(entry));

        if (known.length === 0) return undefined;

        return known.find(entry => (
            entry.status === 'available'
            && entry.supportsSearch
            && entry.supportsStream
        ))
            ?? known.find(entry => entry.status === 'slow' && entry.supportsSearch)
            ?? known[0];
    }, [availability, availableMirrors, selectedMirror]);

    const searchHealth = useMemo<TidalSearchHealth>(() => {
        if (!activeAvailability) return null;

        if (activeAvailability.status === 'unavailable' || !activeAvailability.supportsSearch) {
            return { tone: 'error' };
        }

        if (activeAvailability.status === 'slow') {
            return { tone: 'warning' };
        }

        return null;
    }, [activeAvailability]);

    const refresh = useCallback(async (force = false) => {
        const nextMirrors = await getTidalMirrorOptions({ force });
        setAvailableMirrors(nextMirrors);
        setAvailability(await getTidalMirrorAvailability(nextMirrors, { force }));
    }, []);

    useEffect(() => {
        void refresh(false);
    }, [refresh]);

    useEffect(() => {
        if (refreshWhenVisible) {
            void refresh(true);
        }
    }, [refresh, refreshWhenVisible]);

    return {
        availability,
        recommendedMirrors,
        legacyMirrors,
        searchHealth,
        refresh,
    };
}
