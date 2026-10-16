// owner.mjs — the owner-only commands and their key.
//
// The plugin knows four owner commands (below). It only runs them for a call that carries the owner key, and it
// remembers the first key it saw as the only one it accepts. The key lives in the environment variable
// FIGMA_OWNER_KEY of the machine that runs this bridge, or in the file ~/.figma-extract-all/owner-key, which
// this bridge makes by itself the first time (ensureOwnerKey). The bridge never sends the key along with an
// ordinary command.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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

/**
 * The key of this computer: from the environment or the key file, and made (random, in the key file) when there is
 * none yet. `create: false` only looks.
 */
export function ensureOwnerKey(env = process.env, file = OWNER_KEY_FILE, { create = true } = {}) {
  const found = readOwnerKey(env, file);
  if (found || !create || !file) return found;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${randomBytes(24).toString('hex')}
`, { flag: 'wx' });
  } catch {
    // someone else made it a moment ago, or the folder cannot be written: read what is there
  }
  return readOwnerKey(env, file);
}

/** Adds the key to the parameters of an owner command, and to nothing else */
export function withOwnerKey(cmd, params, key) {
  if (!key || !OWNER_COMMANDS.has(cmd)) return params;
  return { ...(params || {}), ownerKey: key };
}
