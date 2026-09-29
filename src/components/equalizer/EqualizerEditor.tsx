import NativeEqualizerScreen, { hasNativeEqualizerView } from '@/src/features/settings/NativeEqualizerScreen';
import { useNotificationStore, useSettingsStore } from '@/src/stores';
import { typeScale, useTheme } from '@/src/theme';
import { EqualizerBand, EqualizerPresetDefinition } from '@/src/types';
import {
    applyAndroidEqualizerPreset,
    getDisplayBandLabel,
    getDisplayGainLabel,
    getNativePresetId,
    getRangeLabel,
    isAndroidEqualizerAvailable,
    openAndroidSystemEqualizerPanel,
    refreshAndroidEqualizerCapabilities,
    resetAndroidEqualizerToFlat,
    setAndroidEqualizerBandLevel,
    syncAndroidEqualizerFromSettings,
} from '@/src/services/androidEqualizerService';
import { DEFAULT_EQUALIZER_PRESETS } from '@/src/services/equalizerPresets';
import { useI18n } from '@/src/i18n';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { Dimensions, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, Path, RadialGradient, Stop } from 'react-native-svg';

type PresetItem = EqualizerPresetDefinition & {
    nativePresetIndex?: number;
};

const GRAPH_HEIGHT = 330;
const HANDLE_SIZE = 24;
const GRAPH_SIDE_PADDING = 26;

export function EqualizerEditor() {
    return hasNativeEqualizerView ? <NativeEqualizerScreen /> : <ReactEqualizerEditor />;
}

