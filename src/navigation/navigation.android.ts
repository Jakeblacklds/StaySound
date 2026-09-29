import { requireNativeModule } from 'expo-modules-core';
import React, { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

export type RouteEntry = { key: string; path: string; arguments: Record<string, string> };
export type NavigationSnapshot = {
    entries: RouteEntry[]; current: RouteEntry; contentKey: string; activeTab: string;
    canGoBack: boolean; showBar: boolean; onboardingRequired: boolean;
};
const native = requireNativeModule('StaySoundNavigation');
const listeners = new Set<() => void>();
let snapshot: NavigationSnapshot | null = null;
export function receiveNavigationSnapshot(value: NavigationSnapshot) {
    snapshot = value;
    listeners.forEach(listener => listener());
}
export function useNavigationSnapshot() {
    return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => snapshot, () => snapshot);
}
export const RouteContext = createContext<{ entry: RouteEntry; focused: boolean } | null>(null);
type Href = string | { pathname: string; params?: Record<string, unknown> };
function url(href: Href) {
    if (typeof href === 'string') return href;
    let path = href.pathname;
    const query: string[] = [];
    for (const [key, value] of Object.entries(href.params ?? {})) {
        if (value == null) continue;
        if (path.includes(`[${key}]`)) path = path.replace(`[${key}]`, encodeURIComponent(String(value)));
        else query.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    return path + (query.length ? `?${query.join('&')}` : '');
}
export const router = {
    push: (href: Href) => { void native.navigate(url(href), 'push'); },
    replace: (href: Href) => { void native.navigate(url(href), 'replace'); },
    navigate: (href: Href) => { void native.navigate(url(href), 'navigate'); },
    back: () => { void native.back(); },
    canGoBack: () => snapshot?.canGoBack ?? false,
};
export const setNativePlayerVisible = (visible: boolean) => { void native.player(visible); };
export const requestNavigationSnapshot = () => { void native.snapshot(); };
export const useRouter = () => router;
export function usePathname() {
    const state = useNavigationSnapshot();
    const entry = state?.current;
    return entry?.path.replace('[id]', encodeURIComponent(entry.arguments.id ?? '')) ?? '/';
}
export function useContentPathname() {
    const state = useNavigationSnapshot();
    const entry = state?.entries.find(route => route.key === state.contentKey);
    return entry?.path.replace('[id]', encodeURIComponent(entry.arguments.id ?? '')) ?? '/';
}
export function useLocalSearchParams<T = Record<string, string>>(): T {
    return (useContext(RouteContext)?.entry.arguments ?? {}) as T;
}
export function useIsFocused() { return useContext(RouteContext)?.focused ?? true; }
export function useFocusEffect(effect: React.EffectCallback) {
    const focused = useIsFocused();
    useEffect(() => { if (focused) return effect(); }, [focused, effect]);
}
export function useRootNavigationState() {
    const state = useNavigationSnapshot();
    return state ? { key: 'staysound-native' } : undefined;
}
// Existing Tidal controllers also render on iOS. Android chrome belongs to Kotlin.
export const Stack = { Screen: (_props: { options?: unknown }) => null };
