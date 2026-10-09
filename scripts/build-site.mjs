// Builds what staysound.vercel.app serves: the landing at "/" and the web app at "/app".
//
// The app's files stay where Vite puts them (absolute /assets, service workers at the root
// scope); only its index.html moves to /app. The landing's static export is then laid over
// the same folder. Desktop (Tauri) keeps using the plain `web:build` output.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'web/dist');
const LANDING = path.join(ROOT, 'sites/landing');
const EXPORT = path.join(LANDING, 'out');
// Pages the landing owns; any other name the app already ships wins.
const LANDING_PAGES = new Set(['index.html', '404.html']);

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? 'no status'})`);
}

function overlay(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) overlay(source, target);
    else if (!fs.existsSync(target) || (to === DIST && LANDING_PAGES.has(entry.name))) fs.copyFileSync(source, target);
  }
}

run('npm', ['run', 'web:build']);
if (!fs.existsSync(path.join(LANDING, 'node_modules/next'))) run('npm', ['ci', '--no-audit', '--no-fund'], LANDING);
run('npx', ['next', 'build'], LANDING);

fs.mkdirSync(path.join(DIST, 'app'), { recursive: true });
fs.renameSync(path.join(DIST, 'index.html'), path.join(DIST, 'app/index.html'));
overlay(EXPORT, DIST);
console.log('site: landing at /, web app at /app');
