// ═══════════════════════════════════════════════════════════════════
//  Extract All — features added in v19
//
//  1. Rubric check   audit a file against a design rubric (8px grid,
//                    variables, text styles, components, auto layout)
//  2. Build          import a "figma-layout" document (captured from any
//                    web page / React app) as real, editable Figma layers
//  3. Bridge         let Claude or any other LLM drive Figma through a
//                    local MCP server (bridge/), via the plugin UI
//
//  All UI <-> code messages for these features start with "x:" so the
//  original onmessage handler in code.ts can skip them (it resets the
//  ZIP buffer and the cancel flag on EVERY message it sees).
//
//  Compiled together with code.ts into code.js (see tsconfig.json).
// ═══════════════════════════════════════════════════════════════════

const FEATURE_VERSION = "19.2.0";

function isFeatureMessage(msg: any): boolean {
  return !!msg && typeof msg.type === "string" && msg.type.indexOf("x:") === 0;
}

function uiSend(type: string, payload: { [k: string]: any } = {}) {
  figma.ui.postMessage(Object.assign({ type }, payload));
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const yieldToFigma = () => new Promise<void>((r) => setTimeout(r, 0));

// ─────────────────────────── colour helpers ───────────────────────────

function hex2(n: number) { return Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0"); }
function toHex(c: RGB | RGBA): string {
  const a = (c as RGBA).a;
  return "#" + hex2(c.r) + hex2(c.g) + hex2(c.b) + (a !== undefined && a < 1 ? hex2(a) : "");
}

/** "#rgb", "#rrggbb", "#rrggbbaa" or "rgb(a)(...)" -> RGBA 0..1 */
function parseColor(input: any): RGBA {
  if (input && typeof input === "object" && "r" in input) {
    return { r: +input.r, g: +input.g, b: +input.b, a: input.a === undefined ? 1 : +input.a };
  }
  const s = String(input || "").trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((ch) => ch + ch).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p[3] === undefined ? 1 : p[3] };
  }
  throw new Error(`Onbekende kleur: ${s}`);
}

function solid(c: RGBA): SolidPaint {
  return { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
}

// ─────────────────────────── 1. RUBRIC CHECK ───────────────────────────

const SPACING_SCALE: [string, number][] = [
  ["space/1", 4], ["space/2", 8], ["space/3", 12], ["space/4", 16],
  ["space/5", 24], ["space/6", 32], ["space/7", 48], ["space/8", 64],
];
const RADIUS_SCALE: [string, number][] = [["radius/sm", 6], ["radius/md", 10], ["radius/lg", 14], ["radius/full", 999]];
const TEXT_SCALE = [
  { name: "text/xs", size: 12, style: "Regular", line: 1.5 },
  { name: "text/sm", size: 14, style: "Regular", line: 1.5 },
  { name: "text/base", size: 16, style: "Regular", line: 1.5 },
  { name: "text/lg", size: 18, style: "Medium", line: 1.2 },
  { name: "text/xl", size: 22, style: "Semi Bold", line: 1.2 },
  { name: "text/2xl", size: 28, style: "Semi Bold", line: 1.2 },
  { name: "text/3xl", size: 36, style: "Semi Bold", line: 1.2 },
];
const GRID = 4; // 8px grid, 4px as the half step

function hasFills(n: SceneNode): n is SceneNode & MinimalFillsMixin {
  return "fills" in n;
}

async function rubricAudit() {
  await figma.loadAllPagesAsync();
  const r: { [k: string]: any } = {};

  // Criterion 2 — local variables, two layers
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  r.collections = collections.map((c) => ({ name: c.name, modes: c.modes.map((m) => m.name), count: c.variableIds.length }));
  const byType: { [t: string]: number } = {};
  let aliasCount = 0;
  for (const v of variables) {
    byType[v.resolvedType] = (byType[v.resolvedType] || 0) + 1;
    if (Object.keys(v.valuesByMode).some((k) => {
      const val: any = v.valuesByMode[k];
      return val && typeof val === "object" && val.type === "VARIABLE_ALIAS";
    })) aliasCount++;
  }
  r.variableTypes = byType;
  r.aliasCount = aliasCount;
  r.hasSpacing = SPACING_SCALE.every(([n]) => variables.some((v) => v.name === n));

  // Criterion 3 — components, variants, text styles
  const sets = figma.root.findAllWithCriteria({ types: ["COMPONENT_SET"] });
  const comps = figma.root.findAllWithCriteria({ types: ["COMPONENT"] });
  const instances = figma.root.findAllWithCriteria({ types: ["INSTANCE"] });
  r.componentSets = sets.map((s) => ({
    name: s.name,
    props: Object.keys(s.componentPropertyDefinitions || {}),
    variants: s.children.length,
  }));
  r.componentCount = comps.length;
  r.instanceCount = instances.length;
  r.genericVariants = [] as any[];
  for (const s of sets) {
    const defs = s.componentPropertyDefinitions || {};
    for (const p of Object.keys(defs)) {
      const vals = defs[p].variantOptions || [];
      const generic = vals.filter((x) => /^(Variant ?\d+|Property ?\d+|Default)$/i.test(x));
      if (/^Property ?\d+$/i.test(p) || generic.length) r.genericVariants.push({ set: s.name, prop: p, values: vals });
    }
  }

  const textStyles = await figma.getLocalTextStylesAsync();
  r.textStyles = textStyles.map((s) => ({ name: s.name, size: s.fontSize, font: s.fontName.style }));
  r.missingTextStyles = TEXT_SCALE.filter((t) => !textStyles.some((s) => s.name === t.name)).map((t) => t.name);

  const scaleSizes = TEXT_SCALE.map((t) => t.size);
  const texts = figma.root.findAllWithCriteria({ types: ["TEXT"] });
  let unstyled = 0;
  const offScale: { [k: string]: number } = {};
  for (const t of texts) {
    if (!t.textStyleId || t.textStyleId === figma.mixed) unstyled++;
    if (typeof t.fontSize === "number" && scaleSizes.indexOf(Math.round(t.fontSize)) < 0) {
      const k = String(Math.round(t.fontSize * 100) / 100);
      offScale[k] = (offScale[k] || 0) + 1;
    }
  }
  r.textTotal = texts.length;
  r.textUnstyled = unstyled;
  r.offScale = Object.keys(offScale).map((k) => [k, offScale[k]]).sort((a: any, b: any) => b[1] - a[1]).slice(0, 12);

  // Criteria 4 + 1 — auto layout coverage, 8px grid
  const frames = figma.root.findAllWithCriteria({ types: ["FRAME", "COMPONENT", "INSTANCE"] }) as (FrameNode | ComponentNode | InstanceNode)[];
  let auto = 0;
  const offGrid: any[] = [];
  const noAuto: any[] = [];
  for (const f of frames) {
    if (f.layoutMode && f.layoutMode !== "NONE") {
      auto++;
      const vals = [f.paddingLeft, f.paddingRight, f.paddingTop, f.paddingBottom, f.itemSpacing];
      const bad = vals.filter((n) => typeof n === "number" && n > 0 && n % GRID !== 0);
      if (bad.length) offGrid.push({ id: f.id, name: f.name, values: bad });
    } else if ("children" in f && f.children.length > 1 && f.type !== "INSTANCE") {
      noAuto.push({ id: f.id, name: f.name, children: f.children.length });
    }
  }
  r.frameTotal = frames.length;
  r.frameAuto = auto;
  r.offGrid = offGrid.slice(0, 15);
  r.offGridTotal = offGrid.length;
  r.noAutoLayout = noAuto.sort((a, b) => b.children - a.children).slice(0, 10);

  // Criteria 2/7 — are the tokens actually USED? Count bound vs raw colour fills.
  let bound = 0, raw = 0;
  const rawColors: { [hex: string]: number } = {};
  const all = figma.root.findAll((n) => hasFills(n as SceneNode));
  for (const n of all) {
    const fills = (n as any).fills;
    if (!Array.isArray(fills)) continue;
    for (const f of fills) {
      if (f.type !== "SOLID" || f.visible === false) continue;
      if (f.boundVariables && f.boundVariables.color) bound++;
      else { raw++; const h = toHex(f.color); rawColors[h] = (rawColors[h] || 0) + 1; }
    }
  }
  r.fillsBound = bound;
  r.fillsRaw = raw;
  r.topRawColors = Object.keys(rawColors).map((h) => [h, rawColors[h]]).sort((a: any, b: any) => b[1] - a[1]).slice(0, 8);

  r.pages = figma.root.children.map((p) => p.name);
  r.fileName = figma.root.name;
  return r;
}

async function createSpacingVariables(): Promise<string[]> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const existing = await figma.variables.getLocalVariablesAsync();
  let col = collections.find((c) => c.name === "primitives");
  if (!col) col = figma.variables.createVariableCollection("primitives");
  const modeId = col.modes[0].modeId;
  const made: string[] = [];
  for (const [name, value] of SPACING_SCALE.concat(RADIUS_SCALE)) {
    if (existing.some((v) => v.name === name)) continue;
    const v = figma.variables.createVariable(name, col, "FLOAT");
    v.setValueForMode(modeId, value);
    v.scopes = name.indexOf("radius/") === 0 ? ["CORNER_RADIUS"] : ["GAP", "WIDTH_HEIGHT"];
    made.push(`${name} = ${value}`);
  }
  return made;
}

async function createTextStyles(): Promise<{ made: string[]; failed: string[] }> {
  const existing = await figma.getLocalTextStylesAsync();
  const made: string[] = [], failed: string[] = [];
  for (const t of TEXT_SCALE) {
    if (existing.some((s) => s.name === t.name)) continue;
    try {
      const font = await resolveFont("Inter", t.style === "Regular" ? 400 : t.style === "Medium" ? 500 : 600, false);
      const s = figma.createTextStyle();
      s.name = t.name;
      s.fontName = font;
      s.fontSize = t.size;
      s.lineHeight = { unit: "PERCENT", value: t.line * 100 };
      made.push(`${t.name} — ${t.size}px ${font.style}`);
    } catch (e) {
      failed.push(`${t.name}: ${errMsg(e)}`);
    }
  }
  return { made, failed };
}

// ─────────────────────────── fonts ───────────────────────────

const WEIGHT_NAMES: { [w: number]: string[] } = {
  100: ["Thin", "Hairline"], 200: ["Extra Light", "ExtraLight", "Ultra Light"], 300: ["Light"],
  400: ["Regular", "Normal", "Book"], 500: ["Medium"], 600: ["Semi Bold", "SemiBold", "Demi Bold"],
  700: ["Bold"], 800: ["Extra Bold", "ExtraBold", "Ultra Bold"], 900: ["Black", "Heavy"],
};
let fontListCache: Font[] | null = null;
const fontResolveCache: { [key: string]: FontName } = {};
const loadedFonts: { [key: string]: true } = {};

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

function styleWeight(style: string): number {
  const s = norm(style.replace(/italic|oblique/i, ""));
  for (const w of Object.keys(WEIGHT_NAMES)) {
    if (WEIGHT_NAMES[+w].some((n) => norm(n) === s)) return +w;
  }
  return s === "" ? 400 : 400;
}

