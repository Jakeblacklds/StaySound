export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthSession {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    tokenType: string;
    userId: string;
    email: string;
}

export interface AuthUser {
    id: string;
    email: string;
}

export interface SessionLockResult {
    acquired: boolean;
    activeDeviceId?: string | null;
    activeDeviceName?: string | null;
    heartbeatAt?: string | null;
}
