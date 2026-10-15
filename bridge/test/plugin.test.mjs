// plugin.test.mjs — runs the REAL compiled code.js against figma-mock.mjs.
//
//   node test/plugin.test.mjs [path/to/capture.json]
//
// Without an argument it uses a small built-in layout document.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createFigma } from './figma-mock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CODE = readFileSync(join(HERE, '..', '..', 'code.js'), 'utf8');

let passed = 0, failed = 0;
const ok = (cond, label, extra) => {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? '  -> ' + extra : ''}`); }
};

function boot() {
  const m = createFigma();
  const ctx = vm.createContext({
    figma: m.figma, __html__: '<html></html>', console,
    setTimeout, clearTimeout, setInterval, clearInterval, Uint8Array, Uint32Array, DataView, Promise,
  });
  vm.runInContext(CODE, ctx, { filename: 'code.js' });
  const last = (type) => [...m.posted].reverse().find((p) => p.type === type);
  let reqId = 0;
  const cmd = async (name, params = {}) => {
    const id = `t${++reqId}`;
    await m.send({ type: 'x:bridge-cmd', id, cmd: name, params });
    const r = m.posted.find((p) => p.type === 'x:bridge-result' && p.id === id);
    if (!r) throw new Error(`geen antwoord op ${name}`);
    return r;
  };
  return { m, ctx, last, cmd };
}

const smallDoc = {
  format: 'figma-layout', version: 1,
  source: { title: 'Mini', colorScheme: 'light' },
  root: {
    type: 'FRAME', name: 'page', x: 0, y: 0, w: 400, h: 300, clip: true,
    fills: [{ type: 'SOLID', color: { r: 0.97, g: 0.97, b: 0.98, a: 1 } }],
    children: [
      {
        type: 'FRAME', name: 'card', x: 16, y: 16, w: 200, h: 120,
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
        stroke: { color: { r: 0.9, g: 0.9, b: 0.92, a: 1 }, weights: [1, 1, 1, 1] },
        radius: [14, 14, 14, 14],
        shadows: [{ x: 0, y: 2, blur: 8, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.08 }, inset: false }],
        layout: { mode: 'VERTICAL', wrap: false, gap: 12, padding: [16, 16, 16, 16], primary: 'MIN', counter: 'BASELINE' },
        children: [
          { type: 'TEXT', name: 'title', x: 32, y: 32, w: 90, h: 24, text: 'Healthy 124ms',
            font: { family: 'Inter', weight: 600, italic: false, size: 18, lineHeight: 24, letterSpacing: 0 },
            color: { r: 0.1, g: 0.1, b: 0.1, a: 1 }, align: 'LEFT', wrap: false,
            runs: [
              { text: 'Healthy ', font: { family: 'Inter', weight: 600, italic: false, size: 18, lineHeight: 24, letterSpacing: 0 }, color: { r: 0, g: 0.47, b: 0.24, a: 1 } },
              { text: '124ms', font: { family: 'system-ui', weight: 400, italic: false, size: 18, lineHeight: 24, letterSpacing: 0 }, color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } },
            ] },
          { type: 'SVG', name: 'icon', x: 32, y: 68, w: 16, h: 16, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path d="M5 12h14" stroke="rgb(0,0,0)"/></svg>' },
          { type: 'FRAME', name: 'badge', x: 140, y: 20, w: 60, h: 20, absolute: true, fills: [{ type: 'SOLID', color: { r: 0.84, g: 0.96, b: 0.88, a: 1 } }], radius: [999, 999, 999, 999], children: [] },
        ],
      },
      { type: 'IMAGE', name: 'logo', x: 240, y: 16, w: 32, h: 32, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
      { type: 'IMAGE', name: 'cors-blocked', x: 280, y: 16, w: 32, h: 32, src: null },
      { type: 'SVG', name: 'broken', x: 320, y: 16, w: 10, h: 10, svg: 'not an svg' },
      { type: 'TEXT', name: 'centered', x: 16, y: 200, w: 368, h: 40, text: 'A centred paragraph that wraps onto two lines',
        font: { family: 'Inter', weight: 400, italic: false, size: 14, lineHeight: 20, letterSpacing: 0.2 },
        color: { r: 0.3, g: 0.3, b: 0.3, a: 1 }, align: 'CENTER', wrap: true },
    ],
  },
};

// ───────────────────────────────────────────────────────────── 1. boot + routing
console.log('\n1. Opstarten en berichtroutering');
{
  const { m, ctx } = boot();
  ok(m.figma._shown, 'showUI aangeroepen');
  await m.send({ type: 'x:hello' });
  const info = m.posted.find((p) => p.type === 'x:info');
  ok(info && info.featureVersion === '19.2.0', 'x:hello -> x:info met featureVersion', JSON.stringify(info));

  // The guard: a feature message must NOT reset the ZIP buffer of code.ts.
  vm.runInContext('zipFiles.push({ name: "a.txt", data: new Uint8Array(1) }); cancelRequested = true;', ctx);
  await m.send({ type: 'x:hello' });
  ok(vm.runInContext('zipFiles.length', ctx) === 1, 'x:-bericht laat zipFiles van code.ts ongemoeid');
  ok(vm.runInContext('cancelRequested', ctx) === true, 'x:-bericht laat een cancel staan');
  // ...and the test is sensitive: an original message DOES reset them.
  await m.send({ type: 'resize', width: 520, height: 700 });
  ok(vm.runInContext('zipFiles.length', ctx) === 0, 'controle: een gewoon bericht wist zipFiles wél (test is gevoelig)');
}

// ───────────────────────────────────────────────────────────── 2. build: small doc
console.log('\n2. Build — klein document met alle soorten lagen');
{
  const { m } = boot();
  await m.send({ type: 'x:layout-import', doc: smallDoc, options: { autoLayout: true } });
  const err = m.posted.find((p) => p.type === 'x:error');
  const done = m.posted.find((p) => p.type === 'x:layout-done');
  ok(!err, 'geen x:error', err && err.message);
  ok(done, 'x:layout-done ontvangen');
  const r = done ? done.result : {};
  ok(r.counts && r.counts.TEXT === 2 && r.counts.SVG === 2 && r.counts.IMAGE === 2, 'aantallen per type kloppen', JSON.stringify(r.counts));
  ok((r.warnings || []).some((w) => /SVG "broken"/.test(w)), 'kapotte SVG -> waarschuwing i.p.v. crash');
  ok((r.warnings || []).some((w) => /cors-blocked/.test(w)), 'afbeelding zonder bron -> waarschuwing');

  const root = m.page.children[0];
  ok(root && root.name === 'Mini (light)', 'rootnaam = titel + kleurschema', root && root.name);
  const card = root.children.find((c) => c.name === 'card');
  ok(card && card.layoutMode === 'VERTICAL' && card.itemSpacing === 12 && card.paddingTop === 16, 'flexbox -> auto layout (richting, gap, padding)');
  ok(card && card.counterAxisAlignItems === 'MIN', 'BASELINE in verticale layout -> MIN (Figma staat dat niet toe)');
  ok(card && card.cornerRadius === 14 && card.effects.length === 1 && card.strokes.length === 1, 'radius, schaduw en rand overgenomen');
  const badge = card.children.find((c) => c.name === 'badge');
  ok(badge && badge.layoutPositioning === 'ABSOLUTE' && badge.x === 124 && badge.y === 4, 'absoluut kind in auto layout: ABSOLUTE + juiste positie', badge && `${badge.layoutPositioning} ${badge.x},${badge.y}`);
  const title = card.children.find((c) => c.type === 'TEXT');
  ok(title && title.characters === 'Healthy 124ms', 'tekst met styled runs samengevoegd');
  ok(title && title.ranges.filter((x) => x[0] === 'font').length === 2, 'twee runs -> twee font-ranges');
  ok(title && title.ranges.some((x) => x[0] === 'font' && x[3].family === 'Inter' && x[3].style === 'Regular'), 'system-ui valt terug op Inter Regular');
  ok(title && title.fontName.style === 'Semi Bold', 'weight 600 -> Inter Semi Bold', title && title.fontName.style);
  const centered = root.children.find((c) => c.name === 'centered');
  ok(centered && centered.textAutoResize === 'HEIGHT' && centered.width === 368, 'gecentreerde tekst houdt browserbreedte');
  const logo = root.children.find((c) => c.name === 'logo');
  ok(logo && logo.fills[0] && logo.fills[0].type === 'IMAGE', 'data-URL -> IMAGE-fill');
  ok(m.page.selection[0] === root, 'resultaat geselecteerd');
}

// ───────────────────────────────────────────────────────────── 3. build: without auto layout
console.log('\n3. Build — zonder auto layout (alles absoluut)');
{
  const { m } = boot();
  await m.send({ type: 'x:layout-import', doc: smallDoc, options: { autoLayout: false } });
  const done = m.posted.find((p) => p.type === 'x:layout-done');
  const card = m.page.children[0]?.children.find((c) => c.name === 'card');
  ok(done && card && card.layoutMode === 'NONE', 'geen auto layout wanneer uitgezet');
  const badge = card && card.children.find((c) => c.name === 'badge');
  ok(badge && badge.x === 124 && badge.y === 4 && badge.layoutPositioning === 'AUTO', 'badge absoluut geplaatst zonder layoutPositioning te zetten');
}

// ───────────────────────────────────────────────────────────── 4. build: real capture
const capPath = process.argv[2];
if (capPath && existsSync(capPath)) {
  console.log(`\n4. Build — echte capture (${capPath.split(/[\\/]/).pop()})`);
  const doc = JSON.parse(readFileSync(capPath, 'utf8'));
  for (const auto of [true, false]) {
    const { m } = boot();
    const t0 = Date.now();
    await m.send({ type: 'x:layout-import', doc, options: { autoLayout: auto } });
    const err = m.posted.find((p) => p.type === 'x:error');
    const done = m.posted.find((p) => p.type === 'x:layout-done');
    const r = done ? done.result : null;
    ok(!err && r, `import zonder fout (autoLayout=${auto}) in ${Date.now() - t0} ms`, err && err.message);
    if (r) {
      const c = r.counts, e = doc.counts;
      ok(c.TEXT === e.TEXT && c.SVG === e.SVG && c.IMAGE === e.IMAGE, `alle tekst/SVG/afbeeldingen gebouwd (${c.TEXT}/${e.TEXT} tekst, ${c.SVG}/${e.SVG} svg)`);
      ok(Math.abs(c.FRAME - e.FRAME) <= 1, `frames: ${c.FRAME} gebouwd, ${e.FRAME} vastgelegd (+1 = root)`);
      ok(r.warnings.length === 0, `geen waarschuwingen (${r.warnings.length})`, r.warnings.slice(0, 3).join(' | '));
      if (auto) {
        const autos = m.page.findAll((n) => n.layoutMode && n.layoutMode !== 'NONE').length;
        ok(autos > 20, `auto layout toegepast op ${autos} frames`);
      }
    }
  }
} else {
  console.log('\n4. (overgeslagen: geef een capture.json mee om een echte pagina te testen)');
}

// ───────────────────────────────────────────────────────────── 5. rubric check
console.log('\n5. Rubric check');
{
  const { m } = boot();
  await m.send({ type: 'x:layout-import', doc: smallDoc });
  await m.send({ type: 'x:rubric-audit' });
  const rep = m.posted.find((p) => p.type === 'x:rubric-report')?.report;
  ok(rep, 'rapport ontvangen');
  ok(rep && rep.hasSpacing === false && rep.missingTextStyles.length === 7, 'ontbrekende spacing en tekststijlen gedetecteerd');
  ok(rep && rep.fillsRaw > 0 && rep.fillsBound === 0, `hardgecodeerde kleuren geteld (${rep && rep.fillsRaw} raw, 0 gebonden)`);
  ok(rep && rep.textUnstyled === 2, 'tekst zonder stijl geteld');

  await m.send({ type: 'x:rubric-spacing' });
  await m.send({ type: 'x:rubric-textstyles' });
  const reps = m.posted.filter((p) => p.type === 'x:rubric-report');
  const after = reps[reps.length - 1].report;
  ok(after.hasSpacing === true, 'spacing-variabelen aangemaakt');
  ok(after.missingTextStyles.length === 0, 'alle 7 tekststijlen aangemaakt', JSON.stringify(after.missingTextStyles));
  const col = m.collections.find((c) => c.name === 'primitives');
  const s2 = m.variables.find((v) => v.name === 'space/2');
  ok(col && s2 && s2.valuesByMode[col.modes[0].modeId] === 8, 'space/2 = 8');
  // idempotent
  const before = m.variables.length;
  await m.send({ type: 'x:rubric-spacing' });
  ok(m.variables.length === before, 'opnieuw draaien maakt geen dubbele variabelen');
}

// ───────────────────────────────────────────────────────────── 6. bridge commands
console.log('\n6. Bridge-commando\'s (wat Claude kan doen)');
{
  const { m, cmd } = boot();
  let r = await cmd('status');
  ok(r.ok && r.result.fileName === 'Interaction Design' && r.result.featureVersion === '19.2.0', 'status');

  r = await cmd('create', { kind: 'FRAME', name: 'Button', width: 120, height: 40, fill: '#111827', cornerRadius: 999,
    layout: { mode: 'HORIZONTAL', gap: 8, padding: [8, 16], primary: 'CENTER', counter: 'CENTER' } });
  ok(r.ok, 'create FRAME met auto layout', r.error);
  const btnId = r.result && r.result.id;
  r = await cmd('create', { kind: 'TEXT', parentId: btnId, text: 'Deploy', fontSize: 14, fontWeight: 500, fill: '#ffffff', sizing: { h: 'HUG', v: 'HUG' } });
  ok(r.ok, 'create TEXT in de knop (font eerst geladen)', r.error);
  const btn = m.registry.get(btnId);
  ok(btn && btn.paddingLeft === 16 && btn.paddingTop === 8, 'padding [8,16] -> t/b 8, l/r 16');

  r = await cmd('get_node', { id: btnId, depth: 2 });
  ok(r.ok && r.result.nodes[0].autoLayout && r.result.nodes[0].children[0].characters === 'Deploy', 'get_node geeft layout en tekst terug', r.error);

  r = await cmd('update', { ids: [btnId], props: { name: 'Button/primary', fill: '#0f172a' } });
  ok(r.ok && btn.name === 'Button/primary', 'update naam + vulling');

  r = await cmd('create_variables', { collection: 'tokens', modes: ['Light', 'Dark'], variables: [
    { name: 'base/grey/950', type: 'COLOR', values: { Light: '#111827', Dark: '#111827' } },
    { name: 'base/grey/0', type: 'COLOR', values: { Light: '#ffffff', Dark: '#ffffff' } },
    { name: 'semantic/accent', type: 'COLOR', values: { Light: { alias: 'base/grey/950' }, Dark: { alias: 'base/grey/0' } } },
    { name: 'space/4', type: 'FLOAT', value: 16 },
  ] });
  ok(r.ok && r.result.modes.join() === 'Light,Dark', 'variabelen met modes Light/Dark', r.error);
  const accent = m.variables.find((v) => v.name === 'semantic/accent');
  ok(accent && Object.values(accent.valuesByMode).every((v) => v.type === 'VARIABLE_ALIAS'), 'semantic/accent is een alias (2e laag)');

  r = await cmd('bind_variable', { ids: [btnId], field: 'fill', variable: 'semantic/accent' });
  ok(r.ok && btn.fills[0].boundVariables && btn.fills[0].boundVariables.color, 'fill gebonden aan variabele', r.error);
  r = await cmd('bind_variable', { ids: [btnId], field: 'paddingLeft', variable: 'space/4' });
  ok(r.ok && btn.boundVariables.paddingLeft, 'padding gebonden aan space/4', r.error);

  r = await cmd('create_text_styles');
  ok(r.ok && r.result.made.length === 7, 'create_text_styles', r.error);
  const textId = btn.children[0].id;
  r = await cmd('apply_text_style', { ids: [textId], style: 'text/sm' });
  ok(r.ok && btn.children[0].textStyleId, 'apply_text_style', r.error);

  r = await cmd('create_component', { id: btnId, name: 'variant=primary, size=md' });
  ok(r.ok, 'create_component', r.error);
  const c1 = r.result.components[0].id;
  r = await cmd('create', { kind: 'FRAME', name: 'variant=ghost, size=md', width: 120, height: 40 });
  const c2raw = r.result.id;
  r = await cmd('combine_as_variants', { ids: [c1, c2raw], name: 'Button' });
  ok(r.ok && r.result.variantProperties.join() === 'variant,size', 'combine_as_variants met betekenisvolle properties', r.error || JSON.stringify(r.result));

  r = await cmd('rubric_check');
  ok(r.ok && r.result.componentSets.length === 1 && r.result.genericVariants.length === 0, 'rubric ziet de set, geen generieke namen', r.error);
  ok(r.ok && r.result.fillsBound >= 1, `rubric telt gebonden vullingen (${r.ok && r.result.fillsBound})`);

  r = await cmd('screenshot', { id: m.page.children[0].id });
  ok(r.ok && r.result.images[0].base64.length > 0, 'screenshot geeft base64-PNG', r.error);

  r = await cmd('get_variables');
  ok(r.ok && r.result.collections.find((c) => c.name === 'tokens').variables.find((v) => v.name === 'semantic/accent').values.Light.alias === 'base/grey/950', 'get_variables toont aliassen op naam');

  r = await cmd('import_layout', { doc: smallDoc, options: { autoLayout: true } });
  ok(r.ok && r.result.counts.TEXT === 2, 'import_layout via de bridge', r.error);

  r = await cmd('delete', { ids: [r.result.rootId] });
  ok(r.ok, 'delete');

  // ── components used as instances, a variable mode, spacing bound to variables ──
  r = await cmd('create', { kind: 'FRAME', name: 'variant=solid', width: 120, height: 40 });
  const solidId = r.result.id;
  await cmd('create', { kind: 'TEXT', name: 'Label', text: 'Go', parentId: solidId });
  r = await cmd('create', { kind: 'FRAME', name: 'variant=outline', width: 120, height: 40 });
  const outlineId = r.result.id;
  await cmd('create', { kind: 'TEXT', name: 'Label', text: 'Go', parentId: outlineId });
  const solidComp = (await cmd('create_component', { ids: [solidId] })).result.components[0].id;
  const outlineComp = (await cmd('create_component', { ids: [outlineId] })).result.components[0].id;
  r = await cmd('combine_as_variants', { ids: [solidComp, outlineComp], name: 'Pill' });
  const pillSet = r.result.id;

  r = await cmd('get_components');
  const listed = r.ok && r.result.components.find((c) => c.id === pillSet);
  ok(listed && listed.variants.length === 2, 'get_components toont de set met zijn varianten', r.error);

  r = await cmd('create', { kind: 'FRAME', name: 'host', width: 300, height: 200 });
  const hostId = r.result.id;
  r = await cmd('create_instance', { componentId: pillSet, variant: { variant: 'outline' }, parentId: hostId, texts: { Label: 'Save' }, props: { name: 'Pill/save' } });
  ok(r.ok && r.result.textsSet.join() === 'Label', 'create_instance met een variant en een tekst-override', r.error);
  const instId = r.ok && r.result.id;
  r = await cmd('get_node', { ids: [instId], depth: 3 });
  ok(r.ok && JSON.stringify(r.result).includes('Save'), 'de instance toont de nieuwe tekst', r.error);
  r = await cmd('create_instance', { componentId: pillSet, variant: { variant: 'nope' }, parentId: hostId });
  ok(!r.ok && /Geen variant/.test(r.error), 'onbekende variant -> uitleg', r.error);
  r = await cmd('create_instance', { componentId: pillSet, variant: { variant: 'solid' }, parentId: hostId, texts: { Nope: 'x' } });
  ok(!r.ok && /Geen tekstlaag/.test(r.error), 'onbekende tekstlaag -> uitleg', r.error);

  r = await cmd('set_variable_mode', { ids: [hostId], collection: 'tokens', mode: 'Dark' });
  ok(r.ok && r.result.mode === 'Dark', 'set_variable_mode zet de Dark-mode op een frame', r.error);
  r = await cmd('set_variable_mode', { ids: [hostId], collection: 'tokens', mode: 'Pink' });
  ok(!r.ok && /Mode "Pink"/.test(r.error), 'onbekende mode -> uitleg', r.error);

  r = await cmd('create', { kind: 'FRAME', name: 'spaced', width: 200, height: 100, layout: { mode: 'VERTICAL', gap: 12, padding: 16 }, cornerRadius: 8 });
  const spacedId = r.result.id;
  r = await cmd('bind_raw_spacing', { ids: [spacedId], map: { 16: 'space/4' }, radiusMap: { 8: 'space/4' } });
  ok(r.ok && r.result.bound['16 -> space/4'] === 4, 'bind_raw_spacing bindt de vier paddings', r.error || JSON.stringify(r.result));
  ok(r.ok && r.result.bound['radius 8 -> space/4'] === 4, 'bind_raw_spacing bindt ook de hoekradius', JSON.stringify(r.result));
  ok(r.ok && r.result.offGrid['itemSpacing=12'] === 1, 'waarden zonder variabele komen in offGrid', JSON.stringify(r.result && r.result.offGrid));
  r = await cmd('bind_raw_spacing', { ids: [spacedId], map: { 16: 'space/zzz' } });
  ok(!r.ok && /bestaat niet/.test(r.error), 'onbekende variabele -> uitleg', r.error);

  // ── build: a whole chart in one command, bound to variables and text styles ──
  r = await cmd('create_variables', {
    collection: 'viz', modes: ['Light', 'Dark'],
    variables: [
      { name: 'color/surface', type: 'COLOR', values: { Light: '#ffffff', Dark: '#111111' }, codeSyntax: 'var(--color-surface)', description: 'het vlak' },
      { name: 'color/chart/fiets', type: 'COLOR', values: { Light: '#d55e00', Dark: '#f8a85b' } },
      { name: 'radius/md', type: 'FLOAT', value: 8 },
      { name: 'space/200', type: 'FLOAT', value: 16 },
    ],
  });
  ok(r.ok, 'create_variables met codeSyntax en description', r.error);
  r = await cmd('create_text_styles_bulk', { styles: [{ name: 'title', size: 36, weight: 700, family: 'Inter', lineHeightPercent: 115 }], update: true });
  ok(r.ok, 'tekststijl title aangemaakt', r.error);
  r = await cmd('get_variables');
  const vizVar = r.ok && r.result.collections.find((c) => c.name === 'viz').variables.find((v) => v.name === 'color/surface');
  ok(vizVar && vizVar.codeSyntax.WEB === 'var(--color-surface)' && vizVar.description === 'het vlak', 'get_variables toont code syntax en omschrijving');
  r = await cmd('set_code_syntax', { map: { 'radius/md': 'var(--radius-md)' } });
  ok(r.ok && r.result.set === 1, 'set_code_syntax zet de code syntax van een bestaande variabele', r.error);
  await cmd('create_variables', { collection: 'scratch', variables: [{ name: 'tmp/x', type: 'FLOAT', value: 1 }] });
  r = await cmd('delete_variables', { collections: ['scratch'] });
  ok(r.ok && r.result.removed.includes('collectie scratch'), 'delete_variables verwijdert een collectie', r.error);
  r = await cmd('get_variables');
  ok(r.ok && !r.result.collections.some((c) => c.name === 'scratch'), 'de collectie is echt weg');

  const tree = {
    kind: 'FRAME', name: 'Chart', key: 'root', width: 400, height: 240, fillVar: 'color/surface',
    layout: { mode: 'VERTICAL', gap: 8, padding: 16 }, vars: { cornerRadius: 'radius/md', itemSpacing: 'space/200' },
    children: [
      { kind: 'TEXT', name: 'titel', key: 'title', text: 'Hallo', textStyle: 'title', fillVar: 'color/chart/fiets', width: 300 },
      {
        kind: 'FRAME', name: 'plot', key: 'plot', width: 360, height: 120, fill: 'none',
        children: [
          { kind: 'VECTOR', name: 'lijn', key: 'line', path: 'M0 0 L100 40', x: 10, y: 10, stroke: { color: '#000000', weight: 2, cap: 'ROUND', dash: [4, 4] }, strokeVar: 'color/chart/fiets' },
          { kind: 'ELLIPSE', name: 'ring', key: 'ring', width: 60, height: 60, fillVar: 'color/chart/fiets', arc: { start: 0, end: 3.14, inner: 0.6 }, rotation: 15 },
        ],
      },
    ],
  };
  r = await cmd('build', { tree });
  ok(r.ok && r.result.count === 5 && r.result.roots.length === 1, 'build maakt de hele boom in een commando', r.error || JSON.stringify(r.result));
  const keys = r.ok ? r.result.keys : {};
  const reg = (id) => m.registry.get(id);
  ok(reg(keys.root).boundVariables.itemSpacing && reg(keys.root).boundVariables.topLeftRadius && reg(keys.root).boundVariables.bottomRightRadius,
    'build bindt spacing en radius (alle vier de hoeken) aan variabelen');
  ok(reg(keys.root).fills[0].boundVariables?.color, 'build bindt de vulling aan een variabele op naam');
  ok(reg(keys.title).textStyleId && reg(keys.title).fills[0].boundVariables?.color, 'build past een tekststijl toe en bindt de tekstkleur');
  ok(reg(keys.title).textAutoResize === 'HEIGHT' && reg(keys.title).width === 300, 'tekst met breedte breekt af en groeit in hoogte');
  ok(reg(keys.line).type === 'VECTOR' && reg(keys.line).vectorPaths[0].data === 'M0 0 L100 40' && reg(keys.line).strokes[0].boundVariables?.color,
    'build maakt een vectorpad met een gebonden streek');
  ok(reg(keys.line).strokeCap === 'ROUND' && reg(keys.line).dashPattern.join() === '4,4', 'streekeinde en streeppatroon komen mee');
  ok(reg(keys.line).strokeAlign === 'CENTER' && reg(keys.plot).strokeAlign !== 'CENTER', 'een vectorlijn heeft standaard een streek in het midden (anders is een rechte lijn onzichtbaar)');
  ok(reg(keys.ring).arcData.innerRadius === 0.6 && reg(keys.ring).arcData.endingAngle === 3.14 && reg(keys.ring).rotation === 15, 'build maakt een ring met boog en draaiing');

  r = await cmd('build', { tree: { kind: 'SVG', name: 'icoon', key: 'icon', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M3 3 21 21" stroke="#000" fill="none"/></svg>', strokeVar: 'color/chart/fiets' } });
  ok(r.ok && reg(r.result.keys.icon).fills.length === 0 && reg(r.result.keys.icon).children[0].strokes[0].boundVariables?.color,
    'een SVG-laag: de streek binnenin is aan een variabele gebonden, het frame blijft doorzichtig', r.error);
  r = await cmd('build', { tree: { kind: 'FRAME', name: 'Chart', width: 50, height: 50 }, replaceByName: true });
  const chartId = r.ok && r.result.roots[0].id;
  ok(r.ok && m.page.children.filter((c) => c.name === 'Chart').length === 1 && !m.registry.has(keys.root), 'replaceByName vervangt in plaats van te stapelen');

  const before = m.page.children.length;
  r = await cmd('build', { tree: { kind: 'FRAME', name: 'Broken', width: 100, height: 100, children: [{ kind: 'RECTANGLE', name: 'a', width: 10, height: 10 }, { kind: 'RECTANGLE', name: 'b', width: 10, height: 10, fillVar: 'bestaat/niet' }] } });
  ok(!r.ok && /Broken/.test(r.error) && /niet gevonden/.test(r.error), 'build met een onbekende variabele noemt de laag en de reden', r.error);
  ok(m.page.children.length === before && !m.page.children.some((c) => c.name === 'Broken'), 'een mislukte build laat niets half achter');
  r = await cmd('build', { tree: { kind: 'TEXT', text: 'x', textStyle: 'bestaat-niet' } });
  ok(!r.ok && /Tekststijl "bestaat-niet"/.test(r.error), 'onbekende tekststijl -> uitleg met de bestaande', r.error);

  // ── export: PNG, SVG, PDF, JSON; a .fig is not something a plugin can make ──
  const exportable = chartId;
  r = await cmd('export', { ids: [exportable], format: 'PNG', scale: 3 });
  ok(r.ok && r.result.files[0].scale === 3 && r.result.files[0].base64.length > 0, 'export PNG op schaal 3', r.error);
  r = await cmd('export', { ids: [exportable], format: 'svg' });
  ok(r.ok && Buffer.from(r.result.files[0].base64, 'base64').toString().startsWith('<svg'), 'export SVG', r.error);
  r = await cmd('export', { ids: [exportable], format: 'PDF' });
  ok(r.ok && r.result.files[0].format === 'PDF', 'export PDF', r.error);
  r = await cmd('export', { ids: [exportable], format: 'JSON_REST_V1' });
  ok(r.ok && r.result.files[0].json && r.result.files[0].json.document, 'export JSON_REST_V1 geeft het object terug', r.error);
  r = await cmd('export', { ids: [exportable], format: 'FIG' });
  ok(!r.ok && /Lokale kopie opslaan/.test(r.error), 'export FIG -> eerlijke uitleg waarom dat niet kan', r.error);

  // ── pages ──
  r = await cmd('set_page', { name: 'taak 4', create: true });
  ok(r.ok && r.result.name === 'taak 4', 'set_page maakt een pagina aan en gaat erheen', r.error);
  r = await cmd('status');
  ok(r.ok && r.result.page === 'taak 4', 'de plugin werkt nu op de nieuwe pagina', JSON.stringify(r.result));
  r = await cmd('set_page', { name: 'bestaat niet' });
  ok(!r.ok && /Bestaand:/.test(r.error), 'onbekende pagina -> lijst van bestaande', r.error);

  r = await cmd('get_node', { id: 'doesnotexist' });
  ok(!r.ok && /Geen laag/.test(r.error), 'onbekende id -> nette fout, geen crash');
  r = await cmd('frobnicate');
  ok(!r.ok && /Onbekend commando/.test(r.error), 'onbekend commando -> nette fout');
  r = await cmd('update', { props: { name: 'x' } });
  ok(!r.ok && /selecteer/.test(r.error), 'zonder ids en zonder selectie -> uitleg');
}

console.log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed ? 1 : 0);
