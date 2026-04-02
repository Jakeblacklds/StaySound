import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { FileSystemStorage } from '../services/storage';
import {
    claimSessionLock,
    getCurrentUser,
    heartbeatSessionLock,
    isEmailAllowed,
    refreshSession,
    releaseSessionLock,
    sendLoginOtp,
    signInWithPassword,
    signOutRemote,
    verifyLoginOtp,
} from '../services/supabaseAuthService';
import { AuthSession, AuthStatus } from '../types/auth';

interface AuthState {
    status: AuthStatus;
    session: AuthSession | null;
    pendingEmail: string;
    hasSessionLock: boolean;
    lockMessage: string | null;
    isSendingCode: boolean;
    isVerifyingCode: boolean;
    isSigningInWithPassword: boolean;
    _hasHydrated: boolean;
}

interface AuthActions {
    bootstrap: () => Promise<void>;
    requestOtp: (email: string) => Promise<void>;
    verifyOtpCode: (email: string, code: string, force?: boolean) => Promise<void>;
    loginWithPassword: (email: string, password: string, force?: boolean) => Promise<void>;
    acquireLock: (force?: boolean) => Promise<boolean>;
    heartbeat: () => Promise<void>;
    signOut: () => Promise<void>;
    clearPendingEmail: () => void;
    setHasHydrated: (hasHydrated: boolean) => void;
}

export type AuthStore = AuthState & AuthActions;

const initialState: AuthState = {
    status: 'idle',
    session: null,
    pendingEmail: '',
    hasSessionLock: false,
    lockMessage: null,
    isSendingCode: false,
    isVerifyingCode: false,
    isSigningInWithPassword: false,
    _hasHydrated: false,
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? '');
}

function isTransientAuthError(error: unknown): boolean {
    const message = getErrorMessage(error).toLowerCase();

    return (
        message.includes('network request failed') ||
        message.includes('failed to fetch') ||
        message.includes('networkerror') ||
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('socket') ||
        message.includes('econn') ||
        message.includes('enotfound') ||
        message.includes('503') ||
        message.includes('502') ||
        message.includes('500') ||
        message.includes('504') ||
        message.includes('http 500') ||
        message.includes('http 502') ||
        message.includes('http 503') ||
        message.includes('http 504')
    );
}

function isInvalidSessionError(error: unknown): boolean {
    const message = getErrorMessage(error).toLowerCase();

    return (
        message.includes('invalid refresh token') ||
        message.includes('refresh token not found') ||
        message.includes('refresh token has been revoked') ||
        message.includes('jwt expired') ||
        message.includes('invalid jwt') ||
        message.includes('session expired') ||
        message.includes('user from sub claim in JWT does not exist'.toLowerCase()) ||
        message.includes('http 401') ||
        message.includes('http 403')
    );
}

async function assertAllowedEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
        throw new Error('Escribe el correo autorizado para continuar.');
    }

    const allowed = await isEmailAllowed(normalizedEmail);
    if (!allowed) {
        throw new Error('Ese correo no tiene acceso a esta app.');
    }

    return normalizedEmail;
}

async function finalizeAuthenticatedSession(
    set: (partial: Partial<AuthStore>) => void,
    get: () => AuthStore,
    session: AuthSession,
    force: boolean
) {
    set({
        session,
        status: 'authenticated',
        pendingEmail: session.email,
        lockMessage: null,
    });

    const acquired = await get().acquireLock(force);
    if (!acquired) {
        set({
            session: null,
            status: 'unauthenticated',
            hasSessionLock: false,
        });
        throw new Error(get().lockMessage || 'La cuenta ya esta en uso en otro dispositivo.');
    }
}

