import type { ComponentType } from 'react';
import {
  DownloadIcon,
  HomeIcon,
  LibraryTabIcon,
  PlaylistsTabIcon,
} from './icons';
import type { Tab } from './types';

type MobileDestination = 'home' | 'library' | 'playlists' | 'downloads';

interface MobileBottomNavProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
}

const DESTINATIONS: Array<{
  id: MobileDestination;
  label: string;
  target: Tab;
  Icon: ComponentType<{ size?: number; state?: number }>;
}> = [
  { id: 'home', label: 'Inicio', target: 'home', Icon: HomeIcon },
  { id: 'library', label: 'Biblioteca', target: 'songs', Icon: LibraryTabIcon },
  { id: 'playlists', label: 'Playlists', target: 'playlists', Icon: PlaylistsTabIcon },
  { id: 'downloads', label: 'Descargas', target: 'downloads', Icon: DownloadIcon },
];

/** `get-app` has no bar entry — it's reached from the Descargas notice — so nothing
    highlights while it's open. */
function destinationForTab(tab: Tab): MobileDestination | null {
  if (tab === 'songs' || tab === 'albums' || tab === 'artists' || tab === 'radio' || tab === 'search') return 'library';
  if (tab === 'get-app') return null;
  return tab;
}

export function MobileBottomNav({ tab, onTabChange }: MobileBottomNavProps) {
  const activeDestination = destinationForTab(tab);

  return (
    <nav className="mobile-bottom-nav" aria-label="Navegación principal">
      {DESTINATIONS.map(({ id, label, target, Icon }) => {
        const active = activeDestination === id;
        return (
          <button
            key={id}
            className={active ? 'active' : ''}
            onClick={() => onTabChange(target)}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
          >
            <span className="mobile-bottom-nav-icon"><Icon size={20} state={active ? 1 : 0} /></span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
