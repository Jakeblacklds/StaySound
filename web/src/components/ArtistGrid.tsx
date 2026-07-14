import type { Artist, Track } from '@staysound/types/audio';
import type { CSSProperties } from 'react';

interface ArtistGridProps {
  artists: Artist[];
  tracks: Track[];
  onSelectArtist: (artist: Artist) => void;
}

export function ArtistGrid({ artists, tracks, onSelectArtist }: ArtistGridProps) {
  if (artists.length === 0) {
    return (
      <section className="empty-state">
        <div className="empty-state-icon">◎</div>
        <h2>No hay artistas todavía</h2>
        <p>Importa música local para organizarlos automáticamente.</p>
      </section>
    );
  }

  return (
    <section className="card-grid">
      {artists.map((artist, index) => {
        // Find artwork: prefer artist photo, then fall back to first track artwork
        const artistArtwork = artist.artwork
          || tracks.find(t => t.artistId === artist.id && t.artwork)?.artwork;

        return (
          <button
            key={artist.id}
            className="library-card artist-card"
            onClick={() => onSelectArtist(artist)}
            style={{ '--i': Math.min(index, 11) } as CSSProperties}
          >
            <div className="card-artwork">
              {artistArtwork ? (
                <img src={artistArtwork} alt={artist.name} loading="lazy" />
              ) : (
                <span className="card-artwork-letter">
                  {artist.name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <strong>{artist.name}</strong>
            <small>{artist.trackCount} canciones · {artist.albumCount} álbumes</small>
          </button>
        );
      })}
    </section>
  );
}
