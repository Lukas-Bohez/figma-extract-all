// owner.test.mjs — the owner build of the plugin, and the proof that the public build has none of it.
//
//   node test/owner.test.mjs
//
// It builds the owner variant with a throw-away key into test/.tmp (never over a real code.owner.js), then runs it
// against the same Figma mock as plugin.test.mjs.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { createFigma } from './figma-mock.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.mjs';
import { OWNER_COMMANDS, readOwnerKey, withOwnerKey } from '../src/owner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const KEY = 'test-owner-key-0123456789';

let passed = 0, failed = 0;
const ok = (cond, label, extra) => {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? '  -> ' + extra : ''}`); }
};

// ───────────────────────── 1. the key and the bridge
console.log('\n1. De sleutel in de bridge');
ok(readOwnerKey({}, null) === null, 'zonder FIGMA_OWNER_KEY en zonder bestand is er geen sleutel');
ok(readOwnerKey({ FIGMA_OWNER_KEY: 'te-kort' }, null) === null, 'een te korte sleutel telt niet');
ok(readOwnerKey({ FIGMA_OWNER_KEY: `  ${KEY}  ` }, null) === KEY, 'een geldige sleutel wordt gelezen (spaties eraf)');
mkdirSync(join(HERE, '.tmp'), { recursive: true });
const keyFile = join(HERE, '.tmp', 'owner-key');
writeFileSync(keyFile, `${KEY}\n`);
ok(readOwnerKey({}, keyFile) === KEY, 'zonder omgevingsvariabele wordt het sleutelbestand gelezen');
ok(readOwnerKey({ FIGMA_OWNER_KEY: 'een-andere-sleutel-1234' }, keyFile) === 'een-andere-sleutel-1234', 'de omgevingsvariabele wint van het bestand');
ok(readOwnerKey({}, join(HERE, '.tmp', 'bestaat-niet')) === null, 'een ontbrekend bestand geeft geen sleutel');
ok(withOwnerKey('add_variant', { setId: '1' }, KEY).ownerKey === KEY, 'een eigenaarscommando krijgt de sleutel mee');
ok(!('ownerKey' in withOwnerKey('update', { id: '1' }, KEY)), 'een gewoon commando krijgt de sleutel NIET mee');
ok(!('ownerKey' in withOwnerKey('add_variant', { setId: '1' }, null)), 'zonder sleutel gaat er niets mee');
ok(['owner_status', 'move_node', 'add_variant', 'set_variant'].every((c) => OWNER_COMMANDS.has(c)), 'de eigenaarscommando\'s staan in de lijst');

// ───────────────────────── 2. the public build has nothing of it
console.log('\n2. De publieke build (code.js)');
const PUBLIC = readFileSync(join(ROOT, 'code.js'), 'utf8');
ok(!/add_variant|set_variant|owner_status|OWNER_KEY/.test(PUBLIC), 'code.js bevat geen eigenaarscommando en geen sleutel');

// ───────────────────────── 3. build the owner variant
console.log('\n3. De eigenaarsbuild');
mkdirSync(join(HERE, '.tmp'), { recursive: true });
const OUT = join(HERE, '.tmp', 'code.owner.test.js');
const noKey = spawnSync(process.execPath, [join(ROOT, 'build-owner.mjs'), '--out', OUT], { env: { ...process.env, FIGMA_OWNER_KEY: '' }, encoding: 'utf8' });
ok(noKey.status !== 0 && /FIGMA_OWNER_KEY/.test(noKey.stderr), 'zonder sleutel weigert build-owner.mjs te bouwen');
const built = spawnSync(process.execPath, [join(ROOT, 'build-owner.mjs'), '--out', OUT], { env: { ...process.env, FIGMA_OWNER_KEY: KEY }, encoding: 'utf8', shell: false });
ok(built.status === 0, 'met sleutel bouwt hij', built.stderr || built.stdout);
const OWNER = readFileSync(OUT, 'utf8');
ok(/add_variant/.test(OWNER) && /move_node/.test(OWNER), 'de eigenaarsbuild kent de eigenaarscommando\'s');

function boot(code) {
  const m = createFigma();
  const ctx = vm.createContext({
    figma: m.figma, __html__: '<html></html>', console,
    setTimeout, clearTimeout, setInterval, clearInterval, Uint8Array, Uint32Array, DataView, Promise,
  });
  vm.runInContext(code, ctx, { filename: 'code.js' });
  let reqId = 0;
  const cmd = async (name, params = {}) => {
    const id = `t${++reqId}`;
    await m.send({ type: 'x:bridge-cmd', id, cmd: name, params });
    const r = m.posted.find((p) => p.type === 'x:bridge-result' && p.id === id);
    if (!r) throw new Error(`geen antwoord op ${name}`);
    return r;
  };
  return { m, cmd };
}

// ───────────────────────── 4. the public build refuses them
console.log('\n4. De publieke build weigert eigenaarscommando\'s');
{
  const { cmd } = boot(PUBLIC);
  const r = await cmd('add_variant', { setId: '1', set: { variant: 'x' }, ownerKey: KEY });
  ok(!r.ok && /Onbekend commando/.test(r.error), 'add_variant is onbekend, ook met de sleutel', JSON.stringify(r));
}

// ───────────────────────── 5. the owner build, with and without the key
console.log('\n5. De eigenaarsbuild vraagt de sleutel');
const { m, cmd } = boot(OWNER);
{
  const r = await cmd('owner_status', {});
  ok(!r.ok && /eigenaar/.test(r.error), 'zonder sleutel: geweigerd', JSON.stringify(r));
  const wrong = await cmd('owner_status', { ownerKey: KEY + 'x' });
  ok(!wrong.ok, 'met een verkeerde sleutel: geweigerd');
  const shorter = await cmd('owner_status', { ownerKey: KEY.slice(0, -1) });
  ok(!shorter.ok, 'met een te korte sleutel: geweigerd');
  const good = await cmd('owner_status', { ownerKey: KEY });
  ok(good.ok && good.result.owner === true && good.result.commands.includes('add_variant'), 'met de sleutel: owner_status werkt', JSON.stringify(good));
}

// A small design system: a Button set with variant and size, the way the Figma file has it
async function makeButtonSet() {
  const root = m.page;
  const made = [];
  for (const [variant, size] of [['primary', 'md'], ['secondary', 'md'], ['secondary', 'sm']]) {
    const f = m.figma.createFrame();
    f.name = `variant=${variant}, size=${size}`;
    root.appendChild(f);
    const t = m.figma.createText();
    await m.figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    t.characters = 'Label'; t.name = 'Label';
    f.appendChild(t);
    made.push(m.figma.createComponentFromNode(f));
  }
  const set = m.figma.combineAsVariants(made, root);
  set.name = 'Button';
  return { set, made };
}

console.log('\n6. add_variant: een variant toevoegen aan een bestaande set');
{
  const { set, made } = await makeButtonSet();
  const add = await cmd('add_variant', { ownerKey: KEY, setId: set.id, from: { variant: 'secondary', size: 'md' }, set: { variant: 'ghost' }, texts: { Label: 'Ghost' } });
  ok(add.ok && add.result.name === 'variant=ghost, size=md', 'de nieuwe variant heet variant=ghost, size=md', JSON.stringify(add));
  ok(set.children.length === 4, 'de set heeft nu 4 varianten');
  const created = await m.figma.getNodeByIdAsync(add.result.id);
  ok(created && created.parent === set, 'de kopie zit in de set');
  ok(created.findOne((n) => n.type === 'TEXT').characters === 'Ghost', 'de tekst van de kopie is aangepast');
  ok(made[1].findOne((n) => n.type === 'TEXT').characters === 'Label', 'de originele variant is niet aangeraakt');

  const dupe = await cmd('add_variant', { ownerKey: KEY, setId: set.id, set: { variant: 'ghost' }, from: { variant: 'secondary', size: 'md' } });
  ok(!dupe.ok && /bestaat al/.test(dupe.error), 'dezelfde variant twee keer maken wordt geweigerd', JSON.stringify(dupe));
  const unknown = await cmd('add_variant', { ownerKey: KEY, setId: set.id, set: { kleur: 'rood' } });
  ok(!unknown.ok && /geen eigenschap "kleur"/.test(unknown.error), 'een onbekende eigenschap wordt geweigerd', JSON.stringify(unknown));
  const noChange = await cmd('add_variant', { ownerKey: KEY, setId: set.id, set: {} });
  ok(!noChange.ok && /Geef set mee/.test(noChange.error), 'zonder set wordt het geweigerd');
  const notASet = await cmd('add_variant', { ownerKey: KEY, setId: made[0].id, set: { variant: 'x' } });
  ok(!notASet.ok && /geen component set/.test(notASet.error), 'een component zonder set wordt geweigerd');
  const noSource = await cmd('add_variant', { ownerKey: KEY, setId: set.id, from: { variant: 'bestaat-niet' }, set: { variant: 'x' } });
  ok(!noSource.ok && /Geen variant/.test(noSource.error), 'een variant om te kopiëren die niet bestaat wordt geweigerd');
  const noKey = await cmd('add_variant', { setId: set.id, set: { variant: 'zonder-sleutel' } });
  ok(!noKey.ok && set.children.length === 4, 'zonder sleutel verandert er niets');
}

console.log('\n7. set_variant: een instance op een andere variant zetten');
{
  const { set, made } = await makeButtonSet();
  const inst = made[0].createInstance();
  m.page.appendChild(inst);
  const text = m.figma.createText();
  m.page.appendChild(text);
  const r = await cmd('set_variant', { ownerKey: KEY, ids: [inst.id, text.id], props: { variant: 'secondary' } });
  ok(r.ok && r.result.updated.includes(inst.id), 'de instance is aangepast', JSON.stringify(r));
  ok(inst.componentProperties.variant.value === 'secondary', 'de eigenschap staat op secondary');
  ok(r.result.skipped.length === 1 && /geen instance/.test(r.result.skipped[0].reason), 'een laag die geen instance is, wordt overgeslagen en gemeld');
  const bad = await cmd('set_variant', { ownerKey: KEY, ids: [inst.id], props: { variant: 'bestaat-niet' } });
  ok(bad.ok && bad.result.skipped.length === 1 && bad.result.updated.length === 0, 'een ongeldige waarde komt in skipped, zonder crash');
  const none = await cmd('set_variant', { ownerKey: KEY, ids: [inst.id], props: {} });
  ok(!none.ok && /Geef props mee/.test(none.error), 'zonder props wordt het geweigerd');
  void set;
}

console.log('\n8. move_node: een laag naar een andere ouder');
{
  const a = m.figma.createFrame(); a.name = 'A'; m.page.appendChild(a);
  const b = m.figma.createFrame(); b.name = 'B'; m.page.appendChild(b);
  const c1 = m.figma.createFrame(); c1.name = 'c1'; a.appendChild(c1);
  const c2 = m.figma.createFrame(); c2.name = 'c2'; a.appendChild(c2);
  const moved = await cmd('move_node', { ownerKey: KEY, id: c1.id, parentId: b.id });
  ok(moved.ok && c1.parent === b && a.children.length === 1, 'de laag zit nu in B en niet meer in A', JSON.stringify(moved));
  const first = await cmd('move_node', { ownerKey: KEY, id: c2.id, parentId: b.id, index: 0 });
  ok(first.ok && b.children[0] === c2 && first.result.index === 0, 'met index komt hij op die plek');
  const loop = await cmd('move_node', { ownerKey: KEY, id: b.id, parentId: c1.id });
  ok(!loop.ok && /in zichzelf/.test(loop.error), 'een laag in zijn eigen kind zetten wordt geweigerd', JSON.stringify(loop));
  const text = m.figma.createText(); m.page.appendChild(text);
  const noKids = await cmd('move_node', { ownerKey: KEY, id: c1.id, parentId: text.id });
  ok(!noKids.ok && /kan geen kinderen/.test(noKids.error), 'een ouder zonder kinderen wordt geweigerd');
  const noKey = await cmd('move_node', { id: c1.id, parentId: a.id });
  ok(!noKey.ok && c1.parent === b, 'zonder sleutel blijft alles staan');
}

console.log('\n9. De MCP-tools: alleen met sleutel, en de sleutel gaat enkel mee met eigenaarscommando\'s');
async function mcpWith(ownerKey) {
  const sent = [];
  const hub = { send: async (name, params) => { sent.push({ name, params }); return { ok: true }; }, status: async () => ({ plugin: true }) };
  const server = createMcpServer(hub, { ownerKey });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  return { tools: tools.map((t) => t.name), sent, client };
}
{
  const open = await mcpWith(null);
  ok(!open.tools.some((n) => /owner|move_node|add_variant|set_variant/.test(n)), 'zonder sleutel biedt de bridge geen eigenaarstools aan', open.tools.filter((n) => /owner|move|variant/.test(n)).join(','));
  const owner = await mcpWith(KEY);
  for (const n of ['figma_owner_status', 'figma_move_node', 'figma_add_variant', 'figma_set_variant']) ok(owner.tools.includes(n), `met sleutel: ${n}`);
  await owner.client.callTool({ name: 'figma_add_variant', arguments: { setId: '1:2', set: { variant: 'ghost' } } });
  await owner.client.callTool({ name: 'figma_get_components', arguments: {} });
  const addCall = owner.sent.find((c) => c.name === 'add_variant');
  const readCall = owner.sent.find((c) => c.name === 'get_components');
  ok(addCall && addCall.params.ownerKey === KEY, 'het eigenaarscommando draagt de sleutel');
  ok(readCall && !('ownerKey' in (readCall.params || {})), 'een gewoon commando draagt hem niet');
}

console.log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed ? 1 : 0);
