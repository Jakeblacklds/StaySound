/**
 * PlayerOptionsModal – A self-contained bottom-sheet modal that lives
 * INSIDE the FullPlayer view tree.  It replaces the global ActionSheet
 * for the three-dots menu so it always renders on top of the player
 * artwork / background instead of behind or outside it.
 */

import { LYRICS_SOURCES } from '@/src/services/lyricsSources';
import {
    SPECTRUM_DELAY_MAX,
    SPECTRUM_DELAY_MIN,
    SPECTRUM_DELAY_STEP,
    SpectrumTheme,
    useSettingsStore,
} from '@/src/stores/settingsStore';
import { usePerformanceProfile, useTheme } from '@/src/theme';
import { Track } from '@/src/types/audio';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import React, { useCallback, useEffect } from 'react';
import { BackHandler, Dimensions, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { Text } from 'react-native-paper';
import Animated, {
    Easing,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_MAX_HEIGHT = SCREEN_HEIGHT * 0.82;

const SPECTRUM_THEME_OPTIONS: { value: SpectrumTheme; label: string; icon: string }[] = [
    { value: 'aurora', label: 'Halo', icon: 'circle-opacity' },
    { value: 'columns', label: 'Escenario', icon: 'spotlight-beam' },
    { value: 'caustics', label: 'Waveform', icon: 'sine-wave' },
    { value: 'refractionVeil', label: 'Refracción', icon: 'diamond-stone' },
];

export interface PlayerOptionAction {
    label: string;
    icon: string;          // MaterialCommunityIcons name
    onPress: () => void;
    destructive?: boolean;
}

interface PlayerOptionsModalProps {
    visible: boolean;
    track: Track;
    actions: PlayerOptionAction[];
    accentColor: string;
    textColor: string;
    onClose: () => void;
    /** When true, shows the spectrum-sync (delay) adjuster inside the sheet. */
    spectrumTunerVisible?: boolean;
    /** When true, shows selectable spectrum visual styles. */
    spectrumThemeSelectorVisible?: boolean;
}

export const PlayerOptionsModal = React.memo(function PlayerOptionsModal({
    visible,
    track,
    actions,
    accentColor,
    textColor,
    onClose,
    spectrumTunerVisible = false,
    spectrumThemeSelectorVisible = true,
}: PlayerOptionsModalProps) {
    const { theme, isDark } = useTheme();
    const performanceProfile = usePerformanceProfile();
    const insets = useSafeAreaInsets();
    const progress = useSharedValue(0);

    const spectrumDelayMs = useSettingsStore((s) => s.spectrumDelayMs);
    const setSpectrumDelayMs = useSettingsStore((s) => s.setSpectrumDelayMs);
    const spectrumTheme = useSettingsStore((s) => s.spectrumTheme);
    const setSpectrumTheme = useSettingsStore((s) => s.setSpectrumTheme);
    const lyricsSources = useSettingsStore((s) => s.lyricsSources);
    const setLyricsSourceEnabled = useSettingsStore((s) => s.setLyricsSourceEnabled);

    const handleClose = useCallback(() => {
        progress.value = withTiming(0, {
            duration: 240,
            easing: Easing.out(Easing.quad),
        }, (finished) => {
            if (finished) runOnJS(onClose)();
        });
    }, [onClose, progress]);

    useEffect(() => {
        if (visible) {
            progress.value = withSpring(1, {
                damping: 22,
                stiffness: 180,
                mass: 0.7,
            });

            const sub = BackHandler.addEventListener('hardwareBackPress', () => {
                handleClose();
                return true;
            });
            return () => sub.remove();
        } else {
            progress.value = 0;
        }
    }, [visible, handleClose, progress]);

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: interpolate(progress.value, [0, 1], [0, 1]),
        pointerEvents: progress.value > 0.1 ? ('auto' as const) : ('none' as const),
    }));

    const sheetStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: interpolate(progress.value, [0, 1], [SHEET_MAX_HEIGHT, 0]) }],
    }));

    const panGesture = Gesture.Pan()
        .onUpdate((e) => {
            if (e.translationY > 0) {
                progress.value = Math.max(0, 1 - e.translationY / SHEET_MAX_HEIGHT);
            }
        })
        .onEnd((e) => {
            if (e.translationY > 80 || e.velocityY > 500) {
                runOnJS(handleClose)();
            } else {
                progress.value = withSpring(1, { damping: 22, stiffness: 180, mass: 0.7 });
            }
        });

    if (!visible) return null;

    const surfaceBg = isDark ? 'rgba(24, 24, 30, 0.92)' : 'rgba(248, 248, 252, 0.94)';
    const dividerColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

    const decDelay = () => setSpectrumDelayMs(spectrumDelayMs - SPECTRUM_DELAY_STEP);
    const incDelay = () => setSpectrumDelayMs(spectrumDelayMs + SPECTRUM_DELAY_STEP);
    const atMinDelay = spectrumDelayMs <= SPECTRUM_DELAY_MIN;
    const atMaxDelay = spectrumDelayMs >= SPECTRUM_DELAY_MAX;

    return (
        // zIndex/elevation keep the sheet in FRONT of the player artwork (which carries its
        // own zIndex) so the options are never clipped behind the cover.
        <View
            style={[StyleSheet.absoluteFill, modalStyles.root]}
            pointerEvents="box-none"
        >
            {/* Backdrop */}
            <Animated.View style={[modalStyles.backdrop, backdropStyle]}>
                <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
            </Animated.View>

            {/* Sheet */}
            <GestureDetector gesture={panGesture}>
                <Animated.View
                    style={[
                        modalStyles.sheet,
                        {
                            backgroundColor: surfaceBg,
                            paddingBottom: Math.max(insets.bottom + 16, 28),
                            maxHeight: SHEET_MAX_HEIGHT,
                        },
                        sheetStyle,
                    ]}
                >
                    {performanceProfile.enableBlurEffects ? (
                        <BlurView
                            intensity={40}
                            tint={isDark ? 'dark' : 'light'}
                            style={StyleSheet.absoluteFill}
                        />
                    ) : null}

                    {/* Handle */}
                    <View style={modalStyles.handleWrap}>
                        <View style={[modalStyles.handle, { backgroundColor: textColor + '30' }]} />
                    </View>

                    <ScrollView
                        style={modalStyles.scrollArea}
                        bounces={false}
                        overScrollMode="never"
                        nestedScrollEnabled
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={modalStyles.content}
                    >
                    {/* Track header */}
                    <View style={[modalStyles.header, { borderBottomColor: dividerColor }]}>
                        {track.artwork ? (
                            <Image
                                source={{ uri: track.artwork }}
                                style={modalStyles.artwork}
                                contentFit="cover"
                                cachePolicy={performanceProfile.imageCachePolicyOverlay}
                                transition={0}
                            />
                        ) : (
                            <View style={[modalStyles.artworkFallback, { backgroundColor: accentColor + '20' }]}>
                                <MaterialCommunityIcons name="music-note" size={24} color={accentColor} />
                            </View>
                        )}
                        <View style={modalStyles.meta}>
                            <Text
                                numberOfLines={1}
                                style={[modalStyles.title, { color: textColor }]}
                            >
                                {track.title}
                            </Text>
                            <Text
                                numberOfLines={1}
                                style={[modalStyles.subtitle, { color: textColor + 'AA' }]}
                            >
                                {track.artist}
                            </Text>
                        </View>
                    </View>

                    {/* Actions */}
                    <View style={modalStyles.actionsWrap}>
                        {actions.map((action, i) => (
                            <Pressable
                                key={i}
                                style={({ pressed }) => [
                                    modalStyles.actionRow,
                                    pressed && { backgroundColor: textColor + '0C' },
                                ]}
                                onPress={() => {
                                    handleClose();
                                    setTimeout(action.onPress, 280);
                                }}
                            >
                                <View
                                    style={[
                                        modalStyles.actionIcon,
                                        {
                                            backgroundColor: action.destructive
                                                ? theme.colors.error + '14'
                                                : accentColor + '14',
                                        },
                                    ]}
                                >
                                    <MaterialCommunityIcons
                                        name={action.icon as any}
                                        size={22}
                                        color={action.destructive ? theme.colors.error : accentColor}
                                    />
                                </View>
                                <Text
                                    style={[
                                        modalStyles.actionLabel,
                                        {
                                            color: action.destructive
                                                ? theme.colors.error
                                                : textColor,
                                        },
                                    ]}
                                >
                                    {action.label}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    {/* Spectrum visual theme selector (medios+agudos treatment) */}
                    {spectrumTunerVisible && spectrumThemeSelectorVisible ? (
                        <View style={[modalStyles.themeSection, { borderTopColor: dividerColor }]}>
                            <View style={modalStyles.tunerLabel}>
                                <MaterialCommunityIcons name="palette-outline" size={20} color={accentColor} />
                                <View style={modalStyles.tunerTextWrap}>
                                    <Text style={[modalStyles.tunerTitle, { color: textColor }]}>
                                        Estilo del espectro
                                    </Text>
                                    <Text style={[modalStyles.tunerHint, { color: textColor + 'AA' }]}>
                                        Capa de medios y agudos
                                    </Text>
                                </View>
                            </View>
                            <View style={modalStyles.themeChips}>
                                {SPECTRUM_THEME_OPTIONS.map((opt) => {
                                    const active = spectrumTheme === opt.value;
                                    return (
                                        <Pressable
                                            key={opt.value}
                                            onPress={() => setSpectrumTheme(opt.value)}
                                            style={[
                                                modalStyles.themeChip,
                                                {
                                                    borderColor: active ? accentColor : textColor + '24',
                                                    backgroundColor: active ? accentColor + '1F' : 'transparent',
                                                },
                                            ]}
                                        >
                                            <MaterialCommunityIcons
                                                name={opt.icon as any}
                                                size={18}
                                                color={active ? accentColor : textColor + 'AA'}
                                            />
                                            <Text
                                                style={[
                                                    modalStyles.themeChipLabel,
                                                    { color: active ? accentColor : textColor + 'CC' },
                                                ]}
                                            >
                                                {opt.label}
                                            </Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>
                    ) : null}

                    {/* Spectrum-sync adjuster (visualizer latency compensation) */}
                    {spectrumTunerVisible ? (
                        <View style={[modalStyles.tunerSection, { borderTopColor: dividerColor }]}>
                            <View style={modalStyles.tunerLabel}>
                                <MaterialCommunityIcons name="sine-wave" size={20} color={accentColor} />
                                <View style={modalStyles.tunerTextWrap}>
                                    <Text style={[modalStyles.tunerTitle, { color: textColor }]}>
                                        Sincronía del espectro
                                    </Text>
                                    <Text style={[modalStyles.tunerHint, { color: textColor + 'AA' }]}>
                                        Ajusta el desfase del visualizador
                                    </Text>
                                </View>
                            </View>
                            <View style={[modalStyles.stepper, { borderColor: accentColor + '40' }]}>
                                <Pressable
                                    onPress={decDelay}
                                    disabled={atMinDelay}
                                    hitSlop={8}
                                    style={[modalStyles.stepBtn, atMinDelay && modalStyles.stepDisabled]}
                                >
                                    <Text style={[modalStyles.stepText, { color: textColor }]}>–</Text>
                                </Pressable>
                                <Text style={[modalStyles.stepValue, { color: textColor }]}>
                                    {spectrumDelayMs} ms
                                </Text>
                                <Pressable
                                    onPress={incDelay}
                                    disabled={atMaxDelay}
                                    hitSlop={8}
                                    style={[modalStyles.stepBtn, atMaxDelay && modalStyles.stepDisabled]}
                                >
                                    <Text style={[modalStyles.stepText, { color: textColor }]}>+</Text>
                                </Pressable>
                            </View>
                        </View>
                    ) : null}

                    {/* Lyrics sources — one selectable version per provider */}
                    <View style={[modalStyles.themeSection, { borderTopColor: dividerColor }]}>
                        <View style={modalStyles.tunerLabel}>
                            <MaterialCommunityIcons name="text-search" size={20} color={accentColor} />
                            <View style={modalStyles.tunerTextWrap}>
                                <Text style={[modalStyles.tunerTitle, { color: textColor }]}>
                                    Fuentes de letras
                                </Text>
                                <Text style={[modalStyles.tunerHint, { color: textColor + 'AA' }]}>
                                    {lyricsSources.length} de {LYRICS_SOURCES.length} activas · toca para activar o quitar
                                </Text>
                            </View>
                        </View>
                        <View style={modalStyles.sourceChips}>
                            {LYRICS_SOURCES.map((src) => {
                                const active = lyricsSources.includes(src.id);
                                return (
                                    <Pressable
                                        key={src.id}
                                        accessibilityRole="switch"
                                        accessibilityState={{ checked: active }}
                                        accessibilityLabel={`Fuente ${src.label}`}
                                        onPress={() => setLyricsSourceEnabled(src.id, !active)}
                                        style={[
                                            modalStyles.sourceChip,
                                            {
                                                borderColor: active ? accentColor : textColor + '20',
                                                backgroundColor: active ? accentColor + '22' : 'transparent',
                                                opacity: active ? 1 : 0.55,
                                            },
                                        ]}
                                    >
                                        <MaterialCommunityIcons
                                            name={(active ? 'check-circle' : 'circle-outline') as any}
                                            size={15}
                                            color={active ? accentColor : textColor + '99'}
                                        />
                                        <Text
                                            style={[
                                                modalStyles.themeChipLabel,
                                                { color: active ? accentColor : textColor + 'CC' },
                                            ]}
                                        >
                                            {src.label}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    </View>
                    </ScrollView>
                </Animated.View>
            </GestureDetector>
        </View>
    );
});

const modalStyles = StyleSheet.create({
    root: {
        // Above the lyrics overlay (zIndex 10020) so the three-dots sheet opened from the
        // karaoke view is never hidden behind it.
        zIndex: 10050,
        elevation: 10050,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.52)',
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        overflow: 'hidden',
        elevation: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.3,
        shadowRadius: 14,
    },
    handleWrap: {
        width: '100%',
        height: 26,
        alignItems: 'center',
        justifyContent: 'center',
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
    },
    content: {
        paddingBottom: 2,
    },
    scrollArea: {
        flexShrink: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 14,
    },
    artwork: {
        width: 52,
        height: 52,
        borderRadius: 12,
    },
    artworkFallback: {
        width: 52,
        height: 52,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    meta: {
        flex: 1,
        justifyContent: 'center',
    },
    title: {
        fontSize: 16,
        fontWeight: '700',
        letterSpacing: -0.15,
    },
    subtitle: {
        fontSize: 13,
        marginTop: 2,
        fontWeight: '500',
    },
    actionsWrap: {
        paddingTop: 8,
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 13,
        paddingHorizontal: 20,
        gap: 16,
    },
    actionIcon: {
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionLabel: {
        fontSize: 15,
        fontWeight: '500',
    },
    tunerSection: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 14,
        marginTop: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: 12,
    },
    themeSection: {
        paddingHorizontal: 20,
        paddingTop: 14,
        marginTop: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: 12,
    },
    themeChips: {
        flexDirection: 'row',
        gap: 8,
    },
    sourceChips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    sourceChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: 1,
    },
    themeChip: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 9,
        paddingHorizontal: 8,
        borderRadius: 14,
        borderWidth: 1,
    },
    themeChipLabel: {
        fontSize: 12.5,
        fontWeight: '600',
    },
    tunerLabel: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1,
    },
    tunerTextWrap: {
        flex: 1,
    },
    tunerTitle: {
        fontSize: 14,
        fontWeight: '600',
    },
    tunerHint: {
        fontSize: 11,
        marginTop: 1,
        fontWeight: '500',
    },
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 20,
        paddingHorizontal: 4,
        paddingVertical: 2,
    },
    stepBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    stepDisabled: {
        opacity: 0.3,
    },
    stepText: {
        fontSize: 20,
        fontWeight: '700',
        lineHeight: 22,
    },
    stepValue: {
        minWidth: 58,
        textAlign: 'center',
        fontSize: 14,
        fontWeight: '700',
    },
});
