import { formatDuration } from '@staysound/services/metadataService';
import type { ReactNode } from 'react';
import type { TidalTrack } from '@staysound/types/audio';
import type { CatalogAlbum, CatalogArtist } from '../../downloads/monochromeCatalog';
import { CheckIcon, DownloadIcon, SpinnerIcon } from '../icons';

/**
 * Piezas compartidas por las tres vistas de Descargas (búsqueda, álbum y
 * artista). Todas hablan el mismo idioma: una canción del catálogo + su estado
 * en la cola, y un solo botón que se explica solo en cada estado.
 */

export type DownloadItemStatus = 'queued' | 'resolving' | 'downloading' | 'done' | 'error';

export type DownloadItemState = {
  status: DownloadItemStatus;
  progress: number;
};

/** Lo que cada vista necesita del panel para funcionar. */
export type DownloadsCatalogApi = {
  getTrackState: (tidalId: number) => DownloadItemState | undefined;
  downloadTracks: (tracks: TidalTrack[]) => void;
  openAlbum: (album: CatalogAlbum) => void;
  openArtist: (artist: CatalogArtist) => void;
};

export function formatBytes(value?: number): string {
  if (!value || value <= 0) return '';
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

/** "LOSSLESS" / "HI_RES_LOSSLESS" son etiquetas de API, no de producto. */
export function formatCatalogQuality(quality?: string, isHiRes?: boolean): string | null {
  if (isHiRes) return 'Hi-Res';
  if (!quality) return null;
  const normalized = quality.toUpperCase();
  if (normalized.includes('HI_RES')) return 'Hi-Res';
  if (normalized.includes('LOSSLESS')) return 'FLAC';
  if (normalized === 'HIGH') return 'AAC 320';
  if (normalized === 'LOW') return 'AAC 96';
  return quality;
}

/** Indicador circular de progreso (0..1). */
export function ProgressRing({ value, size = 16 }: { value: number; size?: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0.02, Math.min(1, value));
  return (
    <svg className="progress-ring" viewBox="0 0 18 18" width={size} height={size} aria-hidden="true">
      <circle className="progress-ring-track" cx="9" cy="9" r={radius} />
      <circle
        className="progress-ring-fill"
        cx="9"
        cy="9"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
      />
    </svg>
  );
}

export function dlArtworkFallback(text: string): string {
  return (text.trim().slice(0, 1) || '·').toUpperCase();
}

export function DlArtwork({
  src,
  label,
  round = false,
  className = '',
}: {
  src?: string;
  label: string;
  round?: boolean;
  className?: string;
}) {
  return (
    <span className={`dl-art ${round ? 'round' : ''} ${className}`.trim()}>
      {src
        ? <img src={src} alt="" loading="lazy" />
        : <span className="dl-art-letter">{dlArtworkFallback(label)}</span>}
    </span>
  );
}

/**
 * Un botón por canción, con cuatro caras: descargar, en cola, progreso y lista.
 * Cuando falló se convierte en "Reintentar" — el panel decide si eso significa
 * reencolar o reevaluar fuentes.
 */
export function DownloadStateButton({
  state,
  onDownload,
  compact = false,
  label = 'Descargar',
}: {
  state?: DownloadItemState;
  onDownload: () => void;
  compact?: boolean;
  label?: string;
}) {
  const status = state?.status;
  const percent = Math.round((state?.progress ?? 0) * 100);

  if (status === 'done') {
    return (
      <span className={`dl-btn is-done ${compact ? 'compact' : ''}`.trim()} title="Ya está en tu biblioteca">
        <CheckIcon size={15} />
        {!compact && <span>Lista</span>}
      </span>
    );
  }

  if (status === 'error') {
    return (
      <button
        className={`dl-btn is-error ${compact ? 'compact' : ''}`.trim()}
        onClick={onDownload}
        title="Reintentar con otra fuente"
      >
        <DownloadIcon size={15} />
        {!compact && <span>Reintentar</span>}
      </button>
    );
  }

  if (status === 'downloading' || status === 'resolving') {
    return (
      <span className={`dl-btn is-active ${compact ? 'compact' : ''}`.trim()} title={`${percent}%`}>
        <ProgressRing value={state?.progress ?? 0} />
        {!compact && <span>{status === 'resolving' ? 'Buscando' : `${percent}%`}</span>}
      </span>
    );
  }

  if (status === 'queued') {
    return (
      <span className={`dl-btn is-queued ${compact ? 'compact' : ''}`.trim()} title="En cola">
        <SpinnerIcon size={15} />
        {!compact && <span>En cola</span>}
      </span>
    );
  }

  return (
    <button
      className={`dl-btn ${compact ? 'compact' : ''}`.trim()}
      onClick={onDownload}
      title={label}
      aria-label={label}
    >
      <DownloadIcon size={15} />
      {!compact && <span>{label}</span>}
    </button>
  );
}

/**
 * Fila de canción del catálogo. El álbum y el artista son enlaces reales: desde
 * cualquier resultado se puede seguir navegando sin volver a buscar.
 */
export function CatalogTrackRow({
  track,
  index,
  api,
  showArtwork = true,
  showArtist = true,
  showAlbum = true,
}: {
  track: TidalTrack;
  index?: number;
  api: DownloadsCatalogApi;
  showArtwork?: boolean;
  showArtist?: boolean;
  showAlbum?: boolean;
}) {
  const state = api.getTrackState(track.id);
  const quality = formatCatalogQuality(track.quality, track.isHiRes);

  const layout = [
    typeof index === 'number' ? 'has-index' : '',
    showArtwork ? 'has-art' : '',
    state?.status ? `is-${state.status}` : '',
  ].filter(Boolean).join(' ');

  return (
    <article className={`dl-track-row ${layout}`}>
      {typeof index === 'number' && <span className="dl-track-index">{index}</span>}
      {showArtwork && <DlArtwork src={track.artworkUrl} label={track.title} className="dl-track-art" />}
      <span className="dl-track-main">
        <strong title={track.title}>
          {track.title}
          {track.explicit && <span className="dl-explicit" title="Contenido explícito">E</span>}
        </strong>
        <small>
          {showArtist && (
            track.artistId
              ? (
                <button
                  className="dl-inline-link"
                  onClick={() => api.openArtist({ id: track.artistId!, name: track.artist })}
                >
                  {track.artist}
                </button>
              )
              : <span>{track.artist}</span>
          )}
          {showArtist && showAlbum && track.album && <span aria-hidden="true"> · </span>}
          {showAlbum && track.album && (
            track.albumId
              ? (
                <button
                  className="dl-inline-link"
                  onClick={() => api.openAlbum({
                    id: track.albumId!,
                    title: track.album,
                    artist: track.artist,
                    artistId: track.artistId,
                    artworkUrl: track.artworkUrl,
                  })}
                >
                  {track.album}
                </button>
              )
              : <span>{track.album}</span>
          )}
        </small>
      </span>
      {quality && <span className="dl-track-quality">{quality}</span>}
      <span className="dl-track-time">{track.durationMs ? formatDuration(track.durationMs) : ''}</span>
      <DownloadStateButton state={state} onDownload={() => api.downloadTracks([track])} compact />
    </article>
  );
}

export function CatalogAlbumCard({
  album,
  onOpen,
  subtitle,
}: {
  album: CatalogAlbum;
  onOpen: () => void;
  /** Dentro de la ficha del artista sobra repetir su nombre: ahí va "2024 · Sencillo". */
  subtitle?: string;
}) {
  return (
    <button className="dl-card" onClick={onOpen} title={`${album.title} · ${album.artist}`}>
      <DlArtwork src={album.artworkUrl} label={album.title} />
      <strong>{album.title}</strong>
      <small>{subtitle ?? [album.artist, album.year].filter(Boolean).join(' · ')}</small>
    </button>
  );
}

export function CatalogArtistCard({ artist, onOpen }: { artist: CatalogArtist; onOpen: () => void }) {
  return (
    <button className="dl-card artist" onClick={onOpen} title={artist.name}>
      <DlArtwork src={artist.artworkUrl} label={artist.name} round />
      <strong>{artist.name}</strong>
      <small>Artista</small>
    </button>
  );
}

export function DlSectionHeader({
  title,
  count,
  action,
}: {
  title: string;
  count?: string;
  action?: ReactNode;
}) {
  return (
    <header className="dl-section-head">
      <h2>{title}</h2>
      {count && <span className="dl-section-count">{count}</span>}
      {action && <span className="dl-section-action">{action}</span>}
    </header>
  );
}

export function DlTrackSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="dl-skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="dl-skeleton-row" key={index}>
          <span className="dl-skeleton-art" />
          <span className="dl-skeleton-lines">
            <span style={{ width: `${58 + ((index * 13) % 30)}%` }} />
            <span style={{ width: `${30 + ((index * 17) % 26)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function DlCardSkeleton({ cards = 6, round = false }: { cards?: number; round?: boolean }) {
  return (
    <div className="dl-card-grid" aria-hidden="true">
      {Array.from({ length: cards }, (_, index) => (
        <div className="dl-skeleton-card" key={index}>
          <span className={`dl-skeleton-art block ${round ? 'round' : ''}`.trim()} />
          <span className="dl-skeleton-lines">
            <span style={{ width: '80%' }} />
            <span style={{ width: '52%' }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function DlErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section className="dl-error-state" role="alert">
      <p>{message}</p>
      {onRetry && <button className="dl-btn ghost" onClick={onRetry}>Reintentar</button>}
    </section>
  );
}
