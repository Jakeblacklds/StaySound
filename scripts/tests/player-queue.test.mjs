import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';

// Exercise the real Zustand action AND native queue adapter, replacing only the
// device boundary. No emulator is needed to catch a UI-only enqueue regression.
const root = path.resolve(import.meta.dirname, '../..');
const mocks = {
  'react-native-reanimated': 'export const makeMutable = value => ({ value });',
  'expo-file-system': 'export const getInfoAsync = async () => ({ exists: true });',
  'nativeLibraryPlayback': 'export const getNativeLibraryPlayback = () => null;',
  'nativeLibraryIndexer': 'export const resolveContentUriToFileUriNative = async () => null;',
  'artworkThumbnails': 'export const getArtworkNotificationUri = async () => undefined;',
  'fileScanner': 'export const extractMetadata = async () => ({}); export const findArtworkInFolder = async () => null; export const withTimeout = x => x;',
  'storage': 'export const FileSystemStorage = { getItem: () => null, setItem() {}, removeItem() {} };',
  'performanceProfile': 'export const getPerformanceProfile = () => ({ queueContextLimit: 700 });',
  'settingsStore': 'export const useSettingsStore = { getState: () => ({ language: "es" }) };',
  'libraryStore': 'export const useLibraryStore = { getState: () => ({ tracks: new Map(), albums: new Map() }) };',
  'audioEngine': `import { appendToNativeQueue } from ${JSON.stringify(path.join(root, 'src/services/trackPlayerService.ts'))};
    export const AudioEngine = { appendToQueue: appendToNativeQueue };`,
  'react-native-track-player': `
    export const TrackType = {}, AppKilledPlaybackBehavior = {}, Capability = {}, Event = {}, RepeatMode = {}, State = {};
    export default {
      setupPlayer: async () => {}, updateOptions: async () => {},
      getQueue: async () => globalThis.__queueRig.native.slice(),
      add: async tracks => {
        const rig = globalThis.__queueRig;
        if (rig.beforeAdd) await rig.beforeAdd();
        if (rig.failAdd) throw Error('Native enqueue failed');
        rig.calls.push('add'); rig.native.push(...tracks);
      },
      remove: async indices => {
        const rig = globalThis.__queueRig;
        if (rig.failRemove) { rig.failRemove = false; throw Error('Native remove failed'); }
        rig.calls.push('remove');
        for (const i of [...indices].sort((a,b) => b-a)) rig.native.splice(i, 1);
      },
      reset: async () => { throw Error('Enqueue must never reset playback'); },
      play: async () => { throw Error('Enqueue must never resume paused playback'); },
      skip: async () => { throw Error('Enqueue must never skip the current track'); },
    };`,
};
const result = await build({
  stdin: { contents: `export { usePlayerStore } from './src/stores/playerStore';
    export { useNotificationStore } from './src/stores/notificationStore';`, resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'device-boundary', setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      const key = args.path.replace(/^.*\//, '').replace(/\.ts$/, '');
      if (mocks[args.path] || mocks[key]) return { path: mocks[args.path] ? args.path : key, namespace: 'mock' };
    });
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], resolveDir: root }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { usePlayerStore, useNotificationStore } = module.exports;
const track = id => ({ id, title: id, artist: 'Artist', album: 'Album', uri: `file:///music/${id}.mp3`, format: 'mp3', duration: 120000 });
const ids = list => list.map(item => item.id);
const seed = (tracks, index = 0) => {
  usePlayerStore.getState().setQueue(tracks, index);
  usePlayerStore.setState({ currentTrack: tracks[index] ?? null, isPlaying: true, position: 42000 });
  globalThis.__queueRig.native = tracks.map(item => ({ ...item, url: item.uri }));
};
beforeEach(() => {
  globalThis.__queueRig = { native: [], calls: [], failAdd: false, failRemove: false };
  usePlayerStore.setState(usePlayerStore.getInitialState());
  useNotificationStore.setState(useNotificationStore.getInitialState());
  seed([track('playing'), track('next')]);
});