/** Map a CSS family/weight/italic to a font Figma actually has, and load it. */
async function resolveFont(family: string, weight: number, italic: boolean): Promise<FontName> {
  const key = `${family}|${weight}|${italic}`;
  if (fontResolveCache[key]) return fontResolveCache[key];
  if (!fontListCache) fontListCache = await figma.listAvailableFontsAsync();

  const generic = /^(system-ui|-apple-system|sans-serif|serif|monospace|ui-sans-serif|ui-monospace|blinkmacsystemfont|inherit|initial)$/i;
  const wanted = generic.test(family) ? "Inter" : family;
  let styles = fontListCache.filter((f) => norm(f.fontName.family) === norm(wanted)).map((f) => f.fontName);
  if (!styles.length) styles = fontListCache.filter((f) => f.fontName.family === "Inter").map((f) => f.fontName);
  if (!styles.length) styles = [{ family: "Roboto", style: "Regular" }];

  const withItalic = styles.filter((s) => /italic|oblique/i.test(s.style) === italic);
  const pool = withItalic.length ? withItalic : styles;
  pool.sort((a, b) => Math.abs(styleWeight(a.style) - weight) - Math.abs(styleWeight(b.style) - weight));
  const pick = pool[0];
  const lk = `${pick.family}|${pick.style}`;
  if (!loadedFonts[lk]) { await figma.loadFontAsync(pick); loadedFonts[lk] = true; }
  fontResolveCache[key] = pick;
  return pick;
}

// ─────────────────────────── 2. BUILD: figma-layout import ───────────────────────────

interface LayoutColor { r: number; g: number; b: number; a?: number }
interface LayoutFont { family: string; weight: number; italic: boolean; size: number; lineHeight: number | null; letterSpacing: number }
interface LayoutRun { text: string; font: LayoutFont; color: LayoutColor | null; decoration?: string; transform?: string }
interface LayoutNode {
  type: "FRAME" | "TEXT" | "SVG" | "IMAGE";
  name: string; x: number; y: number; w: number; h: number;
  absolute?: boolean;
  fills?: { type: string; color: LayoutColor }[];
  stroke?: { color: LayoutColor; weights: number[] };
  radius?: number[];
  shadows?: { x: number; y: number; blur: number; spread: number; color: LayoutColor; inset: boolean }[];
  opacity?: number; clip?: boolean;
  layout?: { mode: "HORIZONTAL" | "VERTICAL"; wrap: boolean; gap: number; crossGap?: number; padding: number[]; primary: string; counter: string };
  children?: LayoutNode[];
  text?: string; font?: LayoutFont; color?: LayoutColor | null; runs?: LayoutRun[];
  align?: string; wrap?: boolean; decoration?: string; transform?: string;
  svg?: string; src?: string | null; fit?: string;
}
interface LayoutDoc { format: string; version: number; source?: any; root: LayoutNode }
interface ImportOptions { autoLayout?: boolean; x?: number; y?: number; name?: string; parentId?: string }

const TEXT_CASE: { [k: string]: TextCase } = { UPPER: "UPPER", LOWER: "LOWER", TITLE: "TITLE", ORIGINAL: "ORIGINAL" };
const TEXT_DECO: { [k: string]: TextDecoration } = { UNDERLINE: "UNDERLINE", STRIKETHROUGH: "STRIKETHROUGH", NONE: "NONE" };

function rgba(c: LayoutColor | null | undefined): RGBA | null {
  return c ? { r: c.r, g: c.g, b: c.b, a: c.a === undefined ? 1 : c.a } : null;
}

async function importLayout(doc: LayoutDoc, opts: ImportOptions = {}) {
  if (!doc || doc.format !== "figma-layout" || !doc.root) {
    throw new Error("This is not a figma-layout document (expected format \"figma-layout\" with a root).");
  }
  const autoLayout = opts.autoLayout !== false;
  const counts = { FRAME: 0, TEXT: 0, SVG: 0, IMAGE: 0 };
  const warnings: string[] = [];
  const warn = (m: string) => { if (warnings.length < 50) warnings.push(m); };
  let made = 0;

  // Fonts first, all at once: a text layer cannot be edited before its font is loaded.
  const needed: { [k: string]: LayoutFont } = {};
  (function collect(n: LayoutNode) {
    if (n.type === "TEXT") {
      for (const r of n.runs || [{ text: n.text || "", font: n.font! } as LayoutRun]) {
        if (r.font) needed[`${r.font.family}|${r.font.weight}|${r.font.italic}`] = r.font;
      }
    }
    for (const c of n.children || []) collect(c);
  })(doc.root);
  for (const k of Object.keys(needed)) {
    const f = needed[k];
    try { await resolveFont(f.family, f.weight, f.italic); } catch (e) { warn(`font ${f.family} ${f.weight}: ${errMsg(e)}`); }
  }

  const fontFor = (f: LayoutFont) => fontResolveCache[`${f.family}|${f.weight}|${f.italic}`] || { family: "Inter", style: "Regular" };

  async function build(n: LayoutNode, parentX: number, parentY: number, parentAuto: boolean): Promise<SceneNode | null> {
    made++;
    if (made % 150 === 0) {
      uiSend("x:layout-progress", { made });
      await yieldToFigma();
    }
    let node: SceneNode | null = null;
    try {
      if (n.type === "TEXT") node = await buildText(n);
      else if (n.type === "SVG") node = buildSvg(n);
      else if (n.type === "IMAGE") node = buildImage(n);
      else node = await buildFrame(n);
    } catch (e) {
      warn(`${n.type} "${n.name}": ${errMsg(e)}`);
      return null;
    }
    if (!node) return null;
    counts[n.type]++;
    (node as any).__abs = n.absolute || !parentAuto;
    node.x = n.x - parentX;
    node.y = n.y - parentY;
    return node;
  }

  async function buildFrame(n: LayoutNode): Promise<FrameNode> {
    const f = figma.createFrame();
    f.name = n.name || "frame";
    f.fills = [];
    for (const fill of n.fills || []) {
      const c = rgba(fill.color);
      if (fill.type === "SOLID" && c) f.fills = [...f.fills, solid(c)];
    }
    if (n.stroke) {
      const c = rgba(n.stroke.color)!;
      f.strokes = [solid(c)];
      f.strokeAlign = "INSIDE";
      const [t, rgt, b, l] = n.stroke.weights;
      if (t === rgt && t === b && t === l) f.strokeWeight = t;
      else { f.strokeTopWeight = t; f.strokeRightWeight = rgt; f.strokeBottomWeight = b; f.strokeLeftWeight = l; }
    }
    if (n.radius) {
      const [tl, tr, br, bl] = n.radius;
      if (tl === tr && tl === br && tl === bl) f.cornerRadius = tl;
      else { f.topLeftRadius = tl; f.topRightRadius = tr; f.bottomRightRadius = br; f.bottomLeftRadius = bl; }
    }
    if (n.shadows && n.shadows.length) {
      f.effects = n.shadows.map((s) => ({
        type: s.inset ? "INNER_SHADOW" : "DROP_SHADOW",
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a === undefined ? 1 : s.color.a },
        offset: { x: s.x, y: s.y }, radius: s.blur, spread: s.spread,
        visible: true, blendMode: "NORMAL",
      } as DropShadowEffect | InnerShadowEffect));
    }
    if (n.opacity !== undefined) f.opacity = n.opacity;
    f.clipsContent = !!n.clip;

    const useAuto = autoLayout && !!n.layout;
    if (useAuto) {
      const L = n.layout!;
      f.layoutMode = L.mode;
      f.primaryAxisSizingMode = "FIXED";
      f.counterAxisSizingMode = "FIXED";
      f.itemSpacing = L.primary === "SPACE_BETWEEN" ? 0 : L.gap;
      [f.paddingTop, f.paddingRight, f.paddingBottom, f.paddingLeft] = L.padding;
      f.primaryAxisAlignItems = (["MIN", "CENTER", "MAX", "SPACE_BETWEEN"].indexOf(L.primary) >= 0 ? L.primary : "MIN") as any;
      const counter = L.counter === "BASELINE" && L.mode !== "HORIZONTAL" ? "MIN" : L.counter;
      f.counterAxisAlignItems = (["MIN", "CENTER", "MAX", "BASELINE"].indexOf(counter) >= 0 ? counter : "MIN") as any;
      if (L.wrap && L.mode === "HORIZONTAL") {
        f.layoutWrap = "WRAP";
        if (L.crossGap) f.counterAxisSpacing = L.crossGap;
      }
    }
    f.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));

    for (const c of n.children || []) {
      const child = await build(c, n.x, n.y, useAuto);
      if (!child) continue;
      f.appendChild(child);
      if (useAuto) {
        if ((child as any).__abs) {
          (child as any).layoutPositioning = "ABSOLUTE";
          child.x = c.x - n.x;
          child.y = c.y - n.y;
        } else if ("layoutSizingHorizontal" in child) {
          // keep the browser's measured size; auto layout only arranges
          try { (child as any).layoutSizingHorizontal = "FIXED"; (child as any).layoutSizingVertical = "FIXED"; } catch (e) { /* not supported on this node */ }
        }
      }
      delete (child as any).__abs;
    }
    return f;
  }

  async function buildText(n: LayoutNode): Promise<TextNode | null> {
    const text = n.text || "";
    if (!text.trim()) return null;
    const t = figma.createText();
    const base = n.font!;
    t.fontName = fontFor(base);
    t.characters = text;
    t.name = n.name || text.slice(0, 40);
    t.fontSize = Math.max(1, base.size);
    if (base.lineHeight) t.lineHeight = { unit: "PIXELS", value: base.lineHeight };
    if (base.letterSpacing) t.letterSpacing = { unit: "PIXELS", value: base.letterSpacing };
    const col = rgba(n.color);
    t.fills = col ? [solid(col)] : [];
    t.textCase = TEXT_CASE[n.transform || "ORIGINAL"] || "ORIGINAL";
    t.textDecoration = TEXT_DECO[n.decoration || "NONE"] || "NONE";
    t.textAlignHorizontal = (["LEFT", "CENTER", "RIGHT", "JUSTIFIED"].indexOf(n.align || "") >= 0 ? n.align : "LEFT") as any;

    // Styled runs: <strong>, coloured spans etc. inside one paragraph.
    if (n.runs && n.runs.length > 1) {
      let at = 0;
      for (const r of n.runs) {
        const end = at + r.text.length;
        if (end > at && end <= text.length) {
          t.setRangeFontName(at, end, fontFor(r.font));
          t.setRangeFontSize(at, end, Math.max(1, r.font.size));
          const rc = rgba(r.color);
          if (rc) t.setRangeFills(at, end, [solid(rc)]);
          if (r.decoration) t.setRangeTextDecoration(at, end, TEXT_DECO[r.decoration] || "NONE");
          if (r.transform) t.setRangeTextCase(at, end, TEXT_CASE[r.transform] || "ORIGINAL");
          if (r.font.letterSpacing) t.setRangeLetterSpacing(at, end, { unit: "PIXELS", value: r.font.letterSpacing });
        }
        at = end;
      }
    }

    // Wrapping or centred text keeps the browser's width, so the lines
    // break and align in the same places. Short left-aligned text hugs.
    if (n.wrap || (n.align && n.align !== "LEFT")) {
      t.textAutoResize = "HEIGHT";
      t.resize(Math.max(n.w, 1), Math.max(n.h, 1));
    } else {
      t.textAutoResize = "WIDTH_AND_HEIGHT";
    }
    return t;
  }

  function buildSvg(n: LayoutNode): SceneNode {
    try {
      const f = figma.createNodeFromSvg(n.svg || "<svg xmlns='http://www.w3.org/2000/svg'/>");
      f.name = n.name || "svg";
      if (Math.abs(f.width - n.w) > 0.5 || Math.abs(f.height - n.h) > 0.5) f.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
      return f;
    } catch (e) {
      warn(`SVG "${n.name}" not readable by Figma, replaced by a rectangle: ${errMsg(e)}`);
      const r = figma.createRectangle();
      r.name = `${n.name || "svg"} (niet geïmporteerd)`;
      r.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
      r.fills = [solid({ r: 0.9, g: 0.9, b: 0.9, a: 1 })];
      return r;
    }
  }

  function buildImage(n: LayoutNode): SceneNode {
    const r = figma.createRectangle();
    r.name = n.name || "image";
    r.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
    const m = (n.src || "").match(/^data:image\/[a-z+]+;base64,(.+)$/i);
    if (m) {
      const img = figma.createImage(figma.base64Decode(m[1]));
      r.fills = [{ type: "IMAGE", imageHash: img.hash, scaleMode: n.fit === "FIT" ? "FIT" : "FILL" }];
    } else {
      r.fills = [solid({ r: 0.88, g: 0.89, b: 0.9, a: 1 })];
      warn(`image "${n.name}" had no readable source (CORS), placed a grey rectangle`);
    }
    return r;
  }

  // ---- place the result ----
  const rootNode = await build(doc.root, doc.root.x, doc.root.y, false);
  if (!rootNode) throw new Error("Could not build the root. " + (warnings[0] || ""));
  const src = doc.source || {};
  rootNode.name = opts.name || [src.title || doc.root.name || "Import", src.colorScheme ? `(${src.colorScheme})` : ""].join(" ").trim();

  let parent: BaseNode & ChildrenMixin = figma.currentPage;
  if (opts.parentId) {
    const p = await figma.getNodeByIdAsync(opts.parentId);
    if (p && "appendChild" in p) parent = p as BaseNode & ChildrenMixin;
  }
  parent.appendChild(rootNode);
  if (opts.x !== undefined && opts.y !== undefined) {
    rootNode.x = opts.x; rootNode.y = opts.y;
  } else if (parent.type === "PAGE") {
    // next to whatever is already on the page, never on top of it
    const others = parent.children.filter((c) => c !== rootNode);
    const right = others.reduce((m, c) => Math.max(m, c.x + c.width), 0);
    const top = others.length ? Math.min(...others.map((c) => c.y)) : 0;
    rootNode.x = others.length ? Math.round(right + 200) : 0;
    rootNode.y = Math.round(top);
  }
  figma.currentPage.selection = [rootNode];
  figma.viewport.scrollAndZoomIntoView([rootNode]);
  return { rootId: rootNode.id, name: rootNode.name, counts, warnings, width: Math.round(rootNode.width), height: Math.round(rootNode.height) };
}

