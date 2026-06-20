/**
 * Professional shuffle for the playback queue.
 *
 * Goals (why a plain Fisher-Yates "feels" like the same songs every time):
 *   1. Uniform random ordering clusters same-artist / same-album tracks together
 *      and lets a handful of tracks recur quickly, so listeners perceive repetition.
 *      We solve this with a balanced (dispersed) shuffle inspired by Spotify's
 *      algorithm (Lukáš Poláček, 2014): tracks of the same artist are spread as
 *      evenly as possible across the whole queue.
 *   2. Recently played tracks can land right back at the front. We apply a soft
 *      recency penalty so they drift toward the back instead of repeating.
 *   3. Relying solely on Math.random() can yield low-entropy / repeating sequences
 *      (notably under Hermes). We drive everything from a seeded high-quality PRNG
 *      reseeded from multiple entropy sources on every shuffle.
 */

import { Track } from '../types/audio';

/** Deterministic, well-distributed 32-bit PRNG. Returns floats in [0, 1). */
export type Rng = () => number;

/** mulberry32 — tiny, fast, statistically solid for shuffling. */
export function mulberry32(seed: number): Rng {
    let a = seed >>> 0;
    return function rng() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Monotonic counter so two shuffles fired within the same millisecond still diverge.
let entropyCounter = 0;

/**
 * Build a seed by mixing several entropy sources. Even if one source is weak
 * (e.g. a poorly seeded Math.random), the others keep successive seeds distinct.
 */
function makeSeed(): number {
    const now = Date.now();
    const counter = (entropyCounter = (entropyCounter + 1) | 0);
    // Fold time, a per-call counter and two Math.random draws together.
    let h = now ^ (now >>> 16);
    h = Math.imul(h ^ counter, 0x9e3779b1);
    h ^= Math.floor(Math.random() * 0xffffffff);
    h = Math.imul(h ^ (h >>> 13), 0x85ebca6b);
    h ^= Math.floor(Math.random() * 0xffffffff);
    h ^= h >>> 16;
    return h >>> 0;
}

/** Create a freshly seeded PRNG for one shuffle pass. */
export function createRng(seed: number = makeSeed()): Rng {
    return mulberry32(seed);
}

/** Unbiased Fisher-Yates shuffle driven by the provided RNG (mutates a copy). */
export function fisherYates<T>(items: readonly T[], rng: Rng): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function groupKey(track: Track): string {
    // Group by artist primarily; fall back to album/id so unknown-artist tracks
    // still disperse instead of all collapsing into one giant bucket.
    const artist = (track.artistId || track.artist || '').trim().toLowerCase();
    if (artist) return `a:${artist}`;
    const album = (track.albumId || track.album || '').trim().toLowerCase();
    if (album) return `b:${album}`;
    return `t:${track.id}`;
}

interface BalancedOptions {
    /** Track ids played recently (most-recent-first); softly pushed toward the back. */
    recentIds?: readonly string[];
    rng?: Rng;
}

/**
 * Balanced (dispersed) shuffle: same-artist tracks are spread evenly across the
 * result so playback feels varied rather than clustered.
 *
 * Algorithm: shuffle each artist group internally, then assign every track a
 * position in [0, 1) using an even spacing within its group plus a random group
 * offset and a little jitter. Sorting by that position interleaves the groups.
 */
export function balancedShuffle(tracks: readonly Track[], options: BalancedOptions = {}): Track[] {
    if (tracks.length <= 2) {
        return fisherYates(tracks, options.rng ?? createRng());
    }

    const rng = options.rng ?? createRng();

    // Map a recently played id to a penalty weight in (0, 1]; most recent = strongest.
    const recencyPenalty = new Map<string, number>();
    const recent = options.recentIds;
    if (recent && recent.length > 0) {
        const n = recent.length;
        for (let i = 0; i < n; i++) {
            recencyPenalty.set(recent[i], (n - i) / n);
        }
    }

    // Bucket tracks by artist group, preserving original order within each bucket.
    const groups = new Map<string, Track[]>();
    for (const track of tracks) {
        const key = groupKey(track);
        const bucket = groups.get(key);
        if (bucket) bucket.push(track);
        else groups.set(key, [track]);
    }

    type Ranked = { track: Track; rank: number };
    const ranked: Ranked[] = [];

    for (const bucket of groups.values()) {
        const shuffled = fisherYates(bucket, rng);
        const size = shuffled.length;
        const spacing = 1 / size;
        const offset = rng() * spacing; // random phase so groups don't align
        for (let i = 0; i < size; i++) {
            const track = shuffled[i];
            // Even position within the queue + small jitter to break ties.
            let rank = offset + i * spacing + (rng() - 0.5) * spacing * 0.5;
            // Soft anti-repeat: nudge recently played tracks toward the back.
            const penalty = recencyPenalty.get(track.id);
            if (penalty) rank += penalty * 0.6;
            ranked.push({ track, rank });
        }
    }

    ranked.sort((a, b) => a.rank - b.rank);
    return ranked.map(r => r.track);
}
