// Regenerates (or, with --check, verifies) every golden fixture that pins a Kotlin port to its TypeScript source.
//   node scripts/generate-goldens.mjs [--check] [scan|tidal|icons]
import { runGolden } from './lib/golden.mjs';

const goldens = [
    { name: 'scan', entry: 'scripts/tests/scan-golden-cases.ts', target: 'android-core/model/src/test/resources/scan-golden.json' },
    { name: 'tidal', entry: 'scripts/tests/tidal-golden-cases.ts', target: 'android-core/tidal/src/test/resources/tidal-golden.json' },
    { name: 'icons', entry: 'scripts/tests/stay-icons-golden-cases.ts', target: 'modules/player-chrome/android/src/test/resources/stay-icons-golden.txt' },
];
const only = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const check = process.argv.includes('--check');
let ok = true;
for (const golden of goldens.filter(g => only.length === 0 || only.includes(g.name))) ok = (await runGolden(golden, { check })) && ok;
process.exitCode = ok ? 0 : 1;
