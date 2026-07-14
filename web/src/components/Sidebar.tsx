import { useEffect, useState, type ComponentType } from 'react';
import { fetchLatestAppRelease, type AppReleaseInfo } from '../appDownload';
import { ArtistIcon, DiscIcon, DownloadIcon, HomeIcon, MusicNoteIcon, PhoneIcon, PlaylistIcon, SyncIcon } from './icons';
import type { Tab } from './types';

const TABS: { id: Tab; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: 'home', label: 'Inicio', Icon: HomeIcon },
  { id: 'songs', label: 'Canciones', Icon: MusicNoteIcon },
  { id: 'albums', label: 'Álbumes', Icon: DiscIcon },
  { id: 'artists', label: 'Artistas', Icon: ArtistIcon },
  { id: 'playlists', label: 'Playlists', Icon: PlaylistIcon },
  { id: 'radio', label: 'Radio', Icon: SyncIcon },
  { id: 'downloads', label: 'Descargas', Icon: DownloadIcon },
];

interface SidebarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
}

function AppDownloadCard() {
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

  if (checked && !release) {
    return null;
  }

  return (
    <a
      className="app-download"
      href={release?.apkUrl ?? '#'}
      aria-disabled={!release}
      onClick={(event) => {
        if (!release) event.preventDefault();
      }}
    >
      <span className="app-download-icon"><PhoneIcon size={18} /></span>
      <span className="app-download-text">
        <strong>Descargar app</strong>
        <small>{release ? `Android · v${release.versionName}` : 'Buscando versión…'}</small>
      </span>
    </a>
  );
}

export function Sidebar({ tab, onTabChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">S</span>
        <div>
          <strong>StaySound</strong>
          <small>Tu música, sin nube</small>
        </div>
      </div>
      <nav className="nav-tabs" aria-label="Library views">
        <span className="nav-label">Biblioteca</span>
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
      <AppDownloadCard />
    </aside>
  );
}
