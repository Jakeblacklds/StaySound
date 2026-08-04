import type { Artist, Track } from '@staysound/types/audio';
import type { CSSProperties } from 'react';
import { PlayIcon } from './icons';
import { hueFromId } from './circulo/CircleArt';
import { useIsDesktopViewport } from '../hooks/useIsDesktopViewport';

interface ArtistGridProps {
  artists: Artist[];
  tracks: Track[];
  onSelectArtist: (artist: Artist, origin?: HTMLElement) => void;
}

export function ArtistGrid({ artists, tracks, onSelectArtist }: ArtistGridProps) {
  const isDesktopViewport = useIsDesktopViewport();

  if (artists.length === 0) {
    return (
      <section className={isDesktopViewport ? 'circ-empty-state' : 'empty-state'}>
        <div className="empty-state-icon">◎</div>
        <h2>No hay artistas todavía</h2>
        <p>Importa música local para organizarlos automáticamente.</p>
      </section>
    );
  }

  if (isDesktopViewport) {
    return (
      <section className="circ-tile-grid">
        {artists.map(artist => {
          const artistArtwork = artist.artwork
            || tracks.find(t => t.artistId === artist.id && t.artwork)?.artwork;
          const transitionKey = artist.id.replace(/[^a-zA-Z0-9_-]/g, '-');
          return (
            <div key={artist.id} className="circ-tile">
              <span
                role="button"
                tabIndex={0}
                className="circ-art"
                data-motion-role="artwork"
                data-motion-id={`artist-card-art-${transitionKey}`}
                style={{ viewTransitionName: `artist-art-${transitionKey}` } as CSSProperties}
                onClick={event => onSelectArtist(artist, event.currentTarget)}
                onKeyDown={event => { if (event.key === 'Enter') onSelectArtist(artist, event.currentTarget); }}
              >
                <span className="circ-art-disc">
                  {artistArtwork ? <img src={artistArtwork} alt="" loading="lazy" /> : (
                    <span style={{ background: `oklch(0.3 0.12 ${hueFromId(artist.id)})`, width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.4rem' }}>
                      {artist.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
              </span>
              <strong
                data-motion-role="title"
                data-motion-id={`artist-card-title-${transitionKey}`}
                style={{ viewTransitionName: `artist-title-${transitionKey}` } as CSSProperties}
              >{artist.name}</strong>
              <small>{artist.trackCount} canciones · {artist.albumCount} álbumes</small>
            </div>
          );
        })}
      </section>
    );
  }

  return (
    <section className="card-grid">
      {artists.map((artist, index) => {
        // Find artwork: prefer artist photo, then fall back to first track artwork
        const artistArtwork = artist.artwork
          || tracks.find(t => t.artistId === artist.id && t.artwork)?.artwork;
        const transitionKey = artist.id.replace(/[^a-zA-Z0-9_-]/g, '-');

        return (
          <button
            key={artist.id}
            className="library-card artist-card"
            onClick={event => onSelectArtist(artist, event.currentTarget)}
            style={{ '--i': Math.min(index, 11) } as CSSProperties}
          >
            <div
              className="card-artwork"
              data-motion-role="artwork"
              data-motion-id={`artist-card-art-${transitionKey}`}
              style={{ viewTransitionName: `artist-art-${transitionKey}` } as CSSProperties}
            >
              {artistArtwork ? (
                <img src={artistArtwork} alt={artist.name} loading="lazy" />
              ) : (
                <span className="card-artwork-letter">
                  {artist.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="card-play" aria-hidden="true"><PlayIcon size={16} /></span>
            </div>
            <span className="card-copy">
              <strong
                data-motion-role="title"
                data-motion-id={`artist-card-title-${transitionKey}`}
                style={{ viewTransitionName: `artist-title-${transitionKey}` } as CSSProperties}
              >{artist.name}</strong>
              <small>{artist.trackCount} canciones · {artist.albumCount} álbumes</small>
            </span>
          </button>
        );
      })}
    </section>
  );
}
