import { LYRICS_SOURCES, type LyricsSourceId } from '@/src/services/lyricsSources';
import { LYRICS_FONT_OPTIONS, type LyricsFontId } from '@/src/components/player/lyricsFonts';
import { TIDAL_API_BASES, TIDAL_MIRROR_NAMES, getTidalMirrorOptions } from '@/src/services/tidalService';
import { applyDownloadedOtaUpdate, checkForAppUpdates, downloadAndInstallBinaryUpdate, getAppUpdateConfig, getInstalledVersionLabel } from '@/src/services/appUpdateService';
import { getSoulseekCredentials, setSoulseekCredentials } from '@/src/services/soulseekDownloadService';
import { useAppUpdateStore, useLibraryStore, useNotificationStore, useSettingsStore } from '@/src/stores';
import { useOnboardingStore } from '@/src/stores/onboardingStore';
import { useTheme } from '@/src/theme';
import type { TidalQuality, Track } from '@/src/types';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import * as ImagePicker from 'expo-image-picker';
import { router } from '@/src/navigation/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The public repo (releases); the source repo is private. */
const GITHUB_REPO_URL = 'https://github.com/Jakeblacklds/staysound-releases';

type SettingsAction = { action: string; value: string; id: string };
type NativeProps = ViewProps & {
    snapshot: string;
    appearance: Record<string, string>;
    topInset: number;
    bottomInset: number;
    onAction: (event: NativeSyntheticEvent<SettingsAction>) => void;
};
export const hasNativeSettings = Platform.OS === 'android'
    && requireOptionalNativeModule('StaySoundSettingsView') !== null;
const NativeView = hasNativeSettings ? requireNativeViewManager<NativeProps>('StaySoundSettingsView') : null;
const isMissingMetadata = (track: Track) => !track.title?.trim() || !track.artist?.trim()
    || ['unknown', 'unknown title', 'unknown artist'].includes(track.title?.toLowerCase() ?? '');