function ReactEqualizerEditor() {
    const { theme } = useTheme();
    const { t } = useI18n();
    const showNotification = useNotificationStore(s => s.showNotification);
    const equalizer = useSettingsStore(s => s.equalizer);
    const capabilities = useSettingsStore(s => s.equalizerCapabilities);
    const [isLoading, setIsLoading] = useState(true);
    const [isMutating, setIsMutating] = useState(false);
    const [graphWidth, setGraphWidth] = useState(Math.max(280, Dimensions.get('window').width - 48));
    const [draftBandLevels, setDraftBandLevels] = useState<Record<number, number>>({});

    const refreshState = useCallback(async () => {
        setIsLoading(true);
        try {
            if (!isAndroidEqualizerAvailable()) {
                useSettingsStore.getState().setEqualizerCapabilities(null);
                return;
            }

            if (equalizer.mode === 'app' && equalizer.enabled) {
                await syncAndroidEqualizerFromSettings();
            } else {
                await refreshAndroidEqualizerCapabilities(false);
            }
        } catch {
            showNotification(t('equalizer.errors.refresh'), 'error');
        } finally {
            setIsLoading(false);
        }
    }, [equalizer.enabled, equalizer.mode, showNotification, t]);

    useEffect(() => {
        void refreshState();
    }, [refreshState]);

    const bands = capabilities?.bands ?? [];
    const displayBands = useMemo(() => bands.map((band) => ({
        ...band,
        level: draftBandLevels[band.index] ?? band.level,
    })), [bands, draftBandLevels]);
    const hasSystemEqualizer = !!capabilities?.canOpenSystemPanel;
    const usingIntegratedEqualizer = !hasSystemEqualizer;

    useEffect(() => {
        setDraftBandLevels((currentDraft) => {
            if (Object.keys(currentDraft).length === 0) return currentDraft;

            let changed = false;
            const nextDraft = { ...currentDraft };

            bands.forEach((band) => {
                const draftLevel = nextDraft[band.index];
                if (draftLevel == null) return;
                if (draftLevel === band.level) {
                    delete nextDraft[band.index];
                    changed = true;
                }
            });

            return changed ? nextDraft : currentDraft;
        });
    }, [bands]);
    const presetItems = useMemo<PresetItem[]>(() => {
        const nativePresets = (capabilities?.nativePresets ?? []).map((preset) => ({
            id: getNativePresetId(preset),
            labelKey: preset.name,
            nativePresetIndex: preset.index,
        }));
        return [...DEFAULT_EQUALIZER_PRESETS, ...nativePresets];
    }, [capabilities?.nativePresets]);

    const rangeTitleGroups = useMemo(() => {
        if (bands.length === 0) return [];

        const third = bands.length / 3;
        return [0, 1, 2].map((segment) => {
            const index = Math.min(bands.length - 1, Math.floor(segment * third));
            return {
                key: `${segment}`,
                label: t(getRangeLabel(index, bands.length) as any),
            };
        });
    }, [bands.length, t]);

    const canEditBands = Platform.OS === 'android'
        && usingIntegratedEqualizer
        && equalizer.enabled
        && !!capabilities?.attached
        && bands.length > 0;

    const handlePresetPress = useCallback(async (preset: PresetItem) => {
        setIsMutating(true);
        try {
            const nextCapabilities = await applyAndroidEqualizerPreset(preset.id, preset.nativePresetIndex);
            if (!nextCapabilities?.attached) {
                showNotification(t('equalizer.errors.playTrackFirst'), 'info');
            }
        } catch {
            showNotification(t('equalizer.errors.preset'), 'error');
        } finally {
            setIsMutating(false);
        }
    }, [showNotification, t]);

    const handleReset = useCallback(async () => {
        setIsMutating(true);
        try {
            const nextCapabilities = await resetAndroidEqualizerToFlat();
            if (!nextCapabilities?.attached) {
                showNotification(t('equalizer.errors.playTrackFirst'), 'info');
            }
        } catch {
            showNotification(t('equalizer.errors.preset'), 'error');
        } finally {
            setIsMutating(false);
        }
    }, [showNotification, t]);

    const handleBandPreview = useCallback((band: EqualizerBand, nextLevel: number) => {
        setDraftBandLevels((currentDraft) => {
            if (currentDraft[band.index] === nextLevel) return currentDraft;
            return {
                ...currentDraft,
                [band.index]: nextLevel,
            };
        });
    }, []);

    const handleBandCommit = useCallback(async (band: EqualizerBand, nextLevel: number) => {
        try {
            await setAndroidEqualizerBandLevel(band, nextLevel);
        } catch {
            showNotification(t('equalizer.errors.bandUpdate'), 'error');
        }
    }, [showNotification, t]);

    const handleOpenSystemEqualizer = useCallback(async () => {
        setIsMutating(true);
        try {
            const nextCapabilities = await openAndroidSystemEqualizerPanel();
            if (!nextCapabilities?.canOpenSystemPanel) {
                showNotification(t('equalizer.errors.systemUnavailable'), 'warning');
            }
        } catch {
            showNotification(t('equalizer.errors.systemUnavailable'), 'warning');
        } finally {
            setIsMutating(false);
        }
    }, [showNotification, t]);

    const statusKey = !isAndroidEqualizerAvailable()
        ? 'equalizer.status.androidOnly'
        : equalizer.mode === 'system'
            ? 'equalizer.status.deviceControlled'
            : capabilities?.attached
                ? 'equalizer.status.staysoundReady'
                : 'equalizer.status.waitingForPlayback';

    return (
        <SafeAreaView style={styles.safeArea}>
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.headerRow}>
                    <Pressable
                        onPress={() => router.back()}
                        style={[styles.headerButton, { backgroundColor: `${theme.colors.surfaceVariant}AA` }]}
                    >
                        <MaterialCommunityIcons name="chevron-left" size={24} color={theme.colors.onSurface} />
                    </Pressable>
                    <View style={styles.headerText}>
                        <Text style={[typeScale.micro, { color: theme.colors.primary }]}>{t('settings.section.playback')}</Text>
                        <Text style={[typeScale.titleLarge, { color: theme.colors.onBackground }]}>{t('settings.playback.equalizer')}</Text>
                    </View>
                    <Pressable
                        onPress={() => void refreshState()}
                        style={[styles.headerButton, { backgroundColor: `${theme.colors.surfaceVariant}AA` }]}
                    >
                        {isLoading ? (
                            <ActivityIndicator size="small" color={theme.colors.primary} />
                        ) : (
                            <MaterialCommunityIcons name="refresh" size={22} color={theme.colors.onSurface} />
                        )}
                    </Pressable>
                </View>

                <LinearGradient
                    colors={['#181818', '#12161F', `${theme.colors.primary}10`]}
                    start={{ x: 0.1, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.heroCard}
                >
                    <View style={styles.heroCopy}>
                        <Text style={[styles.heroEyebrow, { color: `${theme.colors.onSurfaceVariant}CC` }]}>
                            {t('equalizer.hero.eyebrow')}
                        </Text>
                        <Text style={[styles.heroTitle, { color: theme.colors.onBackground }]}>
                            {t('equalizer.hero.title')}
                        </Text>
                        <Text style={[styles.heroSubtitle, { color: `${theme.colors.onSurfaceVariant}D9` }]}>
                            {t(statusKey)}
                        </Text>
                    </View>

                    <View
                        style={styles.graphShell}
                        onLayout={(event) => {
                            const nextWidth = event.nativeEvent.layout.width;
                            if (nextWidth > 0) {
                                setGraphWidth(nextWidth);
                            }
                        }}
                    >
                        {rangeTitleGroups.length > 0 ? (
                            <View style={styles.rangeHeader}>
                                {rangeTitleGroups.map((item) => (
                                    <View key={item.key} style={styles.rangeCell}>
                                        <Text style={[styles.rangeText, { color: `${theme.colors.onSurfaceVariant}CC` }]}>
                                            {item.label}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        ) : null}

                        <EqualizerGraph
                            bands={displayBands}
                            graphWidth={graphWidth}
                            accentColor={theme.colors.primary}
                            textColor={theme.colors.onSurface}
                            outlineColor={theme.colors.outline}
                            disabled={!usingIntegratedEqualizer || !canEditBands}
                            onBandPreview={handleBandPreview}
                            onBandCommit={handleBandCommit}
                        />
                    </View>
                </LinearGradient>

                <View style={[styles.modeCard, { backgroundColor: `${theme.colors.surface}A8`, borderColor: `${theme.colors.outline}38` }]}>
                    <View style={styles.sectionHeading}>
                        <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
                            {t('equalizer.section.title')}
                        </Text>
                        <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
                            {t(hasSystemEqualizer ? 'equalizer.section.systemSubtitle' : 'equalizer.section.integratedSubtitle')}
                        </Text>
                    </View>

                    <View style={styles.deviceRow}>
                        <View style={[styles.statusBadge, { backgroundColor: `${theme.colors.primary}16` }]}>
                            <MaterialCommunityIcons name={hasSystemEqualizer ? 'cellphone-cog' : 'tune-vertical'} size={16} color={theme.colors.primary} />
                            <Text style={[styles.statusBadgeText, { color: theme.colors.primary }]}>
                                {t(hasSystemEqualizer ? 'equalizer.status.systemReady' : (capabilities?.audioSessionId ? 'equalizer.status.integratedReady' : 'equalizer.status.waitingShort'))}
                            </Text>
                        </View>
                        {hasSystemEqualizer ? (
                            <Button
                                mode="contained-tonal"
                                icon="open-in-new"
                                disabled={isMutating || !capabilities?.canOpenSystemPanel}
                                onPress={() => void handleOpenSystemEqualizer()}
                            >
                                {t('equalizer.openSystem')}
                            </Button>
                        ) : null}
                    </View>
                </View>

                {usingIntegratedEqualizer ? (
                    <View style={[styles.presetCard, { backgroundColor: `${theme.colors.surface}A8`, borderColor: `${theme.colors.outline}38` }]}>
                        <View style={styles.sectionHeading}>
                            <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
                                {t('equalizer.presets.title')}
                            </Text>
                            <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
                                {t('equalizer.presets.subtitle')}
                            </Text>
                        </View>

                        <View style={styles.presetWrap}>
                            {presetItems.map((preset) => {
                                const isSelected = equalizer.presetId === preset.id;
                                const label = preset.nativePresetIndex != null ? preset.labelKey : t(preset.labelKey as any);
                                return (
                                    <Pressable
                                        key={preset.id}
                                        onPress={() => void handlePresetPress(preset)}
                                        disabled={isMutating || !usingIntegratedEqualizer}
                                        style={[
                                            styles.presetChip,
                                            {
                                                backgroundColor: isSelected ? `${theme.colors.primary}18` : `${theme.colors.surfaceVariant}88`,
                                                borderColor: isSelected ? `${theme.colors.primary}55` : 'transparent',
                                            },
                                        ]}
                                    >
                                        <Text style={[styles.presetLabel, { color: isSelected ? theme.colors.primary : theme.colors.onSurfaceVariant }]}>
                                            {label}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>

                        <Button
                            mode="outlined"
                            icon="restore"
                            disabled={isMutating || !usingIntegratedEqualizer}
                            onPress={() => void handleReset()}
                        >
                            {t('equalizer.resetFlat')}
                        </Button>
                    </View>
                ) : null}
            </ScrollView>
        </SafeAreaView>
    );
}

function EqualizerGraph({
    bands,
    graphWidth,
    accentColor,
    textColor,
    outlineColor,
    disabled,
    onBandPreview,
    onBandCommit,
}: {
    bands: EqualizerBand[];
    graphWidth: number;
    accentColor: string;
    textColor: string;
    outlineColor: string;
    disabled: boolean;
    onBandPreview: (band: EqualizerBand, nextLevel: number) => void;
    onBandCommit: (band: EqualizerBand, nextLevel: number) => void;
}) {
    const graphInnerWidth = Math.max(180, graphWidth - GRAPH_SIDE_PADDING * 2);
    const bandPoints = useMemo(() => {
        if (bands.length === 0) return [];

        return bands.map((band, index) => {
            const ratio = bands.length === 1 ? 0.5 : index / (bands.length - 1);
            const x = GRAPH_SIDE_PADDING + ratio * graphInnerWidth;
            const y = levelToY(band.level, band.minLevel, band.maxLevel, GRAPH_HEIGHT);
            return { band, x, y };
        });
    }, [bands, graphInnerWidth]);

    const curvePath = useMemo(
        () => createCurvePath(graphInnerWidth + GRAPH_SIDE_PADDING * 2, GRAPH_HEIGHT, bandPoints),
        [bandPoints, graphInnerWidth]
    );
    const zeroLineY = bands.length > 0 ? levelToY(0, bands[0].minLevel, bands[0].maxLevel, GRAPH_HEIGHT) : GRAPH_HEIGHT / 2;

    return (
        <View style={styles.graphWrap}>
            <Svg width={graphInnerWidth + GRAPH_SIDE_PADDING * 2} height={GRAPH_HEIGHT + 56}>
                <Defs>
                    <RadialGradient id="eqGlow" cx="50%" cy="50%" r="65%">
                        <Stop offset="0%" stopColor={accentColor} stopOpacity="0.55" />
                        <Stop offset="100%" stopColor={accentColor} stopOpacity="0" />
                    </RadialGradient>
                </Defs>

                <Circle
                    cx={(graphInnerWidth + GRAPH_SIDE_PADDING * 2) / 2}
                    cy={GRAPH_HEIGHT / 2}
                    r={graphInnerWidth * 0.45}
                    fill="url(#eqGlow)"
                />

                <Line
                    x1={GRAPH_SIDE_PADDING}
                    y1={zeroLineY}
                    x2={graphInnerWidth + GRAPH_SIDE_PADDING}
                    y2={zeroLineY}
                    stroke={`${outlineColor}80`}
                    strokeWidth={1}
                />

                {bandPoints.map((point) => (
                    <Line
                        key={`guide-${point.band.index}`}
                        x1={point.x}
                        y1={18}
                        x2={point.x}
                        y2={GRAPH_HEIGHT}
                        stroke={`${outlineColor}22`}
                        strokeWidth={1}
                    />
                ))}

                <Path d={curvePath} stroke={`${accentColor}25`} strokeWidth={18} fill="none" strokeLinecap="round" />
                <Path d={curvePath} stroke={`${accentColor}55`} strokeWidth={9} fill="none" strokeLinecap="round" />
                <Path d={curvePath} stroke={accentColor} strokeWidth={4} fill="none" strokeLinecap="round" />
            </Svg>

            <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.handleLayer]}>
                {bandPoints.map((point) => (
                    <BandHandle
                        key={point.band.index}
                        band={point.band}
                        x={point.x}
                        y={point.y}
                        textColor={textColor}
                        disabled={disabled}
                        onBandPreview={onBandPreview}
                        onBandCommit={onBandCommit}
                    />
                ))}
            </View>

            <View style={styles.bottomLabels}>
                {bandPoints.map((point) => (
                    <View key={`label-${point.band.index}`} style={[styles.bottomLabelCell, { width: graphInnerWidth / Math.max(1, bands.length) }]}>
                        <Text style={[styles.bottomFreqLabel, { color: `${textColor}CC` }]}>
                            {getDisplayBandLabel(point.band.centerHz)}
                        </Text>
                    </View>
                ))}
            </View>
        </View>
    );
}

function BandHandle({
    band,
    x,
    y,
    textColor,
    disabled,
    onBandPreview,
    onBandCommit,
}: {
    band: EqualizerBand;
    x: number;
    y: number;
    textColor: string;
    disabled: boolean;
    onBandPreview: (band: EqualizerBand, nextLevel: number) => void;
    onBandCommit: (band: EqualizerBand, nextLevel: number) => void;
}) {
    const startLevelRef = useRef(band.level);
    const currentLevelRef = useRef(band.level);
    const isDraggingRef = useRef(false);

    useEffect(() => {
        if (isDraggingRef.current) return;
        startLevelRef.current = band.level;
        currentLevelRef.current = band.level;
    }, [band.level]);

    const gesture = useMemo(() => Gesture.Pan()
        .runOnJS(true)
        .enabled(!disabled)
        .onBegin(() => {
            isDraggingRef.current = true;
            startLevelRef.current = band.level;
            currentLevelRef.current = band.level;
        })
        .onUpdate((event) => {
            const range = band.maxLevel - band.minLevel;
            const delta = (-event.translationY / GRAPH_HEIGHT) * range;
            const nextLevel = roundToStep(startLevelRef.current + delta, 25);
            currentLevelRef.current = nextLevel;
            onBandPreview(band, nextLevel);
        })
        .onFinalize(() => {
            isDraggingRef.current = false;
            onBandCommit(band, currentLevelRef.current);
        }), [band, disabled, onBandCommit, onBandPreview]);

    return (
        <GestureDetector gesture={gesture}>
            <View style={[styles.handleTouchArea, { left: x - 22, top: y - 52 }]}>
                <Text style={[styles.handleValue, { color: textColor }]}>
                    {getDisplayGainLabel(band.level)}
                </Text>
                <View style={styles.handleOuter}>
                    <View style={styles.handleInner} />
                </View>
            </View>
        </GestureDetector>
    );
}

function levelToY(level: number, minLevel: number, maxLevel: number, height: number): number {
    const range = Math.max(1, maxLevel - minLevel);
    const clamped = Math.min(maxLevel, Math.max(minLevel, level));
    return ((maxLevel - clamped) / range) * height;
}

function roundToStep(value: number, step: number): number {
    return Math.round(value / step) * step;
}

function createCurvePath(width: number, height: number, points: Array<{ x: number; y: number }>): string {
    const midpointY = height / 2;
    const allPoints = [
        { x: 0, y: midpointY },
        ...points,
        { x: width, y: midpointY },
    ];

    if (allPoints.length < 2) {
        return `M 0 ${midpointY} L ${width} ${midpointY}`;
    }

    let path = `M ${allPoints[0].x} ${allPoints[0].y}`;

    for (let index = 0; index < allPoints.length - 1; index += 1) {
        const current = allPoints[index];
        const next = allPoints[index + 1];
        const previous = allPoints[index - 1] ?? current;
        const afterNext = allPoints[index + 2] ?? next;

        const controlPoint1X = current.x + (next.x - previous.x) / 6;
        const controlPoint1Y = current.y + (next.y - previous.y) / 6;
        const controlPoint2X = next.x - (afterNext.x - current.x) / 6;
        const controlPoint2Y = next.y - (afterNext.y - current.y) / 6;

        path += ` C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${next.x} ${next.y}`;
    }

    return path;
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    container: { flex: 1 },
    content: { paddingHorizontal: 18, paddingBottom: 40, gap: 18 },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 8, marginBottom: 4 },
    headerButton: { width: 44, height: 44, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
    headerText: { flex: 1 },
    heroCard: { borderRadius: 30, overflow: 'hidden', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 20, minHeight: 520, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
    heroCopy: { gap: 6, marginBottom: 18 },
    heroEyebrow: { ...typeScale.micro, textTransform: 'uppercase', letterSpacing: 1.1 },
    heroTitle: { ...typeScale.hero, fontSize: 34, lineHeight: 38 },
    heroSubtitle: { ...typeScale.body, maxWidth: '78%' },
    graphShell: { flex: 1 },
    rangeHeader: { flexDirection: 'row', marginBottom: 14, paddingHorizontal: 8 },
    rangeCell: { flex: 1, alignItems: 'center' },
    rangeText: { ...typeScale.micro, textAlign: 'center', letterSpacing: 0.8, textTransform: 'uppercase' },
    graphWrap: { height: GRAPH_HEIGHT + 56, justifyContent: 'flex-start' },
    handleLayer: { top: 0 },
    handleTouchArea: { position: 'absolute', width: 44, alignItems: 'center' },
    handleValue: { ...typeScale.micro, marginBottom: 10 },
    handleOuter: { width: HANDLE_SIZE, height: HANDLE_SIZE, borderRadius: HANDLE_SIZE / 2, borderWidth: 2, borderColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10, 12, 18, 0.72)' },
    handleInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F2F4F7' },
    bottomLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -2, paddingHorizontal: 4 },
    bottomLabelCell: { alignItems: 'center' },
    bottomFreqLabel: { ...typeScale.micro, textAlign: 'center' },
    modeCard: { borderRadius: 26, padding: 18, borderWidth: 1, gap: 16 },
    presetCard: { borderRadius: 26, padding: 18, borderWidth: 1, gap: 16 },
    infoCard: { borderRadius: 22, padding: 18, borderWidth: 1, gap: 12 },
    sectionHeading: { gap: 4 },
    sectionTitle: { ...typeScale.title },
    sectionSubtitle: { ...typeScale.body },
    deviceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    statusBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 999, maxWidth: '100%' },
    statusBadgeText: { ...typeScale.micro, flexShrink: 1 },
    presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    presetChip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1 },
    presetLabel: { ...typeScale.bodyStrong },
});
