import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Skeleton } from '@/src/components/ui';
import {
  commitImportedSpotifyPlaylist,
  previewSpotifyPlaylistFromUrl,
} from '@/src/services/spotifyChartsService';
import { useLibraryStore } from '@/src/stores';
import { useTheme } from '@/src/theme';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput as RNTextInput,
  View,
} from 'react-native';
import { Snackbar, Text } from 'react-native-paper';
import Animated, {
  Easing,
  FadeIn,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type CreationPath = 'spotify' | 'manual' | null;
type SpotifyLoadState = 'idle' | 'loading' | 'error';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function looksLikeSpotifyPlaylistUrl(value: string) {
  return /(spotify\.com\/playlist\/|spotify:playlist:)/i.test(value.trim());
}

/** A fluid option row — big label + description, no border box */
function PathOption({
  label,
  description,
  active,
  onPress,
}: {
  label: string;
  description: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      style={[
        styles.pathOption,
        {
          backgroundColor: active ? `${theme.colors.primaryContainer}52` : `${theme.colors.surface}78`,
          borderColor: active ? `${theme.colors.primary}62` : `${theme.colors.outline}28`,
        },
        animStyle,
      ]}
      onPressIn={() => { scale.value = withTiming(0.97, { duration: 100, easing: Easing.out(Easing.quad) }); }}
      onPressOut={() => { scale.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) }); }}
      onPress={onPress}
    >
      {/* Active indicator — a short primary bar on the left */}
      <Animated.View
        style={[
          styles.pathIndicator,
          {
            backgroundColor: active ? theme.colors.primary : 'transparent',
            width: active ? 3 : 2,
            opacity: active ? 1 : 0.18,
          },
        ]}
      />
      <View style={styles.pathCopy}>
        <Text
          style={[
            styles.pathLabel,
            { color: active ? theme.colors.onBackground : theme.colors.onSurfaceVariant },
          ]}
        >
          {label}
        </Text>
        <Text style={[styles.pathDescription, { color: theme.colors.onSurfaceVariant }]}>
          {description}
        </Text>
      </View>
      <Animated.View
        style={[
          styles.pathChevron,
          {
            transform: [{ rotate: active ? '90deg' : '0deg' }],
            opacity: active ? 1 : 0.35,
          },
        ]}
      >
        <MaterialCommunityIcons name="chevron-right" size={18} color={theme.colors.onSurfaceVariant} />
      </Animated.View>
    </AnimatedPressable>
  );
}

