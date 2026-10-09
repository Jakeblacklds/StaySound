import type { CatalogSearch, CatalogTopResult } from '../../downloads/monochromeCatalog';
import type { RecentCatalogItem } from '../../downloads/recentCatalogItems';
import { recentItemKey } from '../../downloads/recentCatalogItems';
import { ChevronRightIcon, CloseIcon, DownloadIcon, SearchIcon } from '../icons';
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
  { id: 'artists', label: 'Artistas' },
  { id: 'albums', label: 'Álbumes' },
];

/** Las canciones que caben junto al mejor resultado sin que la tarjeta quede más baja. */
const SONGS_BESIDE_TOP = 4;

function albumTypeLabel(type?: string): string {
  if (type === 'SINGLE') return 'Sencillo';
  if (type === 'EP') return 'EP';
  if (type === 'COMPILATION') return 'Recopilatorio';
  return 'Álbum';
}

/**
 * Mejor resultado: puede ser un artista, una canción o un álbum, según lo que
 * de verdad se escribió (ver catalogRanking.ts). Toda la tarjeta navega; en
 * canciones, además, se descarga desde aquí mismo.
 */
function TopResultCard({ top, api }: { top: CatalogTopResult; api: DownloadsCatalogApi }) {
  if (top.kind === 'artist') {
    const { artist } = top;
    return (
      <button type="button" className="dl-top-result is-artist" onClick={() => api.openArtist(artist)}>
        <DlArtwork src={artist.artworkUrl} label={artist.name} round className="dl-top-result-art" />
        <span className="dl-top-result-copy">
          <strong className="dl-top-result-title" title={artist.name}>{artist.name}</strong>
          <span className="dl-top-result-meta">
            <span className="dl-kind-pill">Artista</span>
          </span>
        </span>
        <span className="dl-top-result-go" aria-hidden="true"><ChevronRightIcon size={20} /></span>
      </button>
    );
  }

  if (top.kind === 'album') {
    const { album } = top;
    return (
      <button type="button" className="dl-top-result" onClick={() => api.openAlbum(album)}>
        <DlArtwork src={album.artworkUrl} label={album.title} className="dl-top-result-art" />
        <span className="dl-top-result-copy">
          <strong className="dl-top-result-title" title={album.title}>{album.title}</strong>
          <span className="dl-top-result-meta">
            <span className="dl-kind-pill">{albumTypeLabel(album.type)}</span>
            <span>{[album.artist, album.year].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
        <span className="dl-top-result-go" aria-hidden="true"><ChevronRightIcon size={20} /></span>
      </button>
    );
  }

  const { track } = top;
  const state = api.getTrackState(track.id);
  const quality = formatCatalogQuality(track.quality, track.isHiRes);
  const openAlbum = track.albumId
    ? () => api.openAlbum({
      id: track.albumId!,
      title: track.album,
      artist: track.artist,
      artistId: track.artistId,
      artworkUrl: track.artworkUrl,
    })
    : undefined;

  return (
    <article className="dl-top-result is-track">
      <button type="button" className="dl-top-result-art-btn" onClick={openAlbum} disabled={!openAlbum} aria-label={`Abrir ${track.album}`}>
        <DlArtwork src={track.artworkUrl} label={track.title} className="dl-top-result-art" />
      </button>
      <span className="dl-top-result-copy">
        <strong className="dl-top-result-title" title={track.title}>
          {track.title}
          {track.explicit && <span className="dl-explicit" title="Contenido explícito">E</span>}
        </strong>
        <span className="dl-top-result-meta">
          <span className="dl-kind-pill">Canción</span>
          {track.artistId
            ? <button className="dl-inline-link" onClick={() => api.openArtist({ id: track.artistId!, name: track.artist })}>{track.artist}</button>
            : <span>{track.artist}</span>}
          {quality && <span className="dl-quality-pill">{quality}</span>}
        </span>
      </span>
      <span className="dl-top-result-action">
        <DownloadStateButton state={state} onDownload={() => api.downloadTracks([track])} />
      </span>
    </article>
  );
}

function recentCopy(item: RecentCatalogItem): { title: string; subtitle: string; art?: string; round: boolean } {
  switch (item.kind) {
    case 'artist': return { title: item.artist.name, subtitle: 'Artista', art: item.artist.artworkUrl, round: true };
    case 'album': return { title: item.album.title, subtitle: `${albumTypeLabel(item.album.type)} · ${item.album.artist}`, art: item.album.artworkUrl, round: false };
    case 'track': return { title: item.track.title, subtitle: `Canción · ${item.track.artist}`, art: item.track.artworkUrl, round: false };
    case 'query': return { title: item.query, subtitle: 'Búsqueda', round: true };
  }
}

function RecentItems({
  items,
  onOpen,
  onForget,
  onClear,
}: {
  items: RecentCatalogItem[];
  onOpen: (item: RecentCatalogItem) => void;
  onForget: (item: RecentCatalogItem) => void;
  onClear: () => void;
}) {
  return (
    <section className="dl-section dl-recents">
      <DlSectionHeader
        title="Búsquedas recientes"
        action={<button className="dl-text-btn" onClick={onClear}>Borrar todo</button>}
      />
      <div className="dl-recent-grid">
        {items.map(item => {
          const copy = recentCopy(item);
          return (
            <div className="dl-recent-item" key={recentItemKey(item)}>
              <button type="button" className="dl-recent-open" onClick={() => onOpen(item)}>
                {item.kind === 'query'
                  ? <span className="dl-art round dl-recent-query-icon"><SearchIcon size={18} /></span>
                  : <DlArtwork src={copy.art} label={copy.title} round={copy.round} />}
                <span className="dl-recent-copy">
                  <strong title={copy.title}>{copy.title}</strong>
                  <small>{copy.subtitle}</small>
                </span>
              </button>
              <button
                type="button"
                className="dl-recent-forget"
                onClick={() => onForget(item)}
                aria-label={`Quitar ${copy.title} de recientes`}
                title="Quitar"
              >
                <CloseIcon size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
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
  recentItems,
  onOpenRecent,
  onForgetRecent,
  onClearRecent,
  onRetry,
  api,
}: {
  query: string;
  results: CatalogSearch | null;
  isSearching: boolean;
  error: string | null;
  filter: DownloadCatalogFilter;
  onFilterChange: (filter: DownloadCatalogFilter) => void;
  recentItems: RecentCatalogItem[];
  onOpenRecent: (item: RecentCatalogItem) => void;
  onForgetRecent: (item: RecentCatalogItem) => void;
  onClearRecent: () => void;
  onRetry: () => void;
  api: DownloadsCatalogApi;
}) {
  const tracks = results?.tracks ?? [];
  const albums = results?.albums ?? [];
  const artists = results?.artists ?? [];
  const hasResults = tracks.length + albums.length + artists.length > 0;
  const counts: Record<DownloadCatalogFilter, number> = {
    all: tracks.length + albums.length + artists.length,
    songs: tracks.length,
    albums: albums.length,
    artists: artists.length,
  };

  if (error) {
    return <DlErrorState message={error} onRetry={onRetry} />;
  }

  if (isSearching && !hasResults) {
    return (
      <div className="dl-browse">
        <div className="dl-overview" aria-hidden="true">
          <div className="dl-top-skeleton">
            <span className="dl-skeleton-art block round" />
            <span className="dl-skeleton-lines">
              <span style={{ width: '64%' }} />
              <span style={{ width: '30%' }} />
            </span>
          </div>
          <DlTrackSkeleton rows={SONGS_BESIDE_TOP} />
        </div>
        <DlSectionHeader title="Artistas" />
        <DlCardSkeleton cards={6} round />
      </div>
    );
  }

  if (!results) {
    return (
      <div className="dl-browse">
        {recentItems.length > 0
          ? (
            <RecentItems
              items={recentItems}
              onOpen={onOpenRecent}
              onForget={onForgetRecent}
              onClear={onClearRecent}
            />
          )
          : (
            <section className="dl-empty">
              <span className="dl-empty-icon"><SearchIcon size={30} /></span>
              <h2>Busca música para descargar</h2>
              <p>
                Escribe un artista, una canción o un álbum: los resultados aparecen mientras
                escribes. Soulseek trae el archivo y lo guarda en tu biblioteca local.
              </p>
            </section>
          )}
      </div>
    );
  }

  if (!hasResults) {
    return (
      <section className="dl-empty">
        <span className="dl-empty-icon"><DownloadIcon size={30} /></span>
        <h2>Sin resultados para “{query}”</h2>
        <p>Revisa la ortografía, usa menos palabras o prueba con el nombre del artista.</p>
      </section>
    );
  }

  const top = results.top ?? (tracks[0] ? { kind: 'track' as const, track: tracks[0] } : null);
  // Si el mejor resultado es un artista, "Canciones" muestra primero las suyas,
  // como Spotify; el resto conserva el orden por relevancia.
  const overviewSongs = top?.kind === 'artist'
    ? [
      ...tracks.filter(track => track.artistId === top.artist.id),
      ...tracks.filter(track => track.artistId !== top.artist.id),
    ].slice(0, SONGS_BESIDE_TOP)
    : tracks.slice(0, SONGS_BESIDE_TOP);
  const overviewArtists = top?.kind === 'artist' ? artists.filter(artist => artist.id !== top.artist.id) : artists;

  return (
    <div className={`dl-browse ${isSearching ? 'is-refreshing' : ''}`.trim()}>
      <nav className="dl-filters" aria-label="Filtrar resultados">
        {DOWNLOAD_FILTERS.filter(item => item.id === 'all' || counts[item.id] > 0).map(item => (
          <button
            key={item.id}
            className={filter === item.id ? 'active' : ''}
            aria-pressed={filter === item.id}
            onClick={() => onFilterChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {filter === 'all' && (
        <>
          <div className={`dl-overview ${top ? '' : 'no-top'}`.trim()}>
            {top && (
              <section className="dl-section dl-overview-top">
                <DlSectionHeader title="Mejor resultado" />
                <TopResultCard top={top} api={api} />
              </section>
            )}

            {overviewSongs.length > 0 && (
              <section className="dl-section dl-overview-songs">
                <DlSectionHeader
                  title="Canciones"
                  action={tracks.length > SONGS_BESIDE_TOP && (
                    <button className="dl-text-btn" onClick={() => onFilterChange('songs')}>Ver todas</button>
                  )}
                />
                <div className="dl-track-list compact">
                  {overviewSongs.map(track => (
                    <CatalogTrackRow key={track.id} track={track} api={api} />
                  ))}
                </div>
              </section>
            )}
          </div>

          {overviewArtists.length > 0 && (
            <section className="dl-section">
              <DlSectionHeader
                title="Artistas"
                action={<button className="dl-text-btn" onClick={() => onFilterChange('artists')}>Ver todos</button>}
              />
              <div className="dl-card-grid single-row">
                {overviewArtists.slice(0, 12).map(artist => (
                  <CatalogArtistCard key={artist.id} artist={artist} onOpen={() => api.openArtist(artist)} />
                ))}
              </div>
            </section>
          )}

          {albums.length > 0 && (
            <section className="dl-section">
              <DlSectionHeader
                title="Álbumes"
                action={<button className="dl-text-btn" onClick={() => onFilterChange('albums')}>Ver todos</button>}
              />
              <div className="dl-card-grid single-row">
                {albums.slice(0, 12).map(album => (
                  <CatalogAlbumCard key={album.id} album={album} onOpen={() => api.openAlbum(album)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {filter === 'songs' && (
        <section className="dl-section">
          <div className="dl-track-list numbered">
            {tracks.map((track, index) => <CatalogTrackRow key={track.id} track={track} index={index + 1} api={api} />)}
          </div>
        </section>
      )}

      {filter === 'albums' && (
        <section className="dl-section">
          <div className="dl-card-grid">
            {albums.map(album => (
              <CatalogAlbumCard key={album.id} album={album} onOpen={() => api.openAlbum(album)} />
            ))}
          </div>
        </section>
      )}

      {filter === 'artists' && (
        <section className="dl-section">
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
