import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('Android sends identity to native search and a fast wrong file cannot win', async () => {
  const mocks = {
    'expo-file-system/legacy': "export const documentDirectory = 'file:///test/';",
    'expo-constants': "export default { expoConfig: { extra: { soulseek: { username: 'test', password: 'test' } } } };",
    'react-native': "export const Platform = { OS: 'android' };",
    './storage': 'export const FileSystemStorage = { getItem: async () => null };',
    './tidalService': 'export const isValidAudioFile = () => true;',
    'soulseek-native': `
      export const isSoulseekNativeAvailable = () => true;
      export const cancelSoulseekNativeOperations = async () => {};
      export const downloadSoulseekNativeFile = async () => { throw new Error('Unexpected download'); };
      export const searchSoulseekNative = async (config, query) => {
        globalThis.__soulseekTestCalls.push({ config, query });
        return [
          { username: 'wrong', filename: 'Other Artist/Love Ive Found You.flac', size: 1000,
            slotsFree: true, speed: 100000000, queueLength: 0, durationMs: 215000 },
          { username: 'correct', filename: 'Rihanna/Talk That Talk/We Found Love (feat. Calvin Harris).flac',
            size: 28000000, slotsFree: false, speed: 100000, durationMs: 215000 }
        ];
      };
    `,
  };
  const result = await build({
    entryPoints: ['src/services/soulseekDownloadService.ts'], bundle: true, write: false,
    platform: 'node', format: 'esm', plugins: [{ name: 'native-test-boundary', setup(build) {
      build.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined);
      build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }],
  });
  globalThis.__soulseekTestCalls = [];
  try {
    const service = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    const match = await service.searchSoulseekTrack({ id: 1, title: 'We Found Love', artist: 'Rihanna',
      album: 'Talk That Talk', durationMs: 215000, quality: 'LOSSLESS' }, 'LOSSLESS');
    assert.equal(match.username, 'correct');
    assert.equal(globalThis.__soulseekTestCalls.length, 1);
    const call = globalThis.__soulseekTestCalls[0];
    assert.equal(call.query, 'rihanna we found love');
    assert.deepEqual(call.config.searchIdentity, { titleWords: ['found', 'love'], artistWords: ['rihanna'], extensions: ['flac', 'mp3'] });
  } finally { delete globalThis.__soulseekTestCalls; }
});

async function loadServiceWith(searchResults) {
  const mocks = {
    'expo-file-system/legacy': "export const documentDirectory = 'file:///test/';",
    'expo-constants': "export default { expoConfig: { extra: { soulseek: { username: 'test', password: 'test' } } } };",
    'react-native': "export const Platform = { OS: 'android' };",
    './storage': 'export const FileSystemStorage = { getItem: async () => null };',
    './tidalService': 'export const isValidAudioFile = () => true;',
    'soulseek-native': `
      export const isSoulseekNativeAvailable = () => true;
      export const cancelSoulseekNativeOperations = async () => {};
      export const downloadSoulseekNativeFile = async () => { throw new Error('Unexpected download'); };
      export const searchSoulseekNative = async (config, query) => {
        globalThis.__soulseekTestCalls.push({ config, query });
        return globalThis.__soulseekTestResults(query);
      };
    `,
  };
  const result = await build({
    entryPoints: ['src/services/soulseekDownloadService.ts'], bundle: true, write: false,
    platform: 'node', format: 'esm', plugins: [{ name: 'native-test-boundary', setup(build) {
      build.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined);
      build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }],
  });
  globalThis.__soulseekTestCalls = [];
  globalThis.__soulseekTestResults = searchResults;
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('a fast free MP3 never beats a FLAC for a lossless download', async () => {
  try {
    const service = await loadServiceWith(() => [
      { username: 'fastmp3', filename: 'Adele/25/01 Hello.mp3', size: 9000000, slotsFree: true, speed: 50000000, queueLength: 0, durationMs: 295000 },
      { username: 'slowflac', filename: 'Adele/25/01 Hello.flac', size: 30000000, slotsFree: true, speed: 200000, queueLength: 3, durationMs: 295000 },
      { username: 'queuedflac', filename: 'Adele/25/01 Hello.flac', size: 30000000, slotsFree: false, speed: 90000000, durationMs: 295000 },
    ]);
    const match = await service.searchSoulseekTrack({ id: 2, title: 'Hello', artist: 'Adele', album: '25', durationMs: 295000 }, 'LOSSLESS');
    assert.equal(match.username, 'slowflac');
    assert.equal(globalThis.__soulseekTestCalls.length, 1);
  } finally { delete globalThis.__soulseekTestCalls; delete globalThis.__soulseekTestResults; }
});

test('only MP3 on the first query spends the second query looking for FLAC', async () => {
  try {
    const service = await loadServiceWith(query => query === 'adele hello'
      ? [{ username: 'mp3', filename: 'Adele/Hello.mp3', size: 9000000, slotsFree: true, speed: 900000, durationMs: 295000 }]
      : [{ username: 'flac', filename: 'Adele/25/Hello.flac', size: 30000000, slotsFree: true, speed: 900000, durationMs: 295000 }]);
    const match = await service.searchSoulseekTrack({ id: 3, title: 'Hello', artist: 'Adele', album: '25', durationMs: 296000 }, 'LOSSLESS');
    assert.equal(match.username, 'flac');
    assert.deepEqual(globalThis.__soulseekTestCalls.map(call => call.query), ['adele hello', 'adele 25']);
  } finally { delete globalThis.__soulseekTestCalls; delete globalThis.__soulseekTestResults; }
});
