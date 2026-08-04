import type { ReactNode } from 'react';
import type { Tab } from '../types';

type NavDestination = 'home' | 'library' | 'search' | 'playlists' | 'downloads' | 'get-app';

const NAV_ITEMS: { id: NavDestination; label: string }[] = [
  { id: 'home', label: 'Inicio' },
  { id: 'library', label: 'Biblioteca' },
  { id: 'search', label: 'Buscar' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'downloads', label: 'Descargas' },
  { id: 'get-app', label: 'Apps' },
];

/** Songs/albums/artists/radio all live inside the merged "Biblioteca" destination now —
    see the Phase 3 SegmentedTabs. Search is a genuinely new top-level screen. */
export function navDestinationForTab(tab: Tab): NavDestination {
  switch (tab) {
    case 'home': return 'home';
    case 'songs': case 'albums': case 'artists': case 'radio': return 'library';
    case 'search': return 'search';
    case 'playlists': return 'playlists';
    case 'downloads': return 'downloads';
    case 'get-app': return 'get-app';
    default: return 'home';
  }
}

interface TopNavProps {
  tab: Tab;
  onSelectHome: () => void;
  onSelectLibrary: () => void;
  onSelectSearch: () => void;
  onSelectPlaylists: () => void;
  onSelectDownloads: () => void;
  onSelectGetApp: () => void;
  trailing?: ReactNode;
}

const SELECT: Record<NavDestination, keyof Omit<TopNavProps, 'tab' | 'trailing'>> = {
  home: 'onSelectHome',
  library: 'onSelectLibrary',
  search: 'onSelectSearch',
  playlists: 'onSelectPlaylists',
  downloads: 'onSelectDownloads',
  'get-app': 'onSelectGetApp',
};

/** Círculo's horizontal nav: bold wordmark left, plain-text routes centered (active = accent
    text + underline), utility controls right. Replaces the sidebar at desktop widths — see
    useIsDesktopViewport. Doesn't itself know about Tauri traffic lights; App.tsx's existing
    .titlebar-drag-region strip stays above this and untouched. */
export function TopNav(props: TopNavProps) {
  const active = navDestinationForTab(props.tab);
  return (
    <header className="circ-top-nav">
      <strong className="circ-brand">StaySound</strong>
      <nav className="circ-top-nav-items" aria-label="Navegación principal">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            type="button"
            className={active === item.id ? 'active' : ''}
            aria-current={active === item.id ? 'page' : undefined}
            onClick={props[SELECT[item.id]] as () => void}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="circ-top-nav-trailing">{props.trailing}</div>
    </header>
  );
}
