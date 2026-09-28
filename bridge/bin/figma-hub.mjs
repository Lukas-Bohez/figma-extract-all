#!/usr/bin/env node
// Standalone bridge, for tools that are not MCP clients (scripts, other LLMs
// with function calling, curl). Claude does not need this: figma-mcp starts
// the same hub on its own.
//
//   node bin/figma-hub.mjs
//   curl -X POST http://127.0.0.1:3055/command -H "Content-Type: application/json" -d "{\"cmd\":\"status\"}"

import { startHub, DEFAULT_PORT } from '../src/hub.mjs';

const log = (m) => console.log(`[figma-bridge] ${m}`);
try {
  const hub = await startHub({ port: DEFAULT_PORT, log });
  log('Open nu "Extract All" in Figma, tab "Claude", en klik Verbinden.');
  log(`Commando's: POST http://127.0.0.1:${hub.port}/command  {"cmd": "status"}   (Ctrl+C om te stoppen)`);
  process.on('SIGINT', async () => { await hub.close(); process.exit(0); });
} catch (e) {
  if (e.code === 'EADDRINUSE') {
    log(`Poort ${DEFAULT_PORT} is al in gebruik — waarschijnlijk draait de bridge al (bv. gestart door Claude).`);
    process.exit(0);
  }
  throw e;
}
