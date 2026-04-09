export { KaraokeView } from './KaraokeView';
export type { KaraokeMotionProfile, KaraokeViewProps, LyricWordRaw, LyricsJSON } from './KaraokeView.types';
export {
  configureSupabase,
  createCanonicalLyricsKey,
  forceRefreshLyrics,
  getLrcLibLyrics,
  getLyrics,
  normalizeLyricsKeyPart
} from './LyricsRepositoryModule';
