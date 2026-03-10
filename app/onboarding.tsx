import { useDynamicColors } from '@/src/hooks/useDynamicColors';
import { useOnboardingStore } from '@/src/stores/onboardingStore';
import { useTheme } from '@/src/theme';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import Animated, {
    Easing,
    FadeIn,
    FadeInDown,
    FadeInUp,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withSpring,
    withTiming,
    ZoomIn
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const APP_LOGO = require('@/assets/images/appicon.png');

// ─── Types ───────────────────────────────────────────────────────────────────

type OnboardingStep = 'welcome' | 'profile' | 'permissions' | 'ready';

interface PermissionItem {
    id: string;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    description: string;
    granted: boolean | null; // null = not asked yet
    required: boolean;
}

// ─── Particle component for welcome screen ────────────────────────────────────

function FloatingNote({ delay, x, size, color }: { delay: number; x: number; size: number; color: string }) {
    const translateY = useSharedValue(0);
    const opacity = useSharedValue(0);

    useEffect(() => {
        translateY.value = withDelay(
            delay,
            withRepeat(
                withSequence(
                    withTiming(-220, { duration: 3500 + Math.random() * 1500, easing: Easing.inOut(Easing.sin) }),
                    withTiming(0, { duration: 0 }),
                ),
                -1,
                false,
            ),
        );
        opacity.value = withDelay(
            delay,
            withRepeat(
                withSequence(
                    withTiming(0.6, { duration: 800 }),
                    withTiming(0.6, { duration: 2000 }),
                    withTiming(0, { duration: 700 }),
                ),
                -1,
                false,
            ),
        );
    }, []);

    const style = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
        opacity: opacity.value,
        position: 'absolute',
        left: x,
        bottom: 60,
    }));

    const notes = ['♪', '♫', '♩', '♬', '♭', '♮'];
    const note = notes[Math.floor(Math.random() * notes.length)];

    return (
        <Animated.Text style={[style, { fontSize: size, color }]}>
            {note}
        </Animated.Text>
    );
}

// ─── Step: Welcome ────────────────────────────────────────────────────────────

function WelcomeStep({ onNext, colors }: { onNext: () => void; colors: any }) {
    const logoScale = useSharedValue(0);
    const logoPulse = useSharedValue(1);

    useEffect(() => {
        logoScale.value = withSpring(1, { damping: 12, stiffness: 120 });
        // subtle heartbeat pulse
        setTimeout(() => {
            logoPulse.value = withRepeat(
                withSequence(
                    withTiming(1.06, { duration: 900, easing: Easing.inOut(Easing.ease) }),
                    withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
                ),
                -1,
                true,
            );
        }, 800);
    }, []);

    const logoStyle = useAnimatedStyle(() => ({
        transform: [{ scale: logoScale.value * logoPulse.value }],
    }));

    const floatingNotes = [
        { delay: 0, x: 30, size: 28 },
        { delay: 700, x: 90, size: 20 },
        { delay: 400, x: 160, size: 24 },
        { delay: 200, x: 230, size: 18 },
        { delay: 900, x: 290, size: 26 },
        { delay: 500, x: 350, size: 22 },
    ];

    return (
        <View style={styles.stepContainer}>
            {/* Floating notes background */}
            <View style={StyleSheet.absoluteFillObject}>
                {floatingNotes.map((n, i) => (
                    <FloatingNote key={i} {...n} color={colors.primary} />
                ))}
            </View>

            {/* Logo */}
            <Animated.View style={[styles.logoContainer, logoStyle]}>
                <View style={[styles.logoCircle, { backgroundColor: colors.primaryContainer, overflow: 'hidden' }]}>
                    <Image
                        source={APP_LOGO}
                        style={{ width: 120, height: 120 }}
                        contentFit="cover"
                    />
                </View>
            </Animated.View>

            {/* Title */}
            <Animated.View entering={FadeInDown.delay(400).duration(600)}>
                <Text style={[styles.welcomeTitle, { color: colors.onBackground }]}>
                    StaySound
                </Text>
                <Text style={[styles.welcomeSubtitle, { color: colors.onSurfaceVariant }]}>
                    Tu música. Siempre contigo.
                </Text>
            </Animated.View>

            {/* Features */}
            <Animated.View
                entering={FadeInUp.delay(700).duration(600)}
                style={[styles.featureList, { backgroundColor: colors.surfaceVariant }]}
            >
                {[
                    { icon: 'library' as const, text: 'Biblioteca local sin límites' },
                    { icon: 'stats-chart' as const, text: 'Audio de alta calidad y lossless' },
                    { icon: 'cloud-download' as const, text: 'Streaming de Tidal integrado' },
                ].map(({ icon, text }) => (
                    <View key={text} style={styles.featureRow}>
                        <View style={[styles.featureIconBg, { backgroundColor: colors.primaryContainer }]}>
                            <Ionicons name={icon as any} size={18} color={colors.primary} />
                        </View>
                        <Text style={[styles.featureText, { color: colors.onSurface }]}>{text}</Text>
                    </View>
                ))}
            </Animated.View>

            {/* CTA */}
            <Animated.View entering={FadeInUp.delay(1000).duration(500)}>
                <Pressable
                    style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                    onPress={onNext}
                    onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                >
                    <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>
                        Comenzar
                    </Text>
                    <Ionicons name="arrow-forward" size={20} color={colors.onPrimary} />
                </Pressable>
            </Animated.View>
        </View>
    );
}