// ─────────────────────────── 3. BRIDGE: commands for Claude / LLMs ───────────────────────────

const varNameCache: { [id: string]: string } = {};
async function varName(id: string): Promise<string> {
  if (varNameCache[id]) return varNameCache[id];
  const v = await figma.variables.getVariableByIdAsync(id);
  varNameCache[id] = v ? v.name : id;
  return varNameCache[id];
}

async function describePaints(paints: ReadonlyArray<Paint> | PluginAPI["mixed"]): Promise<any> {
  if (paints === figma.mixed) return "mixed";
  const out: any[] = [];
  for (const p of paints) {
    if (p.visible === false) continue;
    if (p.type === "SOLID") {
      const e: any = { type: "SOLID", hex: toHex({ r: p.color.r, g: p.color.g, b: p.color.b, a: p.opacity === undefined ? 1 : p.opacity }) };
      if (p.boundVariables && p.boundVariables.color) e.variable = await varName(p.boundVariables.color.id);
      out.push(e);
    } else out.push({ type: p.type });
  }
  return out;
}

async function describeNode(n: SceneNode, depth: number): Promise<any> {
  const d: any = { id: n.id, name: n.name, type: n.type };
  if ("x" in n) { d.x = Math.round(n.x); d.y = Math.round(n.y); }
  if ("width" in n) { d.w = Math.round(n.width); d.h = Math.round(n.height); }
  if (!n.visible) d.visible = false;
  if ("opacity" in n && n.opacity < 1) d.opacity = Math.round(n.opacity * 100) / 100;
  if ("fills" in n && n.type !== "TEXT") { const f = await describePaints((n as any).fills); if (f === "mixed" || f.length) d.fills = f; }
  if ("strokes" in n && (n as any).strokes.length) {
    d.strokes = await describePaints((n as any).strokes);
    d.strokeWeight = (n as any).strokeWeight === figma.mixed ? "mixed" : (n as any).strokeWeight;
  }
  if ("cornerRadius" in n) d.radius = (n as any).cornerRadius === figma.mixed ? "mixed" : (n as any).cornerRadius || undefined;
  if ("layoutMode" in n && (n as any).layoutMode !== "NONE") {
    const f = n as FrameNode;
    d.autoLayout = {
      mode: f.layoutMode, gap: f.itemSpacing,
      padding: [f.paddingTop, f.paddingRight, f.paddingBottom, f.paddingLeft],
      primary: f.primaryAxisAlignItems, counter: f.counterAxisAlignItems,
      wrap: f.layoutWrap,
    };
  }
  if ("layoutSizingHorizontal" in n && n.parent && "layoutMode" in n.parent && (n.parent as any).layoutMode !== "NONE") {
    d.sizing = { h: (n as any).layoutSizingHorizontal, v: (n as any).layoutSizingVertical };
  }
  if ("boundVariables" in n && n.boundVariables) {
    const bv: any = {};
    for (const k of Object.keys(n.boundVariables)) {
      const v: any = (n.boundVariables as any)[k];
      if (v && v.id) bv[k] = await varName(v.id);
    }
    if (Object.keys(bv).length) d.boundVariables = bv;
  }
  if (n.type === "TEXT") {
    d.characters = n.characters.length > 400 ? n.characters.slice(0, 400) + "…" : n.characters;
    d.fontName = n.fontName === figma.mixed ? "mixed" : n.fontName;
    d.fontSize = n.fontSize === figma.mixed ? "mixed" : n.fontSize;
    d.fills = await describePaints(n.fills);
    if (n.textStyleId && n.textStyleId !== figma.mixed) {
      const s = await figma.getStyleByIdAsync(n.textStyleId);
      d.textStyle = s ? s.name : n.textStyleId;
    }
  }
  if (n.type === "COMPONENT_SET") d.variantProperties = Object.keys(n.componentPropertyDefinitions || {});
  if (n.type === "COMPONENT" && n.parent && n.parent.type === "COMPONENT_SET") d.variant = n.variantProperties;
  if (n.type === "INSTANCE") {
    const main = await n.getMainComponentAsync();
    d.mainComponent = main ? main.name : null;
    if (main) {
      d.mainComponentId = main.id;
      if (main.remote) d.remote = true;
      if (main.parent && main.parent.type === "COMPONENT_SET") d.componentSet = { id: main.parent.id, name: main.parent.name };
      let pg: BaseNode | null = main.parent;
      while (pg && pg.type !== "PAGE") pg = pg.parent;
      if (pg) d.mainComponentPage = pg.name;
    }
  }
  if ("reactions" in n && n.reactions.length) d.reactions = n.reactions.map(describeReaction);
  if ("children" in n) {
    if (depth > 0) {
      d.children = [];
      for (const c of n.children) d.children.push(await describeNode(c, depth - 1));
    } else if (n.children.length) d.childCount = n.children.length;
  }
  return d;
}

async function nodesFrom(p: any): Promise<SceneNode[]> {
  const ids: string[] = p.ids || (p.id ? [p.id] : []);
  if (!ids.length) {
    const sel = figma.currentPage.selection;
    if (!sel.length) throw new Error("Geef ids mee of selecteer eerst iets in Figma.");
    return sel.slice();
  }
  const out: SceneNode[] = [];
  for (const id of ids) {
    const n = await figma.getNodeByIdAsync(id);
    if (!n || n.type === "DOCUMENT" || n.type === "PAGE") throw new Error(`Geen laag met id ${id}`);
    out.push(n as SceneNode);
  }
  return out;
}

async function findVariable(ref: string): Promise<Variable> {
  const byId = await figma.variables.getVariableByIdAsync(ref).catch(() => null);
  if (byId) return byId;
  const all = await figma.variables.getLocalVariablesAsync();
  const v = all.find((x) => x.name === ref) || all.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!v) throw new Error(`Variabele "${ref}" niet gevonden`);
  return v;
}

async function loadAllFontsOf(t: TextNode) {
  const fonts = t.fontName === figma.mixed ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
  for (const f of fonts) await figma.loadFontAsync(f);
}

/** Apply a loose set of properties, the way an LLM will naturally describe them. */
async function applyProps(n: SceneNode, p: any) {
  const any = n as any;
  if (p.name !== undefined) n.name = String(p.name);
  if (p.visible !== undefined) n.visible = !!p.visible;
  if (p.opacity !== undefined && "opacity" in n) any.opacity = +p.opacity;

  if (p.text !== undefined || p.fontSize !== undefined || p.fontFamily !== undefined || p.fontWeight !== undefined) {
    if (n.type !== "TEXT") throw new Error(`${n.name} is geen tekstlaag`);
    await loadAllFontsOf(n);
    if (p.fontFamily !== undefined || p.fontWeight !== undefined) {
      const cur = n.fontName === figma.mixed ? { family: "Inter", style: "Regular" } : n.fontName;
      n.fontName = await resolveFont(p.fontFamily || cur.family, p.fontWeight || styleWeight(cur.style), /italic/i.test(cur.style));
    }
    if (p.text !== undefined) n.characters = String(p.text);
    if (p.fontSize !== undefined) n.fontSize = +p.fontSize;
    if (p.lineHeight !== undefined) n.lineHeight = p.lineHeight === "auto" ? { unit: "AUTO" } : { unit: "PIXELS", value: +p.lineHeight };
    if (p.textAlign !== undefined) n.textAlignHorizontal = String(p.textAlign).toUpperCase() as any;
    if (p.textAutoResize !== undefined) n.textAutoResize = p.textAutoResize;
  }

  if (p.width !== undefined || p.height !== undefined) {
    if (!("resize" in n)) throw new Error(`${n.name} kan niet geschaald worden`);
    any.resize(p.width !== undefined ? +p.width : any.width, p.height !== undefined ? +p.height : any.height);
  }
  if (p.x !== undefined) n.x = +p.x;
  if (p.y !== undefined) n.y = +p.y;

  if (p.fill !== undefined || p.fills !== undefined) {
    const list = p.fills !== undefined ? p.fills : [p.fill];
    any.fills = (list || []).filter((c: any) => c !== null && c !== "none").map((c: any) => solid(parseColor(c)));
  }
  if (p.stroke !== undefined) {
    if (p.stroke === null || p.stroke === "none") any.strokes = [];
    else {
      const s = typeof p.stroke === "object" && !("r" in p.stroke) ? p.stroke : { color: p.stroke };
      any.strokes = [solid(parseColor(s.color))];
      if (s.weight !== undefined) any.strokeWeight = +s.weight;
      // an open path has no inside: with INSIDE (Figma's default for shapes) a straight line is invisible
      any.strokeAlign = s.align || (n.type === "VECTOR" ? "CENTER" : "INSIDE");
      if (s.cap) any.strokeCap = String(s.cap).toUpperCase();
      if (s.join) any.strokeJoin = String(s.join).toUpperCase();
      if (Array.isArray(s.dash)) any.dashPattern = s.dash.map(Number);
    }
  }
  if (p.cornerRadius !== undefined) any.cornerRadius = +p.cornerRadius;
  if (p.rotation !== undefined && "rotation" in n) any.rotation = +p.rotation;
  if (p.clip !== undefined && "clipsContent" in n) any.clipsContent = !!p.clip;
  if (p.arc !== undefined && n.type === "ELLIPSE") {
    n.arcData = { startingAngle: +p.arc.start, endingAngle: +p.arc.end, innerRadius: +(p.arc.inner || 0) };
  }

  if (p.layout !== undefined) {
    if (!("layoutMode" in n)) throw new Error(`${n.name} kan geen auto layout krijgen`);
    const L = p.layout;
    if (L === null || L === "none" || L.mode === "NONE") any.layoutMode = "NONE";
    else {
      if (L.mode) any.layoutMode = String(L.mode).toUpperCase();
      if (L.gap !== undefined) any.itemSpacing = +L.gap;
      if (L.padding !== undefined) {
        const pd = Array.isArray(L.padding) ? L.padding : [L.padding, L.padding, L.padding, L.padding];
        const [t, r, b, l] = pd.length === 2 ? [pd[0], pd[1], pd[0], pd[1]] : pd;
        any.paddingTop = +t; any.paddingRight = +r; any.paddingBottom = +b; any.paddingLeft = +l;
      }
      if (L.primary) any.primaryAxisAlignItems = String(L.primary).toUpperCase();
      if (L.counter) any.counterAxisAlignItems = String(L.counter).toUpperCase();
      if (L.wrap !== undefined) any.layoutWrap = L.wrap ? "WRAP" : "NO_WRAP";
    }
  }
  if (p.sizing !== undefined) {
    if (p.sizing.h) any.layoutSizingHorizontal = String(p.sizing.h).toUpperCase();
    if (p.sizing.v) any.layoutSizingVertical = String(p.sizing.v).toUpperCase();
  }
  if (p.shadow !== undefined) {
    any.effects = p.shadow === null ? [] : [{
      type: "DROP_SHADOW", color: parseColor(p.shadow.color || "#00000026"),
      offset: { x: +(p.shadow.x || 0), y: +(p.shadow.y || 2) }, radius: +(p.shadow.blur || 8),
      spread: +(p.shadow.spread || 0), visible: true, blendMode: "NORMAL",
    }];
  }
}

