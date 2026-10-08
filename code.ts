// Figma Extract All v18.2.0 — Robust, memory-safe extraction
interface ExtractedText {
  id: string;
  name: string;
  characters: string;
  pageName: string;
  parentPath: string;
  parentFrame: string;
  absoluteX: number;
  absoluteY: number;
  width: number;
  height: number;
  x: number;
  y: number;
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: { value: number; unit: string } | null;
  letterSpacing: { value: number; unit: string } | null;
  textAlignHorizontal: string;
  textAlignVertical: string;
  fills: FillInfo[];
  opacity: number;
}

interface FillInfo {
  type: string;
  hex: string;
  rgba: { r: number; g: number; b: number; a: number };
  opacity: number;
  visible: boolean;
  blendMode: string;
  boundVariableId: string | null;
}

interface ExtractedVariable {
  id: string;
  name: string;
  resolvedType: string;
  valuesByMode: { [modeName: string]: VariableValueInfo };
  scopes: string[];
  description: string;
  remote: boolean;
}

interface VariableValueInfo {
  raw: any;
  hex?: string;
  css?: string;
}

interface ExtractedStyle {
  id: string;
  name: string;
  key: string;
  styleType: string;
  description: string;
  paints?: FillInfo[];
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  lineHeight?: { value: number; unit: string } | null;
  remote: boolean;
}

interface ExtractedComponent {
  id: string;
  name: string;
  key: string;
  description: string;
  type: string;
  pageName: string;
  hasVariants: boolean;
  variantProperties: { [k: string]: any } | null;
  width: number;
  height: number;
  childCount: number;
}

interface ExtractedPage {
  id: string;
  name: string;
  nodeCount: number;
  background: any | null;
  topLevelFrames: { id: string; name: string; width: number; height: number; childCount: number }[];
}

interface HierarchyNode {
  id: string;
  name: string;
  type: string;
  childCount: number;
  children: HierarchyNode[];
}

interface FullExtract {
  meta: {
    fileName: string;
    extractDate: string;
    pluginVersion: string;
    totalPages: number;
    extractionScope: string;
    scopeDescription: string;
  };
  pages: ExtractedPage[];
  textNodes: ExtractedText[];
  variables: ExtractedVariable[];
  styles: ExtractedStyle[];
  components: ExtractedComponent[];
  nodeCounts: {
    total: number;
    textNodes: number;
    frames: number;
    components: number;
    instances: number;
    byType: { [t: string]: number };
  };
  hierarchy: HierarchyNode[];
}

interface FullExtractProgress {
  step: number;
  totalSteps: number;
  label: string;
  detail: string;
}

interface ExportResultItem {
  id: string;
  name: string;
  format: string;
  bytes: number[];
}

interface ZipFileEntry {
  name: string;
  data: Uint8Array;
}

interface LottieAnalysis {
  fileName: string;
  valid: boolean;
  errors: string[];
  meta: {
    frameRate: number;
    inPoint: number;
    outPoint: number;
    width: number;
    height: number;
    duration: number;
  };
  stats: {
    layers: number;
    shapes: number;
    paths: number;
    images: number;
    texts: number;
    solids: number;
    nulls: number;
    precomps: number;
  };
  assets: AssetInfo[];
  expressions: string[];
  markers: MarkerInfo[];
  warnings: WarningInfo[];
  layerTree: any[];
  bodymovinSettings: BMCheckResult;
  layerTreeRaw: any[];
  hasKeyframes: boolean;
  hasAssets: boolean;
  totalFrames: number;
}

interface AssetInfo {
  id: string;
  type: string;
  name: string;
  refId?: string;
  width?: number;
  height?: number;
  embedded: boolean;
}

interface MarkerInfo {
  name: string;
  time: number;
  duration: number;
}

interface WarningInfo {
  type: string;
  message: string;
  fix: string;
}

interface BMCheckResult {
  includeAssets: boolean;
  includeKeyframes: boolean;
  includeExpressions: boolean;
  hiddenLayers: boolean;
  compressedJson: boolean;
  settingsOK: boolean;
}

