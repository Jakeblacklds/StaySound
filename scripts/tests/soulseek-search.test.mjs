import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { createSearchRecovery } from '../lib/soulseek-search-recovery.mjs';
import { rankSoulseekResults } from '../lib/soulseek-result-ranking.mjs';

const source = await readFile(new URL('../../src/services/soulseekSearch.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { soulseekSearchQueries, isSoulseekTrackCandidate, soulseekCoreTitle } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const track = { title: 'Thnks fr th Mmrs', artist: 'Fall Out Boy', album: 'Believers Never Die - Greatest Hits' };

test('We Found Love preserves we and unrelated fast peers cannot fill the result cap', () => {
  assert.equal(soulseekSearchQueries({ title: 'We Found Love', artist: 'Rihanna' })[0].query, 'rihanna we found love');
  const unrelated = Array.from({ length: 100 }, (_, i) => ({ username: String(i), filename: "Other Artist/Love I've Found You.mp3", slots: true, speed: 1000000 }));
  const correct = { username: 'correct', filename: 'Rihanna/Talk That Talk/We Found Love (feat. Calvin Harris).flac', slots: false, speed: 1000 };
  const identity = { titleWords: ['found', 'love'], artistWords: ['rihanna'] };
  assert.deepEqual(rankSoulseekResults(unrelated, 60, identity), []);
  assert.deepEqual(rankSoulseekResults([...unrelated, correct], 60, identity), [correct]);
});

test('unrelated peer replies do not trigger session recovery', async () => {
  const recover = createSearchRecovery();
  const results = [];
  results.rawResultCount = 100;
  const client = {};
  const options = { client, search: async () => results, canReconnect: () => true,
    reconnect: async () => { assert.fail('live peer responses must not cause a reconnect'); } };
  await recover({ ...options, query: 'first' });
  await recover({ ...options, query: 'second' });
});

test('artist + full title first, then the distinctive title alone, at most two queries', () => {
  assert.deepEqual(soulseekSearchQueries(track).map(item => item.query), [
    'fall out boy thnks fr th mmrs', 'thnks mmrs',
  ]);
  assert.deepEqual(soulseekSearchQueries({ ...track, album: track.title }).map(item => item.query), ['fall out boy thnks fr th mmrs', 'thnks mmrs']);
  assert.equal(soulseekSearchQueries({ title: 'Up', artist: 'R.E.M.' })[0].query, 'r e m up');
  assert.equal(soulseekSearchQueries({ title: "Sugar, We're Goin Down", artist: track.artist })[0].query, 'fall out boy sugar we re goin down');
  assert.deepEqual(soulseekSearchQueries({ title: 'Hello', artist: 'Adele', album: '25' }).map(item => item.query), ['adele hello', 'adele 25']);
});

test('catalog decorations are dropped from queries and identity, real versions are kept', () => {
  assert.equal(soulseekCoreTitle('Here Comes The Sun (Remastered 2009)'), 'Here Comes The Sun');
  assert.equal(soulseekCoreTitle('Hey Jude - Remastered 2015'), 'Hey Jude');
  assert.equal(soulseekCoreTitle('Peaches (feat. Daniel Caesar & Giveon)'), 'Peaches');
  assert.equal(soulseekCoreTitle('Stay (with Justin Bieber)'), 'Stay');
  assert.equal(soulseekCoreTitle('DtMF (Live)'), 'DtMF (Live)');
  assert.equal(soulseekCoreTitle("Love Story (Taylor's Version)"), "Love Story (Taylor's Version)");
  const beatles = { title: 'Here Comes The Sun (Remastered 2009)', artist: 'The Beatles' };
  assert.equal(soulseekSearchQueries(beatles)[0].query, 'the beatles here comes the sun');
  assert.equal(isSoulseekTrackCandidate(beatles, 'The Beatles/Abbey Road/07 Here Comes The Sun.flac'), true);
  assert.equal(isSoulseekTrackCandidate({ title: 'DtMF (Live)', artist: 'Bad Bunny' }, 'Bad Bunny/DtMF.flac'), false);
});

test('album responses must match the song and artist before availability can rank them', () => {
  assert.equal(isSoulseekTrackCandidate(track, 'Fall Out Boy/Infinity On High/07 - Thnks Fr Th Mmrs.flac'), true);
  assert.equal(isSoulseekTrackCandidate(track, 'Fall Out Boy/Believers Never Die/01 - Dance Dance.flac'), false);
  assert.equal(isSoulseekTrackCandidate(track, 'Other Artist/Thnks fr th Mmrs.mp3'), false);
  assert.equal(isSoulseekTrackCandidate(track, 'Fall Out Boy - Thnks fr th Mmrs/drums_4.ogg'), false);
});

function fixture() {
  let time = 0;
  let client = {};
  let busy = false;
  let reconnects = 0;
  let calls = 0;
  let results = [];
  const recover = createSearchRecovery({ now: () => time, cooldownMs: 60_000 });
  return {
    run: query => recover({ client, query,
      search: async () => { calls++; return results; },
      reconnect: async () => { reconnects++; client = {}; return client; },
      canReconnect: () => !busy,
    }),
    get reconnects() { return reconnects; },
    get calls() { return calls; },
    set busy(value) { busy = value; },
    set results(value) { results = value; },
    advance: () => { time += 60_000; },
  };
}

test('two different empty searches trigger exactly one reconnect and retry', async () => {
  const f = fixture();
  await f.run('thnks mmrs');
  await f.run(' THNKS   MMRS ');
  assert.equal(f.reconnects, 0);
  await f.run('fall out boy believers never die');
  assert.equal(f.reconnects, 1);
  assert.equal(f.calls, 4);
  await f.run('third');
  await f.run('fourth');
  assert.equal(f.reconnects, 1);
  f.advance();
  await f.run('fifth');
  assert.equal(f.reconnects, 2);
});

test('successful searches clear the empty streak', async () => {
  const f = fixture();
  await f.run('missing');
  f.results = [{ filename: 'found.flac' }];
  assert.equal((await f.run('found')).length, 1);
  f.results = [];
  await f.run('another missing');
  assert.equal(f.reconnects, 0);
});

test('recovery does not interrupt active transfers', async () => {
  const f = fixture();
  f.busy = true;
  await f.run('first');
  await f.run('second');
  assert.equal(f.reconnects, 0);
  f.busy = false;
  await f.run('third');
  assert.equal(f.reconnects, 1);
});

test('returns results from the recovered session without another search loop', async () => {
  const recover = createSearchRecovery();
  const oldClient = {};
  const newClient = {};
  const matches = [{ filename: 'Fall Out Boy/Thnks Fr Th Mmrs.mp3' }];
  const options = { client: oldClient, search: async client => client === newClient ? matches : [],
    canReconnect: () => true, reconnect: async () => newClient };
  await recover({ ...options, query: 'first' });
  assert.deepEqual(await recover({ ...options, query: 'second' }), matches);
});

test('desktop ranking: free slot first, then FLAC before a faster MP3', () => {
  const identity = { titleWords: ['hello'], artistWords: ['adele'] };
  const mp3 = { username: 'mp3', filename: 'Adele/25/Hello.mp3', extension: 'mp3', slots: true, size: 9e6, speed: 5e7 };
  const flac = { username: 'flac', filename: 'Adele/25/Hello.flac', extension: 'flac', slots: true, size: 3e7, speed: 2e5 };
  const queued = { username: 'queued', filename: 'Adele/25/Hello.flac', extension: 'flac', slots: false, size: 3e7, speed: 9e7 };
  assert.deepEqual(rankSoulseekResults([queued, mp3, flac], 10, identity).map(item => item.username), ['flac', 'mp3', 'queued']);
});
