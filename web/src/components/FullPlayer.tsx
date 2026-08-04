import { formatDuration } from '@staysound/services/metadataService';
import type { Playlist, Track } from '@staysound/types/audio';
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDynamicPalette, paletteToCssVars, type WebDynamicPalette } from '../library/dynamicColors';
import { getAnimatedArtwork } from '../library/animatedArtwork';
import {
  LYRICS_FONTS,
  readStoredLyricsFont,
  storeLyricsFont,
  type LyricsFontId,
} from '../library/lyricsFonts';
import {
  describeSyncKind,
  lyricsSourcesStore,
  useLyricsSources,
} from '../library/lyricsSources';
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
  MicrophoneIcon,
  MusicNoteIcon,
  NextIcon,
  PauseIcon,
  PlaylistIcon,
  PlayIcon,
  PreviousIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  SearchIcon,
  ShuffleIcon,
  SlidersIcon,
  SpinnerIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMuteIcon,
} from './icons';
import { SyncedLyricsView } from './SyncedLyricsView';
import { LocalLyricsGenerator } from './LocalLyricsGenerator';
import { isTauriDesktop } from '../desktop/tauriMusicLibrary';
import { useIsDesktopViewport } from '../hooks/useIsDesktopViewport';

const LYRICS_TIMING_OFFSETS_KEY = 'staysound_lyrics_timing_offsets_v1';
const LYRICS_TIMING_STEP_MS = 250;
const MAX_LYRICS_TIMING_OFFSET_MS = 10_000;

function getLyricsTimingKey(track: Track): string {
  return `${track.artist.trim().toLowerCase()}::${track.title.trim().toLowerCase()}`;
}

function readLyricsTimingOffsets(): Record<string, number> {
  try {
    const value = window.localStorage.getItem(LYRICS_TIMING_OFFSETS_KEY);
    return value ? JSON.parse(value) as Record<string, number> : {};
  } catch {
    return {};
  }
}

function formatTimingOffset(offsetMs: number): string {
  if (offsetMs === 0) return '0.00 s';
  return `${offsetMs > 0 ? '+' : '−'}${(Math.abs(offsetMs) / 1000).toFixed(2)} s`;
}

