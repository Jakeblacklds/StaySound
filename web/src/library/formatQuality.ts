import type { Track } from '@staysound/types/audio';

export interface QualitySpecs {
  format: string;
  specs: string[];
}

/** The Círculo player chrome shows "FLAC · 44.1 kHz · 16-bit" next to the transport. Local
    files frequently lack sample-rate/bit-depth metadata (only downloads populate it — see
    downloadProvider.ts), so this degrades to whatever subset is actually known instead of
    fabricating numbers. Returns null when there is nothing worth showing. */
export function formatQualitySpecs(track?: Track | null): QualitySpecs | null {
  if (!track) return null;
  const format = track.format?.trim();
  if (!format) return null;

  const specs: string[] = [];
  if (track.sampleRate) specs.push(`${(track.sampleRate / 1000).toFixed(track.sampleRate % 1000 === 0 ? 0 : 1)} kHz`);
  if (track.bitDepth) specs.push(`${track.bitDepth}-bit`);

  return { format: format.toUpperCase(), specs };
}
