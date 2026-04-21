import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { FileSystemStorage } from '../services/storage';
import {
    authenticateDabAccount,
    clearDabSessionCache,
    hydrateDabSession,
    loginDabAccount,
    registerDabAccount,
    validateDabSession,
} from '../services/dabAuthService';
import { DabAuthSession, DabAuthStatus } from '../types/dabAuth';

interface DabAuthState {
    status: DabAuthStatus;
    session: DabAuthSession | null;
    isLoggingIn: boolean;
    isRegistering: boolean;
    _hasHydrated: boolean;
}

interface DabAuthActions {
    bootstrap: () => Promise<void>;
    authenticate: (email: string, password: string, usernameHint?: string) => Promise<void>;
    login: (email: string, password: string) => Promise<void>;
    register: (username: string, email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    setHasHydrated: (hasHydrated: boolean) => void;
}

export type DabAuthStore = DabAuthState & DabAuthActions;

const initialState: DabAuthState = {
    status: 'idle',
    session: null,
    isLoggingIn: false,
    isRegistering: false,
    _hasHydrated: false,
};

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export const useDabAuthStore = create<DabAuthStore>()(
    persist(
        (set, get) => ({
            ...initialState,

            bootstrap: async () => {
                const { session } = get();
                if (!session?.sessionCookie) {
                    clearDabSessionCache();
                    set({ status: 'unauthenticated', session: null });
                    return;
                }

                set({ status: 'loading' });

                try {
                    const validatedSession = await validateDabSession(session);
                    hydrateDabSession(validatedSession);
                    set({
                        status: 'authenticated',
                        session: validatedSession,
                    });
                } catch (error) {
                    console.warn('[DabAuthStore] bootstrap failed:', error);
                    clearDabSessionCache();
                    set({
                        status: 'unauthenticated',
                        session: null,
                    });
                }
            },

            authenticate: async (email: string, password: string, usernameHint?: string) => {
                const normalizedEmail = normalizeEmail(email);
                const normalizedPassword = password.trim();
                const normalizedUsernameHint = usernameHint?.trim();

                if (!normalizedEmail || !normalizedPassword) {
                    throw new Error('Escribe correo y contrasena para continuar.');
                }

                set({ isLoggingIn: true });
                try {
                    const session = await authenticateDabAccount(
                        normalizedEmail,
                        normalizedPassword,
                        normalizedUsernameHint,
                    );
                    set({
                        session,
                        status: 'authenticated',
                    });
                } finally {
                    set({ isLoggingIn: false });
                }
            },

            login: async (email: string, password: string) => {
                const normalizedEmail = normalizeEmail(email);
                const normalizedPassword = password.trim();
                if (!normalizedEmail || !normalizedPassword) {
                    throw new Error('Escribe correo y contrasena para continuar.');
                }

                set({ isLoggingIn: true });
                try {
                    const session = await loginDabAccount(normalizedEmail, normalizedPassword);
                    set({
                        session,
                        status: 'authenticated',
                    });
                } finally {
                    set({ isLoggingIn: false });
                }
            },

            register: async (username: string, email: string, password: string) => {
                const normalizedUsername = username.trim();
                const normalizedEmail = normalizeEmail(email);
                const normalizedPassword = password.trim();

                if (!normalizedUsername || !normalizedEmail || !normalizedPassword) {
                    throw new Error('Completa usuario, correo y contrasena para crear la cuenta.');
                }

                set({ isRegistering: true });
                try {
                    const session = await registerDabAccount(
                        normalizedUsername,
                        normalizedEmail,
                        normalizedPassword,
                    );
                    set({
                        session,
                        status: 'authenticated',
                    });
                } finally {
                    set({ isRegistering: false });
                }
            },

            signOut: async () => {
                clearDabSessionCache();
                set({
                    session: null,
                    status: 'unauthenticated',
                });
            },

            setHasHydrated: (hasHydrated: boolean) => {
                set({ _hasHydrated: hasHydrated });
            },
        }),
        {
            name: 'staysound-dab-auth',
            storage: createJSONStorage(() => FileSystemStorage),
            partialize: (state: DabAuthStore) => ({
                session: state.session,
            } as Partial<DabAuthStore>),
            onRehydrateStorage: () => (state) => {
                if (state?.session) {
                    hydrateDabSession(state.session);
                } else {
                    clearDabSessionCache();
                }
                state?.setHasHydrated(true);
            },
        },
    ),
);
