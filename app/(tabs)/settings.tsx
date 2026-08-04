import { TIDAL_API_BASES, TIDAL_MIRROR_NAMES } from '@/src/services/tidalService';
import { applyDownloadedOtaUpdate, checkForAppUpdates, downloadAndInstallBinaryUpdate, getAppUpdateConfig, getInstalledVersionLabel } from '@/src/services/appUpdateService';
import { useAppUpdateStore, useLibraryStore, useNotificationStore, useSettingsStore } from '@/src/stores';
import { TidalMirrorAvailability, getTidalMirrorAvailability, getTidalMirrorOptions } from '@/src/services/tidalService';
import { useOnboardingStore } from '@/src/stores/onboardingStore';
import { useI18n } from '@/src/i18n';
import { ImmersiveGlass } from '@/src/components/ui';
import { useTheme } from '@/src/theme';
import { generateManualAccentPalette, SchemeVariant } from '@/src/theme/utils';
import { TidalQuality, Track } from '@/src/types/audio';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { ActivityIndicator, Button, IconButton, Switch, Text, TextInput } from 'react-native-paper';
import Animated, { FadeInDown, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ColorPicker, { HueSlider, Panel1, Swatches } from 'reanimated-color-picker';

// ——————————————————————————————————————————————————————————————————————————————
// reanimated-color-picker calls onChange/onComplete on the UI thread.
// We must use runOnJS to dispatch state updates back to the JS thread.

function formatMirrorSummary(availability?: TidalMirrorAvailability): string {
    if (!availability) return 'Verificando disponibilidad...';

    const state = availability.status === 'available'
        ? 'Disponible'
        : availability.status === 'slow'
            ? 'Lento'
            : 'No disponible';
    const suffix = availability.latencyMs ? ` (${availability.latencyMs} ms)` : '';
    return `${state}${suffix}`;
}

function formatMirrorCapabilities(availability?: TidalMirrorAvailability): string {
    if (!availability) return 'Búsqueda pendiente';
    return availability.supportsSearch ? 'Búsqueda disponible' : 'Búsqueda no disponible';
}

function getPrimaryMirrorOptions(availableMirrors: string[]): string[] {
    const pinnedMirrors = [
        'https://hifi.geeked.wtf',
        'https://eu-central.monochrome.tf',
        'https://api.monochrome.tf',
    ];

    return [...pinnedMirrors, ...availableMirrors.slice(0, 3)]
        .filter((mirror, index, all) => availableMirrors.includes(mirror) && all.indexOf(mirror) === index);
}

const GENERIC_METADATA_VALUES = new Set(['unknown', 'unknown title', 'unknown artist', 'unknown album', 'media', 'external', 'staysound']);

function hasRealMetadataValue(value?: string) {
    const normalized = value?.trim().toLowerCase();
    return !!normalized && !GENERIC_METADATA_VALUES.has(normalized);
}

function trackNeedsMetadataRepair(track: Track) {
    return !hasRealMetadataValue(track.title)
        || !hasRealMetadataValue(track.artist);
}

export default function SettingsScreen() {
    const {
        theme,
        config,
        setThemeMode,
        setAccentColor,
        toggleDynamicColors,
        toggleLightweightMode,
        isDark
    } = useTheme();
    const { t, locale } = useI18n();
    const insets = useSafeAreaInsets();
    const { isScanning, scanLibrary, getAllTracks, lastScanDate, repairMissingMetadata, hydrateMetadataFromTidalForLibrary } = useLibraryStore();

    const [hexInput, setHexInput] = useState(config.accentColor);
    const [tempColor, setTempColor] = useState(config.accentColor);
    const [showPicker, setShowPicker] = useState(false);
    const [showQualityModal, setShowQualityModal] = useState(false);
    const [showMirrorModal, setShowMirrorModal] = useState(false);
    const [showArtworkHydrationModal, setShowArtworkHydrationModal] = useState(false);
    const [showLegacyMirrors, setShowLegacyMirrors] = useState(false);
    const [isRepairingMetadata, setIsRepairingMetadata] = useState(false);
    const [isHydratingTidalMetadata, setIsHydratingTidalMetadata] = useState(false);
    const [artworkHydrationLogs, setArtworkHydrationLogs] = useState<string[]>([]);
    const [availableMirrors, setAvailableMirrors] = useState<string[]>(() => [
        ...TIDAL_API_BASES,
    ].filter((mirror, index, all) => all.indexOf(mirror) === index));
    const [mirrorAvailability, setMirrorAvailability] = useState<Record<string, TidalMirrorAvailability>>({});

    const {
        language, setLanguage,
        tidalDownloadQuality, setTidalDownloadQuality,
        tidalMirror, setTidalMirror,
        equalizer,
        equalizerCapabilities
    } = useSettingsStore();

    const { userName, userAvatarUri, setUserName, setUserAvatarUri } = useOnboardingStore();
    const [editingName, setEditingName] = useState(false);
    const [tempName, setTempName] = useState(userName);

    const handlePickImage = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
        });

        if (!result.canceled) {
            setUserAvatarUri(result.assets[0].uri);
        }
    };

    const handleSaveName = () => {
        setUserName(tempName);
        setEditingName(false);
    };

    const showNotification = useNotificationStore(s => s.showNotification);
    const appUpdateStatus = useAppUpdateStore(state => state.status);
    const availableBinaryRelease = useAppUpdateStore(state => state.availableBinaryRelease);
    const otaReady = useAppUpdateStore(state => state.otaReady);
    const appUpdateError = useAppUpdateStore(state => state.lastError);
    const appUpdatesConfig = getAppUpdateConfig();
    const installedVersionLabel = getInstalledVersionLabel();
    const footerVersionLabel = `STAYSOUND v${Constants.nativeApplicationVersion || Constants.expoConfig?.version || '1.0.0'}`;

    const handleAppUpdateAction = () => {
        if (!appUpdatesConfig.binaryUpdatesEnabled) {
            showNotification('Este flujo de actualizacion vive solo en StaySound release.', 'info');
            return;
        }

        if (otaReady) {
            void applyDownloadedOtaUpdate();
            return;
        }

        if (availableBinaryRelease) {
            void downloadAndInstallBinaryUpdate();
            return;
        }

        void checkForAppUpdates('manual');
    };

    const handleMirrorChange = (mirror: string) => {
        const availability = mirrorAvailability[mirror];
        setTidalMirror(mirror);
        setShowMirrorModal(false);

        if (mirror !== 'auto') {
            showNotification(t('settings.notification.mirrorSelected', { name: TIDAL_MIRROR_NAMES[mirror] }), 'success');
            if (availability && (!availability.supportsSearch || !availability.supportsStream || !availability.supportsDownload)) {
                showNotification(formatMirrorCapabilities(availability), 'warning');
            }
        } else {
            showNotification(t('settings.notification.autoMirror'), 'info');
        }
    };

    useEffect(() => {
        let cancelled = false;

        const loadMirrorState = async (force = false) => {
            const nextMirrors = await getTidalMirrorOptions({ force });
            const nextAvailability = await getTidalMirrorAvailability(nextMirrors, { force });
            if (cancelled) return;
            setAvailableMirrors(nextMirrors);
            setMirrorAvailability(nextAvailability);
        };

        void loadMirrorState(false);

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!showMirrorModal) return;
        void (async () => {
            const nextMirrors = await getTidalMirrorOptions({ force: true });
            const nextAvailability = await getTidalMirrorAvailability(nextMirrors, { force: true });
            setAvailableMirrors(nextMirrors);
            setMirrorAvailability(nextAvailability);
        })();
    }, [showMirrorModal]);

    useEffect(() => {
        setHexInput(config.accentColor);
        setTempColor(config.accentColor);
    }, [config.accentColor]);

    const allTracks = getAllTracks();
    const trackCount = allTracks.length;
    const missingMetadataCount = useMemo(
        () => allTracks.filter(trackNeedsMetadataRepair).length,
        [allTracks],
    );
    const lastScan = lastScanDate
        ? new Date(lastScanDate).toLocaleDateString(locale)
        : t('common.never');

    const handleScan = async () => {
        try {
            await scanLibrary();
            Alert.alert(t('settings.alert.scanCompleteTitle'), t('settings.alert.scanCompleteBody', { count: getAllTracks().length }));
        } catch (error) {
            Alert.alert(t('settings.alert.scanErrorTitle'), t('settings.alert.scanErrorBody'));
        }
    };

    const handleMetadataRepair = async () => {
        if (isRepairingMetadata) return;
        setIsRepairingMetadata(true);
        try {
            const repairedCount = await repairMissingMetadata();
            showNotification(`Metadata actualizada en ${repairedCount} canciones`, repairedCount > 0 ? 'success' : 'info');
        } finally {
            setIsRepairingMetadata(false);
        }
    };

    const handleHydrateMetadataFromTidal = async () => {
        if (isHydratingTidalMetadata) return;
        setArtworkHydrationLogs([]);
        setShowArtworkHydrationModal(true);
        setIsHydratingTidalMetadata(true);
        try {
            const updatedCount = await hydrateMetadataFromTidalForLibrary((message) => {
                setArtworkHydrationLogs((prev) => [...prev, message]);
            });
            showNotification(
                updatedCount > 0
                    ? `TIDAL actualizo metadata/artwork en ${updatedCount} canciones`
                    : 'No hubo cambios de metadata/artwork',
                updatedCount > 0 ? 'success' : 'info'
            );
        } catch {
            showNotification('No se pudo completar la recuperacion de metadata con TIDAL', 'error');
        } finally {
            setIsHydratingTidalMetadata(false);
        }
    };

    const colorPresets = [
        '#6750A4', // Purple
        '#006A6A', // Teal
        '#0061A4', // Blue
        '#3D662F', // Green
        '#B3261E', // Red
        '#984061', // Pink
        '#625D39', // Olive
        '#005AC1', // Azure
    ];

    // JS-thread handler (called via runOnJS from the worklet)
    const _jsSetTempColor = (hex: string) => {
        setTempColor(hex);
        setHexInput(hex);
    };

    // Worklet callbacks: reanimated-color-picker calls these on the UI thread.
    // runOnJS bridges them back to the JS thread so React state updates safely.
    const onColorPickerChange = ({ hex }: { hex: string }) => {
        'worklet';
        // No-op during drag to avoid flooding the JS thread.
    };

    const onColorPickerComplete = ({ hex }: { hex: string }) => {
        'worklet';
        runOnJS(_jsSetTempColor)(hex);
    };

    // tempColor is the single source of truth — always up-to-date on JS thread.
    const applyColor = () => {
        setAccentColor(tempColor);
        setShowPicker(false);
    };

    // Live palette preview — regenerated whenever tempColor changes
    const previewPalette = useMemo(() => {
        const color = tempColor.startsWith('#') ? tempColor : `#${tempColor}`;
        if (color.length !== 7) return null;
        try {
            return generateManualAccentPalette(
                color,
                isDark,
                (config.schemeVariant as SchemeVariant) ?? 'expressive'
            );
        } catch {
            return null;
        }
    }, [tempColor, isDark, config.schemeVariant]);
    const currentLanguageLabel = language === 'es'
        ? t('settings.language.spanish')
        : t('settings.language.english');

    const qualityDescription = {
        HI_RES_LOSSLESS: t('settings.downloads.quality.hires.short'),
        LOSSLESS: t('settings.downloads.quality.lossless.short'),
        MP3: t('settings.downloads.quality.mp3.short'),
        HIGH: t('settings.downloads.quality.high.short'),
        LOW: t('settings.downloads.quality.low.short'),
    } satisfies Record<TidalQuality, string>;

    const qualityDetails = {
        HI_RES_LOSSLESS: {
            title: t('settings.downloads.quality.hires.title'),
            desc: t('settings.downloads.quality.hires.desc'),
            adv: t('settings.downloads.quality.hires.adv'),
            icon: 'high-definition',
        },
        LOSSLESS: {
            title: t('settings.downloads.quality.lossless.title'),
            desc: t('settings.downloads.quality.lossless.desc'),
            adv: t('settings.downloads.quality.lossless.adv'),
            icon: 'disc',
        },
        MP3: {
            title: t('settings.downloads.quality.mp3.title'),
            desc: t('settings.downloads.quality.mp3.desc'),
            adv: t('settings.downloads.quality.mp3.adv'),
            icon: 'file-music-outline',
        },
        HIGH: {
            title: t('settings.downloads.quality.high.title'),
            desc: t('settings.downloads.quality.high.desc'),
            adv: t('settings.downloads.quality.high.adv'),
            icon: 'music-note-outline',
        },
        LOW: {
            title: t('settings.downloads.quality.low.title'),
            desc: t('settings.downloads.quality.low.desc'),
            adv: t('settings.downloads.quality.low.adv'),
            icon: 'leaf',
        },
    } satisfies Record<TidalQuality, { title: string; desc: string; adv: string; icon: string }>;

    const recommendedMirrors = useMemo(
        () => getPrimaryMirrorOptions(availableMirrors),
        [availableMirrors],
    );
    const legacyMirrors = useMemo(
        () => availableMirrors.filter(mirror => !recommendedMirrors.includes(mirror)),
        [availableMirrors, recommendedMirrors],
    );

    const qualityModalOptions = useMemo(
        () => ['LOSSLESS', 'MP3', 'HI_RES_LOSSLESS', 'LOW'] as TidalQuality[],
        [],
    );
    const appUpdateDescription = !appUpdatesConfig.binaryUpdatesEnabled
        ? 'Disponible solo en la build release de StaySound.'
        : otaReady
        ? 'Hay una actualizacion JS lista para aplicar.'
        : availableBinaryRelease
            ? `Nueva version ${availableBinaryRelease.versionName} disponible.`
            : appUpdateStatus === 'checking'
                ? 'Buscando nuevas versiones...'
                : appUpdateStatus === 'downloading'
                    ? 'Descargando APK nueva...'
                    : appUpdateStatus === 'installing'
                        ? 'Preparando instalacion...'
                        : appUpdateStatus === 'awaiting-install-permission'
                            ? 'Activa el permiso para instalar APKs y vuelve a tocar Actualizar.'
                            : appUpdateError
                                ? appUpdateError
                                : `Instalada ${installedVersionLabel}`;
    const appUpdateActionLabel = !appUpdatesConfig.binaryUpdatesEnabled
        ? 'Solo release'
        : otaReady
        ? 'Reiniciar'
        : availableBinaryRelease
            ? 'Actualizar'
            : 'Buscar';

    const showThemeColors = config.style === 'material3' && !config.dynamicColors;
    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={[
                styles.content,
                {
                    paddingTop: insets.top + 16,
                    paddingBottom: styles.content.paddingBottom + insets.bottom,
                },
            ]}
            showsVerticalScrollIndicator={false}
        >
            {/* ——— HERO: gradient banner + integrated profile ——— */}
            <Animated.View entering={FadeInDown.duration(520).springify().damping(16)} style={styles.heroWrap}>
                <ImmersiveGlass tone="regular" accentColor={theme.colors.primary} style={styles.hero}>
                    <Text style={[styles.heroEyebrow, { color: theme.colors.primary }]}>
                        AJUSTES
                    </Text>

                    <View style={styles.heroProfileRow}>
                        <Pressable onPress={handlePickImage} style={styles.avatarContainer}>
                            <View style={[styles.avatarCircle, { borderColor: theme.colors.outline + '55', backgroundColor: theme.colors.surfaceVariant + '88' }]}>
                                {userAvatarUri ? (
                                    <Image source={{ uri: userAvatarUri }} style={styles.avatarImage} />
                                ) : (
                                    <View style={[styles.avatarPlaceholder, { backgroundColor: theme.colors.primaryContainer }]}>
                                        <Text style={{ color: theme.colors.onPrimaryContainer, fontSize: 30, fontWeight: '800' }}>
                                            {userName ? userName.charAt(0).toUpperCase() : 'U'}
                                        </Text>
                                    </View>
                                )}
                                <View style={[styles.avatarBadge, { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.surface }]}>
                                    <MaterialCommunityIcons name="camera" size={13} color={theme.colors.onPrimaryContainer} />
                                </View>
                            </View>
                        </Pressable>

                        <View style={styles.heroMeta}>
                            {editingName ? (
                                <View style={styles.nameEditGroup}>
                                    <TextInput
                                        value={tempName}
                                        onChangeText={setTempName}
                                        mode="flat"
                                        dense
                                        autoFocus
                                        underlineColor={theme.colors.outline + '66'}
                                        activeUnderlineColor={theme.colors.primary}
                                        textColor={theme.colors.onSurface}
                                        style={{ flex: 1, backgroundColor: 'transparent' }}
                                        placeholder={t('settings.profile.namePlaceholder')}
                                    />
                                    <IconButton
                                        icon="check"
                                        mode="contained"
                                        containerColor={theme.colors.primaryContainer}
                                        iconColor={theme.colors.onPrimaryContainer}
                                        onPress={handleSaveName}
                                        size={18}
                                    />
                                </View>
                            ) : (
                                <Pressable onPress={() => { setTempName(userName); setEditingName(true); }} style={styles.nameActionRow}>
                                    <Text variant="headlineSmall" numberOfLines={1} style={{ color: theme.colors.onSurface, fontWeight: '800', flexShrink: 1 }}>
                                        {userName || 'StaySound User'}
                                    </Text>
                                    <MaterialCommunityIcons name="pencil" size={16} color={theme.colors.primary} style={{ marginLeft: 8, opacity: 0.85 }} />
                                </Pressable>
                            )}
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, opacity: 0.82, marginTop: 2 }}>
                                Personaliza tu experiencia StaySound
                            </Text>
                        </View>
                    </View>
                </ImmersiveGlass>
            </Animated.View>

            {/* ——— Idioma ——— */}
            <Section title={t('settings.section.language')} index={1} theme={theme}>
                <View style={styles.languageContainer}>
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
                        {t('settings.language.desc', { language: currentLanguageLabel })}
                    </Text>
                    <View style={styles.languageSwitcher}>
                        {([
                            { value: 'es', label: 'Español' },
                            { value: 'en', label: 'English' },
                        ] as const).map((option) => {
                            const isSelected = language === option.value;
                            return (
                                <Pressable
                                    key={option.value}
                                    onPress={() => setLanguage(option.value)}
                                    style={[
                                        styles.langBubble,
                                        {
                                            backgroundColor: isSelected ? theme.colors.primary : 'transparent',
                                            borderColor: isSelected ? theme.colors.primary : theme.colors.outline + '40',
                                        },
                                    ]}
                                >
                                    <Text style={{
                                        color: isSelected ? theme.colors.onPrimary : theme.colors.onSurface,
                                        fontWeight: isSelected ? '700' : '500'
                                    }}>
                                        {option.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>
            </Section>

            {/* ——— Personalización ——— */}
            <Section title="Personalización" index={2} theme={theme}>
                <SettingRow
                    theme={theme}
                    icon="moon-waning-crescent"
                    title={t('settings.appearance.darkMode')}
                    description={config.mode === 'system' ? t('settings.appearance.followSystem') : isDark ? t('settings.appearance.on') : t('settings.appearance.off')}
                    right={<Switch value={isDark} onValueChange={() => setThemeMode(isDark ? 'light' : 'dark')} />}
                />
                <RowDivider theme={theme} />
                <SettingRow
                    theme={theme}
                    icon="auto-fix"
                    title={t('settings.appearance.dynamicColors')}
                    description="Colores basados en tu musica"
                    right={<Switch value={config.dynamicColors} onValueChange={toggleDynamicColors} />}
                />
                <RowDivider theme={theme} />
                <SettingRow
                    theme={theme}
                    icon="leaf"
                    title={t('settings.appearance.lightweightMode')}
                    description="Optimiza para dispositivos lentos"
                    right={<Switch value={config.lightweightMode} onValueChange={toggleLightweightMode} />}
                />
            </Section>

            {/* ——— Colores del tema ——— */}
            {showThemeColors && (
                <Section title={t('settings.section.themeColors')} index={3} theme={theme}>
                    <View style={styles.colorSelectionBody}>
                        <Text variant="labelSmall" style={styles.colorSectionLabel}>
                            Preajustes recomendados
                        </Text>
                        <View style={styles.colorGrid}>
                            {colorPresets.map((color) => (
                                <Pressable
                                    key={color}
                                    onPress={() => setAccentColor(color)}
                                    style={[
                                        styles.colorDot,
                                        { backgroundColor: color },
                                        config.accentColor === color && {
                                            borderColor: theme.colors.onSurface,
                                            borderWidth: 2,
                                            transform: [{ scale: 1.1 }]
                                        }
                                    ]}
                                />
                            ))}
                        </View>

                        <View style={[styles.rowDivider, { backgroundColor: theme.colors.outline + '22', marginLeft: 0, marginVertical: 16 }]} />

                        <Pressable
                            style={[styles.customColorTile, { backgroundColor: theme.colors.surfaceVariant + '30' }]}
                            onPress={() => setShowPicker(true)}
                        >
                            <View style={styles.customColorInfo}>
                                <View style={[styles.colorPreview, { backgroundColor: config.accentColor }]} />
                                <View>
                                    <Text variant="labelLarge" style={{ fontWeight: '700' }}>Color personalizado</Text>
                                    <Text variant="bodySmall">{config.accentColor.toUpperCase()}</Text>
                                </View>
                            </View>
                            <MaterialCommunityIcons name="palette-swatch" size={24} color={theme.colors.primary} />
                        </Pressable>

                        {/* Bottom-sheet modal color picker */}
                        <Modal
                            visible={showPicker}
                            transparent
                            animationType="slide"
                            onRequestClose={() => setShowPicker(false)}
                        >
                            <View style={styles.modalOverlay}>
                                <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, paddingBottom: Math.max(60, insets.bottom + 32) }]}>
                                    <View style={styles.modalHeader}>
                                        <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>
                                            {t('settings.theme.chooseColor')}
                                        </Text>
                                        <Pressable onPress={() => setShowPicker(false)} hitSlop={12}>
                                            <MaterialCommunityIcons name="close" size={24} color={theme.colors.onSurfaceVariant} />
                                        </Pressable>
                                    </View>

                                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16 }} style={{ flexGrow: 0 }}>
                                        <ColorPicker
                                            value={tempColor}
                                            onComplete={onColorPickerComplete}
                                            style={{ width: '100%', gap: 16 }}
                                        >
                                            <Panel1 style={styles.pickerPanel} />
                                            <HueSlider style={styles.pickerSlider} />
                                            <Swatches colors={colorPresets} style={styles.swatches} swatchStyle={styles.swatchItem} />
                                        </ColorPicker>

                                        {previewPalette && (
                                            <View style={styles.palettePreview}>
                                                <Text variant="labelSmall" style={styles.paletteLabel}>Paleta generada</Text>
                                                <View style={styles.paletteRow}>
                                                    <View style={[styles.paletteChip, { backgroundColor: previewPalette.primary }]}>
                                                        <Text style={{ color: previewPalette.onPrimary, fontSize: 10 }}>Primary</Text>
                                                    </View>
                                                    <View style={[styles.paletteChip, { backgroundColor: previewPalette.secondary }]}>
                                                        <Text style={{ color: previewPalette.onSecondary, fontSize: 10 }}>Secondary</Text>
                                                    </View>
                                                    <View style={[styles.paletteChip, { backgroundColor: previewPalette.tertiary }]}>
                                                        <Text style={{ color: previewPalette.onTertiary, fontSize: 10 }}>Tertiary</Text>
                                                    </View>
                                                </View>
                                            </View>
                                        )}

                                        <View style={styles.hexRow}>
                                            <TextInput
                                                label="HEX"
                                                value={hexInput.toUpperCase()}
                                                onChangeText={setHexInput}
                                                mode="outlined"
                                                dense
                                                style={{ flex: 1 }}
                                            />
                                            <Button mode="contained" onPress={applyColor} style={styles.applyBtn}>
                                                {t('common.apply')}
                                            </Button>
                                        </View>
                                    </ScrollView>
                                </View>
                            </View>
                        </Modal>
                    </View>
                </Section>
            )}

            {/* ——— Audio & Motor ——— */}
            <Section title="Audio & Motor" index={4} theme={theme}>
                <SettingRow
                    theme={theme}
                    icon="tune-variant"
                    title={t('settings.playback.equalizer')}
                    description={equalizer.mode === 'system' ? 'Controlado por el sistema' : 'Motor DSP de StaySound'}
                    onPress={() => router.push('/equalizer')}
                />
                <RowDivider theme={theme} />
                <SettingRow
                    theme={theme}
                    icon="folder-music-outline"
                    title="Biblioteca de Musica"
                    description={isScanning ? 'Escaneando archivos...' : missingMetadataCount > 0 ? `${trackCount} pistas, ${missingMetadataCount} sin metadata` : `${trackCount} pistas encontradas`}
                    onPress={handleScan}
                    disabled={isScanning || isRepairingMetadata}
                    right={isScanning || isRepairingMetadata ? (
                        <ActivityIndicator size="small" />
                    ) : missingMetadataCount > 0 ? (
                        <Button mode="contained-tonal" compact onPress={handleMetadataRepair}>
                            Metadata
                        </Button>
                    ) : (
                        <MaterialCommunityIcons name="refresh" size={20} color={theme.colors.primary} />
                    )}
                />
                <RowDivider theme={theme} />
                <SettingRow
                    theme={theme}
                    icon="database-search-outline"
                    title="Encontrar metadata en TIDAL"
                    description="Busca solo artwork faltante en tu biblioteca usando TIDAL"
                    onPress={handleHydrateMetadataFromTidal}
                    disabled={isHydratingTidalMetadata || isScanning || isRepairingMetadata}
                    right={isHydratingTidalMetadata ? (
                        <ActivityIndicator size="small" />
                    ) : (
                        <Button mode="contained-tonal" compact onPress={handleHydrateMetadataFromTidal}>
                            Buscar
                        </Button>
                    )}
                />
            </Section>

            {/* ——— Descargas ——— */}
            <Section title="Descargas" index={5} theme={theme}>
                <SettingRow
                    theme={theme}
                    icon="download-circle-outline"
                    title="Calidad preferida"
                    description={qualityDescription[tidalDownloadQuality]}
                    onPress={() => setShowQualityModal(true)}
                />
                <RowDivider theme={theme} />
                <SettingRow
                    theme={theme}
                    icon="update"
                    title="Actualizacion de la app"
                    description={appUpdateDescription}
                    onPress={handleAppUpdateAction}
                    right={(
                        appUpdateStatus === 'checking' || appUpdateStatus === 'downloading' || appUpdateStatus === 'installing'
                            ? <ActivityIndicator size="small" />
                            : (
                                <Button
                                    mode={availableBinaryRelease || otaReady ? 'contained-tonal' : 'text'}
                                    onPress={handleAppUpdateAction}
                                    disabled={!appUpdatesConfig.binaryUpdatesEnabled}
                                    compact
                                >
                                    {appUpdateActionLabel}
                                </Button>
                            )
                    )}
                />
            </Section>

            {/* Modals for Quality and Mirror */}
            <Modal visible={showQualityModal} transparent animationType="fade" onRequestClose={() => setShowQualityModal(false)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, paddingBottom: Math.max(60, insets.bottom + 32) }]}>
                        <View style={styles.modalHeader}>
                            <Text variant="titleLarge">Calidad de audio</Text>
                            <IconButton icon="close" onPress={() => setShowQualityModal(false)} />
                        </View>
                        <ScrollView contentContainerStyle={{ gap: 12 }}>
                            {qualityModalOptions.map(q => (
                                <Pressable
                                    key={q}
                                    onPress={() => { setTidalDownloadQuality(q); setShowQualityModal(false); }}
                                    style={[styles.qualityOption, { borderColor: tidalDownloadQuality === q ? theme.colors.primary : theme.colors.outline + '20', borderWidth: 1, borderRadius: 16, padding: 16, backgroundColor: tidalDownloadQuality === q ? theme.colors.primary + '10' : 'transparent' }]}
                                >
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                                        <MaterialCommunityIcons name={qualityDetails[q].icon as any} size={24} color={tidalDownloadQuality === q ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                                        <View style={{ flex: 1 }}>
                                            <Text variant="titleMedium" style={{ color: tidalDownloadQuality === q ? theme.colors.primary : theme.colors.onSurface }}>{qualityDetails[q].title}</Text>
                                            <Text variant="bodySmall">{qualityDetails[q].desc}</Text>
                                        </View>
                                        {tidalDownloadQuality === q && <MaterialCommunityIcons name="check-circle" size={20} color={theme.colors.primary} />}
                                    </View>
                                </Pressable>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            <Modal visible={showMirrorModal} transparent animationType="fade" onRequestClose={() => setShowMirrorModal(false)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, paddingBottom: Math.max(60, insets.bottom + 32) }]}>
                        <View style={styles.modalHeader}>
                            <Text variant="titleLarge">Servidor de Tidal</Text>
                            <IconButton icon="close" onPress={() => setShowMirrorModal(false)} />
                        </View>
                        <ScrollView contentContainerStyle={{ gap: 12 }}>
                            <Pressable
                                onPress={() => handleMirrorChange('auto')}
                                style={[styles.qualityOption, { borderColor: tidalMirror === 'auto' ? theme.colors.primary : theme.colors.outline + '20', borderWidth: 1, borderRadius: 16, padding: 16, backgroundColor: tidalMirror === 'auto' ? theme.colors.primary + '10' : 'transparent' }]}
                            >
                                <Text variant="titleMedium">Automatico (Recomendado)</Text>
                                <Text variant="bodySmall">Selecciona el servidor mas rapido cerca de ti.</Text>
                            </Pressable>
                            {recommendedMirrors.map(m => (
                                <Pressable
                                    key={m}
                                    onPress={() => handleMirrorChange(m)}
                                    style={[styles.qualityOption, { borderColor: tidalMirror === m ? theme.colors.primary : theme.colors.outline + '20', borderWidth: 1, borderRadius: 16, padding: 16, backgroundColor: tidalMirror === m ? theme.colors.primary + '10' : 'transparent' }]}
                                >
                                    <Text variant="titleMedium">{TIDAL_MIRROR_NAMES[m] || m}</Text>
                                    <Text variant="labelSmall" style={{ opacity: 0.7 }}>{formatMirrorSummary(mirrorAvailability[m])}</Text>
                                </Pressable>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            <Modal
                visible={showArtworkHydrationModal}
                transparent
                animationType="fade"
                onRequestClose={() => {
                    if (!isHydratingTidalMetadata) setShowArtworkHydrationModal(false);
                }}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, paddingBottom: Math.max(60, insets.bottom + 32) }]}>
                        <View style={styles.modalHeader}>
                            <Text variant="titleLarge">Buscando artwork faltante</Text>
                            {!isHydratingTidalMetadata && (
                                <IconButton icon="close" onPress={() => setShowArtworkHydrationModal(false)} />
                            )}
                        </View>
                        <View style={{ paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            {isHydratingTidalMetadata && <ActivityIndicator size="small" />}
                            <Text variant="bodySmall" style={{ opacity: 0.8 }}>
                                {isHydratingTidalMetadata ? 'Procesando solo canciones sin artwork...' : 'Proceso completado'}
                            </Text>
                        </View>
                        <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 8 }}>
                            {artworkHydrationLogs.length === 0 ? (
                                <Text variant="bodySmall" style={{ opacity: 0.65 }}>Preparando...</Text>
                            ) : artworkHydrationLogs.map((line, index) => (
                                <Text key={`${line}-${index}`} variant="bodySmall" style={{ opacity: 0.88 }}>
                                    {line}
                                </Text>
                            ))}
                        </ScrollView>
                        {!isHydratingTidalMetadata && (
                            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                                <Button mode="contained-tonal" onPress={() => setShowArtworkHydrationModal(false)}>
                                    Cerrar
                                </Button>
                            </View>
                        )}
                    </View>
                </View>
            </Modal>

            <Animated.View entering={FadeInDown.delay(560).duration(500)} style={styles.footer}>
                <Image
                    source={require('@/assets/images/icon.png')}
                    style={styles.footerLogo}
                    contentFit="contain"
                />
                <Text variant="labelLarge" style={{ fontWeight: '800', opacity: 0.9 }}>{footerVersionLabel}</Text>
                <Text variant="bodySmall" style={{ opacity: 0.5 }}>{t('settings.about.madeWith')}</Text>
            </Animated.View>
        </ScrollView>
    );
}

