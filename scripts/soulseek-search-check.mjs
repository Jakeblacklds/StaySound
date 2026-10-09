#!/usr/bin/env node
// One-shot Soulseek search check, independent of the StaySound app: logs in
// once (with the same slsk-client the desktop bridge uses), runs ONE search,
// prints how many files/users answered, then logs out. Use it to tell "the
// network has nothing for this query" apart from "the app is not seeing it".
// Usage: node scripts/soulseek-search-check.mjs <usuario> "<búsqueda>"
// Run it sparingly — repeated logins/searches are what trigger Soulseek bans.
import readline from 'node:readline';
import slsk from 'slsk-client';

const [user, query] = process.argv.slice(2);
if (!user || !query) {
  console.error('Uso: node scripts/soulseek-search-check.mjs <usuario> "<búsqueda>"');
  process.exit(2);
}

function askHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = text => { if (text.startsWith(question)) rl.output.write(question); };
  return new Promise(resolve => rl.question(question, answer => {
    rl.close(); process.stdout.write('\n'); resolve(answer.trim());
  }));
}

const pass = await askHidden('Contraseña (no se muestra): ');
console.log('Conectando…');
slsk.connect({ user, pass, timeout: 10_000, sharedFolders: [], incomingPort: 2236 }, (error, client) => {
  if (error) {
    console.error(`❌ Login falló: ${error.message}`);
    process.exit(1);
  }
  console.log(`✅ Conectado. Buscando "${query}" durante 18 s…`);
  const startedAt = Date.now();
  let firstAt = 0;
  client.on(`found:${query}`, () => { if (!firstAt) firstAt = Date.now(); });
  client.search({ req: query, timeout: 18_000 }, (searchError, results) => {
    if (searchError) {
      console.error(`❌ Búsqueda falló: ${searchError.message}`);
    } else {
      const users = new Set(results.map(item => item.user));
      const audio = results.filter(item => /\.(flac|mp3|m4a|ogg|opus|wav)$/i.test(item.file ?? ''));
      console.log(`\nArchivos: ${results.length} (audio: ${audio.length}) de ${users.size} usuarios`);
      if (firstAt) console.log(`Primera respuesta a los ${((firstAt - startedAt) / 1000).toFixed(1)} s`);
      for (const item of audio.slice(0, 8)) console.log(`  · ${item.user}: ${String(item.file).split(/[\\/]/).slice(-2).join(' / ')}`);
    }
    try { client.destroy(); } catch {}
    setTimeout(() => process.exit(0), 300);
  });
});