const PLUGIN_VERSION = "19.1.0";
const TE = {
  encode: (s: string) => {
    const r = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) r[i] = s.charCodeAt(i) & 0xff;
    return r;
  },
};

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(files: ZipFileEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const cdirs: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const nb = TE.encode(f.name);
    const crc = crc32(f.data);
    const sz = f.data.length;
    const lh = new Uint8Array(30 + nb.length);
    new DataView(lh.buffer).setUint32(0, 0x04034b50, true);
    lh[6] = 0;
    lh[7] = 0;
    lh[8] = 0;
    lh[9] = 0;
    new DataView(lh.buffer).setUint32(14, crc, true);
    new DataView(lh.buffer).setUint32(18, sz, true);
    new DataView(lh.buffer).setUint32(22, sz, true);
    new DataView(lh.buffer).setUint16(26, nb.length, true);
    lh[28] = 0;
    lh[29] = 0;
    lh.set(nb, 30);
    locals.push(lh, f.data);
    const entryOff = off;
    off += 30 + nb.length + sz;
    const cd = new Uint8Array(46 + nb.length);
    new DataView(cd.buffer).setUint32(0, 0x02014b50, true);
    cd[6] = 0;
    cd[7] = 0;
    cd[8] = 0;
    cd[9] = 0;
    new DataView(cd.buffer).setUint32(16, crc, true);
    new DataView(cd.buffer).setUint32(20, sz, true);
    new DataView(cd.buffer).setUint32(24, sz, true);
    new DataView(cd.buffer).setUint16(28, nb.length, true);
    new DataView(cd.buffer).setUint32(42, entryOff, true);
    cd.set(nb, 46);
    cdirs.push(cd);
  }
  const cdOff = off;
  const cdSz = cdirs.reduce((s, a) => s + a.length, 0);
  const eocd = new Uint8Array(22);
  new DataView(eocd.buffer).setUint32(0, 0x06054b50, true);
  new DataView(eocd.buffer).setUint16(8, files.length, true);
  new DataView(eocd.buffer).setUint16(10, files.length, true);
  new DataView(eocd.buffer).setUint32(12, cdSz, true);
  new DataView(eocd.buffer).setUint32(16, cdOff, true);
  const total = off + cdSz + 22;
  const result = new Uint8Array(total);
  let pos = 0;
  for (const p of locals) {
    result.set(p, pos);
    pos += p.length;
  }
  for (const p of cdirs) {
    result.set(p, pos);
    pos += p.length;
  }
  result.set(eocd, pos);
  return result;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => {
    const x = Math.round(Math.max(0, Math.min(1, v)) * 255);
    return x.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function sanitizeName(n: string): string {
  return n.replace(/[<>:"\/\\|?*\x00-\x1f]/g, "_").replace(/\.+$/, "").trim() || "unnamed";
}

function extractFills(f: any): FillInfo[] {
  if (f === figma.mixed) return [];
  const r: FillInfo[] = [];
  for (const fi of f || []) {
    if (fi.type === "SOLID" && fi.color) {
      const opacity = fi.opacity ?? 1;
      r.push({
        type: "SOLID",
        hex: rgbToHex(fi.color.r, fi.color.g, fi.color.b),
        rgba: { r: fi.color.r, g: fi.color.g, b: fi.color.b, a: opacity },
        opacity,
        visible: fi.visible ?? true,
        blendMode: fi.blendMode ?? "NORMAL",
        boundVariableId: fi.boundVariables?.color?.id || null,
      });
    }
  }
  return r;
}

function parseLineHeight(lh: any): { value: number; unit: string } | null {
  if (!lh || lh === figma.mixed) return null;
  if (typeof lh === "number") return { value: lh, unit: "PIXELS" };
  if (typeof lh === "object") {
    if ("value" in lh && typeof lh.value === "number") return { value: lh.value, unit: lh.unit || "PIXELS" };
    if ("fontSize" in lh && typeof lh.fontSize === "number") return { value: lh.fontSize, unit: "PERCENT" };
  }
  return null;
}

function parseLetterSpacing(ls: any): { value: number; unit: string } | null {
  if (!ls || ls === figma.mixed) return null;
  if (typeof ls === "number") return { value: ls, unit: "PIXELS" };
  if (typeof ls === "object" && "value" in ls && typeof ls.value === "number") return { value: ls.value, unit: ls.unit || "PIXELS" };
  return null;
}

function getNodeContext(node: SceneNode): { pageName: string; parentPath: string; parentFrame: string; absoluteX: number; absoluteY: number } {
  let pageName = "(unknown)";
  let parentFrame = "";
  let parentPath = "";
  let absoluteX = 0;
  let absoluteY = 0;
  try {
    const pathParts: string[] = [];
    let cur: BaseNode | null = (node as any).parent || null;
    while (cur) {
      if (cur.type === "PAGE") {
        pageName = cur.name;
        pathParts.unshift(cur.name);
        break;
      }
      pathParts.unshift(cur.name || "(unnamed)");
      if (!parentFrame && (cur.type === "FRAME" || cur.type === "COMPONENT" || cur.type === "INSTANCE" || cur.type === "GROUP")) {
        parentFrame = cur.name;
      }
      cur = (cur as any).parent || null;
    }
    parentPath = pathParts.join(" > ");

    cur = node;
    while (cur && cur.type !== "PAGE") {
      if ("x" in cur && "y" in cur) {
        absoluteX += (cur as any).x;
        absoluteY += (cur as any).y;
      }
      cur = (cur as any).parent || null;
    }
  } catch (e) {
    // Leave defaults if parent walk fails.
  }
  return {
    pageName,
    parentPath,
    parentFrame,
    absoluteX: Math.round(absoluteX * 100) / 100,
    absoluteY: Math.round(absoluteY * 100) / 100,
  };
}

function extractText(node: TextNode): ExtractedText {
  const ctx = getNodeContext(node);
  const fontName = node.fontName !== figma.mixed && typeof node.fontName === "object" ? node.fontName : null;
  return {
    id: node.id,
    name: node.name,
    characters: node.characters,
    pageName: ctx.pageName,
    parentPath: ctx.parentPath,
    parentFrame: ctx.parentFrame,
    absoluteX: ctx.absoluteX,
    absoluteY: ctx.absoluteY,
    width: Math.round(node.width * 100) / 100,
    height: Math.round(node.height * 100) / 100,
    x: Math.round(node.x * 100) / 100,
    y: Math.round(node.y * 100) / 100,
    fontFamily: fontName?.family ?? "unknown",
    fontStyle: fontName?.style ?? "Regular",
    fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
    fontWeight: typeof (node as any).fontWeight === "number" ? (node as any).fontWeight : 400,
    lineHeight: parseLineHeight(node.lineHeight),
    letterSpacing: parseLetterSpacing(node.letterSpacing),
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    fills: extractFills(node.fills),
    opacity: Math.round(node.opacity * 100) / 100,
  };
}

function buildPlainText(texts: ExtractedText[]): string {
  const l: string[] = [`═══ TEXT — ${figma.root.name || "Untitled"}`, `  ${new Date().toISOString()}`, `═══`, ` `];
  for (const t of texts) {
    const fills = t.fills.map((f) => f.hex).join(", ") || "none";
    l.push(
      `── ${t.name} ──`,
      `  Page: ${t.pageName} | Frame: ${t.parentFrame || "(none)"}`,
      `  Font: ${t.fontFamily} ${t.fontStyle} ${t.fontSize}px`,
      `  Position: ${t.absoluteX}, ${t.absoluteY} | Size: ${t.width}×${t.height}`,
      `  Fills: ${fills}`,
      `  Text: ${t.characters.split("\n").join("↵")}`,
      ` `
    );
  }
  l.push(`── END (${texts.length} texts) ──`);
  return l.join("\n");
}

let zipFiles: ZipFileEntry[] = [];
function addToZip(n: string, c: string | Uint8Array) {
  if (typeof c === "string") zipFiles.push({ name: n, data: TE.encode(c) });
  else zipFiles.push({ name: n, data: c });
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64Encode(u8: Uint8Array): string {
  const out: string[] = [];
  const len = u8.length;
  for (let i = 0; i < len; i += 3) {
    const a = u8[i];
    const hasB = i + 1 < len;
    const hasC = i + 2 < len;
    const b = hasB ? u8[i + 1] : 0;
    const c = hasC ? u8[i + 2] : 0;
    const t = (a << 16) | (b << 8) | c;
    out.push(
      B64_CHARS[(t >> 18) & 63],
      B64_CHARS[(t >> 12) & 63],
      hasB ? B64_CHARS[(t >> 6) & 63] : "=",
      hasC ? B64_CHARS[t & 63] : "="
    );
  }
  return out.join("");
}

function flushZipChunked(fb: string) {
  if (zipFiles.length === 0) return;
  const zip = makeZip(zipFiles);
  zipFiles.length = 0;
  const CH = 300000;
  const t = Math.ceil(zip.length / CH);
  const zn = `${sanitizeName(fb)}_extract.zip`;
  for (let i = 0; i < t; i++) {
    const s = i * CH;
    const e = Math.min(s + CH, zip.length);
    figma.ui.postMessage({ type: "zip-chunk", fileName: zn, index: i, total: t, b64: b64Encode(zip.subarray(s, e)) });
  }
}

// Flush pending zip entries as a numbered part zip. Used to cap in-memory
// SVG/PNG buffers so large exports never hold everything at once.
function flushZipPart(fb: string, part: number) {
  if (zipFiles.length === 0) return;
  flushZipChunked(`${fb}_${part}`);
}

function downloadFile(fn: string, ct: string, m: string) {
  figma.ui.postMessage({ type: "download-file", fileName: fn, content: ct, mimeType: m });
}

async function fetchVars(baseName: string) {
  try {
    const vars: ExtractedVariable[] = [];
    const mm: { [c: string]: { [m: string]: string } } = {};
    const [lv, c] = await Promise.all([
      figma.variables.getLocalVariablesAsync().catch(() => null),
      figma.variables.getLocalVariableCollectionsAsync().catch(() => null),
    ]);
    if (c) {
      for (const col of c || []) {
        mm[col.id] = {};
        for (const m of col.modes) mm[col.id][m.modeId] = m.name;
      }
    }
    if (lv) {
      for (const v of lv || []) {
        const en: { [mn: string]: VariableValueInfo } = {};
        const raw: any = v.valuesByMode || {};
        const ci = (v as any).variableCollectionId || "";
        for (const [mi, val] of Object.entries(raw)) {
          const mn = mm[ci]?.[mi] || mi;
          const info: VariableValueInfo = { raw: val };
          if (v.resolvedType === "COLOR" && val && typeof val === "object" && "r" in val) {
            const cval = val as { r: number; g: number; b: number; a?: number };
            info.hex = rgbToHex(cval.r, cval.g, cval.b);
            info.css = `rgba(${Math.round(cval.r * 255)}, ${Math.round(cval.g * 255)}, ${Math.round(cval.b * 255)}, ${cval.a ?? 1})`;
          }
          en[mn] = info;
        }
        vars.push({
          id: v.id,
          name: v.name,
          resolvedType: v.resolvedType,
          valuesByMode: en,
          scopes: v.scopes || [],
          description: v.description || "",
          remote: (v as any).remote || false,
        });
      }
    }
    addToZip(`${baseName}_variables.json`, JSON.stringify(vars));
  } catch (e) {
    addToZip(`${baseName}_variables.json`, "[]");
  }
}

async function fetchStyles(baseName: string) {
  try {
    const ss: ExtractedStyle[] = [];
    const [ps, ts, es, gs] = await Promise.all([
      figma.getLocalPaintStylesAsync().catch(() => [] as PaintStyle[]),
      figma.getLocalTextStylesAsync().catch(() => [] as TextStyle[]),
      figma.getLocalEffectStylesAsync().catch(() => [] as EffectStyle[]),
      figma.getLocalGridStylesAsync().catch(() => [] as GridStyle[]),
    ]);
    for (const s of ps || []) {
      ss.push({
        id: s.id,
        name: s.name,
        key: s.key,
        styleType: s.type,
        description: s.description || "",
        paints: s.paints && s.paints.length > 0 ? extractFills(s.paints) : undefined,
        remote: (s as any).remote || false,
      });
    }
    for (const s of ts || []) {
      const fontName = (s as any).fontName;
      ss.push({
        id: s.id,
        name: s.name,
        key: s.key,
        styleType: s.type,
        description: s.description || "",
        fontSize: s.fontSize as number,
        fontFamily: fontName?.family,
        fontWeight: fontName?.style,
        lineHeight: parseLineHeight((s as any).lineHeight),
        remote: (s as any).remote || false,
      });
    }
    for (const s of es || []) {
      ss.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", remote: (s as any).remote || false });
    }
    for (const s of gs || []) {
      ss.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", remote: (s as any).remote || false });
    }
    addToZip(`${baseName}_styles.json`, JSON.stringify(ss));
  } catch (e) {
    addToZip(`${baseName}_styles.json`, "[]");
  }
}

async function svgExport(nid: string, pageName: string): Promise<ZipFileEntry | null> {
  try {
    const n = await figma.getNodeByIdAsync(nid);
    if (!n) return null;
    const s = await (n as SceneNode).exportAsync({ format: "SVG_STRING" } as ExportSettingsSVGString);
    if (!s || s.length < 10) return null;
    return { name: `svgs/${sanitizeName(pageName)}/${sanitizeName(n.name)}.svg`, data: TE.encode(s) };
  } catch (e) {
    return null;
  }
}

async function exportNodes(nodeIds: string[], format: "SVG" | "PNG" | "JPG" | "PDF", scale: number): Promise<ExportResultItem[]> {
  const r: ExportResultItem[] = [];
  for (const id of nodeIds) {
    const n = await figma.getNodeByIdAsync(id);
    if (!n) continue;
    try {
      let b: Uint8Array;
      switch (format) {
        case "SVG":
          b = await (n as SceneNode).exportAsync({ format: "SVG" } as ExportSettingsSVG);
          break;
        case "PNG":
          b = await (n as SceneNode).exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } } as ExportSettingsImage);
          break;
        case "JPG":
          b = await (n as SceneNode).exportAsync({ format: "JPG", constraint: { type: "SCALE", value: scale } } as ExportSettingsImage);
          break;
        case "PDF":
          b = await (n as SceneNode).exportAsync({ format: "PDF" } as ExportSettingsPDF);
          break;
        default:
          continue;
      }
      r.push({ id: n.id, name: sanitizeName(n.name), format: format.toLowerCase(), bytes: Array.from(b) });
    } catch (e) {
      // Per-node failure should not stop batch.
    }
  }
  return r;
}

function analyzeLottieFile(fileName: string, content: string): LottieAnalysis {
  const a: LottieAnalysis = {
    fileName,
    valid: false,
    errors: [],
    meta: { frameRate: 0, inPoint: 0, outPoint: 0, width: 0, height: 0, duration: 0 },
    stats: { layers: 0, shapes: 0, paths: 0, images: 0, texts: 0, solids: 0, nulls: 0, precomps: 0 },
    assets: [],
    expressions: [],
    markers: [],
    warnings: [],
    layerTree: [],
    layerTreeRaw: [],
    bodymovinSettings: { includeAssets: false, includeKeyframes: false, includeExpressions: false, hiddenLayers: false, compressedJson: true, settingsOK: false },
    hasKeyframes: false,
    hasAssets: false,
    totalFrames: 0,
  };

  let json: any;
  try {
    json = JSON.parse(content);
    a.valid = true;
  } catch (e) {
    a.errors.push("Invalid JSON");
    return a;
  }
  if (!json || typeof json !== "object") {
    a.errors.push("Empty file");
    return a;
  }

  a.meta.frameRate = typeof json.fr === "number" ? json.fr : 0;
  a.meta.inPoint = typeof json.ip === "number" ? json.ip : 0;
  a.meta.outPoint = typeof json.op === "number" ? json.op : 0;
  a.meta.width = typeof json.w === "number" ? json.w : 0;
  a.meta.height = typeof json.h === "number" ? json.h : 0;
  a.totalFrames = a.meta.outPoint - a.meta.inPoint;
  a.meta.duration = a.meta.frameRate > 0 ? a.totalFrames / a.meta.frameRate : 0;

  if (a.meta.frameRate <= 0) a.warnings.push({ type: "metadata", message: "Frame rate missing or invalid", fix: "Re-export with Bodymovin using a valid composition frame rate." });
  if (a.meta.width <= 0 || a.meta.height <= 0) a.warnings.push({ type: "metadata", message: "Animation dimensions missing", fix: "Verify the Bodymovin export includes width and height." });

  // Assets
  const assets = Array.isArray(json.assets) ? json.assets : [];
  a.hasAssets = assets.length > 0;
  for (const asset of assets) {
    if (!asset || typeof asset !== "object") continue;
    const type = asset.layers ? "precomp" : asset.p ? "image" : "data";
    if (type === "precomp") a.stats.precomps++;
    if (type === "image") a.stats.images++;
    a.assets.push({
      id: String(asset.id ?? ""),
      type,
      name: String(asset.nm ?? asset.id ?? ""),
      refId: asset.refId,
      width: asset.w,
      height: asset.h,
      embedded: type === "image" ? !asset.u && !asset.p : true,
    });
  }

  // Markers
  if (Array.isArray(json.markers)) {
    for (const m of json.markers) {
      if (m && typeof m === "object") {
        a.markers.push({ name: String(m.cm ?? ""), time: (m.tm ?? 0) / (a.meta.frameRate || 1), duration: (m.dr ?? 0) / (a.meta.frameRate || 1) });
      }
    }
  }

  // Layers
  const layers = Array.isArray(json.layers) ? json.layers : [];
  a.stats.layers = layers.length;
  a.layerTreeRaw = layers;

  const ICONS: { [k: number]: string } = { 0: "precomp", 1: "solid", 2: "image", 3: "null", 4: "shape", 5: "text" };

  function inspectLayer(layer: any, depth: number, parentList: any[]) {
    if (!layer || typeof layer !== "object") return;
    const ty = layer.ty;
    const hidden = layer.hd === true;
    const node = {
      type: ICONS[ty] || "unknown",
      name: String(layer.nm ?? "(unnamed)"),
      hidden,
      children: [] as any[],
    };
    parentList.push(node);

    if (hidden) a.bodymovinSettings.hiddenLayers = true;

    switch (ty) {
      case 0:
        a.stats.precomps++;
        break;
      case 1:
        a.stats.solids++;
        break;
      case 2:
        a.stats.images++;
        break;
      case 3:
        a.stats.nulls++;
        break;
      case 4:
        a.stats.shapes++;
        break;
      case 5:
        a.stats.texts++;
        break;
    }

    // Inspect shapes inside shape layers
    if (ty === 4 && Array.isArray(layer.shapes)) {
      for (const shape of layer.shapes) inspectShape(shape);
    }

    // Look for expressions and keyframes in transforms and common props
    scanProperties(layer.ks);
    if (layer.ao) scanProperties(layer.ao);
    if (Array.isArray(layer.ef)) {
      for (const eff of layer.ef) scanProperties(eff);
    }
  }

  function inspectShape(shape: any) {
    if (!shape || typeof shape !== "object") return;
    const ty = shape.ty;
    if (ty === "gr" && Array.isArray(shape.it)) {
      for (const child of shape.it) inspectShape(child);
    } else if (ty === "sh") {
      a.stats.paths++;
    } else if (ty === "rc" || ty === "el" || ty === "sr") {
      a.stats.shapes++;
    }
    scanProperties(shape);
  }

  function scanProperties(obj: any) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const item of obj) scanProperties(item);
      return;
    }
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (key === "x" && typeof val === "string" && val.length > 0) {
        a.expressions.push(val);
      }
      if (key === "k" && Array.isArray(val) && val.length > 1) {
        a.hasKeyframes = true;
        a.bodymovinSettings.includeKeyframes = true;
      }
      if (typeof val === "object" && val !== null) {
        scanProperties(val);
      }
    }
  }

  for (const layer of layers) {
    inspectLayer(layer, 0, a.layerTree);
  }

  // Bodymovin settings checks
  a.bodymovinSettings.includeAssets = a.hasAssets;
  a.bodymovinSettings.includeKeyframes = a.hasKeyframes;
  a.bodymovinSettings.includeExpressions = a.expressions.length > 0;
  a.bodymovinSettings.compressedJson = false;
  a.bodymovinSettings.settingsOK = a.meta.frameRate > 0 && a.meta.width > 0 && a.meta.height > 0;

  if (a.stats.images > 0 && !a.assets.some((x) => x.type === "image" && x.embedded)) {
    a.warnings.push({ type: "assets", message: "External image assets are referenced but not embedded", fix: "In Bodymovin, enable 'Assets > Include in json' or supply assets separately." });
  }
  if (a.expressions.length > 0) {
    a.warnings.push({ type: "expressions", message: "Expressions are used; not all players support them", fix: "Test on your target Lottie player or bake expressions to keyframes." });
  }
  if (a.bodymovinSettings.hiddenLayers) {
    a.warnings.push({ type: "layers", message: "Hidden layers are included", fix: "Enable 'Hidden' export in Bodymovin only if needed, or clean hidden layers." });
  }
  if (a.stats.texts > 0) {
    a.warnings.push({ type: "text", message: "Text layers detected", fix: "Convert text to shapes or ensure fonts are available on the target platform." });
  }

  return a;
}