async function createNode(p: any): Promise<SceneNode> {
  const kind = String(p.kind || p.type || "FRAME").toUpperCase();
  let n: SceneNode;
  if (kind === "FRAME") { const f = figma.createFrame(); f.fills = []; n = f; }
  else if (kind === "RECTANGLE") n = figma.createRectangle();
  else if (kind === "ELLIPSE") n = figma.createEllipse();
  else if (kind === "TEXT") {
    const t = figma.createText();
    t.fontName = await resolveFont(p.fontFamily || "Inter", p.fontWeight || 400, false);
    t.characters = String(p.text || "Text");
    n = t;
  } else if (kind === "SVG") n = figma.createNodeFromSvg(String(p.svg || ""));
  else if (kind === "VECTOR") {
    const v = figma.createVector();
    v.vectorPaths = [{ windingRule: p.windingRule === "EVENODD" ? "EVENODD" : "NONZERO", data: String(p.path || "") }];
    n = v;
  } else throw new Error(`Onbekend soort laag: ${kind} (FRAME, RECTANGLE, ELLIPSE, TEXT, VECTOR of SVG)`);

  let parent: BaseNode & ChildrenMixin = figma.currentPage;
  if (p.parentId) {
    const pn = await figma.getNodeByIdAsync(p.parentId);
    if (!pn || !("appendChild" in pn)) throw new Error(`Ouder ${p.parentId} kan geen kinderen hebben`);
    parent = pn as BaseNode & ChildrenMixin;
  }
  parent.appendChild(n);
  const props = Object.assign({}, p);
  delete props.text; delete props.fontFamily; delete props.fontWeight; // already applied
  if (kind === "TEXT" && p.text === undefined) delete props.text;
  await applyProps(n, props);
  return n;
}

// ─────────────────────────── declarative build ───────────────────────────
//
// One command builds a whole tree of layers: frames with auto layout, shapes,
// vector paths, arcs and text, with fills, strokes, radii, spacing and text
// styles bound to local variables and styles by NAME. That is what makes a
// chart (dozens of marks, each bound to a colour token) one round trip
// instead of one hundred.

interface BuildCtx {
  vars: Map<string, Variable>;
  styles: Map<string, TextStyle>;
  keys: { [key: string]: string };
  count: number;
  roots: SceneNode[];
}

const CORNER_FIELDS = ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"];
const PADDING_FIELDS = ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"];

function bindPaint(n: SceneNode, prop: "fills" | "strokes", v: Variable) {
  const any = n as any;
  if (!(prop in n)) return false;
  const current: Paint[] = any[prop] === figma.mixed ? [] : any[prop].slice();
  const base: SolidPaint = (current.find((x) => x.type === "SOLID") as SolidPaint) || { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
  any[prop] = [figma.variables.setBoundVariableForPaint(base, "color", v)];
  return true;
}

/** Bind every paint of a layer and its descendants (an imported SVG is a frame full of vectors). */
function bindDeep(n: SceneNode, prop: "fills" | "strokes", v: Variable) {
  const any = n as any;
  if (prop in n && any[prop] !== figma.mixed && any[prop].length) bindPaint(n, prop, v);
  if ("children" in n) for (const c of (n as ChildrenMixin).children) bindDeep(c as SceneNode, prop, v);
}

/** Bind a number-like field. "cornerRadius" and "padding" fan out to their four sides. */
function bindField(n: SceneNode, field: string, v: Variable) {
  if (!("setBoundVariable" in n)) return false;
  const targets = field === "cornerRadius" || field === "radius" ? CORNER_FIELDS : field === "padding" ? PADDING_FIELDS : [field];
  for (const f of targets) (n as any).setBoundVariable(f, v);
  return true;
}

function lookupVar(ctx: BuildCtx, ref: string): Variable {
  const v = ctx.vars.get(ref) || ctx.vars.get(ref.toLowerCase());
  if (!v) throw new Error(`Variabele "${ref}" niet gevonden`);
  return v;
}

async function buildContext(): Promise<BuildCtx> {
  const vars = new Map<string, Variable>();
  for (const v of await figma.variables.getLocalVariablesAsync()) {
    if (!vars.has(v.name)) vars.set(v.name, v);
    if (!vars.has(v.name.toLowerCase())) vars.set(v.name.toLowerCase(), v);
  }
  const styles = new Map<string, TextStyle>();
  for (const s of await figma.getLocalTextStylesAsync()) styles.set(s.name, s);
  return { vars, styles, keys: {}, count: 0, roots: [] };
}

async function buildNode(spec: any, parent: BaseNode & ChildrenMixin, ctx: BuildCtx): Promise<SceneNode> {
  const kind = String(spec.kind || (spec.text !== undefined ? "TEXT" : "FRAME")).toUpperCase();
  const props: any = Object.assign({}, spec, { kind, parentId: parent.id });
  for (const k of ["children", "key", "fillVar", "strokeVar", "vars", "textStyle"]) delete props[k];

  let style: TextStyle | undefined;
  if (kind === "TEXT") {
    if (spec.textStyle) {
      style = ctx.styles.get(String(spec.textStyle));
      if (!style) throw new Error(`Tekststijl "${spec.textStyle}" bestaat niet. Bestaand: ${Array.from(ctx.styles.keys()).join(", ") || "geen"}`);
      await figma.loadFontAsync(style.fontName);
    }
    delete props.width; delete props.height;
  }

  const n = await createNode(props);
  ctx.count++;
  if (spec.key) ctx.keys[String(spec.key)] = n.id;

  if (n.type === "TEXT") {
    if (style) { await loadAllFontsOf(n); await n.setTextStyleIdAsync(style.id); }
    if (spec.width !== undefined) { n.textAutoResize = "HEIGHT"; n.resize(+spec.width, n.height); }
  }
  if (kind === "SVG") {
    // paints inside an imported SVG (icons): bind the ones that exist, leave the frame itself see-through
    if (spec.fillVar) bindDeep(n, "fills", lookupVar(ctx, String(spec.fillVar)));
    if (spec.strokeVar) bindDeep(n, "strokes", lookupVar(ctx, String(spec.strokeVar)));
  } else {
    if (spec.fillVar) bindPaint(n, "fills", lookupVar(ctx, String(spec.fillVar)));
    if (spec.strokeVar) bindPaint(n, "strokes", lookupVar(ctx, String(spec.strokeVar)));
  }
  if (spec.vars) for (const f of Object.keys(spec.vars)) bindField(n, f, lookupVar(ctx, String(spec.vars[f])));

  if (Array.isArray(spec.children) && "appendChild" in n) {
    for (const child of spec.children) {
      await buildNode(child, n as BaseNode & ChildrenMixin, ctx);
      if (ctx.count % 150 === 0) await yieldToFigma();
    }
  }
  return n;
}

async function buildTree(p: any) {
  let parent: BaseNode & ChildrenMixin = figma.currentPage;
  if (p.parentId) {
    const pn = await figma.getNodeByIdAsync(p.parentId);
    if (!pn || !("appendChild" in pn)) throw new Error(`Ouder ${p.parentId} kan geen kinderen hebben`);
    parent = pn as BaseNode & ChildrenMixin;
  }
  const trees: any[] = Array.isArray(p.tree) ? p.tree : [p.tree];
  if (!trees.length || !trees[0]) throw new Error("Geef een tree mee: { kind, name, children: [...] }.");
  const ctx = await buildContext();
  const existing = new Set(parent.children.map((c) => c.id));
  let currentName = "";
  try {
    for (const t of trees) {
      const spec = Object.assign({}, t);
      if (spec.x === undefined && p.x !== undefined) spec.x = p.x;
      if (spec.y === undefined && p.y !== undefined) spec.y = p.y;
      currentName = String(t.name || t.kind || "?");
      ctx.roots.push(await buildNode(spec, parent, ctx));
    }
  } catch (e) {
    // whatever this build made, including the half-finished root, goes again
    for (const c of parent.children.slice()) if (!existing.has(c.id)) { try { c.remove(); } catch (_) { /* already gone */ } }
    throw new Error(`build mislukt bij "${currentName}" (${ctx.count} lagen teruggedraaid): ${errMsg(e)}`);
  }
  // replace only after the new tree exists, so a failed build never costs you the old one
  if (p.replaceByName) {
    const fresh = new Set(ctx.roots.map((r) => r.id));
    const names = new Set(ctx.roots.map((r) => r.name));
    for (const sib of parent.children.slice()) if (!fresh.has(sib.id) && names.has(sib.name)) sib.remove();
  }
  return { roots: ctx.roots.map((r) => ({ id: r.id, name: r.name, type: r.type })), keys: ctx.keys, count: ctx.count };
}

// ─────────────────────────── export, pages ───────────────────────────

const EXPORT_FORMATS = ["PNG", "JPG", "SVG", "PDF", "JSON_REST_V1"];

/** Bytes (base64) or JSON of the given layers. The bridge writes them to disk. */
async function exportForBridge(p: any) {
  const format = String(p.format || "PNG").toUpperCase();
  if (EXPORT_FORMATS.indexOf(format) === -1) throw new Error(`Onbekend formaat ${format}. Kies uit: ${EXPORT_FORMATS.join(", ")}. Een .fig-bestand kan een plugin niet maken: gebruik in Figma Bestand > Lokale kopie opslaan.`);
  const nodes = await nodesFrom(p);
  const scale = +(p.scale || 2);
  const files: any[] = [];
  for (const n of nodes.slice(0, 50)) {
    if (!("exportAsync" in n)) continue;
    const meta = { id: n.id, name: n.name, type: n.type, format };
    const target = n as ExportMixin;
    if (format === "JSON_REST_V1") {
      files.push(Object.assign(meta, { json: await (target as any).exportAsync({ format: "JSON_REST_V1" }) }));
    } else if (format === "SVG") {
      const bytes = await target.exportAsync({ format: "SVG", svgOutlineText: p.outlineText !== false, svgIdAttribute: !!p.svgIds, svgSimplifyStroke: true });
      files.push(Object.assign(meta, { base64: figma.base64Encode(bytes) }));
    } else if (format === "PDF") {
      files.push(Object.assign(meta, { base64: figma.base64Encode(await target.exportAsync({ format: "PDF" })) }));
    } else {
      const bytes = await target.exportAsync({ format: format as "PNG" | "JPG", constraint: { type: "SCALE", value: scale } });
      files.push(Object.assign(meta, { scale, base64: figma.base64Encode(bytes) }));
    }
  }
  if (!files.length) throw new Error("Geen enkele van de opgegeven lagen kan geëxporteerd worden.");
  return { files };
}

async function setPage(p: any) {
  await figma.loadAllPagesAsync();
  const ref = String(p.name || p.id || "");
  let page = figma.root.children.find((pg) => pg.id === ref || pg.name === ref);
  if (!page && p.create) { page = figma.createPage(); page.name = ref; }
  if (!page) throw new Error(`Pagina "${ref}" niet gevonden. Bestaand: ${figma.root.children.map((pg) => pg.name).join(", ")}`);
  await figma.setCurrentPageAsync(page);
  return { id: page.id, name: page.name };
}

async function screenshot(p: any) {
  let nodes: SceneNode[];
  if (p.ids || p.id) nodes = await nodesFrom(p);
  else if (figma.currentPage.selection.length) nodes = figma.currentPage.selection.slice();
  else nodes = figma.currentPage.children.slice(0, 1) as SceneNode[];
  if (!nodes.length) throw new Error("Niets om te fotograferen: de pagina is leeg.");
  const maxPx = Math.min(+(p.maxSize || 1600), 4096);
  const images: any[] = [];
  for (const n of nodes.slice(0, 4)) {
    const w = (n as any).width || 1, h = (n as any).height || 1;
    const scale = Math.min(+(p.scale || 1), maxPx / Math.max(w, h));
    const bytes = await (n as ExportMixin).exportAsync({ format: "PNG", constraint: { type: "SCALE", value: Math.max(scale, 0.05) } });
    images.push({ id: n.id, name: n.name, width: Math.round(w * scale), height: Math.round(h * scale), base64: figma.base64Encode(bytes) });
  }
  return { images };
}

async function getVariablesDump() {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const out: any[] = [];
  for (const c of cols) {
    const vars: any[] = [];
    for (const id of c.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (!v) continue;
      const values: any = {};
      for (const m of c.modes) {
        const val: any = v.valuesByMode[m.modeId];
        if (val && typeof val === "object" && val.type === "VARIABLE_ALIAS") values[m.name] = { alias: await varName(val.id) };
        else if (val && typeof val === "object" && "r" in val) values[m.name] = toHex(val);
        else values[m.name] = val;
      }
      vars.push({ id: v.id, name: v.name, type: v.resolvedType, values, scopes: v.scopes, codeSyntax: (v as any).codeSyntax || {}, description: v.description || "" });
    }
    out.push({ id: c.id, name: c.name, modes: c.modes.map((m) => m.name), variables: vars });
  }
  return { collections: out };
}

async function getStylesDump() {
  const text = await figma.getLocalTextStylesAsync();
  const paint = await figma.getLocalPaintStylesAsync();
  const effect = await figma.getLocalEffectStylesAsync();
  return {
    text: text.map((s) => ({ id: s.id, name: s.name, font: s.fontName, size: s.fontSize, lineHeight: s.lineHeight })),
    paint: await Promise.all(paint.map(async (s) => ({ id: s.id, name: s.name, paints: await describePaints(s.paints) }))),
    effect: effect.map((s) => ({ id: s.id, name: s.name, effects: s.effects.map((e) => e.type) })),
  };
}

async function createVariables(p: any) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let col = collections.find((c) => c.name === p.collection);
  if (!col) col = figma.variables.createVariableCollection(String(p.collection || "tokens"));
  const modeNames: string[] = p.modes || [];
  modeNames.forEach((name, i) => {
    if (col!.modes.some((m) => m.name === name)) return;
    if (i === 0 && col!.modes.length === 1 && col!.variableIds.length === 0) col!.renameMode(col!.modes[0].modeId, name);
    else col!.addMode(name);
  });
  const modeId = (name: string) => {
    const m = col!.modes.find((x) => x.name === name);
    if (!m) throw new Error(`Mode "${name}" bestaat niet in ${col!.name}`);
    return m.modeId;
  };
  const existing = await figma.variables.getLocalVariablesAsync();
  const results: string[] = [];
  for (const spec of p.variables || []) {
    const type = String(spec.type || "COLOR").toUpperCase() as VariableResolvedDataType;
    let v = existing.find((x) => x.name === spec.name && x.variableCollectionId === col!.id);
    const isNew = !v;
    if (!v) v = figma.variables.createVariable(spec.name, col, type);
    const values = spec.values || (spec.value !== undefined ? { [col.modes[0].name]: spec.value } : {});
    for (const modeName of Object.keys(values)) {
      const raw = values[modeName];
      let val: VariableValue;
      if (raw && typeof raw === "object" && raw.alias) val = figma.variables.createVariableAlias(await findVariable(raw.alias));
      else if (type === "COLOR") val = parseColor(raw);
      else if (type === "FLOAT") val = +raw;
      else if (type === "BOOLEAN") val = !!raw;
      else val = String(raw);
      v.setValueForMode(modeId(modeName), val);
    }
    if (spec.scopes) v.scopes = spec.scopes;
    if (spec.description) v.description = String(spec.description);
    if (spec.codeSyntax) (v as any).setVariableCodeSyntax("WEB", String(spec.codeSyntax));
    results.push(`${isNew ? "nieuw" : "bijgewerkt"}: ${v.name}`);
  }
  return { collection: col.name, modes: col.modes.map((m) => m.name), results };
}

