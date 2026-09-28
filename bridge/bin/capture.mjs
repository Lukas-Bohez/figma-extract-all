#!/usr/bin/env node
// Capture a web page (React, HTML, anything a browser renders) as a
// figma-layout JSON file that the Extract All plugin can import.
//
//   node bin/capture.mjs http://localhost:5173 --out anchor.json
//   node bin/capture.mjs http://localhost:5173 --theme dark --out anchor-dark.json --screenshot anchor-dark.png

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureUrl } from '../src/capture/cdp.mjs';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`Gebruik: capture <url> [opties]

  --out <bestand>         JSON wegschrijven (standaard: capture.json)
  --width <px>            breedte van de viewport (standaard 1440)
  --height <px>           minimale hoogte (standaard 1000)
  --no-full-page          alleen de viewport, niet de hele pagina
  --theme light|dark      prefers-color-scheme emuleren
  --selector <css>        alleen dit element vastleggen
  --wait <ms>             extra wachten op animaties (standaard 1500)
  --name <naam>           naam van het hoofdframe in Figma
  --no-auto-layout        alles absoluut positioneren, geen auto layout
  --screenshot <bestand>  ook een PNG ter vergelijking wegschrijven`);
  process.exit(args.length ? 0 : 1);
}

const opt = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const url = args[0];
const out = resolve(opt('--out', 'capture.json'));
const shotPath = opt('--screenshot', null);

const t0 = Date.now();
const { doc, screenshot } = await captureUrl({
  url,
  width: +opt('--width', 1440),
  height: +opt('--height', 1000),
  fullPage: !args.includes('--no-full-page'),
  theme: opt('--theme', undefined),
  selector: opt('--selector', undefined),
  waitMs: +opt('--wait', 1500),
  name: opt('--name', undefined),
  autoLayout: !args.includes('--no-auto-layout'),
  screenshot: Boolean(shotPath),
});

writeFileSync(out, JSON.stringify(doc));
if (shotPath) writeFileSync(resolve(shotPath), Buffer.from(screenshot, 'base64'));

const c = doc.counts;
console.log(`Vastgelegd in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${doc.source.title || url}`);
console.log(`  ${c.FRAME} frames, ${c.TEXT} tekstlagen, ${c.SVG} svg's, ${c.IMAGE} afbeeldingen`);
console.log(`  ${doc.root.w} x ${doc.root.h}px, schema: ${doc.source.colorScheme}`);
console.log(`  -> ${out}`);
if (shotPath) console.log(`  -> ${resolve(shotPath)}`);
if (doc.warnings.length) console.log(`  ${doc.warnings.length} waarschuwing(en), bv.: ${doc.warnings[0]}`);
