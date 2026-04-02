import { useDynamicColors } from '@/src/hooks/useDynamicColors';
import { useI18n } from '@/src/i18n';
import {
    applyOnboardingMirrorPlaylist,
    buildOnboardingMirrorPlaylist,
    ONBOARDING_TASTE_PROFILE_VERSION,
} from '@/src/services/onboardingTasteService';
import { getArtistInfo } from '@/src/services/artistApi';
import { getTidalArtistInfo, searchTidalArtists } from '@/src/services/tidalService';
import { useAuthStore } from '@/src/stores';
import { OnboardingTasteArtist, useOnboardingStore } from '@/src/stores/onboardingStore';
import { typeScale, useTheme } from '@/src/theme';
import { TidalTrack } from '@/src/types/audio';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { router, useRootNavigationState } from 'expo-router';
import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, FadeInDown, FadeOut, LinearTransition, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const APP_LOGO = require('@/assets/images/appicon.png');
const MIN_ARTISTS = 3;
const MAX_ARTISTS = 8;
const QUICK_SEEDS = ['Bad Bunny', 'Taylor Swift', 'The Weeknd', 'Drake', 'Kendrick Lamar', 'Karol G', 'Feid', 'SZA', 'Rosalia', 'Arctic Monkeys'];
const QUICK_DYNAMIC_LIMIT = 8;
type OnboardingStep = 'welcome' | 'profile' | 'tasteArtists' | 'permissions' | 'ready';
type TrackRow = { id: number; title: string; artist: string; artworkUrl?: string };
type QuickSuggestion = { id?: number; name: string; artworkUrl: string; seed: string };

function sanitizeSeedName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

