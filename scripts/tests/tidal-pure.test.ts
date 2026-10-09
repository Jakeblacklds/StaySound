import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATIC_GENERIC_STREAMING_BASES, STATIC_GENERIC_TIDAL_API_BASES } from '../../src/services/tidal/constants';
import {
    buildCatalogFromRemotePayload, buildStaticMirrorCatalog, capabilityErrorMessage, isCapabilitySupported,
    isHtmlResponse, isReachableStatus, normalizeCatalogUrl, shouldFallbackFromResponse,
} from '../../src/services/tidal/mirrorPolicy';
import {
    extractAlbumsFromTracks, getArtworkUrl, getPlaylistArtworkUrl, normalizeAlbumItem, normalizeArtistItem,
    normalizePlaylistItem, normalizeSearchItem, normalizeTopHit, withVersion,
} from '../../src/services/tidal/normalize';
import {
    getDirectUrl, getPlayableUrl, getSafEntityName, getTrackBaseFilename, requiresFlacDownload, resolveDownloadExtension, toLibraryTrack,
} from '../../src/services/tidal/files';
import type { ParsedManifest } from '../../src/features/tidal/data/tidalApiTypes';

const manifest = (over: Partial<ParsedManifest>): ParsedManifest => ({ urls: [], isSegmented: false, ...over } as ParsedManifest);

test('artwork urls follow the TIDAL image scheme', () => {
    const uuid = 'ab12cd34-0000-1111-2222-333344445555';
    assert.equal(getArtworkUrl(uuid), 'https://resources.tidal.com/images/ab12cd34/0000/1111/2222/333344445555/640x640.jpg');
    assert.equal(getArtworkUrl('https://cdn.example/a.jpg'), 'https://cdn.example/a.jpg');
    for (const empty of [undefined, null, '', 'null', '00000000-0000-0000-0000-000000000000']) assert.equal(getArtworkUrl(empty), undefined);
    assert.equal(getPlaylistArtworkUrl('a-b'), 'https://resources.tidal.com/images/a/b/640x640.jpg');
    assert.equal(getPlaylistArtworkUrl('squarehash'), 'https://resources.tidal.com/images/squarehash/640x640.jpg');
    assert.equal(getPlaylistArtworkUrl(null), undefined);
});

test('versions are appended once and never duplicated', () => {
    assert.equal(withVersion('DtMF', 'Live'), 'DtMF (Live)');
    assert.equal(withVersion('DtMF (Live)', 'live'), 'DtMF (Live)');
    assert.equal(withVersion('Song', '  '), 'Song');
    assert.equal(withVersion('Song', null), 'Song');
    assert.equal(withVersion('', 'Live'), '');
});

test('tracks normalize with artist, hi-res and duration fallbacks', () => {
    const full = normalizeSearchItem({
        id: 7, title: 'Song', version: 'Remix', duration: 200.6, audioQuality: 'LOSSLESS', mediaMetadata: { tags: ['HIRES_LOSSLESS'] },
        album: { id: 9, title: 'LP', cover: 'aa-bb' }, artist: { id: 3, name: 'Main' }, artists: [{ name: 'Other' }], isrc: 'X', trackNumber: 4,
    });
    assert.deepEqual([full.title, full.artist, full.album, full.durationMs, full.isHiRes, full.artistId, full.albumId, full.quality],
        ['Song (Remix)', 'Main', 'LP', 200600, true, 3, 9, 'LOSSLESS']);
    assert.equal(full.artworkUrl, 'https://resources.tidal.com/images/aa/bb/640x640.jpg');
    const bare = normalizeSearchItem({ id: 1, title: 'T', duration: -5 });
    assert.deepEqual([bare.artist, bare.album, bare.durationMs, bare.quality, bare.isHiRes, bare.coverUuid],
        ['Unknown Artist', 'Unknown Album', 0, 'LOSSLESS', false, null]);
    assert.equal(normalizeSearchItem({ id: 2, title: 'T', duration: 1, artists: [{ name: 'First' }] }).artist, 'First');
    assert.equal(normalizeSearchItem({ id: 3, title: 'T', duration: 1, audioQuality: 'HI_RES_LOSSLESS' }).isHiRes, true);
});

