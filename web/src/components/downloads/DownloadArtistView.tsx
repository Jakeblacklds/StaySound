import { type CSSProperties, useEffect, useState } from 'react';
import {
  getCatalogArtist,
  type CatalogAlbum,
  type CatalogArtist,
  type CatalogArtistDetail,
} from '../../downloads/monochromeCatalog';
import { DownloadIcon } from '../icons';
import {
  CatalogAlbumCard,
  CatalogArtistCard,
  CatalogTrackRow,
  DlArtwork,
  DlCardSkeleton,
  DlErrorState,
  DlSectionHeader,
  DlTrackSkeleton,
  type DownloadsCatalogApi,
} from './downloadUi';

const TOP_TRACKS_COLLAPSED = 5;
const TOP_TRACKS_EXPANDED = 10;

type DiscographyTab = 'albums' | 'singles';

function discographySubtitle(album: CatalogAlbum): string {
  const kind = album.type === 'SINGLE' ? 'Sencillo' : album.type === 'EP' ? 'EP' : album.type === 'COMPILATION' ? 'Recopilatorio' : 'Álbum';
  return [album.year, kind].filter(Boolean).join(' · ');
}

/**
 * Ficha de artista dentro de Descargas, con el orden de Spotify: populares,
 * discografía (álbumes / sencillos y EP) y "Fans también escuchan", todo
 * navegable. En escritorio viene de los endpoints reales del artista; en la web
 * `getCatalogArtist` la reconstruye por nombre y puede quedar incompleta, por
 * eso cada sección se oculta en vez de mostrar un hueco vacío.
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
  const [discographyTab, setDiscographyTab] = useState<DiscographyTab>('albums');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setShowAllTracks(false);
    getCatalogArtist(artistId, seed?.name)
      .then(value => {
        if (cancelled) return;
        setDetail(value);
        // Artistas que solo sacan sencillos no deben abrir en una pestaña vacía.
        setDiscographyTab(value.albums.length > 0 || value.singles.length === 0 ? 'albums' : 'singles');
      })
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
  const singles = detail?.singles ?? [];
  const related = detail?.related ?? [];
  const discography = discographyTab === 'albums' ? albums : singles;
  const visibleTracks = topTracks.slice(0, showAllTracks ? TOP_TRACKS_EXPANDED : TOP_TRACKS_COLLAPSED);
  const pendingTop = topTracks.slice(0, TOP_TRACKS_EXPANDED).filter(track => !api.getTrackState(track.id));
  const heroStyle = artist?.artworkUrl
    ? { '--dl-hero-image': `url("${artist.artworkUrl}")` } as CSSProperties
    : undefined;

  return (
    <section className="dl-detail">
      <header className={`dl-hero artist ${artist?.artworkUrl ? 'has-backdrop' : ''}`.trim()} style={heroStyle}>
        <DlArtwork src={artist?.artworkUrl} label={artist?.name ?? 'Artista'} round className="dl-hero-art" />
        <div className="dl-hero-copy">
          <p className="dl-eyebrow">Artista</p>
          <h1>{artist?.name ?? 'Cargando…'}</h1>
          <div className="dl-hero-stats">
            {albums.length > 0 && <span>{albums.length} {albums.length === 1 ? 'álbum' : 'álbumes'}</span>}
            {singles.length > 0 && <span>{singles.length} {singles.length === 1 ? 'sencillo o EP' : 'sencillos y EP'}</span>}
          </div>
          <div className="dl-hero-actions">
            <button
              className="dl-btn primary"
              onClick={() => api.downloadTracks(pendingTop)}
              disabled={pendingTop.length === 0}
            >
              <DownloadIcon size={16} />
              <span>
                {pendingTop.length === 0 && topTracks.length > 0
                  ? 'Populares en tu biblioteca'
                  : `Descargar ${pendingTop.length || TOP_TRACKS_EXPANDED} populares`}
              </span>
            </button>
          </div>
        </div>
      </header>

      {error && <DlErrorState message={error} onRetry={() => setReloadKey(key => key + 1)} />}

      {!error && !detail && (
        <>
          <DlSectionHeader title="Populares" />
          <DlTrackSkeleton rows={5} />
          <DlSectionHeader title="Discografía" />
          <DlCardSkeleton cards={6} />
        </>
      )}

      {detail && topTracks.length > 0 && (
        <section className="dl-section">
          <DlSectionHeader title="Populares" />
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
          {topTracks.length > TOP_TRACKS_COLLAPSED && (
            <button className="dl-text-btn dl-more-toggle" onClick={() => setShowAllTracks(open => !open)}>
              {showAllTracks ? 'Mostrar menos' : 'Mostrar más'}
            </button>
          )}
        </section>
      )}

      {detail && albums.length + singles.length > 0 && (
        <section className="dl-section">
          <DlSectionHeader title="Discografía" />
          {albums.length > 0 && singles.length > 0 && (
            <nav className="dl-filters inline" aria-label="Tipo de lanzamiento">
              <button
                className={discographyTab === 'albums' ? 'active' : ''}
                aria-pressed={discographyTab === 'albums'}
                onClick={() => setDiscographyTab('albums')}
              >
                Álbumes
              </button>
              <button
                className={discographyTab === 'singles' ? 'active' : ''}
                aria-pressed={discographyTab === 'singles'}
                onClick={() => setDiscographyTab('singles')}
              >
                Sencillos y EP
              </button>
            </nav>
          )}
          <div className="dl-card-grid">
            {discography.map(album => (
              <CatalogAlbumCard
                key={album.id}
                album={album}
                subtitle={discographySubtitle(album)}
                onOpen={() => api.openAlbum(album)}
              />
            ))}
          </div>
        </section>
      )}

      {detail && related.length > 0 && (
        <section className="dl-section">
          <DlSectionHeader title="Fans también escuchan" />
          <div className="dl-card-grid single-row">
            {related.map(candidate => (
              <CatalogArtistCard key={candidate.id} artist={candidate} onOpen={() => api.openArtist(candidate)} />
            ))}
          </div>
        </section>
      )}

      {detail && topTracks.length === 0 && albums.length + singles.length === 0 && (
        <p className="dl-inline-empty">El catálogo no devolvió canciones ni lanzamientos de este artista.</p>
      )}
    </section>
  );
}
