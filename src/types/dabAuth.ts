export type DabAuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface DabAuthSession {
    email: string;
    username: string;
    sessionCookie: string;
}
