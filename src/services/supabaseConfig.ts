import Constants from 'expo-constants';

function readExtraConfig() {
    return (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<string, any>;
}

function parseSupabaseConfig(rawConfig: Record<string, any>) {
    const supabase = rawConfig as Record<string, any>;
    const allowedEmailsRaw = typeof supabase.allowedEmails === 'string' ? supabase.allowedEmails : '';

    return {
        url: typeof supabase.url === 'string' ? supabase.url.trim() : '',
        anonKey: typeof supabase.anonKey === 'string' ? supabase.anonKey.trim() : '',
        allowedEmails: allowedEmailsRaw
            .split(',')
            .map(email => email.trim().toLowerCase())
            .filter(Boolean),
    };
}

export function getSupabaseConfig() {
    const extra = readExtraConfig();
    return parseSupabaseConfig((extra.supabase ?? {}) as Record<string, any>);
}

export function getAuthSupabaseConfig() {
    const extra = readExtraConfig();
    const authSupabase = (extra.authSupabase ?? extra.supabase ?? {}) as Record<string, any>;
    return parseSupabaseConfig(authSupabase);
}

export function assertSupabaseConfig() {
    const config = getSupabaseConfig();
    if (!config.url || !config.anonKey) {
        throw new Error('Falta configurar EXPO_PUBLIC_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_ANON_KEY.');
    }
    return config;
}

export function assertAuthSupabaseConfig() {
    const config = getAuthSupabaseConfig();
    if (!config.url || !config.anonKey) {
        throw new Error('Falta configurar EXPO_PUBLIC_AUTH_SUPABASE_URL o EXPO_PUBLIC_AUTH_SUPABASE_ANON_KEY.');
    }
    return config;
}
