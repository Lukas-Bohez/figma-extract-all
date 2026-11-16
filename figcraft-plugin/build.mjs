// Build the FigCraft plugin: compile to WebAssembly and put the module next to its manifest.
//
//   node build.mjs
//
//   figcraft-plugin/manifest.json, figcraft-plugin.json, rubric_audit.wasm
//        the plugin as FigCraft imports it. These three files are committed, so a clone of the
//        repository imports as it is: Plugins > Development > Import plugin from manifest...
//        and pick figcraft-plugin/manifest.json
//   dist/rubric-audit/        the same three files, what the release zip is made of
//
// figcraft-plugin.json is the source of truth (FigCraft's own name for the file, which its folder
// import and plugin directories look for); manifest.json is a copy of it, so the file you are
// looking for in the import dialog is where you expect it. tests/manifest.rs checks they match.
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

const wasm = join(here, 'target', 'wasm32-unknown-unknown', 'release', 'extract_all_rubric_audit.wasm');
const manifest = join(here, 'figcraft-plugin.json');

// the folder you can import as it is
copyFileSync(wasm, join(here, 'rubric_audit.wasm'));
copyFileSync(manifest, join(here, 'manifest.json'));

// the release zip's folder
const out = join(here, 'dist', 'rubric-audit');
mkdirSync(out, { recursive: true });
copyFileSync(wasm, join(out, 'rubric_audit.wasm'));
copyFileSync(manifest, join(out, 'figcraft-plugin.json'));
copyFileSync(manifest, join(out, 'manifest.json'));

console.log(`\nBuilt rubric_audit.wasm (${Math.round(statSync(join(here, 'rubric_audit.wasm')).size / 1024)} KB) next to manifest.json`);
console.log('In FigCraft: Plugins > Development > Import plugin from manifest... and pick figcraft-plugin/manifest.json');
