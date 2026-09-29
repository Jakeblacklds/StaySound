import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Verify Metro's actual platform resolution, not just TypeScript's file selection.
const path = process.argv[2] ?? 'android/app/build/generated/sourcemaps/react/devDebug/index.android.bundle.map';
const { sources } = JSON.parse(await readFile(path, 'utf8'));
assert(sources.some(source => source.endsWith('/src/AppRoot.android.tsx')), 'Android native entry missing');
assert(sources.some(source => source.endsWith('/src/navigation/navigation.android.ts')), 'Native navigation adapter missing');
assert(!sources.some(source => source.endsWith('/src/AppRoot.tsx')), 'ExpoRoot entry included on Android');
assert(!sources.some(source => source.endsWith('/src/navigation/navigation.ts')), 'Generic navigation adapter selected on Android');
assert(!sources.some(source => source.includes('/expo-router/')), 'Expo Router is still included in the Android dependency graph');
console.log('Android bundle: Kotlin entry and adapter selected; no Expo Router modules.');
