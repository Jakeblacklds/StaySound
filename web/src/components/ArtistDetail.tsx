import { formatDuration } from '@staysound/services/metadataService';
import type { Album, Artist, Track } from '@staysound/types/audio';
import { useEffect, useMemo, useState } from 'react';
import { getWebArtistInfo, type WebArtistInfo } from '../library/webArtistInfo';

interface ArtistDetailProps {
  artist: Artist;
  albums: Map<string, Album>;
  tracks: Track[];
  activeTrackId?: string;
  isPlaying: boolean;
  onPlay: (track: Track, queue: Track[]) => void;
  onSelectAlbum: (album: Album) => void;
  onBack: () => void;
}

export function ArtistDetail({
  artist,
  albums,
  tracks,
  activeTrackId,
  isPlaying,
  onPlay,
  onSelectAlbum,
  onBack,
}: ArtistDetailProps) {
  const [artistInfo, setArtistInfo] = useState<WebArtistInfo | null>(null);
  const artistTracks = useMemo(() => tracks.filter(t => t.artistId === artist.id), [artist.id, tracks]);
  // Let playback resolve persisted handles on demand instead of disabling
  // tracks whose session-only blob URLs expired on app close.
  const playableTracks = artistTracks;
  const artistAlbums = artist.albums
    .map(id => albums.get(id))
    .filter((a): a is Album => !!a)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  const localArtwork = artist.artwork
    || artistTracks.find(t => t.artwork)?.artwork
    || artistAlbums.find(album => album.artwork)?.artwork;
  const artwork = artistInfo?.photoUrl || localArtwork;
  const biography = artistInfo?.biography;

  useEffect(() => {
    let active = true;
    setArtistInfo(null);
    void getWebArtistInfo(artist.name)
      .then(info => {
        if (active) setArtistInfo(info);
      })
      .catch(() => {
        if (active) setArtistInfo(null);
      });
    return () => {
      active = false;
    };
  }, [artist.name]);

  function handlePlayAll() {
    if (playableTracks.length > 0) {
      onPlay(playableTracks[0], playableTracks);
    }
  }

  return (
    <section className="detail-view">
      <button className="back-btn" onClick={onBack}>
        ← Artistas
      </button>
      <div className="artist-mural">
        {artwork && <img className="artist-mural-bg" src={artwork} alt="" />}
        <div className="artist-mural-scrim" />
        <div className="artist-mural-portrait">
          {artwork ? (
            <img src={artwork} alt={artist.name} />
          ) : (
            <span>{artist.name.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className="artist-mural-copy">
          <p className="eyebrow">Artista</p>
          <h2>{artistInfo?.name || artist.name}</h2>
          <div className="detail-stats">
            <span>{artist.trackCount} canciones</span>
            <span>{artist.albumCount} álbumes</span>
            {artistInfo?.source && <span>{artistInfo.source}</span>}
          </div>
          {biography && <p className="artist-bio">{biography}</p>}
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

      {/* Albums section */}
      {artistAlbums.length > 0 && (
        <div className="artist-albums-section">
          <h3>Álbumes</h3>
          <div className="card-grid">
            {artistAlbums.map(album => {
              const albumArtwork = album.artwork
                || tracks.find(t => album.tracks.includes(t.id) && t.artwork)?.artwork;

              return (
                <button
                  key={album.id}
                  className="library-card"
                  onClick={() => onSelectAlbum(album)}
                >
                  <div className="card-artwork">
                    {albumArtwork ? (
                      <img src={albumArtwork} alt={album.name} loading="lazy" />
                    ) : (
                      <span className="card-artwork-letter">
                        {album.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <strong>{album.name}</strong>
                  <small>{album.trackCount} canciones{album.year ? ` · ${album.year}` : ''}</small>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* All tracks */}
      <div className="artist-albums-section">
        <h3>Canciones</h3>
        <div className="track-list">
          {artistTracks.map((track, index) => {
            const active = activeTrackId === track.id;
            return (
              <button
                key={track.id}
                className={`track-row ${active ? 'active' : ''}`}
                onClick={() => onPlay(track, playableTracks)}
              >
                <span className="track-index">
                  {active && isPlaying ? '▮▮' : index + 1}
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
                  <small>{track.album}</small>
                </span>
                <span className="track-meta">{formatDuration(track.duration)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
