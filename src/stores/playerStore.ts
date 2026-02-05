/**
 * PlayerStore - Zustand store for playback state
 */

import { create } from 'zustand';
import { AudioEngine } from '../services/audioEngine';
import { syncNowPlaying, syncPlaybackState } from '../services/trackPlayerService';
import { PlayerState, RepeatMode, Track } from '../types/audio';

interface PlayerActions {
    // Playback control
    play: (track: Track, queue?: Track[]) => Promise<void>;
    pause: () => void;
    resume: () => void;
    togglePlayPause: () => void;
    stop: () => void;
    seek: (positionMs: number) => Promise<void>;

    // Queue management
    setQueue: (tracks: Track[], startIndex?: number) => void;
    addToQueue: (track: Track) => void;
    removeFromQueue: (index: number) => void;
    clearQueue: () => void;
    next: () => Promise<void>;
    previous: () => Promise<void>;
    skipTo: (index: number) => Promise<void>;

    // Playback modes
    toggleShuffle: () => void;
    cycleRepeatMode: () => void;

    // State updates
    setPosition: (ms: number) => void;
    setVolume: (volume: number) => void;
    setLoading: (loading: boolean) => void;
}

type PlayerStore = PlayerState & PlayerActions;

const initialState: PlayerState = {
    currentTrack: null,
    queue: [],
    queueIndex: -1,
    isPlaying: false,
    isLoading: false,
    position: 0,
    duration: 0,
    repeatMode: 'off',
    shuffleEnabled: false,
    volume: 1,
};

export const usePlayerStore = create<PlayerStore>((set, get) => ({
    ...initialState,

    play: async (track, queue) => {
        set({ isLoading: true });

        try {
            // If queue provided, set it
            if (queue) {
                const index = queue.findIndex(t => t.id === track.id);
                set({ queue, queueIndex: index >= 0 ? index : 0 });
            } else {
                // Single track play
                set({ queue: [track], queueIndex: 0 });
            }

            // Play with AudioEngine
            await AudioEngine.play(track);

            // Sync to TrackPlayer for notifications
            await syncNowPlaying(track);
            await syncPlaybackState(true);

            set({
                currentTrack: track,
                isPlaying: true,
                isLoading: false,
                duration: track.duration,
                position: 0,
            });
        } catch (error) {
            console.error('[PlayerStore] Play error:', error);
            set({ isLoading: false });
        }
    },

    pause: () => {
        AudioEngine.pause();
        syncPlaybackState(false);
        set({ isPlaying: false });
    },

    resume: () => {
        AudioEngine.resume();
        syncPlaybackState(true);
        set({ isPlaying: true });
    },

    togglePlayPause: () => {
        const { isPlaying } = get();
        if (isPlaying) {
            get().pause();
        } else {
            get().resume();
        }
    },

    stop: () => {
        AudioEngine.stop();
        syncPlaybackState(false);
        set({
            isPlaying: false,
            currentTrack: null,
            position: 0,
            queueIndex: -1,
        });
    },

    seek: async (positionMs) => {
        await AudioEngine.seek(positionMs);
        set({ position: positionMs });
    },

    setQueue: (tracks, startIndex = 0) => {
        set({ queue: tracks, queueIndex: startIndex });
    },

    addToQueue: (track) => {
        const { queue } = get();
        set({ queue: [...queue, track] });
    },

    removeFromQueue: (index) => {
        const { queue, queueIndex } = get();
        const newQueue = queue.filter((_, i) => i !== index);

        // Adjust current index if needed
        let newIndex = queueIndex;
        if (index < queueIndex) {
            newIndex--;
        } else if (index === queueIndex) {
            newIndex = Math.min(newIndex, newQueue.length - 1);
        }

        set({ queue: newQueue, queueIndex: newIndex });
    },

    clearQueue: () => {
        set({ queue: [], queueIndex: -1 });
    },

    next: async () => {
        const { queue, queueIndex, repeatMode, shuffleEnabled } = get();

        if (queue.length === 0) return;

        let nextIndex: number;

        if (shuffleEnabled) {
            // Random next track (excluding current)
            const availableIndices = queue
                .map((_, i) => i)
                .filter(i => i !== queueIndex);
            nextIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
        } else {
            nextIndex = queueIndex + 1;
        }

        // Handle end of queue
        if (nextIndex >= queue.length) {
            if (repeatMode === 'all') {
                nextIndex = 0;
            } else {
                // End of queue, stop
                get().stop();
                return;
            }
        }

        await get().play(queue[nextIndex], queue);
        set({ queueIndex: nextIndex });
    },

    previous: async () => {
        const { queue, queueIndex, position } = get();

        if (queue.length === 0) return;

        // If more than 3 seconds in, restart current track
        if (position > 3000) {
            await get().seek(0);
            return;
        }

        // Go to previous
        let prevIndex = queueIndex - 1;
        if (prevIndex < 0) {
            prevIndex = queue.length - 1; // Wrap to end
        }

        await get().play(queue[prevIndex], queue);
        set({ queueIndex: prevIndex });
    },

    skipTo: async (index) => {
        const { queue } = get();
        if (index >= 0 && index < queue.length) {
            await get().play(queue[index], queue);
            set({ queueIndex: index });
        }
    },

    toggleShuffle: () => {
        set(state => ({ shuffleEnabled: !state.shuffleEnabled }));
    },

    cycleRepeatMode: () => {
        set(state => {
            const modes: RepeatMode[] = ['off', 'all', 'one'];
            const currentIndex = modes.indexOf(state.repeatMode);
            const nextIndex = (currentIndex + 1) % modes.length;
            return { repeatMode: modes[nextIndex] };
        });
    },

    setPosition: (ms) => {
        set({ position: ms });
    },

    setVolume: (volume) => {
        AudioEngine.setVolume(volume);
        set({ volume });
    },

    setLoading: (loading) => {
        set({ isLoading: loading });
    },
}));
