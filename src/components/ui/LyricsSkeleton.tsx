import { useTheme } from '@/src/theme';
import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, {
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * LyricsSkeleton - Redesigned as an "Ambient Zen Loader"
 * Instead of ghost lines, it uses morphing ambient auras that feel like 
 * part of the app's fluid design language.
 */
export const LyricsSkeleton = ({ isDownloading = false }: { isDownloading?: boolean }) => {
    const { isDark } = useTheme();
    const pulse = useSharedValue(0);
    const drift = useSharedValue(0);

    useEffect(() => {
        pulse.value = withRepeat(
            withTiming(1, { duration: 2500, easing: Easing.inOut(Easing.sin) }),
            -1,
            true
        );
        drift.value = withRepeat(
            withTiming(1, { duration: 5000, easing: Easing.inOut(Easing.sin) }),
            -1,
            true
        );
    }, []);

    const orbStyle = useAnimatedStyle(() => {
        const scale = interpolate(pulse.value, [0, 1], [0.85, 1.15]);
        const opacity = interpolate(pulse.value, [0, 1], [0.1, 0.22]);
        const translateX = interpolate(drift.value, [0, 1], [-15, 15]);
        const translateY = interpolate(drift.value, [0, 1], [-10, 10]);
        
        return {
            transform: [{ scale }, { translateX }, { translateY }],
            opacity,
        };
    });

    const secondOrbStyle = useAnimatedStyle(() => {
        const scale = interpolate(pulse.value, [0, 1], [1.1, 0.9]);
        const opacity = interpolate(pulse.value, [0, 1], [0.08, 0.18]);
        const translateX = interpolate(drift.value, [0, 1], [12, -12]);
        const translateY = interpolate(drift.value, [0, 1], [8, -8]);
        
        return {
            transform: [{ scale }, { translateX }, { translateY }],
            opacity,
        };
    });

    const statusStyle = useAnimatedStyle(() => {
        return {
            opacity: interpolate(pulse.value, [0, 0.5, 1], [0.3, 0.7, 0.3]),
        };
    });

    const baseColor = isDark ? '#FFFFFF' : '#000000';

    return (
        <View style={styles.container}>
            <View style={styles.auraContainer}>
                <Animated.View 
                    style={[
                        styles.orb, 
                        orbStyle, 
                        { backgroundColor: baseColor, width: SCREEN_WIDTH * 0.7, height: SCREEN_WIDTH * 0.7, borderRadius: (SCREEN_WIDTH * 0.7) / 2 }
                    ]} 
                />
                <Animated.View 
                    style={[
                        styles.orb, 
                        secondOrbStyle, 
                        { backgroundColor: baseColor, width: SCREEN_WIDTH * 0.5, height: SCREEN_WIDTH * 0.5, borderRadius: (SCREEN_WIDTH * 0.5) / 2, top: '25%', left: '15%' }
                    ]} 
                />
            </View>

            {isDownloading && (
                <Animated.View style={[styles.statusContainer, statusStyle]}>
                    <Text style={styles.statusText}>Obteniendo letras...</Text>
                    <View style={styles.statusBarContainer}>
                        <View style={[styles.statusBar, { backgroundColor: baseColor, opacity: 0.1 }]} />
                        <Animated.View 
                            style={[
                                styles.statusBarFill, 
                                { backgroundColor: baseColor, width: '40%' },
                                statusStyle
                            ]} 
                        />
                    </View>
                </Animated.View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'transparent',
    },
    auraContainer: {
        position: 'relative',
        width: SCREEN_WIDTH,
        height: SCREEN_WIDTH,
        justifyContent: 'center',
        alignItems: 'center',
    },
    orb: {
        position: 'absolute',
        // High blur is key for "Zen" feel, but since we can't easily use BlurView here 
        // without complicating deps, we'll use a very soft opacity.
        // If the project has BlurView, it's better to wrap this.
    },
    statusContainer: {
        position: 'absolute',
        bottom: SCREEN_HEIGHT * 0.12,
        alignItems: 'center',
    },
    statusText: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 2,
        textTransform: 'uppercase',
        marginBottom: 12,
    },
    statusBarContainer: {
        width: 120,
        height: 2,
        position: 'relative',
    },
    statusBar: {
        width: '100%',
        height: '100%',
        borderRadius: 1,
    },
    statusBarFill: {
        position: 'absolute',
        height: '100%',
        borderRadius: 1,
        left: '30%', //Centered-ish
    }
});
