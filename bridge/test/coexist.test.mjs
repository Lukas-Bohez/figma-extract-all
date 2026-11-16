// coexist.test.mjs — the bridge next to FigCraft and other tools that sit on 3055-3060.
//
//   node test/coexist.test.mjs
//   FIGCRAFT_DIR=<clone of github.com/DivikWu/figcraft, after npm install> node test/coexist.test.mjs
//
// The last part (the REAL FigCraft relay running next to the bridge) only runs
// when FIGCRAFT_DIR is set; everything else is self-contained.

import http from 'node:http';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';

delete process.env.FIGMA_BRIDGE_PORT; // the defaults are what we test
const { getHub, findHub, candidatePorts, BRIDGE_PORTS, HUB_ID } = await import('../src/hub.mjs');

let passed = 0, failed = 0;
const ok = (c, label, extra) => { if (c) { passed++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}${extra ? '  -> ' + extra : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = () => {};

const free = (port) => new Promise((res) => {
  const s = net.createServer();
  s.once('error', () => res(false));
  s.listen(port, '127.0.0.1', () => s.close(() => res(true)));
});
for (const p of BRIDGE_PORTS) {
  if (!(await free(p))) { console.log(`Poort ${p} is bezet (draait er al een bridge?). Stop die en probeer opnieuw.`); process.exit(2); }
}

/** Something that is NOT the Extract All bridge but listens on a port: HTTP + a WebSocket that never says anything. */
function squat(port) {
  const received = [];
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"service":"figcraft-like","ok":true}'); });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => ws.on('message', (m) => received.push(m.toString())));
  return new Promise((res) => server.listen(port, '127.0.0.1', () => res({
    received,
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => r()); }),
  })));
}

function open(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'null' });
  const inbox = [];
  let closed = null;
  ws.on('message', (m) => inbox.push(JSON.parse(m.toString())));
  ws.on('close', (code) => { closed = code; });
  ws.on('error', () => {});
  const ready = new Promise((r) => ws.once('open', r));
  return { ws, inbox, ready, closedWith: () => closed };
}
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(50); }
  return fn();
}

// ───────────────────────────────────────────── 1. Ports
console.log('\n1. De poorten');
ok(JSON.stringify(BRIDGE_PORTS) === JSON.stringify([3070, 3071, 3072, 3073, 3074]), 'de bridge gebruikt 3070-3074');
ok(BRIDGE_PORTS.every((p) => p < 3055 || p > 3060), 'geen enkele poort ligt in FigCrafts bereik 3055-3060');
ok(JSON.stringify(candidatePorts()) === JSON.stringify(BRIDGE_PORTS), 'zonder instelling: het hele bereik');
ok(JSON.stringify(candidatePorts({ port: 3155 })) === JSON.stringify([3155]), 'een expliciete poort is strikt (geen terugval)');

// ───────────────────────────────────────────── 2. A foreign tool on the first port
console.log('\n2. Iets anders (FigCraft?) zit op de eerste poort');
const squatter = await squat(BRIDGE_PORTS[0]);
ok((await findHub()) === null, 'findHub ziet dat dit niet de bridge is');
const hubA = await getHub({ log: quiet });
ok(hubA.mode === 'local', 'de bridge start zelf');
ok(hubA.port === BRIDGE_PORTS[1], `en slaat de bezette poort over: poort ${hubA.port}`);
ok((await findHub()) === hubA.port, 'findHub vindt de bridge op de tweede poort');
const hubB = await getHub({ log: quiet });
ok(hubB.mode === 'remote' && hubB.port === hubA.port, 'een tweede MCP-server sluit aan op dezelfde bridge, geen tweede');
const st = await fetch(`http://127.0.0.1:${hubA.port}/status`).then((r) => r.json());
ok(st.bridge === HUB_ID && st.port === hubA.port, '/status zegt wie en waar hij is');
ok(squatter.received.length === 0, 'de bridge heeft de andere tool niets gestuurd');

