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
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { router, useRootNavigationState } from 'expo-router';
import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import Animated, {
    Easing,
    FadeIn,
    FadeInDown,
    FadeOut,
    LinearTransition,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

type I18nTranslate = ReturnType<typeof useI18n>['t'];
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const APP_LOGO = require('@/assets/images/appicon.png');
const MIN_ARTISTS = 3;
const MAX_ARTISTS = 8;
const QUICK_SEEDS = ['Bad Bunny', 'Taylor Swift', 'The Weeknd', 'Drake', 'Kendrick Lamar', 'Karol G', 'Feid', 'SZA', 'Rosalia', 'Arctic Monkeys'];
const QUICK_DYNAMIC_LIMIT = 8;

type OnboardingStep = 'welcome' | 'profile' | 'tasteArtists' | 'permissions' | 'ready' | 'building';
type QuickSuggestion = { id?: number; name: string; artworkUrl: string; seed: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isBlockedTidalArtworkUrl(value?: string | null): boolean {
    return typeof value === 'string' && value.includes('resources.tidal.com/images/');
}

function buildSeedPlaceholders(selectedArtists: OnboardingTasteArtist[]): QuickSuggestion[] {
    const selectedNames = new Set(selectedArtists.map(a => sanitizeSeedName(a.name)));
    return shuffle(QUICK_SEEDS)
        .filter(seed => !selectedNames.has(sanitizeSeedName(seed)))
        .slice(0, QUICK_DYNAMIC_LIMIT)
        .map(seed => ({ name: seed, artworkUrl: '', seed }));
}

function sanitizeSeedName(name: string): string {
    return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

async function fetchQuickSuggestionArtwork(seed: string): Promise<string | null> {
    try {
        const info = await getArtistInfo(seed, { includeBiography: false });
        if (info?.photo_url) return info.photo_url;
    } catch { /* fallback below */ }
    try {
        const response = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(seed)}`);
        const data = await response.json();
        const normalizedSeed = sanitizeSeedName(seed);
        const candidates = Array.isArray(data?.data) ? data.data : [];
        const exactMatch = candidates.find((c: any) => sanitizeSeedName(c?.name ?? '') === normalizedSeed);
        const best = exactMatch ?? candidates[0];
        const artworkUrl = best?.picture_big ?? best?.picture_xl ?? best?.picture_medium ?? best?.picture ?? null;
        return typeof artworkUrl === 'string' ? artworkUrl : null;
    } catch {
        return null;
    }
}

async function buildSeedSuggestion(seed: string): Promise<QuickSuggestion | null> {
    try {
        const results = await searchTidalArtists(seed);
        const normalizedSeed = sanitizeSeedName(seed);
        const match = results.find(c => sanitizeSeedName(c.name) === normalizedSeed) ?? results[0];
        if (match) {
            const tidalArtwork = match.artworkUrl;
            const artworkUrl = isBlockedTidalArtworkUrl(tidalArtwork)
                ? await fetchQuickSuggestionArtwork(match.name)
                : (tidalArtwork || await fetchQuickSuggestionArtwork(match.name));
            return { id: match.id, name: match.name, artworkUrl: artworkUrl ?? tidalArtwork ?? '', seed };
        }
    } catch { /* fallback below */ }
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

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Animated progress bar that slides to indicate step completion */
function StepProgressBar({ total, current, colors }: { total: number; current: number; colors: any }) {
    const progress = useSharedValue(current / (total - 1));

    useEffect(() => {
        progress.value = withSpring(current / (total - 1), { damping: 22, stiffness: 180 });
    }, [current, progress, total]);

    const barStyle = useAnimatedStyle(() => ({
        width: `${progress.value * 100}%`,
    }));

    return (
        <View
            style={[styles.progressTrack, { backgroundColor: `${colors.outline}33` }]}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: total - 1, now: current }}
            accessibilityLabel={`Paso ${current + 1} de ${total}`}
        >
            <Animated.View
                style={[styles.progressFill, { backgroundColor: colors.primary }, barStyle]}
            />
        </View>
    );
}

/** Animated primary CTA button with press scale feedback */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PrimaryButtonProps {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    loading?: boolean;
    colors: any;
}

function PrimaryButton({ label, onPress, disabled, loading, colors }: PrimaryButtonProps) {
    const scale = useSharedValue(1);
    const btnStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
    const isActive = !disabled && !loading;

    return (
        <AnimatedPressable
            style={[
                styles.btn,
                { backgroundColor: isActive ? colors.primary : colors.surfaceVariant },
                btnStyle,
            ]}
            onPress={isActive ? onPress : undefined}
            onPressIn={() => { if (isActive) scale.value = withSpring(0.97, { damping: 20, stiffness: 400 }); }}
            onPressOut={() => { scale.value = withSpring(1, { damping: 18, stiffness: 300 }); }}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: !isActive }}
        >
            {loading
                ? <ActivityIndicator size="small" color={colors.onSurfaceVariant} />
                : <Text style={[styles.btnText, { color: isActive ? colors.onPrimary : colors.onSurfaceVariant }]}>{label}</Text>}
        </AnimatedPressable>
    );
}

/** "Ghost" secondary action (skip / saltar) */
function SecondaryButton({ label, onPress, colors }: { label: string; onPress: () => void; colors: any }) {
    return (
        <Pressable
            onPress={onPress}
            style={styles.skipBtn}
            accessibilityRole="button"
            accessibilityLabel={label}
        >
            <Text style={[styles.skip, { color: colors.onSurfaceVariant }]}>{label}</Text>
        </Pressable>
    );
}

// ─── Welcome Step ──────────────────────────────────────────────────────────────

function WelcomeStep({ onNext, colors }: { onNext: () => void; colors: any }) {
    // Logo pulse loop
    const pulse = useSharedValue(1);
    useEffect(() => {
        pulse.value = withRepeat(
            withSequence(
                withTiming(1.04, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
                withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
            ),
            -1,
            false,
        );
    }, [pulse]);
    const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

    return (
        <View style={styles.center}>
            <Animated.View entering={FadeInDown.duration(500).easing(Easing.out(Easing.cubic))} style={logoStyle}>
                <View style={[styles.logo, { backgroundColor: colors.primaryContainer }]}>
                    <Image source={APP_LOGO} style={styles.logoImg} accessibilityIgnoresInvertColors />
                </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(160).duration(440).easing(Easing.out(Easing.cubic))} style={styles.welcomeTexts}>
                <Text style={[styles.hero, { color: colors.onBackground }]} accessibilityRole="header">
                    StaySound
                </Text>
                <Text style={[styles.sub, { color: colors.onSurfaceVariant }]}>
                    Tu música. Tu ritmo.
                </Text>
            </Animated.View>

            <Animated.View
                entering={FadeInDown.delay(340).duration(380).easing(Easing.out(Easing.cubic))}
                style={styles.welcomeCta}
            >
                <PrimaryButton label="Comenzar" onPress={onNext} colors={colors} />
            </Animated.View>
        </View>
    );
}

// ─── Profile Step ──────────────────────────────────────────────────────────────

function ProfileStep({
    name,
    setName,
    avatarUri,
    onPickAvatar,
    onNext,
    onSkip,
    colors,
}: {
    name: string;
    setName: (v: string) => void;
    avatarUri: string | null;
    onPickAvatar: (camera?: boolean) => void;
    onNext: () => void;
    onSkip: () => void;
    colors: any;
}) {
    return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.full}>
            <ScrollView
                style={styles.full}
                contentContainerStyle={styles.profileScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <Pressable onPress={Keyboard.dismiss} style={styles.profileContent}>
                    {/* Avatar */}
                    <View style={styles.profileHero}>
                        <Pressable
                            onPress={() => onPickAvatar(false)}
                            style={[styles.avatar, { borderColor: colors.primary }]}
                            accessibilityRole="imagebutton"
                            accessibilityLabel="Seleccionar foto de perfil"
                        >
                            {avatarUri
                                ? <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
                                : (
                                    <View style={styles.avatarPlaceholder}>
                                        <Ionicons name="camera-outline" size={32} color={colors.onSurfaceVariant} />
                                        <Text style={[styles.avatarHint, { color: colors.onSurfaceVariant }]}>Foto</Text>
                                    </View>
                                )
                            }
                        </Pressable>

                        <View style={[styles.avatarActions, { backgroundColor: `${colors.surfaceVariant}88` }]}>
                            <Pressable
                                onPress={() => onPickAvatar(false)}
                                style={styles.avatarActionBtn}
                                accessibilityRole="button"
                                accessibilityLabel="Elegir de galería"
                            >
                                <Ionicons name="images-outline" size={16} color={colors.primary} />
                                <Text style={[styles.avatarActionText, { color: colors.primary }]}>Galería</Text>
                            </Pressable>
                            <View style={[styles.avatarActionDivider, { backgroundColor: colors.outline }]} />
                            <Pressable
                                onPress={() => onPickAvatar(true)}
                                style={styles.avatarActionBtn}
                                accessibilityRole="button"
                                accessibilityLabel="Tomar foto con cámara"
                            >
                                <Ionicons name="camera-outline" size={16} color={colors.primary} />
                                <Text style={[styles.avatarActionText, { color: colors.primary }]}>Cámara</Text>
                            </Pressable>
                        </View>
                    </View>

                    {/* Name input */}
                    <View style={[styles.inputRow, { borderColor: `${colors.outline}55`, backgroundColor: colors.surface }]}>
                        <Ionicons name="person-outline" size={18} color={colors.onSurfaceVariant} />
                        <TextInput
                            value={name}
                            onChangeText={setName}
                            style={[styles.inputText, { color: colors.onSurface }]}
                            placeholder="Tu nombre"
                            placeholderTextColor={colors.onSurfaceVariant}
                            returnKeyType="done"
                            onSubmitEditing={Keyboard.dismiss}
                            accessibilityLabel="Tu nombre"
                        />
                        {name.length > 0 && (
                            <Pressable onPress={() => setName('')} accessibilityLabel="Borrar nombre" accessibilityRole="button">
                                <Ionicons name="close-circle" size={18} color={colors.onSurfaceVariant} />
                            </Pressable>
                        )}
                    </View>
                </Pressable>
            </ScrollView>

            <View style={styles.footerActions}>
                <PrimaryButton
                    label="Continuar"
                    onPress={onNext}
                    disabled={!name.trim()}
                    colors={colors}
                />
                <SecondaryButton label="Saltar por ahora" onPress={onSkip} colors={colors} />
            </View>
        </KeyboardAvoidingView>
    );
}

// ─── Artist Chip (selected artist pill) ───────────────────────────────────────

function ArtistChip({ artist, onRemove, artworkUrl, colors }: {
    artist: OnboardingTasteArtist;
    onRemove: () => void;
    artworkUrl?: string;
    colors: any;
}) {
    return (
        <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(140)}
            layout={LinearTransition.springify().damping(22).stiffness(260)}
        >
            <Pressable
                onPress={onRemove}
                style={[styles.chip, { borderColor: `${colors.primary}60`, backgroundColor: `${colors.primary}12` }]}
                accessibilityRole="button"
                accessibilityLabel={`Quitar ${artist.name}`}
            >
                <View style={[styles.chipAvatar, { backgroundColor: colors.surfaceVariant }]}>
                    {artworkUrl
                        ? <Image source={{ uri: artworkUrl }} style={styles.chipAvatarImg} />
                        : <Ionicons name="person-outline" size={10} color={colors.onSurfaceVariant} />}
                </View>
                <Text style={[styles.chipText, { color: colors.onSurface }]} numberOfLines={1}>{artist.name}</Text>
                <Ionicons name="close-circle" size={15} color={`${colors.onSurfaceVariant}99`} />
            </Pressable>
        </Animated.View>
    );
}

// ─── Artist Card (grid cell) ──────────────────────────────────────────────────

function ArtistCard({ artist, selected, onPress, artworkUrl, colors, index }: {
    artist: { id?: number; name: string; artworkUrl?: string };
    selected: boolean;
    onPress: () => void;
    artworkUrl?: string;
    colors: any;
    index: number;
}) {
    const scale = useSharedValue(1);
    const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    return (
        <Animated.View
            // Only stagger the first 6 — beyond that no delay to avoid sluggishness
            entering={FadeInDown.delay(Math.min(index, 5) * 50).duration(260).easing(Easing.out(Easing.cubic))}
            layout={LinearTransition.springify().damping(22).stiffness(250)}
            style={[styles.artistCell, cardStyle]}
        >
            <Pressable
                onPress={onPress}
                onPressIn={() => { scale.value = withSpring(0.94, { damping: 20, stiffness: 400 }); }}
                onPressOut={() => { scale.value = withSpring(1, { damping: 18, stiffness: 300 }); }}
                style={styles.artistPoster}
                accessibilityRole="checkbox"
                accessibilityLabel={artist.name}
                accessibilityState={{ checked: selected }}
            >
                <View style={[
                    styles.artistPortrait,
                    {
                        borderColor: selected ? colors.primary : 'transparent',
                        backgroundColor: colors.surfaceVariant,
                        borderWidth: selected ? 2.5 : 2,
                    },
                ]}>
                    {artworkUrl
                        ? <Image source={{ uri: artworkUrl }} style={styles.artistPortraitImg} />
                        : <Ionicons name="person-outline" size={28} color={colors.onSurfaceVariant} />}

                    {selected && (
                        <Animated.View
                            entering={FadeIn.duration(160)}
                            style={[styles.selectedBadge, { backgroundColor: colors.primary }]}
                        >
                            <Ionicons name="checkmark" size={11} color={colors.onPrimary} />
                        </Animated.View>
                    )}
                </View>
                <Text style={[styles.artistPosterName, { color: colors.onSurface }]} numberOfLines={2}>
                    {artist.name}
                </Text>
            </Pressable>
        </Animated.View>
    );
}

// ─── Taste Artists Step ────────────────────────────────────────────────────────

function TasteArtistsStep({
    artists,
    quickSuggestions,
    quickLoading,
    artistSearch,
    artistLoading,
    artistError,
    query,
    setQuery,
    onToggle,
    onAddSeed,
    onNext,
    onSkip,
    getArtworkUrl,
    colors,
    t,
}: {
    artists: OnboardingTasteArtist[];
    quickSuggestions: QuickSuggestion[];
    quickLoading: boolean;
    artistSearch: OnboardingTasteArtist[];
    artistLoading: boolean;
    artistError: string;
    query: string;
    setQuery: (v: string) => void;
    onToggle: (a: OnboardingTasteArtist) => void;
    onAddSeed: (seed: string) => void;
    onNext: () => void;
    onSkip: () => void;
    getArtworkUrl: (a: OnboardingTasteArtist) => string | undefined;
    colors: any;
    t: I18nTranslate;
}) {
    const canContinue = artists.length >= MIN_ARTISTS;
    const isSearching = query.trim().length >= 2;

    return (
        <View style={styles.full}>
            {/* Counter badge */}
            <View style={styles.counterRow}>
                <Text style={[styles.counterText, { color: colors.onSurfaceVariant }]}>
                    {t('onboarding.tasteArtists.selectedCount', { count: artists.length, max: MAX_ARTISTS })}
                </Text>
                {!canContinue && (
                    <Text style={[styles.counterHint, { color: `${colors.primary}BB` }]}>
                        {`${MIN_ARTISTS - artists.length} más para continuar`}
                    </Text>
                )}
            </View>

            {/* Search bar */}
            <View style={[styles.searchRow, { borderColor: `${colors.outline}55`, backgroundColor: colors.surface }]}>
                <Ionicons name="search-outline" size={18} color={colors.onSurfaceVariant} />
                <TextInput
                    value={query}
                    onChangeText={setQuery}
                    style={[styles.inputText, { color: colors.onSurface }]}
                    placeholder={t('onboarding.tasteArtists.searchPlaceholder')}
                    placeholderTextColor={colors.onSurfaceVariant}
                    accessibilityLabel="Buscar artistas"
                    returnKeyType="search"
                />
                {query.length > 0 && (
                    <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Borrar búsqueda">
                        <Ionicons name="close-circle" size={18} color={colors.onSurfaceVariant} />
                    </Pressable>
                )}
                {artistLoading && <ActivityIndicator size="small" color={colors.primary} />}
            </View>

            <ScrollView style={styles.list} contentContainerStyle={styles.artistScroller} showsVerticalScrollIndicator={false}>
                {/* Selected chips */}
                {artists.length > 0 && (
                    <View style={styles.chipsWrap}>
                        {artists.map(a => (
                            <ArtistChip
                                key={a.id}
                                artist={a}
                                onRemove={() => onToggle(a)}
                                artworkUrl={getArtworkUrl(a)}
                                colors={colors}
                            />
                        ))}
                    </View>
                )}

                {/* Quick suggestions */}
                {!isSearching && (
                    <>
                        <View style={styles.sectionHeader}>
                            <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>
                                {t('onboarding.tasteArtists.quickTitle')}
                            </Text>
                            {quickLoading && <ActivityIndicator size="small" color={colors.primary} />}
                        </View>
                        <View style={styles.artistGrid}>
                            {quickSuggestions.map((artist, index) => {
                                const selected = artists.some(a => a.id === artist.id || a.name.toLowerCase() === artist.name.toLowerCase());
                                return (
                                    <ArtistCard
                                        key={`${artist.seed}-${artist.id ?? artist.name}`}
                                        artist={artist}
                                        selected={selected}
                                        artworkUrl={artist.artworkUrl || undefined}
                                        onPress={() => artist.id
                                            ? onToggle({ id: artist.id, name: artist.name, artworkUrl: artist.artworkUrl || undefined })
                                            : onAddSeed(artist.name)
                                        }
                                        colors={colors}
                                        index={index}
                                    />
                                );
                            })}
                        </View>
                    </>
                )}

                {/* Search results */}
                {isSearching && (
                    <>
                        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>
                            {t('onboarding.tasteArtists.resultsTitle')}
                        </Text>
                        {artistError ? <Text style={[styles.meta, { color: colors.error }]}>{artistError}</Text> : null}
                        <View style={styles.artistGrid}>
                            {artistSearch.map((artist, index) => {
                                const selected = artists.some(a => a.id === artist.id);
                                return (
                                    <ArtistCard
                                        key={artist.id}
                                        artist={artist}
                                        selected={selected}
                                        artworkUrl={getArtworkUrl(artist)}
                                        onPress={() => onToggle(artist)}
                                        colors={colors}
                                        index={index}
                                    />
                                );
                            })}
                        </View>
                    </>
                )}
            </ScrollView>

            <View style={styles.footerActions}>
                <PrimaryButton
                    label={t('onboarding.tasteArtists.continue')}
                    onPress={onNext}
                    disabled={!canContinue}
                    colors={colors}
                />
                <SecondaryButton label={t('onboarding.tasteArtists.skip')} onPress={onSkip} colors={colors} />
            </View>
        </View>
    );
}

// ─── Permission Row ────────────────────────────────────────────────────────────

function PermissionRow({ icon, title, description, granted, colors }: {
    icon: any;
    title: string;
    description: string;
    granted: boolean;
    colors: any;
}) {
    return (
        <View
            style={[styles.permItem, { backgroundColor: colors.surface, borderColor: `${colors.outline}33` }]}
            accessibilityRole="none"
        >
            <View style={[styles.permIcon, { backgroundColor: granted ? `${colors.primary}22` : `${colors.surfaceVariant}` }]}>
                <Ionicons name={icon} size={22} color={granted ? colors.primary : colors.onSurfaceVariant} />
            </View>
            <View style={styles.permTexts}>
                <Text style={[styles.permTitle, { color: colors.onSurface }]}>{title}</Text>
                <Text style={[styles.permDesc, { color: colors.onSurfaceVariant }]}>{description}</Text>
            </View>
            {granted && (
                <Animated.View entering={FadeIn.duration(200)}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                </Animated.View>
            )}
        </View>
    );
}

// ─── Permissions Step ──────────────────────────────────────────────────────────

function PermissionsStep({ onAskMedia, onNext, colors, mediaGranted }: {
    onAskMedia: () => void;
    onNext: () => void;
    colors: any;
    mediaGranted: boolean;
}) {
    return (
        <View style={[styles.full, { gap: 16 }]}>
            <Text style={[styles.permIntro, { color: colors.onSurfaceVariant }]}>
                StaySound necesita estos permisos para funcionar correctamente. Siempre puedes cambiarlos en ajustes.
            </Text>

            <PermissionRow
                icon="musical-notes-outline"
                title="Biblioteca local"
                description="Acceder a tu música guardada en el dispositivo."
                granted={mediaGranted}
                colors={colors}
            />
            <PermissionRow
                icon="notifications-outline"
                title="Notificaciones"
                description="Controles de reproducción en la barra de notificaciones."
                granted={false}
                colors={colors}
            />

            <View style={styles.footerActions}>
                {!mediaGranted && (
                    <PrimaryButton
                        label="Permitir acceso a música"
                        onPress={onAskMedia}
                        colors={colors}
                    />
                )}
                <PrimaryButton
                    label="Continuar"
                    onPress={onNext}
                    colors={colors}
                />
            </View>
        </View>
    );
}

// ─── Ready Step ────────────────────────────────────────────────────────────────

function ReadyStep({ name, avatarUri, onFinish, isFinishing, colors }: {
    name: string;
    avatarUri: string | null;
    onFinish: () => void;
    isFinishing: boolean;
    colors: any;
}) {
    const checkScale = useSharedValue(0);
    useEffect(() => {
        checkScale.value = withDelay(200, withSpring(1, { damping: 14, stiffness: 200 }));
    }, [checkScale]);
    const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: checkScale.value }] }));

    return (
        <View style={styles.center}>
            <Animated.View entering={FadeInDown.duration(400).easing(Easing.out(Easing.cubic))}>
                <View style={[styles.avatar, { borderColor: colors.primary, borderWidth: 3 }]}>
                    {avatarUri
                        ? <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
                        : (
                            <View style={[styles.avatarFallback, { backgroundColor: colors.primaryContainer }]}>
                                <Ionicons name="person" size={42} color={colors.primary} />
                            </View>
                        )
                    }
                    <Animated.View style={[styles.readyBadge, { backgroundColor: colors.primary }, checkStyle]}>
                        <Ionicons name="checkmark" size={14} color={colors.onPrimary} />
                    </Animated.View>
                </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(200).duration(360).easing(Easing.out(Easing.cubic))} style={styles.readyTexts}>
                <Text style={[styles.heroSmall, { color: colors.onBackground }]} accessibilityRole="header">
                    {`¡Listo, ${name.trim() || 'oyente'}!`}
                </Text>
                <Text style={[styles.readySubtitle, { color: colors.onSurfaceVariant }]}>
                    Tu experiencia musical está configurada y personalizada para ti.
                </Text>
            </Animated.View>

            <Animated.View
                entering={FadeInDown.delay(380).duration(320).easing(Easing.out(Easing.cubic))}
                style={styles.readyCta}
            >
                <PrimaryButton
                    label="Entrar a StaySound"
                    onPress={onFinish}
                    loading={isFinishing}
                    colors={colors}
                />
            </Animated.View>
        </View>
    );
}

// ─── Building Step ─────────────────────────────────────────────────────────────

function BuildingStep({ colors }: { colors: any }) {
    const dots = [0, 1, 2];
    return (
        <View style={styles.buildingStage}>
            <View style={[styles.buildingIconWrap, { backgroundColor: `${colors.primary}18` }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
            <Text style={[styles.heroSmall, { color: colors.onBackground }]} accessibilityRole="header">
                Armando tu playlist
            </Text>
            <Text style={[styles.buildingCopy, { color: colors.onSurfaceVariant }]}>
                Estamos eligiendo canciones de los artistas que seleccionaste. La app abrirá con tu mezcla lista.
            </Text>
            <View style={styles.buildingDots}>
                {dots.map(i => (
                    <Animated.View
                        key={i}
                        style={[
                            styles.buildingDot,
                            { backgroundColor: colors.primary },
                            {
                                animationName: {
                                    from: { opacity: 0.3, transform: [{ scale: 0.8 }] },
                                    '50%': { opacity: 1, transform: [{ scale: 1 }] },
                                    to: { opacity: 0.3, transform: [{ scale: 0.8 }] },
                                } as any,
                                animationDuration: '1200ms',
                                animationDelay: `${i * 300}ms`,
                                animationIterationCount: 'infinite',
                                animationTimingFunction: 'ease-in-out',
                            },
                        ]}
                    />
                ))}
            </View>
        </View>
    );
}

// ─── Main Screen ────────────────────────────────────────────────────────────────

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
    const [mediaGranted, setMediaGranted] = useState(false);
    const artistArtworkAttempted = useRef<Set<number>>(new Set());
    const quickSuggestionsAttempted = useRef(false);
    const searchRequestId = useRef(0);

    // Pre-fill name from email
    useEffect(() => {
        if (!name && session?.email) {
            const p = session.email.split('@')[0] ?? '';
            if (p) setName(p.charAt(0).toUpperCase() + p.slice(1));
        }
    }, [name, session?.email]);

    // Artist search
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
        return () => { cancelled = true; clearTimeout(timer); };
    }, [deferredQuery, t]);

    const refreshQuickSuggestions = useCallback(async (selectedArtists: OnboardingTasteArtist[]) => {
        const selectedNames = new Set(selectedArtists.map(a => sanitizeSeedName(a.name)));
        const seeds = shuffle(QUICK_SEEDS).filter(s => !selectedNames.has(sanitizeSeedName(s))).slice(0, QUICK_DYNAMIC_LIMIT);
        const results = await Promise.allSettled(seeds.map(buildSeedSuggestion));
        return results
            .map(r => r.status === 'fulfilled' ? r.value : null)
            .filter((v): v is QuickSuggestion => Boolean(v))
            .slice(0, QUICK_DYNAMIC_LIMIT);
    }, []);

    useEffect(() => {
        if (step !== 'tasteArtists') return;
        let cancelled = false;
        if (quickSuggestionsAttempted.current) return;
        quickSuggestionsAttempted.current = true;
        setQuickLoading(true);
        startTransition(() => setQuickSuggestions(buildSeedPlaceholders(artists)));
        void refreshQuickSuggestions(artists)
            .then(suggestions => {
                if (cancelled) return;
                startTransition(() => setQuickSuggestions(suggestions.length > 0 ? suggestions : buildSeedPlaceholders(artists)));
            })
            .catch(() => { if (!cancelled) setArtistError(prev => prev || t('onboarding.tasteArtists.error')); })
            .finally(() => { if (!cancelled) setQuickLoading(false); });
        return () => { cancelled = true; };
    }, [artists, refreshQuickSuggestions, step, t]);

    const resolveArtistArtwork = useCallback(async (artist: OnboardingTasteArtist) => {
        const currentArtwork = artistArtworkOverrides.get(artist.id) ?? artist.artworkUrl;
        if (currentArtwork && !isBlockedTidalArtworkUrl(currentArtwork)) return;
        if (artistArtworkAttempted.current.has(artist.id)) return;
        artistArtworkAttempted.current.add(artist.id);
        try {
            const info = await getTidalArtistInfo(artist.id);
            let nextArtwork = info.artworkUrl;
            if (!nextArtwork || nextArtwork.includes('00000000') || !nextArtwork.includes('http') || isBlockedTidalArtworkUrl(nextArtwork)) {
                const fallback = await fetchQuickSuggestionArtwork(artist.name);
                if (fallback) nextArtwork = fallback;
            }
            if (!nextArtwork) return;
            setArtistArtworkOverrides(prev => { const next = new Map(prev); next.set(artist.id, nextArtwork); return next; });
        } catch {
            const fallback = await fetchQuickSuggestionArtwork(artist.name);
            if (!fallback) return;
            setArtistArtworkOverrides(prev => { const next = new Map(prev); next.set(artist.id, fallback); return next; });
        }
    }, [artistArtworkOverrides]);

    useEffect(() => {
        if (artists.length === 0 && artistSearch.length === 0 && quickSuggestions.length === 0) return;
        const quickArtists = quickSuggestions
            .filter((a): a is QuickSuggestion & { id: number } => typeof a.id === 'number')
            .map(a => ({ id: a.id, name: a.name, artworkUrl: isBlockedTidalArtworkUrl(a.artworkUrl) ? undefined : a.artworkUrl || undefined }));
        const merged = [...artists, ...artistSearch, ...quickArtists];
        for (const artist of merged) {
            if (!artist.artworkUrl || isBlockedTidalArtworkUrl(artist.artworkUrl)) void resolveArtistArtwork(artist);
        }
    }, [artistArtworkOverrides, artistSearch, artists, quickSuggestions, resolveArtistArtwork]);

    const getArtworkUrl = useCallback(
        (artist: OnboardingTasteArtist) => artistArtworkOverrides.get(artist.id) ?? artist.artworkUrl,
        [artistArtworkOverrides],
    );

    // Dynamic colors from avatar
    const { colors: dyn, animated } = useDynamicColors(avatarUri || undefined);
    const colors = useMemo(
        () => avatarUri ? ({ ...theme.colors, ...dyn, onBackground: dyn.text, onSurfaceVariant: dyn.onSurface } as any) : theme.colors,
        [avatarUri, dyn, theme.colors],
    );

    // Navigation steps
    const steps: OnboardingStep[] = ['welcome', 'profile', 'tasteArtists', 'permissions', 'ready'];
    const stepIndex = steps.indexOf(step);

    // ── Transition animation ────────────────────────────────────────────────────
    // Single shared opacity — cleaner than opacity+translate simultaneous
    const contentOpacity = useSharedValue(1);
    const contentTranslateY = useSharedValue(0);
    const rootBg = useAnimatedStyle(() => ({
        flex: 1,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        backgroundColor: avatarUri ? animated.background.value : theme.colors.background,
    }));
    const contentStyle = useAnimatedStyle(() => ({
        flex: 1,
        opacity: contentOpacity.value,
        transform: [{ translateY: contentTranslateY.value }],
    }));

    const goTo = useCallback((next: OnboardingStep) => {
        contentOpacity.value = withTiming(0, { duration: 140, easing: Easing.in(Easing.ease) }, () => {
            contentTranslateY.value = 16;
            runOnJS(setStep)(next);
            contentTranslateY.value = withSpring(0, { damping: 20, stiffness: 200 });
            contentOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
        });
    }, [contentOpacity, contentTranslateY]);

    const next = useCallback(() => {
        const n = stepIndex + 1;
        if (n < steps.length) goTo(steps[n]);
    }, [goTo, stepIndex, steps]);

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
                setArtistSearch(curr => curr.filter(a => a.id !== match.id));
            }
        } catch {
            setArtistError(t('onboarding.tasteArtists.error'));
        }
    }, [artists.length, t, toggleArtist]);

    const pickAvatar = useCallback(async (camera = false) => {
        const perm = camera
            ? await ImagePicker.requestCameraPermissionsAsync()
            : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') return;
        const result = camera
            ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.9 })
            : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
        if (!result.canceled && result.assets[0]?.uri) setAvatarUri(result.assets[0].uri);
    }, []);

    const askMedia = useCallback(async () => {
        try {
            const result = await MediaLibrary.requestPermissionsAsync();
            setMediaGranted(result.status === 'granted');
        } catch { }
    }, []);

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
                setStep('building');
                try {
                    const payload = await buildOnboardingMirrorPlaylist({ artists });
                    applyOnboardingMirrorPlaylist(payload);
                    markTastePlaylistGenerated(Date.now());
                } catch {
                    setTastePlaylistStatus('failed');
                }
            } else {
                setTastePlaylistStatus('idle');
            }
            completeOnboarding();
            if (rootNavigationState?.key) router.replace('/');
        } finally {
            setIsFinishing(false);
        }
    }, [artists, avatarUri, completeOnboarding, isFinishing, markTastePlaylistGenerated, name, rootNavigationState?.key, setTasteArtists, setTastePlaylistStatus, setTasteProfileVersion, setTasteTrackIds, setUserAvatarUri, setUserName]);

    const showHeader = step !== 'welcome' && step !== 'building';
    const stepTitle =
        step === 'profile' ? 'Tu perfil'
            : step === 'tasteArtists' ? t('onboarding.tasteArtists.title')
                : step === 'permissions' ? 'Permisos'
                    : step === 'ready' ? '¡Todo listo!'
                        : '';
    const stepSubtitle =
        step === 'profile' ? 'Ajusta lo básico en segundos.'
            : step === 'tasteArtists' ? t('onboarding.tasteArtists.subtitle')
                : step === 'permissions' ? 'Solo lo necesario para tu música.'
                    : '';

    return (
        <Animated.View style={rootBg}>
            {/* ── Header ──────────────────────────────────────────────────── */}
            {showHeader && (
                <View style={styles.header}>
                    <StepProgressBar total={steps.length} current={stepIndex} colors={colors} />
                    <Text style={[styles.headerTitle, { color: colors.onBackground }]} accessibilityRole="header">
                        {stepTitle}
                    </Text>
                    {stepSubtitle ? (
                        <Text style={[styles.headerSubtitle, { color: colors.onSurfaceVariant }]}>
                            {stepSubtitle}
                        </Text>
                    ) : null}
                </View>
            )}

            {/* ── Content ─────────────────────────────────────────────────── */}
            <Animated.View style={[styles.body, contentStyle]}>
                {step === 'welcome' && <WelcomeStep onNext={next} colors={colors} />}

                {step === 'profile' && (
                    <ProfileStep
                        name={name}
                        setName={setName}
                        avatarUri={avatarUri}
                        onPickAvatar={pickAvatar}
                        onNext={next}
                        onSkip={next}
                        colors={colors}
                    />
                )}

                {step === 'tasteArtists' && (
                    <TasteArtistsStep
                        artists={artists}
                        quickSuggestions={quickSuggestions}
                        quickLoading={quickLoading}
                        artistSearch={artistSearch}
                        artistLoading={artistLoading}
                        artistError={artistError}
                        query={query}
                        setQuery={setQuery}
                        onToggle={toggleArtist}
                        onAddSeed={addSeed}
                        onNext={next}
                        onSkip={next}
                        getArtworkUrl={getArtworkUrl}
                        colors={colors}
                        t={t}
                    />
                )}

                {step === 'permissions' && (
                    <PermissionsStep
                        onAskMedia={askMedia}
                        onNext={next}
                        colors={colors}
                        mediaGranted={mediaGranted}
                    />
                )}

                {step === 'ready' && (
                    <ReadyStep
                        name={name}
                        avatarUri={avatarUri}
                        onFinish={finish}
                        isFinishing={isFinishing}
                        colors={colors}
                    />
                )}

                {step === 'building' && <BuildingStep colors={colors} />}
            </Animated.View>
        </Animated.View>
    );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    // Layout
    header: { paddingHorizontal: 24, paddingTop: 16, gap: 8 },
    body: { flex: 1, paddingHorizontal: 24, paddingTop: 10, paddingBottom: 8 },
    full: { flex: 1, gap: 12 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20 },

    // Progress bar
    progressTrack: { height: 3, borderRadius: 999, overflow: 'hidden', marginBottom: 2 },
    progressFill: { height: '100%', borderRadius: 999 },

    // Header text
    headerTitle: { ...typeScale.headline, letterSpacing: -0.4 },
    headerSubtitle: { ...typeScale.bodyStrong, lineHeight: 20 },

    // Welcome
    welcomeTexts: { alignItems: 'center', gap: 6 },
    welcomeCta: { width: '100%', marginTop: 8 },
    hero: { ...typeScale.hero, letterSpacing: -1, textAlign: 'center' },
    sub: { ...typeScale.bodyStrong, textAlign: 'center' },

    // Logo
    logo: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    logoImg: { width: 112, height: 112 },

    // Avatar
    avatar: { width: 110, height: 110, borderRadius: 55, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    avatarImg: { width: '100%', height: '100%' },
    avatarPlaceholder: { alignItems: 'center', gap: 4 },
    avatarHint: { ...typeScale.micro },
    avatarFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
    avatarActions: { flexDirection: 'row', borderRadius: 20, overflow: 'hidden', marginTop: 2 },
    avatarActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8 },
    avatarActionText: { ...typeScale.bodyStrong, fontSize: 13 },
    avatarActionDivider: { width: StyleSheet.hairlineWidth },

    // Profile
    profileScroll: { flexGrow: 1, paddingBottom: 16 },
    profileContent: { flexGrow: 1, gap: 28, paddingTop: 16 },
    profileHero: { alignItems: 'center', gap: 12, paddingTop: 16 },

    // Input
    inputRow: { minHeight: 50, borderRadius: 14, borderWidth: 1.3, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
    inputText: { ...typeScale.bodyStrong, flex: 1, paddingVertical: 12 },
    searchRow: { minHeight: 50, borderRadius: 14, borderWidth: 1.3, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },

    // Buttons
    btn: { minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    btnText: { ...typeScale.title, fontSize: 16, textAlign: 'center' },
    skipBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 4 },
    skip: { ...typeScale.bodyStrong, fontSize: 14, textAlign: 'center' },
    footerActions: { gap: 10, paddingTop: 8 },

    // Artist chips
    chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' },
    chipAvatar: { width: 18, height: 18, borderRadius: 999, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    chipAvatarImg: { width: '100%', height: '100%' },
    chipText: { ...typeScale.body, fontSize: 13, maxWidth: 140 },

    // Section headers
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sectionLabel: { ...typeScale.caption, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', flex: 1 },

    // Counter
    counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    counterText: { ...typeScale.caption, fontSize: 13 },
    counterHint: { ...typeScale.caption, fontSize: 12 },

    // Artist grid
    list: { flex: 1, minHeight: 160 },
    artistScroller: { paddingBottom: 18, gap: 16 },
    artistGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
    artistCell: { width: '33.333%', paddingHorizontal: 5, marginBottom: 14 },
    artistPoster: { gap: 8 },
    artistPortrait: { width: '100%', aspectRatio: 1, borderRadius: 999, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    artistPortraitImg: { width: '100%', height: '100%' },
    selectedBadge: { position: 'absolute', right: 4, bottom: 4, width: 20, height: 20, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
    artistPosterName: { ...typeScale.bodyStrong, fontSize: 12, textAlign: 'center', lineHeight: 16 },

    // Meta
    meta: { ...typeScale.body, lineHeight: 20, textAlign: 'center' },

    // Permissions
    permIntro: { ...typeScale.body, lineHeight: 22 },
    permItem: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
    permIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    permTexts: { flex: 1, gap: 3 },
    permTitle: { ...typeScale.bodyStrong },
    permDesc: { ...typeScale.caption, lineHeight: 18 },

    // Ready
    heroSmall: { ...typeScale.headline, textAlign: 'center' },
    readyTexts: { alignItems: 'center', gap: 8 },
    readySubtitle: { ...typeScale.body, textAlign: 'center', lineHeight: 22, maxWidth: 280 },
    readyCta: { width: '100%', marginTop: 8 },
    readyBadge: { position: 'absolute', right: 2, bottom: 2, width: 26, height: 26, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },

    // Building
    buildingStage: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: 20 },
    buildingIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
    buildingCopy: { ...typeScale.bodyStrong, textAlign: 'center', lineHeight: 22 },
    buildingDots: { flexDirection: 'row', gap: 10, marginTop: 8 },
    buildingDot: { width: 8, height: 8, borderRadius: 4 },
});
