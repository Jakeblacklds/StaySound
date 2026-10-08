/**
 * A fine-grained loudness envelope for the lyrics timing editor.
 *
 * The scrubber's waveform is 512 bars for a whole song — a third of a second
 * each, coarser than most words. Placing a word by hand needs to see where a
 * syllable actually starts, so this decodes at 10 ms resolution, and from the
 * Demucs vocal stem whenever one is already on disk: on the isolated voice a
 * word is a visible bump, on the full mix it drowns in the drums.
 *
 * Never starts a separation. Without cached stems it reads the mix instead,
 * which still shows phrases and breaths even if it hides consonants.
 */
import type { Track } from '@staysound/types/audio';
import { decodeAudio } from '../audio/trackWaveform';
import { webAudioEngine } from '../audio/webAudioEngine';
import { getCachedKaraokeStems, karaokeStemUrl } from './karaokeDesktop';

export interface VocalEnvelope {
  /** Width of one bin, in milliseconds. */
  binMs: number;
  /** Loudness per bin, 0..1, on a decibel scale. */
  levels: Float32Array;
  source: 'vocals' | 'mix';
}

const BIN_MS = 10;
/** 4 kHz Nyquist is plenty for loudness, and keeps a 5-minute stem near 5 MB. */
const DECODE_SAMPLE_RATE = 8000;
/** Loudness shown across the lane's height, below the song's own peak. */
const RANGE_DB = 48;
const MAX_SOURCE_BYTES = 200 * 1024 * 1024;
const SLICE_BUDGET_MS = 6;

const cache = new Map<string, Promise<VocalEnvelope | null>>();

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, 0));
}

async function fetchBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_SOURCE_BYTES) return null;
    const bytes = await response.arrayBuffer();
    return bytes.byteLength > 0 && bytes.byteLength <= MAX_SOURCE_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

async function envelopeFromBuffer(buffer: AudioBuffer, source: VocalEnvelope['source']): Promise<VocalEnvelope> {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const framesPerBin = Math.max(1, Math.round(buffer.sampleRate * BIN_MS / 1000));
  const bins = Math.ceil(buffer.length / framesPerBin);
  const decibels = new Float32Array(bins);
  let budgetStart = performance.now();
  for (let bin = 0; bin < bins; bin += 1) {
    if (performance.now() - budgetStart > SLICE_BUDGET_MS) {
      await yieldToBrowser();
      budgetStart = performance.now();
    }
    const start = bin * framesPerBin;
    const end = Math.min(buffer.length, start + framesPerBin);
    let total = 0;
    for (let frame = start; frame < end; frame += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[frame];
      sample /= channels.length;
      total += sample * sample;
    }
    decibels[bin] = 10 * Math.log10(total / Math.max(1, end - start) + 1e-12);
  }

  // A single clipped consonant should not flatten the rest of the song: take
  // the ceiling from the loud end of the distribution rather than its maximum.
  const sorted = Array.from(decibels).sort((a, b) => a - b);
  const ceiling = sorted[Math.floor(sorted.length * 0.995)] ?? 0;
  const floor = ceiling - RANGE_DB;
  const levels = new Float32Array(bins);
  for (let bin = 0; bin < bins; bin += 1) {
    levels[bin] = Math.min(1, Math.max(0, (decibels[bin] - floor) / RANGE_DB));
  }
  return { binMs: BIN_MS, levels, source };
}

async function analyse(nativePath: string, track: Track): Promise<VocalEnvelope | null> {
  const OfflineCtor = window.OfflineAudioContext
    ?? (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineCtor) return null;

  const stems = await getCachedKaraokeStems(nativePath).catch(() => null);
  let source: VocalEnvelope['source'] = 'vocals';
  let bytes = stems ? await fetchBytes(karaokeStemUrl(stems.vocalsPath)) : null;
  if (!bytes) {
    source = 'mix';
    const uri = await webAudioEngine.resolvePlayableUri(track);
    bytes = uri ? await fetchBytes(uri) : null;
  }
  if (!bytes) return null;

  const context = new OfflineCtor(1, 1, DECODE_SAMPLE_RATE);
  const buffer = await decodeAudio(context, bytes);
  return envelopeFromBuffer(buffer, source);
}

export function loadVocalEnvelope(nativePath: string, track: Track): Promise<VocalEnvelope | null> {
  const pending = cache.get(nativePath);
  if (pending) return pending;
  const request = analyse(nativePath, track).catch(() => null);
  cache.set(nativePath, request);
  // Only the song being edited is worth keeping; the next one replaces it.
  for (const key of cache.keys()) {
    if (cache.size <= 2) break;
    cache.delete(key);
  }
  void request.then(result => {
    if (!result && cache.get(nativePath) === request) cache.delete(nativePath);
  });
  return request;
}