// ───────────────────────────────────────────── 3. Banner and foreign clients
console.log('\n3. Voorstellen en vreemde clients');
{
  const c = open(hubA.port);
  await c.ready;
  await until(() => c.inbox.length);
  ok(c.inbox[0] && c.inbox[0].kind === 'banner' && c.inbox[0].bridge === HUB_ID, 'het eerste bericht is de banner van de bridge');
  c.ws.send(JSON.stringify({ kind: 'hello', fileName: 'Coexist', page: 'P1', featureVersion: 'test' }));
  ok(await until(() => c.inbox.some((m) => m.kind === 'welcome')), 'daarna werkt hello -> welcome zoals altijd');
  ok((await hubA.status()).files.length === 1, 'het bestand staat in de lijst');
  c.ws.close();
}
{
  const f = open(hubA.port);
  await f.ready;
  f.ws.send(JSON.stringify({ type: 'join', channel: 'figcraft', role: 'plugin' })); // what FigCraft's plugin sends first
  ok(await until(() => f.closedWith() === 4003), 'een FigCraft-client (type: join) wordt weggestuurd met code 4003', `code ${f.closedWith()}`);
  await sleep(100);
  ok((await hubA.status()).files.length === 0, 'en komt nooit in de lijst van bestanden');
}

// ───────────────────────────────────────────── 4. No free port
console.log('\n4. Geen vrije poort');
await hubA.close();
await sleep(100);
const squatters = [squatter];
for (const p of BRIDGE_PORTS.slice(1)) squatters.push(await squat(p));
let err = null;
try { await getHub({ log: quiet }); } catch (e) { err = e; }
ok(err && err.code === 'ENOPORT', 'alle poorten bezet -> een duidelijke fout, geen crash', err && err.message);
ok(err && /3070/.test(err.message) && /FIGMA_BRIDGE_PORT/.test(err.message), 'de foutmelding noemt de poorten en de instelling');
for (const s of squatters) await s.close();

// ───────────────────────────────────────────── 5. Real FigCraft relay (optional)
const FIG = process.env.FIGCRAFT_DIR;
if (FIG && existsSync(join(FIG, 'packages', 'relay', 'src', 'index.ts')) && existsSync(join(FIG, 'node_modules', 'tsx', 'dist', 'cli.mjs'))) {
  console.log('\n5. De ECHTE FigCraft-relay naast de bridge');
  const relay = spawn(process.execPath, [join(FIG, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'packages/relay/src/index.ts'], { cwd: FIG, stdio: 'ignore', env: { ...process.env, FIGCRAFT_RELAY_DIRECT: '1' } });
  const health = async () => {
    for (let p = 3055; p <= 3060; p++) {
      const h = await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(500) }).then((r) => r.ok ? r.text() : null).catch(() => null);
      if (h) return p;
    }
    return null;
  };
  const relayPort = await until(health, 15000);
  ok(!!relayPort, `de FigCraft-relay draait op poort ${relayPort}`);
  if (relayPort) {
    const hub = await getHub({ log: quiet });
    ok(hub.mode === 'local' && BRIDGE_PORTS.includes(hub.port) && hub.port !== relayPort, `de bridge start ernaast op poort ${hub.port}`);
    ok((await findHub()) === hub.port, 'findHub verwart de relay niet met de bridge');
    ok((await health()) === relayPort, 'de FigCraft-relay werkt nog (health antwoordt)');
    // FigCraft's plugin joins its channel the way it does in Figma: the relay still answers it.
    const fc = open(relayPort);
    await fc.ready;
    fc.ws.send(JSON.stringify({ type: 'join', channel: 'figcraft', role: 'plugin' }));
    await sleep(300);
    ok(fc.closedWith() === null, 'een FigCraft-plugin blijft gewoon verbonden met zijn eigen relay');
    fc.ws.close();
    const mine = open(hub.port);
    await mine.ready;
    mine.ws.send(JSON.stringify({ kind: 'hello', fileName: 'Naast FigCraft', page: 'P1', featureVersion: 'test' }));
    ok(await until(() => mine.inbox.some((m) => m.kind === 'welcome')), 'en de Extract All-plugin verbindt tegelijk met de bridge');
    mine.ws.close();
    await hub.close();
  }
  relay.kill();
} else {
  console.log('\n5. (overgeslagen: zet FIGCRAFT_DIR op een FigCraft-clone met node_modules om de echte relay mee te testen)');
}

console.log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed ? 1 : 0);
