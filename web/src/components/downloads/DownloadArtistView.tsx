import { useEffect, useState } from 'react';
import {
  getCatalogArtist,
  type CatalogArtist,
  type CatalogArtistDetail,
} from '../../downloads/monochromeCatalog';
import { DownloadIcon } from '../icons';
import {
  CatalogAlbumCard,
  CatalogTrackRow,
  DlArtwork,
  DlCardSkeleton,
  DlErrorState,
  DlSectionHeader,
  DlTrackSkeleton,
  type DownloadsCatalogApi,
} from './downloadUi';

const TOP_TRACKS_COLLAPSED = 5;

/**
 * Ficha de artista dentro de Descargas: populares + discografía, ambos
 * navegables. Monochrome no expone la discografía en /artist/, así que
 * `getCatalogArtist` la reconstruye por nombre — puede quedar incompleta, por
 * eso la sección se oculta en vez de mostrar un hueco vacío.
 */
export function DownloadArtistView({
  artistId,
  seed,
  api,
}: {
  artistId: number;
  seed?: CatalogArtist;
  api: DownloadsCatalogApi;
}) {
  const [detail, setDetail] = useState<CatalogArtistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setShowAllTracks(false);
    getCatalogArtist(artistId, seed?.name)
      .then(value => { if (!cancelled) setDetail(value); })
      .catch(cause => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar el artista.');
      });
    return () => { cancelled = true; };
    // seed?.name solo aporta la primera vez; recargar por su identidad haría
    // trabajo de red redundante al volver atrás.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId, reloadKey]);

  const artist = detail?.artist ?? seed;
  const topTracks = detail?.topTracks ?? [];
  const albums = detail?.albums ?? [];
  const visibleTracks = showAllTracks ? topTracks.slice(0, 25) : topTracks.slice(0, TOP_TRACKS_COLLAPSED);
  const pendingTop = topTracks.slice(0, 10).filter(track => !api.getTrackState(track.id));

  return (
    <section className="dl-detail">
      <header className="dl-hero artist">
        <DlArtwork src={artist?.artworkUrl} label={artist?.name ?? 'Artista'} round className="dl-hero-art" />
        <div className="dl-hero-copy">
          <p className="dl-eyebrow">Artista</p>
          <h1>{artist?.name ?? 'Cargando…'}</h1>
          <div className="dl-hero-stats">
            {topTracks.length > 0 && <span>{topTracks.length} canciones</span>}
            {albums.length > 0 && <span>{albums.length} {albums.length === 1 ? 'álbum' : 'álbumes'}</span>}
          </div>
          <div className="dl-hero-actions">
            <button
              className="dl-btn primary"
              onClick={() => api.downloadTracks(pendingTop)}
              disabled={pendingTop.length === 0}
            >
              <DownloadIcon size={16} />
              <span>{pendingTop.length === 0 && topTracks.length > 0 ? 'Top en tu biblioteca' : 'Descargar top 10'}</span>
            </button>
          </div>
        </div>
      </header>

      {error && <DlErrorState message={error} onRetry={() => setReloadKey(key => key + 1)} />}

      {!error && !detail && (
        <>
          <DlSectionHeader title="Populares" />
          <DlTrackSkeleton rows={5} />
          <DlSectionHeader title="Álbumes" />
          <DlCardSkeleton cards={6} />
        </>
      )}

      {detail && topTracks.length > 0 && (
        <section className="dl-section">
          <DlSectionHeader
            title="Populares"
            action={topTracks.length > TOP_TRACKS_COLLAPSED && (
              <button className="dl-text-btn" onClick={() => setShowAllTracks(open => !open)}>
                {showAllTracks ? 'Ver menos' : `Ver ${Math.min(topTracks.length, 25) - TOP_TRACKS_COLLAPSED} más`}
              </button>
            )}
          />
          <div className="dl-track-list numbered">
            {visibleTracks.map((track, index) => (
              <CatalogTrackRow
                key={track.id}
                track={track}
                index={index + 1}
                api={api}
                showArtwork
                showArtist={false}
              />
            ))}
          </div>
        </section>
      )}

      {detail && albums.length > 0 && (
        <section className="dl-section">
          <DlSectionHeader title="Álbumes" count={`${albums.length}`} />
          <div className="dl-card-grid">
            {albums.map(album => (
              <CatalogAlbumCard key={album.id} album={album} onOpen={() => api.openAlbum(album)} />
            ))}
          </div>
        </section>
      )}

      {detail && topTracks.length === 0 && albums.length === 0 && (
        <p className="dl-inline-empty">Monochrome no devolvió catálogo para este artista.</p>
      )}
    </section>
  );
}
