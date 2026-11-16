// Build the FigCraft plugin: compile to WebAssembly and put the module next to its manifest.
//
//   node build.mjs            -> dist/rubric-audit/{figcraft-plugin.json, rubric_audit.wasm}
//
// Needs Rust with the WebAssembly target:  rustup target add wasm32-unknown-unknown
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const run = spawnSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: here, stdio: 'inherit' });
if (run.status !== 0) {
  console.error('\ncargo failed. Is the WebAssembly target installed?  rustup target add wasm32-unknown-unknown');
  process.exit(run.status ?? 1);
}

const out = join(here, 'dist', 'rubric-audit');
mkdirSync(out, { recursive: true });
copyFileSync(join(here, 'target', 'wasm32-unknown-unknown', 'release', 'extract_all_rubric_audit.wasm'), join(out, 'rubric_audit.wasm'));
copyFileSync(join(here, 'figcraft-plugin.json'), join(out, 'figcraft-plugin.json'));
console.log(`\nBuilt ${out}  (${Math.round(statSync(join(out, 'rubric_audit.wasm')).size / 1024)} KB)`);
console.log('In FigCraft: Plugins > Development > Import plugin from manifest... and pick figcraft-plugin.json in that folder.');