function formatCacheAge(fetchedAt: number): string {
  const minutes = Math.round((Date.now() - fetchedAt) / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}

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
  onOpenKaraoke?: () => void;
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
  onOpenKaraoke,
  playlists = [],
  onAddToPlaylist,
}: FullPlayerProps) {
  const isDesktopViewport = useIsDesktopViewport();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const paletteRef = useRef<WebDynamicPalette | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsClosing, setLyricsClosing] = useState(false);
  const [lyricsSettingsClosing, setLyricsSettingsClosing] = useState(false);
  const [palette, setPalette] = useState<WebDynamicPalette | null>(null);
  const [previousPalette, setPreviousPalette] = useState<WebDynamicPalette | null>(null);
  const [paletteTransitionKey, setPaletteTransitionKey] = useState(0);
  const [lyricsTheme, setLyricsTheme] = useState<LyricsThemeId>(() => readStoredLyricsTheme());
  const [lyricsFont, setLyricsFont] = useState<LyricsFontId>(() => readStoredLyricsFont());
  const [lyricsSettingsOpen, setLyricsSettingsOpen] = useState(false);
  const [localLyricsGeneratorOpen, setLocalLyricsGeneratorOpen] = useState(false);
  const [lyricsMissing, setLyricsMissing] = useState(false);
  const [timingAdjustmentEnabled, setTimingAdjustmentEnabled] = useState(false);
  const lyricsSources = useLyricsSources();
  const [staticArtworkFailed, setStaticArtworkFailed] = useState(false);
  const [animatedArtworkUrl, setAnimatedArtworkUrl] = useState<string | null>(null);
  const [animatedArtworkReady, setAnimatedArtworkReady] = useState(false);
  const previousTrackRef = useRef<Track | null>(currentTrack);
  const trackDirectionRef = useRef<1 | -1>(1);
  const [outgoingTrack, setOutgoingTrack] = useState<Track | null>(null);
  const [trackSwapDirection, setTrackSwapDirection] = useState<1 | -1>(1);
  const [lyricsTimingOffsets, setLyricsTimingOffsets] = useState<Record<string, number>>(
    () => readLyricsTimingOffsets(),
  );
  const safeDuration = duration || currentTrack?.duration || 0;
  const trackKey = currentTrack?.id ?? 'empty';
  const progress = safeDuration > 0 ? Math.min(1, position / safeDuration) : 0;
  const volumePercent = Math.round(Math.max(0, Math.min(1, volume)) * 100);
  const titleLength = currentTrack?.title?.length ?? 0;
  const titleClassName = titleLength > 34 ? 'long' : titleLength > 20 ? 'medium' : '';
  const lyricsTimingKey = currentTrack ? getLyricsTimingKey(currentTrack) : '';
  const lyricsTimingOffsetMs = lyricsTimingOffsets[lyricsTimingKey] ?? 0;
  const isDesktopApp = isTauriDesktop();
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

  useEffect(() => {
    setStaticArtworkFailed(false);
    setAnimatedArtworkUrl(null);
    setAnimatedArtworkReady(false);
    setLyricsMissing(false);
    setLocalLyricsGeneratorOpen(false);
  }, [currentTrack?.id]);

  // The desktop Live Artwork API is intentionally separate from the visual
  // effects experiments: if Apple Music has a matching motion cover, show that
  // actual video above the static album art; otherwise the ordinary cover stays
  // in place. No CanvasUI processing is involved in this path.
  useEffect(() => {
    if (!currentTrack) return;
    const controller = new AbortController();
    void getAnimatedArtwork(currentTrack, controller.signal).then(url => {
      if (!controller.signal.aborted) setAnimatedArtworkUrl(url);
    });
    return () => controller.abort();
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.album]);

  useEffect(() => {
    const previousTrack = previousTrackRef.current;
    previousTrackRef.current = currentTrack;
    if (!previousTrack || previousTrack.id === currentTrack?.id) return;
    setOutgoingTrack(previousTrack);
    setTrackSwapDirection(trackDirectionRef.current);
    const timer = window.setTimeout(() => setOutgoingTrack(null), 360);
    return () => window.clearTimeout(timer);
  }, [currentTrack?.id]);

  const handleLyricsTheme = useCallback((themeId: LyricsThemeId) => {
    setLyricsTheme(themeId);
    storeLyricsTheme(themeId);
  }, []);

  const handlePrevious = useCallback(() => {
    trackDirectionRef.current = -1;
    setTrackSwapDirection(-1);
    onPrevious();
  }, [onPrevious]);

  const handleNext = useCallback(() => {
    trackDirectionRef.current = 1;
    setTrackSwapDirection(1);
    onNext();
  }, [onNext]);

  const handleLyricsFont = useCallback((fontId: LyricsFontId) => {
    setLyricsFont(fontId);
    storeLyricsFont(fontId);
  }, []);

  const updateLyricsTimingOffset = useCallback((nextOffsetMs: number) => {
    if (!lyricsTimingKey) return;
    const clampedOffset = Math.max(
      -MAX_LYRICS_TIMING_OFFSET_MS,
      Math.min(MAX_LYRICS_TIMING_OFFSET_MS, nextOffsetMs),
    );
    setLyricsTimingOffsets(previous => {
      const next = { ...previous, [lyricsTimingKey]: clampedOffset };
      try {
        window.localStorage.setItem(LYRICS_TIMING_OFFSETS_KEY, JSON.stringify(next));
      } catch {
        // The in-memory adjustment still works if storage is unavailable.
      }
      return next;
    });
  }, [lyricsTimingKey]);

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

  const handleLyricsSettingsClose = useCallback(() => {
    if (lyricsSettingsClosing) return;
    setLyricsSettingsClosing(true);
    window.setTimeout(() => {
      setLyricsSettingsClosing(false);
      setLyricsSettingsOpen(false);
    }, 200);
  }, [lyricsSettingsClosing]);

  const handleOpenLocalLyricsGenerator = useCallback(() => {
    setLyricsSettingsOpen(false);
    setLyricsSettingsClosing(false);
    setLocalLyricsGeneratorOpen(true);
  }, []);

  const handleLyricsAvailability = useCallback((hasLyrics: boolean) => {
    setLyricsMissing(!hasLyrics);
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 280);
  }, [onClose]);

  /* The overlay covers the whole app, so it needs the two things every
     full-screen surface owes a keyboard user: Escape dismisses it, and focus
     moves into it on open (and back out on close) instead of being left behind
     on <body> with the tab order still running through the page underneath. */
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      handleClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [handleClose]);

  const VolumeIcon = volume === 0 ? VolumeMuteIcon : volume < 0.5 ? VolumeLowIcon : VolumeHighIcon;
  const currentTrackAvailablePlaylists = currentTrack
    ? playlists.filter(playlist => !playlist.readonly && !playlist.trackIds.includes(currentTrack.id))
    : [];

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={currentTrack ? `Reproductor: ${currentTrack.title}` : 'Reproductor'}
      className={`full-player-overlay immersive track-swap-${trackSwapDirection > 0 ? 'forward' : 'backward'} ${closing ? 'closing' : ''} ${isDesktopViewport ? 'circ' : ''}`}
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
        <div className="fp-header-left">
          <button ref={closeButtonRef} className="fp-chip-btn" onClick={handleClose} aria-label="Cerrar" title="Cerrar (Esc)">
            <ChevronDownIcon size={20} />
          </button>
          <span key={`breadcrumb-${trackKey}`} className="fp-breadcrumb fp-breadcrumb-incoming">
            {currentTrack ? `${currentTrack.album} / ${currentTrack.title}` : 'StaySound'}
          </span>
        </div>
        {/* Bound to real playback state. This used to be the literal string
            "Reproduciendo", which kept claiming playback for tracks that had
            failed to load — the deck below it was already showing the pause
            icon while this line insisted the song was playing. */}
        <span className={`fp-header-title ${isPlaying ? '' : 'is-idle'}`}>
          {isLoading ? 'Cargando' : isPlaying ? 'Reproduciendo' : 'En pausa'}
        </span>
        <div className="fp-header-actions">
          {currentTrack && onOpenKaraoke ? (
            <button
              className="fp-chip-btn fp-karaoke-launch"
              onClick={onOpenKaraoke}
              aria-label="Abrir Karaoke"
              title="Karaoke"
            >
              <MicrophoneIcon size={20} />
              <span>Karaoke</span>
            </button>
          ) : null}
          {currentTrack ? (
            <button
              className="fp-chip-btn"
              onClick={() => setLyricsSettingsOpen(true)}
              aria-label="Ajustes de letras"
              title="Ajustes de letras"
            >
              <SlidersIcon size={20} />
              <span>Ajustes de letra</span>
            </button>
          ) : null}
          <button className="fp-chip-btn" onClick={onOpenQueue} aria-label="Cola" title="Cola (Q)">
            <QueueIcon size={20} />
            <span>Cola</span>
          </button>
        </div>
      </div>

      <div className="fp-body">
        <section className="fp-left-scene">
          <div className="fp-artwork-stage" aria-hidden="true">
            {outgoingTrack ? (
              <div
                key={`outgoing-${outgoingTrack.id}`}
                className="fp-artwork fp-track-outgoing"
              >
                <div className="fp-artwork-static">
                  {outgoingTrack.artwork ? (
                    <img src={outgoingTrack.artwork} alt="" />
                  ) : (
                    <span className="fp-artwork-letter">{outgoingTrack.title.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
              </div>
            ) : null}
            <div
              key={trackKey}
              className="fp-artwork fp-track-incoming"
            >
              <div className={`fp-artwork-static ${animatedArtworkReady ? 'yielding' : ''}`}>
                {currentTrack?.artwork && !staticArtworkFailed ? (
                  <img src={currentTrack.artwork} alt="" onError={() => setStaticArtworkFailed(true)} />
                ) : (
                  <span className="fp-artwork-letter">
                    {currentTrack ? currentTrack.title.slice(0, 1).toUpperCase() : 'S'}
                  </span>
                )}
              </div>
              {animatedArtworkUrl ? (
                <div className={`fp-artwork-motion ${animatedArtworkReady ? 'ready' : ''}`}>
                  <video
                    key={animatedArtworkUrl}
                    src={animatedArtworkUrl}
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload="metadata"
                    onCanPlay={() => setAnimatedArtworkReady(true)}
                    onError={() => {
                      setAnimatedArtworkReady(false);
                      setAnimatedArtworkUrl(null);
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="fp-performance">
            {outgoingTrack ? (
              <div
                key={`outgoing-copy-${outgoingTrack.id}`}
                className="fp-info fp-info-outgoing"
                aria-hidden="true"
              >
                <span className="fp-catalog">
                  {[outgoingTrack.format, outgoingTrack.quality].filter(Boolean).join(' · ') || 'Biblioteca local'}
                </span>
                <h2>{outgoingTrack.title}</h2>
                <p>{outgoingTrack.artist} · {outgoingTrack.album}</p>
              </div>
            ) : null}
            <div
              key={`current-copy-${trackKey}`}
              className="fp-info fp-info-incoming"
            >
              {/* Real technical metadata. This line used to read "SS-2019 · FLAC",
                  where the SS- prefix was decoration and the year was already
                  repeated in the line below. Format and quality are the facts a
                  listener actually wants here and appear nowhere else. */}
              <span className="fp-catalog">
                {[currentTrack?.format, currentTrack?.quality].filter(Boolean).join(' · ') || 'Biblioteca local'}
              </span>
              <h2 className={titleClassName}>{currentTrack?.title ?? 'Nada reproduciéndose'}</h2>
              <p>
                {currentTrack
                  ? `${currentTrack.artist} · ${currentTrack.album}${currentTrack.year ? ` · ${currentTrack.year}` : ''}`
                  : 'Importa música local para empezar'}
              </p>
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
            {currentTrack ? (
              <button
                className="fp-lyrics-panel-settings"
                onClick={() => setLyricsSettingsOpen(true)}
                aria-label="Ajustes de letras"
              >
                <SlidersIcon size={18} />
              </button>
            ) : null}
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
              <div
                key={`lyrics-${trackKey}`}
                className="fp-lyrics-track-incoming"
              >
                <SyncedLyricsView
                  currentTrack={currentTrack}
                  isPlaying={isPlaying}
                  position={position}
                  duration={safeDuration}
                  onSeek={onSeek}
                  theme={lyricsTheme}
                  font={lyricsFont}
                  palette={palette}
                  timingOffsetMs={lyricsTimingOffsetMs}
                  onAvailabilityChange={handleLyricsAvailability}
                />
                {isDesktopApp && lyricsMissing ? (
                  <div className="fp-local-lyrics-empty">
                    <span>Sin letra</span>
                    <button type="button" onClick={handleOpenLocalLyricsGenerator}>
                      <MicrophoneIcon size={17} />
                      Crear
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="lyrics-state">
                <p className="no-lyrics-msg">Las letras aparecerán aquí al reproducir una canción.</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      <footer className="fp-deck">
        <div className="fp-deck-track">
          <div key={`deck-art-${trackKey}`} className="fp-deck-artwork fp-deck-track-incoming">
            {currentTrack?.artwork && !staticArtworkFailed ? (
              <img src={currentTrack.artwork} alt="" />
            ) : (
              <span>{currentTrack?.title.slice(0, 1).toUpperCase() ?? 'S'}</span>
            )}
          </div>
          <div key={`deck-copy-${trackKey}`} className="fp-deck-copy fp-deck-track-incoming">
            <strong>{currentTrack?.title ?? 'Nada reproduciéndose'}</strong>
            <small>{currentTrack ? `${currentTrack.artist} · ${currentTrack.album}` : 'Biblioteca local'}</small>
          </div>
        </div>

        <div className="fp-deck-transport">
          <div className="fp-controls">
            <button
              onClick={onShuffle}
              className={`fp-side-btn ${shuffleEnabled ? 'active' : ''}`}
              aria-label="Shuffle"
              title="Shuffle (S)"
            >
              <ShuffleIcon size={18} />
            </button>
            <button className="fp-skip-btn" onClick={handlePrevious} aria-label="Anterior" title="Anterior (P)">
              <PreviousIcon size={23} />
            </button>
            <button
              className="fp-play-btn"
              onClick={onToggle}
              disabled={!currentTrack}
              aria-label="Play / Pause"
              title="Play / Pause (Espacio)"
            >
              {isLoading ? <SpinnerIcon size={22} /> : isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
            </button>
            <button className="fp-skip-btn" onClick={handleNext} aria-label="Siguiente" title="Siguiente (N)">
              <NextIcon size={23} />
            </button>
            <button
              onClick={onRepeat}
              className={`fp-side-btn ${repeatMode !== 'off' ? 'active' : ''}`}
              aria-label="Repeat"
              title="Repeat"
            >
              {repeatMode === 'one' ? <RepeatOneIcon size={18} /> : <RepeatIcon size={18} />}
            </button>
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
        </div>

        <div className="fp-deck-utilities">
          <button className="fp-utility-btn" onClick={onOpenQueue} aria-label="Cola">
            <QueueIcon size={18} /><span>Cola</span>
          </button>
          <div className="fp-volume-row">
            <button
              className="fp-side-btn"
              onClick={() => onVolume(volume > 0 ? 0 : 0.9)}
              aria-label="Mute"
              title="Mute (M)"
            >
              <VolumeIcon size={18} />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={volumePercent}
              onInput={event => onVolume(event.currentTarget.valueAsNumber / 100)}
              aria-label="Volumen"
              style={{ '--val': `${volumePercent}%` } as CSSProperties}
            />
          </div>
        </div>
      </footer>

      {lyricsSettingsOpen && currentTrack ? (
        <div
          className={`fp-lyrics-settings-overlay ${lyricsSettingsClosing ? 'closing' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="Ajustes de letras"
          onClick={handleLyricsSettingsClose}
        >
          <div className={`fp-lyrics-settings-modal ${lyricsSettingsClosing ? 'closing' : ''}`} onClick={event => event.stopPropagation()}>
            <div className="fp-lyrics-settings-head">
              <h2>Ajustes de letras</h2>
              <button
                className="fp-lyrics-settings-close"
                onClick={handleLyricsSettingsClose}
                aria-label="Cerrar ajustes"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div className="fp-lyrics-settings-group" role="radiogroup" aria-label="Efecto de relleno">
              <span className="fp-lyrics-settings-label">Efecto</span>
              <div className="fp-lyrics-settings-options">
                {LYRICS_THEMES.map(theme => (
                  <button
                    key={theme.id}
                    role="radio"
                    aria-checked={lyricsTheme === theme.id}
                    className={`fp-lyrics-option ${lyricsTheme === theme.id ? 'active' : ''}`}
                    onClick={() => handleLyricsTheme(theme.id)}
                  >
                    <span className="fp-lyrics-option-name">{theme.label}</span>
                    <span className="fp-lyrics-option-desc">{theme.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="fp-lyrics-settings-group" role="radiogroup" aria-label="Fuente">
              <span className="fp-lyrics-settings-label">Fuente</span>
              <div className="fp-lyrics-settings-options">
                {LYRICS_FONTS.map(fontOption => (
                  <button
                    key={fontOption.id}
                    role="radio"
                    aria-checked={lyricsFont === fontOption.id}
                    className={`fp-lyrics-option ${lyricsFont === fontOption.id ? 'active' : ''}`}
                    onClick={() => handleLyricsFont(fontOption.id)}
                  >
                    <span className="fp-lyrics-option-name" style={{ fontFamily: fontOption.stack }}>
                      {fontOption.label}
                    </span>
                    <span className="fp-lyrics-option-desc">{fontOption.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="fp-lyrics-settings-group fp-lyrics-sources-group">
              <div className="fp-lyrics-sources-heading">
                <div>
                  <span className="fp-lyrics-settings-label">Origen de la letra</span>
                  <span className="fp-lyrics-sources-help">
                    {lyricsSources.status === 'loading'
                      ? 'Consultando todos los proveedores…'
                      : lyricsSources.status === 'error'
                        ? 'No se pudo completar la búsqueda.'
                        : lyricsSources.status === 'empty'
                          ? 'Ningún proveedor tiene esta canción.'
                          : lyricsSources.candidates.length > 0
                            ? `${lyricsSources.candidates.length} ${
                                lyricsSources.candidates.length === 1 ? 'candidata' : 'candidatas'
                              }${
                                lyricsSources.fetchedAt
                                  ? ` · en caché ${formatCacheAge(lyricsSources.fetchedAt)}`
                                  : ''
                              }`
                            : 'Busca en todos los proveedores si falta la letra palabra por palabra.'}
                  </span>
                </div>
                <button
                  type="button"
                  className="fp-lyrics-sources-search"
                  onClick={() => void lyricsSourcesStore.refresh()}
                  disabled={!lyricsSources.canSearch || lyricsSources.status === 'loading'}
                >
                  {lyricsSources.status === 'loading' ? <SpinnerIcon size={15} /> : <SearchIcon size={15} />}
                  <span>{lyricsSources.status === 'loading' ? 'Buscando' : 'Buscar de nuevo'}</span>
                </button>
              </div>

              {lyricsSources.candidates.length > 0 ? (
                <div
                  className="fp-lyrics-settings-options fp-lyrics-sources-options"
                  role="radiogroup"
                  aria-label="Origen de la letra"
                >
                  {lyricsSources.candidates.map(candidate => (
                    <button
                      key={candidate.id}
                      role="radio"
                      aria-checked={lyricsSources.selectedId === candidate.id}
                      className={`fp-lyrics-option fp-lyrics-source-option ${
                        lyricsSources.selectedId === candidate.id ? 'active' : ''
                      }`}
                      onClick={() => lyricsSourcesStore.select(candidate.id)}
                    >
                      <span className="fp-lyrics-source-top">
                        <span className="fp-lyrics-option-name">{candidate.source}</span>
                        <span className={`fp-lyrics-sync-badge ${candidate.syncKind}`}>
                          {describeSyncKind(candidate.syncKind)}
                        </span>
                      </span>
                      <span className="fp-lyrics-option-desc">
                        {candidate.lineCount} líneas
                        {candidate.preview ? ` · ${candidate.preview}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {isDesktopApp ? (
              <div className="fp-lyrics-settings-group fp-local-lyrics-group">
                <div>
                  <span className="fp-lyrics-settings-label">Letra local</span>
                </div>
                <button type="button" className="fp-local-lyrics-button" onClick={handleOpenLocalLyricsGenerator}>
                  <MicrophoneIcon size={16} />
                  Crear
                </button>
              </div>
            ) : null}

            {isDesktopApp ? (
              <div className="fp-lyrics-settings-group fp-lyrics-timing-group">
                <div className="fp-lyrics-timing-heading">
                  <div>
                    <span className="fp-lyrics-settings-label">Sincronización</span>
                    <span className="fp-lyrics-timing-help">Corrige letras que aparecen antes o después de la canción.</span>
                  </div>
                  <button
                    type="button"
                    className={`fp-lyrics-timing-toggle ${timingAdjustmentEnabled ? 'active' : ''}`}
                    role="switch"
                    aria-checked={timingAdjustmentEnabled}
                    onClick={() => setTimingAdjustmentEnabled(enabled => !enabled)}
                  >
                    <span aria-hidden="true" />
                  </button>
                </div>

                {timingAdjustmentEnabled ? (
                  <div className="fp-lyrics-timing-controls">
                    <output className="fp-lyrics-timing-value" aria-live="polite">
                      {formatTimingOffset(lyricsTimingOffsetMs)}
                    </output>
                    <div className="fp-lyrics-timing-actions">
                      <button type="button" onClick={() => updateLyricsTimingOffset(lyricsTimingOffsetMs - LYRICS_TIMING_STEP_MS)}>
                        Atrasar 0.25 s
                      </button>
                      <button type="button" onClick={() => updateLyricsTimingOffset(lyricsTimingOffsetMs + LYRICS_TIMING_STEP_MS)}>
                        Adelantar 0.25 s
                      </button>
                      <button
                        type="button"
                        className="fp-lyrics-timing-reset"
                        disabled={lyricsTimingOffsetMs === 0}
                        onClick={() => updateLyricsTimingOffset(0)}
                      >
                        Restablecer
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {localLyricsGeneratorOpen && currentTrack && isDesktopApp ? (
        <LocalLyricsGenerator
          track={currentTrack}
          onClose={() => setLocalLyricsGeneratorOpen(false)}
        />
      ) : null}
    </div>
  );
}