// ─── Step: Profile ────────────────────────────────────────────────────────────

function ProfileStep({
    onNext,
    colors,
    name,
    setName,
    avatarUri,
    setAvatarUri,
}: {
    onNext: () => void;
    colors: any;
    name: string;
    setName: (n: string) => void;
    avatarUri: string | null;
    setAvatarUri: (u: string | null) => void;
}) {
    const [pickingImage, setPickingImage] = useState(false);
    const avatarScale = useSharedValue(1);

    const handlePickImage = async () => {
        setPickingImage(true);
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                setPickingImage(false);
                return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.85,
            });
            if (!result.canceled && result.assets[0]) {
                setAvatarUri(result.assets[0].uri);
                avatarScale.value = withSequence(
                    withSpring(1.15, { damping: 8 }),
                    withSpring(1, { damping: 12 }),
                );
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
        } finally {
            setPickingImage(false);
        }
    };

    const handleTakePhoto = async () => {
        setPickingImage(true);
        try {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
                setPickingImage(false);
                return;
            }
            const result = await ImagePicker.launchCameraAsync({
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.85,
            });
            if (!result.canceled && result.assets[0]) {
                setAvatarUri(result.assets[0].uri);
                avatarScale.value = withSequence(
                    withSpring(1.15, { damping: 8 }),
                    withSpring(1, { damping: 12 }),
                );
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
        } finally {
            setPickingImage(false);
        }
    };

    const avatarStyle = useAnimatedStyle(() => ({
        transform: [{ scale: avatarScale.value }],
    }));

    const canContinue = name.trim().length > 0;

    return (
        <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <Pressable style={styles.stepContainer} onPress={Keyboard.dismiss}>
                {/* Avatar */}
                <Animated.View entering={ZoomIn.duration(500)} style={avatarStyle}>
                    <Pressable
                        onPress={handlePickImage}
                        style={[styles.avatarWrapper, { borderColor: colors.primary }]}
                    >
                        {avatarUri ? (
                            <Image
                                source={{ uri: avatarUri }}
                                style={styles.avatarImage}
                                contentFit="cover"
                            />
                        ) : (
                            <View style={[styles.avatarPlaceholder, { backgroundColor: colors.surfaceVariant }]}>
                                <Ionicons name="person" size={52} color={colors.onSurfaceVariant} />
                            </View>
                        )}
                        <View style={[styles.avatarEditBadge, { backgroundColor: colors.primary }]}>
                            <Ionicons name="camera" size={14} color={colors.onPrimary} />
                        </View>
                    </Pressable>
                </Animated.View>

                <Animated.View entering={FadeInDown.delay(200).duration(500)} style={styles.avatarActionRow}>
                    <Pressable
                        onPress={handlePickImage}
                        style={[styles.avatarActionBtn, { backgroundColor: colors.surfaceVariant }]}
                    >
                        <Ionicons name="images-outline" size={18} color={colors.primary} />
                        <Text style={[styles.avatarActionText, { color: colors.onSurface }]}>Galería</Text>
                    </Pressable>
                    <Pressable
                        onPress={handleTakePhoto}
                        style={[styles.avatarActionBtn, { backgroundColor: colors.surfaceVariant }]}
                    >
                        <Ionicons name="camera-outline" size={18} color={colors.primary} />
                        <Text style={[styles.avatarActionText, { color: colors.onSurface }]}>Cámara</Text>
                    </Pressable>
                </Animated.View>

                {/* Name input */}
                <Animated.View entering={FadeInDown.delay(350).duration(500)} style={styles.inputSection}>
                    <Text style={[styles.inputLabel, { color: colors.onSurfaceVariant }]}>
                        ¿Cómo te llamamos?
                    </Text>
                    <View style={[styles.inputContainer, { backgroundColor: colors.surfaceVariant, borderColor: name.trim() ? colors.primary : 'transparent' }]}>
                        <Ionicons name="person-outline" size={20} color={colors.onSurfaceVariant} style={{ marginLeft: 16 }} />
                        <TextInput
                            style={[styles.textInput, { color: colors.onSurface }]}
                            placeholder="Tu nombre"
                            placeholderTextColor={colors.onSurfaceVariant}
                            value={name}
                            onChangeText={setName}
                            maxLength={32}
                            returnKeyType="done"
                            onSubmitEditing={Keyboard.dismiss}
                            autoCapitalize="words"
                        />
                    </View>
                </Animated.View>

                <Animated.View entering={FadeInUp.delay(500).duration(500)}>
                    <Pressable
                        style={[
                            styles.primaryButton,
                            { backgroundColor: canContinue ? colors.primary : colors.surfaceVariant },
                        ]}
                        onPress={canContinue ? onNext : undefined}
                        onPressIn={() => canContinue && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                    >
                        <Text style={[styles.primaryButtonText, { color: canContinue ? colors.onPrimary : colors.onSurfaceVariant }]}>
                            {name.trim() ? `¡Hola, ${name.split(' ')[0]}!` : 'Continuar'}
                        </Text>
                        <Ionicons name="arrow-forward" size={20} color={canContinue ? colors.onPrimary : colors.onSurfaceVariant} />
                    </Pressable>
                    <Pressable onPress={onNext} style={styles.skipButton}>
                        <Text style={[styles.skipText, { color: colors.onSurfaceVariant }]}>Omitir por ahora</Text>
                    </Pressable>
                </Animated.View>
            </Pressable>
        </KeyboardAvoidingView>
    );
}

