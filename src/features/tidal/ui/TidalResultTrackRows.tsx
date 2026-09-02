import { TidalTrackRow } from '@/src/components/ui';
import {
    formatSoulseekMatchLabel,
    getSoulseekLeafFilename,
    normalizeCardImageUri,
    normalizeTrackText,
    stripSoulseekLeafExtension,
} from '@/src/features/tidal/model/tidalScreenUtils';
import type { SoulseekSearchResult } from '@/src/services/soulseekDownloadService';
import type { TidalTrack } from '@/src/types/audio';
import { memo } from 'react';

export type TrackDownloadStatus = 'idle' | 'downloading' | 'done' | 'error';

type CatalogTrackRowProps = {
    track: TidalTrack;
    accentColor: string;
    isActive: boolean;
    isPlaying: boolean;
    downloadStatus: TrackDownloadStatus;
    progress: number;
    onPress: () => void;
    onDownload: () => void;
};

export const CatalogTrackRow = memo(function CatalogTrackRow({
    track,
    accentColor,
    isActive,
    isPlaying,
    downloadStatus,
    progress,
    onPress,
    onDownload,
}: CatalogTrackRowProps) {
    return (
        <TidalTrackRow
            title={track.title}
            artist={track.artist}
            artworkUrl={normalizeCardImageUri(track.artworkUrl)}
            durationMs={track.durationMs}
            tone="glass"
            accentColor={accentColor}
            isActive={isActive}
            isPlaying={isPlaying}
            downloadStatus={downloadStatus}
            progress={progress}
            onPress={onPress}
            onDownloadPress={onDownload}
        />
    );
});

type SoulseekTrackRowProps = Omit<CatalogTrackRowProps, 'track'> & {
    result: SoulseekSearchResult;
};

export const SoulseekTrackRow = memo(function SoulseekTrackRow({
    result,
    accentColor,
    isActive,
    isPlaying,
    downloadStatus,
    progress,
    onPress,
    onDownload,
}: SoulseekTrackRowProps) {
    const track = result.track;
    const formatLabel = formatSoulseekMatchLabel(result.match);
    const rawLeafFilename = getSoulseekLeafFilename(result.match.filename || '');
    const normalizedLeaf = normalizeTrackText(stripSoulseekLeafExtension(rawLeafFilename));
    const normalizedTitle = normalizeTrackText(track.title || '');
    const showRawLeafFilename = normalizedLeaf.length > 0 && normalizedLeaf !== normalizedTitle;
    const subtitleArtist = track.artist || result.match.username;

    return (
        <TidalTrackRow
            title={track.title}
            artist={`${subtitleArtist}${formatLabel ? ` · ${formatLabel}` : ''}`}
            durationMs={track.durationMs > 0 ? track.durationMs : undefined}
            showArtwork
            tone="glass"
            accentColor={accentColor}
            isActive={isActive}
            isPlaying={isPlaying}
            extraLine={showRawLeafFilename ? rawLeafFilename : undefined}
            downloadStatus={downloadStatus}
            progress={progress}
            onPress={onPress}
            onDownloadPress={onDownload}
        />
    );
});
