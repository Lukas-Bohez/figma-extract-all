// owner.mjs — the owner-only commands and their key.
//
// The plugin has a public build (code.js) and an owner build (code.owner.js, see the main README). Only the owner
// build knows the commands below, and it only runs them for a call that carries the owner key. The key lives in the
// environment variable FIGMA_OWNER_KEY of the machine that runs this bridge, or in the file
// ~/.figma-extract-all/owner-key (`npm run build:owner` makes it when there is no key yet). Without a key the
// bridge offers no owner tools, and it never sends the key along with an ordinary command.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const OWNER_COMMANDS = new Set(['owner_status', 'move_node', 'add_variant', 'set_variant']);

/** Where the owner's key is kept when it is not in the environment */
export const OWNER_KEY_FILE = join(homedir(), '.figma-extract-all', 'owner-key');

/** The key from the environment or the key file, or null when there is none (or it is too short to be a secret) */
export function readOwnerKey(env = process.env, file = OWNER_KEY_FILE) {
  let key = (env.FIGMA_OWNER_KEY || '').trim();
  if (!key && file && existsSync(file)) {
    try { key = readFileSync(file, 'utf8').trim(); } catch { key = ''; }
  }
  return key.length >= 16 ? key : null;
}

/** Adds the key to the parameters of an owner command, and to nothing else */
export function withOwnerKey(cmd, params, key) {
  if (!key || !OWNER_COMMANDS.has(cmd)) return params;
  return { ...(params || {}), ownerKey: key };
}
