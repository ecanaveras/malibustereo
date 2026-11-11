const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, makeSession, readSession, validateMessage } = require('../lib/community.cjs');
const { createStore } = require('../lib/azure-store.cjs');
const secret = 'test-secret-only-not-used-in-production';
const origin = 'https://radio.example';

function setup() {
  let clock = 1_800_000_000_000;
  const visitors = new Map(), throttles = new Map(), connected = new Set(), sent = [];
  const store = {
    async touch(id, now) { visitors.set(id, now); },
    async count(since) { return [...visitors.values()].filter(time => time >= since).length; },
    async claimSend(id, now) { if (now - (throttles.get(id) || 0) < 3000) return false; throttles.set(id, now); return true; }
  };
  const pubsub = {
    async getClientAccessToken(options) { assert.equal(options.roles, undefined); return { url: `wss://radio.example/${options.userId}` }; },
    async userExists(id) { return connected.has(id); },
    async sendToAll(message) { sent.push(message); }
  };
  const handle = createHandler({ store, pubsub, secret, origins: [origin], now: () => clock });
  const request = (action, cookie, body, headers = {}) => handle({ method: 'POST', params: { action }, headers: { origin, cookie, 'content-type': 'application/json', ...headers }, body });
  return { request, connected, sent, visitors, throttles, advance(ms) { clock += ms; },
    async session() { const result = await request('session'); const cookie = result.headers['Set-Cookie'].split(';')[0]; const id = readSession(cookie, secret, clock).id; connected.add(id); return { cookie, id, result }; }
  };
}

test('signed, expiring, HttpOnly sessions are reused across tabs', async () => {
  const s = setup(); const a = await s.session();
  assert.match(a.result.headers['Set-Cookie'], /HttpOnly; SameSite=Strict/);
  assert.match(a.result.headers['Set-Cookie'], /; Secure$/);
  assert.equal((await s.request('session', a.cookie)).headers['Set-Cookie'], undefined);
  assert.equal(readSession(a.cookie + 'x', secret, 1_800_000_000_000), null);
  const expiring = makeSession(secret, 0);
  assert.equal(readSession(`malibu_visitor=${expiring.token}`, secret, 31 * 86400_000), null);
});
test('presence deduplicates tabs and expires disconnected visitors', async () => {
  const s = setup(); const a = await s.session(); const b = await s.session();
  assert.equal((await s.request('presence', a.cookie)).body.count, 1);
  assert.equal((await s.request('presence', a.cookie)).body.count, 1);
  assert.equal((await s.request('presence', b.cookie)).body.count, 2);
  s.advance(75_001);
  assert.equal((await s.request('presence', a.cookie)).body.count, 1);
});
test('a cookie alone cannot count as connected or send', async () => {
  const s = setup(); const a = await s.session(); s.connected.clear();
  assert.equal((await s.request('presence', a.cookie)).status, 409);
  assert.equal((await s.request('message', a.cookie, { name: 'Ana', text: 'Hola' })).status, 409);
  assert.equal(s.sent.length, 0);
});
test('rejects cross-origin, unsigned and oversized requests', async () => {
  const s = setup(); const a = await s.session();
  assert.equal((await s.request('session', '', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await s.request('presence', 'malibu_visitor=forged')).status, 401);
  assert.equal((await s.request('message', a.cookie, { name: 'Ana', text: 'x'.repeat(301) })).status, 400);
  assert.equal((await s.request('message', a.cookie, { name: 'Ana', text: 'ok', extra: 'x'.repeat(2050) })).status, 400);
});
test('message validation covers blank input, control characters and valid Unicode', () => {
  assert.equal(validateMessage({ name: 'A', text: 'Hola' }), null);
  assert.equal(validateMessage({ name: 'Ana', text: '   ' }), null);
  assert.equal(validateMessage({ name: 'Ana', text: 'a\0b' }), null);
  assert.deepEqual(validateMessage({ name: '  José  ', text: ' ¡Saludos desde Pinillos! ' }), { name: 'José', text: '¡Saludos desde Pinillos!' });
});
test('broadcasts live text once, limits simultaneous sends and stores no content', async () => {
  const s = setup(); const a = await s.session();
  const message = { name: 'Ana', text: '<img src=x onerror=alert(1)>' };
  const replies = await Promise.all([s.request('message', a.cookie, message), s.request('message', a.cookie, message)]);
  assert.deepEqual(replies.map(r => r.status).sort(), [202, 429]);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].text, message.text);
  assert.deepEqual([...s.throttles.values()], [1_800_000_000_000]);
  assert.equal((await s.request('history', a.cookie)).status, 404);
  s.advance(3000);
  assert.equal((await s.request('message', a.cookie, message)).status, 202);
});
test('Azure adapter uses conditional writes to stop concurrent sends across instances', async () => {
  let row, version = 0;
  const error = statusCode => Object.assign(new Error('Storage test'), { statusCode });
  const table = {
    async createTable() {},
    async getEntity() { if (!row) throw error(404); return { ...row, etag: String(version) }; },
    async createEntity(entity) { if (row) throw error(409); row = entity; version++; },
    async updateEntity(entity, mode, options) { if (options.etag !== String(version)) throw error(412); row = entity; version++; }
  };
  const store1 = createStore('', '', table), store2 = createStore('', '', table);
  assert.deepEqual((await Promise.all([store1.claimSend('id', 5000), store2.claimSend('id', 5000)])).sort(), [false, true]);
  assert.equal(await store1.claimSend('id', 7999), false);
  assert.deepEqual((await Promise.all([store1.claimSend('id', 8000), store2.claimSend('id', 8000)])).sort(), [false, true]);
  assert.deepEqual(Object.keys(row).sort(), ['lastSeen', 'partitionKey', 'rowKey']);
});