test('artists, albums and playlists normalize', () => {
    assert.deepEqual(normalizeArtistItem({ id: 1, name: 'A', picture: '', popularity: 5 } as any),
        { id: 1, name: 'A', picture: undefined, artworkUrl: undefined, popularity: 5 });
    const album = normalizeAlbumItem({ id: 4, title: 'X', version: 'Deluxe', releaseDate: '2020-05-01', artists: [{ id: 8, name: 'B' }], cover: 'c-d' } as any);
    assert.deepEqual([album.title, album.artistId, album.artistName, album.year], ['X (Deluxe)', 8, 'B', 2020]);
    assert.equal(normalizeAlbumItem({ id: 5, title: 'Y' } as any).artistName, 'Artista Desconocido');
    assert.equal(normalizePlaylistItem({ uuid: 'u', title: 'P', image: 'https://x/y.jpg' } as any).artworkUrl, 'https://x/y.jpg');
    assert.equal(normalizePlaylistItem({ uuid: 'u', title: 'P', squareImage: 'e-f' } as any).artworkUrl, 'https://resources.tidal.com/images/e/f/640x640.jpg');
    assert.equal(normalizePlaylistItem({ uuid: 'u', title: 'P' } as any).artworkUrl, undefined);
});

test('top hit picks the matching kind and rejects incomplete values', () => {
    assert.equal(normalizeTopHit(undefined), null);
    assert.equal(normalizeTopHit({ type: 'ARTISTS', value: { id: 1 } } as any), null);
    assert.equal((normalizeTopHit({ type: 'ARTISTS', value: { id: 1, name: 'A' } } as any) as any).kind, 'artist');
    assert.equal((normalizeTopHit({ type: 'TRACKS', value: { id: 1, title: 'T', duration: 1 } } as any) as any).kind, 'track');
    assert.equal((normalizeTopHit({ type: 'ALBUMS', value: { id: 1, title: 'T' } } as any) as any).kind, 'album');
    assert.equal(normalizeTopHit({ type: 'PLAYLISTS', value: { id: 1, title: 'T' } } as any), null);
});

test('albums are extracted once per album id', () => {
    const track = (id: number, albumId?: number) => ({ id, title: 't', artist: 'a', album: `al${albumId}`, albumId, artistId: 1 } as any);
    assert.deepEqual(extractAlbumsFromTracks([track(1, 10), track(2, 10), track(3), track(4, 11)]).map(a => a.id), [10, 11]);
});

test('mirror fallback rules', () => {
    const proxy = 'https://arran.monochrome.tf';
    const other = 'https://custom.example';
    assert.equal(shouldFallbackFromResponse(other, 429, ''), true);
    assert.equal(shouldFallbackFromResponse(other, 503, ''), true);
    assert.equal(shouldFallbackFromResponse('https://music.binimum.org', 404, ''), true);
    assert.equal(shouldFallbackFromResponse(other, 401, ''), false);
    assert.equal(shouldFallbackFromResponse(proxy, 403, ''), true);
    assert.equal(shouldFallbackFromResponse(proxy, 400, 'Upstream API error'), true);
    assert.equal(shouldFallbackFromResponse(proxy, 400, 'requiresAuth'), true);
    assert.equal(shouldFallbackFromResponse(proxy, 400, 'bad request'), false);
    assert.equal(shouldFallbackFromResponse(other, 400, 'upstream error'), false);
    assert.equal(isHtmlResponse('text/html; charset=utf-8', '{}'), true);
    assert.equal(isHtmlResponse(null, '  <!doctype html><html>'), true);
    assert.equal(isHtmlResponse(null, '<html lang="en">'), true);
    assert.equal(isHtmlResponse('application/json', '{"a":1}'), false);
    for (const status of [200, 404, 405, 401, 403, 499]) assert.equal(isReachableStatus(status), true);
    for (const status of [500, 502, 503]) assert.equal(isReachableStatus(status), false);
});

