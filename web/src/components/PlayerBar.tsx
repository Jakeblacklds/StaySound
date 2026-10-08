import { formatDuration } from '@staysound/services/metadataService';
import type { Track } from '@staysound/types/audio';
import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { getDynamicPalette, type WebDynamicPalette } from '../library/dynamicColors';
import {
  NextIcon,
  PlayPauseIcon,
  PreviousIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SpinnerIcon,
  SyncIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMuteIcon,
} from './icons';

interface PlayerBarProps {
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
  onOpenFullPlayer: () => void;
  onOpenQueue: () => void;
  onStartRadio: () => void;
  isRadioLoading?: boolean;
}

export function PlayerBar({
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
  onOpenFullPlayer,
  onOpenQueue,
  onStartRadio,
  isRadioLoading = false,
}: PlayerBarProps) {
  const [palette, setPalette] = useState<WebDynamicPalette | null>(null);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const safeDuration = duration || currentTrack?.duration || 0;
  const progress = safeDuration > 0 ? Math.min(1, position / safeDuration) : 0;
  const volumePercent = Math.round(Math.max(0, Math.min(1, volume)) * 100);

  useEffect(() => {
    let active = true;
    setArtworkFailed(false);
    void getDynamicPalette(currentTrack).then(nextPalette => {
      if (active) setPalette(nextPalette);
    });
    return () => {
      active = false;
    };
  }, [currentTrack?.id, currentTrack?.artwork]);

  const accentStyle = useMemo<CSSProperties>(() => {
    if (!palette || !currentTrack) return {};
    return {
      '--bar-accent': palette.primary,
      '--bar-accent-soft': palette.secondary,
    } as CSSProperties;
  }, [palette, currentTrack]);

  const VolumeIcon = volume === 0 ? VolumeMuteIcon : volume < 0.5 ? VolumeLowIcon : VolumeHighIcon;

  return (
    <footer className="player-bar" style={accentStyle}>
      <div className="now-playing" onClick={onOpenFullPlayer} role="button" tabIndex={0}
        onKeyDown={event => { if (event.key === 'Enter') onOpenFullPlayer(); }}>
        <div key={currentTrack?.id ?? 'empty'} className={`np-artwork ${isPlaying ? 'playing' : ''}`}>
          {currentTrack?.artwork && !artworkFailed ? (
            <img src={currentTrack.artwork} alt="" onError={() => setArtworkFailed(true)} />
          ) : (
            <span className="np-artwork-letter">
              {currentTrack ? currentTrack.title.slice(0, 1).toUpperCase() : 'S'}
            </span>
          )}
        </div>
        <div key={`info-${currentTrack?.id ?? 'empty'}`} className="np-info">
          <strong>{currentTrack?.title ?? 'Nada reproduciéndose'}</strong>
          <small>
            {currentTrack
              ? `${currentTrack.artist} · ${currentTrack.album}`
              : 'Importa música local para empezar'}
          </small>
        </div>
      </div>

      <div className="transport">
        <div className="transport-buttons">
          <button
            onClick={onShuffle}
            className={`t-btn ${shuffleEnabled ? 'active' : ''}`}
            aria-label="Shuffle"
            title="Shuffle (S)"
          >
            <ShuffleIcon size={16} />
          </button>
          <button className="t-btn" onClick={onPrevious} aria-label="Anterior" title="Anterior (P)">
            <PreviousIcon size={20} />
          </button>
          <button
            className="play-btn"
            onClick={onToggle}
            disabled={!currentTrack}
            aria-label="Play / Pause"
            title="Play / Pause (Espacio)"
          >
            {isLoading ? <SpinnerIcon size={20} /> : <PlayPauseIcon playing={isPlaying} size={20} />}
          </button>
          <button className="t-btn" onClick={onNext} aria-label="Siguiente" title="Siguiente (N)">
            <NextIcon size={20} />
          </button>
          <button
            onClick={onRepeat}
            className={`t-btn ${repeatMode !== 'off' ? 'active' : ''}`}
            aria-label="Repeat"
            title="Repeat"
          >
            {repeatMode === 'one' ? <RepeatOneIcon size={16} /> : <RepeatIcon size={16} />}
          </button>
          <button
            className="t-btn radio-action"
            onClick={onStartRadio}
            disabled={!currentTrack || isRadioLoading}
            aria-label="Iniciar radio desde esta canción"
            title="Iniciar radio desde esta canción"
          >
            {isRadioLoading ? <SpinnerIcon size={16} /> : <SyncIcon size={17} />}
          </button>
        </div>
        <div className="timeline">
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

      <div className="volume-control">
        <button className="t-btn" onClick={onOpenQueue} aria-label="Cola" title="Cola (Q)">
          <QueueIcon size={18} />
        </button>
        <button
          className="t-btn"
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
    </footer>
  );
}
