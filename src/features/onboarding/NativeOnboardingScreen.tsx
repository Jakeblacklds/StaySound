import { useDynamicColors } from '@/src/hooks/useDynamicColors';
import { useI18n } from '@/src/i18n';
import { hasPermissions, requestPermissions } from '@/src/services/fileScanner';
import { getTidalArtistInfo, searchTidalArtists } from '@/src/services/tidalService';
import { applyOnboardingMirrorPlaylist, buildOnboardingMirrorPlaylist, ONBOARDING_TASTE_PROFILE_VERSION } from '@/src/services/onboardingTasteService';
import { useLibraryStore } from '@/src/stores';
import { OnboardingTasteArtist, useOnboardingStore } from '@/src/stores/onboardingStore';
import { useTheme } from '@/src/theme';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildSeedPlaceholders, fetchQuickSuggestionArtwork, isBlockedTidalArtworkUrl, quickSuggestions } from './onboardingServices';

type Action = { action: string; id: number; payload: string; snapshot: string };
type Reply = { sequence: number; id: number; action: string; data: unknown };
interface NativeProps extends ViewProps {
    initialState: string; replies: string; appearance: Record<string, string>; labels: Record<string, string>;
    logo: string; topInset: number; bottomInset: number; lightweight: boolean;
    onAction: (event: NativeSyntheticEvent<Action>) => void;
}
export const hasNativeOnboarding = Platform.OS === 'android'
    && requireOptionalNativeModule('StaySoundOnboardingView') !== null;
const NativeView = hasNativeOnboarding ? requireNativeViewManager<NativeProps>('StaySoundOnboardingView') : null;

/** Service boundary only: Kotlin owns drafts, validation, steps, debounce and list selection.
 * No auth UI is mounted by the current route; authStore and the Router gate remain unchanged.
 * Draft checkpoints live only for this mounted route, matching the existing cold-start behavior.
 */
