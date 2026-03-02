import { BlurView } from 'expo-blur';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Animated, {
    FadeIn,
    FadeOut
} from 'react-native-reanimated';
import { useUIStore } from '../../stores/uiStore';
import { useTheme } from '../../theme';

export function ConfirmationModal() {
    const { theme, isDark } = useTheme();
    const visible = useUIStore(s => s.confirmModalVisible);
    const config = useUIStore(s => s.confirmModalConfig);
    const close = useUIStore(s => s.closeConfirmModal);

    if (!visible || !config) return null;

    const handleConfirm = () => {
        config.onConfirm();
        close();
    };

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {/* Backdrop */}
            <Animated.View
                entering={FadeIn.duration(200)}
                exiting={FadeOut.duration(200)}
                style={styles.backdrop}
            >
                <Pressable style={StyleSheet.absoluteFill} onPress={close} />
            </Animated.View>

            {/* Modal Container */}
            <View style={styles.container} pointerEvents="box-none">
                <View
                    style={[
                        styles.modal,
                        {
                            backgroundColor: theme.colors.surface + 'F0',
                            borderColor: theme.colors.outline + '20',
                            borderWidth: 1,
                        }
                    ]}
                >
                    <BlurView
                        intensity={40}
                        tint={isDark ? 'dark' : 'light'}
                        style={StyleSheet.absoluteFill}
                    />

                    <View style={styles.content}>
                        <Text variant="headlineSmall" style={[styles.title, { color: theme.colors.onSurface }]}>
                            {config.title}
                        </Text>
                        <Text variant="bodyMedium" style={[styles.message, { color: theme.colors.onSurfaceVariant }]}>
                            {config.message}
                        </Text>

                        <View style={styles.actions}>
                            <Button
                                mode="text"
                                onPress={close}
                                style={styles.button}
                                labelStyle={{ color: theme.colors.primary }}
                            >
                                {config.cancelLabel || 'Cancelar'}
                            </Button>
                            <Button
                                mode="contained"
                                onPress={handleConfirm}
                                style={[
                                    styles.button,
                                    {
                                        backgroundColor: config.isDestructive
                                            ? theme.colors.error
                                            : theme.colors.primary
                                    }
                                ]}
                            >
                                {config.confirmLabel || 'Confirmar'}
                            </Button>
                        </View>
                    </View>
                </View>
            </View>

        </View>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    modal: {
        width: '100%',
        maxWidth: 340,
        borderRadius: 28,
        overflow: 'hidden',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
    },
    content: {
        padding: 24,
    },
    title: {
        fontWeight: '700',
        marginBottom: 12,
        textAlign: 'center',
    },
    message: {
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 20,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
    },
    button: {
        borderRadius: 12,
        minWidth: 100,
    },
});
