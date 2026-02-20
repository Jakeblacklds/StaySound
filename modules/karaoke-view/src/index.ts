export { KaraokeView } from './KaraokeView';
export type { KaraokeViewProps, LyricWordRaw, LyricsJSON } from './KaraokeView.types';
export {
  configureSupabase,
  createCanonicalLyricsKey,
  forceRefreshLyrics,
  getLrcLibLyrics,
  getLyrics,
  normalizeLyricsKeyPart
} from './LyricsRepositoryModule';

