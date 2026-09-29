import {
    buildCatalogFromRemotePayload, buildStaticMirrorCatalog, capabilityErrorMessage, isCapabilitySupported,
    isHtmlResponse, isReachableStatus, normalizeCatalogUrl, shouldFallbackFromResponse,
} from '../../src/services/tidal/mirrorPolicy';
import {
    extractAlbumsFromTracks, getArtworkUrl, getPlaylistArtworkUrl, normalizeAlbumItem, normalizeArtistItem,
    normalizePlaylistItem, normalizeSearchItem, normalizeTopHit, withVersion,
} from '../../src/services/tidal/normalize';
import { parseDashManifest, parseDashManifestForQuality } from '../../src/features/tidal/data/dashManifestParser';
import {
    getDirectUrl, getPlayableUrl, getSafEntityName, getTrackBaseFilename, requiresFlacDownload, resolveDownloadExtension, toLibraryTrack,
} from '../../src/services/tidal/files';


const flac = (extra = '') => `<?xml version="1.0"?><MPD><Period><AdaptationSet mimeType="audio/mp4"><Representation id="FLAC,44100,16" codecs="flac" audioSamplingRate="44100"><BaseURL>https://cdn.example/t/</BaseURL><SegmentTemplate initialization="init.mp4" media="seg-$Number$.m4s" startNumber="1"${extra}><SegmentTimeline><S d="100" r="2"/><S d="50"/></SegmentTimeline></SegmentTemplate></Representation></Representation></AdaptationSet></Period></MPD>`.replace('</Representation></Representation>', '</Representation>');
const rich = `<MPD><Period>
  <AdaptationSet mimeType="audio/mp4" codecs="mp4a.40.2">
    <Representation id="HEAACV1" codecs="mp4a.40.5" audioSamplingRate="22050"><BaseURL>https://cdn.example/lo/</BaseURL><SegmentTemplate initialization="i.mp4" media="l-$Number%05d$.m4s" startNumber="7"><SegmentTimeline><S d="1" r="1"/></SegmentTimeline></SegmentTemplate></Representation>
    <Representation id="AACLC" codecs="mp4a.40.2" audioSamplingRate="44100"><BaseURL>https://cdn.example/hi/</BaseURL><SegmentTemplate initialization="i.mp4" media="h-$Number$.m4s" startNumber="1"><SegmentTimeline><S d="1" r="-1"/></SegmentTimeline></SegmentTemplate></Representation>
    <Representation id="FLAC,44100,16" codecs="flac" audioSamplingRate="44100"><BaseURL>https://cdn.example/f16/</BaseURL><SegmentTemplate initialization="i.mp4" media="f-$Number$.m4s" startNumber="1"><SegmentTimeline><S d="1"/></SegmentTimeline></SegmentTemplate></Representation>
    <Representation id="FLAC_HIRES,96000,24" codecs="flac" audioSamplingRate="96000"><BaseURL>/rel/path/</BaseURL><SegmentTemplate initialization="/i.mp4" media="x-$Number$.m4s" startNumber="1"><SegmentTimeline><S d="1" r="1"/></SegmentTimeline></SegmentTemplate></Representation>
  </AdaptationSet>
  <AdaptationSet mimeType="video/mp4"><Representation id="V" codecs="avc1"><SegmentTemplate media="v.m4s" startNumber="1"><SegmentTimeline><S d="1"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet>
</Period></MPD>`;
const dashInputs = {
    tidalFlac: flac(),
    noStartNumber: flac().replace(' startNumber="1"', ''),
    templateOnAdaptationSet: '<MPD><Period><AdaptationSet mimeType="audio/mp4" codecs="flac" audioSamplingRate="48000"><SegmentTemplate initialization="i.mp4" media="s$Number$.m4s" startNumber="1"><SegmentTimeline><S d="1" r="1"/></SegmentTimeline></SegmentTemplate><Representation id="FLAC,48000,24"/></AdaptationSet></Period></MPD>',
    noAudio: '<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation id="V"><SegmentTemplate media="v.m4s" startNumber="1"><SegmentTimeline><S d="1"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet></Period></MPD>',
    notXml: 'this is not xml',
    empty: '',
    noSegments: '<MPD><Period><AdaptationSet mimeType="audio/mp4"><Representation id="A"><SegmentTemplate initialization="" media=""/></Representation></AdaptationSet></Period></MPD>',
    initOnly: '<MPD><Period><AdaptationSet mimeType="audio/mp4"><Representation id="A" codecs="flac"><SegmentTemplate initialization="only-init.mp4"/></Representation></AdaptationSet></Period></MPD>',
};

