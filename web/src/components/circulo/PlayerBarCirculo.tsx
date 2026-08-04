import type { CSSProperties } from 'react';
import type { Track } from '@staysound/types/audio';
import { formatDuration } from '@staysound/services/metadataService';
import {
  LyricsIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SyncIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMuteIcon,
} from '../icons';
import { CircleArt, hueFromId } from './CircleArt';
import { Waveform } from './Waveform';
import { QualityChip } from './QualityChip';
import { formatQualitySpecs } from '../../library/formatQuality';

interface PlayerBarCirculoProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  repeatMode: 'off' | 'all' | 'one';
  shuffleEnabled: boolean;
  volume: number;
  onVolume: (volume: number) => void;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (position: number) => void;
  onRepeat: () => void;
  onShuffle: () => void;
  onOpenFullPlayer: () => void;
  onOpenQueue: () => void;
  onStartRadio: () => void;
  isRadioLoading?: boolean;
  queueOpen: boolean;
}

/** Círculo's persistent 150px black player bar: obra (art + copy) / transporte (shuffle-prev-
    PLAY-next-repeat over the waveform) / utilidades (quality · letras · radio · cola). Ported
    from the design kit's PlayerBarCirculo.jsx, using the app's real audio state and its real
    getDynamicPalette-driven --dyn-accent instead of the mock's per-album hue. */
export function PlayerBarCirculo({
  currentTrack,
  isPlaying,
  position,
  duration,
  repeatMode,
  shuffleEnabled,
  volume,
  onVolume,
  onToggle,
  onNext,
  onPrevious,
  onSeek,
  onRepeat,
  onShuffle,
  onOpenFullPlayer,
  onOpenQueue,
  onStartRadio,
  isRadioLoading = false,
  queueOpen,
}: PlayerBarCirculoProps) {
  if (!currentTrack) return null;

  const quality = formatQualitySpecs(currentTrack);
  const hue = hueFromId(currentTrack.albumId ?? currentTrack.album ?? currentTrack.id);
  const positionSeconds = position / 1000;
  const durationSeconds = duration / 1000;
  const volumePercent = Math.round(Math.max(0, Math.min(1, volume)) * 100);
  const VolumeIcon = volume === 0 ? VolumeMuteIcon : volume < 0.5 ? VolumeLowIcon : VolumeHighIcon;

  return (
    <footer className="circ-player-bar">
      <div className="circ-pb-obra" onClick={onOpenFullPlayer} role="button" tabIndex={0}
        onKeyDown={event => { if (event.key === 'Enter') onOpenFullPlayer(); }}>
        <CircleArt size={64} src={currentTrack.artwork} hue={hue} className="circ-pb-art" />
        <span className="circ-pb-copy">
          <strong>{currentTrack.title}</strong>
          <small>{currentTrack.artist}</small>
          {/* The format sits with the track it describes (as on Home and the detail
              views) rather than in the utilities zone — that zone has to carry four
              actions plus volume, and the stacked chip was wrapping into the scrubber. */}
          <QualityChip quality={quality} />
        </span>
      </div>

      <div className="circ-pb-transporte">
        <div className="circ-pb-controls">
          <button type="button" aria-label="Aleatorio" className={shuffleEnabled ? 'active' : ''} onClick={onShuffle}>
            <ShuffleIcon size={20} />
          </button>
          <button type="button" aria-label="Anterior" onClick={onPrevious}>
            <PreviousIcon size={22} />
          </button>
          <button type="button" aria-label={isPlaying ? 'Pausar' : 'Reproducir'} className="circ-pb-play" onClick={onToggle}>
            {isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
          </button>
          <button type="button" aria-label="Siguiente" onClick={onNext}>
            <NextIcon size={22} />
          </button>
          <button type="button" aria-label="Repetir" className={repeatMode !== 'off' ? 'active' : ''} onClick={onRepeat}>
            {repeatMode === 'one' ? <RepeatOneIcon size={20} /> : <RepeatIcon size={20} />}
          </button>
        </div>
        <div className="circ-pb-scrub">
          <span>{formatDuration(position)}</span>
          <Waveform value={positionSeconds} max={Math.max(durationSeconds, 1)} seed={currentTrack.duration} onSeek={value => onSeek(value * 1000)} />
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="circ-pb-utilidades">
        {/* Labels sit in their own span so narrow windows can drop to icon-only
            without losing the accessible name. */}
        <button type="button" className="circ-pb-utility" onClick={onOpenFullPlayer} aria-label="Letras">
          <LyricsIcon size={22} />
          <span className="circ-pb-utility-label">Letras</span>
        </button>
        <span className="circ-pb-divider" />
        <button type="button" className={`circ-pb-utility ${isRadioLoading ? 'busy' : ''}`} onClick={onStartRadio} disabled={isRadioLoading} aria-label="Radio">
          <SyncIcon size={22} />
          <span className="circ-pb-utility-label">Radio</span>
        </button>
        <span className="circ-pb-divider" />
        <button type="button" className={`circ-pb-utility ${queueOpen ? 'active' : ''}`} onClick={onOpenQueue} aria-label="Cola">
          <QueueIcon size={22} />
          <span className="circ-pb-utility-label">Cola</span>
        </button>
        <span className="circ-pb-divider" />
        <div className="circ-pb-volume">
          <button
            type="button"
            aria-label={volume > 0 ? 'Silenciar' : 'Activar sonido'}
            onClick={() => onVolume(volume > 0 ? 0 : 0.9)}
          >
            <VolumeIcon size={20} />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volumePercent}
            onChange={event => onVolume(event.currentTarget.valueAsNumber / 100)}
            aria-label="Volumen"
            style={{ '--val': `${volumePercent}%` } as CSSProperties}
          />
        </div>
      </div>
    </footer>
  );
}
