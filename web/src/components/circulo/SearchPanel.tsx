import { useMemo, useState } from 'react';
import type { Album, Artist, Track } from '@staysound/types/audio';
import { formatDuration } from '@staysound/services/metadataService';
import { normalize } from '../../App';
import { SearchIcon } from '../icons';
import { CircleTile } from './CircleTile';
import { hueFromId } from './CircleArt';

interface SearchPanelProps {
  albums: Album[];
  artists: Artist[];
  tracks: Track[];
  activeTrackId?: string;
  onPlayTrack: (track: Track, queue?: Track[]) => void;
  onSelectAlbum: (album: Album) => void;
  onSelectArtist: (artist: Artist) => void;
}

/** Círculo's dedicated search screen — live-filters the whole library (not just the
    current tab's list, unlike the legacy header search) using the same normalize()
    matcher App.tsx already uses for its per-tab filtered lists. */
export function SearchPanel({ albums, artists, tracks, activeTrackId, onPlayTrack, onSelectAlbum, onSelectArtist }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = normalize(query);

  const matchingAlbums = useMemo(() => (
    !normalizedQuery ? [] : albums.filter(album => normalize(`${album.name} ${album.artist}`).includes(normalizedQuery)).slice(0, 8)
  ), [albums, normalizedQuery]);

  const matchingArtists = useMemo(() => (
    !normalizedQuery ? [] : artists.filter(artist => normalize(artist.name).includes(normalizedQuery)).slice(0, 8)
  ), [artists, normalizedQuery]);

  const matchingTracks = useMemo(() => (
    !normalizedQuery ? [] : tracks.filter(track => normalize(`${track.title} ${track.artist} ${track.album}`).includes(normalizedQuery)).slice(0, 12)
  ), [tracks, normalizedQuery]);

  const hasResults = matchingAlbums.length > 0 || matchingArtists.length > 0 || matchingTracks.length > 0;

  return (
    <div className="circ-search">
      <p className="ss-eyebrow">Encuentra algo</p>
      <h1>Buscar</h1>
      <div className="circ-search-field">
        <SearchIcon size={18} />
        <input
          autoFocus
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Canción, artista o álbum"
          aria-label="Buscar en tu biblioteca"
        />
      </div>

      {normalizedQuery && !hasResults && (
        <p className="circ-search-empty">Nada coincide con &ldquo;{query}&rdquo;.</p>
      )}

      {matchingAlbums.length > 0 && (
        <section className="circ-search-section">
          <p className="ss-eyebrow">Álbumes</p>
          <div className="circ-tile-grid circ-search-grid">
            {matchingAlbums.map(album => (
              <CircleTile
                key={album.id}
                src={album.artwork}
                hue={hueFromId(album.id)}
                title={album.name}
                subtitle={album.artist}
                onClick={() => onSelectAlbum(album)}
              />
            ))}
          </div>
        </section>
      )}

      {matchingArtists.length > 0 && (
        <section className="circ-search-section">
          <p className="ss-eyebrow">Artistas</p>
          <div className="circ-tile-grid circ-search-grid">
            {matchingArtists.map(artist => (
              <CircleTile
                key={artist.id}
                src={artist.artwork}
                hue={hueFromId(artist.id)}
                title={artist.name}
                subtitle={`${artist.trackCount} canciones`}
                onClick={() => onSelectArtist(artist)}
              />
            ))}
          </div>
        </section>
      )}

      {matchingTracks.length > 0 && (
        <section className="circ-search-section">
          <p className="ss-eyebrow">Canciones</p>
          <div className="circ-search-tracks">
            {matchingTracks.map(track => (
              <button
                key={track.id}
                type="button"
                className={`circ-search-track-row ${activeTrackId === track.id ? 'active' : ''}`}
                onClick={() => onPlayTrack(track, matchingTracks)}
              >
                <span className="circ-search-track-thumb">
                  {track.artwork ? <img src={track.artwork} alt="" loading="lazy" /> : null}
                </span>
                <span className="circ-search-track-copy">
                  <strong>{track.title}</strong>
                  <small>{track.artist} · {track.album}</small>
                </span>
                <span className="circ-search-track-duration">{formatDuration(track.duration)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
