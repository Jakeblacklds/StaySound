import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Golden fixtures pin a Kotlin port to the TypeScript it replaces: `entry` exports generate(), which runs the real
 * TypeScript over fixed cases; the JSON it returns is stored next to the Kotlin tests and compared there.
 * TZ is pinned so date-dependent TypeScript (year of a release date) is reproducible.
 */
export async function runGolden({ name, entry, target }, { check }) {
    process.env.TZ = 'UTC';
    const file = resolve(target);
    const directory = await mkdtemp(join(tmpdir(), `staysound-golden-${name}-`));
    try {
        const outfile = join(directory, 'cases.mjs');
        await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
        const { generate } = await import(pathToFileURL(outfile).href);
        const json = JSON.stringify(generate(), null, 1) + '\n';
        if (!check) { await writeFile(file, json); console.log(`golden ${name}: wrote ${target}`); return true; }
        const committed = await readFile(file, 'utf8').catch(() => '');
        if (committed === json) { console.log(`golden ${name}: up to date`); return true; }
        console.error(`golden ${name} is stale: the TypeScript it is generated from changed. Run node scripts/generate-goldens.mjs, then update the Kotlin port to match.`);
        return false;
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
