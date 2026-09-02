import { formatDuration } from '@staysound/services/metadataService';
import { useEffect, useState } from 'react';
import {
  getCatalogAlbum,
  type CatalogAlbum,
  type CatalogAlbumDetail,
} from '../../downloads/monochromeCatalog';
import { DownloadIcon } from '../icons';
import {
  CatalogTrackRow,
  DlArtwork,
  DlErrorState,
  DlTrackSkeleton,
  type DownloadsCatalogApi,
} from './downloadUi';

/**
 * Ficha de álbum dentro de Descargas.
 *
 * El `seed` es lo que ya sabíamos del álbum al hacer clic (título, artista,
 * portada): se pinta de inmediato para que la cabecera no aparezca vacía
 * mientras Monochrome devuelve la tracklist.
 */
export function DownloadAlbumView({
  albumId,
  seed,
  api,
}: {
  albumId: number;
  seed?: CatalogAlbum;
  api: DownloadsCatalogApi;
}) {
  const [detail, setDetail] = useState<CatalogAlbumDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    getCatalogAlbum(albumId)
      .then(value => { if (!cancelled) setDetail(value); })
      .catch(cause => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar el álbum.');
      });
    return () => { cancelled = true; };
  }, [albumId, reloadKey]);

  const album = detail?.album ?? seed;
  const tracks = detail?.tracks ?? [];
  const totalDuration = tracks.reduce((sum, track) => sum + (track.durationMs || 0), 0);
  const pendingTracks = tracks.filter(track => !api.getTrackState(track.id));
  const trackCount = album?.trackCount ?? (tracks.length || undefined);

  return (
    <section className="dl-detail">
      <header className="dl-hero">
        <DlArtwork src={album?.artworkUrl} label={album?.title ?? 'Álbum'} className="dl-hero-art" />
        <div className="dl-hero-copy">
          <p className="dl-eyebrow">Álbum</p>
          <h1>{album?.title ?? 'Cargando…'}</h1>
          {album?.artist && (
            album.artistId
              ? (
                <button
                  className="dl-hero-artist"
                  onClick={() => api.openArtist({ id: album.artistId!, name: album.artist })}
                >
                  {album.artist}
                </button>
              )
              : <p className="dl-hero-artist static">{album.artist}</p>
          )}
          <div className="dl-hero-stats">
            {album?.year && <span>{album.year}</span>}
            {trackCount && <span>{trackCount} {trackCount === 1 ? 'canción' : 'canciones'}</span>}
            {totalDuration > 0 && <span>{formatDuration(totalDuration)}</span>}
            {album?.explicit && <span className="dl-explicit-tag">Explícito</span>}
          </div>
          <div className="dl-hero-actions">
            <button
              className="dl-btn primary"
              onClick={() => api.downloadTracks(pendingTracks)}
              disabled={pendingTracks.length === 0}
            >
              <DownloadIcon size={16} />
              <span>
                {tracks.length === 0
                  ? 'Descargar álbum'
                  : pendingTracks.length === 0
                    ? 'Álbum en tu biblioteca'
                    : pendingTracks.length === tracks.length
                      ? 'Descargar álbum'
                      : `Descargar ${pendingTracks.length} restantes`}
              </span>
            </button>
          </div>
        </div>
      </header>

      {error && (
        <DlErrorState message={error} onRetry={() => setReloadKey(key => key + 1)} />
      )}

      {!error && !detail && <DlTrackSkeleton rows={8} />}

      {detail && (
        <div className="dl-track-list numbered">
          {tracks.map((track, index) => (
            <CatalogTrackRow
              key={track.id}
              track={track}
              index={track.trackNumber ?? index + 1}
              api={api}
              showArtwork={false}
              showAlbum={false}
            />
          ))}
          {tracks.length === 0 && (
            <p className="dl-inline-empty">Monochrome no devolvió canciones para este álbum.</p>
          )}
        </div>
      )}
    </section>
  );
}
