import Constants from 'expo-constants';

function readExtraConfig() {
    return (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<string, any>;
}

export type MirrorCatalogConfig = {
    url: string;
    anonKey: string;
};

export function getMirrorCatalogConfig(): MirrorCatalogConfig {
    const extra = readExtraConfig();
    const raw = (extra.mirrorCatalog ?? {}) as Record<string, any>;

    return {
        url: typeof raw.url === 'string' ? raw.url.trim().replace(/\/+$/, '') : '',
        anonKey: typeof raw.anonKey === 'string' ? raw.anonKey.trim() : '',
    };
}

export function assertMirrorCatalogConfig(): MirrorCatalogConfig {
    const config = getMirrorCatalogConfig();
    if (!config.url || !config.anonKey) {
        throw new Error('Falta configurar EXPO_PUBLIC_MIRROR_SUPABASE_URL o EXPO_PUBLIC_MIRROR_SUPABASE_ANON_KEY.');
    }

    return config;
}
