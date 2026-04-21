import { useDabAuthStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import { router, useRootNavigationState } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Button, HelperText, Surface, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

type DabAuthMode = 'login' | 'register';

export default function DabAuthScreen() {
    const { theme } = useTheme();
    const rootNavigationState = useRootNavigationState();
    const status = useDabAuthStore(state => state.status);
    const session = useDabAuthStore(state => state.session);
    const isLoggingIn = useDabAuthStore(state => state.isLoggingIn);
    const isRegistering = useDabAuthStore(state => state.isRegistering);
    const authenticate = useDabAuthStore(state => state.authenticate);
    const register = useDabAuthStore(state => state.register);
    const signOut = useDabAuthStore(state => state.signOut);

    const [mode, setMode] = useState<DabAuthMode>('login');
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState(session?.email ?? '');
    const [password, setPassword] = useState('');
    const [localError, setLocalError] = useState<string | null>(null);

    useEffect(() => {
        if (session?.email) {
            setEmail(session.email);
        }
        if (session?.username) {
            setUsername(session.username);
        }
    }, [session?.email, session?.username]);

    const isBusy = isLoggingIn || isRegistering || status === 'loading';

    const handleLogin = async () => {
        try {
            setLocalError(null);
            await authenticate(email, password, username);
            if (rootNavigationState?.key) {
                router.replace('/(tabs)/settings');
            }
        } catch (error) {
            setLocalError(error instanceof Error ? error.message : 'No se pudo conectar la cuenta de DAB.');
        }
    };

    const handleRegister = async () => {
        try {
            setLocalError(null);
            await register(username, email, password);
            if (rootNavigationState?.key) {
                router.replace('/(tabs)/settings');
            }
        } catch (error) {
            setLocalError(error instanceof Error ? error.message : 'No se pudo crear la cuenta de DAB.');
        }
    };

    const handleSignOut = async () => {
        setLocalError(null);
        await signOut();
        setPassword('');
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <KeyboardAvoidingView
                style={styles.keyboard}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={styles.hero}>
                    <Text variant="headlineLarge" style={[styles.title, { color: theme.colors.onBackground }]}>
                        Cuenta DAB
                    </Text>
                    <Text variant="bodyLarge" style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
                        Conecta tu cuenta personal para buscar, abrir y descargar desde DAB sin depender de una cuenta compartida.
                    </Text>
                </View>

                <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={2}>
                    <View style={[styles.modeSwitch, { backgroundColor: theme.colors.surfaceVariant }]}>
                        <Pressable
                            onPress={() => { setMode('login'); setLocalError(null); }}
                            style={[styles.modeButton, mode === 'login' ? { backgroundColor: theme.colors.primaryContainer } : null]}
                        >
                            <Text style={{ color: mode === 'login' ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}>
                                Iniciar sesion
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={() => { setMode('register'); setLocalError(null); }}
                            style={[styles.modeButton, mode === 'register' ? { backgroundColor: theme.colors.primaryContainer } : null]}
                        >
                            <Text style={{ color: mode === 'register' ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}>
                                Crear cuenta
                            </Text>
                        </Pressable>
                    </View>

                    {mode === 'register' ? (
                        <TextInput
                            label="Usuario"
                            mode="outlined"
                            autoCapitalize="none"
                            value={username}
                            onChangeText={setUsername}
                        />
                    ) : null}

                    <TextInput
                        label="Correo"
                        mode="outlined"
                        autoCapitalize="none"
                        keyboardType="email-address"
                        value={email}
                        onChangeText={setEmail}
                    />

                    <TextInput
                        label="Contrasena"
                        mode="outlined"
                        secureTextEntry
                        autoCapitalize="none"
                        value={password}
                        onChangeText={setPassword}
                    />

                    {mode === 'login' ? (
                        <Button
                            mode="contained"
                            onPress={handleLogin}
                            loading={isLoggingIn}
                            disabled={isBusy || !email.trim() || !password.trim()}
                        >
                            Entrar o crear cuenta
                        </Button>
                    ) : (
                        <Button
                            mode="contained"
                            onPress={handleRegister}
                            loading={isRegistering}
                            disabled={isBusy || !username.trim() || !email.trim() || !password.trim()}
                        >
                            Crear cuenta y entrar
                        </Button>
                    )}

                    {session ? (
                        <Button
                            mode="outlined"
                            onPress={handleSignOut}
                            disabled={isBusy}
                        >
                            Cerrar sesion actual
                        </Button>
                    ) : null}

                    <HelperText type="info" visible={true}>
                        {session
                            ? `Sesion activa: ${session.email}`
                            : mode === 'login'
                                ? 'Si la cuenta ya existe en DAB entra con ese correo. Si no existe, se crea automaticamente.'
                                : 'La cuenta se guarda solo en este dispositivo usando storage local.'}
                    </HelperText>
                    <HelperText type="error" visible={!!localError}>
                        {localError || ' '}
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
    modeSwitch: {
        borderRadius: 18,
        flexDirection: 'row',
        padding: 4,
        gap: 4,
    },
    modeButton: {
        flex: 1,
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: 'center',
    },
});
