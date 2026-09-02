import type { SoulseekSearchResult } from '@/src/services/soulseekDownloadService';
import type { TidalArtist, TidalTrack } from '@/src/types/audio';

export type TidalTab = 'all' | 'artists' | 'albums' | 'tracks' | 'playlists';
export type TidalSourceTab = 'tidal' | 'soulseek';
export type DownloadSource = TidalSourceTab;

export type SoulseekFolderGroup = {
    key: string;
    username: string;
    folderPath: string;
    results: SoulseekSearchResult[];
};

export type TidalVirtualListItem =
    | { type: 'auth' }
    | { type: 'loading' }
    | { type: 'error' }
    | { type: 'soulseek-empty' }
    | { type: 'soulseek-summary'; count: number }
    | { type: 'soulseek-folder-header'; group: SoulseekFolderGroup }
    | { type: 'soulseek-track'; result: SoulseekSearchResult }
    | { type: 'home' }
    | { type: 'empty' }
    | { type: 'feature'; artist: TidalArtist }
    | { type: 'label'; key: string; label: string }
    | { type: 'track'; track: TidalTrack }
    | { type: 'albums-rail' }
    | { type: 'artists-rail' }
    | { type: 'playlists-rail' };
