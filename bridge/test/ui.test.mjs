// ui.test.mjs — the REAL ui.html in a real (headless) browser.
//
// A Figma plugin UI is an iframe with origin "null"; a file:// page is too,
// so the WebSocket handshake and origin check behave the same way here.
// code.js is replaced by a tiny in-page responder (code.js has its own tests).
//
//   node test/ui.test.mjs [dashboard-url] [screenshot-dir]

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHub } from '../src/hub.mjs';
import { openPage } from '../src/capture/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = pathToFileURL(join(HERE, '..', '..', 'ui.html')).href;
const [dashUrl, shotDir] = process.argv.slice(2);

let passed = 0, failed = 0;
const ok = (c, label, extra) => { if (c) { passed++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}${extra ? '  -> ' + extra : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step); }
  return fn();
}

let hub;
try { hub = await startHub({ port: 3055 }); }
catch (e) {
  console.log(e.code === 'EADDRINUSE' ? 'Poort 3055 is bezet (draait er al een bridge?). Stop die en probeer opnieuw.' : e.message);
  process.exit(2);
}
// Stand-in for code.js: answers the UI the way features.ts does. Installed
// BEFORE the page's scripts run, because code.js is listening before a
// plugin UI loads.
const RESPONDER = `(() => {
  window.__sent = [];
  const reply = (m) => window.postMessage({ pluginMessage: m }, '*');
  window.addEventListener('message', (e) => {
    const m = e.data && e.data.pluginMessage;
    if (!m) return;
    window.__sent.push(m.type);
    if (m.type === 'x:hello') reply({ type: 'x:info', fileName: 'UI test file', page: 'Page 1', featureVersion: '19.2.0', bridge: null });
    if (m.type === 'x:bridge-cmd') reply({ type: 'x:bridge-result', id: m.id, ok: true, result: { fileName: 'UI test file', page: 'Page 1', echo: m.cmd } });
    if (m.type === 'x:layout-import') setTimeout(() => reply({ type: 'x:layout-done', result: {
      name: (m.doc.source.title || 'import') + ' (' + m.doc.source.colorScheme + ')', counts: m.doc.counts, warnings: [], width: m.doc.root.w, height: m.doc.root.h } }), 50);
    if (m.type === 'x:rubric-audit') reply({ type: 'x:rubric-report', report: {
      collections: [{ name: 'Collection 1', modes: ['Light Mode', 'Dark Mode'], count: 26 }], variableTypes: { COLOR: 26 },
      aliasCount: 0, hasSpacing: false, componentSets: [{ name: 'Button', props: ['Property 1'], variants: 6 }], componentCount: 9, instanceCount: 16,
      genericVariants: [{ set: 'Button', prop: 'Property 1', values: ['medium', 'klein', 'Variant2'] }],
      textStyles: [], missingTextStyles: ['text/xs', 'text/sm'], textTotal: 143, textUnstyled: 143, offScale: [['19.79', 4]],
      frameTotal: 90, frameAuto: 12, offGrid: [{ name: 'card', values: [13] }], offGridTotal: 1, noAutoLayout: [{ name: 'Main screen', children: 12 }],
      fillsBound: 3, fillsRaw: 97, topRawColors: [['#f5f5f5', 20], ['#16a34a', 9]], pages: ['Design', 'Componenten'] } });
  });
})()`;
const page = await openPage(UI, { width: 520, height: 1000, preload: RESPONDER });

console.log('\n1. Laden');
await sleep(600);
ok(page.errors.length === 0, 'geen JavaScript-fouten bij het laden (ook niet in de bestaande tabs)', page.errors.slice(0, 3).join(' | '));
ok(await page.evaluate(`window.__sent.includes('x:hello')`), 'UI vraagt info op bij code.js');
ok(await page.evaluate(`document.querySelectorAll('.tab-btn').length === 7`), '7 tabs');

console.log('\n2. Tabs wisselen (bestaande switchTab-code)');
for (const t of ['build', 'rubric', 'claude', 'import']) {
  const active = await page.evaluate(`(() => { document.querySelector('[data-tab=${t}]').click(); return document.getElementById('panel-${t}').classList.contains('active') && [...document.querySelectorAll('.panel.active')].length === 1; })()`);
  ok(active, `tab ${t} opent precies één paneel`);
}

