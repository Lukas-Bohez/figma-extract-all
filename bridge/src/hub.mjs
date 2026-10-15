// hub.mjs — the local meeting point between the Figma plugin and AI tools.
//
//   Figma plugin UI  <── WebSocket ──>  hub (127.0.0.1:3055)  <── MCP (stdio) ── Claude
//                                              ^
//                                              └── HTTP POST /command ── any other tool / LLM
//
// Exactly one process owns the port. A second MCP server (for example a
// second Claude window) notices the port is taken and forwards its commands
// to the owner over HTTP instead (RemoteHub).
//
// Security: the hub only listens on 127.0.0.1. WebSockets are not covered by
// CORS, so any web page you visit could otherwise connect and pose as the
// plugin. Figma plugin iframes connect with Origin "null"; browser pages
// always send their real origin, which cannot be forged — those are refused.
// HTTP commands carrying an Origin header (i.e. from a browser) are refused
// too, and must be application/json, which a web page cannot send cross-site
// without a CORS preflight this server never approves.

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { captureUrl } from './capture/cdp.mjs';

export const DEFAULT_PORT = +(process.env.FIGMA_BRIDGE_PORT || 3055);
const HUB_ID = 'figma-extract-all-bridge';

const extraOrigins = (process.env.FIGMA_BRIDGE_ALLOW_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
export function originAllowed(origin) {
  if (origin === undefined || origin === '' || origin === 'null') return true;
  if (/^https:\/\/([a-z0-9-]+\.)*figma\.com$/i.test(origin)) return true;
  return extraOrigins.includes(origin);
}

export class NotConnectedError extends Error {}

/**
 * @returns {Promise<LocalHub>}  rejects with code EADDRINUSE when the port is taken
 */
export function startHub({ port = DEFAULT_PORT, host = '127.0.0.1', log = () => {} } = {}) {
  let plugin = null;
  let info = null;
  let connectedAt = null;
  let nextId = 1;
  const pending = new Map();

  const failAll = (why) => {
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new NotConnectedError(why)); pending.delete(id); }
  };

  function send(cmd, params = {}, timeoutMs = 60000) {
    if (!plugin || plugin.readyState !== 1) {
      return Promise.reject(new NotConnectedError(
        'De Figma-plugin is niet verbonden. Open "Extract All" in Figma (desktop-app), ga naar de tab "Claude" en klik op Verbinden.'));
    }
    const id = `c${nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Figma antwoordde niet binnen ${Math.round(timeoutMs / 1000)} s op "${cmd}". De opdracht kan in Figma nog doorlopen: wacht even, of stuur cancel. Zware opdrachten (bv. apply_text_styles_auto) hebben een tijdsbudget en geven "remaining" terug: roep ze dan opnieuw aan.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, cmd });
      plugin.send(JSON.stringify({ kind: 'cmd', id, cmd, params }));
    });
  }

  const status = () => ({
    bridge: HUB_ID,
    plugin: Boolean(plugin && plugin.readyState === 1),
    fileName: info?.fileName ?? null,
    page: info?.page ?? null,
    featureVersion: info?.featureVersion ?? null,
    connectedAt,
    pending: pending.size,
  });

  const server = http.createServer(async (req, res) => {
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    // Anything a browser page sends carries an Origin header. Refuse all of it.
    if (req.headers.origin !== undefined) return json(403, { ok: false, error: 'Browser-verzoeken zijn niet toegestaan.' });

    if (req.method === 'GET' && req.url === '/status') return json(200, status());
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`Figma bridge (${HUB_ID})\nGET /status\nPOST /command  {"cmd": "status", "params": {}}\n`);
    }
    if (req.method === 'POST' && req.url === '/command') {
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(415, { ok: false, error: 'Content-Type moet application/json zijn.' });
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 64 * 1024 * 1024) return json(413, { ok: false, error: 'Verzoek te groot' });
      }
      let msg;
      try { msg = JSON.parse(body); } catch { return json(400, { ok: false, error: 'Ongeldige JSON' }); }
      if (!msg || typeof msg.cmd !== 'string') return json(400, { ok: false, error: 'Verwacht {"cmd": "...", "params": {...}}' });
      try {
        const result = await send(msg.cmd, msg.params || {}, +(msg.timeoutMs || 60000));
        return json(200, { ok: true, result });
      } catch (e) {
        return json(e instanceof NotConnectedError ? 503 : 500, { ok: false, error: e.message, notConnected: e instanceof NotConnectedError });
      }
    }
    return json(404, { ok: false, error: 'Onbekend pad' });
  });

  const wss = new WebSocketServer({
    server,
    maxPayload: 256 * 1024 * 1024,
    verifyClient: ({ origin }, done) => {
      if (originAllowed(origin)) return done(true);
      log(`WebSocket geweigerd van origin ${origin} (zet FIGMA_BRIDGE_ALLOW_ORIGIN als dit terecht is)`);
      done(false, 403, 'Origin not allowed');
    },
  });

  wss.on('connection', (ws) => {
    ws.isPlugin = false;
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.kind === 'hello') {
        if (plugin && plugin !== ws) {
          log('Nieuwe plugin-verbinding vervangt de vorige');
          try { plugin.close(4000, 'replaced'); } catch { /* ignore */ }
        }
        plugin = ws; ws.isPlugin = true;
        info = { fileName: msg.fileName, page: msg.page, featureVersion: msg.featureVersion };
        connectedAt = new Date().toISOString();
        log(`Figma verbonden: "${info.fileName}" (pagina ${info.page})`);
        ws.send(JSON.stringify({ kind: 'welcome', bridge: HUB_ID }));
        return;
      }
      if (msg.kind === 'info' && ws === plugin) { info = { ...info, ...msg }; return; }
      if (msg.kind === 'ping') { ws.send(JSON.stringify({ kind: 'pong' })); return; }

      if (msg.kind === 'result' && ws === plugin) {
        const p = pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error || `"${p.cmd}" mislukt in Figma`));
        return;
      }

      // The plugin UI asks the hub to render a URL (it cannot run a browser itself).
      if (msg.kind === 'capture') {
        try {
          const { doc } = await captureUrl({ url: msg.url, theme: msg.theme, width: msg.width || 1440, autoLayout: msg.autoLayout !== false, fullPage: msg.fullPage !== false });
          ws.send(JSON.stringify({ kind: 'capture-result', reqId: msg.reqId, ok: true, doc }));
        } catch (e) {
          ws.send(JSON.stringify({ kind: 'capture-result', reqId: msg.reqId, ok: false, error: e.message }));
        }
      }
    });
    ws.on('close', () => {
      if (ws === plugin) {
        plugin = null; info = null; connectedAt = null;
        failAll('De Figma-plugin verbrak de verbinding');
        log('Figma verbroken');
      }
    });
    ws.on('error', () => { /* close follows */ });
  });

  // `ws` re-emits the HTTP server's errors on the WebSocketServer. Without a
  // listener here, EADDRINUSE crashes the process instead of letting getHub()
  // fall back to the bridge that already owns the port.
  wss.on('error', (e) => { if (e.code !== 'EADDRINUSE') log(`WebSocket-fout: ${e.message}`); });

  return new Promise((resolve, reject) => {
    server.once('error', (e) => { wss.close(); reject(e); });
    server.listen(port, host, () => {
      server.removeAllListeners('error');
      server.on('error', (e) => log(`HTTP-fout: ${e.message}`));
      log(`Bridge luistert op http://${host}:${port} (WebSocket op dezelfde poort)`);
      resolve({
        mode: 'local',
        port,
        send,
        status: async () => status(),
        close: () => new Promise((r) => { failAll('Bridge gestopt'); for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => r()); }),
      });
    });
  });
}

/** Talk to a hub owned by another process. */
export async function connectRemote({ port = DEFAULT_PORT, host = '127.0.0.1' } = {}) {
  const base = `http://${host}:${port}`;
  const st = await fetch(`${base}/status`).then((r) => r.json()).catch(() => null);
  if (!st || st.bridge !== HUB_ID) throw new Error(`Poort ${port} is bezet door iets anders dan de Figma-bridge.`);
  return {
    mode: 'remote',
    port,
    async send(cmd, params = {}, timeoutMs = 60000) {
      const r = await fetch(`${base}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, params, timeoutMs }),
      });
      const body = await r.json();
      if (!body.ok) throw (body.notConnected ? new NotConnectedError(body.error) : new Error(body.error));
      return body.result;
    },
    status: () => fetch(`${base}/status`).then((r) => r.json()),
    close: async () => {},
  };
}

/** Own the port if it is free, otherwise use the process that owns it. */
export async function getHub(opts = {}) {
  try {
    return await startHub(opts);
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') {
      (opts.log || (() => {}))(`Poort ${opts.port || DEFAULT_PORT} is al in gebruik: aansluiten op de bestaande bridge.`);
      return connectRemote(opts);
    }
    throw e;
  }
}
