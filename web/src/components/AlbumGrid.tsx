import type { Album, Track } from '@staysound/types/audio';
import type { CSSProperties } from 'react';
import { PlayIcon } from './icons';
import { hueFromId } from './circulo/CircleArt';
import { useIsDesktopViewport } from '../hooks/useIsDesktopViewport';

function isRelinkNeeded(track: Track): boolean {
  return !track.uri || (track as Track & { needsRelink?: boolean }).needsRelink === true;
}

interface AlbumGridProps {
  albums: Album[];
  tracks: Track[];
  onSelectAlbum: (album: Album, origin?: HTMLElement) => void;
}

export function AlbumGrid({ albums, tracks, onSelectAlbum }: AlbumGridProps) {
  const isDesktopViewport = useIsDesktopViewport();

  if (albums.length === 0) {
    return (
      <section className={isDesktopViewport ? 'circ-empty-state' : 'empty-state'}>
        <div className="empty-state-icon">◈</div>
        <h2>No hay álbumes todavía</h2>
        <p>Importa música local para construir tu biblioteca.</p>
      </section>
    );
  }

  // Círculo desktop: circular tiles. Keeps the exact same data-motion-role/-id and
  // viewTransitionName hooks as the legacy card grid below — runMotionTransition (App.tsx)
  // depends on them for the shared-element open animation into AlbumDetail.
  if (isDesktopViewport) {
    return (
      <section className="circ-tile-grid">
        {albums.map(album => {
          const albumArtwork = album.artwork
            || tracks.find(t => album.tracks.includes(t.id) && t.artwork)?.artwork;
          const transitionKey = album.id.replace(/[^a-zA-Z0-9_-]/g, '-');
          return (
            <div key={album.id} className="circ-tile">
              <span
                role="button"
                tabIndex={0}
                className="circ-art"
                data-motion-role="artwork"
                data-motion-id={`album-card-art-${transitionKey}`}
                style={{ viewTransitionName: `album-art-${transitionKey}` } as CSSProperties}
                onClick={event => onSelectAlbum(album, event.currentTarget)}
                onKeyDown={event => { if (event.key === 'Enter') onSelectAlbum(album, event.currentTarget); }}
              >
                <span className="circ-art-disc">
                  {albumArtwork ? <img src={albumArtwork} alt="" loading="lazy" /> : (
                    <span style={{ background: `oklch(0.3 0.12 ${hueFromId(album.id)})`, width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.4rem' }}>
                      {album.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
              </span>
              <strong
                data-motion-role="title"
                data-motion-id={`album-card-title-${transitionKey}`}
                style={{ viewTransitionName: `album-title-${transitionKey}` } as CSSProperties}
              >{album.name}</strong>
              <small>{album.artist}</small>
            </div>
          );
        })}
      </section>
    );
  }

  return (
    <section className="card-grid">
      {albums.map((album, index) => {
        // Find artwork from album or its first track
        const albumArtwork = album.artwork
          || tracks.find(t => album.tracks.includes(t.id) && t.artwork)?.artwork;
        const transitionKey = album.id.replace(/[^a-zA-Z0-9_-]/g, '-');

        return (
          <button
            key={album.id}
            className="library-card"
            onClick={event => onSelectAlbum(album, event.currentTarget)}
            style={{ '--i': Math.min(index, 11) } as CSSProperties}
          >
            <div
              className="card-artwork"
              data-motion-role="artwork"
              data-motion-id={`album-card-art-${transitionKey}`}
              style={{ viewTransitionName: `album-art-${transitionKey}` } as CSSProperties}
            >
              {albumArtwork ? (
                <img src={albumArtwork} alt={album.name} loading="lazy" />
              ) : (
                <span className="card-artwork-letter">
                  {album.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="card-play" aria-hidden="true"><PlayIcon size={16} /></span>
            </div>
            <span className="card-copy">
              <strong
                data-motion-role="title"
                data-motion-id={`album-card-title-${transitionKey}`}
                style={{ viewTransitionName: `album-title-${transitionKey}` } as CSSProperties}
              >{album.name}</strong>
              <small>{album.artist}</small>
              <span className="card-catalog">
                <small>{album.trackCount} {album.trackCount === 1 ? 'canción' : 'canciones'}</small>
                {album.year ? <small>{album.year}</small> : null}
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
