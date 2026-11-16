// End-to-end test: the built plugin, in the REAL FigCraft (its headless CLI), on real design files.
//
//   node build.mjs
//   node test.mjs <figcraft-cli> <design.figcraft> [more designs]
//   (or set FIGCRAFT_CLI)    any file FigCraft opens works: .figcraft, .fig, .penpot, .sketch, REST JSON
//
// The numbers the plugin reports are checked against FigCraft's own counts (`node.find`,
// `variable.list`, `style.list`, `component.list`), which do not go through the plugin's walk.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, 'dist', 'rubric-audit').split(String.fromCharCode(92)).join('/');
const ID = 'io.github.lukas-bohez.rubric-audit';
const args = process.argv.slice(2);
const cli = process.env.FIGCRAFT_CLI || args.shift();
const docs = args;
if (!cli || !docs.length || !existsSync(cli)) {
  console.log('Usage: node test.mjs <path to figcraft-cli> <design file> [more design files]   (or set FIGCRAFT_CLI)');
  process.exit(2);
}
if (!existsSync(join(plugin, 'rubric_audit.wasm'))) {
  console.log('Build first: node build.mjs');
  process.exit(2);
}

let passed = 0, failed = 0;
const ok = (c, label, extra) => { if (c) { passed++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}${extra !== undefined ? '  -> ' + extra : ''}`); } };
const tmp = mkdtempSync(join(tmpdir(), 'rubric-audit-'));
let n = 0;

/** Run a script of commands on a design; returns the result of each step. */
function run(doc, steps) {
  const file = join(tmp, `s${n++}.jsonl`);
  writeFileSync(file, steps.map((s) => JSON.stringify(s)).join('\n') + '\n');
  const r = spawnSync(cli, ['run', file, '--in', doc], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const lines = r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  return lines.map((l) => (l.ok ? l.result : { error: l.error }));
}

for (const doc of docs.map((d) => resolve(d))) {
  console.log(`\n${doc}`);
  const [, pages, variables, components, styles] = run(doc, [
    { command: 'plugin.import', params: { path: plugin } },
    { command: 'page.list', params: {} },
    { command: 'variable.list', params: {} },
    { command: 'component.list', params: {} },
    { command: 'style.list', params: {} },
  ]);
  const found = pages.flatMap((p) => ['text', 'frame', 'component', 'instance'].map((type) => ({ command: 'node.find', params: { root: p.id, type, limit: 1 } })));
  const totals = { text: 0, frame: 0, component: 0, instance: 0 };
  run(doc, found).forEach((r, i) => { totals[['text', 'frame', 'component', 'instance'][i % 4]] += r.total ?? 0; });

  const out = run(doc, [
    { command: 'plugin.import', params: { path: plugin } },
    { command: 'plugin.run', params: { id: ID, command: 'audit' } },
    { command: 'plugin.event', params: { id: ID, control: 'save' } },
    { command: 'plugin.event', params: { id: ID, control: 'again' } },
    { command: 'plugin.close', params: { id: ID } },
  ]);
  const [, first, save, again, closed] = out;
  ok(!first.error, 'the audit runs in FigCraft', first.error);
  if (first.error) continue;
  const report = first.output.report;

  const fuel = first.fuel;
  ok(fuel < 1_000_000_000, `inside FigCraft's fuel limit: ${(fuel / 1e6).toFixed(0)}M of 1000M for ${report.layersChecked} layers`);
  ok(first.calls < 100_000, `inside the host-call limit: ${first.calls} of 100000`);

  if (report.truncated) {
    console.log('  (the file is bigger than one run can cover: the report says so, the numbers below are partial and not compared)');
    ok(report.fuelEstimate < 900_000_000, 'it stopped by itself before FigCraft would have');
  } else {
    ok(report.textTotal === totals.text, `text layers: ${report.textTotal}`, `FigCraft counts ${totals.text}`);
    ok(report.frameTotal === totals.frame + totals.component + totals.instance, `frames, components and instances: ${report.frameTotal}`, `FigCraft counts ${totals.frame + totals.component + totals.instance}`);
    ok(report.instanceCount === totals.instance, `instances: ${report.instanceCount}`, `FigCraft counts ${totals.instance}`);
    ok(report.unreadable === 0, 'every layer could be read', report.unreadable);
    const layers = totals.text + totals.frame + totals.component + totals.instance;
    ok(report.layersChecked >= layers, `walked ${report.layersChecked} layers, at least the ${layers} that were counted`);
  }
  ok(report.componentCount === components.filter((c) => c.type === 'COMPONENT').length, `components: ${report.componentCount}`);
  ok(report.componentSets.length === components.filter((c) => c.type === 'COMPONENT_SET').length, `component sets: ${report.componentSets.length}`);
  ok(report.collections.reduce((s, c) => s + c.count, 0) === variables.variables.length, `variables: ${variables.variables.length} in ${report.collections.length} collections`);
  ok(report.textStyles.length === styles.filter((s) => s.type === 'text').length, `text styles: ${report.textStyles.length}`);
  ok(report.pages.length === pages.length, `pages: ${report.pages.join(', ')}`);
  ok(report.fillsBound + report.fillsRaw >= 0 && report.frameAuto <= report.frameTotal, 'the percentages make sense');

  ok(first.panel && first.panel.title === 'Rubric audit' && first.panel.controls.length <= 64, `the panel opens (${first.panel?.controls.length} controls)`);
  ok(save.output && save.output.saved === 'rubric-report.md', 'the Save button offers rubric-report.md');
  ok(again.output && again.output.report && again.output.report.frameTotal === report.frameTotal, 'Run again gives the same report');
  ok(closed.closed === true, 'the Close button closes the panel');
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
