/**
 * EmptyState - Placeholder for empty content
 */

import { useTheme } from '@/src/theme';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Animated, { FadeIn } from 'react-native-reanimated';
import { CustomIcon, IconName } from './CustomIcon';

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
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
    },
    iconContainer: {
        marginBottom: 16,
    },
    icon: {
        fontSize: 64,
    },
    title: {
        fontWeight: '600',
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


