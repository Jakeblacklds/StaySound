import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      'am-lyrics': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        'song-title'?: string;
        'song-artist'?: string;
        'song-album'?: string;
        'song-duration'?: number;
        query?: string;
        'music-id'?: string;
        isrc?: string;
        ttml?: string;
        'current-time'?: number;
        duration?: number;
        'highlight-color'?: string;
        'font-family'?: string;
        autoscroll?: boolean;
        interpolate?: boolean;
      };
    }
  }
}