// ─── Step: Permissions ────────────────────────────────────────────────────────

function PermissionsStep({ onNext, colors }: { onNext: () => void; colors: any }) {
    const [permissions, setPermissions] = useState<PermissionItem[]>([
        {
            id: 'media',
            icon: 'musical-notes',
            title: 'Biblioteca musical',
            description: 'Acceder a tus archivos de música y álbumes de fotos',
            granted: null,
            required: true,
        },
        {
            id: 'notifications',
            icon: 'notifications',
            title: 'Notificaciones',
            description: 'Controles en la barra de notificaciones (se activan automáticamente al reproducir)',
            granted: true,  // RNTP handles this automatically
            required: false,
        },
    ]);

    const [allAsked, setAllAsked] = useState(false);

    const updatePermission = (id: string, granted: boolean) => {
        setPermissions(prev => {
            const updated = prev.map(p => p.id === id ? { ...p, granted } : p);
            if (updated.every(p => p.granted !== null)) {
                setAllAsked(true);
            }
            return updated;
        });
    };

    const handleRequestAll = async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        // Media Library
        try {
            const { status } = await MediaLibrary.requestPermissionsAsync();
            updatePermission('media', status === 'granted');
        } catch {
            updatePermission('media', false);
        }

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };

    const handleSinglePermission = async (id: string) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        if (id === 'media') {
            const { status } = await MediaLibrary.requestPermissionsAsync();
            updatePermission('media', status === 'granted');
        }
        // notifications are handled automatically by react-native-track-player
    };

    const allRequiredGranted = permissions
        .filter(p => p.required)
        .every(p => p.granted === true);

    return (
        <View style={styles.stepContainer}>
            <Animated.View entering={FadeInDown.delay(100).duration(500)}>
                <Text style={[styles.permissionsHint, { color: colors.onSurfaceVariant }]}>
                    Para darte la mejor experiencia, StaySound necesita algunos permisos. Puedes otorgarlos todos de una vez o uno por uno.
                </Text>
            </Animated.View>

            <View style={styles.permissionsList}>
                {permissions.map((perm, index) => (
                    <Animated.View
                        key={perm.id}
                        entering={FadeInDown.delay(200 + index * 120).duration(500)}
                    >
                        <PermissionCard
                            item={perm}
                            colors={colors}
                            onRequest={() => handleSinglePermission(perm.id)}
                        />
                    </Animated.View>
                ))}
            </View>

            <Animated.View entering={FadeInUp.delay(600).duration(500)}>
                {!allAsked && (
                    <Pressable
                        style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                        onPress={handleRequestAll}
                        onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                    >
                        <Ionicons name="shield-checkmark" size={20} color={colors.onPrimary} />
                        <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>
                            Otorgar permisos
                        </Text>
                    </Pressable>
                )}

                {allAsked && (
                    <Pressable
                        style={[styles.primaryButton, { backgroundColor: allRequiredGranted ? colors.primary : colors.surfaceVariant }]}
                        onPress={onNext}
                        onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                    >
                        <Text style={[styles.primaryButtonText, { color: allRequiredGranted ? colors.onPrimary : colors.onSurface }]}>
                            {allRequiredGranted ? '¡Perfecto! Continuar' : 'Continuar de todas formas'}
                        </Text>
                        <Ionicons name="arrow-forward" size={20} color={allRequiredGranted ? colors.onPrimary : colors.onSurface} />
                    </Pressable>
                )}

                {!allAsked && (
                    <Pressable onPress={onNext} style={styles.skipButton}>
                        <Text style={[styles.skipText, { color: colors.onSurfaceVariant }]}>Configurar más tarde</Text>
                    </Pressable>
                )}
            </Animated.View>
        </View>
    );
}

