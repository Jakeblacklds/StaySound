import { GlassPanel, SectionHeader } from '@/src/components/tidal';
import { EmptyState, Skeleton, TidalCoverCard } from '@/src/components/ui';
import type { TidalTab, TidalVirtualListItem } from '@/src/features/tidal/model/tidalScreenTypes';
import { normalizeCardImageUri } from '@/src/features/tidal/model/tidalScreenUtils';
import { tidalScreenStyles as styles } from '@/src/features/tidal/ui/tidalScreenStyles';
import type { SoulseekSearchResult } from '@/src/services/soulseekDownloadService';
import { radius, withAlpha } from '@/src/theme';
import type { TidalAlbum, TidalArtist, TidalPlaylist, TidalTrack } from '@/src/types/audio';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';

type TidalListColors = {
    onBackground: string;
    onSurface: string;
    onSurfaceVariant: string;
    outline: string;
    surfaceVariant: string;
};

type TidalVirtualListItemViewProps = {
    item: TidalVirtualListItem;
    accentColor: string;
    colors: TidalListColors;
    windowWidth: number;
    error: string | null;
    committedQuery: string;
    soulseekUsername: string;
    soulseekPassword: string;
    isSavingSoulseekCredentials: boolean;
    setSoulseekUsername: (value: string) => void;
    setSoulseekPassword: (value: string) => void;
    handleSaveSoulseekCredentials: () => void;
    renderSoulseekTrackRow: (result: SoulseekSearchResult) => ReactNode;
    renderSoulseekMirrorTrackRow: (track: TidalTrack) => ReactNode;
    renderTidalTrackRow: (track: TidalTrack) => ReactNode;
    fetchHomeRecommendations: () => void;
    isRecommending: boolean;
    recommendedTracks: TidalTrack[];
    artistArtworkOverrides: Map<number, string>;
    openArtist: (artist: TidalArtist) => void;
    openAlbum: (album: TidalAlbum) => void;
    openPlaylist: (playlist: TidalPlaylist) => void;
    isSoulseekSource: boolean;
    activeTab: TidalTab;
    visibleAlbumResults: TidalAlbum[];
    visibleArtistResults: TidalArtist[];
    visiblePlaylistResults: TidalPlaylist[];
};

