#!/usr/bin/env node
// MCP server for Claude (and other MCP clients).
//
//   claude mcp add figma -- node "<pad>/bridge/bin/figma-mcp.mjs"
//
// stdout is the MCP channel: everything else goes to stderr.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getHub, DEFAULT_PORT } from '../src/hub.mjs';
import { createMcpServer } from '../src/mcp.mjs';

const log = (m) => process.stderr.write(`[figma-bridge] ${m}\n`);

const hub = await getHub({ port: DEFAULT_PORT, log });
log(hub.mode === 'local' ? `bridge actief op poort ${hub.port}` : `aangesloten op bestaande bridge op poort ${hub.port}`);

const server = createMcpServer(hub, { log });
await server.connect(new StdioServerTransport());

const shutdown = async () => { try { await server.close(); } catch { /* ignore */ } await hub.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);
