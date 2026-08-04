import { formatDuration } from '@staysound/services/metadataService';
import type { Artist, Playlist, Track } from '@staysound/types/audio';
import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from 'react';
import { MusicNoteIcon, PlayingBars, PlaylistIcon } from './icons';
import { useIsDesktopViewport } from '../hooks/useIsDesktopViewport';

const VIRTUALIZE_AFTER = 80;
const DESKTOP_ROW_HEIGHT = 64;
const COMPACT_ROW_HEIGHT = 58;
const VIRTUAL_OVERSCAN = 12;
/** Rows the window may drift before the slice re-renders. Quantizing the
    window keeps React work to a few renders per screen of scrolling instead
    of one render per 1-row step, which is what made wheel scrolling feel
    choppy inside the Tauri WKWebView. */
const VIRTUAL_CHUNK = 4;

interface TrackListProps {
  tracks: Track[];
  activeTrackId?: string;
  isPlaying: boolean;
  isImporting: boolean;
  onPlay: (track: Track, origin?: HTMLElement) => void;
  playlists?: Playlist[];
  onAddToPlaylist?: (playlistId: string, trackId: string) => void;
  onImport?: () => void;
  onSelectArtist?: (artist: Artist) => void;
}

export const TrackList = memo(function TrackList({
  tracks,
  activeTrackId,
  isPlaying,
  isImporting,
  onPlay,
  playlists = [],
  onAddToPlaylist,
  onImport,
  onSelectArtist,
}: TrackListProps) {
  const isDesktopViewport = useIsDesktopViewport();
  const virtualSpaceRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualize = tracks.length > VIRTUALIZE_AFTER;
  const [virtualWindow, setVirtualWindow] = useState(() => ({
    start: 0,
    end: Math.min(tracks.length, 40),
    rowHeight: DESKTOP_ROW_HEIGHT,
  }));

  useEffect(() => {
    if (!shouldVirtualize) return;
    const space = virtualSpaceRef.current;
    // Tauri's Círculo shell scrolls `.circ-content`, while the responsive web
    // shell scrolls `.content`. Looking only for the latter left large desktop
    // libraries frozen at their initial 40-row virtual window.
    const scroller = space?.closest<HTMLElement>('.content, .circ-content');
    if (!space || !scroller) return;

    const compactQuery = window.matchMedia('(max-width: 820px)');
    let animationFrame = 0;
    const updateWindow = () => {
      animationFrame = 0;
      const rowHeight = compactQuery.matches ? COMPACT_ROW_HEIGHT : DESKTOP_ROW_HEIGHT;
      const scrollerRect = scroller.getBoundingClientRect();
      const spaceRect = space.getBoundingClientRect();
      const visibleTop = Math.max(0, scrollerRect.top - spaceRect.top);
      const rawStart = Math.max(0, Math.floor(visibleTop / rowHeight) - VIRTUAL_OVERSCAN);
      const rawEnd = Math.min(
        tracks.length,
        Math.ceil((visibleTop + scroller.clientHeight) / rowHeight) + VIRTUAL_OVERSCAN,
      );
      const start = Math.floor(rawStart / VIRTUAL_CHUNK) * VIRTUAL_CHUNK;
      const end = Math.min(tracks.length, Math.ceil(rawEnd / VIRTUAL_CHUNK) * VIRTUAL_CHUNK);

      setVirtualWindow(previous => (
        previous.start === start
        && previous.end === end
        && previous.rowHeight === rowHeight
          ? previous
          : { start, end, rowHeight }
      ));
    };
    const scheduleUpdate = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(updateWindow);
    };

    updateWindow();
    scroller.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(scroller);

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      scroller.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      resizeObserver.disconnect();
    };
  }, [shouldVirtualize, tracks.length]);

  if (tracks.length === 0) {
    return (
      <section className={isDesktopViewport ? 'circ-empty-state' : 'empty-state'}>
        <div className="empty-state-icon"><MusicNoteIcon size={54} /></div>
        <h2>{isImporting ? 'Importando música...' : 'Importa tu biblioteca'}</h2>
        <p>
          En laptop puedes abrir una carpeta completa. En mobile selecciona archivos de audio
          desde el selector del navegador.
        </p>
        {onImport && !isImporting && (
          <button className="btn btn-primary" onClick={onImport}>Importar música</button>
        )}
      </section>
    );
  }

  return (
    <section
      className={`track-list ${isDesktopViewport ? 'circ' : ''} ${playlists.length > 0 && onAddToPlaylist ? 'has-playlist-actions' : ''}`}
      aria-label="Canciones"
    >
      <header className="track-list-head" aria-hidden="true">
        <span>#</span>
        <span />
        <span>Título</span>
        <span>Duración</span>
        {playlists.length > 0 && onAddToPlaylist ? <span /> : null}
      </header>
      {shouldVirtualize ? (
        <div
          ref={virtualSpaceRef}
          className="track-list-window"
          style={{ height: tracks.length * virtualWindow.rowHeight }}
        >
          {tracks
            .slice(virtualWindow.start, virtualWindow.end)
            .map((track, offset) => {
              const index = virtualWindow.start + offset;
              return (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={index}
                  top={index * virtualWindow.rowHeight}
                  active={activeTrackId === track.id}
                  isPlaying={isPlaying}
                  playlists={playlists}
                  onPlay={onPlay}
                  onAddToPlaylist={onAddToPlaylist}
                  onSelectArtist={onSelectArtist}
                />
              );
            })}
        </div>
      ) : tracks.map((track, index) => (
        <TrackRow
          key={track.id}
          track={track}
          index={index}
          top={null}
          active={activeTrackId === track.id}
          isPlaying={isPlaying}
          playlists={playlists}
          onPlay={onPlay}
          onAddToPlaylist={onAddToPlaylist}
          onSelectArtist={onSelectArtist}
        />
      ))}
    </section>
  );
});

