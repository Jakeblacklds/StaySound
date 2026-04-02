export const MINI_HEIGHT = 66;
export const MINI_MARGIN = 12;
export const TAB_BAR_HEIGHT = 72;
export const TAB_BAR_FLOAT_OFFSET = 12;
export const MINI_GAP_FROM_TAB = 6;
export const DETAIL_HEIGHT = 78;
export const DETAIL_EXTRA_BOTTOM = 0;
export const MINI_ARTWORK_SIZE = 48;
export const MINI_ARTWORK_LEFT = 10;

export function isPlayerDetailRoute(pathname: string): boolean {
    return (
        pathname.startsWith('/album') ||
        pathname.startsWith('/artist') ||
        pathname.startsWith('/playlist/') ||
        pathname === '/playlist-create' ||
        pathname.startsWith('/tidal-album') ||
        pathname.startsWith('/tidal-artist') ||
        pathname.startsWith('/tidal-playlist')
    );
}