async function setCodeSyntax(p: any) {
  const platform = String(p.platform || "WEB") as CodeSyntaxPlatform;
  const map: { [k: string]: string } = p.map || {};
  const vars = await figma.variables.getLocalVariablesAsync();
  const results: string[] = [];
  for (const v of vars) {
    const syntax = map[v.name];
    if (typeof syntax !== "string") continue;
    v.setVariableCodeSyntax(platform, syntax);
    results.push(`${v.name} -> ${syntax}`);
  }
  return { platform, set: results.length, results };
}

async function deleteVariables(p: any) {
  const removed: string[] = [];
  if (Array.isArray(p.collections) && p.collections.length) {
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    for (const name of p.collections) {
      const c = cols.find((x) => x.name === name);
      if (c) { c.remove(); removed.push(`collectie ${name}`); }
    }
  }
  if (Array.isArray(p.names) && p.names.length) {
    const vars = await figma.variables.getLocalVariablesAsync();
    for (const v of vars) {
      if (p.names.indexOf(v.name) !== -1) { v.remove(); removed.push(v.name); }
    }
  }
  return { removed };
}

async function bindVariable(p: any) {
  const nodes = await nodesFrom(p);
  const v = await findVariable(String(p.variable));
  const field = String(p.field);
  let done = 0;
  for (const n of nodes) {
    const any = n as any;
    if (field === "fill" || field === "fills" || field === "stroke" || field === "strokes") {
      if (!bindPaint(n, field.indexOf("fill") === 0 ? "fills" : "strokes", v)) continue;
    } else if (!bindField(n, field, v)) continue;
    done++;
  }
  return { bound: done, variable: v.name, field };
}

async function applyTextStyle(p: any) {
  const nodes = (await nodesFrom(p)).filter((n) => n.type === "TEXT") as TextNode[];
  const styles = await figma.getLocalTextStylesAsync();
  const s = styles.find((x) => x.id === p.style || x.name === p.style);
  if (!s) throw new Error(`Tekststijl "${p.style}" niet gevonden. Bestaand: ${styles.map((x) => x.name).join(", ") || "geen"}`);
  await figma.loadFontAsync(s.fontName);
  for (const t of nodes) { await loadAllFontsOf(t); await t.setTextStyleIdAsync(s.id); }
  return { applied: nodes.length, style: s.name };
}


// ─────────────────────────── text styles in bulk ───────────────────────────

function pageNameOf(n: BaseNode): string {
  let cur: BaseNode | null = n;
  while (cur && cur.type !== "PAGE") cur = cur.parent;
  return cur ? cur.name : "?";
}

async function textNodesIn(p: any): Promise<TextNode[]> {
  await figma.loadAllPagesAsync();
  const ids: string[] = p.ids || (p.id ? [p.id] : []);
  if (!ids.length) return figma.root.findAllWithCriteria({ types: ["TEXT"] });
  const out: TextNode[] = [];
  for (const n of await nodesFrom(p)) {
    if (n.type === "TEXT") out.push(n);
    else if ("findAllWithCriteria" in n) out.push(...(n as FrameNode).findAllWithCriteria({ types: ["TEXT"] }));
  }
  return out;
}

function lineHeightLabel(t: TextNode): string {
  const lh = t.lineHeight;
  if (lh === figma.mixed) return "mixed";
  if (lh.unit === "AUTO") return "auto";
  return `${Math.round(lh.value * 100) / 100}${lh.unit === "PERCENT" ? "%" : "px"}`;
}

/** Count every text layer by font, size, weight and line height, so a type scale can be chosen from facts. */
async function textInventory(p: any) {
  const texts = await textNodesIn(p);
  const groups: { [k: string]: any } = {};
  let styled = 0, mixed = 0;
  for (const t of texts) {
    if (t.textStyleId && t.textStyleId !== figma.mixed) styled++;
    if (t.fontSize === figma.mixed || t.fontName === figma.mixed) { mixed++; continue; }
    const fn = t.fontName as FontName;
    const key = `${fn.family}|${t.fontSize}|${styleWeight(fn.style)}|${lineHeightLabel(t)}`;
    const g = groups[key] || (groups[key] = { family: fn.family, size: t.fontSize, weight: styleWeight(fn.style), lineHeight: lineHeightLabel(t), count: 0, pages: {}, samples: [] });
    g.count++;
    const pg = pageNameOf(t);
    g.pages[pg] = (g.pages[pg] || 0) + 1;
    if (g.samples.length < 3) g.samples.push({ id: t.id, text: t.characters.slice(0, 28) });
  }
  const list = Object.keys(groups).map((k) => groups[k]).sort((a, b) => b.count - a.count);
  return { total: texts.length, styled, mixed, groups: list };
}

