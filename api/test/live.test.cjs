const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { startLocalServer } = require('./local-server.cjs');

test('two HTTP/WebSocket visitors see the same live message; a new visitor gets no history', async t => {
  const server = await startLocalServer();
  t.after(() => server.close());
  async function post(action, cookie, body = {}) {
    return fetch(`${server.origin}/api/community/${action}`, { method: 'POST', headers: {
      Origin: server.origin, Cookie: cookie || '', 'Content-Type': 'application/json'
    }, body: JSON.stringify(body) });
  }
  async function visit(cookie) {
    const response = await post('session', cookie);
    cookie ||= response.headers.get('set-cookie').split(';')[0];
    const { url } = await response.json();
    const socket = new WebSocket(url);
    await once(socket, 'open');
    return { socket, cookie };
  }
  const a = await visit(), b = await visit(), tab = await visit(a.cookie);
  assert.equal((await (await post('presence', a.cookie)).json()).count, 1);
  assert.equal((await (await post('presence', tab.cookie)).json()).count, 1);
  assert.equal((await (await post('presence', b.cookie)).json()).count, 2);
  const receivedA = once(a.socket, 'message'), receivedB = once(b.socket, 'message');
  assert.equal((await post('message', a.cookie, { name: 'Ana', text: '¡Saludos, Malibú!' })).status, 202);
  const [messageA, messageB] = await Promise.all([receivedA, receivedB]);
  assert.deepEqual(JSON.parse(messageA[0]), JSON.parse(messageB[0]));
  assert.equal(JSON.parse(messageB[0]).text, '¡Saludos, Malibú!');
  const newcomer = await visit();
  let historyReceived = false;
  newcomer.socket.on('message', () => { historyReceived = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(historyReceived, false);
  const closed = once(b.socket, 'close'); b.socket.close(); await closed;
  const reconnected = await visit(b.cookie);
  assert.equal((await (await post('presence', reconnected.cookie)).json()).count, 2);
});
