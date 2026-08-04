import { useEffect, useState, type ComponentType, type CSSProperties } from 'react';
import { fetchLatestAppRelease, type AppReleaseInfo } from '../appDownload';
import { ArtistIcon, DiscIcon, DownloadIcon, HomeIcon, MusicNoteIcon, PhoneIcon, PlaylistIcon } from './icons';
import type { Tab } from './types';

const TABS: { id: Tab; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: 'home', label: 'Inicio', Icon: HomeIcon },
  { id: 'songs', label: 'Canciones', Icon: MusicNoteIcon },
  { id: 'albums', label: 'Álbumes', Icon: DiscIcon },
  { id: 'artists', label: 'Artistas', Icon: ArtistIcon },
  { id: 'playlists', label: 'Playlists', Icon: PlaylistIcon },
  { id: 'downloads', label: 'Descargas', Icon: DownloadIcon },
];

interface SidebarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
}

/** Entry point to the "Apps" page. Always visible now — the page itself handles the
    "no hay build publicada todavía" case, so the card no longer vanishes when the
    release lookup comes up empty. */
function AppDownloadCard({ onOpen }: { onOpen: () => void }) {
  const [release, setRelease] = useState<AppReleaseInfo | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLatestAppRelease().then((info) => {
      if (cancelled) return;
      setRelease(info);
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <button type="button" className="app-download" onClick={onOpen}>
      <span className="app-download-icon"><PhoneIcon size={18} /></span>
      <span className="app-download-text">
        <strong>Consigue la app</strong>
        <small>
          {release
            ? `Android v${release.versionName} · Windows · Mac`
            : checked
              ? 'Android · Windows · Mac'
              : 'Buscando versión…'}
        </small>
      </span>
    </button>
  );
}

export function Sidebar({ tab, onTabChange }: SidebarProps) {
  const activeIndex = TABS.findIndex(item => item.id === tab);
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <strong>StaySound</strong>
          <small>Tu música, sin nube</small>
        </div>
      </div>
      <nav className="nav-tabs" aria-label="Library views">
        <span className="nav-label">Biblioteca</span>
        <span
          className="nav-motion-indicator"
          aria-hidden="true"
          style={{ '--nav-index': Math.max(0, activeIndex), opacity: activeIndex < 0 ? 0 : 1 } as CSSProperties}
        />
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={tab === id ? 'active' : ''}
            onClick={() => onTabChange(id)}
          >
            <span className="tab-icon"><Icon size={18} /></span>
            {label}
          </button>
        ))}
      </nav>
      <AppDownloadCard onOpen={() => onTabChange('get-app')} />
    </aside>
  );
}
