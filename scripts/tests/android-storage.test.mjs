import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

async function adapter(native, fallback) {
  const result = await build({
    entryPoints: ['src/services/storage.android.ts'], bundle: true, write: false, format: 'cjs', platform: 'node',
    plugins: [{ name: 'storage-test-boundary', setup(build) {
      build.onResolve({ filter: /^(expo-modules-core|\.\/storage\.legacy)$/ }, args => ({ path: args.path, external: true }));
    } }],
  });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: name => {
    if (name === 'expo-modules-core') return { requireOptionalNativeModule: () => native };
    if (name === './storage.legacy') return { FileSystemStorage: fallback };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return module.exports.FileSystemStorage;
}
test('new Android builds use only the Kotlin storage authority', async () => {
  const calls = [];
  const storage = await adapter({
    getItem: async name => { calls.push(['get', name]); return 'native'; },
    setItem: async (name, value) => calls.push(['set', name, value]),
    removeItem: async name => calls.push(['remove', name]),
  }, { setItem: () => assert.fail('Legacy writer used') });
  assert.equal(await storage.getItem('library'), 'native');
  await storage.setItem('library', '{}'); await storage.removeItem('library');
  assert.deepEqual(calls, [['get', 'library'], ['set', 'library', '{}'], ['remove', 'library']]);
});
test('a rejected authority never falls back to writing legacy JSON', async () => {
  const storage = await adapter({ setItem: async () => { throw new Error('Native owner active'); } }, {
    setItem: () => assert.fail('Split brain: legacy fallback wrote a second copy'),
  });
  await assert.rejects(storage.setItem('library', '{}'), /Native owner active/);
});
test('older APKs without the new module retain their previous adapter', async () => {
  const fallback = { getItem: async () => 'legacy' };
  assert.equal(await (await adapter(null, fallback)).getItem('library'), 'legacy');
});
