// bridge.test.mjs — end-to-end:
//
//   MCP client (official SDK) -> bin/figma-mcp.mjs -> hub -> WebSocket
//     -> stand-in plugin UI -> REAL compiled code.js (in figma-mock) -> back
//
//   node test/bridge.test.mjs [url-for-capture-test]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startHub, connectRemote } from '../src/hub.mjs';
import { createFigma } from './figma-mock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CODE = readFileSync(join(HERE, '..', '..', 'code.js'), 'utf8');
const PORT = 3155; // not the default, so a real running bridge is never touched
const captureUrlArg = process.argv[2];

let passed = 0, failed = 0;
const ok = (cond, label, extra) => {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? '  -> ' + extra : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in for ui.html: bridges WebSocket <-> the plugin's code.js.
function startFakePlugin({ origin = 'null' } = {}) {
  const m = createFigma();
  const ctx = vm.createContext({ figma: m.figma, __html__: '', console, setTimeout, clearTimeout, Uint8Array, Uint32Array, DataView, Promise });
  vm.runInContext(CODE, ctx);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin });
  const ready = new Promise((resolve, reject) => {
    ws.on('open', () => { ws.send(JSON.stringify({ kind: 'hello', fileName: m.figma.root.name, page: 'Page 1', featureVersion: '19.0.0' })); });
    ws.on('message', async (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.kind === 'welcome') resolve();
      if (msg.kind === 'cmd') {
        const before = m.posted.length;
        await m.send({ type: 'x:bridge-cmd', id: msg.id, cmd: msg.cmd, params: msg.params });
        const r = m.posted.slice(before).find((p) => p.type === 'x:bridge-result' && p.id === msg.id);
        ws.send(JSON.stringify({ kind: 'result', id: msg.id, ok: r ? r.ok : false, result: r && r.result, error: r ? r.error : 'geen antwoord' }));
      }
    });
    ws.on('unexpected-response', (req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', reject);
  });
  return { m, ws, ready };
}

