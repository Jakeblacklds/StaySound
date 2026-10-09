import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Bundles a TypeScript test with esbuild and runs it with node:test. Only for modules free of React Native imports. */
export async function runTsTests(entry, label = 'tests') {
    const directory = await mkdtemp(join(tmpdir(), `staysound-${label}-`));
    try {
        const outfile = join(directory, 'tests.cjs');
        await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'warning' });
        const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
        return result.status ?? 1;
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