/** Create (or, with update:true, redefine) text styles: [{ name, size, weight, family?, lineHeightPercent? | lineHeightPx? }] */
async function createTextStylesBulk(p: any) {
  const defs: any[] = p.styles || [];
  if (!defs.length) throw new Error("Geef styles mee: [{ name, size, weight, lineHeightPercent }]");
  const existing = await figma.getLocalTextStylesAsync();
  const made: string[] = [], updated: string[] = [], skipped: string[] = [];
  for (const d of defs) {
    let s = existing.find((x) => x.name === d.name);
    if (s && !p.update) { skipped.push(d.name); continue; }
    const font = await resolveFont(d.family || "Inter", d.weight || 400, false);
    await figma.loadFontAsync(font);
    if (!s) { s = figma.createTextStyle(); s.name = d.name; made.push(`${d.name} (${d.size}px ${font.style})`); }
    else updated.push(d.name);
    s.fontName = font;
    s.fontSize = d.size;
    if (d.lineHeightPx !== undefined) s.lineHeight = { unit: "PIXELS", value: d.lineHeightPx };
    else s.lineHeight = { unit: "PERCENT", value: d.lineHeightPercent !== undefined ? d.lineHeightPercent : 150 };
  }
  return { made, updated, skipped };
}

/**
 * Apply local text styles by matching each text layer on size and weight.
 * rules: [{ size, weight, style }]  (size within 0.05). timeBudgetMs: stop after this long (default 40000, 0 = no limit) and report `remaining`. dryRun:true only counts; onlyUnstyled:true leaves styled layers alone; limit:N does at most N per call (a call must finish within 60 s), `remaining` says how many are left.
 * Layers that match no rule, or have mixed fonts, are reported and left alone.
 */
async function applyTextStylesAuto(p: any) {
  const rules: any[] = p.rules || [];
  if (!rules.length) throw new Error("Geef rules mee: [{ size, weight, style }]");
  const styles = await figma.getLocalTextStylesAsync();
  const resolved = rules.map((r) => {
    const s = styles.find((x) => x.name === r.style || x.id === r.style);
    if (!s) throw new Error(`Tekststijl "${r.style}" bestaat niet`);
    return { size: r.size, weight: r.weight, style: s };
  });
  const texts = await textNodesIn(p);
  // A call never runs longer than the budget (default 40 s, 0 = no limit): it returns what is done and
  // "remaining", so the caller can simply call again. Fonts are loaded once per font, not once per layer.
  const started = Date.now();
  const budget = p.timeBudgetMs === undefined ? 40000 : Number(p.timeBudgetMs);
  const fontsLoaded = new Set<string>();
  const ensureFont = async (f: FontName) => {
    const key = f.family + "|" + f.style;
    if (fontsLoaded.has(key)) return;
    await figma.loadFontAsync(f);
    fontsLoaded.add(key);
  };
  const applied: { [k: string]: number } = {};
  const unmatched: { [k: string]: { count: number; sample: string } } = {};
  let skippedMixed = 0, already = 0, done = 0, more = 0;
  for (const t of texts) {
    if (t.fontSize === figma.mixed || t.fontName === figma.mixed) { skippedMixed++; continue; }
    if (p.skipInstances && insideInstance(t)) continue;
    if (p.onlyUnstyled && t.textStyleId && t.textStyleId !== figma.mixed) { already++; continue; }
    const w = styleWeight((t.fontName as FontName).style);
    const rule = resolved.find((r) => Math.abs(r.size - (t.fontSize as number)) < 0.05 && r.weight === w);
    if (!rule) {
      const k = `${t.fontSize}/${w}`;
      const u = unmatched[k] || (unmatched[k] = { count: 0, sample: t.id });
      u.count++;
      continue;
    }
    if (t.textStyleId === rule.style.id) { already++; continue; }
    if (p.limit && done >= p.limit) { more++; continue; }
    if (bridgeCancelRequested || (budget > 0 && Date.now() - started > budget)) { more++; continue; }
    done++;
    if (!p.dryRun) {
      // layers with mixed fonts were skipped above, so this is one font
      await ensureFont(t.fontName as FontName);
      await ensureFont(rule.style.fontName);
      await t.setTextStyleIdAsync(rule.style.id);
    }
    applied[rule.style.name] = (applied[rule.style.name] || 0) + 1;
  }
  return { dryRun: !!p.dryRun, total: texts.length, applied, already, skippedMixed, unmatched, remaining: more, cancelled: bridgeCancelRequested, ms: Date.now() - started };
}


// ─────────────────────────── layer audit & fixes ───────────────────────────

function insideInstance(n: BaseNode): boolean {
  let cur: BaseNode | null = n.parent;
  while (cur && cur.type !== "PAGE" && cur.type !== "DOCUMENT") {
    if (cur.type === "INSTANCE") return true;
    cur = cur.parent;
  }
  return false;
}

const GENERIC_NAME = /^(Frame|Rectangle|Group|Vector|Ellipse|Line|Polygon|Star|Boolean|Slice|Section|Component|Instance|Text|Image)( \d+)?$/;

/** Facts for the rubric: generic layer names, frames without auto layout, off-grid spacing and raw colours (layers outside instances only). */
async function layerAudit(p: any) {
  await figma.loadAllPagesAsync();
  const all = figma.root.findAll(() => true);
  const own = all.filter((n) => !insideInstance(n));
  const generic: { [k: string]: { count: number; samples: string[]; parents: { [k: string]: number } } } = {};
  const noAuto: { [k: string]: { count: number; children: number; samples: string[]; pages: { [k: string]: number } } } = {};
  const offGrid: { id: string; name: string; page: string; values: number[] }[] = [];
  const raw: { [k: string]: { count: number; pages: { [k: string]: number }; types: { [k: string]: number }; samples: string[] } } = {};
  for (const n of own) {
    if (GENERIC_NAME.test(n.name)) {
      const k = n.type;
      const g = generic[k] || (generic[k] = { count: 0, samples: [], parents: {} });
      g.count++;
      if (g.samples.length < 6) g.samples.push(`${n.id} "${n.name}"`);
      const pn = n.parent ? n.parent.name : "?";
      g.parents[pn] = (g.parents[pn] || 0) + 1;
    }
    if ((n.type === "FRAME" || n.type === "COMPONENT") && "layoutMode" in n) {
      const f = n as FrameNode;
      if (f.layoutMode === "NONE" && f.children.length > 0 && f.name.charAt(0) !== "_") {
        const k = f.name.replace(/\d+/g, "#");
        const g = noAuto[k] || (noAuto[k] = { count: 0, children: 0, samples: [], pages: {} });
        g.count++;
        g.children += f.children.length;
        if (g.samples.length < 4) g.samples.push(f.id);
        const pg = pageNameOf(f);
        g.pages[pg] = (g.pages[pg] || 0) + 1;
      }
      if (f.layoutMode !== "NONE") {
        const vals = [f.paddingLeft, f.paddingRight, f.paddingTop, f.paddingBottom, f.itemSpacing].concat(f.layoutWrap === "WRAP" ? [f.counterAxisSpacing || 0] : []);
        const bad = vals.filter((v) => v % GRID !== 0);
        if (bad.length) offGrid.push({ id: f.id, name: f.name, page: pageNameOf(f), values: vals });
      }
    }
    const paints: { kind: string; paint: Paint }[] = [];
    if ("fills" in n && Array.isArray((n as GeometryMixin).fills)) ((n as GeometryMixin).fills as Paint[]).forEach((x) => paints.push({ kind: "fill", paint: x }));
    if ("strokes" in n) (n as GeometryMixin).strokes.forEach((x) => paints.push({ kind: "stroke", paint: x }));
    for (const { kind, paint } of paints) {
      if (paint.type !== "SOLID" || paint.visible === false) continue;
      if (paint.boundVariables && paint.boundVariables.color) continue;
      if ("fillStyleId" in n && kind === "fill" && (n as any).fillStyleId) continue;
      const hex = "#" + [paint.color.r, paint.color.g, paint.color.b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
      const g = raw[hex] || (raw[hex] = { count: 0, pages: {}, types: {}, samples: [] });
      g.count++;
      const pg = pageNameOf(n);
      g.pages[pg] = (g.pages[pg] || 0) + 1;
      g.types[n.type + ":" + kind] = (g.types[n.type + ":" + kind] || 0) + 1;
      if (g.samples.length < 4) g.samples.push(`${n.id} "${n.name}"`);
    }
  }
  return { nodesOutsideInstances: own.length, generic, noAuto, offGridCount: offGrid.length, offGrid: offGrid.slice(0, p.max || 60), raw };
}

/** Bind unbound solid fills/strokes of an exact colour to a variable: map { "#999999": "text/muted" } (layers outside instances; limit:N per call). */
async function bindRawColors(p: any) {
  await figma.loadAllPagesAsync();
  const map: { [k: string]: string } = p.map || {};
  const vars = await figma.variables.getLocalVariablesAsync("COLOR");
  const byName: { [k: string]: Variable } = {};
  vars.forEach((v) => (byName[v.name] = v));
  for (const hex of Object.keys(map)) if (!byName[map[hex]]) throw new Error(`Variabele "${map[hex]}" bestaat niet`);
  const roots: BaseNode[] = p.ids && p.ids.length ? await nodesFrom(p) : [figma.root];
  const nodes: SceneNode[] = [];
  for (const r of roots) {
    if (r.type !== "DOCUMENT" && r.type !== "PAGE") nodes.push(r as SceneNode);
    if ("findAll" in r) nodes.push(...(r as ChildrenMixin).findAll(() => true));
  }
  const done: { [k: string]: number } = {};
  let more = 0, count = 0, transparentSkipped = 0;
  for (const n of nodes) {
    if (insideInstance(n)) continue;
    for (const kind of ["fills", "strokes"] as const) {
      if (!(kind in n)) continue;
      const list = (n as any)[kind] as Paint[];
      if (!Array.isArray(list)) continue;
      let changed = false;
      const next = list.map((paint) => {
        if (paint.type !== "SOLID" || (paint.boundVariables && paint.boundVariables.color)) return paint;
        // A variable holds a colour without transparency: binding a see-through fill (a dark overlay, say) turned it
        // opaque. Leave those alone and report them.
        if (paint.opacity !== undefined && paint.opacity < 1) { transparentSkipped++; return paint; }
        const hex = "#" + [paint.color.r, paint.color.g, paint.color.b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
        const target = map[hex];
        if (!target) return paint;
        if (p.limit && count >= p.limit) { more++; return paint; }
        count++;
        changed = true;
        done[hex + " -> " + target] = (done[hex + " -> " + target] || 0) + 1;
        return figma.variables.setBoundVariableForPaint(paint, "color", byName[target]);
      });
      if (changed && !p.dryRun) (n as any)[kind] = next;
    }
  }
  return { dryRun: !!p.dryRun, bound: done, remaining: more, skippedTransparent: transparentSkipped };
}

/** Instances of a component or of a variant in a component set, with text overrides. */
async function createInstance(p: any) {
  const src = await figma.getNodeByIdAsync(p.componentId || p.id);
  if (!src) throw new Error(`Component ${p.componentId || p.id} niet gevonden`);
  let comp: ComponentNode;
  if (src.type === "COMPONENT_SET") {
    const want: { [k: string]: string } = p.variant || {};
    const match = (src as ComponentSetNode).children.find((c) => {
      if (c.type !== "COMPONENT") return false;
      const have = (c as ComponentNode).variantProperties || {};
      return Object.keys(want).every((k) => have[k] === want[k]);
    });
    if (!match) throw new Error(`Geen variant ${JSON.stringify(want)} in "${src.name}"`);
    comp = match as ComponentNode;
  } else if (src.type === "COMPONENT") comp = src as ComponentNode;
  else throw new Error(`${src.name} is geen component (${src.type})`);

  const inst = comp.createInstance();
  let parent: BaseNode & ChildrenMixin = figma.currentPage;
  if (p.parentId) {
    const pn = await figma.getNodeByIdAsync(p.parentId);
    if (!pn || !("appendChild" in pn)) throw new Error(`Ouder ${p.parentId} kan geen kinderen hebben`);
    parent = pn as BaseNode & ChildrenMixin;
  }
  parent.appendChild(inst);
  if (p.props) await applyProps(inst, p.props);
  // texts: { "<layer name>": "new text" } sets the first text layer with that name inside the instance
  const set: string[] = [];
  for (const layer of Object.keys(p.texts || {})) {
    const t = inst.findOne((n) => n.type === "TEXT" && n.name === layer) as TextNode | null;
    if (!t) throw new Error(`Geen tekstlaag "${layer}" in ${comp.name}`);
    await loadAllFontsOf(t);
    t.characters = String(p.texts[layer]);
    set.push(layer);
  }
  return { id: inst.id, name: inst.name, component: comp.id, textsSet: set };
}

/** Components and component sets of the file, with their variants, so a script can pick them. */
async function listComponents() {
  await figma.loadAllPagesAsync();
  const out: any[] = [];
  for (const page of figma.root.children) {
    for (const n of page.findAll((x) => x.type === "COMPONENT_SET" || (x.type === "COMPONENT" && !(x.parent && x.parent.type === "COMPONENT_SET")))) {
      if (n.type === "COMPONENT_SET") {
        out.push({
          id: n.id, name: n.name, type: n.type, page: page.name,
          properties: Object.keys((n as ComponentSetNode).componentPropertyDefinitions || {}),
          variants: (n as ComponentSetNode).children.map((c) => ({ id: c.id, name: c.name })),
        });
      } else out.push({ id: n.id, name: n.name, type: n.type, page: page.name });
    }
  }
  return { components: out };
}

/** Show layers in another mode of a variable collection, e.g. the Dark mode of the Semantic variables. */
async function setVariableMode(p: any) {
  const nodes = await nodesFrom(p);
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const col = collections.find((c) => c.name === p.collection);
  if (!col) throw new Error(`Collectie "${p.collection}" bestaat niet`);
  const mode = col.modes.find((m) => m.name === p.mode);
  if (!mode) throw new Error(`Mode "${p.mode}" bestaat niet in "${col.name}" (${col.modes.map((m) => m.name).join(", ")})`);
  for (const n of nodes) (n as any).setExplicitVariableModeForCollection(col, mode.modeId);
  return { set: nodes.map((n) => n.id), collection: col.name, mode: mode.name };
}

/**
 * Bind raw padding, gaps and corner radii to FLOAT variables by their value, like bind_raw_colors does for colours.
 * map: { "8": "space/1", "16": "space/2" }, radiusMap: { "8": "radius/sm" }. Values without a variable are reported
 * as offGrid. Layers inside instances are skipped (the component carries the binding).
 */
async function bindRawSpacing(p: any) {
  await figma.loadAllPagesAsync();
  const map: { [k: string]: string } = p.map || {};
  const radiusMap: { [k: string]: string } = p.radiusMap || {};
  const vars = await figma.variables.getLocalVariablesAsync("FLOAT");
  const byName: { [k: string]: Variable } = {};
  vars.forEach((v) => (byName[v.name] = v));
  for (const name of Object.values(map).concat(Object.values(radiusMap))) if (!byName[name]) throw new Error(`Variabele "${name}" bestaat niet`);
  const roots: BaseNode[] = p.ids && p.ids.length ? await nodesFrom(p) : [figma.root];
  const nodes: SceneNode[] = [];
  for (const r of roots) {
    if (r.type !== "DOCUMENT" && r.type !== "PAGE") nodes.push(r as SceneNode);
    if ("findAll" in r) nodes.push(...(r as ChildrenMixin).findAll(() => true));
  }
  const spacingFields = ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "itemSpacing"];
  const radiusFields = ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"];
  const bound: { [k: string]: number } = {}, offGrid: { [k: string]: number } = {};
  const note = (bag: { [k: string]: number }, key: string) => { bag[key] = (bag[key] || 0) + 1; };
  for (const n of nodes) {
    if (insideInstance(n)) continue;
    const any = n as any;
    if ("layoutMode" in n && any.layoutMode !== "NONE") {
      for (const f of spacingFields) {
        const v = any[f];
        if (typeof v !== "number" || v <= 0 || (any.boundVariables && any.boundVariables[f])) continue;
        const target = map[String(v)];
        if (!target) { note(offGrid, `${f}=${v}`); continue; }
        if (!p.dryRun) any.setBoundVariable(f, byName[target]);
        note(bound, `${v} -> ${target}`);
      }
    }
    if ("topLeftRadius" in n) {
      for (const f of radiusFields) {
        const v = any[f];
        if (typeof v !== "number" || v <= 0 || (any.boundVariables && any.boundVariables[f])) continue;
        const target = radiusMap[String(v)];
        if (!target) { note(offGrid, `${f}=${v}`); continue; }
        if (!p.dryRun) any.setBoundVariable(f, byName[target]);
        note(bound, `radius ${v} -> ${target}`);
      }
    }
  }
  return { dryRun: !!p.dryRun, bound, offGrid };
}

/** Snap off-grid padding and gaps of layers outside instances to the 4 px grid (round half up). */
async function snapToGrid(p: any) {
  await figma.loadAllPagesAsync();
  const roots: BaseNode[] = p.ids && p.ids.length ? await nodesFrom(p) : [figma.root];
  const nodes: SceneNode[] = [];
  for (const r of roots) {
    if (r.type !== "DOCUMENT" && r.type !== "PAGE") nodes.push(r as SceneNode);
    if ("findAll" in r) nodes.push(...(r as ChildrenMixin).findAll(() => true));
  }
  const snap = (v: number) => (v % GRID === 0 ? v : Math.round(v / GRID) * GRID || (v > 0 ? GRID : 0));
  const changes: { [k: string]: number } = {};
  let count = 0, more = 0;
  for (const n of nodes) {
    if ((n.type !== "FRAME" && n.type !== "COMPONENT" && n.type !== "COMPONENT_SET") || insideInstance(n)) continue;
    const f = n as FrameNode;
    if (f.layoutMode === "NONE") continue;
    const fields = ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "itemSpacing"] as const;
    for (const key of fields) {
      const v = f[key];
      if (v % GRID === 0) continue;
      if (p.limit && count >= p.limit) { more++; continue; }
      count++;
      const to = snap(v);
      changes[`${key}: ${v} -> ${to}`] = (changes[`${key}: ${v} -> ${to}`] || 0) + 1;
      if (!p.dryRun) f[key] = to;
    }
  }
  return { dryRun: !!p.dryRun, changes, remaining: more };
}


