import type { Album, Track } from '@staysound/types/audio';
import type { CSSProperties } from 'react';

function isRelinkNeeded(track: Track): boolean {
  return !track.uri || (track as Track & { needsRelink?: boolean }).needsRelink === true;
}

interface AlbumGridProps {
  albums: Album[];
  tracks: Track[];
  onSelectAlbum: (album: Album) => void;
}

export function AlbumGrid({ albums, tracks, onSelectAlbum }: AlbumGridProps) {
  if (albums.length === 0) {
    return (
      <section className="empty-state">
        <div className="empty-state-icon">◈</div>
        <h2>No hay álbumes todavía</h2>
        <p>Importa música local para construir tu biblioteca.</p>
      </section>
    );
  }

  return (
    <section className="card-grid">
      {albums.map((album, index) => {
        // Find artwork from album or its first track
        const albumArtwork = album.artwork
          || tracks.find(t => album.tracks.includes(t.id) && t.artwork)?.artwork;

        return (
          <button
            key={album.id}
            className="library-card"
            onClick={() => onSelectAlbum(album)}
            style={{ '--i': Math.min(index, 11) } as CSSProperties}
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
            <small>{album.artist} · {album.trackCount} canciones</small>
          </button>
        );
      })}
    </section>
  );
}
