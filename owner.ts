// ═══════════════════════════════════════════════════════════════════
//  Owner commands: move_node, add_variant, set_variant, owner_status
//
//  One plugin, one build (code.js): these commands are part of it. What they add to the other commands: a layer
//  cannot be moved to another parent, a new variant cannot be added to an existing component set, and an instance
//  cannot switch variant.
//
//  Every call must carry the owner key (the bridge adds it: FIGMA_OWNER_KEY, or the key file
//  ~/.figma-extract-all/owner-key that the bridge makes on its first run). The first key an installation sees
//  is kept in figma.clientStorage and is the only one it accepts after that, so another program on the same
//  computer cannot use these commands without the key. The Community version has no network access at all,
//  so it never receives a command in the first place.
//
//  What no plugin can do: publish a library or a plugin to Figma. Publishing a library is
//  Assets → Publish in Figma itself; publishing a plugin is Plugins → Manage plugins → Publish.
// ═══════════════════════════════════════════════════════════════════

const OWNER_COMMAND_NAMES = ["owner_status", "move_node", "add_variant", "set_variant"];
const OWNER_KEY_STORAGE = "extract-all.owner-key";

/** Constant-time comparison of two strings */
function sameKey(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const longest = Math.max(a.length, b.length);
  for (let i = 0; i < longest; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Refuse unless the call carries the owner key of this installation (the first key it saw) */
async function requireOwner(p: any): Promise<void> {
  const given: string = p && typeof p.ownerKey === "string" ? p.ownerKey : "";
  if (given.length < 16) {
    throw new Error("Alleen voor de eigenaar: deze opdracht vraagt de eigenaarssleutel (FIGMA_OWNER_KEY of ~/.figma-extract-all/owner-key).");
  }
  const stored = await figma.clientStorage.getAsync(OWNER_KEY_STORAGE);
  if (typeof stored !== "string" || stored.length < 16) {
    await figma.clientStorage.setAsync(OWNER_KEY_STORAGE, given);
    return;
  }
  if (!sameKey(stored, given)) throw new Error("Alleen voor de eigenaar: dit is niet de sleutel van deze installatie.");
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
  await requireOwner(p);
  return { owner: true, enrolled: true, featureVersion: FEATURE_VERSION, commands: OWNER_COMMAND_NAMES, file: figma.root.name };
}

/** Move a layer to another parent (optionally at a position), which `update` cannot do */
async function ownerMoveNode(p: any) {
  await requireOwner(p);
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
  await requireOwner(p);
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
  await requireOwner(p);
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