export default function PlaylistCreateScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const createPlaylist = useLibraryStore(state => state.createPlaylist);

  const [expandedPath, setExpandedPath] = useState<CreationPath>(null);
  const [name, setName] = useState('');
  const [spotifyUrl, setSpotifyUrl] = useState('');
  const [spotifyState, setSpotifyState] = useState<SpotifyLoadState>('idle');
  const [spotifyPlaceholderCount, setSpotifyPlaceholderCount] = useState(0);
  const [spotifyError, setSpotifyError] = useState('');
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarText, setSnackbarText] = useState('');
  const lastAutoImportedClipboard = useRef<string | null>(null);
  const nameInputRef = useRef<RNTextInput>(null);

  const showSnackbar = useCallback((message: string) => {
    setSnackbarText(message);
    setSnackbarVisible(true);
  }, []);

  const handleSelectPath = useCallback((path: CreationPath) => {
    setExpandedPath(current => (current === path ? null : path));
    if (path === 'manual') {
      setTimeout(() => nameInputRef.current?.focus(), 320);
    }
  }, []);

  const handleCreateManualPlaylist = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const id = createPlaylist(trimmedName);
    router.replace({ pathname: '/playlist/[id]', params: { id } });
  }, [createPlaylist, name]);

  const handleImportSpotify = useCallback(async (manualUrl?: string) => {
    const targetUrl = (manualUrl ?? spotifyUrl).trim();
    if (!targetUrl || !looksLikeSpotifyPlaylistUrl(targetUrl) || spotifyState === 'loading') return;

    setSpotifyError('');
    setSpotifyState('loading');
    setSpotifyPlaceholderCount(1);

    const placeholderTimer = setInterval(() => {
      setSpotifyPlaceholderCount(current => Math.min(current + 1, 8));
    }, 180);

    try {
      const { playlist, tracks } = await previewSpotifyPlaylistFromUrl(targetUrl);
      clearInterval(placeholderTimer);
      commitImportedSpotifyPlaylist(playlist, tracks);
      router.replace({ pathname: '/playlist/[id]', params: { id: playlist.id } });
    } catch (error) {
      clearInterval(placeholderTimer);
      setSpotifyState('error');
      setSpotifyError(
        error instanceof Error ? error.message : 'No pude importar esa playlist de Spotify.'
      );
    }
  }, [spotifyState, spotifyUrl]);

  useEffect(() => {
    if (expandedPath !== 'spotify' || spotifyState === 'loading') return;

    let cancelled = false;

    Clipboard.getStringAsync()
      .then(value => {
        const trimmed = value.trim();
        if (
          cancelled
          || !trimmed
          || !looksLikeSpotifyPlaylistUrl(trimmed)
          || lastAutoImportedClipboard.current === trimmed
        ) return;

        lastAutoImportedClipboard.current = trimmed;
        setSpotifyUrl(trimmed);
        showSnackbar('Encontré una URL de Spotify en el portapapeles…');
        void handleImportSpotify(trimmed);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [expandedPath, handleImportSpotify, showSnackbar, spotifyState]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backButton, { backgroundColor: theme.colors.surface + 'F2' }]}
          >
            <MaterialCommunityIcons name="arrow-left" size={22} color={theme.colors.onSurface} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero heading */}
          <Animated.View entering={FadeIn.duration(220)} style={styles.hero}>
            <Text style={[styles.heroEyebrow, { color: theme.colors.primary }]}>
              Crear playlist
            </Text>
            <Text style={[styles.heroTitle, { color: theme.colors.onBackground }]}>
              ¿Cómo quieres{'\n'}empezar?
            </Text>
          </Animated.View>

          {/* Thin divider */}
          <Animated.View
            entering={FadeIn.delay(80).duration(200)}
            style={[styles.divider, { backgroundColor: theme.colors.outline + '28' }]}
          />

          {/* Option 1 — Spotify */}
          <Animated.View
            entering={FadeIn.delay(100).duration(220)}
            layout={LinearTransition.duration(200)}
          >
            <PathOption
              label="Importar de Spotify"
              description="Pega la URL de una playlist pública"
              active={expandedPath === 'spotify'}
              onPress={() => handleSelectPath('spotify')}
            />

            {expandedPath === 'spotify' ? (
              <Animated.View
                entering={FadeIn.duration(180)}
                layout={LinearTransition.duration(200)}
                style={styles.expandedBlock}
              >
                {/* URL field — bare underline style, no box */}
                <View style={[styles.underlineField, { borderBottomColor: theme.colors.outline + '44' }]}>
                  <RNTextInput
                    value={spotifyUrl}
                    onChangeText={value => {
                      setSpotifyUrl(value);
                      if (spotifyState !== 'idle') {
                        setSpotifyState('idle');
                        setSpotifyError('');
                        setSpotifyPlaceholderCount(0);
                      }
                    }}
                    placeholder="open.spotify.com/playlist/..."
                    placeholderTextColor={theme.colors.onSurfaceVariant + '66'}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={[styles.underlineInput, { color: theme.colors.onSurface }]}
                  />
                </View>

                {/* CTA */}
                <Pressable
                  onPress={() => { void handleImportSpotify(); }}
                  disabled={!looksLikeSpotifyPlaylistUrl(spotifyUrl) || spotifyState === 'loading'}
                  style={({ pressed }) => [
                    styles.ctaButton,
                    {
                      backgroundColor: looksLikeSpotifyPlaylistUrl(spotifyUrl) && spotifyState !== 'loading'
                        ? theme.colors.primary
                        : theme.colors.surface,
                      opacity: pressed ? 0.82 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.ctaLabel,
                      {
                        color: looksLikeSpotifyPlaylistUrl(spotifyUrl) && spotifyState !== 'loading'
                          ? theme.colors.onPrimary
                          : theme.colors.onSurfaceVariant,
                      },
                    ]}
                  >
                    {spotifyState === 'loading' ? 'Importando…' : 'Importar'}
                  </Text>
                </Pressable>

                {spotifyState === 'loading' ? (
                  <View style={styles.skeletonList}>
                    {Array.from({ length: spotifyPlaceholderCount }).map((_, index) => (
                      <Animated.View
                        key={`ph-${index}`}
                        entering={FadeIn.delay(index * 25).duration(160)}
                        style={styles.skeletonRow}
                      >
                        <Skeleton width={44} height={44} borderRadius={10} />
                        <View style={styles.skeletonText}>
                          <Skeleton width="68%" height={11} borderRadius={6} />
                          <Skeleton width="42%" height={9} borderRadius={6} />
                        </View>
                      </Animated.View>
                    ))}
                  </View>
                ) : null}

                {spotifyState === 'error' ? (
                  <Text style={[styles.errorText, { color: theme.colors.error }]}>
                    {spotifyError}
                  </Text>
                ) : null}
              </Animated.View>
            ) : null}
          </Animated.View>

          {/* Thin divider between options */}
          <Animated.View
            entering={FadeIn.delay(140).duration(200)}
            style={[styles.divider, { backgroundColor: theme.colors.outline + '28', marginVertical: 0 }]}
          />

          {/* Option 2 — Manual */}
          <Animated.View
            entering={FadeIn.delay(160).duration(220)}
            layout={LinearTransition.duration(200)}
          >
            <PathOption
              label="Crear desde cero"
              description="Ponle nombre y agrega canciones de tu biblioteca"
              active={expandedPath === 'manual'}
              onPress={() => handleSelectPath('manual')}
            />

            {expandedPath === 'manual' ? (
              <Animated.View
                entering={FadeIn.duration(180)}
                layout={LinearTransition.duration(200)}
                style={styles.expandedBlock}
              >
                {/* Name field — big, bare */}
                <View style={[styles.underlineField, { borderBottomColor: theme.colors.primary + '55' }]}>
                  <RNTextInput
                    ref={nameInputRef}
                    value={name}
                    onChangeText={setName}
                    placeholder="Nombre de la playlist"
                    placeholderTextColor={theme.colors.onSurfaceVariant + '66'}
                    returnKeyType="done"
                    onSubmitEditing={handleCreateManualPlaylist}
                    style={[styles.nameInput, { color: theme.colors.onBackground }]}
                  />
                </View>

                {/* CTA */}
                <Pressable
                  onPress={handleCreateManualPlaylist}
                  disabled={!name.trim()}
                  style={({ pressed }) => [
                    styles.ctaButton,
                    {
                      backgroundColor: name.trim() ? theme.colors.primary : theme.colors.surface,
                      opacity: pressed ? 0.82 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.ctaLabel,
                      {
                        color: name.trim() ? theme.colors.onPrimary : theme.colors.onSurfaceVariant,
                      },
                    ]}
                  >
                    Crear playlist
                  </Text>
                </Pressable>
              </Animated.View>
            ) : null}
          </Animated.View>

          <Animated.View
            entering={FadeIn.delay(180).duration(200)}
            style={[styles.divider, { backgroundColor: theme.colors.outline + '28', marginTop: 0 }]}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={1300}
        wrapperStyle={{ bottom: insets.bottom + 96 }}
      >
        {snackbarText}
      </Snackbar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 6,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  hero: {
    paddingHorizontal: 6,
    paddingTop: 28,
    paddingBottom: 28,
    gap: 6,
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  heroTitle: {
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 40,
  },
  divider: {
    height: 1,
    marginHorizontal: 6,
    marginVertical: 8,
  },
  // Path option row
  pathOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 16,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  pathIndicator: {
    height: 36,
    borderRadius: 2,
  },
  pathCopy: {
    flex: 1,
    gap: 3,
  },
  pathLabel: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  pathDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  pathChevron: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Expanded form area (no box, just padded)
  expandedBlock: {
    paddingHorizontal: 22,
    paddingBottom: 24,
    gap: 16,
  },
  underlineField: {
    borderBottomWidth: 1.5,
    paddingBottom: 8,
  },
  underlineInput: {
    fontSize: 16,
    lineHeight: 22,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  nameInput: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  // CTA — full width pill, no outline
  ctaButton: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  // Spotify loading skeletons
  skeletonList: {
    gap: 10,
    marginTop: 4,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  skeletonText: {
    flex: 1,
    gap: 7,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
