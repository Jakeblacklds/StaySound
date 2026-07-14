import { formatDuration } from '@staysound/services/metadataService';
import type { Album, Track } from '@staysound/types/audio';

interface AlbumDetailProps {
  album: Album;
  tracks: Track[];
  activeTrackId?: string;
  isPlaying: boolean;
  onPlay: (track: Track, queue: Track[]) => void;
  onBack: () => void;
}

export function AlbumDetail({ album, tracks, activeTrackId, isPlaying, onPlay, onBack }: AlbumDetailProps) {
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

  function handlePlayAll() {
    if (playableTracks.length > 0) {
      onPlay(playableTracks[0], playableTracks);
    }
  }

  return (
    <section className="detail-view">
      <button className="back-btn" onClick={onBack}>
        ← Álbumes
      </button>
      <div className="detail-header">
        <div className="detail-artwork">
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
          <h2>{album.name}</h2>
          <p>{album.artist}</p>
          <div className="detail-stats">
            <span>{album.trackCount} canciones</span>
            <span>{formatDuration(totalDuration)}</span>
            {album.year && <span>{album.year}</span>}
          </div>
        </div>
      </div>

      <div className="detail-actions">
        <button
          className="btn btn-primary"
          onClick={handlePlayAll}
          disabled={playableTracks.length === 0}
        >
          ▶ Reproducir todo
        </button>
      </div>

      <div className="track-list">
        {albumTracks.map((track, index) => {
          const active = activeTrackId === track.id;
          return (
            <button
              key={track.id}
              className={`track-row ${active ? 'active' : ''}`}
              onClick={() => onPlay(track, playableTracks)}
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