// ═══════════════ MAIN PLUGIN ═══════════════
figma.showUI(__html__, { width: 520, height: 700, title: "Extract All" });
let cancelRequested = false;
function postSel() {
  figma.ui.postMessage({ type: "selection-state", count: figma.currentPage.selection.length, pageName: figma.currentPage.name });
}
figma.on("selectionchange", postSel);
figma.on("currentpagechange", postSel);
postSel();
let lastAnalysis: LottieAnalysis | null = null;
let runningExtract = false;

figma.ui.onmessage = async (msg: any) => {
  // v19 features (rubric check, build, Claude bridge) have their own handler in
  // features.ts. Skip them here: the two lines below would otherwise wipe the
  // ZIP buffer and undo a cancel whenever a bridge message arrives mid-export.
  if (isFeatureMessage(msg)) return;
  cancelRequested = false;
  zipFiles.length = 0;
  const baseName = sanitizeName(figma.root.name || "Untitled");

  if (msg.type === "import-lottie-json") {
    lastAnalysis = analyzeLottieFile(msg.fileName || "lottie.json", String(msg.content || ""));
    figma.ui.postMessage({ type: "lottie-analysis", analysis: lastAnalysis, rawJson: String(msg.content || "") });
    return;
  }

  if (msg.type === "lottie-gif-rendered") {
    try {
      const bytes = new Uint8Array(msg.bytes);
      const image = figma.createImage(bytes);
      const rect = figma.createRectangle();
      rect.resize(msg.width, msg.height);
      rect.name = msg.fileName ? sanitizeName(msg.fileName.replace(/\.json$/, "")) + " (Lottie GIF)" : "Lottie Animation";
      rect.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
      const center = figma.viewport.center;
      rect.x = Math.round(center.x - msg.width / 2);
      rect.y = Math.round(center.y - msg.height / 2);
      figma.currentPage.appendChild(rect);
      figma.viewport.scrollAndZoomIntoView([rect]);
      figma.ui.postMessage({ type: "animation-placed", name: rect.name, x: rect.x, y: rect.y });
    } catch (e) {
      figma.ui.postMessage({ type: "error", message: "Failed to place GIF: " + (e as Error).message });
    }
    return;
  }

  if (msg.type === "cancel") {
    cancelRequested = true;
    runningExtract = false;
    zipFiles.length = 0;
    return;
  }

  if (msg.type === "resize") {
    figma.ui.resize(msg.width, msg.height);
    return;
  }

  if (msg.type === "close") {
    figma.closePlugin();
    return;
  }

      if (msg.type === "get-full-extract") {
        if (runningExtract) {
          figma.ui.postMessage({ type: "error", message: "Already extracting" });
          return;
        }
        runningExtract = true;

        let watchdog: ReturnType<typeof setTimeout> | null = null;
        const armWatchdog = () => {
          if (watchdog) clearTimeout(watchdog);
          watchdog = setTimeout(() => {
            if (runningExtract) {
              figma.ui.postMessage({ type: "error", message: "Extraction timed out. Please try again or reduce scope." });
              runningExtract = false;
            }
          }, 120000);
        };
        armWatchdog();

        try {
          await figma.loadAllPagesAsync();
        } catch (e) {
          figma.ui.postMessage({ type: "error", message: "Page load failed: " + (e as Error).message });
          runningExtract = false;
          if (watchdog) clearTimeout(watchdog);
          return;
        }

    const sel = figma.currentPage.selection;
    const isScoped = sel.length > 0;
    const pgName = figma.currentPage.name;
    const aeOpts = msg.aeOpts;
    const aiOpts = msg.aiOpts;
    const opts = aeOpts || aiOpts;

    figma.ui.postMessage({ type: "full-extract-progress", progress: { step: 0, totalSteps: 3, label: "Scan", detail: "Collecting nodes…" } });

    let workingNodes: SceneNode[];
    if (isScoped) {
      workingNodes = [];
      function walk(n: any, r: SceneNode[]) {
        if (n.type !== "PAGE") r.push(n as SceneNode);
        if (n.children) for (const c of n.children) walk(c, r);
      }
      for (const s of sel) walk(s, workingNodes);
    } else {
      workingNodes = (figma.currentPage as any).findAll(() => true) as SceneNode[];
    }

    if (cancelRequested) {
      workingNodes.length = 0;
      runningExtract = false;
      return;
    }

    const total = workingNodes.length;
    const texts: ExtractedText[] = [];
    const comps: ExtractedComponent[] = [];
    const byType: { [t: string]: number } = {};
    let cursor = 0;
    const BATCH = 200;

        function processBatch() {
          armWatchdog();
          if (cancelRequested || cursor >= total) {
            return finishExtract();
          }
      const end = Math.min(cursor + BATCH, total);
      for (let i = cursor; i < end; i++) {
        const n = workingNodes[i];
        const t = n.type;
        byType[t] = (byType[t] || 0) + 1;
        if (t === "TEXT") {
          try {
            texts.push(extractText(n as TextNode));
          } catch (e) {
            // Ignore individual text extraction failures.
          }
        } else if (t === "COMPONENT" || t === "COMPONENT_SET") {
          try {
            let vp: any = null;
            if (t === "COMPONENT_SET") {
              const rp = (n as any).variantGroupProperties || (n as any).variantProperties;
              if (rp) {
                vp = {};
                for (const k of Object.keys(rp)) vp[k] = rp[k];
              }
            }
            comps.push({
              id: n.id,
              name: n.name,
              key: (n as ComponentNode).key || "",
              description: (n as ComponentNode).description || "",
              type: t,
              pageName: isScoped ? getNodeContext(n).pageName : pgName,
              hasVariants: t === "COMPONENT_SET",
              variantProperties: vp,
              width: Math.round((n as any).width * 100) / 100,
              height: Math.round((n as any).height * 100) / 100,
              childCount: (n as any).children ? (n as any).children.length : 0,
            });
          } catch (e) {
            // Ignore individual component extraction failures.
          }
        }
      }
      cursor = end;
      figma.ui.postMessage({
        type: "full-extract-progress",
        progress: { step: 1, totalSteps: 3, label: "Extract", detail: `${cursor}/${total} (${texts.length} texts)` },
      });
      setTimeout(processBatch, 0);
    }

    function finishExtract() {
      figma.ui.postMessage({ type: "full-extract-progress", progress: { step: 2, totalSteps: 3, label: "Build", detail: "Assembling…" } });

      const pages: ExtractedPage[] = [];
      for (const pg of figma.root.children) {
        const pgd = pg as any;
        const topFrames = (pgd.children || []).map((c: any) => ({
          id: c.id,
          name: c.name || "",
          width: Math.round(c.width * 100) / 100,
          height: Math.round(c.height * 100) / 100,
          childCount: c.children ? c.children.length : 0,
        }));
        pages.push({
          id: pg.id,
          name: pgd.name || "",
          nodeCount: 0,
          background: pgd.backgrounds && pgd.backgrounds.length > 0 ? JSON.parse(JSON.stringify(pgd.backgrounds[0])) : null,
          topLevelFrames: topFrames,
        });
      }

      const data: FullExtract = {
        meta: {
          fileName: figma.root.name || "Untitled",
          extractDate: new Date().toISOString(),
          pluginVersion: PLUGIN_VERSION,
          totalPages: figma.root.children.length,
          extractionScope: isScoped ? "selection" : "page",
          scopeDescription: isScoped ? `${sel.length} items` : "entire page",
        },
        pages,
        textNodes: texts,
        variables: [],
        styles: [],
        components: comps,
        nodeCounts: {
          total,
          textNodes: texts.length,
          frames: byType["FRAME"] || 0,
          components: byType["COMPONENT"] || 0,
          instances: byType["INSTANCE"] || 0,
          byType,
        },
        hierarchy: [],
      };

      const tc = buildPlainText(texts);
      if (tc.length < 65000) downloadFile(`${baseName}_text.txt`, tc, "text/plain");
      else addToZip(`${baseName}_text.txt`, tc);
      addToZip(`${baseName}_full-extract.json`, JSON.stringify(data));
      flushZipChunked(baseName);

      // Collect SVG targets before releasing the heavy node array.
      let svgTargets: { id: string; pageName: string }[] = [];
      if (opts && opts.includeSVGs && !cancelRequested) {
        svgTargets = workingNodes
          .filter((n) => n.type !== "TEXT" && (n as any).visible !== false)
          .map((n) => ({ id: n.id, pageName: pgName }));
      }

      // Release Figma node references to avoid object leaks / runtime aborts.
      workingNodes.length = 0;

      figma.ui.postMessage({
        type: "full-extract",
        data: {
          textNodes: texts.length,
          variables: 0,
          styles: 0,
          components: comps.length,
          totalNodes: total,
          scope: isScoped ? `${sel.length} items` : "entire page",
        },
      });

          if (opts && !cancelRequested) {
            setTimeout(() => {
              (async () => {
                armWatchdog();
                try {
              const shouldFetchVars = aiOpts ? aiOpts.includeVars : true;
              const shouldFetchStyles = aiOpts ? aiOpts.includeStyles : true;

              if (shouldFetchVars) await fetchVars(baseName);
              if (shouldFetchStyles) await fetchStyles(baseName);

              if (opts.includeSVGs && svgTargets.length > 0 && !cancelRequested) {
                figma.ui.postMessage({ type: "progress", current: 0, total: svgTargets.length, label: "SVG Export" });
                let extrasPart = 0;
                for (let i = 0; i < svgTargets.length && !cancelRequested; i += 4) {
                  try {
                    const br = await Promise.all(svgTargets.slice(i, i + 4).map((n) => svgExport(n.id, n.pageName)));
                    for (const r of br) if (r) zipFiles.push(r);
                  } catch (e) {
                    // Batch failure should not stop remaining SVGs.
                  }
                  figma.ui.postMessage({ type: "progress", current: Math.min(i + 4, svgTargets.length), total: svgTargets.length, label: "SVG Export" });
                  // Flush every ~25 files so the in-memory buffer stays small.
                  if (zipFiles.length >= 25) {
                    extrasPart++;
                    flushZipPart(baseName + "_extras", extrasPart);
                  }
                }
                if (zipFiles.length > 0) {
                  extrasPart++;
                  flushZipPart(baseName + "_extras", extrasPart);
                }
              }

              if (aeOpts && aeOpts.includeLottie && !cancelRequested) {
                try {
                  addToZip(
                    `${baseName}_lottie.json`,
                    JSON.stringify({
                      note: "Lottie bundle placeholder. Use SVGs in svgs/ and positions in the full-extract.json for After Effects composition.",
                      source: figma.root.name || "Untitled",
                      exportedAt: new Date().toISOString(),
                      pluginVersion: PLUGIN_VERSION,
                    })
                  );
                } catch (e) {
                  // Ignore lottie bundle failure.
                }
              }

              if (zipFiles.length > 0) flushZipChunked(baseName + "_extras");
              figma.ui.postMessage({ type: "extras-complete", scope: isScoped ? `${sel.length} items` : "entire page" });
              } catch (e) {
                figma.ui.postMessage({ type: "error", message: "Extras failed: " + (e as Error).message });
              } finally {
                runningExtract = false;
                if (watchdog) clearTimeout(watchdog);
              }
            })();
          }, 100);
        } else {
          runningExtract = false;
          if (watchdog) clearTimeout(watchdog);
          figma.ui.postMessage({ type: "extras-complete", scope: isScoped ? `${sel.length} items` : "entire page" });
        }
      }

    setTimeout(processBatch, 10);
    return;
  }

  if (msg.type === "get-text") {
    await figma.loadAllPagesAsync();
    const nodes = (figma.currentPage as any).findAll(() => true) as SceneNode[];
    const tn: ExtractedText[] = [];
    for (const n of nodes) {
      if (n.type === "TEXT") {
        try {
          tn.push(extractText(n as TextNode));
        } catch (e) {}
      }
    }
    nodes.length = 0;
    const txt = buildPlainText(tn);
    if (txt.length < 65000) downloadFile(`${baseName}_text.txt`, txt, "text/plain");
    else addToZip(`${baseName}_text.txt`, txt);
    addToZip(`${baseName}_text.json`, JSON.stringify(tn));
    flushZipChunked(baseName + "_text");
    return;
  }

  if (msg.type === "get-components") {
    await figma.loadAllPagesAsync();
    const nodes = (figma.currentPage as any).findAll(() => true) as SceneNode[];
    const cc: ExtractedComponent[] = [];
    for (const n of nodes) {
      if (n.type === "COMPONENT" || n.type === "COMPONENT_SET") {
        try {
          let vp: any = null;
          if (n.type === "COMPONENT_SET") {
            const rp = (n as any).variantGroupProperties || (n as any).variantProperties;
            if (rp) {
              vp = {};
              for (const k of Object.keys(rp)) vp[k] = rp[k];
            }
          }
          cc.push({
            id: n.id,
            name: n.name,
            key: (n as ComponentNode).key || "",
            description: (n as ComponentNode).description || "",
            type: n.type,
            pageName: getNodeContext(n).pageName,
            hasVariants: n.type === "COMPONENT_SET",
            variantProperties: vp,
            width: Math.round((n as any).width * 100) / 100,
            height: Math.round((n as any).height * 100) / 100,
            childCount: (n as any).children ? (n as any).children.length : 0,
          });
        } catch (e) {}
      }
    }
    nodes.length = 0;
    addToZip(`${baseName}_components.json`, JSON.stringify(cc));
    flushZipChunked(baseName + "_components");
    return;
  }

  if (msg.type === "get-variables") {
    await fetchVars(baseName);
    flushZipChunked(baseName + "_variables");
    return;
  }

  if (msg.type === "get-styles") {
    await fetchStyles(baseName);
    flushZipChunked(baseName + "_styles");
    return;
  }

  if (msg.type === "get-pages") {
    await figma.loadAllPagesAsync();
    const pp: ExtractedPage[] = [];
    for (const pg of figma.root.children) {
      const pgd = pg as any;
      pp.push({
        id: pg.id,
        name: pgd.name || "",
        nodeCount: 0,
        background: pgd.backgrounds && pgd.backgrounds.length > 0 ? JSON.parse(JSON.stringify(pgd.backgrounds[0])) : null,
        topLevelFrames: (pgd.children || []).map((c: any) => ({
          id: c.id,
          name: c.name || "",
          width: Math.round(c.width * 100) / 100,
          height: Math.round(c.height * 100) / 100,
          childCount: c.children ? c.children.length : 0,
        })),
      });
    }
    addToZip(`${baseName}_pages.json`, JSON.stringify(pp));
    flushZipChunked(baseName + "_pages");
    return;
  }

  if (msg.type === "export-selected-svg" || msg.type === "export-selected-png" || msg.type === "export-selected-jpg") {
    const sel = figma.currentPage.selection;
    if (sel.length === 0) {
      figma.ui.postMessage({ type: "error", message: "No nodes selected" });
      return;
    }
    const fmt = msg.type === "export-selected-svg" ? "SVG" : msg.type === "export-selected-png" ? "PNG" : "JPG";
    const sc = fmt === "SVG" ? msg.scale || 1 : msg.scale || 2;
    const results = await exportNodes(sel.map((n: SceneNode) => n.id), fmt, sc);
    if (results.length <= 3) {
      if (results.length > 0) figma.ui.postMessage({ type: "export-results", results });
    } else {
      for (const x of results) addToZip(`${x.name}.${x.format.toLowerCase()}`, new Uint8Array(x.bytes));
      flushZipChunked(baseName + "_selected");
    }
    return;
  }

  if (msg.type === "get-svg-as-text") {
    const sel = figma.currentPage.selection;
    if (sel.length === 0) {
      figma.ui.postMessage({ type: "error", message: "No nodes selected" });
      return;
    }
    for (const node of sel) {
      try {
        const s = await (node as SceneNode).exportAsync({ format: "SVG_STRING" } as ExportSettingsSVGString);
        if (s) downloadFile(`${sanitizeName(node.name)}.svg`, s, "image/svg+xml");
      } catch (e) {
        // Ignore per-node SVG failures.
      }
    }
    return;
  }

  if (msg.type === "export-lottie-json") {
    downloadFile(`${baseName}_lottie.json`, "[]", "application/json");
    return;
  }

  if (msg.type === "export-all-svg-page" || msg.type === "export-all-png-page" || msg.type === "export-all-svg-all-pages" || msg.type === "export-all-png-all-pages") {
    await figma.loadAllPagesAsync();
    const fmt = msg.type.includes("svg") ? "SVG" : "PNG";
    const sc = fmt === "SVG" ? msg.scale || 1 : msg.scale || 2;
    const pages = msg.type.includes("all-pages") ? [...figma.root.children] : [figma.currentPage];
    let tN = 0;
    for (const pg of pages) {
      const ns = (pg as any).findAll(() => true).filter((n: any) => n.visible !== false && n.type !== "PAGE");
      tN += ns.length;
    }
    let pN = 0;
    let batchPart = 0;
    for (const pg of pages) {
      const ns = (pg as any).findAll(() => true).filter((n: any) => n.visible !== false && n.type !== "PAGE");
      for (let i = 0; i < ns.length; i += 20) {
        if (cancelRequested) break;
        const r = await exportNodes(
          ns.slice(i, i + 20).map((n: any) => n.id),
          fmt,
          sc
        );
        for (const x of r) {
          const fname = pages.length > 1 ? `${sanitizeName((pg as any).name || "")}/${x.name}.${x.format.toLowerCase()}` : `${x.name}.${x.format.toLowerCase()}`;
          zipFiles.push({ name: fname, data: new Uint8Array(x.bytes) });
        }
        pN += Math.min(20, ns.length - i);
        figma.ui.postMessage({ type: "progress", current: pN, total: tN, label: fmt });
        if (zipFiles.length >= 25) {
          batchPart++;
          flushZipPart(baseName + "_batch", batchPart);
        }
      }
    }
    if (!cancelRequested) {
      if (zipFiles.length > 0) {
        batchPart++;
        flushZipPart(baseName + "_batch", batchPart);
      }
      figma.ui.postMessage({ type: "export-complete" });
    }
    return;
  }
};