function PermissionCard({
    item,
    colors,
    onRequest,
}: {
    item: PermissionItem;
    colors: any;
    onRequest: () => void;
}) {
    const scale = useSharedValue(1);
    const checkScale = useSharedValue(item.granted === true ? 1 : 0);

    useEffect(() => {
        if (item.granted === true) {
            checkScale.value = withSpring(1, { damping: 10, stiffness: 200 });
        } else {
            checkScale.value = withTiming(0, { duration: 200 });
        }
    }, [item.granted]);

    const checkStyle = useAnimatedStyle(() => ({
        transform: [{ scale: checkScale.value }],
    }));

    const cardBg = item.granted === true
        ? colors.primaryContainer + '55'
        : item.granted === false
            ? colors.surfaceVariant
            : colors.surfaceVariant;

    const borderColor = item.granted === true
        ? colors.primary + '88'
        : 'transparent';

    return (
        <Pressable
            style={[styles.permissionCard, { backgroundColor: cardBg, borderColor }]}
            onPress={onRequest}
            onPressIn={() => { scale.value = withSpring(0.97, { damping: 15 }); }}
            onPressOut={() => { scale.value = withSpring(1, { damping: 15 }); }}
        >
            <View style={[styles.permissionIconBg, { backgroundColor: colors.primaryContainer }]}>
                <Ionicons name={item.icon} size={22} color={colors.primary} />
            </View>
            <View style={styles.permissionTextBlock}>
                <View style={styles.permissionTitleRow}>
                    <Text style={[styles.permissionTitle, { color: colors.onSurface }]}>{item.title}</Text>
                    {item.required && (
                        <View style={[styles.requiredBadge, { backgroundColor: colors.primary + '33' }]}>
                            <Text style={[styles.requiredText, { color: colors.primary }]}>Req.</Text>
                        </View>
                    )}
                </View>
                <Text style={[styles.permissionDesc, { color: colors.onSurfaceVariant }]}>{item.description}</Text>
            </View>

            {/* Status indicator */}
            <View style={styles.permissionStatus}>
                {item.granted === null && (
                    <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
                )}
                {item.granted === false && (
                    <Ionicons name="close-circle" size={22} color={colors.error} />
                )}
                {item.granted === true && (
                    <Animated.View style={checkStyle}>
                        <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                    </Animated.View>
                )}
            </View>
        </Pressable>
    );
}

// ─── Step: Ready ──────────────────────────────────────────────────────────────

