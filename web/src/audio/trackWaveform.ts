/**
 * Real, per-track waveform envelopes for the scrubber.
 *
 * The Círculo bar used to draw a seeded pseudo-waveform: pretty, but identical
 * in shape for every song of the same length, so it told you nothing. This
 * decodes the actual file once and reduces it to a fixed-length envelope the
 * scrubber can draw at any width:
 *
 *   - `levels`  per-slice RMS loudness, normalised and perceptually curved —
 *               the height of each bar,
 *   - `tone`    per-slice share of the energy that sits in the top band, so the
 *               bar can be *coloured* by how bright that stretch of the song is.
 *               A hi-hat/strings chorus and a bass drop can be equally loud;
 *               this is what tells them apart at a glance.
 *
 * Both are static properties of the file. Nothing here reacts to playback —
 * the scrubber draws the song, not the moment.
 *
 * Decoding happens in an OfflineAudioContext pinned to 16 kHz, so
 * decodeAudioData resamples on the way out (a 5-minute FLAC costs ~4.8M floats
 * instead of ~13M) while still leaving an 8 kHz Nyquist, which is where the
 * cymbals and consonants that make a passage read as "bright" actually live.
 * Results are memoised in memory and in localStorage, so a track is only ever
 * analysed once per machine.
 */
import type { Track } from '@staysound/types/audio';
import { webAudioEngine } from './webAudioEngine';
import { isTauriDesktop, readDesktopMusicFile } from '../desktop/tauriMusicLibrary';

/** Envelope resolution. Downsampled to the bar count actually on screen. */
export const WAVEFORM_SAMPLES = 512;

export interface TrackWaveform {
  /** Bar height, 0..1. */
  levels: Float32Array;
  /** High-frequency share, 0..1, spread across this track's own range. */
  tone: Float32Array;
}

// Bumped whenever the mapping changes, not just the array shape: a stored
// envelope computed by an older curve is stale even when it still decodes.
const STORAGE_KEY = 'staysound_track_waveforms_v4';
const MAX_CACHED_TRACKS = 60;
/** decodeAudioData resamples to the context rate. 8 kHz Nyquist keeps the highs. */
const DECODE_SAMPLE_RATE = 16000;
/** Where the "bright" band starts, in Hz. */
const TREBLE_CROSSOVER_HZ = 2600;
/** RMS below this is treated as silence rather than as a very small number. */
const SILENCE_FLOOR_DB = -90;
/** The narrowest and widest dynamic window stretched across the bar's height. */
const MIN_RANGE_DB = 12;
const MAX_RANGE_DB = 24;
/** How much of the bar height the rank mapping contributes. See `normaliseLevels`. */
const RANK_WEIGHT = 0.55;
/** Final contrast expansion. Above 1 it deepens the valleys; 1.3 starts crushing them. */
const CONTRAST_GAMMA = 1.15;
/** A guard against pulling a 300 MB DSD file into memory for 320 numbers. */
const MAX_SOURCE_BYTES = 150 * 1024 * 1024;

const memoryCache = new Map<string, TrackWaveform>();
const inFlight = new Map<string, Promise<TrackWaveform | null>>();
/** Tracks whose analysis failed — never retried, so a bad file costs one attempt. */
const rejected = new Set<string>();

let storageLoaded = false;

/** Only local-ish sources are analysed: a remote stream would be downloaded twice. */
function isAnalysableUri(uri: string): boolean {
  return (
    uri.startsWith('blob:') ||
    uri.startsWith('file:') ||
    uri.startsWith('asset:') ||
    uri.startsWith('data:') ||
    uri.startsWith('http://asset.localhost') ||
    uri.startsWith('https://asset.localhost') ||
    uri.startsWith('http://localhost') ||
    uri.startsWith('http://127.0.0.1')
  );
}

/* ---------------------------------------------------------------- storage */

interface StoredEntry {
  /** `levels`, base64 of WAVEFORM_SAMPLES bytes. */
  l: string;
  /** `tone`, base64 of WAVEFORM_SAMPLES bytes. */
  t: string;
  /** Last read, for LRU eviction. */
  at: number;
}

type StoredMap = Record<string, StoredEntry>;

function readStore(): StoredMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredMap) : {};
  } catch {
    return {};
  }
}

