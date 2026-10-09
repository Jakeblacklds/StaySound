import { useTidalDownload } from '@/src/hooks/useTidalDownload';
import { hasPermissions, requestPermissions } from '@/src/services/fileScanner';
import {
    getSoulseekCredentials, searchSoulseekTracksByQuery, setSoulseekCredentials, type SoulseekSearchResult,
} from '@/src/services/soulseekDownloadService';
import { useLibraryStore, useSettingsStore } from '@/src/stores';
import { useOnboardingStore } from '@/src/stores/onboardingStore';
import { useTheme } from '@/src/theme';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Action = { action: string; id: number; payload: string; snapshot: string };
type Reply = { sequence: number; id: number; action: string; data: unknown };
interface NativeProps extends ViewProps {
    initialState: string; replies: string; appearance: Record<string, string>;
    logo: string; topInset: number; bottomInset: number;
    onAction: (event: NativeSyntheticEvent<Action>) => void;
}
export const hasNativeOnboarding = Platform.OS === 'android'
    && requireOptionalNativeModule('StaySoundOnboardingView') !== null;
const NativeView = hasNativeOnboarding ? requireNativeViewManager<NativeProps>('StaySoundOnboardingView') : null;

const TRIAL_RESULTS = 6;

function describeMatch({ match }: SoulseekSearchResult): string {
    const format = (match.format || match.extension || '').toUpperCase();
    const size = match.size ? `${Math.max(1, Math.round(match.size / (1024 * 1024)))} MB` : '';
    return [format, size].filter(Boolean).join(' · ');
}

/** Service boundary only: Kotlin owns the steps, drafts and validation (OnboardingMachine.kt).
 * The checkpoint lives only while this route is mounted, so a cold start begins at the welcome.
 */
export default function NativeOnboardingScreen() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const checkpoint = useRef('{}');
    const appearance = useMemo(() => Object.fromEntries(
        Object.entries(theme.colors).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ), [theme.colors]);
    const [replies, setReplies] = useState<Reply[]>([]);
    const sequence = useRef(0);
    const alive = useRef(true);
    const finishing = useRef(false);
    const completed = useRef(false);
    const finalized = useRef(false);
    // What the trial search offered; Kotlin only ever names a result by its id.
    const offered = useRef(new Map<string, SoulseekSearchResult>());
    const trial = useRef<{ event: Action; trackId: number } | null>(null);
    const { downloads, downloadFromSoulseekMatch } = useTidalDownload();

    const commitCompletion = useCallback(() => {
        if (completed.current) return;
        completed.current = true;
        useOnboardingStore.getState().completeOnboarding();
        // The native onboarding gate resumes the pending destination after store hydration.
    }, []);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            // Leaving the route does not cancel an already accepted finish.
            if (finalized.current) commitCompletion();
        };
    }, [commitCompletion]);
    const respond = useCallback((event: Action, data: unknown) => {
        if (!alive.current) return;
        const reply = { sequence: ++sequence.current, id: event.id, action: event.action, data };
        // Keep all replies until unmount: batched React updates must never drop a service completion.
        setReplies(previous => [...previous, reply]);
    }, []);

    // The download hook reports progress through its state; forward it to the step that asked.
    useEffect(() => {
        const active = trial.current;
        const state = active && downloads.get(active.trackId);
        if (active && state?.status === 'downloading') respond(active.event, { progress: Math.round(state.progress * 100) });
    }, [downloads, respond]);

    const onAction = useCallback(({ nativeEvent: event }: NativeSyntheticEvent<Action>) => {
        if (event.snapshot) checkpoint.current = event.snapshot;
        if (event.action === 'checkpoint') return;
        const payload = JSON.parse(event.payload || '{}');
        const run = async () => {
            switch (event.action) {
                case 'checkPermission': return { granted: await hasPermissions() };
                case 'permission': {
                    const granted = await requestPermissions();
                    respond(event, { granted });
                    // A failed scan is not the user's problem here; the library can be rescanned later.
                    if (granted) await useLibraryStore.getState().scanLibrary().catch(() => undefined);
                    return undefined;
                }
                case 'account': {
                    const saved = await getSoulseekCredentials().catch(() => null);
                    return { connected: Boolean(saved), username: saved?.username ?? '' };
                }
                case 'credentials': {
                    await setSoulseekCredentials(payload.username, payload.password);
                    return { saved: true };
                }
                case 'search': {
                    const found = await searchSoulseekTracksByQuery(payload.query, useSettingsStore.getState().tidalDownloadQuality);
                    offered.current = new Map(found.slice(0, TRIAL_RESULTS).map((result, index) => [`${index}:${result.track.id}`, result]));
                    return {
                        results: [...offered.current].map(([id, result]) => ({
                            id, title: result.track.title, artist: result.track.artist, detail: describeMatch(result),
                        })),
                    };
                }
                case 'download': {
                    const result = offered.current.get(payload.id);
                    if (!result) return { error: 'Ese resultado ya no está disponible. Busca de nuevo.' };
                    trial.current = { event, trackId: result.track.id };
                    try {
                        // The trial takes whatever format the person shares; quality is a setting for later.
                        await downloadFromSoulseekMatch(result.track, result.match, { allowCompressedFallback: true, force: true });
                        return { done: true };
                    } finally { trial.current = null; }
                }
                case 'finish': {
                    if (finishing.current || completed.current) return undefined;
                    finishing.current = true;
                    try {
                        const name = String(payload.name ?? '').trim();
                        if (name) useOnboardingStore.getState().setUserName(name);
                        finalized.current = true;
                        if (!alive.current) commitCompletion();
                        return { success: true };
                    } finally { finishing.current = false; }
                }
                case 'completed':
                    if (finalized.current) commitCompletion();
                    return undefined;
            }
            return undefined;
        };
        void run().then(data => { if (data !== undefined) respond(event, data); }).catch((error: unknown) => {
            // Every failure is answered: the machine never waits on a request that died here.
            const reason = (error as { message?: unknown } | null)?.message;
            const message = typeof reason === 'string' && reason ? reason : 'Algo falló. Inténtalo de nuevo.';
            respond(event, { error: message, success: false });
        });
    }, [commitCompletion, downloadFromSoulseekMatch, respond]);
    if (!NativeView) return null;
    return <NativeView style={{ flex: 1 }} initialState={checkpoint.current} replies={JSON.stringify(replies)}
        appearance={appearance} topInset={insets.top} bottomInset={insets.bottom}
        logo={Image.resolveAssetSource(require('@/assets/images/appicon.png')).uri}
        onAction={onAction} />;
}
