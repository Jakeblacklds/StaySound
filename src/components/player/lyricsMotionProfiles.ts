import type { KaraokeMotionProfile } from 'karaoke-view';
export type LyricsMotionOption = {
    id: 'stardust' | 'aurora' | 'neon' | 'ember' | 'silk';
    nativeProfile: KaraokeMotionProfile;
    label: string;
    icon: string;
};
export const DEFAULT_LYRICS_MOTION_OPTION_ID: LyricsMotionOption['id'] = 'stardust';
export const DEFAULT_LYRICS_MOTION_PROFILE: KaraokeMotionProfile = 'cosmic';
export const LYRICS_MOTION_OPTIONS: LyricsMotionOption[] = [
    { id: 'stardust', nativeProfile: 'cosmic', label: 'stardust', icon: 'star-four-points' },
    { id: 'aurora', nativeProfile: 'ambient', label: 'aurora', icon: 'aurora' },
    { id: 'neon', nativeProfile: 'pulse', label: 'cricket', icon: 'cricket' },
    { id: 'ember', nativeProfile: 'fire', label: 'ember', icon: 'candle' },
    { id: 'silk', nativeProfile: 'velvet', label: 'silk', icon: 'water' },
];