// ——————————————————————————————————————————————————————————————————————————————
// Presentation primitives — bold, animated, reusable.

const ROW_SPRING = { damping: 20, stiffness: 240, mass: 0.6 };
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function PressableScale({
    onPress,
    disabled,
    children,
    style,
}: {
    onPress?: () => void;
    disabled?: boolean;
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
}) {
    const scale = useSharedValue(1);
    const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
    return (
        <AnimatedPressable
            onPress={onPress}
            disabled={disabled}
            onPressIn={() => { scale.value = withSpring(0.97, ROW_SPRING); }}
            onPressOut={() => { scale.value = withSpring(1, ROW_SPRING); }}
            style={[style, animStyle]}
        >
            {children}
        </AnimatedPressable>
    );
}

function SettingRow({
    theme,
    icon,
    title,
    description,
    onPress,
    right,
    disabled,
    tint,
}: {
    theme: any;
    icon: string;
    title: string;
    description?: string;
    onPress?: () => void;
    right?: React.ReactNode;
    disabled?: boolean;
    tint?: string;
}) {
    const color = tint || theme.colors.primary;
    const inner = (
        <View style={[styles.row, disabled && { opacity: 0.55 }]}>
            <View style={[styles.iconTile, { backgroundColor: color + '22' }]}>
                <MaterialCommunityIcons name={icon as any} size={22} color={color} />
            </View>
            <View style={styles.rowText}>
                <Text variant="titleMedium" numberOfLines={1} style={[styles.rowTitle, { color: theme.colors.onSurface }]}>
                    {title}
                </Text>
                {description ? (
                    <Text variant="bodySmall" numberOfLines={2} style={{ color: theme.colors.onSurfaceVariant, opacity: 0.82, marginTop: 2 }}>
                        {description}
                    </Text>
                ) : null}
            </View>
            <View style={styles.rowRight}>
                {right ?? (onPress ? (
                    <MaterialCommunityIcons name="chevron-right" size={22} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.5 }} />
                ) : null)}
            </View>
        </View>
    );

    if (onPress) {
        return <PressableScale onPress={onPress} disabled={disabled}>{inner}</PressableScale>;
    }
    return inner;
}

