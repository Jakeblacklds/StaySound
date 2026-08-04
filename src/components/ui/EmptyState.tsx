/**
 * EmptyState - Placeholder for empty content
 */

import { useTheme } from '@/src/theme';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Animated, { FadeIn } from 'react-native-reanimated';
import { CustomIcon, IconName } from './CustomIcon';
import { ImmersiveGlass } from './ImmersiveSurface';

interface EmptyStateProps {
    icon?: string | IconName | null;
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
}

export function EmptyState({
    icon = null,
    title,
    description,
    actionLabel,
    onAction,
}: EmptyStateProps) {
    const { theme } = useTheme();

    const isCustomIcon = (icon: string | IconName | null): icon is IconName => {
        if (!icon) return false;
        const customIcons: IconName[] = [
            'Ajustes', 'Album', 'Artista', 'Cancion', 'Cola', 'Descargar',
            'Home', 'Library', 'Lyrics', 'Next', 'Pause', 'Play',
            'Playlist', 'Previous', 'Reciente', 'Repetir 0', 'Repetir 1', 'Shuffle'
        ];
        return customIcons.includes(icon as IconName);
    };

    return (
        <Animated.View
            entering={FadeIn.delay(200)}
            style={styles.container}
        >
            <ImmersiveGlass tone="quiet" style={styles.panel}>
            {icon ? (
                <View style={styles.iconContainer}>
                    {isCustomIcon(icon) ? (
                        <CustomIcon name={icon} size={64} color={theme.colors.primary} />
                    ) : (
                        <Text style={styles.icon}>{icon}</Text>
                    )}
                </View>
            ) : null}
            <Text
                variant="titleLarge"
                style={[styles.title, { color: theme.colors.onBackground }]}
            >
                {title}
            </Text>
            {description && (
                <Text
                    variant="bodyMedium"
                    style={[styles.description, { color: theme.colors.onSurfaceVariant }]}
                >
                    {description}
                </Text>
            )}
            {actionLabel && onAction && (
                <Button
                    mode="contained"
                    onPress={onAction}
                    style={styles.button}
                >
                    {actionLabel}
                </Button>
            )}
            </ImmersiveGlass>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 22,
    },
    panel: {
        width: '100%',
        maxWidth: 430,
        alignItems: 'center',
        paddingHorizontal: 28,
        paddingVertical: 34,
    },
    iconContainer: {
        width: 82,
        height: 82,
        borderRadius: 30,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.07)',
        marginBottom: 20,
    },
    icon: {
        fontSize: 64,
    },
    title: {
        fontWeight: '800',
        textAlign: 'center',
        marginBottom: 8,
    },
    description: {
        textAlign: 'center',
        marginBottom: 24,
    },
    button: {
        borderRadius: 24,
    },
});


