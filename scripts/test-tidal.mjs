import { runTsTests } from './lib/run-ts-tests.mjs';

process.exitCode = await runTsTests('scripts/tests/tidal-pure.test.ts', 'tidal-tests');
