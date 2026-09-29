import { runTsTests } from './lib/run-ts-tests.mjs';

process.exitCode = await runTsTests('scripts/tests/android-shell.test.ts', 'shell-tests');