export function TidalVirtualListItemView({
    item,
    accentColor,
    colors,
    windowWidth,
    error,
    committedQuery,
    soulseekUsername,
    soulseekPassword,
    isSavingSoulseekCredentials,
    setSoulseekUsername,
    setSoulseekPassword,
    handleSaveSoulseekCredentials,
    renderSoulseekTrackRow,
    renderSoulseekMirrorTrackRow,
    renderTidalTrackRow,
    fetchHomeRecommendations,
    isRecommending,
    recommendedTracks,
    artistArtworkOverrides,
    openArtist,
    openAlbum,
    openPlaylist,
    isSoulseekSource,
    activeTab,
    visibleAlbumResults,
    visibleArtistResults,
    visiblePlaylistResults,
}: TidalVirtualListItemViewProps) {
        switch (item.type) {
            case 'auth':
                return (
                    <View style={styles.centered}>
                        <GlassPanel style={styles.soulseekAuthPanel} radius={radius.xl}>
                            <View style={[styles.soulseekAuthIcon, { backgroundColor: withAlpha(accentColor, '22') }]}>
                                <Ionicons name="lock-closed" size={22} color={accentColor} />
                            </View>
                            <Text style={[styles.soulseekAuthKicker, { color: accentColor }]}>SOULSEEK</Text>
                            <Text variant="titleMedium" style={[styles.soulseekAuthTitle, { color: colors.onBackground }]}>
                                Inicia sesión
                            </Text>
                            <TextInput
                                mode="outlined"
                                label="Usuario"
                                value={soulseekUsername}
                                onChangeText={setSoulseekUsername}
                                autoCapitalize="none"
                                autoCorrect={false}
                                style={styles.soulseekAuthInput}
                            />
                            <TextInput
                                mode="outlined"
                                label="Password"
                                value={soulseekPassword}
                                onChangeText={setSoulseekPassword}
                                autoCapitalize="none"
                                autoCorrect={false}
                                secureTextEntry
                                style={styles.soulseekAuthInput}
                            />
                            <Button
                                mode="contained"
                                onPress={handleSaveSoulseekCredentials}
                                loading={isSavingSoulseekCredentials}
                                disabled={isSavingSoulseekCredentials}
                                contentStyle={styles.soulseekAuthButtonContent}
                            >
                                Guardar
                            </Button>
                        </GlassPanel>
                    </View>
                );
            case 'loading':
                return (
                    <View>
                        <View style={styles.feature}>
                            <Skeleton height={232} width={windowWidth - 32} borderRadius={26} />
                        </View>
                        <View style={styles.labelRow}>
                            <Skeleton height={12} width={90} borderRadius={4} />
                        </View>
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <View key={`s-tra-${i}`} style={styles.songRow}>
                                <Skeleton height={52} width={52} borderRadius={12} />
                                <View style={styles.songCopy}>
                                    <Skeleton height={15} width="70%" borderRadius={4} style={{ marginBottom: 7 }} />
                                    <Skeleton height={12} width="45%" borderRadius={4} />
                                </View>
                                <Skeleton height={26} width={26} borderRadius={13} />
                            </View>
                        ))}
                    </View>
                );
            case 'error':
                return (
                    <View style={styles.centered}>
                        <EmptyState
                            title="No se pudo cargar Tidal"
                            description={error ?? undefined}
                        />
                    </View>
                );
            case 'soulseek-empty':
                return (
                    <View style={styles.centered}>
                        <EmptyState title="Sin resultados" description={`No encontramos resultados para "${committedQuery.trim()}"`} />
                    </View>
                );
            case 'soulseek-summary':
                return (
                    <View style={styles.soulseekSummary}>
                        <SectionHeader kicker="Soulseek" title="Carpetas" meta={`${item.count} pistas`} accent={accentColor} />
                    </View>
                );
            case 'soulseek-folder-header':
                return (
                    <View style={styles.soulseekVirtualGroupHeader}>
                        <View style={[styles.soulseekFolderHeader, { backgroundColor: withAlpha(colors.onSurface, '0C'), borderColor: withAlpha(colors.outline, '3A') }]}>
                            <View style={[styles.soulseekFolderIcon, { backgroundColor: withAlpha(accentColor, '22') }]}>
                                <Ionicons name="folder-open" size={16} color={accentColor} />
                            </View>
                            <View style={styles.soulseekFolderTitleBlock}>
                                <Text numberOfLines={1} style={[styles.soulseekFolderPath, { color: colors.onSurface }]}>
                                    {item.group.folderPath}
                                </Text>
                                <Text numberOfLines={1} style={[styles.soulseekFolderPeer, { color: withAlpha(colors.onSurfaceVariant, 'B8') }]}>
                                    {item.group.username}
                                </Text>
                            </View>
                            <View style={[styles.soulseekFolderBadge, { backgroundColor: withAlpha(colors.onSurface, '14') }]}>
                                <Text style={[styles.soulseekFolderCount, { color: colors.onSurface }]}>
                                    {item.group.results.length}
                                </Text>
                            </View>
                        </View>
                    </View>
                );
            case 'soulseek-track':
                return renderSoulseekTrackRow(item.result);
            case 'home':
                return (
                    <View style={styles.recommendationList}>
                        <View style={styles.homeHeaderRow}>
                            <View style={{ gap: 4 }}>
                                <Text style={[styles.headerKicker, { color: accentColor }]}>PARA TI</Text>
                                <Text style={[styles.homeTitle, { color: colors.onBackground }]}>Sugerencias</Text>
                            </View>
                            <Pressable onPress={fetchHomeRecommendations} hitSlop={12}>
                                <Ionicons name="refresh" size={20} color={accentColor} />
                            </Pressable>
                        </View>
                        {isRecommending && recommendedTracks.length === 0
                            ? [1, 2, 3, 4].map((i) => (
                                <View key={`s-rec-tra-${i}`} style={styles.recommendationSkeleton}>
                                    <Skeleton height={52} width={52} borderRadius={7} />
                                    <View style={{ flex: 1, gap: 7 }}>
                                        <Skeleton height={13} width="72%" borderRadius={4} />
                                        <Skeleton height={11} width="44%" borderRadius={4} />
                                    </View>
                                </View>
                            ))
                            : recommendedTracks.map(track => (
                                <React.Fragment key={track.id}>
                                    {renderSoulseekMirrorTrackRow(track)}
                                </React.Fragment>
                            ))}
                    </View>
                );
            case 'empty':
                return (
                    <View style={styles.centered}>
                        <EmptyState title="Sin resultados" description={`No encontramos resultados para "${committedQuery.trim()}"`} />
                    </View>
                );
            case 'feature': {
                const heroArtwork = normalizeCardImageUri(artistArtworkOverrides.get(item.artist.id) || item.artist.artworkUrl);
                return (
                    <View style={styles.feature}>
                        <Pressable onPress={() => openArtist(item.artist)} style={StyleSheet.absoluteFill}>
                            {heroArtwork ? (
                                <Image source={{ uri: heroArtwork }} style={StyleSheet.absoluteFill} contentFit="cover" transition={350} />
                            ) : (
                                <View style={[StyleSheet.absoluteFill, styles.centerFill, { backgroundColor: colors.surfaceVariant }]}>
                                    <Ionicons name="person" size={52} color={colors.onSurfaceVariant} />
                                </View>
                            )}
                            <LinearGradient
                                colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.86)']}
                                locations={[0, 0.5, 1]}
                                style={StyleSheet.absoluteFill}
                            />
                            <View style={styles.featureCopy}>
                                <Text style={[styles.featureKicker, { color: withAlpha('#FFFFFF', 'C0') }]}>Mejor resultado</Text>
                                <Text numberOfLines={2} style={styles.featureName}>{item.artist.name}</Text>
                                <View style={styles.featureCta}>
                                    <Text style={styles.featureCtaLabel}>Ver artista</Text>
                                    <Ionicons name="chevron-forward" size={14} color="#0B0B0C" />
                                </View>
                            </View>
                        </Pressable>
                    </View>
                );
            }
            case 'label':
                return (
                    <View style={styles.labelRow}>
                        <Text style={[styles.labelText, { color: withAlpha(colors.onSurfaceVariant, 'CC') }]}>{item.label}</Text>
                    </View>
                );
            case 'track':
                return isSoulseekSource ? renderSoulseekMirrorTrackRow(item.track) : renderTidalTrackRow(item.track);
            case 'albums-rail':
                return (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.resultRail}>
                        {visibleAlbumResults.map(album => (
                            <TidalCoverCard
                                key={album.id}
                                imageUri={normalizeCardImageUri(album.artworkUrl)}
                                title={album.title}
                                subtitle={album.artistName || 'Álbum'}
                                size={150}
                                fallbackIcon="disc"
                                tone="glass"
                                onPress={() => openAlbum(album)}
                            />
                        ))}
                    </ScrollView>
                );
            case 'artists-rail': {
                const artistRailResults = activeTab === 'artists'
                    ? visibleArtistResults
                    : visibleArtistResults.slice(1);
                return (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.resultRail}>
                        {artistRailResults.map(artist => (
                            <TidalCoverCard
                                key={artist.id}
                                imageUri={normalizeCardImageUri(artistArtworkOverrides.get(artist.id) || artist.artworkUrl)}
                                title={artist.name}
                                subtitle="Artista"
                                size={118}
                                variant="portrait"
                                fallbackIcon="person"
                                tone="glass"
                                onPress={() => openArtist(artist)}
                            />
                        ))}
                    </ScrollView>
                );
            }
            case 'playlists-rail':
                return (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.resultRail}>
                        {visiblePlaylistResults.map(playlist => (
                            <TidalCoverCard
                                key={playlist.uuid}
                                imageUri={normalizeCardImageUri(playlist.artworkUrl)}
                                title={playlist.title}
                                subtitle="Playlist"
                                size={150}
                                fallbackIcon="musical-notes"
                                tone="glass"
                                onPress={() => openPlaylist(playlist)}
                            />
                        ))}
                    </ScrollView>
                );
            default:
                return null;
        }
}
