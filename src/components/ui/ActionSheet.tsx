import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import React, { useCallback, useEffect } from 'react';
import { BackHandler, Dimensions, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { IconButton, Text, useTheme as usePaperTheme } from 'react-native-paper';
import Animated, {
    Easing,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUIStore } from '../../stores/uiStore';
import { useTheme } from '../../theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.6;

export function ActionSheet() {
    const { theme, isDark } = useTheme();
    const paperTheme = usePaperTheme();
    const insets = useSafeAreaInsets();

    const visible = useUIStore(s => s.actionSheetVisible);
    const title = useUIStore(s => s.actionSheetTitle);
    const subtitle = useUIStore(s => s.actionSheetSubtitle);
    const actions = useUIStore(s => s.actionSheetActions);
    const track = useUIStore(s => s.actionSheetTrack);
    const close = useUIStore(s => s.closeActionSheet);

    const progress = useSharedValue(0);

    const handleClose = useCallback(() => {
        progress.value = withTiming(0, {
            duration: 250,
            easing: Easing.out(Easing.quad)
        }, (finished) => {
            if (finished) {
                runOnJS(close)();
            }
        });
    }, [close]);

    useEffect(() => {
        if (visible) {
            progress.value = withSpring(1, {
                damping: 20,
                stiffness: 150,
                mass: 0.8
            });

            const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
                handleClose();
                return true;
            });
            return () => backHandler.remove();
        }
    }, [visible, handleClose]);

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
        pointerEvents: progress.value > 0.1 ? 'auto' : 'none',
    }));

    const sheetStyle = useAnimatedStyle(() => {
        const translateY = interpolate(progress.value, [0, 1], [SHEET_HEIGHT, 0]);
        return {
            transform: [{ translateY }],
        };
    });

    const panGesture = Gesture.Pan()
        .onUpdate((e) => {
            if (e.translationY > 0) {
                const newVal = 1 - (e.translationY / SHEET_HEIGHT);
                progress.value = Math.max(0, newVal);
            }
        })
        .onEnd((e) => {
            if (e.translationY > 100 || e.velocityY > 500) {
                runOnJS(handleClose)();
            } else {
                progress.value = withSpring(1);
            }
        });

    if (!visible) return null;

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {/* Backdrop */}
            <Animated.View style={[styles.backdrop, backdropStyle]}>
                <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
            </Animated.View>

            {/* Sheet */}
            <GestureDetector gesture={panGesture}>
                <Animated.View style={[
                    styles.sheet,
                    {
                        backgroundColor: theme.colors.surface,
                        paddingBottom: insets.bottom + 20,
                        maxHeight: SHEET_HEIGHT,
                    },
                    sheetStyle
                ]}>
                    <BlurView intensity={30} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />

                    {/* Handle */}
                    <View style={styles.handleContainer}>
                        <View style={[styles.handle, { backgroundColor: theme.colors.onSurfaceVariant + '40' }]} />
                    </View>

                    {/* Header with Track Details */}
                    <View style={styles.header}>
                        {track && (
                            <View style={styles.trackInfo}>
                                <Image source={{ uri: track.artwork }} style={styles.artwork} />
                                <View style={styles.trackMeta}>
                                    <Text variant="titleMedium" numberOfLines={1} style={{ color: theme.colors.onSurface }}>{title}</Text>
                                    <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.onSurfaceVariant }}>{subtitle || track.artist}</Text>
                                </View>
                            </View>
                        )}
                        {!track && (
                            <View style={styles.plainHeader}>
                                <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>{title}</Text>
                                {subtitle && <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{subtitle}</Text>}
                            </View>
                        )}
                        <IconButton icon="close" size={20} onPress={handleClose} />
                    </View>

                    {/* Actions List */}
                    <View style={styles.actionsContainer}>
                        {actions.map((action, index) => (
                            <Pressable
                                key={index}
                                style={({ pressed }) => [
                                    styles.actionItem,
                                    pressed && { backgroundColor: theme.colors.onSurface + '10' }
                                ]}
                                onPress={() => {
                                    handleClose();
                                    setTimeout(action.onPress, 300);
                                }}
                            >
                                <View style={[
                                    styles.iconContainer,
                                    { backgroundColor: action.destructive ? theme.colors.error + '15' : theme.colors.primary + '10' }
                                ]}>
                                    <MaterialCommunityIcons
                                        name={action.icon as any}
                                        size={22}
                                        color={action.destructive ? theme.colors.error : theme.colors.primary}
                                    />
                                </View>
                                <Text style={[
                                    styles.actionLabel,
                                    { color: action.destructive ? theme.colors.error : theme.colors.onSurface }
                                ]}>
                                    {action.label}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                </Animated.View>
            </GestureDetector>
        </View>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 1,
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        overflow: 'hidden',
        zIndex: 10,
        elevation: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
    },
    handleContainer: {
        width: '100%',
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    handle: {
        width: 40,
        height: 5,
        borderRadius: 2.5,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 20,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(128,128,128,0.2)',
    },
    trackInfo: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    artwork: {
        width: 56,
        height: 56,
        borderRadius: 12,
    },
    trackMeta: {
        flex: 1,
        justifyContent: 'center',
    },
    plainHeader: {
        flex: 1,
    },
    actionsContainer: {
        paddingTop: 10,
    },
    actionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 20,
        gap: 16,
    },
    iconContainer: {
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionLabel: {
        fontSize: 16,
        fontWeight: '500',
    },
});
