import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const slsk = require('slsk-client');
const Message = require('slsk-client/lib/message');
const Messages = require('slsk-client/lib/messages');
const factory = require('slsk-client/lib/message-factory');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function fixture(t, indirect) {
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); return socket; };
  let incomingPort;
  let searchToken;
  const response = () => factory.to.peer.fileSearchResult([
    { value: { file: 'Coldplay\\A Head Full of Dreams.flac', size: 1000 } },
  ], searchToken, 'source', { slots: true, speed: 10000 }).getBuff();
  const remote = net.createServer(socket => {
    track(socket);
    const messages = new Messages();
    socket.on('data', data => messages.write(data));
    messages.once('message', msg => {
      msg.int32();
      assert.equal(msg.int8(), 0, 'indirect connection must acknowledge PierceFirewall');
      socket.write(response());
    });
  });
  const remotePort = await listen(remote);
  const server = net.createServer(socket => {
    track(socket);
    const messages = new Messages();
    socket.on('data', data => messages.write(data));
    messages.on('message', msg => {
      msg.int32();
      const code = msg.int32();
      if (code === 1) socket.write(new Message().int32(1).int8(1).str('').getBuff());
      if (code === 2) incomingPort = msg.int32();
      if (code !== 26) return;
      searchToken = msg.rawHexStr(4);
      if (indirect) {
        socket.write(new Message().int32(18).str('source').str('P')
          .int8(1).int8(0).int8(0).int8(127).int32(remotePort).rawHexStr(searchToken).getBuff());
      } else {
        const peer = track(net.createConnection({ host: '127.0.0.1', port: incomingPort }, () => {
          // PeerInit and search response can arrive in the same TCP packet.
          peer.write(Buffer.concat([factory.to.peer.peerInit('source', 'P', '00000000').getBuff(), response()]));
        }));
      }
    });
  });
  const serverPort = await listen(server);
  const reservation = net.createServer();
  const peerPort = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  let client;
  t.after(async () => {
    client?.destroy();
    for (const socket of sockets) socket.destroy();
    await Promise.all([server, remote].map(s => new Promise(resolve => s.close(resolve))));
  });
  client = await new Promise((resolve, reject) => slsk.connect({
    user: 'local-test', pass: 'local-test', host: '127.0.0.1', port: serverPort,
    incomingPort: peerPort, timeout: 1000,
  }, (err, result) => err ? reject(err) : resolve(result)));
  return { client, search: () => new Promise((resolve, reject) => client.search({
    req: 'coldplay head full dreams', timeout: 350,
  }, (err, results) => err ? reject(err) : resolve(results))) };
}

for (const indirect of [false, true]) {
  test(`repeated ${indirect ? 'indirect' : 'incoming'} search replies from the same user are received`, async t => {
    const { search } = await fixture(t, indirect);
    assert.equal((await search()).length, 1);
    assert.equal((await search()).length, 1, 'an existing socket must not discard the next search response');
  });
}

test('closing an old socket or connecting a distributed peer does not evict the current transfer socket', async () => {
  const { EventEmitter } = await import('node:events');
  const SlskClient = require('slsk-client/lib/slsk-client');
  const Peer = require('slsk-client/lib/peer/peer');
  class Socket extends EventEmitter {
    connecting = false;
    destroyed = false;
    sent = [];
    write(buffer) { this.sent.push(buffer); }
    destroy() { this.destroyed = true; this.emit('close'); }
  }
  const client = new SlskClient({}, []);
  const old = new Socket();
  const current = new Socket();
  const distributed = new Socket();
  client.trackPeer(new Peer(old, { user: 'source', type: 'P' }));
  const currentPeer = client.trackPeer(new Peer(current, { user: 'source', type: 'P' }));
  client.trackPeer(new Peer(distributed, { user: 'source', type: 'D' }));
  old.destroy();
  const file = { user: 'source', file: 'track.flac', size: 1000 };
  try {
    client.download({ file }, () => {});
    assert.deepEqual(current.sent.map(buffer => buffer.readUInt32LE(4)), [43, 51]);
    assert.equal(distributed.sent.length, 0);
    assert.equal(currentPeer.connected, true);
  } finally {
    client.cancelDownload(file.user, file.file);
    client.destroy();
  }
  assert.equal(current.destroyed, true);
  assert.equal(distributed.destroyed, true);
  assert.equal(currentPeer.connected, false);
});