export default function NativeOnboardingScreen() {
    const { theme, config } = useTheme();
    const { t } = useI18n();
    const insets = useSafeAreaInsets();
    const checkpoint = useRef(JSON.stringify({ artists: useOnboardingStore.getState().tasteArtists }));
    const [avatar, setAvatar] = useState('');
    const { colors: dynamic } = useDynamicColors(avatar || undefined);
    const appearance = useMemo(() => {
        const palette = avatar
            ? { ...theme.colors, ...dynamic, onBackground: dynamic.text, onSurfaceVariant: dynamic.onSurface }
            : { ...theme.colors };
        return Object.fromEntries(Object.entries(palette).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    }, [avatar, dynamic, theme.colors]);
    const labels = useMemo(() => Object.fromEntries(([
        'title', 'subtitle', 'searchPlaceholder', 'resultsTitle', 'quickTitle', 'empty', 'loading', 'error', 'retry', 'skip', 'continue',
    ] as const).map(key => [key, t(`onboarding.tasteArtists.${key}`)]).concat([
        ['selectedCount', t('onboarding.tasteArtists.selectedCount', { count: '{count}', max: 8 })],
    ])), [t]);
    const [replies, setReplies] = useState<Reply[]>([]);
    const sequence = useRef(0);
    const alive = useRef(true);
    const finishing = useRef(false);
    const completed = useRef(false);
    const finalized = useRef(false);
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
            // Like the RN flow, leaving the route does not cancel an already accepted finish.
            if (finalized.current) commitCompletion();
        };
    }, [commitCompletion]);
    const respond = useCallback((event: Action, data: unknown) => {
        if (!alive.current) return;
        const reply = { sequence: ++sequence.current, id: event.id, action: event.action, data };
        // Keep all replies until unmount: batched React updates must never drop a service completion.
        setReplies(previous => [...previous, reply]);
    }, []);
    const onAction = useCallback(({ nativeEvent: event }: NativeSyntheticEvent<Action>) => {
        if (event.snapshot) checkpoint.current = event.snapshot;
        if (event.action === 'checkpoint') return;
        const payload = JSON.parse(event.payload || '{}');
        const run = async () => {
            switch (event.action) {
                case 'search': return { artists: (await searchTidalArtists(payload.query)).slice(0, 24) };
                case 'quick': {
                    respond(event, { artists: buildSeedPlaceholders(payload.artists), loading: true });
                    const suggestions = await quickSuggestions(payload.artists);
                    return { artists: suggestions.length ? suggestions : buildSeedPlaceholders(payload.artists), loading: false };
                }
                case 'seed': {
                    const results = await searchTidalArtists(payload.name);
                    const artist = results.find(a => a.name.toLowerCase() === payload.name.toLowerCase()) ?? results[0];
                    return { artist: artist ?? null };
                }
                case 'artwork': {
                    let artwork: string | undefined;
                    try {
                        artwork = (await getTidalArtistInfo(payload.id)).artworkUrl;
                        if (!artwork || artwork.includes('00000000') || !artwork.includes('http') || isBlockedTidalArtworkUrl(artwork)) {
                            artwork = await fetchQuickSuggestionArtwork(payload.name) || artwork;
                        }
                    } catch { artwork = await fetchQuickSuggestionArtwork(payload.name) || undefined; }
                    return { id: payload.id, artworkUrl: artwork || '' };
                }
                case 'avatar': {
                    const permission = payload.camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (permission.status !== 'granted') return {};
                    const options = { allowsEditing: true, aspect: [1, 1] as [number, number], quality: 0.9 };
                    const result = payload.camera ? await ImagePicker.launchCameraAsync(options)
                        : await ImagePicker.launchImageLibraryAsync({ ...options, mediaTypes: ['images'] });
                    const uri = !result.canceled && result.assets[0]?.uri;
                    if (uri) setAvatar(uri);
                    return uri ? { uri } : {};
                }
                case 'checkPermission': return { granted: await hasPermissions() };
                case 'permission': {
                    const granted = await requestPermissions();
                    respond(event, { granted });
                    if (granted) await useLibraryStore.getState().scanLibrary();
                    return { granted };
                }
                case 'finish': {
                    if (finishing.current || completed.current) return;
                    finishing.current = true;
                    try {
                        const store = useOnboardingStore.getState();
                        if (payload.name.trim()) store.setUserName(payload.name.trim());
                        if (payload.avatarUri) store.setUserAvatarUri(payload.avatarUri);
                        store.setTasteProfileVersion(ONBOARDING_TASTE_PROFILE_VERSION);
                        const artists: OnboardingTasteArtist[] = payload.artists;
                        store.setTasteArtists(artists);
                        store.setTasteTrackIds([]);
                        if (artists.length >= 3) {
                            store.setTastePlaylistStatus('pending');
                            try {
                                applyOnboardingMirrorPlaylist(await buildOnboardingMirrorPlaylist({ artists }));
                                store.markTastePlaylistGenerated(Date.now());
                            } catch { store.setTastePlaylistStatus('failed'); }
                        } else store.setTastePlaylistStatus('idle');
                        finalized.current = true;
                        if (!alive.current) commitCompletion();
                        return { success: true };
                    } finally { finishing.current = false; }
                }
                case 'completed':
                    if (finalized.current) commitCompletion();
                    return;
            }
        };
        void run().then(data => { if (data !== undefined) respond(event, data); }).catch(() => {
            // Permission/scan denial is silent in the existing flow and must never gate Continue.
            respond(event, { error: ['search', 'seed', 'quick'].includes(event.action) ? t('onboarding.tasteArtists.error') : '', success: false });
        });
    }, [commitCompletion, respond, t]);
    if (!NativeView) return null;
    return <NativeView style={{ flex: 1 }} initialState={checkpoint.current} replies={JSON.stringify(replies)}
        appearance={appearance} labels={labels} topInset={insets.top} bottomInset={insets.bottom}
        lightweight={config.lightweightMode} logo={Image.resolveAssetSource(require('@/assets/images/appicon.png')).uri}
        onAction={onAction} />;
}