// ─── Confetti Star ────────────────────────────────────────────────────────────

const STAR_COLORS = ['#FFD700', '#FF9500', '#FF6B6B', '#4ECDC4', '#8AB4FF', '#C77DFF'];

function ConfettiStar({
    top,
    left,
    right,
    rotation,
    size,
    color,
    entryDelay,
}: {
    top: number;
    left?: number;
    right?: number;
    rotation: string;
    size: number;
    color: string;
    entryDelay: number;
}) {
    const scale = useSharedValue(0);

    useEffect(() => {
        scale.value = withDelay(entryDelay, withSpring(1, { damping: 8, stiffness: 180 }));
    }, []);

    const style = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }, { rotate: rotation }],
        position: 'absolute',
        top,
        left,
        right,
    }));

    return (
        <Animated.View style={style}>
            <Ionicons name="star" size={size} color={color} />
        </Animated.View>
    );
}

// ─── Step: Ready ──────────────────────────────────────────────────────────────

function ReadyStep({ userName, avatarUri, onFinish, colors }: {
    userName: string;
    avatarUri: string | null;
    onFinish: () => void;
    colors: any;
}) {
    const buttonScale = useSharedValue(0);

    useEffect(() => {
        buttonScale.value = withDelay(1000, withSpring(1, { damping: 12, stiffness: 120 }));
    }, []);

    const buttonStyle = useAnimatedStyle(() => ({
        transform: [{ scale: buttonScale.value }],
    }));

    const displayName = userName.trim() || 'Oyente';

    // confetti stars positions
    const stars = [
        { top: -20, left: 40, rotation: '15deg', size: 20 },
        { top: -10, left: 260, rotation: '-20deg', size: 16 },
        { top: 30, left: 10, rotation: '5deg', size: 14 },
        { top: 30, right: 10, rotation: '-10deg', size: 18 },
        { top: 80, left: 280, rotation: '30deg', size: 12 },
        { top: 80, left: 48, rotation: '-5deg', size: 22 },
    ];

    return (
        <View style={styles.stepContainer}>
            {/* Avatar */}
            <Animated.View entering={ZoomIn.duration(600)}>
                <View style={[styles.readyAvatarRing, { borderColor: colors.primary }]}>
                    {avatarUri ? (
                        <Image source={{ uri: avatarUri }} style={styles.readyAvatar} contentFit="cover" />
                    ) : (
                        <View style={[styles.avatarPlaceholder, styles.readyAvatar, { backgroundColor: colors.primaryContainer }]}>
                            <Ionicons name="person" size={48} color={colors.primary} />
                        </View>
                    )}
                </View>
            </Animated.View>

            {/* Confetti stars */}
            <View style={styles.confettiContainer} pointerEvents="none">
                {stars.map((s, i) => (
                    <ConfettiStar
                        key={i}
                        top={s.top}
                        left={(s as any).left}
                        right={(s as any).right}
                        rotation={s.rotation}
                        size={s.size}
                        color={STAR_COLORS[i]}
                        entryDelay={300 + i * 100}
                    />
                ))}
            </View>

            <Animated.View entering={FadeInDown.delay(400).duration(600)}>
                <Text style={[styles.readyTitle, { color: colors.onBackground }]}>
                    ¡Todo listo, {displayName}!
                </Text>
                <Text style={[styles.readySubtitle, { color: colors.onSurfaceVariant }]}>
                    Tu biblioteca musical te espera.{'\n'}¡A disfrutar!
                </Text>
            </Animated.View>

            <Animated.View style={[buttonStyle, { alignSelf: 'stretch' }]}>
                <Pressable
                    style={[styles.primaryButton, styles.readyButton, { backgroundColor: colors.primary }]}
                    onPress={onFinish}
                    onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
                >
                    <Ionicons name="musical-notes" size={22} color={colors.onPrimary} />
                    <Text style={[styles.primaryButtonText, { color: colors.onPrimary, fontSize: 17 }]}>
                        Explorar StaySound
                    </Text>
                </Pressable>
            </Animated.View>
        </View>
    );
}

// ─── Progress Dots ────────────────────────────────────────────────────────────

