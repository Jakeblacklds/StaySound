import { buildExistingByFilename, reconcileScannedTrack } from '../../src/services/scanReconcile';
import type { Track } from '../../src/types/audio';

const base = (id: string, uri: string, extra: Partial<Track> = {}): Track => ({
    id, uri, title: 'Unknown', artist: 'Unknown Artist', album: 'Unknown Album', duration: 200000, dateAdded: 1000, ...extra,
});
const ms = (n: number) => `content://media/external/audio/media/${n}`;
const saf = (name: string) => `content://com.android.externalstorage.documents/tree/primary%3ADownload%2FStaySound/document/primary%3ADownload%2FStaySound%2F${encodeURIComponent(name)}`;
const art = 'content://media/external/audio/albumart/77';

interface Case { name: string; existing: Track[]; scanned: Track[] }
export const cases: Case[] = [
    { name: 'fresh files are named from their file name', existing: [], scanned: [
        base('ms_1', ms(1), { _filename: 'Édith Piaf - La Vie - La vie en rose.flac' }),
        base('ms_2', ms(2), { _filename: 'Jay-Z - Song Two.MP3', title: 'Song Two' }),
        base('ms_3', ms(3), { _filename: '01 Only Title.m4a' }),
        base('ms_4', ms(4), { _filename: 'Artist – Album — Title – With - Dashes.opus' }),
        base('ms_5', ms(5), { _filename: '05. - Weird.wav' }),
        base('ms_6', ms(6), { _filename: '12345.mp3' }),
    ] },
    { name: 'parent folder becomes the album unless it is generic', existing: [], scanned: [
        base('f1', 'file:///storage/emulated/0/Music/Rock%20Classics/Riff.mp3'),
        base('f2', 'file:///storage/emulated/0/Download/Riff.mp3'),
        base('f3', 'file:///storage/emulated/0/Música/Riff.mp3'),
        base('f4', 'file:///Riff.mp3'),
        base('f5', 'Riff.mp3'),
    ] },
    { name: 'a stored SAF track keeps its metadata, artwork and favorite', existing: [
        base('saf_1', saf('Artist - Album - Title.flac'), { title: 'Real Title', artist: 'Real Artist', album: 'Real Album',
            artwork: 'https://img.example/a.jpg', artworkThumb: 'file:///thumb/a.jpg', favorite: true, year: 1999, quality: 'LOSSLESS', tidalId: 42 }),
    ], scanned: [
        base('ms_10', ms(10), { _filename: 'Artist - Album - Title.flac', artwork: art, title: 'Artist - Album - Title', album: 'StaySound', year: 0, sampleRate: 96000 }),
    ] },
    { name: 'a scanned real artwork replaces the stored one and drops its thumb', existing: [
        base('saf_2', saf('Some - Thing - Else.flac'), { title: 'Else', artist: 'Some', album: 'Thing', artwork: 'https://img.example/old.jpg', artworkThumb: 'file:///thumb/old.jpg' }),
    ], scanned: [
        base('ms_11', ms(11), { _filename: 'Some - Thing - Else.flac', artwork: 'file:///covers/new.jpg' }),
    ] },
    { name: 'stored empty artwork lets the scan win', existing: [
        base('saf_3', saf('Nobody - Nothing - Blank.flac'), { title: 'Blank', artist: 'Nobody', album: 'Nothing', artwork: '', artworkThumb: 'file:///thumb/x.jpg' }),
    ], scanned: [
        base('ms_12', ms(12), { _filename: 'Nobody - Nothing - Blank.flac' }),
    ] },
    { name: 'downloads match by the reconstructed sanitized name', existing: [
        base('tidal_1', 'content://tidal/opaque/1', { title: 'Who Made Who?', artist: 'AC/DC', album: 'Who: Made <Who>', source: 'tidal', tidalId: 9, favorite: false }),
    ], scanned: [
        base('ms_13', ms(13), { _filename: 'AC_DC - Who_ Made _Who_ - Who Made Who_.mp3', title: 'whatever' }),
    ] },
    { name: 'generic stored values do not overwrite the scan', existing: [
        base('e1', saf('Real Artist - Real Album - Real Title.mp3'), { title: 'Unknown Title', artist: 'STAYSOUND', album: 'Media' }),
    ], scanned: [
        base('ms_14', ms(14), { _filename: 'Real Artist - Real Album - Real Title.mp3' }),
    ] },
    { name: 'short or numeric stored names never match', existing: [
        base('e2', 'content://x/12345.mp3', { title: 'A', artist: 'B', album: 'C' }),
        base('e3', 'content://x/abc.mp3', { title: 'D', artist: 'E', album: 'F', favorite: true }),
    ], scanned: [
        base('ms_15', ms(15), { _filename: '12345.mp3' }),
        base('ms_16', ms(16), { _filename: 'abc.mp3' }),
    ] },
    { name: 'junk is dropped', existing: [], scanned: [
        base('j1', 'file:///storage/emulated/0/Android/data/app/cache/x/song.mp3'),
        base('j2', 'file:///storage/emulated/0/Music/StaySound/broken.flac', { duration: 0 }),
        base('j3', 'content://x/y', { source: 'tidal', duration: 0, _filename: 'ghost.m4a' }),
        base('j4', 'file:///cache/staysound/downloads/partial.flac'),
        base('ok1', 'file:///storage/emulated/0/Music/Other/zero.flac', { duration: 0 }),
        base('ok2', 'file:///storage/emulated/0/Music/StaySound/fine.flac', { duration: 1000 }),
        base('ok3', 'file:///storage/emulated/0/Music/StaySound/notaudio.txt', { duration: 0 }),
        base('ok4', 'content://x/y', { relativePath: 'Music\\StaySound\\', duration: 5, _filename: 'w.WAV' }),
    ] },
    { name: 'unicode spaces are trimmed like JavaScript does', existing: [
        base('u1', saf('N Artist - Album - Title.mp3'), { title: 'Title', artist: 'N Artist', album: 'Album', favorite: true }),
    ], scanned: [
        base('u2', ms(20), { _filename: ' N Artist - Album - Title.mp3﻿' }),
        base('u3', ms(21), { _filename: 'Ünï Çödé - Ålbum - Tïtle.flac' }),
    ] },
    { name: 'plus signs in URIs are not spaces', existing: [
        base('p1', 'content://x/Artist+-+Album+-+Title+Plus.flac', { title: 'T', artist: 'Artist', album: 'Album', favorite: true }),
    ], scanned: [
        base('p2', 'content://x/Artist+-+Album+-+Title+Plus.flac'),
    ] },
    { name: 'a later file with the same id replaces the earlier one in place', existing: [], scanned: [
        base('d1', ms(30), { _filename: 'A - B - One.mp3' }),
        base('d2', ms(31), { _filename: 'A - B - Two.mp3' }),
        base('d1', ms(30), { _filename: 'A - B - One Again.mp3' }),
    ] },
    { name: 'stored zero-like values fall back to scanned or stored', existing: [
        base('z1', saf('Zed - Zone - Zero.flac'), { title: 'Zero', artist: 'Zed', album: 'Zone', year: 2001, trackNumber: 3, genre: 'Jazz', bitDepth: 24, sampleRate: 48000,
            codec: 'flac', quality: 'HI_RES', source: 'tidal', tidalId: 5, tidalAlbumId: 6 }),
    ], scanned: [
        base('z2', ms(40), { _filename: 'Zed - Zone - Zero.flac', year: 0, trackNumber: 0, genre: '', bitDepth: 16, sampleRate: 0, codec: '', quality: '', source: '', tidalId: 0 }),
    ] },
];

export function generate() {
    return {
        cases: cases.map(({ name, existing, scanned }) => {
            const lookup = buildExistingByFilename(existing);
            const result = new Map<string, Track>();
            for (const track of scanned) {
                const reconciled = reconcileScannedTrack(track, lookup);
                if (reconciled) result.set(reconciled.id, reconciled);
            }
            return { name, existing, scanned, expected: Array.from(result.values()) };
        }),
    };
}
