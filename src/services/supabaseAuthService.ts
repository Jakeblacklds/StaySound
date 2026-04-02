import { Platform } from 'react-native';
import { FileSystemStorage } from './storage';
import { assertAuthSupabaseConfig } from './supabaseConfig';
import { AuthSession, AuthUser, SessionLockResult } from '../types/auth';

const DEVICE_ID_STORAGE_KEY = 'staysound-device-id';
const SESSION_LOCK_TIMEOUT_SECONDS = 75;

type AuthApiResponse = {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    user: {
        id: string;
        email?: string;
    };
};

function buildUrl(path: string): string {
    const { url } = assertAuthSupabaseConfig();
    return `${url}${path}`;
}

function createHeaders(accessToken?: string): HeadersInit {
    const { anonKey } = assertAuthSupabaseConfig();
    return {
        apikey: anonKey,
        Authorization: accessToken ? `Bearer ${accessToken}` : `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
    };
}

function normalizeSession(payload: AuthApiResponse): AuthSession {
    return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        expiresAt: Date.now() + (payload.expires_in * 1000),
        tokenType: payload.token_type,
        userId: payload.user.id,
        email: payload.user.email?.toLowerCase() ?? '',
    };
}

async function parseError(response: Response) {
    try {
        const data = await response.json();
        return data?.msg || data?.message || data?.error_description || data?.error || `HTTP ${response.status}`;
    } catch {
        return `HTTP ${response.status}`;
    }
}

async function callRpc(path: string, body: Record<string, unknown>, accessToken?: string): Promise<any> {
    const response = await fetch(buildUrl(path), {
        method: 'POST',
        headers: createHeaders(accessToken),
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(await parseError(response));
    }

    if (response.status === 204) {
        return null;
    }

    const raw = await response.text();
    if (!raw.trim()) {
        return null;
    }

    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

async function callAuth(path: string, body: Record<string, unknown>): Promise<AuthApiResponse> {
    const response = await fetch(buildUrl(path), {
        method: 'POST',
        headers: createHeaders(),
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(await parseError(response));
    }

    return await response.json() as AuthApiResponse;
}

function createDeviceId(): string {
    return `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeAllowedEmailResult(payload: any): boolean {
    if (typeof payload === 'boolean') return payload;
    if (Array.isArray(payload) && typeof payload[0] === 'boolean') return payload[0];
    if (payload && typeof payload.allowed === 'boolean') return payload.allowed;
    return false;
}

export async function getDeviceId(): Promise<string> {
    const existing = await FileSystemStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const next = createDeviceId();
    await FileSystemStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
    return next;
}

export async function isEmailAllowed(email: string): Promise<boolean> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return false;

    const payload = await callRpc('/rest/v1/rpc/is_email_allowed', {
        p_email: normalizedEmail,
    });

    return normalizeAllowedEmailResult(payload);
}

export async function sendLoginOtp(email: string): Promise<void> {
    void email;
    throw new Error('El acceso por codigo no esta disponible en esta version.');
}

export async function verifyLoginOtp(email: string, token: string): Promise<AuthSession> {
    void email;
    void token;
    throw new Error('El acceso por codigo no esta disponible en esta version.');
}

export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
    const payload = await callAuth('/auth/v1/token?grant_type=password', {
        email,
        password,
    });

    return normalizeSession(payload);
}

export async function refreshSession(refreshToken: string): Promise<AuthSession> {
    const payload = await callAuth('/auth/v1/token?grant_type=refresh_token', {
        refresh_token: refreshToken,
    });

    return normalizeSession(payload);
}

export async function getCurrentUser(accessToken: string): Promise<AuthUser> {
    const response = await fetch(buildUrl('/auth/v1/user'), {
        method: 'GET',
        headers: createHeaders(accessToken),
    });

    if (!response.ok) {
        throw new Error(await parseError(response));
    }

    const payload = await response.json() as { id: string; email?: string };
    return {
        id: payload.id,
        email: payload.email?.toLowerCase() ?? '',
    };
}

export async function signOutRemote(accessToken: string): Promise<void> {
    const response = await fetch(buildUrl('/auth/v1/logout'), {
        method: 'POST',
        headers: createHeaders(accessToken),
    });

    if (!response.ok && response.status !== 401) {
        throw new Error(await parseError(response));
    }
}

function normalizeLockResult(payload: any): SessionLockResult {
    const row = Array.isArray(payload) ? payload[0] : payload;
    return {
        acquired: !!row?.acquired,
        activeDeviceId: row?.active_device_id ?? null,
        activeDeviceName: row?.active_device_name ?? null,
        heartbeatAt: row?.heartbeat_at ?? null,
    };
}

export async function claimSessionLock(accessToken: string, force = false): Promise<SessionLockResult> {
    const deviceId = await getDeviceId();
    const deviceName = `${Platform.OS}-${Platform.Version}`;
    const payload = await callRpc('/rest/v1/rpc/claim_active_session', {
        p_device_id: deviceId,
        p_device_name: deviceName,
        p_timeout_seconds: SESSION_LOCK_TIMEOUT_SECONDS,
        p_force: force,
    }, accessToken);

    return normalizeLockResult(payload);
}

export async function heartbeatSessionLock(accessToken: string): Promise<void> {
    const deviceId = await getDeviceId();
    await callRpc('/rest/v1/rpc/heartbeat_active_session', {
        p_device_id: deviceId,
    }, accessToken);
}

export async function releaseSessionLock(accessToken: string): Promise<void> {
    const deviceId = await getDeviceId();
    await callRpc('/rest/v1/rpc/release_active_session', {
        p_device_id: deviceId,
    }, accessToken);
}