async function fetchQuickSuggestionArtwork(seed: string): Promise<string | null> {
    try {
        const info = await getArtistInfo(seed, { includeBiography: false });
        if (info?.photo_url) return info.photo_url;
    } catch {
        // Fallback below.
    }

    try {
        const response = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(seed)}`);
        const data = await response.json();
        const normalizedSeed = sanitizeSeedName(seed);
        const candidates = Array.isArray(data?.data) ? data.data : [];
        const exactMatch = candidates.find((candidate: any) => sanitizeSeedName(candidate?.name ?? '') === normalizedSeed);
        const best = exactMatch ?? candidates[0];
        const artworkUrl = best?.picture_big ?? best?.picture_xl ?? best?.picture_medium ?? best?.picture ?? null;
        return typeof artworkUrl === 'string' ? artworkUrl : null;
    } catch {
        return null;
    }
}

async function buildSeedSuggestion(seed: string): Promise<QuickSuggestion | null> {
    const artworkUrl = await fetchQuickSuggestionArtwork(seed);
    return artworkUrl ? { name: seed, artworkUrl, seed } : null;
}

function shuffle<T>(list: T[]): T[] {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function mapTrackRows(map: Map<number, TidalTrack[]>): TrackRow[] {
    const buckets = Array.from(map.values()).map(list => [...list].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)));
    const seen = new Set<number>();
    const idx = buckets.map(() => 0);
    const out: TrackRow[] = [];
    let moved = true;
    while (moved) {
        moved = false;
        for (let i = 0; i < buckets.length; i++) {
            if (idx[i] >= buckets[i].length) continue;
            moved = true;
            const t = buckets[i][idx[i]++];
            if (seen.has(t.id)) continue;
            seen.add(t.id);
            out.push({ id: t.id, title: t.title, artist: t.artist, artworkUrl: t.artworkUrl });
        }
    }
    return out;
}

function Progress({ total, current, colors }: { total: number; current: number; colors: any }) {
    return <View style={styles.progress}>{Array.from({ length: total }).map((_, i) => <View key={i} style={[styles.dot, { width: i === current ? 20 : 8, backgroundColor: i <= current ? colors.primary : `${colors.outline}44` }]} />)}</View>;
}

export default function OnboardingScreen() {
    const rootNavigationState = useRootNavigationState();
    const insets = useSafeAreaInsets();
    const { theme } = useTheme();
    const { t } = useI18n();
    const { session } = useAuthStore();
    const {
        completeOnboarding,
        setUserName,
        setUserAvatarUri,
        tasteArtists,
        tasteTrackIds,
        setTasteArtists,
        setTasteTrackIds,
        setTastePlaylistStatus,
        setTasteProfileVersion,
        markTastePlaylistGenerated,
    } = useOnboardingStore();

    const [step, setStep] = useState<OnboardingStep>('welcome');
    const [name, setName] = useState('');
    const [avatarUri, setAvatarUri] = useState<string | null>(null);
    const [artists, setArtists] = useState<OnboardingTasteArtist[]>(tasteArtists);
    const [isFinishing, setIsFinishing] = useState(false);
    const [query, setQuery] = useState('');
    const deferredQuery = useDeferredValue(query.trim());
    const [artistSearch, setArtistSearch] = useState<OnboardingTasteArtist[]>([]);
    const [artistLoading, setArtistLoading] = useState(false);
    const [artistError, setArtistError] = useState('');
    const [artistArtworkOverrides, setArtistArtworkOverrides] = useState<Map<number, string>>(new Map());
    const [quickSuggestions, setQuickSuggestions] = useState<QuickSuggestion[]>([]);
    const [quickLoading, setQuickLoading] = useState(false);
    const artistArtworkAttempted = useRef<Set<number>>(new Set());
    const quickSuggestionsAttempted = useRef(false);
    const searchRequestId = useRef(0);

    useEffect(() => {
        if (!name && session?.email) {
            const p = session.email.split('@')[0] ?? '';
            if (p) setName(p.charAt(0).toUpperCase() + p.slice(1));
        }
    }, [name, session?.email]);

    useEffect(() => {
        if (deferredQuery.length < 2) {
            setArtistSearch([]);
            setArtistError('');
            return;
        }
        let cancelled = false;
        const requestId = ++searchRequestId.current;
        const timer = setTimeout(() => {
            setArtistLoading(true);
            setArtistError('');
            searchTidalArtists(deferredQuery)
                .then(res => {
                    if (cancelled || requestId !== searchRequestId.current) return;
                    startTransition(() => setArtistSearch(res.slice(0, 24).map(a => ({ id: a.id, name: a.name, artworkUrl: a.artworkUrl }))));
                })
                .catch(() => !cancelled && setArtistError(t('onboarding.tasteArtists.error')))
                .finally(() => !cancelled && setArtistLoading(false));
        }, 120);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [deferredQuery, t]);

    const refreshQuickSuggestions = useCallback(async (selectedArtists: OnboardingTasteArtist[]) => {
        const selectedNames = new Set(selectedArtists.map(artist => sanitizeSeedName(artist.name)));
        const fallbackSeeds = shuffle(QUICK_SEEDS)
            .filter(seed => !selectedNames.has(sanitizeSeedName(seed)))
            .slice(0, QUICK_DYNAMIC_LIMIT);
        const fallbackResults = await Promise.allSettled(fallbackSeeds.map(buildSeedSuggestion));
        return fallbackResults
            .map(result => result.status === 'fulfilled' ? result.value : null)
            .filter((value): value is QuickSuggestion => Boolean(value))
            .slice(0, QUICK_DYNAMIC_LIMIT);
    }, []);

    useEffect(() => {
        if (step !== 'tasteArtists') return;
        let cancelled = false;
        if (quickSuggestionsAttempted.current) return;

        quickSuggestionsAttempted.current = true;
        setQuickLoading(true);

        void refreshQuickSuggestions(artists)
            .then(suggestions => {
                if (cancelled) return;
                startTransition(() => setQuickSuggestions(suggestions));
            })
            .catch(() => {
                if (!cancelled) setArtistError(prev => prev || t('onboarding.tasteArtists.error'));
            })
            .finally(() => {
                if (!cancelled) setQuickLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [artists, refreshQuickSuggestions, step, t]);

    const resolveArtistArtwork = useCallback(async (artist: OnboardingTasteArtist) => {
        if (artist.artworkUrl) return;
        if (artistArtworkAttempted.current.has(artist.id)) return;
        artistArtworkAttempted.current.add(artist.id);
        try {
            const info = await getTidalArtistInfo(artist.id);
            const nextArtwork = info.artworkUrl ?? await fetchQuickSuggestionArtwork(artist.name);
            if (!nextArtwork) return;
            setArtistArtworkOverrides(prev => {
                const next = new Map(prev);
                next.set(artist.id, nextArtwork);
                return next;
            });
        } catch {
            const fallbackArtwork = await fetchQuickSuggestionArtwork(artist.name);
            if (!fallbackArtwork) return;
            setArtistArtworkOverrides(prev => {
                const next = new Map(prev);
                next.set(artist.id, fallbackArtwork);
                return next;
            });
        }
    }, []);

    useEffect(() => {
        if (artists.length === 0 && artistSearch.length === 0) return;
        const merged = [...artists, ...artistSearch];
        for (const artist of merged) {
            if (!artist.artworkUrl) void resolveArtistArtwork(artist);
        }
    }, [artistSearch, artists, quickSuggestions, resolveArtistArtwork]);

    const getArtistArtworkUrl = useCallback((artist: OnboardingTasteArtist) => artistArtworkOverrides.get(artist.id) ?? artist.artworkUrl, [artistArtworkOverrides]);

    const { colors: dyn, animated } = useDynamicColors(avatarUri || undefined);
    const colors = useMemo(() => avatarUri ? ({ ...theme.colors, ...dyn, onBackground: dyn.text, onSurfaceVariant: dyn.onSurface } as any) : theme.colors, [avatarUri, dyn, theme.colors]);
    const steps: OnboardingStep[] = ['welcome', 'profile', 'tasteArtists', 'permissions', 'ready'];
    const stepIndex = steps.indexOf(step);
    const slideX = useSharedValue(0);
    const contentOpacity = useSharedValue(1);
    const rootStyle = useAnimatedStyle(() => ({ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: avatarUri ? animated.background.value : theme.colors.background }));
    const contentStyle = useAnimatedStyle(() => ({ flex: 1, opacity: contentOpacity.value, transform: [{ translateX: slideX.value }] }));

    const goTo = useCallback((next: OnboardingStep) => {
        contentOpacity.value = withTiming(0, { duration: 160, easing: Easing.inOut(Easing.ease) }, () => {
            slideX.value = 20;
            runOnJS(setStep)(next);
            slideX.value = withSpring(0, { damping: 18, stiffness: 220 });
            contentOpacity.value = withTiming(1, { duration: 220 });
        });
    }, [contentOpacity, slideX]);
    const next = useCallback(() => { const n = stepIndex + 1; if (n < steps.length) goTo(steps[n]); }, [goTo, stepIndex, steps]);

    const toggleArtist = useCallback((a: OnboardingTasteArtist) => {
        setArtists(prev => {
            const has = prev.some(x => x.id === a.id);
            if (has) return prev.filter(x => x.id !== a.id);
            if (prev.length >= MAX_ARTISTS) return prev;
            return [...prev, a];
        });
    }, []);
    const addSeed = useCallback(async (seed: string) => {
        if (artists.length >= MAX_ARTISTS) return;
        try {
            const res = await searchTidalArtists(seed);
            const match = res.find(x => x.name.toLowerCase() === seed.toLowerCase()) ?? res[0];
                if (match) {
                    toggleArtist({ id: match.id, name: match.name, artworkUrl: match.artworkUrl });
                    setArtistSearch(current => current.filter(artist => artist.id !== match.id));
                }
        } catch {
            setArtistError(t('onboarding.tasteArtists.error'));
        }
    }, [artists.length, t, toggleArtist]);

    const pickAvatar = useCallback(async (camera = false) => {
        const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') return;
        const result = camera
            ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.9 })
            : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
        if (!result.canceled && result.assets[0]?.uri) setAvatarUri(result.assets[0].uri);
    }, []);

    const askMedia = useCallback(async () => { try { await MediaLibrary.requestPermissionsAsync(); } catch { } }, []);

    const finish = useCallback(async () => {
        if (isFinishing) return;
        setIsFinishing(true);
        try {
            if (name.trim()) setUserName(name.trim());
            if (avatarUri) setUserAvatarUri(avatarUri);
            setTasteProfileVersion(ONBOARDING_TASTE_PROFILE_VERSION);
            setTasteArtists(artists);
            setTasteTrackIds([]);
            if (artists.length >= MIN_ARTISTS) {
                setTastePlaylistStatus('pending');
                completeOnboarding();
                if (rootNavigationState?.key) router.replace('/');
                void buildOnboardingMirrorPlaylist({ artists })
                    .then(payload => {
                        applyOnboardingMirrorPlaylist(payload);
                        markTastePlaylistGenerated(Date.now());
                    })
                    .catch(() => {
                        setTastePlaylistStatus('failed');
                    });
            } else {
                setTastePlaylistStatus('idle');
                completeOnboarding();
                if (rootNavigationState?.key) router.replace('/');
            }
        } finally {
            setIsFinishing(false);
        }
    }, [artists, avatarUri, completeOnboarding, isFinishing, markTastePlaylistGenerated, name, rootNavigationState?.key, setTasteArtists, setTastePlaylistStatus, setTasteProfileVersion, setTasteTrackIds, setUserAvatarUri, setUserName]);

    const subtitle = step === 'profile' ? 'Ajusta lo basico en segundos.'
        : step === 'tasteArtists' ? t('onboarding.tasteArtists.subtitle')
            : step === 'permissions' ? 'Solo lo necesario.'
                : '';
    const title = step === 'profile' ? 'Tu perfil'
        : step === 'tasteArtists' ? t('onboarding.tasteArtists.title')
            : step === 'permissions' ? 'Permisos'
                : step === 'ready' ? 'Listo' : '';

    return (
        <Animated.View style={rootStyle}>
            {step !== 'welcome' ? (
                <View style={styles.header}>
                    <Progress total={steps.length} current={stepIndex} colors={colors} />
                    <Text style={[styles.headerTitle, { color: colors.onBackground }]}>{title}</Text>
                    {subtitle ? <Text style={[styles.headerSubtitle, { color: colors.onSurfaceVariant }]}>{subtitle}</Text> : null}
                </View>
            ) : null}

            <Animated.View style={[styles.body, contentStyle]}>
                {step === 'welcome' ? (
                    <View style={styles.center}>
                        <View style={[styles.logo, { backgroundColor: colors.primaryContainer }]}><Image source={APP_LOGO} style={styles.logoImg} /></View>
                        <Text style={[styles.hero, { color: colors.onBackground }]}>StaySound</Text>
                        <Text style={[styles.sub, { color: colors.onSurfaceVariant }]}>Tu musica. Tu ritmo.</Text>
                        <Pressable style={[styles.btn, { backgroundColor: colors.primary }]} onPress={next}><Text style={[styles.btnText, { color: colors.onPrimary }]}>Comenzar</Text></Pressable>
                    </View>
                ) : null}

                {step === 'profile' ? (
                    <Pressable onPress={Keyboard.dismiss} style={styles.full}>
                        <View style={styles.center}>
                            <Pressable onPress={() => void pickAvatar(false)} style={[styles.avatar, { borderColor: colors.primary }]}>{avatarUri ? <Image source={{ uri: avatarUri }} style={styles.avatarImg} /> : <Ionicons name="person-outline" size={40} color={colors.onSurfaceVariant} />}</Pressable>
                            <View style={styles.row}>
                                <Pressable onPress={() => void pickAvatar(false)}><Text style={[styles.link, { color: colors.primary }]}>Galeria</Text></Pressable>
                                <Pressable onPress={() => void pickAvatar(true)}><Text style={[styles.link, { color: colors.primary }]}>Camara</Text></Pressable>
                            </View>
                        </View>
                        <View style={[styles.input, { borderColor: `${colors.outline}55` }]}><Ionicons name="person-outline" size={18} color={colors.onSurfaceVariant} /><TextInput value={name} onChangeText={setName} style={[styles.inputText, { color: colors.onSurface }]} placeholder="Tu nombre" placeholderTextColor={colors.onSurfaceVariant} /></View>
                        <Pressable style={[styles.btn, { backgroundColor: name.trim() ? colors.primary : colors.surfaceVariant }]} onPress={name.trim() ? next : undefined}><Text style={[styles.btnText, { color: name.trim() ? colors.onPrimary : colors.onSurfaceVariant }]}>Continuar</Text></Pressable>
                        <Pressable onPress={next}><Text style={[styles.skip, { color: colors.onSurfaceVariant }]}>Saltar por ahora</Text></Pressable>
                    </Pressable>
                ) : null}

                {step === 'tasteArtists' ? (
                    <View style={styles.full}>
                        <Text style={[styles.meta, { color: colors.onSurfaceVariant }]}>{t('onboarding.tasteArtists.selectedCount', { count: artists.length, max: MAX_ARTISTS })}</Text>
                        <View style={[styles.input, { borderColor: `${colors.outline}55` }]}><Ionicons name="search-outline" size={18} color={colors.onSurfaceVariant} /><TextInput value={query} onChangeText={setQuery} style={[styles.inputText, { color: colors.onSurface }]} placeholder={t('onboarding.tasteArtists.searchPlaceholder')} placeholderTextColor={colors.onSurfaceVariant} /></View>
                        <ScrollView style={styles.list} contentContainerStyle={styles.artistScroller}>
                            {artists.length > 0 ? <View style={styles.wrap}>{artists.map(a => <Animated.View key={a.id} entering={FadeInDown.duration(220)} exiting={FadeOut.duration(160)} layout={LinearTransition.springify().damping(20).stiffness(230)}><Pressable onPress={() => toggleArtist(a)} style={[styles.pill, { borderColor: `${colors.primary}55` }]}><View style={[styles.pillAvatar, { backgroundColor: colors.surfaceVariant }]}>{getArtistArtworkUrl(a) ? <Image source={{ uri: getArtistArtworkUrl(a) }} style={styles.pillAvatarImg} /> : <Ionicons name="person-outline" size={12} color={colors.onSurfaceVariant} />}</View><Text style={[styles.pillText, { color: colors.onSurface }]} numberOfLines={1}>{a.name}</Text><Ionicons name="close" size={14} color={colors.onSurfaceVariant} /></Pressable></Animated.View>)}</View> : null}

                            {!query.trim() ? <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>{t('onboarding.tasteArtists.quickTitle')}</Text> : null}
                            {!query.trim() ? <View style={styles.artistGrid}>{quickSuggestions.map((artist, index) => { const selected = artists.some(a => a.id === artist.id || a.name.toLowerCase() === artist.name.toLowerCase()); return <Animated.View key={`${artist.seed}-${artist.id ?? artist.name}`} entering={FadeInDown.delay(index * 40).duration(280)} exiting={FadeOut.duration(140)} layout={LinearTransition.springify().damping(20).stiffness(240)} style={styles.artistCell}><Pressable onPress={() => artist.id ? toggleArtist({ id: artist.id, name: artist.name, artworkUrl: artist.artworkUrl }) : void addSeed(artist.name)} style={styles.artistPoster}><View style={[styles.artistPortrait, { borderColor: selected ? colors.primary : 'transparent', backgroundColor: colors.surfaceVariant }]}>{artist.artworkUrl ? <Image source={{ uri: artist.artworkUrl }} style={styles.artistPortraitImg} /> : <Ionicons name="person-outline" size={28} color={colors.onSurfaceVariant} />}{selected ? <View style={[styles.quickCheck, { backgroundColor: colors.primary }]}><Ionicons name="checkmark" size={12} color={colors.onPrimary} /></View> : null}</View><Text style={[styles.artistPosterName, { color: colors.onSurface }]} numberOfLines={2}>{artist.name}</Text></Pressable></Animated.View>; })}</View> : null}

                            {query.trim().length >= 2 ? <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>{t('onboarding.tasteArtists.resultsTitle')}</Text> : null}
                            {artistError ? <Text style={[styles.meta, { color: colors.error }]}>{artistError}</Text> : null}
                            {query.trim().length >= 2 ? <View style={styles.artistGrid}>{artistSearch.map((artist, index) => { const selected = artists.some(a => a.id === artist.id); const artwork = getArtistArtworkUrl(artist); return <Animated.View key={artist.id} entering={FadeInDown.delay(index * 20).duration(220)} layout={LinearTransition.springify().damping(22).stiffness(250)} style={styles.artistCell}><Pressable onPress={() => toggleArtist(artist)} style={styles.artistPoster}><View style={[styles.artistPortrait, { borderColor: selected ? colors.primary : 'transparent', backgroundColor: colors.surfaceVariant }]}>{artwork ? <Image source={{ uri: artwork }} style={styles.artistPortraitImg} /> : <Ionicons name="person-outline" size={28} color={colors.onSurfaceVariant} />}{selected ? <View style={[styles.quickCheck, { backgroundColor: colors.primary }]}><Ionicons name="checkmark" size={12} color={colors.onPrimary} /></View> : null}</View><Text style={[styles.artistPosterName, { color: colors.onSurface }]} numberOfLines={2}>{artist.name}</Text></Pressable></Animated.View>; })}</View> : null}
                        </ScrollView>
                        <Pressable style={[styles.btn, { backgroundColor: artists.length >= MIN_ARTISTS ? colors.primary : colors.surfaceVariant }]} onPress={artists.length >= MIN_ARTISTS ? next : undefined}><Text style={[styles.btnText, { color: artists.length >= MIN_ARTISTS ? colors.onPrimary : colors.onSurfaceVariant }]}>{t('onboarding.tasteArtists.continue')}</Text></Pressable>
                        <Pressable onPress={next}><Text style={[styles.skip, { color: colors.onSurfaceVariant }]}>{t('onboarding.tasteArtists.skip')}</Text></Pressable>
                    </View>
                ) : null}

                {step === 'permissions' ? (
                    <View style={styles.full}>
                        <View style={[styles.item, { borderBottomColor: `${colors.outline}22` }]}><Ionicons name="musical-notes-outline" size={20} color={colors.onSurfaceVariant} /><Text style={[styles.itemTitle, { color: colors.onSurface }]}>Biblioteca local</Text></View>
                        <View style={[styles.item, { borderBottomColor: `${colors.outline}22` }]}><Ionicons name="notifications-outline" size={20} color={colors.onSurfaceVariant} /><Text style={[styles.itemTitle, { color: colors.onSurface }]}>Notificaciones</Text></View>
                        <Pressable style={[styles.btn, { backgroundColor: colors.primary }]} onPress={() => void askMedia()}><Text style={[styles.btnText, { color: colors.onPrimary }]}>Pedir permisos</Text></Pressable>
                        <Pressable style={[styles.btn, { backgroundColor: colors.surfaceVariant }]} onPress={next}><Text style={[styles.btnText, { color: colors.onSurfaceVariant }]}>Continuar</Text></Pressable>
                    </View>
                ) : null}

                {step === 'ready' ? (
                    <View style={styles.center}>
                        <View style={[styles.avatar, { borderColor: colors.primary }]}>{avatarUri ? <Image source={{ uri: avatarUri }} style={styles.avatarImg} /> : <Ionicons name="person-outline" size={40} color={colors.onSurfaceVariant} />}</View>
                        <Text style={[styles.heroSmall, { color: colors.onBackground }]}>Todo listo, {name.trim() || 'Oyente'}</Text>
                        <Pressable style={[styles.btn, { backgroundColor: colors.primary }]} onPress={() => void finish()} disabled={isFinishing}><Text style={[styles.btnText, { color: colors.onPrimary }]}>{isFinishing ? t('onboarding.finish.processing') : 'Entrar a StaySound'}</Text></Pressable>
                    </View>
                ) : null}
            </Animated.View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    header: { paddingHorizontal: 22, paddingTop: 14, gap: 6 },
    progress: { flexDirection: 'row', gap: 6 },
    dot: { height: 8, borderRadius: 999 },
    headerTitle: { ...typeScale.headline, letterSpacing: -0.4 },
    headerSubtitle: { ...typeScale.bodyStrong, lineHeight: 20 },
    body: { flex: 1, paddingHorizontal: 22, paddingTop: 8, paddingBottom: 6 },
    full: { flex: 1, gap: 10 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
    logo: { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    logoImg: { width: 110, height: 110 },
    hero: { ...typeScale.hero, letterSpacing: -1 },
    heroSmall: { ...typeScale.headline, textAlign: 'center' },
    sub: { ...typeScale.bodyStrong },
    avatar: { width: 108, height: 108, borderRadius: 54, borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    avatarImg: { width: '100%', height: '100%' },
    row: { flexDirection: 'row', gap: 16 },
    link: { ...typeScale.bodyStrong, fontSize: 14 },
    input: { minHeight: 50, borderRadius: 14, borderWidth: 1.3, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
    inputText: { ...typeScale.bodyStrong, flex: 1, paddingVertical: 12 },
    btn: { minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    btnText: { ...typeScale.title, fontSize: 16, textAlign: 'center' },
    skip: { ...typeScale.bodyStrong, fontSize: 14, textAlign: 'center', paddingVertical: 4 },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
    pillAvatar: { width: 20, height: 20, borderRadius: 999, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    pillAvatarImg: { width: '100%', height: '100%' },
    pillText: { ...typeScale.body, maxWidth: 160 },
    seed: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
    seedText: { ...typeScale.body, fontSize: 13 },
    artistScroller: { paddingBottom: 18, gap: 14 },
    sectionLabel: { ...typeScale.caption, fontSize: 12, letterSpacing: 0.7, textTransform: 'uppercase', marginTop: 4 },
    artistGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
    artistCell: { width: '33.333%', paddingHorizontal: 6, marginBottom: 16 },
    artistPoster: { gap: 9 },
    artistPortrait: { width: '100%', aspectRatio: 1, borderRadius: 999, borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    artistPortraitImg: { width: '100%', height: '100%' },
    quickCheck: { position: 'absolute', right: 5, bottom: 5, width: 20, height: 20, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
    artistPosterName: { ...typeScale.bodyStrong, fontSize: 13, textAlign: 'center', lineHeight: 17 },
    list: { flex: 1, minHeight: 160 },
    item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
    thumb: { width: 36, height: 36, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    thumbImg: { width: '100%', height: '100%' },
    itemText: { flex: 1 },
    itemTitle: { ...typeScale.bodyStrong, flex: 1 },
    itemSub: { ...typeScale.caption, marginTop: 2 },
    meta: { ...typeScale.body, lineHeight: 20 },
});
