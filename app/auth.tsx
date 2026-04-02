import { useAuthStore } from '@/src/stores';
import { getSupabaseConfig } from '@/src/services/supabaseConfig';
import { useTheme } from '@/src/theme';
import { router, useRootNavigationState } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Button, HelperText, Surface, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AuthScreen() {
    const { theme } = useTheme();
    const rootNavigationState = useRootNavigationState();
    const { allowedEmails } = getSupabaseConfig();
    const defaultEmail = useMemo(() => allowedEmails[0] ?? '', [allowedEmails]);

    const status = useAuthStore(state => state.status);
    const lockMessage = useAuthStore(state => state.lockMessage);
    const isSigningInWithPassword = useAuthStore(state => state.isSigningInWithPassword);
    const loginWithPassword = useAuthStore(state => state.loginWithPassword);

    const [email, setEmail] = useState(defaultEmail);
    const [password, setPassword] = useState('');
    const [localError, setLocalError] = useState<string | null>(null);

    useEffect(() => {
        if (!email && defaultEmail) {
            setEmail(defaultEmail);
        }
    }, [defaultEmail, email]);

    useEffect(() => {
        if (status === 'authenticated' && rootNavigationState?.key) {
            router.replace('/');
        }
    }, [rootNavigationState?.key, status]);

    const isBusy = isSigningInWithPassword;

    const handlePasswordLogin = async () => {
        try {
            setLocalError(null);
            await loginWithPassword(email, password, false);
            if (rootNavigationState?.key) {
                router.replace('/');
            }
        } catch (error) {
            setLocalError(error instanceof Error ? error.message : 'No se pudo iniciar sesion.');
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <KeyboardAvoidingView
                style={styles.keyboard}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={styles.hero}>
                    <Text variant="headlineLarge" style={[styles.title, { color: theme.colors.onBackground }]}>StaySound Access</Text>
                    <Text variant="bodyLarge" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>Acceso privado por correo y contrasena.</Text>
                </View>

                <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={2}>
                    <TextInput
                        label="Correo autorizado"
                        mode="outlined"
                        autoCapitalize="none"
                        keyboardType="email-address"
                        value={email}
                        disabled={isBusy}
                        onChangeText={setEmail}
                    />

                    <TextInput
                        label="Contrasena"
                        mode="outlined"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        autoCapitalize="none"
                    />

                    <Button
                        mode="contained"
                        onPress={handlePasswordLogin}
                        loading={isSigningInWithPassword}
                        disabled={isBusy || !email.trim() || !password.trim()}
                        style={styles.primaryButton}
                    >
                        Entrar
                    </Button>

                    <HelperText type="info" visible={true}>
                        Una cuenta mantiene una sesion activa.
                    </HelperText>
                    <HelperText type="error" visible={!!(localError || lockMessage)}>
                        {localError || lockMessage || ' '}
                    </HelperText>
                </Surface>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    keyboard: {
        flex: 1,
        paddingHorizontal: 20,
        justifyContent: 'center',
        gap: 24,
    },
    hero: {
        gap: 10,
    },
    title: {
        fontWeight: '800',
    },
    subtitle: {
        lineHeight: 24,
    },
    card: {
        borderRadius: 28,
        padding: 20,
        gap: 14,
    },
    primaryButton: {
        marginTop: 4,
    },
});
