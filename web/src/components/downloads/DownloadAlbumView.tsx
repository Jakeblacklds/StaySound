import { formatDuration } from '@staysound/services/metadataService';
import { useEffect, useState } from 'react';
import {
  getCatalogAlbum,
  getCatalogArtist,
  type CatalogAlbum,
  type CatalogAlbumDetail,
} from '../../downloads/monochromeCatalog';
import { canonicalAlbumTitle, foldText } from '../../downloads/catalogRanking';
import { DownloadIcon } from '../icons';
import {
  CatalogAlbumCard,
  CatalogTrackRow,
  DlSectionHeader,
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
  const [moreByArtist, setMoreByArtist] = useState<CatalogAlbum[]>([]);

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

  const albumArtistId = detail?.album.artistId ?? seed?.artistId;
  const albumArtistName = detail?.album.artist ?? seed?.artist;

  // "Más de …" como en Spotify: la discografía del artista viene de la misma
  // caché que su ficha, así que abrirla después es instantáneo.
  useEffect(() => {
    let cancelled = false;
    setMoreByArtist([]);
    if (!albumArtistId) return undefined;
    getCatalogArtist(albumArtistId, albumArtistName)
      .then(artistDetail => {
        if (cancelled) return;
        const ownTitle = foldText(canonicalAlbumTitle(detail?.album.title ?? seed?.title ?? ''));
        setMoreByArtist([...artistDetail.albums, ...artistDetail.singles]
          .filter(candidate => candidate.id !== albumId && foldText(candidate.title) !== ownTitle)
          .slice(0, 12));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId, albumArtistId]);

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
            <p className="dl-inline-empty">El catálogo no devolvió canciones para este álbum.</p>
          )}
        </div>
      )}

      {detail && moreByArtist.length > 0 && album?.artist && (
        <section className="dl-section">
          <DlSectionHeader
            title={`Más de ${album.artist}`}
            action={album.artistId && (
              <button className="dl-text-btn" onClick={() => api.openArtist({ id: album.artistId!, name: album.artist })}>
                Ver discografía
              </button>
            )}
          />
          <div className="dl-card-grid single-row">
            {moreByArtist.map(candidate => (
              <CatalogAlbumCard
                key={candidate.id}
                album={candidate}
                subtitle={[candidate.year, candidate.type === 'SINGLE' ? 'Sencillo' : candidate.type === 'EP' ? 'EP' : 'Álbum'].filter(Boolean).join(' · ')}
                onOpen={() => api.openAlbum(candidate)}
              />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
