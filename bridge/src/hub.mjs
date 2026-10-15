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
// Several Figma files can be connected at once (one plugin window per file).
// Commands go to exactly one of them:
//   - one file connected            -> that file
//   - several, one chosen (hub.use) -> the chosen file
//   - several, none chosen          -> an error that lists the files, so a
//                                      design never lands in the wrong file
//   - any command can also carry its own `file` to address one file directly.
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
/** Several Figma files are connected and none was chosen. */
export class AmbiguousTargetError extends Error {}

/**
 * @returns {Promise<LocalHub>}  rejects with code EADDRINUSE when the port is taken
 */
export function startHub({ port = DEFAULT_PORT, host = '127.0.0.1', log = () => {} } = {}) {
  const clients = new Set();   // sockets of plugin windows that said hello
  let pinned = null;           // identity of the file the user chose (hub.use)
  let nextId = 1;
  let nextClient = 1;
  const pending = new Map();

  const identityOf = (info) => info.fileKey || info.fileName || 'onbekend';
  const open = () => [...clients].filter((c) => c.readyState === 1);
  const label = (c) => `"${c.info.fileName || '?'}" (pagina ${c.info.page || '?'})`;
  const describe = (c, target) => ({
    id: c.hubId, fileName: c.info.fileName ?? null, page: c.info.page ?? null, fileKey: c.info.fileKey ?? null,
    featureVersion: c.info.featureVersion ?? null, connectedAt: c.connectedAt, target,
  });

  /** Which window gets the next command? Throws when that is not clear. */
  function resolveTarget(file) {
    const live = open();
    if (!live.length) {
      throw new NotConnectedError(
        'De Figma-plugin is niet verbonden. Open "Extract All" in Figma (desktop-app), ga naar de tab "Claude" en klik op Verbinden.');
    }
    if (file) {
      const wanted = String(file).toLowerCase();
      const hits = live.filter((c) => c.hubId === file || c.info.fileKey === file || (c.info.fileName || '').toLowerCase() === wanted);
      if (!hits.length) {
        throw new Error(`Geen verbonden Figma-bestand met de naam "${file}". Verbonden: ${live.map(label).join(', ')}.`);
      }
      return hits.sort((a, b) => b.connectedAt.localeCompare(a.connectedAt))[0];
    }
    if (pinned) {
      const chosen = live.find((c) => c.identity === pinned);
      if (chosen) return chosen;
      pinned = null; // the chosen file was closed
    }
    if (live.length === 1) return live[0];
    throw new AmbiguousTargetError(
      `Meerdere Figma-bestanden zijn verbonden: ${live.map(label).join(' en ')}. ` +
      'Kies er één met figma_use_file (of geef "file" mee), zodat er niets in het verkeerde bestand terechtkomt.');
  }
  const targetOrNull = () => { try { return resolveTarget(); } catch { return null; } };

  /** Tell every plugin window whether it is the file Claude is working in. */
  function broadcastTargets() {
    const live = open();
    const target = targetOrNull();
    for (const c of live) {
      try { c.send(JSON.stringify({ kind: 'target', active: c === target, files: live.length })); } catch { /* closing */ }
    }
  }

  /** The same file connecting again (plugin reopened) replaces its old window.
   *  A different file does NOT: that is a second design file, not a duplicate. */
  function dropDuplicates(ws) {
    for (const other of [...clients]) {
      if (other !== ws && other.identity === ws.identity) {
        log(`Nieuwe verbinding voor ${label(ws)} vervangt de vorige`);
        clients.delete(other);
        failAll('De plugin is opnieuw verbonden', other);
        try { other.close(4000, 'replaced'); } catch { /* ignore */ }
      }
    }
  }

  const failAll = (why, client) => {
    for (const [id, p] of pending) {
      if (client && p.client !== client) continue;
      clearTimeout(p.timer); p.reject(new NotConnectedError(why)); pending.delete(id);
    }
  };

  const status = () => {
    const live = open();
    const target = targetOrNull();
    return {
      bridge: HUB_ID,
      plugin: live.length > 0,
      fileName: target?.info.fileName ?? null,
      page: target?.info.page ?? null,
      featureVersion: target?.info.featureVersion ?? null,
      connectedAt: target?.connectedAt ?? null,
      files: live.map((c) => describe(c, c === target)),
      pinned: pinned ? (live.find((c) => c.identity === pinned)?.info.fileName ?? null) : null,
      ambiguous: live.length > 1 && !target,
      pending: pending.size,
    };
  };

  /** Commands the hub answers itself, without asking Figma. */
  function hubCommand(cmd, params) {
    if (cmd === 'hub.files') return status();
    if (cmd === 'hub.unpin') { pinned = null; broadcastTargets(); return status(); }
    if (cmd === 'hub.use') {
      if (!params.file) throw new Error('Geef de naam van het bestand mee: {"file": "interaction design"}.');
      const chosen = resolveTarget(String(params.file));
      pinned = chosen.identity;
      broadcastTargets();
      log(`Doelbestand: ${label(chosen)}`);
      return status();
    }
    throw new Error(`Onbekend hub-commando "${cmd}" (hub.files, hub.use, hub.unpin).`);
  }

  function send(cmd, params = {}, timeoutMs = 60000, opts = {}) {
    if (cmd.startsWith('hub.')) {
      try { return Promise.resolve(hubCommand(cmd, params)); } catch (e) { return Promise.reject(e); }
    }
    let client;
    try { client = resolveTarget(opts.file); } catch (e) { return Promise.reject(e); }
    const id = `c${nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Figma antwoordde niet binnen ${Math.round(timeoutMs / 1000)} s op "${cmd}". De opdracht kan in Figma nog doorlopen: wacht even, of stuur cancel. Zware opdrachten (bv. apply_text_styles_auto) hebben een tijdsbudget en geven "remaining" terug: roep ze dan opnieuw aan.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, cmd, client });
      client.send(JSON.stringify({ kind: 'cmd', id, cmd, params }));
    });
  }

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
      return res.end(`Figma bridge (${HUB_ID})\nGET /status\nPOST /command  {"cmd": "status", "params": {}, "file": "optioneel: bestandsnaam"}\nHub-commando's: hub.files, hub.use {"file": "..."}, hub.unpin\n`);
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
        const result = await send(msg.cmd, msg.params || {}, +(msg.timeoutMs || 60000), { file: msg.file });
        return json(200, { ok: true, result });
      } catch (e) {
        const code = e instanceof NotConnectedError ? 503 : e instanceof AmbiguousTargetError ? 409 : 500;
        return json(code, { ok: false, error: e.message, notConnected: e instanceof NotConnectedError, ambiguous: e instanceof AmbiguousTargetError });
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
        ws.info = { fileName: msg.fileName, page: msg.page, fileKey: msg.fileKey || null, featureVersion: msg.featureVersion };
        ws.identity = identityOf(ws.info);
        dropDuplicates(ws);
        ws.isPlugin = true;
        ws.hubId = `f${nextClient++}`;
        ws.connectedAt = new Date().toISOString();
        clients.add(ws);
        log(`Figma verbonden: ${label(ws)}`);
        ws.send(JSON.stringify({ kind: 'welcome', bridge: HUB_ID }));
        broadcastTargets();
        return;
      }
      if (msg.kind === 'info' && ws.isPlugin) {
        const { kind, ...rest } = msg; // eslint-disable-line no-unused-vars
        ws.info = { ...ws.info, ...rest };
        // The plugin may connect before it knows its file name: the real identity arrives here.
        const identity = identityOf(ws.info);
        if (identity !== ws.identity) {
          if (pinned === ws.identity) pinned = identity;
          ws.identity = identity;
          dropDuplicates(ws);
          broadcastTargets();
        }
        return;
      }
      if (msg.kind === 'ping') { ws.send(JSON.stringify({ kind: 'pong' })); return; }

      if (msg.kind === 'result' && ws.isPlugin) {
        const p = pending.get(msg.id);
        if (!p || p.client !== ws) return;
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
      if (!clients.has(ws)) return;
      clients.delete(ws);
      failAll('De Figma-plugin verbrak de verbinding', ws);
      if (pinned === ws.identity && !open().some((c) => c.identity === pinned)) pinned = null;
      log(`Figma verbroken: ${label(ws)}`);
      broadcastTargets();
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
    async send(cmd, params = {}, timeoutMs = 60000, opts = {}) {
      const r = await fetch(`${base}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, params, timeoutMs, file: opts.file }),
      });
      const body = await r.json();
      if (!body.ok) throw (body.notConnected ? new NotConnectedError(body.error) : body.ambiguous ? new AmbiguousTargetError(body.error) : new Error(body.error));
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
