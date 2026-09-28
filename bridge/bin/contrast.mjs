#!/usr/bin/env node
// WCAG contrast audit of a captured page.
//
//   node bin/contrast.mjs capture.json
//   node bin/contrast.mjs http://localhost:5173 --theme dark
//
// Exit code 1 when anything fails, so it can gate a build.

import { readFileSync } from 'node:fs';
import { auditContrast } from '../src/capture/contrast.mjs';
import { captureUrl } from '../src/capture/cdp.mjs';

const args = process.argv.slice(2);
const target = args[0];
if (!target) {
  console.log('Gebruik: contrast <capture.json | url> [--theme light|dark] [--width px]');
  process.exit(1);
}
const opt = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};

const doc = /^https?:\/\//.test(target)
  ? (await captureUrl({ url: target, theme: opt('--theme'), width: +opt('--width', 1440) })).doc
  : JSON.parse(readFileSync(target, 'utf8'));

const r = auditContrast(doc);
const label = doc.source?.colorScheme ? ` (${doc.source.colorScheme})` : '';
console.log(`Contrast${label}: ${r.passes}/${r.checked} tekstlagen halen WCAG AA`);
if (!r.failures.length) {
  console.log('Geen overtredingen.');
} else {
  console.log(`\n${r.failures.length} combinatie(s) onder de norm:\n`);
  for (const f of r.failures) {
    console.log(`  ${f.ratio.toFixed(2)}:1  (nodig ${f.need}:1)  ${f.fg} op ${f.bg}  ${f.size}px/${f.weight}  ×${f.occurrences}`);
    console.log(`         "${f.text}"  — ${f.where || 'root'}`);
  }
}
process.exit(r.failures.length ? 1 : 0);
