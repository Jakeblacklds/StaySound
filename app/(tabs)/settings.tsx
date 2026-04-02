import { TIDAL_API_BASES, TIDAL_MIRROR_NAMES } from '@/src/services/tidalService';
import { useAuthStore, useDabAuthStore, useLibraryStore, useNotificationStore, useSettingsStore } from '@/src/stores';
import { useOnboardingStore } from '@/src/stores/onboardingStore';
import { useUIStore } from '@/src/stores/uiStore';
import { useI18n } from '@/src/i18n';
import { useTheme } from '@/src/theme';
import { generateManualAccentPalette, SchemeVariant } from '@/src/theme/utils';
import { TidalQuality } from '@/src/types/audio';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Divider, List, Switch, Text, TextInput } from 'react-native-paper';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ColorPicker, { HueSlider, Panel1, Swatches } from 'reanimated-color-picker';

// â”€â”€â”€ Worklet-safe bridge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// reanimated-color-picker calls onChange/onComplete on the UI thread.
// We must use runOnJS to dispatch state updates back to the JS thread.

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
    const { isScanning, scanLibrary, getAllTracks, lastScanDate } = useLibraryStore();
    const appSession = useAuthStore(state => state.session);
    const signOut = useAuthStore(state => state.signOut);
    const dabSession = useDabAuthStore(state => state.session);
    const dabStatus = useDabAuthStore(state => state.status);
    const signOutDab = useDabAuthStore(state => state.signOut);
    const openConfirmModal = useUIStore(state => state.openConfirmModal);

    const [hexInput, setHexInput] = useState(config.accentColor);
    const [tempColor, setTempColor] = useState(config.accentColor);
    const [showPicker, setShowPicker] = useState(false);
    const [showQualityModal, setShowQualityModal] = useState(false);
    const [showMirrorModal, setShowMirrorModal] = useState(false);
    const [showLegacyMirrors, setShowLegacyMirrors] = useState(false);

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

    const handleMirrorChange = (mirror: string) => {
        setTidalMirror(mirror);
        setShowMirrorModal(false);

        if (mirror !== 'auto') {
            showNotification(t('settings.notification.mirrorSelected', { name: TIDAL_MIRROR_NAMES[mirror] }), 'success');
        } else {
            showNotification(t('settings.notification.autoMirror'), 'info');
        }
    };

    useEffect(() => {
        setHexInput(config.accentColor);
        setTempColor(config.accentColor);
    }, [config.accentColor]);

    const trackCount = getAllTracks().length;
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

    const handleOpenDabAuth = () => {
        router.push('/dab-auth' as any);
    };

    const handleMainSignOut = () => {
        openConfirmModal({
            title: 'Cerrar sesion',
            message: 'Se cerrara la sesion de StaySound en este dispositivo y volveras a la pantalla de acceso.',
            confirmLabel: 'Cerrar sesion',
            cancelLabel: 'Cancelar',
            isDestructive: true,
            onConfirm: () => {
                void signOut();
                showNotification('La sesion de StaySound se cerro en este dispositivo.', 'info');
            },
        });
    };

    const handleDabSignOut = async () => {
        await signOutDab();
        showNotification('La cuenta de DAB se cerro en este dispositivo.', 'info');
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

    // tempColor is the single source of truth â€” always up-to-date on JS thread.
    const applyColor = () => {
        setAccentColor(tempColor);
        setShowPicker(false);
    };

    // Live palette preview â€” regenerated whenever tempColor changes
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
        () => [
            'https://hifi.geeked.wtf',
            'https://beta.dabmusic.xyz',
            'https://dabmusic.xyz/api',
        ],
        [],
    );
    const legacyMirrors = useMemo(
        () => TIDAL_API_BASES.filter(mirror => !recommendedMirrors.includes(mirror)),
        [recommendedMirrors],
    );
    const qualityModalOptions = useMemo(
        () => ['LOSSLESS', 'MP3', 'HI_RES_LOSSLESS', 'LOW'] as TidalQuality[],
        [],
    );

    const sectionSurfaceStyle = {
        backgroundColor: 'transparent' as const,
        borderColor: 'transparent',
        borderWidth: 0,
    };

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            contentContainerStyle={[styles.content, { paddingBottom: styles.content.paddingBottom + insets.bottom }]}
        >
            <View style={styles.heroCard}>
                <Text variant="headlineMedium" style={{ color: theme.colors.onBackground, fontWeight: '800' }}>
                    {t('settings.section.appearance')}
                </Text>
            </View>

            {/* Profile Section */}
            <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                {t('settings.section.profile')}
            </Text>

            <View style={[styles.section, sectionSurfaceStyle]}>
                <View style={styles.profileItem}>
                    <Pressable onPress={handlePickImage} style={styles.avatarWrapper}>
                        <View style={[styles.avatarCircle, { borderColor: theme.colors.outline + '30', backgroundColor: theme.colors.surfaceVariant }]}>
                            {userAvatarUri ? (
                                <Image source={{ uri: userAvatarUri }} style={styles.avatarImage} />
                            ) : (
                                <View style={[styles.avatarPlaceholder, { backgroundColor: theme.colors.primaryContainer }]}>
                                    <Text style={{ color: theme.colors.primary, fontSize: 24, fontWeight: '800' }}>
                                        {userName ? userName.charAt(0).toUpperCase() : 'U'}
                                    </Text>
                                </View>
                            )}
                            <View style={[styles.editBadge, { backgroundColor: theme.colors.primary, borderColor: theme.colors.surface }]}>
                                <MaterialCommunityIcons name="pencil" size={12} color={theme.colors.onPrimary} />
                            </View>
                        </View>
                    </Pressable>

                    <View style={styles.profileInfo}>
                        {editingName ? (
                            <View style={styles.nameEditRow}>
                                <TextInput
                                    value={tempName}
                                    onChangeText={setTempName}
                                    mode="outlined"
                                    dense
                                    autoFocus
                                    style={{ flex: 1, backgroundColor: 'transparent' }}
                                    placeholder={t('settings.profile.namePlaceholder')}
                                />
                                <Button onPress={handleSaveName} mode="contained" compact style={{ marginLeft: 8 }}>
                                    âœ“
                                </Button>
                            </View>
                        ) : (
                            <Pressable onPress={() => { setTempName(userName); setEditingName(true); }} style={styles.nameRow}>
                                <Text variant="titleLarge" style={{ color: theme.colors.onSurface, fontWeight: '700' }}>
                                    {userName || 'StaySound'}
                                </Text>
                                <MaterialCommunityIcons name="pencil-outline" size={16} color={theme.colors.primary} style={{ marginLeft: 8 }} />
                            </Pressable>
                        )}
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                            {t('settings.profile.tapToEdit')}
                        </Text>
                    </View>
                </View>
            </View>

            <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                Cuenta
            </Text>

            <View style={[styles.section, sectionSurfaceStyle]}>
                <List.Item
                    title={appSession?.email || 'Cuenta principal'}
                    description={appSession
                        ? 'Sesion activa en StaySound.'
                        : 'No hay una sesion principal activa.'}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="account-circle-outline" size={24} color={theme.colors.primary} style={props.style} />}
                />
                {appSession ? (
                    <>
                        <Divider />
                        <List.Item
                            title="Cerrar sesion de StaySound"
                            description="Cierra la cuenta principal de esta app en el dispositivo."
                            titleStyle={{ color: theme.colors.onSurface }}
                            descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                            left={(props) => <MaterialCommunityIcons name="logout-variant" size={24} color={theme.colors.error} style={props.style} />}
                            onPress={handleMainSignOut}
                        />
                    </>
                ) : null}
            </View>

            <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                DAB
            </Text>

            <View style={[styles.section, sectionSurfaceStyle]}>
                <List.Item
                    title={dabSession ? (dabSession.username || dabSession.email) : 'Cuenta no conectada'}
                    description={dabSession
                        ? `Sesion activa con ${dabSession.email}`
                        : dabStatus === 'loading'
                            ? 'Validando sesion de DAB...'
                            : 'Conecta o crea una cuenta personal para usar DAB.'}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="account-music-outline" size={24} color={theme.colors.primary} style={props.style} />}
                    right={() => (
                        <Button mode={dabSession ? 'outlined' : 'contained'} compact onPress={handleOpenDabAuth}>
                            {dabSession ? 'Gestionar' : 'Conectar'}
                        </Button>
                    )}
                />
                {dabSession ? (
                    <>
                        <Divider />
                        <List.Item
                            title="Cerrar sesion de DAB"
                            description="Borra la sesion local y deja de usar esta cuenta en el dispositivo."
                            titleStyle={{ color: theme.colors.onSurface }}
                            descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                            left={(props) => <MaterialCommunityIcons name="logout" size={24} color={theme.colors.error} style={props.style} />}
                            onPress={() => { void handleDabSignOut(); }}
                        />
                    </>
                ) : null}
            </View>

            <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                {t('settings.section.language')}
            </Text>

            <View style={[styles.section, styles.sectionLoose, sectionSurfaceStyle]}>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                    {t('settings.language.desc', { language: currentLanguageLabel })}
                </Text>
                <View style={styles.languageRow}>
                    {([
                        { value: 'es', label: t('settings.language.spanish') },
                        { value: 'en', label: t('settings.language.english') },
                    ] as const).map((option) => {
                        const selected = language === option.value;
                        return (
                            <Pressable
                                key={option.value}
                                onPress={() => setLanguage(option.value)}
                                style={[
                                    styles.languageButton,
                                    {
                                        backgroundColor: selected ? `${theme.colors.primary}15` : 'transparent',
                                        borderColor: selected ? theme.colors.primary : `${theme.colors.outline}55`,
                                    },
                                ]}
                            >
                                <Text style={{ color: selected ? theme.colors.primary : theme.colors.onSurface, fontWeight: selected ? '700' : '500' }}>
                                    {option.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            {/* Appearance Section */}
            <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                {t('settings.section.appearance')}
            </Text>

            <View style={[styles.section, sectionSurfaceStyle]}>
                <List.Item
                    title={t('settings.appearance.darkMode')}
                    description={config.mode === 'system' ? t('settings.appearance.followSystem') : isDark ? t('settings.appearance.on') : t('settings.appearance.off')}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="brightness-4" size={24} color={theme.colors.primary} style={props.style} />}
                    right={() => (
                        <Switch
                            value={isDark}
                            onValueChange={() => setThemeMode(isDark ? 'light' : 'dark')}
                        />
                    )}
                />
                <Divider />
                <List.Item
                    title={t('settings.appearance.dynamicColors')}
                    description={t('settings.appearance.dynamicColorsDesc')}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="palette-swatch-outline" size={24} color={theme.colors.primary} style={props.style} />}
                    right={() => (
                        <Switch
                            value={config.dynamicColors}
                            onValueChange={toggleDynamicColors}
                        />
                    )}
                />
                <Divider />
                <List.Item
                    title={t('settings.appearance.lightweightMode')}
                    description={t('settings.appearance.lightweightModeDesc')}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="speedometer-slow" size={24} color={theme.colors.primary} style={props.style} />}
                    right={() => (
                        <Switch
                            value={config.lightweightMode}
                            onValueChange={toggleLightweightMode}
                        />
                    )}
                />
            </View>

            {/* Theme Style section removed as only Material 3 is supported */}

            {/* Color Selection - Only for Material 3 without Dynamic Colors */}
            {config.style === 'material3' && !config.dynamicColors && (
                <>
                    <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                        {t('settings.section.themeColors')}
                    </Text>

                    <View style={[styles.section, styles.sectionLoose, sectionSurfaceStyle]}>

                        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
                            {t('settings.theme.suggestions')}
                        </Text>

                        <View style={styles.colorPresetsRow}>
                            {colorPresets.map((color) => (
                                <Pressable
                                    key={color}
                                    onPress={() => setAccentColor(color)}
                                    style={[
                                        styles.colorCircle,
                                        { backgroundColor: color },
                                        config.accentColor === color && {
                                            borderWidth: 2.5,
                                            borderColor: theme.colors.onSurface,
                                            transform: [{ scale: 1.12 }]
                                        }
                                    ]}
                                />
                            ))}
                        </View>

                        <Divider style={{ marginVertical: 20 }} />

                        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
                            {t('settings.theme.customColor')}
                        </Text>

                        <Pressable
                            style={[styles.colorBox, { borderColor: `${theme.colors.outline}88` }]}
                            onPress={() => {
                                setTempColor(config.accentColor);
                                setHexInput(config.accentColor);
                                setShowPicker(true);
                            }}
                        >
                            <View style={styles.colorBoxLeft}>
                                <View style={[styles.colorSwatch, { backgroundColor: config.accentColor }]} />
                                <Text style={{ color: theme.colors.onSurface, fontWeight: '600', letterSpacing: 0.5 }}>
                                    {config.accentColor.toUpperCase()}
                                </Text>
                            </View>
                            <MaterialCommunityIcons name="palette-outline" size={24} color={theme.colors.primary} />
                        </Pressable>

                        {/* Bottom-sheet modal color picker */}
                        <Modal
                            visible={showPicker}
                            transparent
                            animationType="slide"
                            onRequestClose={() => setShowPicker(false)}
                        >
                            <View style={styles.modalOverlay}>
                                <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
                                    {/* Fixed header */}
                                    <View style={styles.modalHeader}>
                                        <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>
                                            {t('settings.theme.chooseColor')}
                                        </Text>
                                        <Pressable onPress={() => setShowPicker(false)} hitSlop={12}>
                                            <MaterialCommunityIcons name="close" size={24} color={theme.colors.onSurfaceVariant} />
                                        </Pressable>
                                    </View>

                                    {/* Scrollable body */}
                                    <ScrollView
                                        showsVerticalScrollIndicator={false}
                                        keyboardShouldPersistTaps="handled"
                                        contentContainerStyle={{ gap: 16 }}
                                        style={{ flexGrow: 0 }}
                                        nestedScrollEnabled
                                    >
                                        <ColorPicker
                                            value={tempColor}
                                            onComplete={onColorPickerComplete}
                                            style={{ width: '100%', gap: 16 }}
                                        >
                                            <Panel1 style={styles.pickerPanel} />
                                            <HueSlider style={styles.pickerSlider} />
                                            <Swatches
                                                colors={colorPresets}
                                                style={styles.swatches}
                                                swatchStyle={styles.swatchItem}
                                            />
                                        </ColorPicker>

                                        {/* â”€â”€ Palette Preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                                        {previewPalette && (
                                            <View style={styles.palettePreview}>
                                                <Text variant="labelSmall" style={[styles.paletteLabel, { color: theme.colors.onSurfaceVariant }]}>
                                                    {t('settings.theme.generatedPalette')}
                                                </Text>

                                                {([
                                                    {
                                                        label: t('settings.theme.palette.primary'),
                                                        chips: [
                                                            { name: 'Primary', bg: previewPalette.primary, fg: previewPalette.onPrimary },
                                                            { name: 'Container', bg: previewPalette.primaryContainer, fg: previewPalette.onPrimaryContainer },
                                                        ],
                                                    },
                                                    {
                                                        label: t('settings.theme.palette.secondary'),
                                                        chips: [
                                                            { name: 'Secondary', bg: previewPalette.secondary, fg: previewPalette.onSecondary },
                                                            { name: 'Container', bg: previewPalette.secondaryContainer, fg: previewPalette.onSecondaryContainer },
                                                        ],
                                                    },
                                                    {
                                                        label: t('settings.theme.palette.tertiary'),
                                                        chips: [
                                                            { name: 'Tertiary', bg: previewPalette.tertiary, fg: previewPalette.onTertiary },
                                                            { name: 'Container', bg: previewPalette.tertiaryContainer, fg: previewPalette.onTertiaryContainer },
                                                        ],
                                                    },
                                                    {
                                                        label: t('settings.theme.palette.surfaces'),
                                                        chips: [
                                                            { name: 'Background', bg: previewPalette.background, fg: previewPalette.onBackground },
                                                            { name: 'Surface', bg: previewPalette.surface, fg: previewPalette.onSurface },
                                                            { name: 'Variant', bg: previewPalette.surfaceVariant, fg: previewPalette.onSurfaceVariant },
                                                        ],
                                                    },
                                                    {
                                                        label: t('settings.theme.palette.outlineError'),
                                                        chips: [
                                                            { name: 'Outline', bg: previewPalette.outline, fg: previewPalette.onBackground },
                                                            { name: t('settings.theme.palette.variant'), bg: previewPalette.outlineVariant ?? previewPalette.outline, fg: previewPalette.onBackground },
                                                            { name: 'Error', bg: previewPalette.error, fg: previewPalette.onError },
                                                        ],
                                                    },
                                                ] as { label: string; chips: { name: string; bg: string; fg: string }[] }[]).map((group) => (
                                                    <View key={group.label} style={styles.paletteGroup}>
                                                        <Text style={[styles.paletteGroupLabel, { color: theme.colors.onSurfaceVariant }]}>
                                                            {group.label}
                                                        </Text>
                                                        <View style={styles.paletteRow}>
                                                            {group.chips.map((chip) => (
                                                                <View
                                                                    key={chip.name}
                                                                    style={[styles.paletteChip, { backgroundColor: chip.bg }]}
                                                                >
                                                                    <Text style={[styles.paletteChipLabel, { color: chip.fg }]}>
                                                                        {chip.name}
                                                                    </Text>
                                                                    <Text style={[styles.paletteChipHex, { color: chip.fg }]}>
                                                                        {chip.bg?.toUpperCase()}
                                                                    </Text>
                                                                </View>
                                                            ))}
                                                        </View>
                                                    </View>
                                                ))}
                                            </View>
                                        )}

                                        <View style={styles.hexRow}>
                                            <TextInput
                                                label="Hex"
                                                value={hexInput.toUpperCase()}
                                                onChangeText={(text) => {
                                                    setHexInput(text);
                                                    if (text.length === 7 && text.startsWith('#')) {
                                                        setTempColor(text);
                                                    }
                                                }}
                                                mode="outlined"
                                                dense
                                                style={{ flex: 1, backgroundColor: 'transparent' }}
                                                outlineColor={theme.colors.outline}
                                                activeOutlineColor={theme.colors.primary}
                                                textColor={theme.colors.onSurface}
                                            />
                                            <Button
                                                mode="contained"
                                                onPress={applyColor}
                                                style={styles.applyBtn}
                                            >
                                                {t('common.apply')}
                                            </Button>
                                        </View>
                                    </ScrollView>
                                </View>
                            </View>
                        </Modal>

                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>
                            {t('settings.theme.interfaceAdapts')}
                        </Text>
                    </View>
                </>
            )}

            {/* Playback Section */}
            <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                {t('settings.section.playback')}
            </Text>

            <View style={[styles.section, sectionSurfaceStyle]}>
                <List.Item
                    title={t('settings.playback.equalizer')}
                    description={
                        equalizer.mode === 'system'
                            ? t('equalizer.status.deviceControlled')
                            : equalizer.mode === 'app'
                                ? (equalizerCapabilities?.attached
                                    ? t('equalizer.status.staysoundReady')
                                    : t('equalizer.status.waitingForPlayback'))
                                : t('settings.playback.equalizerDesc')
                    }
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="tune" size={24} color={theme.colors.primary} style={props.style} />}
                    right={(props) => <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} style={props.style} />}
                    onPress={() => router.push('/equalizer')}
                />
                <Divider />
                <List.Item
                    title={t('settings.playback.timer')}
                    description={t('common.disabled')}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="timer-outline" size={24} color={theme.colors.primary} style={props.style} />}
                    right={(props) => <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} style={props.style} />}
                />
            </View>

            {/* Library Section */}
            <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                {t('settings.section.library')}
            </Text>

            <View style={[styles.section, sectionSurfaceStyle]}>
                <List.Item
                    title={t('settings.library.scanMusic')}
                    description={isScanning ? t('settings.library.scanning') : t('settings.library.scanSummary', { count: trackCount, lastScan })}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="magnify-scan" size={24} color={theme.colors.primary} style={props.style} />}
                    right={(props) => isScanning
                        ? <ActivityIndicator size="small" color={theme.colors.primary} />
                        : <MaterialCommunityIcons name="refresh" size={24} color={theme.colors.onSurfaceVariant} style={props.style} />
                    }
                    onPress={handleScan}
                    disabled={isScanning}
                />
            </View>

            {/* Tidal Section */}
            <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                {t('settings.section.downloads')}
            </Text>

            <View style={[styles.section, sectionSurfaceStyle]}>
                <List.Item
                    title={t('settings.downloads.quality')}
                    description={qualityDescription[tidalDownloadQuality]}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="download-circle-outline" size={24} color={theme.colors.primary} style={props.style} />}
                    right={(props) => <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} style={props.style} />}
                    onPress={() => setShowQualityModal(true)}
                />
                <Divider />
                <List.Item
                    title={t('settings.downloads.server')}
                    description={TIDAL_MIRROR_NAMES[tidalMirror] || t('common.custom')}
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="server-network" size={24} color={theme.colors.primary} style={props.style} />}
                    right={(props) => <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} style={props.style} />}
                    onPress={() => setShowMirrorModal(true)}
                />
            </View>

            {/* Mirror Selection Modal */}
            <Modal
                visible={showMirrorModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowMirrorModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, maxHeight: '80%' }]}>
                        <View style={styles.modalHeader}>
                            <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>
                                {t('settings.downloads.serverTitle')}
                            </Text>
                            <Pressable onPress={() => setShowMirrorModal(false)} hitSlop={12}>
                                <MaterialCommunityIcons name="close" size={24} color={theme.colors.onSurfaceVariant} />
                            </Pressable>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                                {t('settings.downloads.serverHint')}
                            </Text>

                            <Pressable
                                onPress={() => handleMirrorChange('auto')}
                                style={[
                                    styles.qualityOption,
                                    {
                                        backgroundColor: tidalMirror === 'auto' ? `${theme.colors.primary}15` : 'transparent',
                                        borderColor: tidalMirror === 'auto' ? theme.colors.primary : `${theme.colors.outline}33`,
                                        borderWidth: 1,
                                        borderRadius: 12,
                                        padding: 16
                                    }
                                ]}
                            >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                    <MaterialCommunityIcons name="auto-fix" size={24} color={tidalMirror === 'auto' ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                                    <View style={{ flex: 1 }}>
                                        <Text variant="titleMedium" style={{ color: tidalMirror === 'auto' ? theme.colors.primary : theme.colors.onSurface }}>
                                            {t('settings.downloads.autoRecommended')}
                                        </Text>
                                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                            {t('settings.downloads.autoDescription')}
                                        </Text>
                                    </View>
                                </View>
                            </Pressable>

                            {recommendedMirrors.map((mirror) => (
                                <Pressable
                                    key={mirror}
                                    onPress={() => handleMirrorChange(mirror)}
                                    style={[
                                        styles.qualityOption,
                                        {
                                            backgroundColor: tidalMirror === mirror ? `${theme.colors.primary}15` : 'transparent',
                                            borderColor: tidalMirror === mirror ? theme.colors.primary : `${theme.colors.outline}33`,
                                            borderWidth: 1,
                                            borderRadius: 12,
                                            padding: 16
                                        }
                                    ]}
                                >
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                        <MaterialCommunityIcons name="server" size={24} color={tidalMirror === mirror ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                                        <View style={{ flex: 1 }}>
                                            <Text variant="titleMedium" style={{ color: tidalMirror === mirror ? theme.colors.primary : theme.colors.onSurface }}>
                                                {TIDAL_MIRROR_NAMES[mirror] || mirror.replace('https://', '')}
                                            </Text>
                                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                                {mirror.replace('https://', '')}
                                            </Text>
                                        </View>
                                        {tidalMirror === mirror && (
                                            <MaterialCommunityIcons name="check" size={24} color={theme.colors.primary} />
                                        )}
                                    </View>
                                </Pressable>
                            ))}

                            <Button
                                mode="text"
                                compact
                                onPress={() => setShowLegacyMirrors(value => !value)}
                                textColor={theme.colors.primary}
                                style={{ alignSelf: 'flex-start', marginTop: 4 }}
                            >
                                {showLegacyMirrors ? 'Ocultar otros servidores' : 'Mostrar otros servidores'}
                            </Button>

                            {showLegacyMirrors ? legacyMirrors.map((mirror) => (
                                <Pressable
                                    key={mirror}
                                    onPress={() => handleMirrorChange(mirror)}
                                    style={[
                                        styles.qualityOption,
                                        {
                                            backgroundColor: tidalMirror === mirror ? `${theme.colors.primary}15` : 'transparent',
                                            borderColor: tidalMirror === mirror ? theme.colors.primary : `${theme.colors.outline}33`,
                                            borderWidth: 1,
                                            borderRadius: 12,
                                            padding: 16,
                                            opacity: 0.88,
                                        }
                                    ]}
                                >
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                        <MaterialCommunityIcons name="server-outline" size={24} color={tidalMirror === mirror ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                                        <View style={{ flex: 1 }}>
                                            <Text variant="titleMedium" style={{ color: tidalMirror === mirror ? theme.colors.primary : theme.colors.onSurface }}>
                                                {TIDAL_MIRROR_NAMES[mirror] || mirror.replace('https://', '')}
                                            </Text>
                                            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                                {mirror.replace('https://', '')}
                                            </Text>
                                        </View>
                                        {tidalMirror === mirror && (
                                            <MaterialCommunityIcons name="check" size={24} color={theme.colors.primary} />
                                        )}
                                    </View>
                                </Pressable>
                            )) : null}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Quality Selection Modal */}
            <Modal
                visible={showQualityModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowQualityModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, maxHeight: '80%' }]}>
                        <View style={styles.modalHeader}>
                            <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>
                                {t('settings.downloads.audioQualityTitle')}
                            </Text>
                            <Pressable onPress={() => setShowQualityModal(false)} hitSlop={12}>
                                <MaterialCommunityIcons name="close" size={24} color={theme.colors.onSurfaceVariant} />
                            </Pressable>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                                {t('settings.downloads.audioQualityHint')}
                            </Text>

                            {qualityModalOptions.map((q) => {
                                const details = qualityDetails[q];

                                return (
                                    <Pressable
                                        key={q}
                                        onPress={() => {
                                            setTidalDownloadQuality(q);
                                            setShowQualityModal(false);
                                        }}
                                        style={[
                                            styles.qualityOption,
                                            {
                                                backgroundColor: tidalDownloadQuality === q ? `${theme.colors.primary}15` : 'transparent',
                                                borderColor: tidalDownloadQuality === q ? theme.colors.primary : `${theme.colors.outline}33`,
                                                borderWidth: 1,
                                                borderRadius: 12,
                                                padding: 16
                                            }
                                        ]}
                                    >
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                            <MaterialCommunityIcons name={details.icon as any} size={24} color={tidalDownloadQuality === q ? theme.colors.primary : theme.colors.onSurfaceVariant} />
                                            <View style={{ flex: 1 }}>
                                                <Text variant="titleMedium" style={{ color: tidalDownloadQuality === q ? theme.colors.primary : theme.colors.onSurface }}>
                                                    {details.title}
                                                </Text>
                                                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                                    {details.desc}
                                                </Text>
                                                <Text variant="labelSmall" style={{ color: theme.colors.primary, marginTop: 4, fontWeight: 'bold' }}>
                                                    {details.adv}
                                                </Text>
                                            </View>
                                            {tidalDownloadQuality === q && (
                                                <MaterialCommunityIcons name="check" size={24} color={theme.colors.primary} />
                                            )}
                                        </View>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* About */}
            <View style={styles.about}>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
                    StaySound v1.0.0
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 }}>
                    {t('settings.about.madeWith')}
                </Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 16, paddingBottom: 120 },
    heroCard: {
        paddingHorizontal: 2,
        paddingTop: 8,
        paddingBottom: 4,
        marginBottom: 12,
    },
    sectionHeader: {
        marginTop: 24,
        marginBottom: 10,
        marginLeft: 0,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        opacity: 0.92,
    },
    section: {
        borderRadius: 0,
        overflow: 'visible',
    },
    sectionLoose: {
        paddingVertical: 4,
    },
    languageRow: {
        flexDirection: 'row',
        gap: 12,
    },
    languageButton: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 13,
        alignItems: 'center',
        justifyContent: 'center',
    },
    colorPresetsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    colorCircle: {
        width: 38,
        height: 38,
        borderRadius: 19,
    },
    colorBox: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: 12,
        borderWidth: 1,
    },
    colorBoxLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    colorSwatch: {
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.72)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        padding: 24,
        paddingBottom: 48,
        maxHeight: '90%',
        gap: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    pickerPanel: {
        height: 200,
        borderRadius: 20,
    },
    pickerSlider: {
        height: 22,
        borderRadius: 11,
    },
    swatches: {
        justifyContent: 'space-between',
    },
    swatchItem: {
        width: 30,
        height: 30,
        borderRadius: 15,
    },
    preview: {
        height: 36,
        borderRadius: 10,
    },
    // Palette preview
    palettePreview: {
        gap: 10,
        paddingVertical: 4,
    },
    paletteLabel: {
        letterSpacing: 1,
        fontWeight: '700',
        marginBottom: 2,
        opacity: 0.7,
    },
    paletteGroup: {
        gap: 4,
    },
    paletteGroupLabel: {
        fontSize: 10,
        fontWeight: '600',
        letterSpacing: 0.5,
        opacity: 0.6,
        marginBottom: 2,
    },
    paletteRow: {
        flexDirection: 'row',
        gap: 6,
        flexWrap: 'wrap',
    },
    paletteChip: {
        flex: 1,
        minWidth: 80,
        borderRadius: 12,
        paddingVertical: 8,
        paddingHorizontal: 10,
        gap: 2,
    },
    paletteChipLabel: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
    paletteChipHex: {
        fontSize: 9,
        fontFamily: 'monospace',
        opacity: 0.85,
    },
    hexRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 4,
    },
    applyBtn: {
        borderRadius: 14,
    },
    qualityOption: {
        marginVertical: 4,
    },
    about: {
        marginTop: 40,
        alignItems: 'center',
    },
    profileItem: {
        padding: 20,
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatarWrapper: {
        marginRight: 20,
    },
    avatarCircle: {
        width: 80,
        height: 80,
        borderRadius: 24,
        borderWidth: 1,
        overflow: 'hidden',
        position: 'relative',
    },
    avatarImage: {
        width: '100%',
        height: '100%',
    },
    avatarPlaceholder: {
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    editBadge: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 24,
        height: 24,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
    },
    profileInfo: {
        flex: 1,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    nameEditRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
});







