/**
 * EmptyState - Placeholder for empty content
 */

import { useTheme } from '@/src/theme';
import React from 'react';
import { StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Animated, { FadeIn } from 'react-native-reanimated';

interface EmptyStateProps {
    icon?: string;
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
}

export function EmptyState({
    icon = '🎵',
    title,
    description,
    actionLabel,
    onAction,
}: EmptyStateProps) {
    const { theme } = useTheme();

    return (
        <Animated.View
            entering={FadeIn.delay(200)}
            style={styles.container}
        >
            <Text style={styles.icon}>{icon}</Text>
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
    icon: {
        fontSize: 64,
        marginBottom: 16,
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
