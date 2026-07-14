#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

const children = new Set();

let opened = false;

function maybeOpenFromOutput(text) {
  if (opened) return;
  const match = text.match(/Local:\s+(https?:\/\/localhost:\d+\/?)/);
  if (!match) return;
  opened = true;
  openUrl(match[1]);
}

function run(name, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  children.add(child);
  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    process.stdout.write(`[${name}] ${text}`);
    if (name === 'web') maybeOpenFromOutput(text);
  });
  child.stderr.on('data', chunk => {
    process.stderr.write(`[${name}] ${chunk}`);
  });
  child.on('exit', code => {
    children.delete(child);
    if (code && code !== 0) {
      console.error(`[${name}] salio con codigo ${code}`);
    }
  });

  return child;
}

function openUrl(url) {
  const opener = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];

  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
}

function cleanup() {
  for (const child of children) {
    child.kill('SIGTERM');
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
process.on('exit', cleanup);

run('soulseek', 'node', ['./scripts/staysound-soulseek-bridge.mjs']);
run('web', 'npx', ['vite', '--config', 'web/vite.config.ts', '--host', '127.0.0.1']);

console.log('StaySound Web local iniciando...');
console.log('Cierra esta ventana para apagar StaySound Web local.');
