import Constants from 'expo-constants';
import { useSettingsStore } from '../stores/settingsStore';
import { DabAuthSession } from '../types/dabAuth';

const DAB_DEFAULT_BASE_URL = 'https://dabmusic.xyz';
const DAB_BETA_BASE_URL = 'https://beta.dabmusic.xyz';

function readExtraConfig() {
    return (Constants.expoConfig?.extra ?? Constants.manifest2?.extra ?? {}) as Record<string, any>;
}

function normalizeBaseUrl(url: string): string {
    const trimmed = url.trim().replace(/\/+$/, '');
    return trimmed.endsWith('/api') ? trimmed.slice(0, -4) : trimmed;
}

export function isDabBaseUrl(url: string): boolean {
    const normalized = normalizeBaseUrl(url);
    return normalized === DAB_DEFAULT_BASE_URL || normalized === DAB_BETA_BASE_URL;
}

function getConfiguredDabBaseUrl(): string {
    const extra = readExtraConfig();
    const raw = (extra.dabBeta ?? {}) as Record<string, any>;
    return typeof raw.baseUrl === 'string' && raw.baseUrl.trim()
        ? normalizeBaseUrl(raw.baseUrl)
        : DAB_DEFAULT_BASE_URL;
}

export function getDabBaseUrl(): string {
    const { tidalMirror } = useSettingsStore.getState();
    if (tidalMirror && tidalMirror !== 'auto' && isDabBaseUrl(tidalMirror)) {
        return normalizeBaseUrl(tidalMirror);
    }

    return getConfiguredDabBaseUrl();
}

export function getDabCandidateBaseUrls(): string[] {
    const preferred = getDabBaseUrl();
    return [preferred, DAB_DEFAULT_BASE_URL, DAB_BETA_BASE_URL]
        .map(normalizeBaseUrl)
        .filter((value, index, all) => all.indexOf(value) === index);
}

export function hydrateDabSession(_session: DabAuthSession | null) {
}

export function clearDabSessionCache() {
}

async function parseError(response: Response) {
    try {
        const data = await response.json() as { error?: string; message?: string };
        return data.error || data.message || `HTTP ${response.status}`;
    } catch {
        return `HTTP ${response.status}`;
    }
}

function extractSessionFromCookieValue(cookieValue: string): string {
    const match = cookieValue.match(/(?:^|[;,]\s*)session=([^;,\s]+)/i);
    return match?.[1]?.trim() ?? '';
}

function extractSessionFromHeaders(headers: Headers): string {
    const candidates = new Set<string>();
    const direct = headers.get('set-cookie') ?? headers.get('Set-Cookie');
    if (direct) candidates.add(direct);

    const rawHeaders = headers as Headers & {
        map?: Record<string, string | string[]>;
        getSetCookie?: () => string[];
        toJSON?: () => Record<string, string | string[]>;
    };

    const rawMap = rawHeaders.map ?? rawHeaders.toJSON?.();
    if (rawMap) {
        for (const [key, value] of Object.entries(rawMap)) {
            if (key.toLowerCase() !== 'set-cookie') continue;
            if (Array.isArray(value)) {
                value.forEach(entry => candidates.add(entry));
            } else if (typeof value === 'string') {
                candidates.add(value);
            }
        }
    }

    rawHeaders.getSetCookie?.().forEach(entry => candidates.add(entry));

    for (const candidate of candidates) {
        const session = extractSessionFromCookieValue(candidate);
        if (session) return session;
    }

    return '';
}

async function authRequest(path: string, init?: RequestInit): Promise<Response> {
    return await fetch(`${getDabBaseUrl()}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
        },
    });
}

function getUsernameFromEmail(email: string): string {
    return email.split('@')[0]?.trim() || 'dab-user';
}

async function finalizeSession(email: string, username: string, response: Response): Promise<DabAuthSession> {
    if (!response.ok) {
        throw new Error(await parseError(response));
    }

    const sessionCookie = extractSessionFromHeaders(response.headers);
    if (!sessionCookie) {
        throw new Error('DAB inicio sesion pero no devolvio la cookie de sesion.');
    }

    const session: DabAuthSession = {
        email: email.trim().toLowerCase(),
        username: username.trim() || getUsernameFromEmail(email),
        sessionCookie,
    };

    hydrateDabSession(session);
    return session;
}

export async function loginDabAccount(email: string, password: string, usernameHint?: string): Promise<DabAuthSession> {
    const response = await authRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password,
        }),
    });

    return await finalizeSession(email, usernameHint || getUsernameFromEmail(email), response);
}

export async function registerDabAccount(username: string, email: string, password: string): Promise<DabAuthSession> {
    const normalizedUsername = username.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();

    const registerResponse = await authRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            username: normalizedUsername,
            email: normalizedEmail,
            password: normalizedPassword,
        }),
    });

    if (!registerResponse.ok) {
        throw new Error(await parseError(registerResponse));
    }

    return await loginDabAccount(normalizedEmail, normalizedPassword, normalizedUsername);
}

export async function validateDabSession(session: DabAuthSession): Promise<DabAuthSession> {
    hydrateDabSession(session);

    const response = await fetch(`${getDabBaseUrl()}/api/featured-albums?type=new-releases&offset=0&limit=1`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            Cookie: `session=${session.sessionCookie}`,
        },
    });

    if (!response.ok) {
        clearDabSessionCache();
        throw new Error(await parseError(response));
    }

    return {
        ...session,
        email: session.email.trim().toLowerCase(),
        username: session.username.trim() || getUsernameFromEmail(session.email),
        sessionCookie: session.sessionCookie.trim(),
    };
}
