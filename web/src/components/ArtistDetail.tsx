import { formatDuration } from '@staysound/services/metadataService';
import { balancedShuffle } from '@staysound/services/shuffle';
import type { Album, Artist, Track } from '@staysound/types/audio';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getWebArtistInfo, type WebArtistInfo } from '../library/webArtistInfo';
import { useIsDesktopViewport } from '../hooks/useIsDesktopViewport';
import { hueFromId } from './circulo/CircleArt';
import { PlayIcon, ShuffleIcon } from './icons';

interface ArtistDetailProps {
  artist: Artist;
  albums: Map<string, Album>;
  tracks: Track[];
  activeTrackId?: string;
  isPlaying: boolean;
  onPlay: (track: Track, queue: Track[], origin?: HTMLElement) => void;
  onSelectAlbum: (album: Album) => void;
  onBack: () => void;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
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
  const isDesktopViewport = useIsDesktopViewport();
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
  const transitionKey = artist.id.replace(/[^a-zA-Z0-9_-]/g, '-');

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

  function handleShuffle() {
    const shuffled = balancedShuffle(playableTracks);
    if (shuffled[0]) onPlay(shuffled[0], shuffled);
  }

  function albumArtworkOf(album: Album): string | undefined {
    return album.artwork
      || tracks.find(t => album.tracks.includes(t.id) && t.artwork)?.artwork;
  }

  return (
    <section className={`detail-view ${isDesktopViewport ? 'circ' : ''}`}>
      <button className="back-btn" onClick={onBack}>
        <span>Artistas</span><span aria-hidden="true">/</span><strong>{artist.name}</strong>
      </button>
      <div className="artist-mural">
        {artwork && <img className="artist-mural-bg" src={artwork} alt="" />}
        <div className="artist-mural-scrim" />
        <div
          className="artist-mural-portrait"
          data-motion-id={`artist-detail-art-${transitionKey}`}
          style={{ viewTransitionName: `artist-art-${transitionKey}` } as CSSProperties}
        >
          {artwork ? (
            <img src={artwork} alt={artist.name} />
          ) : (
            <span>{artist.name.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className="artist-mural-copy">
          <p className="eyebrow">Artista</p>
          <h2
            data-motion-id={`artist-detail-title-${transitionKey}`}
            style={{ viewTransitionName: `artist-title-${transitionKey}` } as CSSProperties}
          >{artistInfo?.name || artist.name}</h2>
          <div className="detail-stats">
            <span>{countLabel(artist.trackCount, 'canción', 'canciones')}</span>
            <span>{countLabel(artist.albumCount, 'álbum', 'álbumes')}</span>
            {artistInfo?.source && <span>{artistInfo.source}</span>}
          </div>
          {biography && <p className="artist-bio">{biography}</p>}
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

      {/* Albums section */}
      {artistAlbums.length > 0 && (
        <div className="artist-albums-section">
          <h3>Álbumes</h3>
          {/* Círculo usa los mismos discos que la rejilla de Biblioteca; el skin
              antiguo conserva sus tarjetas rectangulares. */}
          {isDesktopViewport ? (
            <div className="circ-tile-grid inline">
              {artistAlbums.map(album => {
                const albumArtwork = albumArtworkOf(album);
                const albumKey = album.id.replace(/[^a-zA-Z0-9_-]/g, '-');
                return (
                  <div key={album.id} className="circ-tile">
                    <span
                      role="button"
                      tabIndex={0}
                      className="circ-art"
                      data-motion-role="artwork"
                      data-motion-id={`album-card-art-${albumKey}`}
                      style={{ viewTransitionName: `album-art-${albumKey}` } as CSSProperties}
                      onClick={() => onSelectAlbum(album)}
                      onKeyDown={event => { if (event.key === 'Enter') onSelectAlbum(album); }}
                    >
                      <span className="circ-art-disc">
                        {albumArtwork ? <img src={albumArtwork} alt="" loading="lazy" /> : (
                          <span
                            className="circ-art-letter"
                            style={{ background: `oklch(0.3 0.12 ${hueFromId(album.id)})` } as CSSProperties}
                          >
                            {(album.name || artist.name).slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </span>
                    </span>
                    <strong>{album.name || 'Álbum sin título'}</strong>
                    <small>
                      {countLabel(album.trackCount, 'canción', 'canciones')}
                      {album.year ? ` · ${album.year}` : ''}
                    </small>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card-grid">
              {artistAlbums.map(album => {
                const albumArtwork = albumArtworkOf(album);
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
                          {(album.name || artist.name).slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="card-copy">
                      <strong>{album.name || 'Álbum sin título'}</strong>
                      <small>
                        {countLabel(album.trackCount, 'canción', 'canciones')}
                        {album.year ? ` · ${album.year}` : ''}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* All tracks */}
      <div className="artist-albums-section">
        <h3>Canciones</h3>
        <div className={`track-list ${isDesktopViewport ? 'circ' : ''}`}>
          {artistTracks.map((track, index) => {
            const active = activeTrackId === track.id;
            return (
              <button
                key={track.id}
                className={`track-row ${active ? 'active' : ''}`}
                onClick={event => onPlay(track, playableTracks, event.currentTarget)}
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
