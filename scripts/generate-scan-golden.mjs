// Runs the real TypeScript scan reconciliation over fixed cases and stores the result for the Kotlin port to match.
//   node scripts/generate-scan-golden.mjs          rewrite the golden file
//   node scripts/generate-scan-golden.mjs --check  fail if the TypeScript no longer matches the committed golden
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const target = resolve('android-core/model/src/test/resources/scan-golden.json');
const directory = await mkdtemp(join(tmpdir(), 'staysound-scan-golden-'));
try {
    const outfile = join(directory, 'cases.mjs');
    await build({ entryPoints: ['scripts/tests/scan-golden-cases.ts'], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
    const { generate } = await import(pathToFileURL(outfile).href);
    const json = JSON.stringify(generate(), null, 1) + '\n';
    if (process.argv.includes('--check')) {
        const committed = await readFile(target, 'utf8').catch(() => '');
        if (committed !== json) {
            console.error('scan-golden.json is stale: scanReconcile.ts changed. Run node scripts/generate-scan-golden.mjs and update ScanReconciler.kt to match.');
            process.exitCode = 1;
        } else console.log('scan-golden.json matches scanReconcile.ts');
    } else {
        await writeFile(target, json);
        console.log(`wrote ${target}`);
    }
} finally {
    await rm(directory, { recursive: true, force: true });
}
