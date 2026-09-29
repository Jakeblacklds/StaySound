#!/usr/bin/env node
// One-shot Soulseek login check: tells whether the server accepts this
// account from this IP, and prints the server's excluded search phrases
// (artists/phrases other clients hide from search results). Sends exactly one
// login, no searches, then logs out.
// Usage: node scripts/soulseek-login-check.mjs [usuario] [frase a comprobar]
// Run it sparingly — repeated logins are what trigger Soulseek bans.
import crypto from 'node:crypto';
import net from 'node:net';
import readline from 'node:readline';

const HOST = process.env.SOULSEEK_SERVER_HOST || 'server.slsknet.org';
const PORT = Number.parseInt(process.env.SOULSEEK_SERVER_PORT ?? '2242', 10);

function ask(question, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    rl._writeToOutput = text => {
      if (text.startsWith(question)) rl.output.write(question);
    };
  }
  return new Promise(resolve => rl.question(question, answer => {
    rl.close();
    if (hidden) process.stdout.write('\n');
    resolve(answer.trim());
  }));
}

function str(value) {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function loginPacket(user, pass) {
  const body = Buffer.concat([
    u32(1),
    str(user),
    str(pass),
    u32(160),
    str(crypto.createHash('md5').update(user + pass).digest('hex')),
    u32(1026), // StaySound's client minor version
  ]);
  return Buffer.concat([u32(body.length), body]);
}

const EXPLANATIONS = {
  INVALIDPASS: 'Contraseña incorrecta para esa cuenta (no es un bloqueo).',
  INVALIDUSERNAME: 'Nombre de usuario no válido.',
  EMPTYPASSWORD: 'La contraseña está vacía.',
  INVALIDVERSION: 'El servidor rechaza la versión de cliente que anunciamos.',
  SVRFULL: 'El servidor está lleno; inténtalo más tarde.',
  SVRPRIVATE: 'El servidor solo acepta cuentas existentes ahora mismo.',
};

const user = process.argv[2] || await ask('Usuario Soulseek: ');
const probePhrase = (process.argv[3] || '').trim().toLowerCase();
const pass = await ask('Contraseña (no se muestra): ', true);
if (!user || !pass) {
  console.error('Faltan usuario o contraseña.');
  process.exit(2);
}

console.log(`Conectando a ${HOST}:${PORT}…`);
const socket = net.createConnection({ host: HOST, port: PORT });
let buffer = Buffer.alloc(0);
let answered = false;
let loggedIn = false;

function reportExcluded(phrases) {
  console.log(`\nFrases excluidas por el servidor: ${phrases.length}`);
  if (probePhrase) {
    const hits = phrases.filter(phrase => probePhrase.includes(phrase) || phrase.includes(probePhrase));
    console.log(hits.length
      ? `⚠️  "${probePhrase}" está filtrada (coincide con: ${hits.join(', ')}). Casi nadie devolverá esos archivos.`
      : `"${probePhrase}" NO está en la lista.`);
  } else {
    console.log(phrases.join(' · '));
  }
}

const finish = (code, message) => {
  if (answered) return;
  answered = true;
  if (message) console.log(message);
  socket.destroy();
  process.exit(code);
};

socket.setTimeout(20_000, () => finish(3, 'Sin respuesta en 20 s: el servidor ignora el login (posible bloqueo o lentitud).'));
socket.on('connect', () => socket.write(loginPacket(user, pass)));
socket.on('error', error => finish(3, `Error de red: ${error.message}`));
socket.on('close', () => finish(loggedIn ? 0 : 4, loggedIn
  ? '\n(El servidor cerró la sesión antes de enviar la lista de frases excluidas.)'
  : 'El servidor cerró la conexión sin responder al login. Eso suele indicar un bloqueo de la cuenta o de la IP.'));
socket.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 8) {
    const size = buffer.readUInt32LE(0);
    if (buffer.length < 4 + size) return;
    const packet = buffer.subarray(4, 4 + size);
    buffer = buffer.subarray(4 + size);
    const code = packet.readUInt32LE(0);
    if (code === 160 && loggedIn) {
      // ExcludedSearchPhrases: uint32 count, then that many strings.
      const phrases = [];
      let offset = 8;
      const count = packet.readUInt32LE(4);
      for (let i = 0; i < count && offset + 4 <= packet.length; i += 1) {
        const length = packet.readUInt32LE(offset);
        phrases.push(packet.subarray(offset + 4, offset + 4 + length).toString('utf8').toLowerCase());
        offset += 4 + length;
      }
      reportExcluded(phrases);
      finish(0, '');
      return;
    }
    if (code !== 1) continue;

    const success = packet.readUInt8(4) === 1;
    const textLength = packet.readUInt32LE(5);
    const text = packet.subarray(9, 9 + textLength).toString('utf8');
    if (success) {
      const ipOffset = 9 + textLength;
      const ip = packet.length >= ipOffset + 4
        ? [3, 2, 1, 0].map(i => packet[ipOffset + i]).join('.')
        : 'desconocida';
      console.log(`✅ Login aceptado. La cuenta y la IP (${ip}) NO están bloqueadas.`);
      loggedIn = true;
      // The excluded-phrases list follows the login; give it a few seconds.
      setTimeout(() => finish(0, '\n(El servidor no envió la lista de frases excluidas.)'), 8_000);
    } else {
      const explanation = EXPLANATIONS[text.toUpperCase()] ?? 'Motivo no estándar: probablemente un bloqueo; léelo con atención.';
      finish(1, `❌ Login rechazado: "${text}"\n${explanation}`);
    }
  }
});