/** Memoized so window shifts during scroll only mount the edge rows instead
    of re-rendering every visible row. */
const TrackRow = memo(function TrackRow({
  track,
  index,
  top,
  active,
  isPlaying,
  playlists,
  onPlay,
  onAddToPlaylist,
  onSelectArtist,
}: {
  track: Track;
  index: number;
  /** Absolute offset inside the virtual window; null when not virtualized */
  top: number | null;
  active: boolean;
  isPlaying: boolean;
  playlists: Playlist[];
  onPlay: (track: Track, origin?: HTMLElement) => void;
  onAddToPlaylist?: (playlistId: string, trackId: string) => void;
  onSelectArtist?: (artist: Artist) => void;
}) {
  const availablePlaylists = playlists.filter(
    playlist => !playlist.readonly && !playlist.trackIds.includes(track.id),
  );
  const style = top !== null
    ? { top, '--i': 0 }
    : { '--i': Math.min(index, 12) };

  function handlePlaylistSelect(event: ChangeEvent<HTMLSelectElement>) {
    const playlistId = event.target.value;
    if (!playlistId || !onAddToPlaylist) return;
    onAddToPlaylist(playlistId, track.id);
    event.target.value = '';
  }

  return (
    <div className={`track-row ${active ? 'active' : ''}`} style={style as CSSProperties}>
      <button className="track-row-main" onClick={event => {
        const artistLink = (event.target as HTMLElement).closest<HTMLElement>('[data-artist-link]');
        if (artistLink && onSelectArtist) {
          event.preventDefault();
          onSelectArtist({ id: track.artistId ?? track.artist, name: track.artist, albums: [], trackCount: 0, albumCount: 0 });
          return;
        }
        onPlay(track, event.currentTarget);
      }}>
        <span className="track-index">
          {active ? <PlayingBars paused={!isPlaying} /> : index + 1}
        </span>
        <span className="track-thumb">
          {track.artwork ? (
            <img src={track.artwork} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className="track-thumb-letter">
              {track.title.slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
        <span className="track-main">
          <strong>{track.title}</strong>
          <small><span className="artist-link" data-artist-link role="link" tabIndex={0}>{track.artist}</span> · {track.album}</small>
        </span>
        <span className="track-meta">{formatDuration(track.duration)}</span>
      </button>
      {playlists.length > 0 && onAddToPlaylist ? (
        <label className="playlist-quick-add" title="Agregar a playlist">
          <span className="sr-only">Agregar {track.title} a playlist</span>
          <PlaylistIcon size={16} />
          <select
            defaultValue=""
            onChange={handlePlaylistSelect}
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
});
