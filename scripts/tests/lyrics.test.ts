import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchLyricsFromLrclib, parseLyricsfile, parseLrclibSyncedLyrics } from '../../src/services/lrclibLookup';
import { lrclibLinesToKaraoke } from '../../src/services/lrcLibService';
import { LyricsRepository } from '../../src/services/lyricsRepository';
import { records } from './helpers/lyrics-storage';

const yaml = `version: "1.0"
lines:
  - text: "Hola mundo"
    start_ms: 1200
    end_ms: 3000
    words:
      - {text: "Ho", start_ms: 1200, end_ms: 1400}
      - {text: "la ", start_ms: 1400, end_ms: 1800}
      - {text: "mundo", start_ms: 2100, end_ms: 3000}
  - text: "oh sí"
    role: background
    start_ms: 1500
    end_ms: 2400
    words:
      - {text: "oh ", start_ms: 1500, end_ms: 1900}
      - {text: "sí", start_ms: 1900, end_ms: 2400}
`;
const record = { id: 1, trackName: 'Song', artistName: 'Artist', albumName: 'Album', duration: 120,
    instrumental: false, syncedLyrics: '[00:01.20]Hola mundo', plainLyrics: 'Hola mundo', hasWordSync: true, lyricsfile: yaml };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; records.clear(); });
function mockNetwork(handler: (url: string) => unknown) {
    const urls: string[] = [];
    globalThis.fetch = async input => {
        const url = String(input); urls.push(url);
        const value = handler(url);
        return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status: value === null ? 404 : 200 });
    };
    return urls;
}

test('Lyricsfile preserves syllables, spaces, backing vocals and native seconds', () => {
    const payload = lrclibLinesToKaraoke(parseLyricsfile(yaml)!, 'Song', 'Artist', 120)!;
    assert.deepEqual(payload.lyrics.map(word => word.w), ['Ho', 'la', 'mundo', 'oh', 'sí']);
    assert.equal(payload.lyrics[0].s, 1.2);
    assert.equal(payload.lyrics[2].e, 3);
    assert.equal(payload.lyrics[1].p, true);
    assert.equal(payload.lyrics[1].sp, true);
    assert.equal(payload.lyrics[2].p, false);
    assert.equal(payload.lyrics[3].bg, true);
    assert.deepEqual(payload.lyrics.map(word => word.n), [false, false, false, false, true]);
});

test('line fallback supports offsets, repeated timestamps and empty gap markers', () => {
    const lines = parseLrclibSyncedLyrics('[offset:100]\n[00:01][00:05]Hola\n[00:03]\n[00:07]Adiós', 10_000);
    assert.equal(lines.length, 3);
    assert.equal(lines[0].timestamp, 1100);
    assert.equal(lines[0].endtime, 3100);
    const payload = lrclibLinesToKaraoke(lines, 'Song', 'Artist')!;
    assert.ok(payload.lyrics.every(word => word.n));
});

test('malformed or line-only Lyricsfiles are ignored safely', () => {
    assert.equal(parseLyricsfile('version: "1.0"\nlines: invalid'), null);
    assert.equal(parseLyricsfile('version: "1.0"\nlines:\n - {text: Hi, start_ms: 1000}'), null);
    assert.equal(parseLyricsfile('version: "1.0"\nlines:\n - {text: Hi, start_ms: .inf, words: []}'), null);
});

test('word-only exact LRCLIB record works without syncedLyrics and uses album/duration', async () => {
    const urls = mockNetwork(() => ({ ...record, syncedLyrics: null }));
    const result = await fetchLyricsFromLrclib({ title: 'Song', artist: 'Artist', album: 'Album', durationMs: 120_000 });
    assert.ok(result?.lines[0].isWordSynced);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /album_name=Album&duration=120/);
});