test('append reaches the native engine, preserving current song and progress', async () => {
  assert.equal(await usePlayerStore.getState().addToQueue(track('added')), true);
  assert.deepEqual(ids(globalThis.__queueRig.native), ['playing', 'next', 'added']);
  assert.deepEqual(ids(usePlayerStore.getState().queue), ['playing', 'next', 'added']);
  assert.equal(usePlayerStore.getState().currentTrack.id, 'playing');
  assert.equal(usePlayerStore.getState().position, 42000);
  assert.equal(usePlayerStore.getState().isPlaying, true);
  assert.deepEqual(globalThis.__queueRig.calls, ['add']);
});
test('enqueue while paused leaves playback paused', async () => {
  usePlayerStore.setState({ isPlaying: false });
  await usePlayerStore.getState().addToQueue(track('added'));
  assert.equal(usePlayerStore.getState().isPlaying, false);
  assert.equal(usePlayerStore.getState().position, 42000);
});
test('rapid additions and repeated songs retain their requested order', async () => {
  const add = usePlayerStore.getState().addToQueue;
  assert.deepEqual(await Promise.all([add(track('a')), add(track('b')), add(track('a'))]), [true, true, true]);
  assert.deepEqual(ids(globalThis.__queueRig.native), ['playing', 'next', 'a', 'b', 'a']);
  assert.deepEqual(ids(usePlayerStore.getState().queue), ids(globalThis.__queueRig.native));
});
test('native failure leaves the visible queue unchanged and allows retry', async () => {
  globalThis.__queueRig.failAdd = true;
  assert.equal(await usePlayerStore.getState().addToQueue(track('added')), false);
  assert.deepEqual(ids(usePlayerStore.getState().queue), ['playing', 'next']);
  assert.equal(useNotificationStore.getState().type, 'error');
  globalThis.__queueRig.failAdd = false;
  assert.equal(await usePlayerStore.getState().addToQueue(track('added')), true);
});
test('unresolved remote tracks cannot report success', async () => {
  assert.equal(await usePlayerStore.getState().addToQueue({ ...track('remote'), cloudOnly: true, uri: '' }), false);
  assert.deepEqual(globalThis.__queueRig.calls, []);
  assert.deepEqual(ids(usePlayerStore.getState().queue), ['playing', 'next']);
});
test('a replaced native queue rejects stale additions instead of modifying the new session', async () => {
  globalThis.__queueRig.native = [track('another-session')];
  assert.equal(await usePlayerStore.getState().addToQueue(track('added')), false);
  assert.deepEqual(ids(globalThis.__queueRig.native), ['another-session']);
});
test('bounded queues discard played history without losing the active song', async () => {
  seed(Array.from({ length: 500 }, (_, i) => track(String(i))), 250);
  assert.equal(await usePlayerStore.getState().addToQueue(track('added')), true);
  const state = usePlayerStore.getState();
  assert.equal(state.queue.length, 500);
  assert.equal(state.queueIndex, 249);
  assert.equal(state.queue[state.queueIndex].id, '250');
  assert.equal(state.queue.at(-1).id, 'added');
  assert.deepEqual(ids(state.queue), ids(globalThis.__queueRig.native));
});
test('failed capacity trimming rolls back the native append', async () => {
  seed(Array.from({ length: 500 }, (_, i) => track(String(i))), 250);
  globalThis.__queueRig.failRemove = true;
  assert.equal(await usePlayerStore.getState().addToQueue(track('added')), false);
  assert.deepEqual(ids(usePlayerStore.getState().queue), ids(globalThis.__queueRig.native));
});
test('an empty queue accepts the first song without starting playback', async () => {
  seed([], -1); usePlayerStore.setState({ isPlaying: false });
  assert.equal(await usePlayerStore.getState().addToQueue(track('first')), true);
  assert.deepEqual(ids(globalThis.__queueRig.native), ['first']);
  assert.equal(usePlayerStore.getState().isPlaying, false);
});
