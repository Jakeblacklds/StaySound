import type { TidalTrack } from '@staysound/types/audio';
import type { CatalogSearch } from '../../downloads/monochromeCatalog';
import { DownloadIcon, SearchIcon } from '../icons';
import {
  CatalogAlbumCard,
  CatalogArtistCard,
  CatalogTrackRow,
  DlArtwork,
  DlCardSkeleton,
  DlErrorState,
  DlSectionHeader,
  DlTrackSkeleton,
  DownloadStateButton,
  formatCatalogQuality,
  type DownloadsCatalogApi,
} from './downloadUi';

export type DownloadCatalogFilter = 'all' | 'songs' | 'albums' | 'artists';

export const DOWNLOAD_FILTERS: Array<{ id: DownloadCatalogFilter; label: string }> = [
  { id: 'all', label: 'Todo' },
  { id: 'songs', label: 'Canciones' },
  { id: 'albums', label: 'Álbumes' },
  { id: 'artists', label: 'Artistas' },
];

const TOP_SONGS_IN_OVERVIEW = 6;
const TOP_CARDS_IN_OVERVIEW = 8;

/** Tarjeta grande del mejor resultado: el atajo para el 80% de las búsquedas. */
function TopResultCard({ track, api }: { track: TidalTrack; api: DownloadsCatalogApi }) {
  const state = api.getTrackState(track.id);
  const quality = formatCatalogQuality(track.quality, track.isHiRes);

  return (
    <article className="dl-top-result">
      <DlArtwork src={track.artworkUrl} label={track.title} className="dl-top-result-art" />
      <div className="dl-top-result-copy">
        <p className="dl-eyebrow">Mejor resultado</p>
        <h3 title={track.title}>{track.title}</h3>
        <p className="dl-top-result-meta">
          {track.artistId ? (
            <button className="dl-inline-link" onClick={() => api.openArtist({ id: track.artistId!, name: track.artist })}>
              {track.artist}
            </button>
          ) : <span>{track.artist}</span>}
          {track.album && <span aria-hidden="true"> · </span>}
          {track.album && (track.albumId ? (
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
          ) : <span>{track.album}</span>)}
        </p>
        <div className="dl-top-result-actions">
          <DownloadStateButton state={state} onDownload={() => api.downloadTracks([track])} />
          {quality && <span className="dl-quality-pill">{quality}</span>}
          {track.albumId && (
            <button
              className="dl-text-btn"
              onClick={() => api.openAlbum({
                id: track.albumId!,
                title: track.album,
                artist: track.artist,
                artistId: track.artistId,
                artworkUrl: track.artworkUrl,
              })}
            >
              Ver álbum
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** Resultados de búsqueda: canciones, álbumes y artistas, todos navegables. */
export function DownloadBrowseView({
  query,
  results,
  isSearching,
  error,
  filter,
  onFilterChange,
  recentSearches,
  onSearchAgain,
  onRetry,
  api,
}: {
  query: string;
  results: CatalogSearch | null;
  isSearching: boolean;
  error: string | null;
  filter: DownloadCatalogFilter;
  onFilterChange: (filter: DownloadCatalogFilter) => void;
  recentSearches: string[];
  onSearchAgain: (term: string) => void;
  onRetry: () => void;
  api: DownloadsCatalogApi;
}) {
  const tracks = results?.tracks ?? [];
  const albums = results?.albums ?? [];
  const artists = results?.artists ?? [];
  const hasResults = tracks.length + albums.length + artists.length > 0;

  if (error) {
    return <DlErrorState message={error} onRetry={onRetry} />;
  }

  if (isSearching && !hasResults) {
    return (
      <div className="dl-browse">
        <DlSectionHeader title="Buscando…" />
        <DlTrackSkeleton rows={5} />
        <DlSectionHeader title="Álbumes" />
        <DlCardSkeleton cards={6} />
      </div>
    );
  }

  if (!results) {
    return (
      <section className="dl-empty">
        <span className="dl-empty-icon"><SearchIcon size={30} /></span>
        <h2>Busca música para descargar</h2>
        <p>
          Monochrome encuentra la canción, el álbum o el artista; Soulseek trae el archivo
          y lo guarda en tu biblioteca local.
        </p>
        {recentSearches.length > 0 && (
          <div className="dl-recent">
            <span className="dl-recent-label">Búsquedas recientes</span>
            <div className="dl-recent-chips">
              {recentSearches.map(term => (
                <button key={term} className="dl-chip" onClick={() => onSearchAgain(term)}>{term}</button>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  if (!hasResults) {
    return (
      <section className="dl-empty">
        <span className="dl-empty-icon"><DownloadIcon size={30} /></span>
        <h2>Sin resultados para “{query}”</h2>
        <p>Prueba con el nombre del artista y el título de la canción, o revisa la ortografía.</p>
      </section>
    );
  }

  return (
    <div className="dl-browse">
      <nav className="dl-filters" aria-label="Filtrar resultados">
        {DOWNLOAD_FILTERS.map(item => (
          <button
            key={item.id}
            className={filter === item.id ? 'active' : ''}
            onClick={() => onFilterChange(item.id)}
          >
            {item.label}
          </button>
        ))}
        {isSearching && <span className="dl-filters-busy">Actualizando…</span>}
      </nav>

      {filter === 'all' && (
        <>
          {tracks[0] && (
            <section className="dl-section">
              <TopResultCard track={tracks[0]} api={api} />
            </section>
          )}

          {tracks.length > 0 && (
            <section className="dl-section">
              <DlSectionHeader
                title="Canciones"
                action={tracks.length > TOP_SONGS_IN_OVERVIEW && (
                  <button className="dl-text-btn" onClick={() => onFilterChange('songs')}>
                    Ver las {tracks.length}
                  </button>
                )}
              />
              <div className="dl-track-list">
                {tracks.slice(0, TOP_SONGS_IN_OVERVIEW).map(track => (
                  <CatalogTrackRow key={track.id} track={track} api={api} />
                ))}
              </div>
            </section>
          )}

          {artists.length > 0 && (
            <section className="dl-section">
              <DlSectionHeader
                title="Artistas"
                action={artists.length > TOP_CARDS_IN_OVERVIEW && (
                  <button className="dl-text-btn" onClick={() => onFilterChange('artists')}>
                    Ver los {artists.length}
                  </button>
                )}
              />
              <div className="dl-card-grid">
                {artists.slice(0, TOP_CARDS_IN_OVERVIEW).map(artist => (
                  <CatalogArtistCard key={artist.id} artist={artist} onOpen={() => api.openArtist(artist)} />
                ))}
              </div>
            </section>
          )}

          {albums.length > 0 && (
            <section className="dl-section">
              <DlSectionHeader
                title="Álbumes"
                action={albums.length > TOP_CARDS_IN_OVERVIEW && (
                  <button className="dl-text-btn" onClick={() => onFilterChange('albums')}>
                    Ver los {albums.length}
                  </button>
                )}
              />
              <div className="dl-card-grid">
                {albums.slice(0, TOP_CARDS_IN_OVERVIEW).map(album => (
                  <CatalogAlbumCard key={album.id} album={album} onOpen={() => api.openAlbum(album)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {filter === 'songs' && (
        <section className="dl-section">
          <DlSectionHeader title="Canciones" count={`${tracks.length}`} />
          <div className="dl-track-list">
            {tracks.map(track => <CatalogTrackRow key={track.id} track={track} api={api} />)}
          </div>
        </section>
      )}

      {filter === 'albums' && (
        <section className="dl-section">
          <DlSectionHeader title="Álbumes" count={`${albums.length}`} />
          <div className="dl-card-grid">
            {albums.map(album => (
              <CatalogAlbumCard key={album.id} album={album} onOpen={() => api.openAlbum(album)} />
            ))}
          </div>
        </section>
      )}

      {filter === 'artists' && (
        <section className="dl-section">
          <DlSectionHeader title="Artistas" count={`${artists.length}`} />
          <div className="dl-card-grid">
            {artists.map(artist => (
              <CatalogArtistCard key={artist.id} artist={artist} onOpen={() => api.openArtist(artist)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
