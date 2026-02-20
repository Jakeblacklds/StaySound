import { useArtistInfo } from '@/src/hooks';
import { useTheme } from '@/src/theme';
import { Image } from 'expo-image';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, { FadeIn } from 'react-native-reanimated';

interface ArtistAboutProps {
    artistName: string;
    accentColor: string;
}

export function ArtistAbout({ artistName, accentColor }: ArtistAboutProps) {
    const { theme } = useTheme();
    const { info, isLoading } = useArtistInfo(artistName);
    const [isExpanded, setIsExpanded] = React.useState(false);

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator color={accentColor} />
                <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8, fontSize: 12 }}>
                    Searching artist info...
                </Text>
            </View>
        );
    }

    if (!info || (!info.photo_url && !info.biography)) {
        return null;
    }

    return (
        <Animated.View entering={FadeIn.duration(600)} style={styles.container}>
            <Text
                variant="titleLarge"
                style={[styles.header, { color: theme.colors.onSurface, fontFamily: theme.typography.fontFamily.bold }]}
            >
                About the Artist
            </Text>

            <View style={[styles.card, { backgroundColor: theme.colors.surfaceVariant + '40' }]}>
                {info.photo_url && (
                    <Image
                        source={{ uri: info.photo_url }}
                        style={styles.artistPhoto}
                        contentFit="cover"
                        transition={500}
                    />
                )}

                <View style={styles.infoContent}>
                    <Text
                        variant="headlineSmall"
                        style={{ color: theme.colors.onSurface, fontFamily: theme.typography.fontFamily.bold }}
                    >
                        {artistName}
                    </Text>

                    {info.biography ? (
                        <Pressable onPress={() => setIsExpanded(!isExpanded)}>
                            <Text
                                variant="bodyMedium"
                                numberOfLines={isExpanded ? undefined : 4}
                                style={{ color: theme.colors.onSurfaceVariant, marginTop: 8, lineHeight: 20 }}
                            >
                                {info.biography}
                            </Text>
                            {!isExpanded && info.biography.length > 150 && (
                                <Text style={{ color: accentColor, marginTop: 4, fontWeight: 'bold' }}>
                                    Read more
                                </Text>
                            )}
                        </Pressable>
                    ) : (
                        <Text
                            variant="bodyMedium"
                            style={{ color: theme.colors.onSurfaceVariant, marginTop: 4, fontStyle: 'italic' }}
                        >
                            Artist verified on Deezer. No biography available.
                        </Text>
                    )}
                </View>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 24,
        marginTop: 32,
        marginBottom: 40,
    },
    header: {
        marginBottom: 16,
    },
    card: {
        borderRadius: 24,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    artistPhoto: {
        width: '100%',
        height: 200,
    },
    infoContent: {
        padding: 20,
    },
    loadingContainer: {
        height: 100,
        justifyContent: 'center',
        alignItems: 'center',
    }
});