// ───────────────────────────────────────────── 1. security
console.log('\n1. Beveiliging');
const hub = await startHub({ port: PORT });
{
  const evil = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'https://evil.example' });
  const rejected = await new Promise((r) => { evil.on('unexpected-response', (_q, res) => r(res.statusCode)); evil.on('open', () => r('open')); evil.on('error', () => r('error')); });
  ok(rejected === 403, 'WebSocket van een gewone website wordt geweigerd', String(rejected));

  let res = await fetch(`http://127.0.0.1:${PORT}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{"cmd":"status"}' });
  ok(res.status === 403, 'HTTP-commando met Origin (browser) -> 403', String(res.status));
  res = await fetch(`http://127.0.0.1:${PORT}/command`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"cmd":"status"}' });
  ok(res.status === 415, 'text/plain (CSRF-truc) -> 415', String(res.status));
  res = await fetch(`http://127.0.0.1:${PORT}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"cmd":"status"}' });
  const body = await res.json();
  ok(res.status === 503 && body.notConnected, 'commando zonder verbonden plugin -> 503 met uitleg', JSON.stringify(body));
}

// ───────────────────────────────────────────── 2. plugin connects
console.log('\n2. Plugin verbindt');
const plugin = startFakePlugin();
await plugin.ready;
{
  const st = await hub.status();
  ok(st.plugin && st.fileName === 'Interaction Design', 'hub ziet de plugin en het bestand', JSON.stringify(st));
  const r = await hub.send('status');
  ok(r.featureVersion === '19.0.0', 'commando rechtstreeks via de hub');
  const remote = await connectRemote({ port: PORT });
  const r2 = await remote.send('status');
  ok(r2.fileName === 'Interaction Design', 'tweede proces werkt via RemoteHub (HTTP)');
}

// ───────────────────────────────────────────── 3. MCP end to end
console.log('\n3. MCP: echte client -> figma-mcp.mjs -> hub -> plugin -> code.js');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(HERE, '..', 'bin', 'figma-mcp.mjs')],
  env: { ...process.env, FIGMA_BRIDGE_PORT: String(PORT) },
  stderr: 'pipe',
});
const client = new Client({ name: 'test', version: '1.0.0' });
await client.connect(transport);
{
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  ok(tools.length >= 22, `${tools.length} tools aangeboden`);
  for (const n of ['figma_status', 'figma_screenshot', 'figma_create', 'figma_create_variables', 'figma_bind_variable', 'figma_capture_webpage', 'figma_rubric_check', 'web_contrast_audit']) {
    ok(names.includes(n), `tool ${n}`);
  }
  ok(tools.find((t) => t.name === 'figma_delete').annotations?.destructiveHint === true, 'figma_delete is als destructief gemarkeerd');

  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const t = r.content.find((c) => c.type === 'text');
    let data = null;
    try { data = t ? JSON.parse(t.text) : null; } catch { data = t && t.text; }
    return { r, data };
  };

  let { r, data } = await call('figma_status');
  ok(!r.isError && data.plugin && data.figma.fileName === 'Interaction Design', 'figma_status via MCP', r.isError && r.content[0].text);

  ({ r, data } = await call('figma_create', { kind: 'FRAME', name: 'Card', width: 320, height: 180, fill: '#ffffff', cornerRadius: 14,
    layout: { mode: 'VERTICAL', gap: 12, padding: 16 } }));
  ok(!r.isError && data.id, 'figma_create maakt een frame', r.isError && r.content[0].text);
  const cardId = data && data.id;

  ({ r, data } = await call('figma_create_variables', { collection: 'tokens', modes: ['Light', 'Dark'], variables: [
    { name: 'base/white', type: 'COLOR', values: { Light: '#ffffff', Dark: '#ffffff' } },
    { name: 'base/ink', type: 'COLOR', values: { Light: '#111827', Dark: '#111827' } },
    { name: 'semantic/surface', type: 'COLOR', values: { Light: { alias: 'base/white' }, Dark: { alias: 'base/ink' } } },
  ] }));
  ok(!r.isError && data.modes.join() === 'Light,Dark', 'figma_create_variables met aliassen', r.isError && r.content[0].text);

  ({ r, data } = await call('figma_bind_variable', { ids: [cardId], field: 'fill', variable: 'semantic/surface' }));
  ok(!r.isError && data.bound === 1, 'figma_bind_variable', r.isError && r.content[0].text);

  ({ r, data } = await call('figma_get_node', { ids: [cardId], depth: 0 }));
  ok(!r.isError && data.nodes[0].fills[0].variable === 'semantic/surface', 'get_node toont de gebonden variabele op naam', JSON.stringify(data && data.nodes[0].fills));

  ({ r } = await call('figma_screenshot', { ids: [cardId] }));
  ok(!r.isError && r.content.some((c) => c.type === 'image' && c.mimeType === 'image/png' && c.data.length > 0), 'figma_screenshot geeft een beeld terug aan Claude');

  ({ r, data } = await call('figma_rubric_check'));
  ok(!r.isError && data.fillsBound >= 1 && typeof data.frameAuto === 'number', 'figma_rubric_check via MCP');

  ({ r } = await call('figma_get_node', { ids: ['nope'] }));
  ok(r.isError && /Geen laag/.test(r.content[0].text), 'fouten komen als isError terug, niet als crash');

  // Disconnect the plugin: tools must say what to do, not hang.
  plugin.ws.close();
  await sleep(300);
  ({ r } = await call('figma_get_document'));
  ok(r.isError && /niet verbonden/.test(r.content[0].text), 'plugin weg -> duidelijke uitleg', r.content[0].text.slice(0, 120));
  ({ r, data } = await call('figma_status'));
  ok(!r.isError && data.plugin === false && data.hint, 'figma_status zegt hoe te verbinden');
}

// ───────────────────────────────────────────── 4. capture -> Figma through MCP
if (captureUrlArg) {
  console.log(`\n4. figma_capture_webpage: ${captureUrlArg} -> Figma (licht + donker)`);
  const p2 = startFakePlugin();
  await p2.ready;
  const t0 = Date.now();
  const r = await client.callTool({ name: 'figma_capture_webpage', arguments: { url: captureUrlArg, theme: 'both', fullPage: false } }, undefined, { timeout: 180000 });
  const t = r.content.find((c) => c.type === 'text');
  let data = null;
  try { data = t ? JSON.parse(t.text) : null; } catch { data = null; }
  ok(!r.isError && data.results.length === 2, `twee thema's vastgelegd en geïmporteerd in ${((Date.now() - t0) / 1000).toFixed(1)} s`, r.isError && t && t.text);
  if (data && data.results.length === 2) {
    ok(data.results[0].theme === 'light' && data.results[1].theme === 'dark', 'thema\'s licht en donker');
    ok(data.results.every((x) => x.figma && x.figma.counts.TEXT === x.counts.TEXT && x.figma.warnings.length === 0), 'alle tekstlagen in Figma, zonder waarschuwingen');
  }
  ok(r.content.filter((c) => c.type === 'image').length === 2, 'Claude krijgt beide screenshots te zien');
  const roots = p2.m.page.children.map((c) => c.name);
  ok(roots.length === 2 && /light/.test(roots[0]) && /dark/.test(roots[1]), `twee frames naast elkaar: ${roots.join(' | ')}`);
  ok(p2.m.page.children[1].x > p2.m.page.children[0].x + p2.m.page.children[0].width, 'tweede frame staat NAAST het eerste, niet erover');

  const c = await client.callTool({ name: 'web_contrast_audit', arguments: { url: captureUrlArg, theme: 'light' } }, undefined, { timeout: 120000 });
  let cd = { checked: 0, failures: [1], passes: 0 };
  try { cd = JSON.parse(c.content[0].text); } catch { console.log('   ', c.content[0].text); }
  ok(!c.isError && cd.checked > 100 && cd.failures.length === 0, `web_contrast_audit: ${cd.passes}/${cd.checked} halen AA`);
  p2.ws.close();
} else {
  console.log('\n4. (overgeslagen: geef een URL mee om capture -> Figma te testen)');
}

await client.close();
await hub.close();
console.log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed ? 1 : 0);
