import { formatDuration } from '@staysound/services/metadataService';
import type { Playlist, Track } from '@staysound/types/audio';
import type { CSSProperties, ChangeEvent } from 'react';
import { MusicNoteIcon, PlayingBars, PlaylistIcon } from './icons';

interface TrackListProps {
  tracks: Track[];
  activeTrackId?: string;
  isPlaying: boolean;
  isImporting: boolean;
  onPlay: (track: Track) => void;
  playlists?: Playlist[];
  onAddToPlaylist?: (playlistId: string, trackId: string) => void;
}

export function TrackList({
  tracks,
  activeTrackId,
  isPlaying,
  isImporting,
  onPlay,
  playlists = [],
  onAddToPlaylist,
}: TrackListProps) {
  function handlePlaylistSelect(track: Track, event: ChangeEvent<HTMLSelectElement>) {
    const playlistId = event.target.value;
    if (!playlistId || !onAddToPlaylist) return;
    onAddToPlaylist(playlistId, track.id);
    event.target.value = '';
  }

  if (tracks.length === 0) {
    return (
      <section className="empty-state">
        <div className="empty-state-icon"><MusicNoteIcon size={54} /></div>
        <h2>{isImporting ? 'Importando música...' : 'Importa tu biblioteca'}</h2>
        <p>
          En laptop puedes abrir una carpeta completa. En mobile selecciona archivos de audio
          desde el selector del navegador.
        </p>
      </section>
    );
  }

  return (
    <section className={`track-list ${playlists.length > 0 && onAddToPlaylist ? 'has-playlist-actions' : ''}`} aria-label="Canciones">
      <header className="track-list-head" aria-hidden="true">
        <span>#</span>
        <span />
        <span>Título</span>
        <span>Duración</span>
        {playlists.length > 0 && onAddToPlaylist ? <span /> : null}
      </header>
      {tracks.map((track, index) => {
        const active = activeTrackId === track.id;
        const availablePlaylists = playlists.filter(playlist => !playlist.readonly && !playlist.trackIds.includes(track.id));
        return (
          <div
            key={track.id}
            className={`track-row ${active ? 'active' : ''}`}
            style={{ '--i': Math.min(index, 12) } as CSSProperties}
          >
            <button className="track-row-main" onClick={() => onPlay(track)}>
              <span className="track-index">
                {active ? <PlayingBars paused={!isPlaying} /> : index + 1}
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
                <small>{track.artist} · {track.album}</small>
              </span>
              <span className="track-meta">{formatDuration(track.duration)}</span>
            </button>
            {playlists.length > 0 && onAddToPlaylist ? (
              <label className="playlist-quick-add" title="Agregar a playlist">
                <span className="sr-only">Agregar {track.title} a playlist</span>
                <PlaylistIcon size={16} />
                <select
                  defaultValue=""
                  onChange={event => handlePlaylistSelect(track, event)}
                  disabled={availablePlaylists.length === 0}
                  aria-label={`Agregar ${track.title} a playlist`}
                >
                  <option value="">Playlist</option>
                  {availablePlaylists.map(playlist => (
                    <option key={playlist.id} value={playlist.id}>{playlist.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
