// export.mjs — write what the plugin's "export" command returns to disk.
//
// A Figma plugin cannot create a .fig file (only Figma's own File > Save local
// copy can). It can export layers as PNG, JPG, SVG, PDF or the REST JSON of a
// layer, and that is what this saves.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const safe = (s) => String(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'laag';

/**
 * @param {{id: string, name: string, format: string, scale?: number, base64?: string, json?: any}[]} files
 * @param {string} dir  created when missing
 * @returns {{id: string, name: string, format: string, path: string, bytes: number}[]}
 */
export function saveExport(files, dir) {
  const out = resolve(dir);
  mkdirSync(out, { recursive: true });
  const used = new Set();
  return files.map((f) => {
    const ext = f.format === 'JSON_REST_V1' ? 'json' : f.format.toLowerCase();
    const suffix = (f.format === 'PNG' || f.format === 'JPG') && f.scale && f.scale !== 1 ? `@${f.scale}x` : '';
    const base = `${safe(f.name)}${suffix}`;
    let name = `${base}.${ext}`;
    for (let i = 2; used.has(name.toLowerCase()); i += 1) name = `${base}-${i}.${ext}`;
    used.add(name.toLowerCase());
    const path = join(out, name);
    const data = f.json !== undefined ? Buffer.from(JSON.stringify(f.json, null, 2)) : Buffer.from(f.base64 || '', 'base64');
    writeFileSync(path, data);
    return { id: f.id, name: f.name, format: f.format, path, bytes: data.length };
  });
}