console.log('\n3. Claude-bridge: echte WebSocket naar de hub');
await page.evaluate(`document.querySelector('[data-tab=claude]').click(); document.getElementById('xcToggle').click()`);
// Het UI-bestand kan naast andere Figma-bestanden verbonden zijn (de hub houdt ze naast elkaar): zoek het op naam.
const uiFile = async () => (await hub.status()).files.find((f) => f.fileName === 'UI test file');
const connected = await until(async () => Boolean(await uiFile()));
ok(connected, 'hub ziet de plugin (handshake + origin-check in een echte browser)');
const st = await uiFile();
ok(st && st.fileName === 'UI test file' && st.page === 'Page 1', 'bestandsnaam en pagina doorgegeven');
ok(await until(() => page.evaluate(`document.getElementById('xcState').textContent.startsWith('Connected')`)), 'UI toont "Verbonden"');
const r = await hub.send('get_document', {}, 60000, { file: 'UI test file' });
ok(r && r.echo === 'get_document', 'commando van de hub -> UI -> code -> terug naar de hub', JSON.stringify(r));
ok(await page.evaluate(`document.getElementById('xcLog').textContent.includes('get_document')`), 'activiteit gelogd in de UI');

if (dashUrl) {
  console.log(`\n4. Build: URL vastleggen via de hub en importeren (${dashUrl})`);
  await page.evaluate(`document.querySelector('[data-tab=build]').click();
    document.getElementById('xbUrl').value = ${JSON.stringify(dashUrl)};
    document.getElementById('xbTheme').value = 'light';
    document.getElementById('xbCapture').click();`);
  const done = await until(() => page.evaluate(`document.getElementById('xbResult').textContent.includes('in Figma')`), 60000, 250);
  ok(done, 'resultaat "in Figma" getoond');
  const txt = await page.evaluate(`document.getElementById('xbResult').textContent`);
  ok(/\d+ text layers/.test(txt) && /frames/.test(txt), `samenvatting: ${txt.replace(/\s+/g, ' ').slice(0, 110)}`);
  if (shotDir) writeFileSync(join(shotDir, 'ui-build.png'), Buffer.from(await page.screenshot(), 'base64'));
}

console.log('\n5. Rubric-rapport renderen');
await page.evaluate(`document.querySelector('[data-tab=rubric]').click(); document.getElementById('xrAudit').click()`);
const rendered = await until(() => page.evaluate(`document.getElementById('xrOut').textContent.includes('Local variables')`));
ok(rendered, 'rapport getoond');
const rtxt = await page.evaluate(`document.getElementById('xrOut').textContent`);
ok(/3 color fills bound/.test(rtxt) && /97 hard-coded/.test(rtxt), 'toont hoeveel kleuren echt aan tokens hangen');
ok(/Property 1/.test(rtxt) && /Variant2/.test(rtxt), 'toont generieke variantnamen');
ok(await page.evaluate(`!document.getElementById('xrAudit').disabled`), 'knoppen weer bruikbaar na het rapport');
if (shotDir) writeFileSync(join(shotDir, 'ui-rubric.png'), Buffer.from(await page.screenshot(), 'base64'));

console.log('\n6. Verbreken');
await page.evaluate(`document.querySelector('[data-tab=claude]').click(); document.getElementById('xcToggle').click()`);
ok(await until(async () => !(await uiFile())), 'hub ziet de plugin vertrekken');
ok(await until(() => page.evaluate(`document.getElementById('xcState').textContent === 'Not connected'`)), 'UI toont "Niet verbonden" (geen herverbind-lus na handmatig verbreken)');
await sleep(2500);
ok(!(await uiFile()), 'en blijft verbroken');
if (shotDir) writeFileSync(join(shotDir, 'ui-claude.png'), Buffer.from(await page.screenshot(), 'base64'));

ok(page.errors.length === 0, 'geen JavaScript-fouten tijdens de hele test', page.errors.slice(0, 3).join(' | '));

await page.close();
await hub.close();
console.log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed ? 1 : 0);
