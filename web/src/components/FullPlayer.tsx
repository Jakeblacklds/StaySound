import { formatDuration } from '@staysound/services/metadataService';
import type { Playlist, Track } from '@staysound/types/audio';
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDynamicPalette, paletteToCssVars, type WebDynamicPalette } from '../library/dynamicColors';
import {
  LYRICS_FONTS,
  readStoredLyricsFont,
  storeLyricsFont,
  type LyricsFontId,
} from '../library/lyricsFonts';
import {
  LYRICS_THEMES,
  readStoredLyricsTheme,
  storeLyricsTheme,
  type LyricsThemeId,
} from '../library/lyricsThemes';
import { AtmosphereCanvas } from './AtmosphereCanvas';
import {
  ChevronDownIcon,
  CloseIcon,
  MusicNoteIcon,
  NextIcon,
  PauseIcon,
  PlaylistIcon,
  PlayIcon,
  PreviousIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SpinnerIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMuteIcon,
} from './icons';
import { SyncedLyricsView } from './SyncedLyricsView';

interface FullPlayerProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  position: number;
  duration: number;
  volume: number;
  repeatMode: string;
  shuffleEnabled: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (position: number) => void;
  onVolume: (volume: number) => void;
  onRepeat: () => void;
  onShuffle: () => void;
  onClose: () => void;
  onOpenQueue: () => void;
  playlists?: Playlist[];
  onAddToPlaylist?: (playlistId: string, trackId: string) => void;
}

