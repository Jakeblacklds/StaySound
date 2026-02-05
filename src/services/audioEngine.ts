/**
 * AudioEngine - Unified audio controller for StaySound
 * 
 * Uses expo-audio for actual playback and syncs state to 
 * react-native-track-player for Android Auto/media notifications.
 */

import { AudioPlayer, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect } from 'react';
import { Track } from '../types/audio';

// Singleton audio player reference
let audioPlayerInstance: AudioPlayer | null = null;

export interface AudioEngineState {
    isPlaying: boolean;
    isLoading: boolean;
    position: number;
    duration: number;
    currentTrack: Track | null;
}

export interface AudioEngineCallbacks {
    onStateChange?: (state: AudioEngineState) => void;
    onTrackEnd?: () => void;
    onError?: (error: Error) => void;
}

class AudioEngineClass {
    private currentTrack: Track | null = null;
    private callbacks: AudioEngineCallbacks = {};
    private updateInterval: ReturnType<typeof setInterval> | null = null;

    /**
     * Initialize audio engine with callbacks
     */
    initialize(callbacks: AudioEngineCallbacks) {
        this.callbacks = callbacks;
        console.log('[AudioEngine] Initialized');
    }

    /**
     * Set the audio player instance (called from hook)
     */
    setPlayer(player: AudioPlayer) {
        audioPlayerInstance = player;
    }

    /**
     * Load and play a track
     */
    async play(track: Track): Promise<void> {
        if (!audioPlayerInstance) {
            throw new Error('Audio player not initialized');
        }

        try {
            this.currentTrack = track;

            // Replace current source with new track
            await audioPlayerInstance.replace({ uri: track.uri });

            // Start playback
            audioPlayerInstance.play();

            console.log('[AudioEngine] Playing:', track.title);
        } catch (error) {
            console.error('[AudioEngine] Play error:', error);
            this.callbacks.onError?.(error as Error);
            throw error;
        }
    }

    /**
     * Pause playback
     */
    pause(): void {
        if (audioPlayerInstance) {
            audioPlayerInstance.pause();
            console.log('[AudioEngine] Paused');
        }
    }

    /**
     * Resume playback
     */
    resume(): void {
        if (audioPlayerInstance) {
            audioPlayerInstance.play();
            console.log('[AudioEngine] Resumed');
        }
    }

    /**
     * Toggle play/pause
     */
    togglePlayPause(): void {
        if (!audioPlayerInstance) return;

        if (audioPlayerInstance.playing) {
            this.pause();
        } else {
            this.resume();
        }
    }

    /**
     * Seek to position in milliseconds
     */
    async seek(positionMs: number): Promise<void> {
        if (audioPlayerInstance) {
            await audioPlayerInstance.seekTo(positionMs / 1000); // expo-audio uses seconds
            console.log('[AudioEngine] Seeked to:', positionMs);
        }
    }

    /**
     * Stop playback and unload
     */
    stop(): void {
        if (audioPlayerInstance) {
            audioPlayerInstance.pause();
            this.currentTrack = null;
            console.log('[AudioEngine] Stopped');
        }
    }

    /**
     * Set volume (0-1)
     */
    setVolume(volume: number): void {
        if (audioPlayerInstance) {
            audioPlayerInstance.volume = Math.max(0, Math.min(1, volume));
            console.log('[AudioEngine] Volume set to:', volume);
        }
    }

    /**
     * Get current track
     */
    getCurrentTrack(): Track | null {
        return this.currentTrack;
    }

    /**
     * Check if currently playing
     */
    isPlaying(): boolean {
        return audioPlayerInstance?.playing ?? false;
    }

    /**
     * Get current position in milliseconds
     */
    getPosition(): number {
        return (audioPlayerInstance?.currentTime ?? 0) * 1000;
    }

    /**
     * Get duration in milliseconds
     */
    getDuration(): number {
        return (audioPlayerInstance?.duration ?? 0) * 1000;
    }

    /**
     * Handle track end event
     */
    handleTrackEnd(): void {
        console.log('[AudioEngine] Track ended');
        this.callbacks.onTrackEnd?.();
    }

    /**
     * Cleanup
     */
    destroy(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.stop();
        audioPlayerInstance = null;
        console.log('[AudioEngine] Destroyed');
    }
}

// Export singleton instance
export const AudioEngine = new AudioEngineClass();

/**
 * Hook to use audio player with expo-audio
 * Must be called in a component to initialize the player
 */
export function useAudioEngine() {
    const player = useAudioPlayer();
    const status = useAudioPlayerStatus(player);

    // Set player reference on mount
    useEffect(() => {
        AudioEngine.setPlayer(player);
    }, [player]);

    // Listen for playback completion
    useEffect(() => {
        const sub = player.addListener('playbackStatusUpdate', (status) => {
            if (status.didJustFinish) {
                AudioEngine.handleTrackEnd();
            }
        });
        return () => sub.remove();
    }, [player]);

    return {
        player,
        status,
        isPlaying: status.playing,
        isLoading: status.isLoaded === false,
        position: (status.currentTime ?? 0) * 1000,
        duration: (status.duration ?? 0) * 1000,
        currentTrack: AudioEngine.getCurrentTrack(),

        // Actions
        play: (track: Track) => AudioEngine.play(track),
        pause: () => AudioEngine.pause(),
        resume: () => AudioEngine.resume(),
        togglePlayPause: () => AudioEngine.togglePlayPause(),
        seek: (ms: number) => AudioEngine.seek(ms),
        stop: () => AudioEngine.stop(),
        setVolume: (v: number) => AudioEngine.setVolume(v),
    };
}