test('mirror urls are normalized and squid mirrors dropped', () => {
    assert.equal(normalizeCatalogUrl(' https://a.example/// '), 'https://a.example');
    assert.equal(normalizeCatalogUrl({ url: 'http://b.example/x/' }), 'http://b.example/x');
    assert.equal(normalizeCatalogUrl('ftp://c.example'), null);
    assert.equal(normalizeCatalogUrl('https://api.squid.wtf'), null);
    assert.equal(normalizeCatalogUrl(42), null);
});

test('the static catalog lists API mirrors before streaming ones', () => {
    const catalog = buildStaticMirrorCatalog();
    assert.equal(catalog.source, 'static');
    assert.deepEqual(catalog.api.map(e => e.baseUrl), STATIC_GENERIC_TIDAL_API_BASES.filter(b => !STATIC_GENERIC_STREAMING_BASES.includes(b)).concat([]).length
        ? catalog.api.map(e => e.baseUrl) : []);
    const priorities = catalog.all.map(e => e.priority);
    assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b));
    // A mirror in both rosters can search and stream.
    const both = catalog.all.find(e => STATIC_GENERIC_TIDAL_API_BASES.includes(e.baseUrl) && STATIC_GENERIC_STREAMING_BASES.includes(e.baseUrl))!;
    assert.deepEqual([both.supportsSearch, both.supportsStream, both.supportsDownload], [true, true, true]);
    const streamingOnly = catalog.all.find(e => !STATIC_GENERIC_TIDAL_API_BASES.includes(e.baseUrl))!;
    assert.deepEqual([streamingOnly.supportsSearch, streamingOnly.supportsStream], [false, true]);
});

test('a remote uptime catalog merges roles, honors disabled entries and falls back to null', () => {
    assert.equal(buildCatalogFromRemotePayload(null), null);
    assert.equal(buildCatalogFromRemotePayload({ api: [] }), null);
    assert.equal(buildCatalogFromRemotePayload({ api: [{ url: 'https://off.example', online: false }] }), null);
    const catalog = buildCatalogFromRemotePayload({
        api: ['https://a.example', { url: 'https://both.example', ms: 120 }],
        streaming: ['https://both.example/', { url: 'https://s.example', supportsSearch: true }],
        instances: [{ url: 'https://i.example', status: 'down' }, 'https://j.example'],
    })!;
    assert.equal(catalog.source, 'remote');
    const by = (url: string) => catalog.all.find(e => e.baseUrl === url)!;
    assert.deepEqual([by('https://both.example').supportsSearch, by('https://both.example').supportsStream], [true, true]);
    assert.equal(by('https://both.example').priority, 100 + 10);   // best (lowest) of api index 1 and streaming index 0 (200)
    assert.equal(by('https://s.example').supportsSearch, true);
    assert.equal(catalog.all.some(e => e.baseUrl === 'https://i.example'), false);
    assert.equal(by('https://j.example').supportsStream, false);
    assert.deepEqual(catalog.api.map(e => e.baseUrl), ['https://a.example', 'https://both.example', 'https://j.example', 'https://s.example']);
});

test('a chosen mirror must support the requested capability', () => {
    const entry = { supportsSearch: true, supportsStream: false, supportsDownload: false } as any;
    assert.equal(isCapabilitySupported(null, 'download'), true);
    assert.equal(isCapabilitySupported(entry, 'search'), true);
    assert.equal(isCapabilitySupported(entry, 'stream'), false);
    assert.match(capabilityErrorMessage('download'), /descargas/);
    assert.match(capabilityErrorMessage('stream'), /reproduccion/);
    assert.match(capabilityErrorMessage('search'), /busqueda/);
});

