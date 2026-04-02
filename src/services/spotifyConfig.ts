import Constants from 'expo-constants';

function readExtraConfig() {
    return (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<string, any>;
}

export function getSpotifyConfig() {
    const extra = readExtraConfig();
    const spotify = (extra.spotify ?? {}) as Record<string, any>;

    return {
        clientId: typeof spotify.clientId === 'string' ? spotify.clientId.trim() : '',
        top50GlobalPlaylistId: typeof spotify.top50GlobalPlaylistId === 'string' && spotify.top50GlobalPlaylistId.trim()
            ? spotify.top50GlobalPlaylistId.trim()
            : '37i9dQZEVXbMDoHDwVN2tF',
    };
}

export function hasSpotifyConfig(): boolean {
    const config = getSpotifyConfig();
    return Boolean(config.clientId);
}

export function assertSpotifyConfig() {
    const config = getSpotifyConfig();
    if (!config.clientId) {
        throw new Error('Falta configurar EXPO_PUBLIC_SPOTIFY_CLIENT_ID.');
    }
    return config;
}