/** Remove duplicate text styles (same name): keep the one used by most layers. */
async function dedupeTextStyles() {
  await figma.loadAllPagesAsync();
  const styles = await figma.getLocalTextStylesAsync();
  const used: { [id: string]: number } = {};
  for (const t of figma.root.findAllWithCriteria({ types: ["TEXT"] })) {
    if (t.textStyleId && t.textStyleId !== figma.mixed) used[t.textStyleId] = (used[t.textStyleId] || 0) + 1;
  }
  const byName: { [k: string]: TextStyle[] } = {};
  styles.forEach((x) => (byName[x.name] = (byName[x.name] || []).concat([x])));
  const removed: string[] = [];
  for (const name of Object.keys(byName)) {
    const group = byName[name];
    if (group.length < 2) continue;
    group.sort((a, b) => (used[b.id] || 0) - (used[a.id] || 0));
    for (const extra of group.slice(1)) {
      if (used[extra.id]) continue;
      extra.remove();
      removed.push(name);
    }
  }
  return { removed };
}

/** Names of local colour variables (so a binding map can use real names). */
async function listColorVariables() {
  const vars = await figma.variables.getLocalVariablesAsync("COLOR");
  return { names: vars.map((v) => v.name) };
}


/** Give generic layer names ("Frame 12", "Ellipse", "Vector") a meaningful name by role (layers outside instances). */
async function renameGeneric(p: any) {
  await figma.loadAllPagesAsync();
  const nodes = figma.root.findAll((n) => !insideInstance(n) && GENERIC_NAME.test(n.name) && (n.type === "FRAME" || n.type === "ELLIPSE" || n.type === "VECTOR"));
  const made: { [k: string]: number } = {};
  for (const n of nodes) {
    let name = "";
    if (n.type === "ELLIPSE") name = n.width <= 12 ? "Status dot" : "Circle";
    else if (n.type === "VECTOR") name = "Icon path";
    else {
      const f = n as FrameNode;
      const text = f.findOne((c) => c.type === "TEXT") as TextNode | null;
      const kids = f.children;
      if (kids.length === 0) name = "Spacer";
      else if (kids.every((c) => c.type === "VECTOR" || c.type === "ELLIPSE" || c.type === "BOOLEAN_OPERATION")) name = "Icon";
      else if (text && kids.length === 1 && kids[0].type === "TEXT") name = "Label";
      else if (text) name = (f.layoutMode === "VERTICAL" ? "Stack: " : f.layoutMode === "HORIZONTAL" ? "Row: " : "Group: ") + text.characters.replace(/\s+/g, " ").slice(0, 24);
      else name = f.layoutMode === "VERTICAL" ? "Stack" : f.layoutMode === "HORIZONTAL" ? "Row" : "Container";
    }
    made[name.split(":")[0]] = (made[name.split(":")[0]] || 0) + 1;
    if (!p.dryRun) n.name = name;
  }
  return { dryRun: !!p.dryRun, renamed: nodes.length, byName: made };
}

// ─────────────────────────── prototype: hover ───────────────────────────

function describeReaction(r: Reaction) {
  const acts = r.actions || (r.action ? [r.action] : []);
  return {
    trigger: r.trigger ? r.trigger.type : null,
    actions: acts.map((a: any) => ({ type: a.type, navigation: a.navigation, destinationId: a.destinationId, transition: a.transition ? a.transition.type : undefined })),
  };
}