export const useAuthStore = create<AuthStore>()(
    persist(
        (set, get) => ({
            ...initialState,

            bootstrap: async () => {
                const { session } = get();
                if (!session?.refreshToken) {
                    set({ status: 'unauthenticated', hasSessionLock: false, lockMessage: null });
                    return;
                }

                set({ status: 'loading' });

                try {
                    const nextSession = session.expiresAt <= Date.now() + 60_000
                        ? await refreshSession(session.refreshToken)
                        : session;

                    const user = await getCurrentUser(nextSession.accessToken);
                    const normalizedEmail = user.email || nextSession.email;
                    await assertAllowedEmail(normalizedEmail);

                    const normalizedSession: AuthSession = {
                        ...nextSession,
                        userId: user.id,
                        email: normalizedEmail,
                    };

                    set({
                        session: normalizedSession,
                        status: 'authenticated',
                        lockMessage: null,
                        pendingEmail: normalizedEmail,
                    });

                    const acquired = await get().acquireLock(false);
                    if (!acquired) {
                        set({
                            session: null,
                            status: 'unauthenticated',
                            hasSessionLock: false,
                        });
                    }
                } catch (error) {
                    console.warn('[AuthStore] bootstrap failed:', error);
                    if (session && isTransientAuthError(error) && !isInvalidSessionError(error)) {
                        set({
                            session,
                            status: 'authenticated',
                            hasSessionLock: false,
                            pendingEmail: session.email,
                            lockMessage: null,
                        });
                        return;
                    }

                    set({
                        session: null,
                        status: 'unauthenticated',
                        hasSessionLock: false,
                        lockMessage: error instanceof Error ? error.message : null,
                    });
                }
            },

            requestOtp: async (email: string) => {
                set({ isSendingCode: true, lockMessage: null });
                try {
                    const normalizedEmail = await assertAllowedEmail(email);
                    await sendLoginOtp(normalizedEmail);
                    set({ pendingEmail: normalizedEmail, status: 'unauthenticated' });
                } finally {
                    set({ isSendingCode: false });
                }
            },

            verifyOtpCode: async (email: string, code: string, force = false) => {
                const normalizedCode = code.trim();
                if (!normalizedCode) {
                    throw new Error('Completa el correo y el codigo de acceso.');
                }

                set({ isVerifyingCode: true, lockMessage: null });
                try {
                    const normalizedEmail = await assertAllowedEmail(email);
                    const session = await verifyLoginOtp(normalizedEmail, normalizedCode);
                    await finalizeAuthenticatedSession(set, get, session, force);
                } catch (error) {
                    if (error instanceof Error) {
                        set({ lockMessage: error.message });
                    }
                    throw error;
                } finally {
                    set({ isVerifyingCode: false });
                }
            },

            loginWithPassword: async (email: string, password: string, force = false) => {
                const normalizedPassword = password.trim();
                if (!normalizedPassword) {
                    throw new Error('Escribe la contrasena para continuar.');
                }

                set({ isSigningInWithPassword: true, lockMessage: null });
                try {
                    const normalizedEmail = await assertAllowedEmail(email);
                    const session = await signInWithPassword(normalizedEmail, normalizedPassword);
                    await finalizeAuthenticatedSession(set, get, session, force);
                } catch (error) {
                    if (error instanceof Error) {
                        set({ lockMessage: error.message });
                    }
                    throw error;
                } finally {
                    set({ isSigningInWithPassword: false });
                }
            },

            acquireLock: async (force = false) => {
                const { session } = get();
                if (!session) return false;

                let result;
                try {
                    result = await claimSessionLock(session.accessToken, force);
                } catch (error) {
                    if (isTransientAuthError(error) && !isInvalidSessionError(error)) {
                        set({
                            hasSessionLock: false,
                            lockMessage: null,
                        });
                        return true;
                    }

                    throw error;
                }

                if (!result.acquired) {
                    set({
                        hasSessionLock: false,
                        lockMessage: result.activeDeviceName
                            ? `La cuenta ya esta activa en ${result.activeDeviceName}.`
                            : 'La cuenta ya esta siendo usada en otro dispositivo.',
                    });
                    return false;
                }

                set({ hasSessionLock: true, lockMessage: null });
                return true;
            },

            heartbeat: async () => {
                const { session, hasSessionLock, status } = get();
                if (!session || !hasSessionLock || status !== 'authenticated') return;

                try {
                    const stillAllowed = await isEmailAllowed(session.email);
                    if (!stillAllowed) {
                        await get().signOut();
                        return;
                    }

                    await heartbeatSessionLock(session.accessToken);
                } catch (error) {
                    console.warn('[AuthStore] heartbeat failed:', error);
                }
            },

            signOut: async () => {
                const { session } = get();
                if (session) {
                    try {
                        await releaseSessionLock(session.accessToken);
                    } catch (error) {
                        console.warn('[AuthStore] release lock failed:', error);
                    }

                    try {
                        await signOutRemote(session.accessToken);
                    } catch (error) {
                        console.warn('[AuthStore] remote sign-out failed:', error);
                    }
                }

                set({
                    session: null,
                    status: 'unauthenticated',
                    hasSessionLock: false,
                    lockMessage: null,
                    pendingEmail: '',
                });
            },

            clearPendingEmail: () => {
                set({ pendingEmail: '' });
            },

            setHasHydrated: (hasHydrated: boolean) => {
                set({ _hasHydrated: hasHydrated });
            },
        }),
        {
            name: 'staysound-auth',
            storage: createJSONStorage(() => FileSystemStorage),
            partialize: (state: AuthStore) => ({
                session: state.session,
                pendingEmail: state.pendingEmail,
            } as Partial<AuthStore>),
            onRehydrateStorage: () => (state) => {
                state?.setHasHydrated(true);
            },
        }
    )
);
