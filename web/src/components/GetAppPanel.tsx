import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  detectPlatform,
  fetchReleaseCatalog,
  formatReleaseSize,
  RELEASES_PAGE_URL,
  type PlatformRelease,
  type ReleaseCatalog,
  type ReleasePlatform,
} from '../appDownload';
import { DownloadIcon, SpinnerIcon } from './icons';

interface PlatformCopy {
  id: ReleasePlatform;
  name: string;
  requirement: string;
  /** What this build unlocks that the browser can't do. */
  perk: string;
  Glyph: () => ReactElement;
}

function AndroidGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
      <path d="M17.6 9.48l1.84-3.18a.4.4 0 00-.7-.4l-1.86 3.22a11.5 11.5 0 00-9.76 0L5.26 5.9a.4.4 0 10-.7.4L6.4 9.48A10.7 10.7 0 001 18h22a10.7 10.7 0 00-5.4-8.52zM7 15.25a1.05 1.05 0 110-2.1 1.05 1.05 0 010 2.1zm10 0a1.05 1.05 0 110-2.1 1.05 1.05 0 010 2.1z" />
    </svg>
  );
}

function WindowsGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M3 5.5l7.2-1v7.1H3V5.5zm8.4-1.15L21 3v8.45h-9.6V4.35zM3 12.7h7.2v7.05L3 18.6v-5.9zm8.4 0H21V21l-9.6-1.35V12.7z" />
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
      <path d="M16.36 12.7c-.02-2.24 1.83-3.32 1.92-3.37-1.05-1.53-2.68-1.74-3.26-1.77-1.39-.14-2.71.81-3.41.81-.7 0-1.79-.79-2.94-.77-1.51.02-2.9.88-3.68 2.23-1.57 2.72-.4 6.75 1.13 8.96.75 1.08 1.64 2.29 2.81 2.25 1.13-.05 1.56-.73 2.92-.73 1.36 0 1.74.73 2.93.71 1.21-.02 1.98-1.1 2.72-2.19.86-1.25 1.21-2.46 1.23-2.53-.03-.01-2.36-.91-2.37-3.6zM14.13 6.1c.62-.75 1.04-1.79.93-2.83-.9.04-1.98.6-2.62 1.34-.57.67-1.07 1.73-.94 2.75 1 .08 2.02-.51 2.63-1.26z" />
    </svg>
  );
}

const PLATFORMS: PlatformCopy[] = [
  {
    id: 'android',
    name: 'Android',
    requirement: 'Android 8.0 o superior',
    perk: 'Tu biblioteca en el bolsillo, con reproducción sin conexión y Android Auto.',
    Glyph: AndroidGlyph,
  },
  {
    id: 'windows',
    name: 'Windows',
    requirement: 'Windows 10 o superior · 64 bits',
    perk: 'Descargas Soulseek P2P y carpeta de música local, sin límites del navegador.',
    Glyph: WindowsGlyph,
  },
  {
    id: 'macos',
    name: 'macOS',
    requirement: 'macOS 11 Big Sur o superior',
    perk: 'Descargas Soulseek P2P y carpeta de música local, sin límites del navegador.',
    Glyph: AppleGlyph,
  },
];

function formatReleaseDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
}

function PlatformCard({
  copy,
  release,
  isCurrent,
  loading,
}: {
  copy: PlatformCopy;
  release: PlatformRelease | null;
  isCurrent: boolean;
  loading: boolean;
}) {
  const { Glyph } = copy;
  const primary = release?.assets.find(asset => asset.recommended) ?? release?.assets[0] ?? null;
  const alternates = release?.assets.filter(asset => asset !== primary) ?? [];
  const size = primary ? formatReleaseSize(primary.sizeBytes) : '';
  const published = release ? formatReleaseDate(release.publishedAt) : '';

  return (
    <article className={`getapp-card ${isCurrent ? 'is-current' : ''} ${release ? '' : 'is-pending'}`}>
      {isCurrent && <span className="getapp-badge">Tu sistema</span>}

      <span className="getapp-card-glyph" aria-hidden="true"><Glyph /></span>

      <div className="getapp-card-head">
        <strong>{copy.name}</strong>
        <small>{copy.requirement}</small>
      </div>

      <p className="getapp-card-perk">{copy.perk}</p>

      {loading ? (
        <span className="getapp-card-status">
          <SpinnerIcon size={14} />
          Buscando la última versión…
        </span>
      ) : primary && release ? (
        <>
          <a
            className="btn btn-primary getapp-card-action"
            href={primary.url}
            title={primary.fileName}
            download
          >
            <DownloadIcon size={16} />
            Descargar {release.version ? `v${release.version}` : 'ahora'}
          </a>
          <span className="getapp-card-meta">
            {[size, published && `Publicado el ${published}`].filter(Boolean).join(' · ')}
          </span>
          {alternates.length > 0 && (
            <span className="getapp-card-alts">
              {alternates.map(asset => (
                <a key={asset.url} href={asset.url} title={asset.fileName} download>
                  {asset.label}
                  {asset.sizeBytes ? ` (${formatReleaseSize(asset.sizeBytes)})` : ''}
                </a>
              ))}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="getapp-card-action is-pending" aria-disabled="true">Próximamente</span>
          <span className="getapp-card-meta">Todavía no hay una compilación publicada para {copy.name}.</span>
        </>
      )}
    </article>
  );
}

/**
 * "Consigue la app" — the download page for the native builds.
 *
 * Doubles as the answer to the most common web-version question: Soulseek needs a
 * real TCP peer connection, which a browser tab cannot open, so the P2P downloader
 * only exists in the desktop builds. That's explained up top rather than buried.
 */
export function GetAppPanel() {
  const [catalog, setCatalog] = useState<ReleaseCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const current = useMemo(() => detectPlatform(), []);

  useEffect(() => {
    let cancelled = false;
    fetchReleaseCatalog()
      .then(result => {
        if (cancelled) return;
        setCatalog(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Show the visitor's own platform first; the rest keep their declared order.
  const ordered = useMemo(() => {
    if (!current) return PLATFORMS;
    return [...PLATFORMS].sort((a, b) => Number(b.id === current) - Number(a.id === current));
  }, [current]);

  return (
    <section className="getapp-panel">
      <header className="getapp-hero">
        <span className="getapp-hero-kicker">Aplicaciones nativas</span>
        <h2>StaySound fuera del navegador</h2>
        <p>
          Esta versión web reproduce y organiza tu biblioteca. Las apps de escritorio y
          Android añaden lo que un navegador no puede hacer: descargas P2P por Soulseek,
          acceso directo a tu carpeta de música y sincronización en segundo plano.
        </p>
      </header>

      <div className="getapp-grid">
        {ordered.map(copy => (
          <PlatformCard
            key={copy.id}
            copy={copy}
            release={catalog?.[copy.id] ?? null}
            isCurrent={copy.id === current}
            loading={loading}
          />
        ))}
      </div>

      {catalog?.notes && (
        <section className="getapp-notes">
          <strong>Novedades</strong>
          <p>{catalog.notes}</p>
        </section>
      )}

      <footer className="getapp-footer">
        <a href={RELEASES_PAGE_URL} target="_blank" rel="noreferrer noopener">
          Ver todas las versiones y notas de lanzamiento
        </a>
        <small>
          Las descargas se sirven desde GitHub Releases. En Android tendrás que permitir la
          instalación desde fuentes desconocidas; en macOS, abrir la app la primera vez con
          clic derecho → Abrir.
        </small>
      </footer>
    </section>
  );
}