function writeStore(store: StoredMap): void {
  try {
    const ids = Object.keys(store);
    if (ids.length > MAX_CACHED_TRACKS) {
      ids
        .sort((a, b) => (store[a]?.at ?? 0) - (store[b]?.at ?? 0))
        .slice(0, ids.length - MAX_CACHED_TRACKS)
        .forEach(id => delete store[id]);
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or private mode: the in-memory cache still covers this session.
  }
}

function encode(values: Float32Array): string {
  let binary = '';
  for (let index = 0; index < values.length; index += 1) {
    binary += String.fromCharCode(Math.round(Math.min(1, Math.max(0, values[index])) * 255));
  }
  return btoa(binary);
}

function decode(encoded: string): Float32Array | null {
  try {
    const binary = atob(encoded);
    if (binary.length !== WAVEFORM_SAMPLES) return null;
    const out = new Float32Array(WAVEFORM_SAMPLES);
    for (let index = 0; index < WAVEFORM_SAMPLES; index += 1) out[index] = binary.charCodeAt(index) / 255;
    return out;
  } catch {
    return null;
  }
}

function hydrateFromStorage(): void {
  if (storageLoaded) return;
  storageLoaded = true;
  const store = readStore();
  for (const [id, entry] of Object.entries(store)) {
    const levels = decode(entry.l);
    const tone = decode(entry.t);
    if (levels && tone) memoryCache.set(id, { levels, tone });
  }
}

function persist(id: string, waveform: TrackWaveform): void {
  const store = readStore();
  store[id] = { l: encode(waveform.levels), t: encode(waveform.tone), at: Date.now() };
  writeStore(store);
}

/* ---------------------------------------------------------------- analysis */

function decodeAudio(context: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // Older WebKit only implements the callback form and returns undefined.
    const maybePromise = context.decodeAudioData(bytes, resolve, reject) as unknown;
    if (maybePromise && typeof (maybePromise as Promise<AudioBuffer>).then === 'function') {
      (maybePromise as Promise<AudioBuffer>).then(resolve, reject);
    }
  });
}

/** One-pole lowpass coefficient for a corner frequency. */
function onePole(cutoffHz: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))];
}

function toDecibels(rms: number): number {
  return rms > 0 ? Math.max(SILENCE_FLOOR_DB, 20 * Math.log10(rms)) : SILENCE_FLOOR_DB;
}

/**
 * Maps slice loudness onto bar height, by blending two mappings.
 *
 * The first is the proportional one. Loudness is logarithmic and the original
 * version of this ignored it — on a linear RMS scale every slice of an ordinary
 * master lands between 0.7 and 1.0 of the height, which is why the wave came
 * out as a flat wall. In dB, stretched across the track's own p5..p97 window,
 * the same track spreads out.
 *
 * That alone still fails on the tracks that need it most. A modern master can
 * hold 90% of its slices inside 6 dB, and a single fade-out drags the low
 * anchor so far down that all the actual music piles back up against the
 * ceiling — which is what a clamped-but-wide window was still producing.
 *
 * So the second mapping is the slice's *rank* among all slices, which by
 * construction uses the full height whatever the track's dynamics are. It
 * exaggerates small differences, so it stays the minority partner; but it is a
 * monotonic transform of the same loudness, so a taller bar still always means
 * a louder moment. The blend is what guarantees a wave with shape instead of a
 * constant that happens to look different per track.
 */
function normaliseLevels(raw: Float32Array): Float32Array {
  const count = raw.length;
  const decibels = Float32Array.from(raw, value => toDecibels(value));
  const sorted = Array.from(decibels).sort((a, b) => a - b);

  const ceiling = percentile(sorted, 0.97);
  const range = Math.min(MAX_RANGE_DB, Math.max(MIN_RANGE_DB, ceiling - percentile(sorted, 0.05)));
  const floor = ceiling - range;

  // Rank by loudness. Ties keep their relative order, which is irrelevant here
  // because equally loud slices get equal heights either way.
  const order = Array.from({ length: count }, (_, index) => index).sort(
    (a, b) => decibels[a] - decibels[b],
  );
  const rank = new Float32Array(count);
  for (let position = 0; position < count; position += 1) {
    rank[order[position]] = count > 1 ? position / (count - 1) : 0.5;
  }

  const out = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const proportional = Math.min(1, Math.max(0, (decibels[index] - floor) / range));
    const blended = proportional * (1 - RANK_WEIGHT) + rank[index] * RANK_WEIGHT;
    // Silence keeps a hairline rather than disappearing: a gap between movements
    // is part of the shape of the song too.
    out[index] = Math.min(1, Math.max(0.03, Math.pow(blended, CONTRAST_GAMMA)));
  }
  return out;
}

/**
 * Absolute treble share barely moves — most music lives between a few percent
 * and a fifth of its energy above 2.6 kHz — so an absolute scale would paint
 * every bar the same colour. Stretching the track's own 6th..94th percentile
 * across the full ramp is what makes its bright passages actually look bright
 * next to its own dark ones.
 */
function spreadTone(raw: Float32Array): Float32Array {
  const sorted = Array.from(raw).sort((a, b) => a - b);
  const floor = percentile(sorted, 0.06);
  const ceiling = percentile(sorted, 0.94);
  const range = ceiling - floor;
  const out = new Float32Array(raw.length);

  // A track with no tonal contrast at all sits in the middle of the ramp rather
  // than being pushed to one end of it.
  if (range <= 1e-6) return out.fill(0.5);

  for (let index = 0; index < raw.length; index += 1) {
    out[index] = Math.min(1, Math.max(0, (raw[index] - floor) / range));
  }
  return out;
}

