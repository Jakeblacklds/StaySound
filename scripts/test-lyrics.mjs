import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const directory = await mkdtemp(join(tmpdir(), 'staysound-lyrics-'));
try {
    const outfile = join(directory, 'tests.cjs');
    const stub = resolve('scripts/tests/helpers/lyrics-storage.ts');
    await build({ entryPoints: ['scripts/tests/lyrics.test.ts'], bundle: true, platform: 'node', format: 'cjs', outfile,
        plugins: [{ name: 'native-storage-test-double', setup(build) {
            build.onResolve({ filter: /^karaoke-view$/ }, () => ({ path: stub }));
            build.onResolve({ filter: /^\.\/storage$/ }, args => args.importer.endsWith('/lyricsRepository.ts') ? { path: stub } : undefined);
        } }],
    });
    process.exitCode = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' }).status ?? 1;
} finally {
    await rm(directory, { recursive: true, force: true });
}
