// Local-only test double. Production always uses Azure clients in community/index.js.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { createHandler } = require('../lib/community.cjs');

async function startLocalServer(port = 0) {
  const visitors = new Map(), throttle = new Map(), tickets = new Map();
  const sockets = new Map();
  let origin, handle;
  const root = path.resolve(__dirname, '../../dist');
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/community/')) {
      try {
        let rawBody = '';
        for await (const chunk of req) { rawBody += chunk; if (rawBody.length > 4096) throw Error('too large'); }
        const reply = await handle({ method: req.method, params: { action: req.url.split('/').at(-1) }, headers: req.headers, rawBody, body: JSON.parse(rawBody || '{}') });
        res.writeHead(reply.status, reply.headers); res.end(JSON.stringify(reply.body));
      } catch { res.writeHead(400); res.end('{}'); }
      return;
    }
    const url = new URL(req.url, origin);
    const candidate = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (candidate !== root && !candidate.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    let file = candidate;
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const token = new URL(req.url, origin).searchParams.get('ticket');
    const id = tickets.get(token);
    tickets.delete(token);
    if (!id) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      sockets.set(ws, id);
      ws.on('close', () => sockets.delete(ws));
      // No direct client publishing: all messages go through the real HTTP handler.
    });
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  origin = `http://localhost:${server.address().port}`;
  handle = createHandler({
    secret: 'local-testing-secret-never-for-deployment', origins: [origin], secureCookie: false,
    store: {
      async touch(id, now) { visitors.set(id, now); },
      async count(since) { return [...visitors.values()].filter(last => last >= since).length; },
      async claimSend(id, now) { if (now - (throttle.get(id) || 0) < 3000) return false; throttle.set(id, now); return true; }
    },
    pubsub: {
      async getClientAccessToken({ userId }) { const ticket = randomUUID(); tickets.set(ticket, userId); return { url: `${origin.replace('http:', 'ws:')}/?ticket=${ticket}` }; },
      async userExists(id) { return [...sockets.values()].includes(id); },
      async sendToAll(event) { for (const ws of sockets.keys()) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event)); }
    }
  });
  return { origin,
    disconnectAll() { for (const ws of sockets.keys()) ws.close(); },
    close: async () => { for (const ws of sockets.keys()) ws.terminate(); wss.close(); await new Promise(resolve => server.close(resolve)); }
  };
}
module.exports = { startLocalServer };
if (require.main === module) startLocalServer(4322).then(({ origin }) => console.log(`LOCAL TEST DOUBLE (not Azure): ${origin}`));
