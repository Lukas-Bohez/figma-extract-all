// ═══════════════════════════════════════════════════════════════════
//  Owner-only commands
//
//  Compiled ONLY into the owner build (`npm run build:owner` → code.owner.js, manifest.owner.json).
//  The public build (`npm run build` → code.js, what the Community plugin and the releases ship) does not
//  contain this file: tsconfig.json does not list it, and verify.js checks that the words below are absent.
//
//  Every command here also demands the owner key (FIGMA_OWNER_KEY, set when the owner build was made and
//  sent by the bridge with each call), so a copy of code.owner.js that ends up elsewhere does nothing for
//  someone without the key.
//
//  What these commands add to the public ones: a layer cannot be moved to another parent, a new variant
//  cannot be added to an existing component set, and an instance cannot switch variant.
//
//  What no plugin can do: publish a library or a plugin to Figma. Publishing a library is
//  Assets → Publish in Figma itself; publishing a plugin is Plugins → Manage plugins → Publish.
//  Compiled together with code.ts and features.ts (see tsconfig.owner.json).
// ═══════════════════════════════════════════════════════════════════

const OWNER_COMMAND_NAMES = ["owner_status", "move_node", "add_variant", "set_variant"];

/** Refuse unless the call carries the owner key; compares in constant time */
function requireOwner(p: any): void {
  const given: string = p && typeof p.ownerKey === "string" ? p.ownerKey : "";
  let diff = given.length ^ OWNER_KEY.length;
  const longest = Math.max(given.length, OWNER_KEY.length);
  for (let i = 0; i < longest; i++) diff |= (given.charCodeAt(i) || 0) ^ (OWNER_KEY.charCodeAt(i) || 0);
  if (OWNER_KEY.length === 0 || diff !== 0) {
    throw new Error("Alleen voor de eigenaar: deze opdracht vraagt de eigenaarssleutel (FIGMA_OWNER_KEY).");
  }
}

/** "variant=primary, size=md" → { variant: "primary", size: "md" } (the order is kept) */
function parseVariantName(name: string): { [k: string]: string } {
  const out: { [k: string]: string } = {};
  name.split(/,\s*/).forEach((pair) => {
    const at = pair.indexOf("=");
    if (at > 0) out[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  });
  return out;
}

function variantName(props: { [k: string]: string }): string {
  return Object.keys(props).map((k) => k + "=" + props[k]).join(", ");
}

async function ownerStatus(p: any) {
  requireOwner(p);
  return { owner: true, featureVersion: FEATURE_VERSION, commands: OWNER_COMMAND_NAMES, file: figma.root.name };
}

/** Move a layer to another parent (optionally at a position), which `update` cannot do */
async function ownerMoveNode(p: any) {
  requireOwner(p);
  const node = await figma.getNodeByIdAsync(String(p.id));
  if (!node || node.type === "DOCUMENT" || node.type === "PAGE") throw new Error(`Geen laag met id ${p.id}`);
  const target = await figma.getNodeByIdAsync(String(p.parentId));
  if (!target || !("appendChild" in target)) throw new Error(`Ouder ${p.parentId} kan geen kinderen hebben`);
  for (let up: BaseNode | null = target; up; up = up.parent) {
    if (up.id === node.id) throw new Error("Een laag kan niet in zichzelf of in een van zijn kinderen.");
  }
  const parent = target as BaseNode & ChildrenMixin;
  if (p.index === undefined || p.index === null) parent.appendChild(node as SceneNode);
  else parent.insertChild(Math.max(0, Math.floor(+p.index)), node as SceneNode);
  return { id: node.id, parentId: parent.id, index: parent.children.indexOf(node as SceneNode) };
}

/**
 * Add a variant to an existing component set by copying one: `from` picks the variant to copy ({variant: "primary"},
 * the first one when left out), `set` gives the new value of one or more existing properties. Texts and layer
 * properties of the copy can be changed in the same call.
 */
async function ownerAddVariant(p: any) {
  requireOwner(p);
  const set = await figma.getNodeByIdAsync(String(p.setId));
  if (!set || set.type !== "COMPONENT_SET") throw new Error(`${p.setId} is geen component set`);
  const change: { [k: string]: string } = {};
  Object.keys(p.set || {}).forEach((k) => { change[k] = String(p.set[k]); });
  if (!Object.keys(change).length) throw new Error('Geef set mee: de nieuwe waarde van een eigenschap, bv. { "variant": "ghost" }.');

  const want: { [k: string]: string } = p.from || {};
  const source = (set as ComponentSetNode).children.find((c) => {
    if (c.type !== "COMPONENT") return false;
    const have = parseVariantName(c.name);
    return Object.keys(want).every((k) => have[k] === String(want[k]));
  }) as ComponentNode | undefined;
  if (!source) throw new Error(`Geen variant ${JSON.stringify(want)} in "${set.name}" om te kopiëren`);

  const base = parseVariantName(source.name);
  for (const k of Object.keys(change)) {
    if (!(k in base)) throw new Error(`"${set.name}" heeft geen eigenschap "${k}" (wel: ${Object.keys(base).join(", ")}). Een nieuwe eigenschap maak je in Figma zelf.`);
  }
  const name = variantName(Object.assign({}, base, change));
  if ((set as ComponentSetNode).children.some((c) => c.name === name)) throw new Error(`De variant ${name} bestaat al.`);

  const copy = source.clone();
  copy.name = name;
  if (p.props) await applyProps(copy, p.props);
  const textsSet: string[] = [];
  for (const layer of Object.keys(p.texts || {})) {
    const t = copy.findOne((n) => n.type === "TEXT" && n.name === layer) as TextNode | null;
    if (!t) throw new Error(`Geen tekstlaag "${layer}" in ${name}`);
    await loadAllFontsOf(t);
    t.characters = String(p.texts[layer]);
    textsSet.push(layer);
  }
  return { id: copy.id, name, setId: set.id, copiedFrom: source.id, textsSet };
}

/** Switch instances to another variant (or change their other component properties) */
async function ownerSetVariant(p: any) {
  requireOwner(p);
  const props: { [k: string]: string } = {};
  Object.keys(p.props || {}).forEach((k) => { props[k] = String(p.props[k]); });
  if (!Object.keys(props).length) throw new Error('Geef props mee, bv. { "variant": "secondary" }.');
  const updated: string[] = [], skipped: { id: string; reason: string }[] = [];
  for (const n of await nodesFrom(p)) {
    if (n.type !== "INSTANCE") { skipped.push({ id: n.id, reason: `is een ${n.type}, geen instance` }); continue; }
    try { (n as InstanceNode).setProperties(props); updated.push(n.id); }
    catch (e) { skipped.push({ id: n.id, reason: errMsg(e) }); }
  }
  return { updated, skipped };
}

EXTRA_COMMANDS["owner_status"] = ownerStatus;
EXTRA_COMMANDS["move_node"] = ownerMoveNode;
EXTRA_COMMANDS["add_variant"] = ownerAddVariant;
EXTRA_COMMANDS["set_variant"] = ownerSetVariant;