/** Clone layers next to the original (a cloned variant stays in its component set). */
async function duplicateNodes(p: any) {
  const out = [];
  for (const n of await nodesFrom(p)) {
    const c = (n as any).clone() as SceneNode;
    const props = Object.assign({}, p.props || {});
    if (props.x === undefined && props.y === undefined && "width" in n) props.x = n.x + (n as any).width + 24;
    await applyProps(c, props);
    out.push({ id: c.id, name: c.name, type: c.type });
  }
  return { created: out };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what}: geen antwoord binnen ${ms / 1000} s`)), ms))]);

function collectInstances(n: SceneNode, out: InstanceNode[]) {
  if (n.type === "INSTANCE") out.push(n);
  if ("children" in n) for (const c of n.children) collectInstances(c, out);
}

/**
 * The component sets behind the given nodes. With deep, every instance inside
 * them counts (a whole screen at once); nodes that can't be used are reported
 * in `skipped` instead of failing the whole call.
 */
async function componentSetsFrom(p: any): Promise<{ sets: ComponentSetNode[]; skipped: any[] }> {
  const sets = new Map<string, ComponentSetNode>();
  const skipped: any[] = [];
  const seenMain = new Set<string>();
  let candidates: SceneNode[] = await nodesFrom(p);
  if (p.deep) {
    const inst: InstanceNode[] = [];
    for (const n of candidates) collectInstances(n, inst);
    candidates = inst;
  }
  for (const n of candidates) {
    let s: BaseNode | null = n;
    try {
      if (n.type === "INSTANCE") s = await withTimeout(n.getMainComponentAsync(), 5000, `hoofdcomponent van ${n.name}`);
    } catch (e: any) { skipped.push({ node: n.name, id: n.id, reason: e.message }); continue; }
    if (s && s.type === "COMPONENT") {
      if (seenMain.has(s.id)) continue;
      seenMain.add(s.id);
      if (s.remote) { skipped.push({ node: n.name, id: n.id, reason: "komt uit een bibliotheek: voeg hover toe in het bibliotheekbestand" }); continue; }
      s = s.parent;
    }
    if (!s || s.type !== "COMPONENT_SET") {
      if (!p.deep) skipped.push({ node: n.name, id: n.id, reason: "geen component set, variant of instance ervan" });
      continue;
    }
    sets.set(s.id, s);
  }
  return { sets: [...sets.values()], skipped };
}

/**
 * Prototype hover: on every "from" variant (e.g. state=default) set
 * "While hovering → Change to" the matching "to" variant (state=hover) with
 * the same other properties. Figma reverts automatically when the mouse leaves.
 */
async function setHover(p: any) {
  const ms = p.duration !== undefined ? +p.duration : 150;
  const kind = String(p.transition || "smart").toLowerCase();
  const transition: Transition | null = kind === "instant" ? null : {
    type: kind === "dissolve" ? "DISSOLVE" : "SMART_ANIMATE",
    easing: { type: (String(p.easing || "EASE_OUT").toUpperCase() as any) },
    duration: ms / 1000,
  };
  const result: any[] = [];
  const { sets, skipped } = await componentSetsFrom(p);
  for (const set of sets) {
    try { result.push(await hoverForSet(set, p, transition)); }
    catch (e: any) { result.push({ set: set.name, id: set.id, error: e.message }); }
  }
  return { sets: result, skipped };
}

async function hoverForSet(set: ComponentSetNode, p: any, transition: Transition | null) {
  const variants = set.children.filter((c): c is ComponentNode => c.type === "COMPONENT");
  const defs = Object.keys(set.componentPropertyDefinitions || {}).filter((k) => set.componentPropertyDefinitions[k].type === "VARIANT");
  const toValue = String(p.to || "hover");
  const key = p.property
    ? defs.find((k) => same(k, String(p.property)))
    : defs.find((k) => (set.componentPropertyDefinitions[k].variantOptions || []).some((v) => same(v, toValue)));
  if (!key) return { set: set.name, id: set.id, error: `Geen variant-property met de waarde "${toValue}". Maak eerst een hover-variant.`, properties: defs };
  const options = set.componentPropertyDefinitions[key].variantOptions || [];
  const fromValue = p.from ? String(p.from) : options.find((v) => ["default", "rest", "normal", "idle", "base"].some((d) => same(v, d)));
  if (!fromValue) return { set: set.name, id: set.id, error: `Geef "from" mee: welke waarde van ${key} is de rusttoestand?`, options };

  const linked = [], missing = [];
  for (const src of variants) {
    const vp = src.variantProperties || {};
    if (!vp[key] || !same(vp[key], fromValue)) continue;
    const dst = variants.find((v) => {
      const tp = v.variantProperties || {};
      return tp[key] && same(tp[key], toValue) && Object.keys(vp).every((k) => k === key || tp[k] === vp[k]);
    });
    if (!dst) { missing.push(src.name); continue; }
    const kept = src.reactions.filter((r) => !(r.trigger && r.trigger.type === "ON_HOVER"));
    await src.setReactionsAsync([...kept, {
      trigger: { type: "ON_HOVER" },
      actions: [{ type: "NODE", destinationId: dst.id, navigation: "CHANGE_TO", transition, resetVideoPosition: false }],
    }]);
    linked.push({ from: src.name, to: dst.name });
  }
  return { set: set.name, id: set.id, property: key, from: fromValue, to: toValue, linked, missing };
}

/**
 * Heavy commands that change many layers. A call that the bridge gave up on (timeout) keeps running
 * in Figma, so a second call of the same command used to start a duplicate job and the jobs piled up
 * behind each other. Now a second call answers at once with { busy: true } instead.
 */
const GUARDED_COMMANDS = new Set([
  "apply_text_styles_auto", "create_text_styles_bulk", "bind_raw_colors", "bind_raw_spacing", "snap_to_grid", "rename_generic", "dedupe_text_styles",
]);
const runningCommands = new Map<string, number>();
/** Set by the "cancel" command; long loops look at it between layers and stop with what they have */
let bridgeCancelRequested = false;

async function bridgeCommand(cmd: string, p: any): Promise<any> {
  if (cmd === "cancel") {
    bridgeCancelRequested = true;
    return { bridgeCancelRequested: true, running: Array.from(runningCommands.keys()) };
  }
  if (!GUARDED_COMMANDS.has(cmd)) return runBridgeCommand(cmd, p);
  const since = runningCommands.get(cmd);
  if (since !== undefined) {
    return {
      busy: true, command: cmd, runningForSeconds: Math.round((Date.now() - since) / 1000),
      hint: "Dezelfde opdracht loopt nog in Figma. Wacht tot hij klaar is, of stuur het commando cancel.",
    };
  }
  runningCommands.set(cmd, Date.now());
  bridgeCancelRequested = false;
  try {
    return await runBridgeCommand(cmd, p);
  } finally {
    runningCommands.delete(cmd);
  }
}

async function runBridgeCommand(cmd: string, p: any): Promise<any> {
  switch (cmd) {
    case "status":
      return {
        fileName: figma.root.name, page: figma.currentPage.name, pageId: figma.currentPage.id,
        selection: figma.currentPage.selection.map((n) => ({ id: n.id, name: n.name, type: n.type })),
        pluginVersion: typeof PLUGIN_VERSION !== "undefined" ? PLUGIN_VERSION : "?", featureVersion: FEATURE_VERSION,
      };
    case "get_document": {
      await figma.loadAllPagesAsync();
      return {
        fileName: figma.root.name, currentPageId: figma.currentPage.id,
        pages: figma.root.children.map((pg) => ({
          id: pg.id, name: pg.name,
          children: pg.children.slice(0, 200).map((c) => ({ id: c.id, name: c.name, type: c.type, w: Math.round((c as any).width || 0), h: Math.round((c as any).height || 0) })),
        })),
      };
    }
    case "get_selection": {
      const out = [];
      for (const n of figma.currentPage.selection) out.push(await describeNode(n, +(p.depth ?? 1)));
      return { selection: out };
    }
    case "get_node": {
      const nodes = await nodesFrom(p);
      const out = [];
      for (const n of nodes) out.push(await describeNode(n, Math.min(+(p.depth ?? 2), 6)));
      return { nodes: out };
    }
    case "screenshot": return screenshot(p);
    case "get_variables": return getVariablesDump();
    case "get_styles": return getStylesDump();
    case "rubric_check": return rubricAudit();
    case "create": { const n = await createNode(p); return { id: n.id, name: n.name, type: n.type }; }
    case "build": return buildTree(p);
    case "export": return exportForBridge(p);
    case "set_page": return setPage(p);
    case "update": {
      const nodes = await nodesFrom(p);
      for (const n of nodes) await applyProps(n, p.props || {});
      return { updated: nodes.map((n) => n.id) };
    }
    case "delete": {
      const nodes = await nodesFrom(p);
      const ids = nodes.map((n) => n.id);
      nodes.forEach((n) => n.remove());
      return { deleted: ids };
    }
    case "create_component": {
      const nodes = await nodesFrom(p);
      const out = nodes.map((n) => {
        const c = figma.createComponentFromNode(n);
        if (p.name && nodes.length === 1) c.name = p.name;
        return { id: c.id, name: c.name };
      });
      return { components: out };
    }
    case "combine_as_variants": {
      const nodes = await nodesFrom(p);
      const comps = nodes.map((n) => (n.type === "COMPONENT" ? n : figma.createComponentFromNode(n)));
      const parent = (comps[0].parent && "appendChild" in comps[0].parent ? comps[0].parent : figma.currentPage) as BaseNode & ChildrenMixin;
      const set = figma.combineAsVariants(comps, parent);
      if (p.name) set.name = p.name;
      return { id: set.id, name: set.name, variantProperties: Object.keys(set.componentPropertyDefinitions) };
    }
    case "duplicate": return duplicateNodes(p);
    case "set_hover": return setHover(p);
    case "create_variables": return createVariables(p);
    case "set_code_syntax": return setCodeSyntax(p);
    case "delete_variables": return deleteVariables(p);
    case "bind_variable": return bindVariable(p);
    case "apply_text_style": return applyTextStyle(p);
    case "create_spacing_variables": return { made: await createSpacingVariables() };
    case "create_text_styles": return createTextStyles();
    case "text_inventory": return textInventory(p);
    case "create_text_styles_bulk": return createTextStylesBulk(p);
    case "apply_text_styles_auto": return applyTextStylesAuto(p);
    case "layer_audit": return layerAudit(p);
    case "rename_generic": return renameGeneric(p);
    case "dedupe_text_styles": return dedupeTextStyles();
    case "list_color_variables": return listColorVariables();
    case "bind_raw_colors": return bindRawColors(p);
    case "bind_raw_spacing": return bindRawSpacing(p);
    case "create_instance": return createInstance(p);
    case "get_components": return listComponents();
    case "set_variable_mode": return setVariableMode(p);
    case "snap_to_grid": return snapToGrid(p);
    case "import_layout": return importLayout(p.doc, p.options || p);
    case "set_selection": {
      const nodes = await nodesFrom(p);
      figma.currentPage.selection = nodes;
      if (p.zoom !== false) figma.viewport.scrollAndZoomIntoView(nodes);
      return { selected: nodes.map((n) => n.id) };
    }
    case "notify": figma.notify(String(p.message || "").slice(0, 200)); return { ok: true };
    default:
      throw new Error(`Onbekend commando "${cmd}"`);
  }
}

// ─────────────────────────── message routing ───────────────────────────

figma.on("currentpagechange", () => uiSend("x:page", { page: figma.currentPage.name, fileName: figma.root.name }));

figma.ui.on("message", async (msg: any) => {
  if (!isFeatureMessage(msg)) return;
  try {
    switch (msg.type) {
      case "x:hello":
        uiSend("x:info", { featureVersion: FEATURE_VERSION, fileName: figma.root.name, fileKey: (figma as any).fileKey || null, page: figma.currentPage.name, bridge: (await figma.clientStorage.getAsync("bridge")) || null });
        break;
      case "x:save-bridge":
        await figma.clientStorage.setAsync("bridge", msg.value || null);
        break;
      case "x:rubric-audit":
        uiSend("x:rubric-report", { report: await rubricAudit() });
        break;
      case "x:rubric-spacing":
        uiSend("x:rubric-done", { title: "Spacing and radius variables", made: await createSpacingVariables() });
        uiSend("x:rubric-report", { report: await rubricAudit() });
        break;
      case "x:rubric-textstyles": {
        const r = await createTextStyles();
        uiSend("x:rubric-done", { title: "Text styles", made: r.made, failed: r.failed });
        uiSend("x:rubric-report", { report: await rubricAudit() });
        break;
      }
      case "x:layout-import":
        uiSend("x:layout-done", { result: await importLayout(msg.doc, msg.options || {}) });
        break;
      case "x:bridge-cmd":
        try {
          const result = await bridgeCommand(String(msg.cmd), msg.params || {});
          uiSend("x:bridge-result", { id: msg.id, ok: true, result });
        } catch (e) {
          uiSend("x:bridge-result", { id: msg.id, ok: false, error: errMsg(e) });
        }
        break;
    }
  } catch (e) {
    uiSend("x:error", { message: errMsg(e), during: msg.type });
  }
});