/** Every function the Kotlin port (android-core/tidal) must reproduce, with the inputs to run it on. */
const fixtures: Record<string, { run: (...args: any[]) => unknown; inputs: any[][] }> = {
    artworkUrl: { run: getArtworkUrl, inputs: [
        ['ab12cd34-0000-1111-2222-333344445555'], ['https://cdn.example/a.jpg'], ['http://cdn.example/a.jpg'], [null], [''], ['null'],
        ['00000000-0000-0000-0000-000000000000'], ['plainhash'], [null]] },
    playlistArtworkUrl: { run: getPlaylistArtworkUrl, inputs: [['a-b-c'], ['squarehash'], [''], [null]] },
    withVersion: { run: withVersion, inputs: [['DtMF', 'Live'], ['DtMF (Live)', 'live'], ['Song', '  '], ['Song', null], ['', 'Live'], ['Song', ' Remix '], ['Ünï', 'ÜNÏ']] },
    normalizeTrack: { run: normalizeSearchItem, inputs: [
        [{ id: 7, title: 'Song', version: 'Remix', duration: 200.6, audioQuality: 'LOSSLESS', mediaMetadata: { tags: ['HIRES_LOSSLESS'] },
            album: { id: 9, title: 'LP', cover: 'aa-bb' }, artist: { id: 3, name: 'Main' }, artists: [{ name: 'Other' }], isrc: 'X', trackNumber: 4,
            explicit: true, popularity: 51.5 }],
        [{ id: 1, title: 'T', duration: -5 }],
        [{ id: 2, title: 'T', duration: 1, artists: [{ name: 'First' }] }],
        [{ id: 3, title: 'T', duration: 1, audioQuality: 'HI_RES_LOSSLESS', album: { cover: null } }],
        [{ id: 4, title: 'T', duration: 0.0004 }], [{ id: 8, title: 'T', duration: 0.0005 }], [{ id: 9, title: 'T', duration: 0.0025 }], [{ id: 10, title: 'T', duration: 1.0015 }],
        [{ id: 5, title: 'T', duration: 2.5, mediaMetadata: { tags: [] }, audioQuality: 'HIGH' }],
        [{ id: 123456789012, title: 'Big id', duration: 3 }]] },
    normalizeArtist: { run: normalizeArtistItem, inputs: [
        [{ id: 1, name: 'A', picture: '', popularity: 5 }], [{ id: 2, name: 'B', picture: 'aa-bb-cc' }], [{ id: 3, name: 'C', picture: 'https://x/y.jpg' }], [{ id: 4, name: 'D' }]] },
    normalizeAlbum: { run: normalizeAlbumItem, inputs: [
        [{ id: 4, title: 'X', version: 'Deluxe', releaseDate: '2020-05-01', artists: [{ id: 8, name: 'B' }], cover: 'c-d', numberOfTracks: 12, explicit: false, type: 'ALBUM', popularity: 3 }],
        [{ id: 5, title: 'Y' }],
        [{ id: 6, title: 'Z', releaseDate: 'not a date', artist: { id: 1, name: 'Solo' } }],
        [{ id: 7, title: 'Q', releaseDate: '1999-12-31', cover: null }]] },
    normalizePlaylist: { run: normalizePlaylistItem, inputs: [
        [{ uuid: 'u', title: 'P', image: 'https://x/y.jpg', numberOfTracks: 3, description: 'd' }],
        [{ uuid: 'u2', title: 'P2', squareImage: 'e-f' }],
        [{ uuid: 'u3', title: 'P3', cover: 'g-h', picture: 'ignored' }],
        [{ uuid: 'u4', title: 'P4' }]] },
    normalizeTopHit: { run: normalizeTopHit, inputs: [
        [null], [{ type: 'ARTISTS', value: { id: 1 } }], [{ type: 'ARTISTS', value: { id: 1, name: 'A' } }],
        [{ type: 'TRACKS', value: { id: 1, title: 'T', duration: 1 } }], [{ type: 'ALBUMS', value: { id: 1, title: 'T' } }],
        [{ type: 'PLAYLISTS', value: { id: 1, title: 'T' } }], [{ type: 'TRACKS', value: { title: 'no id' } }]] },
    extractAlbums: { run: extractAlbumsFromTracks, inputs: [[[
        { id: 1, title: 't', artist: 'a', album: 'al10', albumId: 10, artistId: 1, artworkUrl: 'u1', coverUuid: 'c1' },
        { id: 2, title: 't', artist: 'a', album: 'other name', albumId: 10, artistId: 1 },
        { id: 3, title: 't', artist: 'a', album: 'none' },
        { id: 4, title: 't', artist: 'b', album: 'al11', albumId: 11, artistId: 2 }]]] },
    shouldFallback: { run: shouldFallbackFromResponse, inputs: [
        ['https://custom.example', 429, ''], ['https://custom.example', 503, ''], ['https://music.binimum.org', 404, ''], ['https://custom.example', 404, ''],
        ['https://custom.example', 401, ''], ['https://arran.monochrome.tf', 403, ''], ['https://arran.monochrome.tf', 400, 'Upstream API error'],
        ['https://arran.monochrome.tf', 400, 'requiresAuth'], ['https://x.qqdl.site', 400, 'Logged-in users only'], ['https://arran.monochrome.tf', 400, 'bad request'],
        ['https://custom.example', 400, 'upstream error'], ['https://hifi.geeked.wtf', 200, 'INTERNAL SERVER ERROR']] },
    isHtml: { run: isHtmlResponse, inputs: [['text/html; charset=utf-8', '{}'], [null, '  <!doctype html><html>'], [null, '<html lang="en">'], ['application/json', '{"a":1}'], [null, '<!DOCTYPE html>'], ['TEXT/HTML', '']] },
    isReachable: { run: isReachableStatus, inputs: [[200], [404], [405], [401], [403], [499], [500], [502], [301]] },
    catalogUrl: { run: normalizeCatalogUrl, inputs: [[' https://a.example/// '], [{ url: 'http://b.example/x/' }], ['ftp://c.example'], ['https://api.squid.wtf'], [42], [{ url: 5 }], [null], [{}], ['HTTPS://Upper.example/']] },
    staticCatalog: { run: () => strip(buildStaticMirrorCatalog()), inputs: [[]] },
    remoteCatalog: { run: (payload: unknown) => strip(buildCatalogFromRemotePayload(payload)), inputs: [
        [null], [{ api: [] }], [{ api: [{ url: 'https://off.example', online: false }] }], ['text'],
        [{ api: ['https://a.example', { url: 'https://both.example', ms: 120 }],
            streaming: ['https://both.example/', { url: 'https://s.example', supportsSearch: true }],
            instances: [{ url: 'https://i.example', status: 'down' }, 'https://j.example'] }],
        [{ mirrors: [{ url: 'https://m.example', supportsStream: true, supportsDownload: true, ok: true }, { url: 'https://n.example', enabled: false }] }],
        [{ data: ['https://d1.example', 'https://d2.example'], api: ['https://d2.example'] }]] },
    capability: { run: (entry: unknown, capability: string) => isCapabilitySupported(entry as any, capability as any), inputs: [
        [null, 'download'], [{ supportsSearch: true, supportsStream: false, supportsDownload: false }, 'search'],
        [{ supportsSearch: true, supportsStream: false, supportsDownload: false }, 'stream'],
        [{ supportsSearch: true, supportsStream: true, supportsDownload: false }, 'download'],
        [{ supportsSearch: false, supportsStream: true, supportsDownload: true }, 'search']] },
    capabilityMessage: { run: capabilityErrorMessage, inputs: [['download'], ['stream'], ['search']] },
    resolveExtension: { run: resolveDownloadExtension, inputs: [
        [{ urls: [], isSegmented: true, mimeType: 'audio/mp4' }, 'https://x/seg.flac'], [{ urls: [], isSegmented: false }, 'https://x/a.flac?token=1'],
        [{ urls: [], isSegmented: false, mimeType: 'audio/flac' }, 'https://x/a.bin'], [{ urls: [], isSegmented: false }, 'https://x/a.M4A'],
        [{ urls: [], isSegmented: false, manifestUrl: 'https://x/b.mp3' }, null], [{ urls: [], isSegmented: false, mimeType: 'audio/mpeg' }, 'https://x/none'],
        [{ urls: [], isSegmented: false, codecs: 'mp4a.40.2' }, 'https://x/none'], [{ urls: [], isSegmented: false }, 'https://x/none'],
        [{ urls: [], isSegmented: false, codecs: 'flac' }, 'not a url.mp3'], [{ urls: [], isSegmented: false }, 'weird.mp4?x=1'],
        [{ urls: [], isSegmented: true, mimeType: 'audio/flac' }, 'https://x/a.flac']] },
    requiresFlac: { run: requiresFlacDownload, inputs: [['LOSSLESS'], ['HI_RES_LOSSLESS'], ['HIGH'], ['MP3'], ['LOW']] },
    directUrl: { run: getDirectUrl, inputs: [
        [{ urls: ['https://x/a.flac'], isSegmented: false }], [{ urls: ['https://x/a', 'https://x/b'], isSegmented: false }],
        [{ urls: ['https://x/a'], isSegmented: true }], [{ urls: ['file:///x'], isSegmented: false }], [{ urls: ['file:///x', 'HTTP://x/y'], isSegmented: false }]] },
    playableUrl: { run: getPlayableUrl, inputs: [
        [{ urls: ['https://x/a', 'https://x/b'], isSegmented: false, manifestUrl: 'https://x/m.mpd' }],
        [{ urls: [], isSegmented: false, manifestUrl: 'data:application/dash+xml;base64,AAA' }], [{ urls: ['https://x/a.flac'], isSegmented: false, manifestUrl: 'https://x/m' }], [{ urls: [], isSegmented: false }]] },
    dashForQuality: { run: parseDashManifestForQuality, inputs: [
        [dashInputs.tidalFlac, 'LOSSLESS'], [dashInputs.tidalFlac, 'HI_RES_LOSSLESS'], [dashInputs.tidalFlac, 'HIGH'], [dashInputs.tidalFlac, 'LOW'], [dashInputs.tidalFlac, 'UNKNOWN'],
        [rich, 'LOSSLESS'], [rich, 'HI_RES_LOSSLESS'], [rich, 'HIGH'], [rich, 'LOW'], [rich, 'MP3'],
        [dashInputs.noStartNumber, 'LOSSLESS'], [dashInputs.templateOnAdaptationSet, 'LOSSLESS'], [dashInputs.initOnly, 'LOSSLESS'],
        [dashInputs.noAudio, 'LOSSLESS'], [dashInputs.notXml, 'LOSSLESS'], [dashInputs.empty, 'LOSSLESS'], [dashInputs.noSegments, 'LOSSLESS']] },
    dashUrls: { run: parseDashManifest, inputs: [
        [dashInputs.tidalFlac], [dashInputs.noStartNumber], [rich], [dashInputs.notXml], [dashInputs.empty],
        ['<MPD><BaseURL>https://cdn.example/x</BaseURL><SegmentList initialization="init.mp4"><SegmentURL media="a.m4s"/><SegmentURL media="/b.m4s"/></SegmentList></MPD>'],
        ['<MPD><SegmentList><SegmentURL media="https://abs.example/1.m4s"/></SegmentList></MPD>'],
        ['<MPD><BaseURL>https://cdn.example/</BaseURL><SegmentTemplate initialization="i.mp4" media="n-$Number%03d$.m4s"><SegmentTimeline><S d="1" r="2"/><S d="1"/></SegmentTimeline></SegmentTemplate></MPD>'],
        ['<MPD><SegmentTemplate media="m$Number$.m4s" startNumber="10"><SegmentTimeline><S r="1"/></SegmentTimeline></SegmentTemplate></MPD>'],
        ['#EXTM3U\nhttps://cdn.example/a.flac?token=1\n"http://cdn.example/b.flac"'],
        ['<MPD><BaseURL>  https://cdn.example/spaced/  </BaseURL><SegmentList><SegmentURL media="s.m4s"/></SegmentList></MPD>']] },
    baseFilename: { run: getTrackBaseFilename, inputs: [
        [{ id: 1, title: 'Who?', artist: 'AC/DC', album: 'LP' }], [{ id: 5, title: '', artist: '', album: '' }], [{ id: 2, title: 'a'.repeat(200), artist: 'b', album: 'c' }],
        [{ id: 3, title: 'Tab\tand   spaces', artist: 'A|B', album: '<x>:"y"' }]] },
    safEntityName: { run: getSafEntityName, inputs: [
        ['content://x/tree/primary%3ADownload%2FStaySound'], ['content://x/document/primary%3ADownload%2FStaySound%2Fa.flac'], ['plain'], ['a:b:c'], ['x/y/']] },
    libraryTrack: { run: (track: any, uri: string) => { const { dateAdded: _ignored, ...rest } = toLibraryTrack(track, uri); return rest; }, inputs: [
        [{ id: 12, title: 'T', artist: 'A', album: 'L', durationMs: 1000, quality: 'LOSSLESS', albumId: 4, artworkUrl: 'u', trackNumber: 2, year: 2020, sampleRate: 44100, bitDepth: 16 }, 'file:///a/b.flac'],
        [{ id: 12, title: 'T', artist: 'A', album: 'L', durationMs: 1000, quality: 'LOSSLESS' }, 'file:///a/b.m4a'],
        [{ id: 12, title: 'T', artist: 'A', album: 'L', durationMs: 1000, quality: 'LOSSLESS', codec: 'alac' }, 'file:///a/b.mp3'],
        [{ id: 12, title: 'T', artist: 'A', album: 'L', durationMs: 1000, quality: 'LOSSLESS' }, 'file:///a/noext'],
        [{ id: 12, title: 'T', artist: 'A', album: 'L', durationMs: 1000, quality: 'LOSSLESS' }, 'content://x/y.WAV']] },
};

/** Volatile fields (timestamps) are not part of the contract. */
function strip(catalog: any) {
    if (!catalog) return catalog;
    const { fetchedAt: _ignored, ...rest } = catalog;
    return rest;
}

export function generate() {
    return {
        cases: Object.entries(fixtures).flatMap(([fn, { run, inputs }]) => inputs.map(input => {
            let expected: unknown;
            try { expected = run(...JSON.parse(JSON.stringify(input))) ?? null; } catch (error) { return { fn, input, error: String((error as Error).name) }; }
            return { fn, input, expected: expected === undefined ? null : expected };
        })),
    };
}