function RowDivider({ theme }: { theme: any }) {
    return <View style={[styles.rowDivider, { backgroundColor: theme.colors.outline + '22' }]} />;
}

function Section({
    title,
    index = 0,
    theme,
    children,
}: {
    title?: string;
    index?: number;
    theme: any;
    children: React.ReactNode;
}) {
    return (
        <Animated.View
            entering={FadeInDown.delay(90 + index * 70).duration(460).springify().damping(18)}
            style={styles.section}
        >
            {title ? (
                <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>
                    {title}
                </Text>
            ) : null}
            <ImmersiveGlass tone="quiet" style={styles.card}>
                {children}
            </ImmersiveGlass>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 16, paddingBottom: 140 },

    // ——— Hero ———
    heroWrap: {
        marginTop: 10,
        marginBottom: 28,
    },
    hero: {
        borderRadius: 30,
        padding: 20,
        overflow: 'hidden',
    },
    heroEyebrow: {
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 3,
        opacity: 0.88,
        marginBottom: 16,
    },
    heroProfileRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    heroMeta: {
        flex: 1,
        marginLeft: 16,
    },

    // ——— Profile / avatar ———
    avatarContainer: {
        position: 'relative',
    },
    avatarCircle: {
        width: 76,
        height: 76,
        borderRadius: 26,
        borderWidth: StyleSheet.hairlineWidth,
        padding: 3,
        overflow: 'visible',
    },
    avatarImage: {
        width: '100%',
        height: '100%',
        borderRadius: 21,
    },
    avatarPlaceholder: {
        width: '100%',
        height: '100%',
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarBadge: {
        position: 'absolute',
        bottom: -4,
        right: -4,
        width: 28,
        height: 28,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
    },
    nameActionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 2,
    },
    nameEditGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    // ——— Sections / cards / rows ———
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        marginLeft: 6,
        marginBottom: 10,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 1.8,
        fontSize: 11,
        opacity: 0.75,
    },
    card: {
        borderRadius: 26,
        overflow: 'hidden',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        minHeight: 66,
    },
    iconTile: {
        width: 40,
        height: 40,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
    },
    rowText: {
        flex: 1,
    },
    rowTitle: {
        fontWeight: '700',
    },
    rowRight: {
        marginLeft: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rowDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 70,
    },

    // ——— Language switcher ———
    languageContainer: {
        padding: 16,
    },
    languageSwitcher: {
        flexDirection: 'row',
        gap: 10,
    },
    langBubble: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 16,
        borderWidth: 1,
        alignItems: 'center',
    },

    // ——— Color controls ———
    colorSelectionBody: {
        padding: 16,
    },
    colorSectionLabel: {
        marginBottom: 12,
        opacity: 0.6,
        fontWeight: '700',
    },
    colorGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    colorDot: {
        width: 42,
        height: 42,
        borderRadius: 21,
    },
    customColorTile: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderRadius: 16,
    },
    customColorInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    colorPreview: {
        width: 32,
        height: 32,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
    },

    // ——— Modals ———
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.8)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        padding: 24,
        paddingBottom: 60,
        maxHeight: '90%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },

    // ——— Picker ———
    pickerPanel: { height: 220, borderRadius: 24 },
    pickerSlider: { height: 24, borderRadius: 12, marginTop: 12 },
    swatches: { marginTop: 16 },
    swatchItem: { width: 34, height: 34, borderRadius: 17 },

    // ——— Footer ———
    footer: {
        paddingTop: 28,
        paddingBottom: 60,
        alignItems: 'center',
        gap: 4,
    },
    footerLogo: {
        width: 48,
        height: 48,
        marginBottom: 8,
        opacity: 0.8,
    },

    // ——— Palette preview / misc ———
    palettePreview: { gap: 10, paddingVertical: 4 },
    paletteLabel: { letterSpacing: 1, fontWeight: '700', opacity: 0.7 },
    paletteRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    paletteChip: { flex: 1, minWidth: 80, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
    hexRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
    applyBtn: { borderRadius: 16 },
    qualityOption: { marginVertical: 4 },
});