function ProgressDots({ current, total, colors }: { current: number; total: number; colors: any }) {
    return (
        <View style={styles.dotsRow}>
            {Array.from({ length: total }).map((_, i) => {
                const isActive = i === current;
                const isPast = i < current;
                const width = isActive ? 24 : 8;
                return (
                    <Animated.View
                        key={i}
                        style={[
                            styles.dot,
                            {
                                width,
                                backgroundColor: isActive || isPast ? colors.primary : colors.surfaceVariant,
                            },
                        ]}
                    />
                );
            })}
        </View>
    );
}

// ─── Step Header ──────────────────────────────────────────────────────────────

const STEP_HEADERS: Record<OnboardingStep, { title: string; subtitle: string }> = {
    welcome: { title: 'Bienvenido', subtitle: '' },
    profile: { title: 'Tu perfil', subtitle: 'Personaliza cómo te verás en la app' },
    permissions: { title: 'Permisos', subtitle: 'Necesitamos tu permiso para acceder a tu música' },
    ready: { title: '¡Listo!', subtitle: '' },
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

const STEPS: OnboardingStep[] = ['welcome', 'profile', 'permissions', 'ready'];

export default function OnboardingScreen() {
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();

    const { completeOnboarding, setUserName, setUserAvatarUri } = useOnboardingStore();

    const [step, setStep] = useState<OnboardingStep>('welcome');
    const [name, setNameLocal] = useState('');
    const [avatarUri, setAvatarUriLocal] = useState<string | null>(null);

    // Dynamic Colors based on avatar!
    const { colors: dynamicColors, animated: anim } = useDynamicColors(avatarUri || undefined);

    // Merge dynamic colors with theme colors to avoid missing Material 3 properties
    const colors = useMemo(() => {
        if (!avatarUri) return theme.colors;
        return {
            ...theme.colors,
            ...dynamicColors,
            onBackground: dynamicColors.text,
            onSurfaceVolume: dynamicColors.text, // Just in case
            onSurfaceVariant: dynamicColors.onSurface,
            surfaceVariant: dynamicColors.background,
            primaryContainer: dynamicColors.primary + '20',
        } as any;
    }, [avatarUri, dynamicColors, theme.colors]);

    const stepIndex = STEPS.indexOf(step);

    // Slide animation
    const slideX = useSharedValue(0);
    const contentOpacity = useSharedValue(1);

    const rootStyle = useAnimatedStyle(() => ({
        backgroundColor: avatarUri ? anim.background.value : theme.colors.background,
        flex: 1,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
    }));

    const goToStep = useCallback((next: OnboardingStep) => {
        contentOpacity.value = withTiming(0, { duration: 200 }, () => {
            slideX.value = 30;
            runOnJS(setStep)(next);
            slideX.value = withSpring(0, { damping: 20, stiffness: 200 });
            contentOpacity.value = withTiming(1, { duration: 300 });
        });
    }, []);

    const contentStyle = useAnimatedStyle(() => ({
        opacity: contentOpacity.value,
        transform: [{ translateX: slideX.value }],
        flex: 1,
    }));

    const handleNext = () => {
        const nextIndex = stepIndex + 1;
        if (nextIndex < STEPS.length) {
            goToStep(STEPS[nextIndex]);
        }
    };

    const handleFinish = () => {
        // Persist profile to store
        if (name.trim()) setUserName(name.trim());
        if (avatarUri) setUserAvatarUri(avatarUri);
        completeOnboarding();
        router.replace('/');
    };

    const header = STEP_HEADERS[step];

    return (
        <Animated.View style={rootStyle}>
            {/* Header */}
            {step !== 'welcome' && (
                <Animated.View entering={FadeIn.duration(300)} style={styles.header}>
                    <ProgressDots current={stepIndex} total={STEPS.length} colors={colors} />
                    {header.title ? (
                        <Text style={[styles.stepTitle, { color: colors.onBackground }]}>{header.title}</Text>
                    ) : null}
                    {header.subtitle ? (
                        <Text style={[styles.stepSubtitle, { color: colors.onSurfaceVariant }]}>{header.subtitle}</Text>
                    ) : null}
                </Animated.View>
            )}

            {/* Step content */}
            <Animated.View style={contentStyle}>
                {step === 'welcome' && (
                    <WelcomeStep onNext={handleNext} colors={colors} />
                )}
                {step === 'profile' && (
                    <ProfileStep
                        onNext={handleNext}
                        colors={colors}
                        name={name}
                        setName={setNameLocal}
                        avatarUri={avatarUri}
                        setAvatarUri={setAvatarUriLocal}
                    />
                )}
                {step === 'permissions' && (
                    <PermissionsStep onNext={handleNext} colors={colors} />
                )}
                {step === 'ready' && (
                    <ReadyStep
                        userName={name}
                        avatarUri={avatarUri}
                        onFinish={handleFinish}
                        colors={colors}
                    />
                )}
            </Animated.View>
        </Animated.View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 24,
        paddingTop: 16,
        paddingBottom: 8,
        gap: 6,
    },
    dotsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 12,
    },
    dot: {
        height: 8,
        borderRadius: 4,
    },
    stepTitle: {
        fontSize: 28,
        fontWeight: '700',
        letterSpacing: -0.5,
    },
    stepSubtitle: {
        fontSize: 15,
        lineHeight: 22,
    },
    stepContainer: {
        flex: 1,
        paddingHorizontal: 24,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 24,
    },

    // Welcome
    logoContainer: {
        alignItems: 'center',
    },
    logoCircle: {
        width: 120,
        height: 120,
        borderRadius: 60,
        alignItems: 'center',
        justifyContent: 'center',
    },
    welcomeTitle: {
        fontSize: 38,
        fontWeight: '800',
        textAlign: 'center',
        letterSpacing: -1,
    },
    welcomeSubtitle: {
        fontSize: 16,
        textAlign: 'center',
        marginTop: 6,
    },
    featureList: {
        width: '100%',
        borderRadius: 20,
        padding: 16,
        gap: 12,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    featureIconBg: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    featureText: {
        fontSize: 15,
        fontWeight: '500',
        flex: 1,
    },

    // Buttons
    primaryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 50,
        alignSelf: 'stretch',
        minHeight: 56,
    },
    primaryButtonText: {
        fontSize: 16,
        fontWeight: '700',
    },
    skipButton: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    skipText: {
        fontSize: 14,
    },

    // Profile
    avatarWrapper: {
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 3,
        overflow: 'hidden',
        position: 'relative',
    },
    avatarImage: {
        width: '100%',
        height: '100%',
    },
    avatarPlaceholder: {
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarEditBadge: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarActionRow: {
        flexDirection: 'row',
        gap: 12,
    },
    avatarActionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 10,
        paddingHorizontal: 18,
        borderRadius: 50,
    },
    avatarActionText: {
        fontSize: 14,
        fontWeight: '600',
    },
    inputSection: {
        width: '100%',
        gap: 8,
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 4,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 16,
        borderWidth: 2,
        overflow: 'hidden',
    },
    textInput: {
        flex: 1,
        fontSize: 16,
        paddingVertical: 16,
        paddingHorizontal: 12,
        fontWeight: '500',
    },

    // Permissions
    permissionsHint: {
        fontSize: 14,
        lineHeight: 22,
        textAlign: 'center',
    },
    permissionsList: {
        width: '100%',
        gap: 12,
    },
    permissionCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 20,
        gap: 14,
        borderWidth: 1.5,
    },
    permissionIconBg: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    permissionTextBlock: {
        flex: 1,
        gap: 4,
    },
    permissionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    permissionTitle: {
        fontSize: 15,
        fontWeight: '700',
    },
    requiredBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },
    requiredText: {
        fontSize: 10,
        fontWeight: '700',
    },
    permissionDesc: {
        fontSize: 13,
        lineHeight: 18,
    },
    permissionStatus: {
        width: 28,
        alignItems: 'center',
    },

    // Ready
    confettiContainer: {
        ...StyleSheet.absoluteFillObject,
        pointerEvents: 'none',
    },
    readyAvatarRing: {
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 4,
        overflow: 'hidden',
    },
    readyAvatar: {
        width: 112,
        height: 112,
        borderRadius: 56,
    },
    readyTitle: {
        fontSize: 30,
        fontWeight: '800',
        textAlign: 'center',
        letterSpacing: -0.5,
    },
    readySubtitle: {
        fontSize: 16,
        textAlign: 'center',
        lineHeight: 24,
        marginTop: 8,
    },
    readyButton: {
        marginTop: 12,
    },
});
