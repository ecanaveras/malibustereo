const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const COOKIE = 'malibu_visitor';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const PRESENCE_MS = 75_000;

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}
function makeSession(secret, now) {
  const id = randomUUID();
  const value = `${id}.${Math.floor(now / 1000) + SESSION_SECONDS}`;
  return { id, token: `${value}.${sign(value, secret)}` };
}
function readSession(cookie = '', secret, now) {
  const token = cookie.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || token.length > 200) return null;
  const [id, expires, mac, extra] = token.split('.');
  if (extra || !/^[a-f0-9-]{36}$/.test(id) || !/^\d{10}$/.test(expires) || !mac || Number(expires) <= now / 1000) return null;
  const expected = Buffer.from(sign(`${id}.${expires}`, secret));
  const actual = Buffer.from(mac);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? { id, token } : null;
}
function validateMessage(body) {
  if (!body || typeof body.name !== 'string' || typeof body.text !== 'string') return null;
  const name = body.name.trim().replace(/\s+/g, ' ');
  const text = body.text.trim();
  if (name.length < 2 || name.length > 24 || text.length < 1 || text.length > 300) return null;
  if (/[\u0000-\u001f\u007f]/.test(name) || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) return null;
  return { name, text };
}

// Dependencies are injected so the same HTTP behavior can be tested without Azure credentials.
function createHandler({ store, pubsub, secret, origins, now = Date.now, secureCookie = true }) {
  return async function handle(req) {
    const reply = (status, body, headers = {}) => ({ status, headers: {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers
    }, body });
    if (req.method !== 'POST') return reply(405, { error: 'Método no permitido.' });
    if (!origins.includes(req.headers.origin)) return reply(403, { error: 'Origen no permitido.' });
    const action = req.params.action;
    if (!['session', 'presence', 'message'].includes(action)) return reply(404, { error: 'Ruta no encontrada.' });
    const time = now();
    const session = readSession(req.headers.cookie, secret, time);
    if (action === 'session') {
      const visitor = session || makeSession(secret, time);
      // Receive only. No sendToGroup/joinLeaveGroup roles are granted to the browser.
      const access = await pubsub.getClientAccessToken({ userId: visitor.id, expirationTimeInMinutes: 5 });
      return reply(200, { url: access.url }, session ? {} : {
        'Set-Cookie': `${COOKIE}=${visitor.token}; Path=/api/community; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secureCookie ? '; Secure' : ''}`
      });
    }
    if (!session) return reply(401, { error: 'Tu sesión venció. Reconectando…' });
    if (!(await pubsub.userExists(session.id))) return reply(409, { error: 'Reconecta el chat antes de continuar.' });
    if (action === 'presence') {
      await store.touch(session.id, time);
      const count = await store.count(time - PRESENCE_MS);
      return reply(200, { count, refreshAfterMs: 25_000 });
    }
    if (!req.headers['content-type']?.startsWith('application/json') || Buffer.byteLength(req.rawBody || JSON.stringify(req.body) || '') > 2048) {
      return reply(400, { error: 'Mensaje inválido.' });
    }
    const message = validateMessage(req.body);
    if (!message) return reply(400, { error: 'Usa un apodo de 2 a 24 caracteres y un mensaje de 1 a 300.' });
    if (!(await store.claimSend(session.id, time))) return reply(429, { error: 'Espera 3 segundos entre mensajes.' }, { 'Retry-After': '3' });
    const event = { type: 'message', id: randomUUID(), ...message, sentAt: new Date(time).toISOString() };
    await pubsub.sendToAll(event);
    return reply(202, { id: event.id });
  };
}
module.exports = { createHandler, makeSession, readSession, validateMessage, PRESENCE_MS };
