import { formatDuration } from '@staysound/services/metadataService';
import type { Album, Artist, Track } from '@staysound/types/audio';
import type { CSSProperties } from 'react';
import { balancedShuffle } from '@staysound/services/shuffle';
import { PlayIcon, ShuffleIcon } from './icons';
import { useIsDesktopViewport } from '../hooks/useIsDesktopViewport';

interface AlbumDetailProps {
  album: Album;
  tracks: Track[];
  activeTrackId?: string;
  isPlaying: boolean;
  onPlay: (track: Track, queue: Track[], origin?: HTMLElement) => void;
  onSelectArtist?: (artist: Artist) => void;
  onBack: () => void;
}

export function AlbumDetail({ album, tracks, activeTrackId, isPlaying, onPlay, onSelectArtist, onBack }: AlbumDetailProps) {
  const isDesktopViewport = useIsDesktopViewport();
  const albumTracks = album.tracks
    .map(id => tracks.find(t => t.id === id))
    .filter((t): t is Track => !!t)
    .sort((a, b) => (a.trackNumber ?? 999) - (b.trackNumber ?? 999));

  // Tracks without a live blob URL are resolved lazily from their persisted
  // file handle when pressed, so they remain playable after reopening the PWA.
  const playableTracks = albumTracks;
  const totalDuration = albumTracks.reduce((sum, t) => sum + (t.duration || 0), 0);

  // Find artwork from the album or any of its tracks
  const artwork = album.artwork
    || albumTracks.find(t => t.artwork)?.artwork;
  const transitionKey = album.id.replace(/[^a-zA-Z0-9_-]/g, '-');

  function handlePlayAll() {
    if (playableTracks.length > 0) {
      onPlay(playableTracks[0], playableTracks);
    }
  }

  function handleShuffle() {
    const shuffled = balancedShuffle(playableTracks);
    if (shuffled[0]) onPlay(shuffled[0], shuffled);
  }

  return (
    <section className={`detail-view ${isDesktopViewport ? 'circ' : ''}`}>
      <button className="back-btn" onClick={onBack}>
        <span>Álbumes</span><span aria-hidden="true">/</span><strong>{album.name}</strong>
      </button>
      <div className="detail-header">
        <div
          className={`detail-artwork ${isDesktopViewport ? 'circle' : ''}`}
          data-motion-id={`album-detail-art-${transitionKey}`}
          style={{ viewTransitionName: `album-art-${transitionKey}` } as CSSProperties}
        >
          {artwork ? (
            <img src={artwork} alt={album.name} />
          ) : (
            <span className="detail-artwork-letter">
              {album.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className="detail-meta">
          <p className="eyebrow">Álbum</p>
          <h2
            data-motion-id={`album-detail-title-${transitionKey}`}
            style={{ viewTransitionName: `album-title-${transitionKey}` } as CSSProperties}
          >{album.name}</h2>
          {onSelectArtist ? (
            <button className="artist-link" onClick={() => onSelectArtist({
              id: album.artistId ?? album.artist,
              name: album.artist,
              albums: [],
              trackCount: 0,
              albumCount: 0,
            })}>{album.artist}</button>
          ) : <p>{album.artist}</p>}
          <div className="detail-stats">
            {album.year && <span>{album.year}</span>}
            <span>{album.trackCount} {album.trackCount === 1 ? 'canción' : 'canciones'}</span>
            <span>{formatDuration(totalDuration)}</span>
          </div>
          <div className="detail-actions">
            <button
              className="btn btn-primary"
              onClick={handlePlayAll}
              disabled={playableTracks.length === 0}
            >
              <PlayIcon size={17} />
              Reproducir
            </button>
            <button
              className="btn btn-ghost"
              onClick={handleShuffle}
              disabled={playableTracks.length === 0}
            >
              <ShuffleIcon size={16} />
              Aleatorio
            </button>
          </div>
        </div>
      </div>

      <div className={`track-list ${isDesktopViewport ? 'circ' : ''}`}>
        {albumTracks.map((track, index) => {
          const active = activeTrackId === track.id;
          return (
            <button
              key={track.id}
              className={`track-row ${active ? 'active' : ''}`}
              onClick={event => onPlay(track, playableTracks, event.currentTarget)}
            >
              <span className="track-index">
                {active && isPlaying ? '▮▮' : track.trackNumber ?? index + 1}
              </span>
              <span className="track-thumb">
                {track.artwork ? (
                  <img src={track.artwork} alt="" loading="lazy" />
                ) : (
                  <span className="track-thumb-letter">
                    {track.title.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="track-main">
                <strong>{track.title}</strong>
                <small>{track.artist}</small>
              </span>
              <span className="track-meta">{formatDuration(track.duration)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