function envelopeFromBuffer(buffer: AudioBuffer): TrackWaveform {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const frames = left.length;
  const rawLevels = new Float32Array(WAVEFORM_SAMPLES);
  const rawTone = new Float32Array(WAVEFORM_SAMPLES);
  if (!frames) return { levels: rawLevels, tone: rawTone };

  // Two cascaded one-poles (12 dB/oct) split each frame into what sits below
  // 2.6 kHz and what is left above it. A real filterbank would be sharper, but
  // this is a colour ramp, not a measurement: it only has to order passages by
  // how bright they are, and it does that for the cost of two multiplies.
  const coefficient = onePole(TREBLE_CROSSOVER_HZ, buffer.sampleRate || DECODE_SAMPLE_RATE);
  let stageOne = 0;
  let stageTwo = 0;

  const step = frames / WAVEFORM_SAMPLES;
  for (let slice = 0; slice < WAVEFORM_SAMPLES; slice += 1) {
    const start = Math.floor(slice * step);
    const end = Math.max(start + 1, Math.min(frames, Math.floor((slice + 1) * step)));

    let total = 0;
    let high = 0;
    let low = 0;
    for (let frame = start; frame < end; frame += 1) {
      const sample = right ? (left[frame] + right[frame]) * 0.5 : left[frame];
      stageOne += coefficient * (sample - stageOne);
      stageTwo += coefficient * (stageOne - stageTwo);
      const treble = sample - stageTwo;

      total += sample * sample;
      high += treble * treble;
      low += stageTwo * stageTwo;
    }

    const count = end - start;
    const highRms = Math.sqrt(high / count);
    const lowRms = Math.sqrt(low / count);
    rawLevels[slice] = Math.sqrt(total / count);
    rawTone[slice] = highRms / (highRms + lowRms + 1e-9);
  }

  return { levels: normaliseLevels(rawLevels), tone: spreadTone(rawTone) };
}

/**
 * The file's bytes, by whichever route this build has. On the desktop the
 * asset: URL is the cheap path, but it is a custom scheme handler — if it ever
 * refuses a plain fetch, the Tauri reader that already backs the library scan
 * is a first-class fallback rather than a reason to give up on the waveform.
 */
async function loadBytes(track: Track, uri: string | null): Promise<ArrayBuffer | null> {
  if (uri && isAnalysableUri(uri)) {
    try {
      const response = await fetch(uri);
      if (response.ok) {
        const declaredLength = Number(response.headers.get('content-length') ?? 0);
        if (declaredLength > MAX_SOURCE_BYTES) return null;
        return await response.arrayBuffer();
      }
    } catch {
      // Fall through to the desktop reader.
    }
  }

  const nativePath = (track as Track & { nativePath?: string }).nativePath;
  if (!nativePath || !isTauriDesktop()) return null;

  const bytes = await readDesktopMusicFile(nativePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function analyse(track: Track): Promise<TrackWaveform | null> {
  const OfflineCtor =
    window.OfflineAudioContext ??
    (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OfflineCtor) return null;

  const uri = await webAudioEngine.resolvePlayableUri(track);
  const bytes = await loadBytes(track, uri);
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES) return null;

  // The length is irrelevant — the context exists only to own the decode and
  // pin its output rate — but it has to be at least one frame.
  const context = new OfflineCtor(1, 1, DECODE_SAMPLE_RATE);
  const buffer = await decodeAudio(context, bytes);

  return envelopeFromBuffer(buffer);
}

/* ------------------------------------------------------------------- public */

/** The cached envelope, if this track has already been analysed. Never blocks. */
export function peekTrackWaveform(track: Track | null): TrackWaveform | null {
  if (!track) return null;
  hydrateFromStorage();
  return memoryCache.get(track.id) ?? null;
}

/**
 * Resolves the track's envelope, analysing the file on first use. Returns null
 * when the source cannot be analysed (remote stream, unsupported codec, missing
 * file) — callers fall back to the placeholder shape.
 *
 * Analysis is shared, not owned: a caller that walks away (the user skipped on)
 * simply ignores the result, because a second view may still want it and the
 * decode is already paid for.
 */
export async function getTrackWaveform(track: Track): Promise<TrackWaveform | null> {
  hydrateFromStorage();

  const cached = memoryCache.get(track.id);
  if (cached) return cached;
  if (rejected.has(track.id)) return null;

  const pending = inFlight.get(track.id);
  if (pending) return pending;

  const run = (async () => {
    try {
      const waveform = await analyse(track);
      if (!waveform) {
        rejected.add(track.id);
        return null;
      }

      memoryCache.set(track.id, waveform);
      persist(track.id, waveform);
      return waveform;
    } catch (error) {
      console.warn('Waveform analysis failed:', error);
      rejected.add(track.id);
      return null;
    } finally {
      inFlight.delete(track.id);
    }
  })();

  inFlight.set(track.id, run);
  return run;
}
