#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { exec as packageExecutable } from '@yao-pkg/pkg';

const root = process.cwd();
const tempDir = path.join(root, '.desktop-sidecar');
const binariesDir = path.join(root, 'src-tauri', 'binaries');
const bundledEntry = path.join(tempDir, 'staysound-soulseek-bridge.cjs');
const extension = process.platform === 'win32' ? '.exe' : '';
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE
  || execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
const output = path.join(binariesDir, `staysound-soulseek-bridge-${targetTriple}${extension}`);

fs.mkdirSync(tempDir, { recursive: true });
fs.mkdirSync(binariesDir, { recursive: true });

await build({
  entryPoints: [path.join(root, 'scripts', 'staysound-soulseek-bridge.mjs')],
  outfile: bundledEntry,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
});

await packageExecutable([
  bundledEntry,
  '--target',
  'host',
  '--output',
  output,
  '--compress',
  'GZip',
]);

if (process.platform !== 'win32') fs.chmodSync(output, 0o755);
console.log(`[StaySound Desktop] Soulseek sidecar: ${output}`);
