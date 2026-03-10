import { TIDAL_API_BASES, TIDAL_MIRROR_NAMES } from '@/src/services/tidalService';
import { useLibraryStore, useNotificationStore, useSettingsStore } from '@/src/stores';
import { useOnboardingStore } from '@/src/stores/onboardingStore';
import { useTheme } from '@/src/theme';
import { generateM3Palette, SchemeVariant } from '@/src/theme/utils';
import { TidalQuality } from '@/src/types/audio';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Divider, List, Switch, Text, TextInput } from 'react-native-paper';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ColorPicker, { HueSlider, Panel1, Swatches } from 'reanimated-color-picker';

// ─── Worklet-safe bridge ─────────────────────────────────────────────────────
// reanimated-color-picker calls onChange/onComplete on the UI thread.
// We must use runOnJS to dispatch state updates back to the JS thread.

export default function SettingsScreen() {
    const {
        theme,
        config,
        setThemeStyle,
        setThemeMode,
        setAccentColor,
        toggleDynamicColors,
        isDark
    } = useTheme();
    const insets = useSafeAreaInsets();
    const { isScanning, scanLibrary, getAllTracks, lastScanDate } = useLibraryStore();
    const isMaterial3 = config.style === 'material3';

    const [hexInput, setHexInput] = useState(config.accentColor);
    const [tempColor, setTempColor] = useState(config.accentColor);
    const [showPicker, setShowPicker] = useState(false);
    const [showQualityModal, setShowQualityModal] = useState(false);
    const [showMirrorModal, setShowMirrorModal] = useState(false);

    const {
        tidalDownloadQuality, setTidalDownloadQuality,
        tidalMirror, setTidalMirror
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
            showNotification(`Fuente seleccionada: ${TIDAL_MIRROR_NAMES[mirror]}`, 'success');
        } else {
            showNotification('Modo automático activado', 'info');
        }
    };

    useEffect(() => {
        setHexInput(config.accentColor);
        setTempColor(config.accentColor);
    }, [config.accentColor]);

    const trackCount = getAllTracks().length;
    const lastScan = lastScanDate
        ? new Date(lastScanDate).toLocaleDateString()
        : 'Never';

    const handleScan = async () => {
        try {
            await scanLibrary();
            Alert.alert('Scan Complete', `Found ${getAllTracks().length} tracks!`);
        } catch (error) {
            Alert.alert('Scan Error', 'Failed to scan music library');
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
            return generateM3Palette(
                color,
                isDark,
                (config.schemeVariant as SchemeVariant) ?? 'expressive'
            );
        } catch {
            return null;
        }
    }, [tempColor, isDark, config.schemeVariant]);

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            contentContainerStyle={[styles.content, { paddingBottom: styles.content.paddingBottom + insets.bottom }]}
        >
            {/* Profile Section */}
            <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                PERFIL
            </Text>

            <View style={[styles.section, { backgroundColor: isMaterial3 ? `${theme.colors.surface}F0` : theme.colors.surface, borderColor: isMaterial3 ? `${theme.colors.outline}4D` : 'transparent', borderWidth: isMaterial3 ? 1 : 0 }]}>
                <View style={styles.profileItem}>
                    <Pressable onPress={handlePickImage} style={styles.avatarWrapper}>
                        <View style={[styles.avatarCircle, { borderColor: theme.colors.primary }]}>
                            {userAvatarUri ? (
                                <Image source={{ uri: userAvatarUri }} style={styles.avatarImage} />
                            ) : (
                                <View style={[styles.avatarPlaceholder, { backgroundColor: theme.colors.primaryContainer }]}>
                                    <Text style={{ color: theme.colors.primary, fontSize: 24, fontWeight: '800' }}>
                                        {userName ? userName.charAt(0).toUpperCase() : 'U'}
                                    </Text>
                                </View>
                            )}
                            <View style={[styles.editBadge, { backgroundColor: theme.colors.primary }]}>
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
                                    placeholder="Tu nombre"
                                />
                                <Button onPress={handleSaveName} mode="contained" compact style={{ marginLeft: 8 }}>
                                    ✓
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
                            Toca para editar tu información
                        </Text>
                    </View>
                </View>
            </View>

            {/* Appearance Section */}
            <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                APARIENCIA
            </Text>

            <View style={[styles.section, { backgroundColor: isMaterial3 ? `${theme.colors.surface}F0` : theme.colors.surface, borderColor: isMaterial3 ? `${theme.colors.outline}4D` : 'transparent', borderWidth: isMaterial3 ? 1 : 0 }]}>
                <List.Item
                    title="Modo Oscuro"
                    description={config.mode === 'system' ? 'Siguiendo sistema' : isDark ? 'Encendido' : 'Apagado'}
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
                    title="Colores Dinámicos"
                    description="Extraer colores de la portada"
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
            </View>

            {/* Theme Style section removed as only Material 3 is supported */}

            {/* Color Selection - Only for Material 3 without Dynamic Colors */}
            {isMaterial3 && !config.dynamicColors && (
                <>
                    <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                        COLORES DEL TEMA (M3)
                    </Text>

                    <View style={[styles.section, { padding: 16, backgroundColor: isMaterial3 ? `${theme.colors.surface}F0` : theme.colors.surface, borderColor: isMaterial3 ? `${theme.colors.outline}4D` : 'transparent', borderWidth: isMaterial3 ? 1 : 0 }]}>

                        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
                            Sugerencias:
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
                            Color personalizado:
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
                                            Elige un Color
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

                                        {/* ── Palette Preview ─────────────────── */}
                                        {previewPalette && (
                                            <View style={styles.palettePreview}>
                                                <Text variant="labelSmall" style={[styles.paletteLabel, { color: theme.colors.onSurfaceVariant }]}>
                                                    PALETA GENERADA
                                                </Text>

                                                {([
                                                    {
                                                        label: 'Primario',
                                                        chips: [
                                                            { name: 'Primary', bg: previewPalette.primary, fg: previewPalette.onPrimary },
                                                            { name: 'Container', bg: previewPalette.primaryContainer, fg: previewPalette.onPrimaryContainer },
                                                        ],
                                                    },
                                                    {
                                                        label: 'Secundario',
                                                        chips: [
                                                            { name: 'Secondary', bg: previewPalette.secondary, fg: previewPalette.onSecondary },
                                                            { name: 'Container', bg: previewPalette.secondaryContainer, fg: previewPalette.onSecondaryContainer },
                                                        ],
                                                    },
                                                    {
                                                        label: 'Terciario',
                                                        chips: [
                                                            { name: 'Tertiary', bg: previewPalette.tertiary, fg: previewPalette.onTertiary },
                                                            { name: 'Container', bg: previewPalette.tertiaryContainer, fg: previewPalette.onTertiaryContainer },
                                                        ],
                                                    },
                                                    {
                                                        label: 'Superficies',
                                                        chips: [
                                                            { name: 'Background', bg: previewPalette.background, fg: previewPalette.onBackground },
                                                            { name: 'Surface', bg: previewPalette.surface, fg: previewPalette.onSurface },
                                                            { name: 'Variant', bg: previewPalette.surfaceVariant, fg: previewPalette.onSurfaceVariant },
                                                        ],
                                                    },
                                                    {
                                                        label: 'Contornos & Error',
                                                        chips: [
                                                            { name: 'Outline', bg: previewPalette.outline, fg: previewPalette.onBackground },
                                                            { name: 'Var.', bg: previewPalette.outlineVariant ?? previewPalette.outline, fg: previewPalette.onBackground },
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
                                                Aplicar
                                            </Button>
                                        </View>
                                    </ScrollView>
                                </View>
                            </View>
                        </Modal>

                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 12 }}>
                            La interfaz completa se adapta cuando tocas Aplicar.
                        </Text>
                    </View>
                </>
            )}

            {/* Playback Section */}
            <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                REPRODUCCIÓN
            </Text>

            <View style={[styles.section, { backgroundColor: isMaterial3 ? `${theme.colors.surface}F0` : theme.colors.surface, borderColor: isMaterial3 ? `${theme.colors.outline}4D` : 'transparent', borderWidth: isMaterial3 ? 1 : 0 }]}>
                <List.Item
                    title="Ecualizador"
                    description="Ajustar frecuencias de audio"
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="tune" size={24} color={theme.colors.primary} style={props.style} />}
                    right={(props) => <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} style={props.style} />}
                />
                <Divider />
                <List.Item
                    title="Temporizador"
                    description="Desactivado"
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="timer-outline" size={24} color={theme.colors.primary} style={props.style} />}
                    right={(props) => <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} style={props.style} />}
                />
            </View>

            {/* Library Section */}
            <Text variant="titleSmall" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
                BIBLIOTECA
            </Text>

            <View style={[styles.section, { backgroundColor: isMaterial3 ? `${theme.colors.surface}F0` : theme.colors.surface, borderColor: isMaterial3 ? `${theme.colors.outline}4D` : 'transparent', borderWidth: isMaterial3 ? 1 : 0 }]}>
                <List.Item
                    title="Escanear Música"
                    description={isScanning ? 'Escaneando...' : `${trackCount} canciones • Último: ${lastScan}`}
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
                TIDAL & DESCARGAS
            </Text>

            <View style={[styles.section, { backgroundColor: isMaterial3 ? `${theme.colors.surface}F0` : theme.colors.surface, borderColor: isMaterial3 ? `${theme.colors.outline}4D` : 'transparent', borderWidth: isMaterial3 ? 1 : 0 }]}>
                <List.Item
                    title="Calidad de Descarga"
                    description={
                        tidalDownloadQuality === 'HI_RES_LOSSLESS' ? 'Máxima (Hi-Res FLAC)' :
                            tidalDownloadQuality === 'LOSSLESS' ? 'Alta (CD FLAC)' :
                                tidalDownloadQuality === 'HIGH' ? 'Buena (AAC/MP3)' : 'Básica (AAC Bajos Datos)'
                    }
                    titleStyle={{ color: theme.colors.onSurface }}
                    descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
                    left={(props) => <MaterialCommunityIcons name="download-circle-outline" size={24} color={theme.colors.primary} style={props.style} />}
                    right={(props) => <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} style={props.style} />}
                    onPress={() => setShowQualityModal(true)}
                />
                <Divider />
                <List.Item
                    title="Servidor de Descarga (Mirror)"
                    description={TIDAL_MIRROR_NAMES[tidalMirror] || 'Personalizado'}
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
                                Servidor de Tidal
                            </Text>
                            <Pressable onPress={() => setShowMirrorModal(false)} hitSlop={12}>
                                <MaterialCommunityIcons name="close" size={24} color={theme.colors.onSurfaceVariant} />
                            </Pressable>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                                Elige un servidor específico o deja en automático para rotar si uno falla.
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
                                            Automático (Recomendado)
                                        </Text>
                                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                            Prueba todos los servidores disponibles hasta encontrar uno que funcione.
                                        </Text>
                                    </View>
                                </View>
                            </Pressable>

                            {TIDAL_API_BASES.map((mirror) => (
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
                                Calidad de Audio
                            </Text>
                            <Pressable onPress={() => setShowQualityModal(false)} hitSlop={12}>
                                <MaterialCommunityIcons name="close" size={24} color={theme.colors.onSurfaceVariant} />
                            </Pressable>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                                Selecciona el formato preferido para tus descargas de Tidal.
                            </Text>

                            {(['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH', 'LOW'] as TidalQuality[]).map((q) => {
                                const details = {
                                    HI_RES_LOSSLESS: {
                                        title: 'Hi-Res Lossless (FLAC)',
                                        desc: 'Calidad de estudio (24-bit). El mejor sonido posible.',
                                        adv: '✓ Máximo detalle / ✗ Archivos gigantes (~100MB)',
                                        icon: 'high-definition'
                                    },
                                    LOSSLESS: {
                                        title: 'Lossless (FLAC)',
                                        desc: 'Calidad de CD (16-bit). Sonido puro sin pérdida.',
                                        adv: '✓ Alta fidelidad / ✗ Archivos grandes (~30-50MB)',
                                        icon: 'disc'
                                    },
                                    HIGH: {
                                        title: 'Alta (AAC/MP3)',
                                        desc: 'Excelente calidad comprimida (320kbps).',
                                        adv: '✓ Ahorro de espacio / ✓ Muy buena calidad',
                                        icon: 'music-note-outline'
                                    },
                                    LOW: {
                                        title: 'Básica (AAC)',
                                        desc: 'Calidad estándar eficiente (96kbps).',
                                        adv: '✓ Ahorro máximo / ✓ Ideal para poco espacio',
                                        icon: 'leaf'
                                    }
                                }[q];

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
                    Hecho con ❤️ usando Expo SDK 54
                </Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 16, paddingBottom: 120 },
    sectionHeader: {
        marginTop: 24,
        marginBottom: 8,
        marginLeft: 8,
        fontWeight: '600',
    },
    section: {
        borderRadius: 16,
        overflow: 'hidden',
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
        paddingVertical: 12,
        borderRadius: 16,
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
        backgroundColor: 'rgba(0,0,0,0.65)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        padding: 24,
        paddingBottom: 48,
        maxHeight: '90%',
        gap: 12,
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
        borderRadius: 12,
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
        borderRadius: 40,
        borderWidth: 2,
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
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: 'white',
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
