#!/usr/bin/env node
// Builds bookmarklet.txt from src/capture/capture-page.js, so the bookmarklet
// can never drift from the capture the CLI and the bridge use.
//
// Use it for pages the headless browser cannot reach — behind a login, or in
// a state you clicked your way into. Click the bookmark on the page; it
// downloads <title>.figma.json, which you drop into the plugin's Build tab.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const capture = readFileSync(join(HERE, '..', 'src', 'capture', 'capture-page.js'), 'utf8');

const run = `
(function () {
  try {
    var doc = window.__figmaCapture({});
    var blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (document.title || 'page').replace(/[^\\w\\- ]+/g, '').replace(/\\s+/g, ' ').trim().slice(0, 60) + '.figma.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    alert('Vastgelegd: ' + doc.counts.FRAME + ' frames, ' + doc.counts.TEXT + ' tekstlagen. Sleep het .json-bestand in Extract All > Build.');
  } catch (e) { alert('Vastleggen mislukt: ' + e.message); }
})();`;

// Strip line comments and collapse whitespace conservatively, then encode.
const body = (capture + '\n' + run)
  .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\n\s*\n/g, '\n');
const url = 'javascript:' + encodeURIComponent(body);

const out = join(HERE, '..', 'bookmarklet.txt');
writeFileSync(out, url);
console.log(`bookmarklet.txt geschreven (${(url.length / 1024).toFixed(1)} kB).`);
console.log('Maak een nieuwe bladwijzer en plak de volledige inhoud van dat bestand als URL.');