test('search upgrades an older exact line-only record to word timing', async () => {
    mockNetwork(url => url.includes('/get?') ? { ...record, hasWordSync: false, lyricsfile: null } : [{ ...record, id: 2 }]);
    const result = await fetchLyricsFromLrclib({ title: 'Song', artist: 'Artist', album: 'Album', durationMs: 120_000 });
    assert.ok(result?.lines[0].isWordSynced);
});

test('search rejects another artist and a different recording duration', async () => {
    mockNetwork(() => [{ ...record, artistName: 'Other person' }, { ...record, id: 2, duration: 180 }]);
    assert.equal(await fetchLyricsFromLrclib({ title: 'Song', artist: 'Artist', durationMs: 120_000 }), null);
});

test('search skips lyricless candidates instead of losing a usable line fallback', async () => {
    mockNetwork(() => [{ ...record, lyricsfile: null, syncedLyrics: null, plainLyrics: null },
        { ...record, id: 2, hasWordSync: false, lyricsfile: null }]);
    const result = await fetchLyricsFromLrclib({ title: 'Song', artist: 'Artist', durationMs: 120_000 });
    assert.ok(result?.lines.length);
});

test('Android selects LRCLIB words before Apple, caches them, and honors disabled sources', async () => {
    const urls = mockNetwork(url => url.includes('lrclib.net') ? [record] : { hits: [] });
    const options = await LyricsRepository.getAppleWordLyricsOptions('Song', 'Artist', undefined, 120, 'track', undefined, ['lrc-red', 'lrclib', 'apple']);
    assert.equal(options[0]?.sourceId, 'lrclib');
    assert.equal(options[0]?.wordLevel, true);
    assert.ok(options[0]?.payload.lyrics.some(word => !word.n));
    assert.ok(!urls.some(url => url.includes('binimum')));
    const before = urls.length;
    assert.deepEqual(await LyricsRepository.getAppleWordLyricsOptions('Song', 'Artist', undefined, 120, 'track', undefined, ['lrc-red', 'lrclib', 'apple']), JSON.parse(JSON.stringify(options)));
    assert.equal(urls.length, before);
    const disabled = await LyricsRepository.getAppleWordLyricsOptions('Song', 'Artist', undefined, 120, 'track', undefined, ['lrc-red']);
    assert.deepEqual(disabled, []);
    assert.equal(urls.filter(url => url.includes('lrclib.net')).length, 1);
});

test('Android retrieves original word-timed TTML from lrc.red before LRCLIB', async () => {
    const ttml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="3s"><span begin="1s" end="2s">Hola</span> <span begin="2s" end="3s">mundo</span></p></div></body></tt>`;
    const urls = mockNetwork(url => url.includes('/search.json') ? { hits: [{ isrc: 'USABC2600001', title: 'Song', artist: 'Artist', duration: 120 }] } : ttml);
    const options = await LyricsRepository.getAppleWordLyricsOptions('Song', 'Artist', undefined, 120, 'track', undefined, ['lrc-red', 'lrclib']);
    assert.equal(options[0]?.sourceId, 'lrc-red');
    assert.deepEqual(options[0]?.payload.lyrics.map(word => word.s), [1, 2]);
    assert.ok(urls.every(url => url.includes('lrc.red')));
});

test('Android line fallback remains available and plain text is not falsely timed', async () => {
    mockNetwork(() => [{ ...record, hasWordSync: false, lyricsfile: null }]);
    assert.deepEqual(await LyricsRepository.getAppleWordLyricsOptions('Song', 'Artist', undefined, 120, 'track', undefined, ['lrclib']), []);
    const fallback = await LyricsRepository.getLrcLibLyrics('Song', 'Artist', 120, 'track');
    assert.equal(fallback?.lyrics[0].w, 'Hola mundo');
    assert.equal(fallback?.lyrics[0].n, true);
    records.clear();
    mockNetwork(() => [{ ...record, hasWordSync: false, lyricsfile: null, syncedLyrics: null }]);
    assert.equal(await LyricsRepository.getLrcLibLyrics('Song', 'Artist', 120, 'track'), null);
});
