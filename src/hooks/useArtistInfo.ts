import { ArtistInfo, getArtistInfo } from '@/src/services';
import { useEffect, useState } from 'react';

/**
 * Hook to fetch and manage artist information
 */
export function useArtistInfo(artistName: string | undefined) {
    const [info, setInfo] = useState<ArtistInfo | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let isMounted = true;

        const fetchInfo = async () => {
            if (!artistName || artistName === 'Unknown Artist') {
                setInfo(null);
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const result = await getArtistInfo(artistName);
                if (isMounted) {
                    setInfo(result);
                }
            } catch (err) {
                if (isMounted) {
                    setError(err instanceof Error ? err : new Error('Unknown error'));
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        fetchInfo();

        return () => {
            isMounted = false;
        };
    }, [artistName]);

    return { info, isLoading, error };
}