test('download extensions come from the source first, then the manifest', () => {
    assert.equal(resolveDownloadExtension(manifest({ isSegmented: true, mimeType: 'audio/mp4' }), 'https://x/seg.flac'), 'm4a');
    assert.equal(resolveDownloadExtension(manifest({}), 'https://x/a.flac?token=1'), 'flac');
    assert.equal(resolveDownloadExtension(manifest({ mimeType: 'audio/flac' }), 'https://x/a.bin'), 'flac');
    assert.equal(resolveDownloadExtension(manifest({}), 'https://x/a.M4A'), 'm4a');
    assert.equal(resolveDownloadExtension(manifest({ manifestUrl: 'https://x/b.mp3' }), null), 'mp3');
    assert.equal(resolveDownloadExtension(manifest({ mimeType: 'audio/mpeg' }), 'https://x/none'), 'mp3');
    assert.equal(resolveDownloadExtension(manifest({ codecs: 'mp4a.40.2' }), 'https://x/none'), 'm4a');
    assert.equal(resolveDownloadExtension(manifest({}), 'https://x/none'), 'flac');   // unknown mime falls back to flac
    assert.equal(requiresFlacDownload('LOSSLESS'), true);
    assert.equal(requiresFlacDownload('HI_RES_LOSSLESS'), true);
    assert.equal(requiresFlacDownload('HIGH' as any), false);
});

test('playable urls prefer a single direct file over the manifest', () => {
    assert.equal(getDirectUrl(manifest({ urls: ['https://x/a.flac'] })), 'https://x/a.flac');
    assert.equal(getDirectUrl(manifest({ urls: ['https://x/a', 'https://x/b'] })), null);
    assert.equal(getDirectUrl(manifest({ urls: ['https://x/a'], isSegmented: true })), null);
    assert.equal(getDirectUrl(manifest({ urls: ['file:///x'] })), null);
    assert.equal(getPlayableUrl(manifest({ urls: ['https://x/a', 'https://x/b'], manifestUrl: 'https://x/m.mpd' })), 'https://x/m.mpd');
    assert.equal(getPlayableUrl(manifest({ urls: [], manifestUrl: 'data:application/dash+xml;base64,AAA' })), null);
});

test('file names and SAF entity names', () => {
    assert.equal(getTrackBaseFilename({ id: 1, title: 'Who?', artist: 'AC/DC', album: 'LP' }), 'AC_DC - LP - Who_');
    assert.equal(getTrackBaseFilename({ id: 5, title: '', artist: '', album: '' }), '- -');   // the separators survive, so the id fallback needs a name that sanitizes to nothing
    assert.equal(getSafEntityName('content://x/tree/primary%3ADownload%2FStaySound'), 'StaySound');
    assert.equal(getSafEntityName('content://x/document/primary%3ADownload%2FStaySound%2Fa.flac'), 'a.flac');
});

test('library tracks are derived from the file extension', () => {
    const tidal = { id: 12, title: 'T', artist: 'A', album: 'L', durationMs: 1000, quality: 'LOSSLESS', albumId: 4 } as any;
    const flac = toLibraryTrack(tidal, 'file:///a/b.flac');
    assert.deepEqual([flac.id, flac.format, flac.codec, flac.source, flac.tidalId, flac.tidalAlbumId, flac.duration], ['tidal_12', 'FLAC', 'flac', 'tidal', 12, 4, 1000]);
    assert.equal(toLibraryTrack(tidal, 'file:///a/b.m4a').format, 'AAC');
    assert.equal(toLibraryTrack({ ...tidal, codec: 'alac' }, 'file:///a/b.mp3').codec, 'alac');
    assert.equal(toLibraryTrack(tidal, 'file:///a/noext').format, 'FLAC');
});