export default function NativeSettingsScreen() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const settings = useSettingsStore();
    const update = useAppUpdateStore();
    const library = useLibraryStore();
    const onboarding = useOnboardingStore();
    const notify = useNotificationStore(s => s.showNotification);
    const [mirrors, setMirrors] = useState<string[]>(TIDAL_API_BASES);
    const [soulseekUser, setSoulseekUser] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let mounted = true;
        void getTidalMirrorOptions({ force: false }).then(next => { if (mounted) setMirrors(next); }).catch(() => {});
        void getSoulseekCredentials().then(saved => { if (mounted) setSoulseekUser(saved?.username ?? ''); }).catch(() => {});
        return () => { mounted = false; };
    }, []);

    const appearance = useMemo(() => ({
        background: theme.colors.background, surface: theme.colors.surface,
        onSurface: theme.colors.onSurface, onSurfaceVariant: theme.colors.onSurfaceVariant,
        primary: theme.colors.primary,
    }), [theme]);
    const tracks = library.getAllTracks();
    const snapshot = JSON.stringify({
        language: settings.language, mode: settings.mode, dynamicColors: settings.dynamicColors,
        lightweightMode: settings.lightweightMode, accentColor: settings.accentColor,
        spectrumTheme: settings.spectrumTheme, spectrumDelayMs: settings.spectrumDelayMs,
        userName: onboarding.userName, soulseekUser,
        quality: settings.tidalDownloadQuality, mirror: settings.tidalMirror,
        mirrorLabel: settings.tidalMirror === 'auto' ? 'Automático' : TIDAL_MIRROR_NAMES[settings.tidalMirror] ?? settings.tidalMirror,
        mirrors: mirrors.map(url => ({ url, label: TIDAL_MIRROR_NAMES[url] ?? url })),
        equalizerSummary: settings.equalizer.mode === 'system' ? 'Sistema' : settings.equalizer.enabled ? 'StaySound DSP' : 'Apagado',
        trackCount: tracks.length, missingMetadataCount: tracks.filter(isMissingMetadata).length,
        busy: busy || library.isScanning,
        lyricsSources: LYRICS_SOURCES.map(source => ({ id: source.id, label: source.label, enabled: settings.lyricsSources.includes(source.id) })),
        lyricsFonts: LYRICS_FONT_OPTIONS, lyricsFont: settings.lyricsFont,
        update: {
            enabled: getAppUpdateConfig().binaryUpdatesEnabled,
            status: update.status, otaReady: update.otaReady,
            binaryVersion: update.availableBinaryRelease?.versionName ?? '',
            error: update.lastError ?? '', installedVersion: getInstalledVersionLabel(),
        },
    });
    const onAction = useCallback(({ nativeEvent: { action, value, id } }: NativeSyntheticEvent<SettingsAction>) => {
        const run = async () => {
            switch (action) {
                case 'language': if (value === 'es' || value === 'en') settings.setLanguage(value); break;
                case 'mode': if (value === 'system' || value === 'light' || value === 'dark') settings.setThemeMode(value); break;
                case 'dynamicColors': settings.setDynamicColors(value === 'true'); break;
                case 'lightweightMode': settings.setLightweightMode(value === 'true'); break;
                case 'spectrumTheme': if (['columns', 'aurora', 'caustics', 'waveformArc', 'refractionVeil'].includes(value)) settings.setSpectrumTheme(value as typeof settings.spectrumTheme); break;
                case 'spectrumDelay': if (/^-?\d+$/.test(value.trim())) settings.setSpectrumDelayMs(Number(value)); break;
                case 'accentColor': if (/^#[\da-fA-F]{6}$/.test(value)) settings.setAccentColor(value.toUpperCase()); break;
                case 'quality': if (['LOW', 'HIGH', 'MP3', 'LOSSLESS', 'HI_RES_LOSSLESS'].includes(value)) settings.setTidalDownloadQuality(value as TidalQuality); break;
                case 'mirror': if (value === 'auto' || mirrors.includes(value)) {
                    settings.setTidalMirror(value);
                    notify(value === 'auto' ? 'Servidor automático seleccionado' : `Servidor ${TIDAL_MIRROR_NAMES[value] ?? value} seleccionado`, 'success');
                } break;
                case 'lyricsSource': settings.setLyricsSourceEnabled(id as LyricsSourceId, value === 'true'); break;
                case 'lyricsFont': if (LYRICS_FONT_OPTIONS.some(option => option.id === value)) settings.setLyricsFont(value as LyricsFontId); break;
                case 'equalizer': router.push('/equalizer'); break;
                case 'github': await Linking.openURL(GITHUB_REPO_URL); break;
                case 'name': onboarding.setUserName(value.trim()); break;
                case 'avatar': {
                    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
                    if (!result.canceled) onboarding.setUserAvatarUri(result.assets[0].uri);
                    break;
                }
                case 'soulseek': {
                    if (!value.trim() || !id.trim()) { notify('Usuario y contraseña son obligatorios', 'error'); break; }
                    await setSoulseekCredentials(value.trim(), id.trim()); setSoulseekUser(value.trim()); notify('Sesión de Soulseek guardada', 'success'); break;
                }
                case 'scan': {
                    setBusy(true);
                    try { await library.scanLibrary(); Alert.alert('Biblioteca', `${useLibraryStore.getState().getAllTracks().length} pistas encontradas`); }
                    finally { setBusy(false); }
                    break;
                }
                case 'repair': {
                    setBusy(true);
                    try { const count = await library.repairMissingMetadata(); notify(`Metadata actualizada en ${count} canciones`, 'success'); }
                    finally { setBusy(false); }
                    break;
                }
                case 'hydrate': {
                    setBusy(true);
                    try { const count = await library.hydrateMetadataFromTidalForLibrary(); notify(`TIDAL actualizó ${count} canciones`, 'success'); }
                    finally { setBusy(false); }
                    break;
                }
                case 'update': {
                    if (!getAppUpdateConfig().binaryUpdatesEnabled) break;
                    if (update.otaReady) await applyDownloadedOtaUpdate();
                    else if (update.availableBinaryRelease) await downloadAndInstallBinaryUpdate();
                    else await checkForAppUpdates('manual');
                    break;
                }
            }
        };
        void run().catch(error => notify(error instanceof Error ? error.message : 'No se pudo completar la acción', 'error'));
    }, [settings, onboarding, mirrors, library, notify, update.otaReady, update.availableBinaryRelease]);

    if (!NativeView) return null;
    return <NativeView style={styles.fill} snapshot={snapshot} appearance={appearance}
        topInset={insets.top} bottomInset={insets.bottom + 110} onAction={onAction} />;
}
const styles = StyleSheet.create({ fill: { flex: 1 } });
