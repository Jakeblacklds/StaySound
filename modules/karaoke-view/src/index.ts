export { KaraokeView } from './KaraokeView';
export { KaraokeSpectrumView } from './KaraokeSpectrumView';
export type { KaraokeSpectrumViewProps } from './KaraokeSpectrumView';
export { KaraokeRefractionView } from './KaraokeRefractionView';
export type { KaraokeRefractionViewProps } from './KaraokeRefractionView';
export type { KaraokeMotionProfile, KaraokeViewProps, LyricWordRaw, LyricsJSON } from './KaraokeView.types';
export {
  createCanonicalLyricsKey,
  forceRefreshLyrics,
  getLrcLibLyrics,
  getLyrics,
  normalizeLyricsKeyPart
} from './LyricsRepositoryModule';