export function FullPlayer({
  currentTrack,
  isPlaying,
  isLoading,
  position,
  duration,
  volume,
  repeatMode,
  shuffleEnabled,
  onToggle,
  onNext,
  onPrevious,
  onSeek,
  onVolume,
  onRepeat,
  onShuffle,
  onClose,
  onOpenQueue,
  playlists = [],
  onAddToPlaylist,
}: FullPlayerProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const paletteRef = useRef<WebDynamicPalette | null>(null);
  const [closing, setClosing] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsClosing, setLyricsClosing] = useState(false);
  const [palette, setPalette] = useState<WebDynamicPalette | null>(null);
  const [previousPalette, setPreviousPalette] = useState<WebDynamicPalette | null>(null);
  const [paletteTransitionKey, setPaletteTransitionKey] = useState(0);
  const [lyricsTheme, setLyricsTheme] = useState<LyricsThemeId>(() => readStoredLyricsTheme());
  const [lyricsFont, setLyricsFont] = useState<LyricsFontId>(() => readStoredLyricsFont());
  const safeDuration = duration || currentTrack?.duration || 0;
  const trackKey = currentTrack?.id ?? 'empty';
  const progress = safeDuration > 0 ? Math.min(1, position / safeDuration) : 0;
  const titleLength = currentTrack?.title?.length ?? 0;
  const titleClassName = titleLength > 34 ? 'long' : titleLength > 20 ? 'medium' : '';
  const paletteStyle = useMemo<CSSProperties>(
    () => palette ? (paletteToCssVars(palette) as CSSProperties) : {},
    [palette],
  );

  useEffect(() => {
    let active = true;
    let clearPreviousTimer = 0;
    void getDynamicPalette(currentTrack).then(nextPalette => {
      if (!active) return;
      setPreviousPalette(paletteRef.current);
      paletteRef.current = nextPalette;
      setPalette(nextPalette);
      setPaletteTransitionKey(key => key + 1);
      clearPreviousTimer = window.setTimeout(() => {
        if (active) setPreviousPalette(null);
      }, 1200);
    });
    return () => {
      active = false;
      window.clearTimeout(clearPreviousTimer);
    };
  }, [currentTrack?.id, currentTrack?.artwork]);

  const handleLyricsTheme = useCallback((themeId: LyricsThemeId) => {
    setLyricsTheme(themeId);
    storeLyricsTheme(themeId);
  }, []);

  const handleLyricsFont = useCallback((fontId: LyricsFontId) => {
    setLyricsFont(fontId);
    storeLyricsFont(fontId);
  }, []);

  const handleLyricsOpen = useCallback(() => {
    setLyricsOpen(true);
    setLyricsClosing(false);
  }, []);

  const handleLyricsClose = useCallback(() => {
    setLyricsClosing(true);
    setTimeout(() => {
      setLyricsClosing(false);
      setLyricsOpen(false);
    }, 340);
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 280);
  }, [onClose]);

  const VolumeIcon = volume === 0 ? VolumeMuteIcon : volume < 0.5 ? VolumeLowIcon : VolumeHighIcon;
  const currentTrackAvailablePlaylists = currentTrack
    ? playlists.filter(playlist => !playlist.readonly && !playlist.trackIds.includes(currentTrack.id))
    : [];

  return (
    <div
      ref={overlayRef}
      className={`full-player-overlay immersive ${closing ? 'closing' : ''}`}
      style={paletteStyle}
    >
      <div className="fp-bg" aria-hidden="true">
        {previousPalette ? (
          <div
            key={`previous-${paletteTransitionKey}`}
            className="fp-bg-base previous"
            style={paletteToCssVars(previousPalette) as CSSProperties}
          />
        ) : null}
        <div key={`current-${paletteTransitionKey}`} className="fp-bg-base current" />
        <AtmosphereCanvas
          palette={palette}
          isPlaying={isPlaying}
          motionKey={trackKey}
          reactiveTarget={overlayRef}
        />
        {previousPalette ? (
          <div
            key={`edge-previous-${paletteTransitionKey}`}
            className="fp-bg-edge-glow previous"
            style={paletteToCssVars(previousPalette) as CSSProperties}
          />
        ) : null}
        <div key={`edge-current-${paletteTransitionKey}`} className="fp-bg-edge-glow current" />
        <div className="fp-bg-scrim" />
      </div>

      <div className="fp-header">
        <button className="fp-chip-btn" onClick={handleClose} aria-label="Cerrar" title="Cerrar (F)">
          <ChevronDownIcon size={22} />
        </button>
        <span className="fp-header-title">Reproduciendo</span>
        <button className="fp-chip-btn" onClick={onOpenQueue} aria-label="Cola" title="Cola (Q)">
          <QueueIcon size={20} />
        </button>
      </div>

      <div className="fp-body">
        <section className="fp-left-scene">
          <div className="fp-artwork-stage" aria-hidden="true">
            <div key={trackKey} className="fp-artwork">
              {currentTrack?.artwork ? (
                <img src={currentTrack.artwork} alt="" />
              ) : (
                <span className="fp-artwork-letter">
                  {currentTrack ? currentTrack.title.slice(0, 1).toUpperCase() : 'S'}
                </span>
              )}
            </div>
          </div>

          <div className="fp-performance">
            <div className="fp-info">
              <span className="fp-kicker">{isPlaying ? 'Sonando ahora' : 'En pausa'}</span>
              <h2 className={titleClassName}>{currentTrack?.title ?? 'Nada reproduciéndose'}</h2>
              <p>
                {currentTrack
                  ? `${currentTrack.artist} · ${currentTrack.album}`
                  : 'Importa música local para empezar'}
              </p>
            </div>

            <div className="fp-timeline">
              <span>{formatDuration(position)}</span>
              <input
                type="range"
                min="0"
                max={Math.max(safeDuration, 1)}
                value={Math.min(position, Math.max(safeDuration, 1))}
                onChange={event => onSeek(Number(event.target.value))}
                disabled={!currentTrack}
                aria-label="Seek"
                style={{ '--val': `${progress * 100}%` } as CSSProperties}
              />
              <span>{formatDuration(safeDuration)}</span>
            </div>

            <div className="fp-controls">
              <button
                onClick={onShuffle}
                className={`fp-side-btn ${shuffleEnabled ? 'active' : ''}`}
                aria-label="Shuffle"
                title="Shuffle (S)"
              >
                <ShuffleIcon size={19} />
              </button>
              <button className="fp-skip-btn" onClick={onPrevious} aria-label="Anterior" title="Anterior (P)">
                <PreviousIcon size={26} />
              </button>
              <button
                className="fp-play-btn"
                onClick={onToggle}
                disabled={!currentTrack}
                aria-label="Play / Pause"
                title="Play / Pause (Espacio)"
              >
                {isLoading ? <SpinnerIcon size={26} /> : isPlaying ? <PauseIcon size={28} /> : <PlayIcon size={28} />}
              </button>
              <button className="fp-skip-btn" onClick={onNext} aria-label="Siguiente" title="Siguiente (N)">
                <NextIcon size={26} />
              </button>
              <button
                onClick={onRepeat}
                className={`fp-side-btn ${repeatMode !== 'off' ? 'active' : ''}`}
                aria-label="Repeat"
                title="Repeat"
              >
                {repeatMode === 'one' ? <RepeatOneIcon size={19} /> : <RepeatIcon size={19} />}
              </button>
            </div>

            <div className="fp-volume-row">
              <button
                className="fp-side-btn"
                onClick={() => onVolume(volume > 0 ? 0 : 0.9)}
                aria-label="Mute"
                title="Mute (M)"
              >
                <VolumeIcon size={19} />
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={event => onVolume(Number(event.target.value))}
                aria-label="Volumen"
                style={{ '--val': `${volume * 100}%` } as CSSProperties}
              />
            </div>

            {currentTrack && playlists.length > 0 && onAddToPlaylist ? (
              <label className="fp-playlist-add">
                <PlaylistIcon size={18} />
                <select
                  defaultValue=""
                  disabled={currentTrackAvailablePlaylists.length === 0}
                  onChange={event => {
                    const playlistId = event.target.value;
                    if (!playlistId) return;
                    onAddToPlaylist(playlistId, currentTrack.id);
                    event.target.value = '';
                  }}
                  aria-label={`Agregar ${currentTrack.title} a playlist`}
                >
                  <option value="">
                    {currentTrackAvailablePlaylists.length > 0 ? 'Agregar a playlist' : 'Ya está en tus playlists'}
                  </option>
                  {currentTrackAvailablePlaylists.map(playlist => (
                    <option key={playlist.id} value={playlist.id}>{playlist.name}</option>
                  ))}
                </select>
              </label>
            ) : null}

            {currentTrack ? (
              <button
                className="fp-lyrics-toggle"
                onClick={handleLyricsOpen}
                aria-label="Ver letras"
              >
                <MusicNoteIcon size={18} />
                <span>Letras</span>
              </button>
            ) : null}
          </div>
        </section>

        {/* Lyrics — inline on tablet/desktop, overlay panel on mobile */}
        <aside
          className={`fp-lyrics-panel ${
            lyricsOpen ? 'open' : ''
          }${lyricsClosing ? ' closing' : ''}`}
          aria-label="Letras sincronizadas"
        >
          <div className="fp-lyrics-panel-header">
            <div className="fp-lyrics-handle" aria-hidden="true" />
            <button
              className="fp-lyrics-panel-close"
              onClick={handleLyricsClose}
              aria-label="Cerrar letras"
            >
              <CloseIcon size={20} />
            </button>
          </div>

          <div className="fp-lyrics-wrapper">
            {currentTrack ? (
              <>
                <div className="fp-lyrics-theme-picker" role="radiogroup" aria-label="Estilo de letras">
                  {LYRICS_THEMES.map(theme => (
                    <button
                      key={theme.id}
                      role="radio"
                      aria-checked={lyricsTheme === theme.id}
                      className={`fp-theme-chip ${lyricsTheme === theme.id ? 'active' : ''}`}
                      onClick={() => handleLyricsTheme(theme.id)}
                      title={theme.description}
                    >
                      {theme.label}
                    </button>
                  ))}
                </div>
                <div className="fp-lyrics-theme-picker fp-lyrics-font-picker" role="radiogroup" aria-label="Fuente de letras">
                  {LYRICS_FONTS.map(fontOption => (
                    <button
                      key={fontOption.id}
                      role="radio"
                      aria-checked={lyricsFont === fontOption.id}
                      className={`fp-theme-chip ${lyricsFont === fontOption.id ? 'active' : ''}`}
                      onClick={() => handleLyricsFont(fontOption.id)}
                      title={fontOption.description}
                      style={{ fontFamily: fontOption.stack }}
                    >
                      {fontOption.label}
                    </button>
                  ))}
                </div>
                <SyncedLyricsView
                  currentTrack={currentTrack}
                  isPlaying={isPlaying}
                  position={position}
                  duration={safeDuration}
                  onSeek={onSeek}
                  theme={lyricsTheme}
                  font={lyricsFont}
                />
              </>
            ) : (
              <div className="lyrics-state">
                <p className="no-lyrics-msg">Las letras aparecerán aquí al reproducir una canción.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
