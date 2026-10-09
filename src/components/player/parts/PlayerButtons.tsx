import React from 'react';
import { View } from 'react-native';
import { IconButton } from 'react-native-paper';
import Animated, {
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withSpring,
    withTiming,
    type SharedValue,
} from 'react-native-reanimated';

function Particle({ index, count, progress, color }: { index: number; count: number; progress: SharedValue<number>; color: string }) {
    const angle = (index * (360 / count)) * (Math.PI / 180);
    const distance = 35;

    const animatedStyle = useAnimatedStyle(() => {
        const opacity = interpolate(progress.value, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);
        const scale = interpolate(progress.value, [0, 0.2, 1], [0, 1.2, 0]);
        const translateX = Math.cos(angle) * distance * progress.value;
        const translateY = Math.sin(angle) * distance * progress.value;

        return {
            position: 'absolute' as const,
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: color,
            opacity,
            transform: [{ translateX }, { translateY }, { scale }],
        };
    });

    return <Animated.View style={animatedStyle} />;
}

export function AnimatedFavoriteButton({
    isFavorite,
    onPress,
    activeColor,
    inactiveColor,
    size = 28,
    style,
}: {
    isFavorite: boolean;
    onPress: () => void;
    activeColor: string;
    inactiveColor: string;
    size?: number;
    style?: any;
}) {
    const scale = useSharedValue(1);
    const particleProgress = useSharedValue(0);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const handlePress = () => {
        const becomingFavorite = !isFavorite;
        onPress();

        if (becomingFavorite) {
            scale.value = withSequence(
                withTiming(1.8, { duration: 200 }),
                withSpring(1.1, { damping: 30, stiffness: 600, mass: 0.8 }),
            );

            particleProgress.value = 0;
            particleProgress.value = withTiming(1, { duration: 400 });
        } else {
            scale.value = withTiming(1, { duration: 100 });
        }
    };

    const particles = Array.from({ length: 8 });

    return (
        <View
            style={[style, { alignItems: 'center', justifyContent: 'center' }]}
            accessible
            accessibilityRole="button"
            accessibilityLabel={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
            accessibilityState={{ selected: isFavorite }}
        >
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {particles.map((_, i) => (
                    <Particle
                        key={i}
                        index={i}
                        count={particles.length}
                        progress={particleProgress}
                        color={activeColor}
                    />
                ))}
            </View>
            <Animated.View style={animatedStyle} importantForAccessibility="no">
                <IconButton
                    icon={isFavorite ? 'heart' : 'heart-outline'}
                    size={size}
                    iconColor={isFavorite ? activeColor : inactiveColor}
                    onPress={handlePress}
                    style={{ margin: 0 }}
                    accessibilityElementsHidden
                />
            </Animated.View>
        </View>
    );
}
