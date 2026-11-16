#!/usr/bin/env node
// Standalone bridge, for tools that are not MCP clients (scripts, other LLMs
// with function calling, curl). Claude does not need this: figma-mcp starts
// the same hub on its own.
//
//   node bin/figma-hub.mjs
//   curl -X POST http://127.0.0.1:3070/command -H "Content-Type: application/json" -d "{\"cmd\":\"status\"}"
//
// The port is the first free one of 3070-3074 (not 3055-3060: that is FigCraft's).

import { getHub } from '../src/hub.mjs';

const log = (m) => console.log(`[figma-bridge] ${m}`);
try {
  const hub = await getHub({ log });
  if (hub.mode === 'remote') {
    log(`De bridge draait al op poort ${hub.port} (bv. gestart door Claude). Niets te doen.`);
    process.exit(0);
  }
  log('Open nu "Extract All" in Figma, tab "Claude", en klik Verbinden.');
  log(`Commando's: POST http://127.0.0.1:${hub.port}/command  {"cmd": "status"}   (Ctrl+C om te stoppen)`);
  process.on('SIGINT', async () => { await hub.close(); process.exit(0); });
} catch (e) {
  if (e.code === 'ENOPORT') { log(e.message); process.exit(1); }
  throw e;
}
