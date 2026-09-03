import { useEffect, useState } from 'react';
import type { Track } from '@staysound/types/audio';
import { getTrackWaveform, peekTrackWaveform, type TrackWaveform } from '../audio/trackWaveform';

/**
 * A track change already kicks off artwork, palette extraction and a lyrics
 * fetch on the same frame. The scrubber can wait half a second for its decode
 * rather than competing with the things the user is looking at.
 */
const ANALYSIS_DELAY_MS = 500;

export interface TrackWaveformState {
  waveform: TrackWaveform | null;
  /** True while the file is being decoded — the scrubber shows its placeholder. */
  analysing: boolean;
}

/** Resolves the real envelope for a track, cached across tracks and sessions. */
export function useTrackWaveform(track: Track | null): TrackWaveformState {
  const trackId = track?.id ?? null;
  const [state, setState] = useState<TrackWaveformState>(() => ({
    waveform: peekTrackWaveform(track),
    analysing: false,
  }));

  useEffect(() => {
    if (!track) {
      setState({ waveform: null, analysing: false });
      return;
    }

    const cached = peekTrackWaveform(track);
    if (cached) {
      setState({ waveform: cached, analysing: false });
      return;
    }

    setState({ waveform: null, analysing: true });

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getTrackWaveform(track).then(waveform => {
        if (cancelled) return;
        setState({ waveform, analysing: false });
      });
    }, ANALYSIS_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // The envelope is a property of the file, so the id is the whole identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  return state;
}
