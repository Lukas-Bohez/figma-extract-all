// ──────────────────────────────────────────────
// Figma Extract All — v2.0 Complete Rewrite
// Rich extraction: SVGs embedded, hex colors,
// absolute positions, parent hierarchy,
// named modes, instant progress, AI-ready
// ──────────────────────────────────────────────

// ── Types ──────────────────────────────────────

interface ExtractedText {
  id: string;
  name: string;
  characters: string;
  pageName: string;
  parentPath: string;           // "Page > Frame > Group"
  parentFrame: string;           // closest ancestor frame name
  absoluteX: number;             // page-relative position
  absoluteY: number;
  width: number;
  height: number;
  x: number;                     // relative to parent
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
  textAutoResize: string;
  textTruncation: string;
  maxLines: number | null;
}

interface FillInfo {
  type: string;
  hex: string;                   // #rrggbb or rgba()
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
  hex?: string;                  // for COLOR variables
  css?: string;                  // CSS representation
}

interface ExtractedStyle {
  id: string;
  name: string;
  key: string;
  styleType: string;
  description: string;
  // Rich style data
  paints?: FillInfo[];
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
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
  variantProperties: { [key: string]: any } | null;
  // Component metadata
  width: number;
  height: number;
  childCount: number;
  svg?: string;                  // embedded SVG
}

interface ExtractedPage {
  id: string;
  name: string;
  nodeCount: number;
  background: any | null;
  topLevelFrames: { id: string; name: string; width: number; height: number; childCount: number }[];
}

interface EmbeddedSVG {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  pageName: string;
  parentPath: string;
  width: number;
  height: number;
  svg: string;
}

interface FullExtract {
  meta: {
    fileName: string;
    extractDate: string;
    pluginVersion: string;
    totalPages: number;
    extractionScope: string;      // "current page" or "all pages"
  };
  pages: ExtractedPage[];
  textNodes: ExtractedText[];
  variables: ExtractedVariable[];
  styles: ExtractedStyle[];
  components: ExtractedComponent[];
  svgs: EmbeddedSVG[];           // ALL embedded SVGs!
  nodeCounts: {
    total: number;
    textNodes: number;
    frames: number;
    components: number;
    instances: number;
    svgsIncluded: number;
    byType: { [type: string]: number };
  };
  hierarchy: HierarchyNode[];
}

interface HierarchyNode {
  id: string;
  name: string;
  type: string;
  childCount: number;
  children: HierarchyNode[];
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

// ── Constants ──────────────────────────────────

const EXPORTABLE_TYPES = [
  "BOOLEAN_OPERATION", "COMPONENT", "COMPONENT_SET",
  "ELLIPSE", "FRAME", "GROUP", "INSTANCE", "LINE",
  "POLYGON", "RECTANGLE", "SECTION", "STAR", "TEXT", "VECTOR",
];

const PLUGIN_VERSION = "2.0.0";

// ── Helpers ────────────────────────────────────

function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.+$/, "").trim() || "unnamed";
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const h = Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16);
    return h.length === 1 ? "0" + h : h;
  };
  return "#" + toHex(r) + toHex(g) + toHex(b);
}

function rgbaToCSS(r: number, g: number, b: number, a: number): string {
  const ri = Math.round(r * 255);
  const gi = Math.round(g * 255);
  const bi = Math.round(b * 255);
  if (a >= 1) return `rgb(${ri}, ${gi}, ${bi})`;
  return `rgba(${ri}, ${gi}, ${bi}, ${Math.round(a * 100) / 100})`;
}

function getPageName(node: BaseNode): string {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === "PAGE") return current.name;
    current = current.parent;
  }
  return "(no page)";
}

function getParentPath(node: BaseNode): string {
  const parts: string[] = [];
  let current: BaseNode | null = (node as any).parent || null;
  while (current) {
    if (current.type === "PAGE") {
      parts.unshift(current.name);
      break;
    }
    // Only include frames and groups for clarity
    if (current.type === "FRAME" || current.type === "GROUP" ||
        current.type === "COMPONENT" || current.type === "COMPONENT_SET" ||
        current.type === "SECTION") {
      parts.unshift(current.name);
    }
    current = (current as any).parent || null;
  }
  return parts.join(" > ") || "(root)";
}

function getParentFrame(node: BaseNode): string {
  let current: BaseNode | null = (node as any).parent || null;
  while (current) {
    if (current.type === "FRAME" || current.type === "COMPONENT" ||
        current.type === "COMPONENT_SET" || current.type === "SECTION") {
      return current.name;
    }
    current = (current as any).parent || null;
  }
  return "(no frame)";
}

function getAbsolutePosition(node: SceneNode): { x: number; y: number } {
  let absX = 0;
  let absY = 0;
  let current: BaseNode | null = node;
  while (current && current.type !== "PAGE") {
    if ("x" in current && "y" in current) {
      absX += (current as any).x;
      absY += (current as any).y;
    }
    current = (current as any).parent || null;
  }
  return { x: absX, y: absY };
}

function flattenNodeTree(root: PageNode | SceneNode, predicate?: (n: SceneNode) => boolean): SceneNode[] {
  const results: SceneNode[] = [];
  function walk(node: BaseNode) {
    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) {
        const sceneNode = child as SceneNode;
        if (!predicate || predicate(sceneNode)) {
          results.push(sceneNode);
        }
        walk(sceneNode);
      }
    }
  }
  walk(root);
  return results;
}

function buildHierarchy(root: PageNode | SceneNode): HierarchyNode[] {
  const nodes: HierarchyNode[] = [];
  if ("children" in root) {
    for (const child of (root as ChildrenMixin).children) {
      const sceneChild = child as SceneNode;
      const node: HierarchyNode = {
        id: sceneChild.id,
        name: sceneChild.name,
        type: sceneChild.type,
        childCount: "children" in sceneChild ? (sceneChild as any).children.length : 0,
        children: [],
      };
      if ("children" in sceneChild) {
        node.children = buildHierarchy(sceneChild);
      }
      nodes.push(node);
    }
  }
  return nodes;
}

function isExportable(node: SceneNode): boolean {
  return node.visible !== false && EXPORTABLE_TYPES.indexOf(node.type) >= 0;
}

// ── Rich Fill Extraction ───────────────────────

function extractFills(fills: ReadonlyArray<Paint> | typeof figma.mixed): FillInfo[] {
  if (fills === figma.mixed) return [];
  const result: FillInfo[] = [];
  for (const f of fills) {
    if (f.type === "SOLID" && f.color) {
      result.push({
        type: "SOLID",
        hex: rgbToHex(f.color.r, f.color.g, f.color.b),
        rgba: { r: f.color.r, g: f.color.g, b: f.color.b, a: f.opacity ?? 1 },
        opacity: f.opacity ?? 1,
        visible: f.visible ?? true,
        blendMode: f.blendMode ?? "NORMAL",
        boundVariableId: (f as any).boundVariables?.color?.id || null,
      });
    } else if (f.type === "GRADIENT_LINEAR" || f.type === "GRADIENT_RADIAL" || f.type === "GRADIENT_ANGULAR" || f.type === "GRADIENT_DIAMOND") {
      const stops = (f as GradientPaint).gradientStops?.map((s: any) => ({
        position: s.position,
        hex: rgbToHex(s.color.r, s.color.g, s.color.b),
        rgba: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
      })) || [];
      result.push({
        type: f.type,
        hex: stops.length > 0 ? stops[0].hex : "#000000",
        rgba: stops.length > 0 ? stops[0].rgba : { r: 0, g: 0, b: 0, a: 1 },
        opacity: f.opacity ?? 1,
        visible: f.visible ?? true,
        blendMode: f.blendMode ?? "NORMAL",
        boundVariableId: null,
      });
    } else {
      result.push({
        type: f.type,
        hex: "#000000",
        rgba: { r: 0, g: 0, b: 0, a: 1 },
        opacity: f.opacity ?? 1,
        visible: f.visible ?? true,
        blendMode: f.blendMode ?? "NORMAL",
        boundVariableId: null,
      });
    }
  }
  return result;
}

// ── Rich Text Extraction ───────────────────────

function extractTextData(node: TextNode): ExtractedText {
  let lineHeight: { value: number; unit: string } | null = null;
  const lh = node.lineHeight;
  if (lh !== figma.mixed && typeof lh === "object" && "value" in lh && "unit" in lh) {
    lineHeight = { value: (lh as any).value, unit: (lh as any).unit };
  }

  let letterSpacing: { value: number; unit: string } | null = null;
  const ls = node.letterSpacing;
  if (ls !== figma.mixed && typeof ls === "object" && "value" in ls && "unit" in ls) {
    letterSpacing = { value: (ls as any).value, unit: (ls as any).unit };
  }

  const absPos = getAbsolutePosition(node);

  return {
    id: node.id,
    name: node.name,
    characters: node.characters,
    pageName: getPageName(node),
    parentPath: getParentPath(node),
    parentFrame: getParentFrame(node),
    absoluteX: Math.round(absPos.x * 100) / 100,
    absoluteY: Math.round(absPos.y * 100) / 100,
    width: Math.round(node.width * 100) / 100,
    height: Math.round(node.height * 100) / 100,
    x: Math.round(node.x * 100) / 100,
    y: Math.round(node.y * 100) / 100,
    fontFamily: typeof node.fontName === "object" && "family" in node.fontName ? node.fontName.family : "unknown",
    fontStyle: typeof node.fontName === "object" && "style" in node.fontName ? node.fontName.style : "Regular",
    fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
    fontWeight: typeof (node as any).fontWeight === "number" ? (node as any).fontWeight : 400,
    lineHeight,
    letterSpacing,
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    fills: extractFills(node.fills),
    opacity: Math.round(node.opacity * 100) / 100,
    textAutoResize: node.textAutoResize,
    textTruncation: (node as any).textTruncation || "DISABLED",
    maxLines: (node as any).maxLines || null,
  };
}

// ── Variable Extraction (with hex + named modes) ─

async function extractAllVariables(): Promise<ExtractedVariable[]> {
  const vars: ExtractedVariable[] = [];
  try {
    const localVars = await figma.variables.getLocalVariablesAsync();
    // Build mode map
    const modeMap: { [collectionId: string]: { [modeId: string]: string } } = {};
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    for (const col of collections) {
      modeMap[col.id] = {};
      for (const mode of col.modes) {
        modeMap[col.id][mode.modeId] = mode.name;
      }
    }

    for (const v of localVars) {
      const enriched: { [modeName: string]: VariableValueInfo } = {};
      const rawValues: any = v.valuesByMode || {};
      const varCollectionId = (v as any).variableCollectionId || "";

      for (const [modeId, value] of Object.entries(rawValues)) {
        const modeName = modeMap[varCollectionId]?.[modeId] || modeId;
        if (value && typeof value === "object" && "r" in value) {
          // It's a color
          enriched[modeName] = {
            raw: value,
            hex: rgbToHex((value as any).r, (value as any).g, (value as any).b),
            css: rgbaToCSS((value as any).r, (value as any).g, (value as any).b, (value as any).a || 1),
          };
        } else {
          enriched[modeName] = { raw: value };
        }
      }

      vars.push({
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType,
        valuesByMode: enriched,
        scopes: v.scopes || [],
        description: v.description || "",
        remote: (v as any).remote || false,
      });
    }
  } catch (_) {
    // variables API may not be available
  }
  return vars;
}

// ── Style Extraction (with rich data) ──────────

async function extractAllStyles(): Promise<ExtractedStyle[]> {
  const styles: ExtractedStyle[] = [];
  try {
    const paintStyles = await figma.getLocalPaintStylesAsync();
    const textStyles = await figma.getLocalTextStylesAsync();
    const effectStyles = await figma.getLocalEffectStylesAsync();
    const gridStyles = await figma.getLocalGridStylesAsync();

    // Paint styles
    for (const s of paintStyles) {
      const paints = s.paints && s.paints.length > 0 ? extractFills(s.paints as any) : undefined;
      styles.push({
        id: s.id, name: s.name, key: s.key, styleType: s.type,
        description: s.description || "", paints, remote: (s as any).remote || false,
      });
    }

    // Text styles
    for (const s of textStyles) {
      styles.push({
        id: s.id, name: s.name, key: s.key, styleType: s.type,
        description: s.description || "",
        fontSize: s.fontSize as number,
        fontFamily: (s as any).fontName?.family || undefined,
        fontWeight: (s as any).fontName?.style || undefined,
        lineHeight: (s as any).lineHeight && typeof (s as any).lineHeight === "object" && "value" in (s as any).lineHeight
          ? { value: (s as any).lineHeight.value, unit: (s as any).lineHeight.unit } : null,
        remote: (s as any).remote || false,
      });
    }

    // Effect styles
    for (const s of effectStyles) {
      styles.push({
        id: s.id, name: s.name, key: s.key, styleType: s.type,
        description: s.description || "", remote: (s as any).remote || false,
      });
    }

    // Grid styles
    for (const s of gridStyles) {
      styles.push({
        id: s.id, name: s.name, key: s.key, styleType: s.type,
        description: s.description || "", remote: (s as any).remote || false,
      });
    }
  } catch (_) {}
  return styles;
}

// ── Component Extraction (fixed + rich) ────────

function extractAllComponents(): ExtractedComponent[] {
  const components: ExtractedComponent[] = [];
  try {
    // Walk all pages to find components
    for (const page of figma.root.children) {
      function walk(node: BaseNode) {
        if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
          const comp = node as ComponentNode;
          const sceneComp = node as SceneNode;

          let variantProps: { [key: string]: any } | null = null;
          if (node.type === "COMPONENT_SET") {
            const csNode = node as ComponentSetNode;
            const rawProps = (csNode as any).variantGroupProperties || {};
            if (Object.keys(rawProps).length > 0) {
              variantProps = {};
              for (const [k, v] of Object.entries(rawProps)) {
                variantProps[k] = v;
              }
            }
          }

          components.push({
            id: node.id,
            name: node.name,
            key: comp.key || "",
            description: comp.description || "",
            type: node.type,
            pageName: page.name,
            hasVariants: node.type === "COMPONENT_SET",
            variantProperties: variantProps,
            width: Math.round(sceneComp.width * 100) / 100,
            height: Math.round(sceneComp.height * 100) / 100,
            childCount: "children" in node ? (node as any).children.length : 0,
          });
        }
        if ("children" in node) {
          for (const child of (node as ChildrenMixin).children) {
            walk(child);
          }
        }
      }
      walk(page);
    }
  } catch (_) {}
  return components;
}

// ── Page Info ─────────────────────────────────

function extractPages(): ExtractedPage[] {
  const pages: ExtractedPage[] = [];
  for (const page of figma.root.children) {
    pages.push({
      id: page.id,
      name: page.name,
      nodeCount: flattenNodeTree(page).length,
      background:
        typeof page.backgrounds !== "undefined" && page.backgrounds.length > 0
          ? JSON.parse(JSON.stringify(page.backgrounds[0]))
          : null,
      topLevelFrames: (page.children || []).map((c: SceneNode) => ({
        id: c.id,
        name: c.name,
        width: Math.round(c.width * 100) / 100,
        height: Math.round(c.height * 100) / 100,
        childCount: "children" in c ? (c as any).children.length : 0,
      })),
    });
  }
  return pages;
}

// ── SVG Export (embedded) ──────────────────────

async function exportNodeAsSVGEmbedded(nodeId: string): Promise<EmbeddedSVG | null> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type === "PAGE" || node.type === "DOCUMENT") return null;
  const sceneNode = node as SceneNode;

  try {
    const svgString = await sceneNode.exportAsync({ format: "SVG_STRING" } as ExportSettingsSVGString);
    if (!svgString || svgString.length < 10) return null;

    return {
      nodeId: node.id,
      nodeName: sanitizeName(node.name),
      nodeType: node.type,
      pageName: getPageName(node),
      parentPath: getParentPath(node),
      width: Math.round(sceneNode.width * 100) / 100,
      height: Math.round(sceneNode.height * 100) / 100,
      svg: svgString,
    };
  } catch (_) {
    return null;
  }
}

// ── Full Extract (the big one) ──────────────────

async function buildFullExtract(
  onProgress?: (progress: FullExtractProgress) => void
): Promise<FullExtract> {
  const currentPage = figma.currentPage;
  const report = (step: number, totalSteps: number, label: string, detail: string) => {
    if (onProgress) onProgress({ step, totalSteps, label, detail });
  };

  const totalSteps = 8;
  report(0, totalSteps, "Initializing", "Scanning document...");

  // Step 1: Extract text nodes
  const allTextScenes = flattenNodeTree(currentPage, (n) => n.type === "TEXT");
  const textNodes = allTextScenes.map((n) => extractTextData(n as TextNode));
  report(1, totalSteps, "Text extracted", `${textNodes.length} text nodes found`);

  // Step 2: Extract variables
  const variables = await extractAllVariables();
  report(2, totalSteps, "Variables extracted", `${variables.length} variables found`);

  // Step 3: Extract styles
  const styles = await extractAllStyles();
  report(3, totalSteps, "Styles extracted", `${styles.length} styles found`);

  // Step 4: Extract components
  const components = extractAllComponents();
  report(4, totalSteps, "Components extracted", `${components.length} components found`);

  // Step 5: Extract pages
  const pages = extractPages();
  report(5, totalSteps, "Pages extracted", `${pages.length} pages`);

  // Step 6: Embed SVGs for all exportable nodes
  const allNodes = flattenNodeTree(currentPage);
  const exportableNodes = allNodes.filter(isExportable);
  report(6, totalSteps, "Exporting SVGs", `0 / ${exportableNodes.length}`);

  const svgs: EmbeddedSVG[] = [];
  const batchSize = 15;
  for (let i = 0; i < exportableNodes.length; i += batchSize) {
    const batch = exportableNodes.slice(i, i + batchSize);
    const promises = batch.map((n) => exportNodeAsSVGEmbedded(n.id));
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r) svgs.push(r);
    }
    report(6, totalSteps, "Exporting SVGs", `${Math.min(i + batchSize, exportableNodes.length)} / ${exportableNodes.length}`);
  }

  // Step 7: Build hierarchy
  const hierarchy = buildHierarchy(currentPage);
  report(7, totalSteps, "Building hierarchy", `${hierarchy.length} top-level nodes`);

  // Step 8: Counts
  const byType: { [type: string]: number } = {};
  let total = 0, frames = 0, comps = 0, instances = 0;
  function walkCount(node: BaseNode) {
    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) {
        total++;
        const t = child.type;
        byType[t] = (byType[t] || 0) + 1;
        if (t === "FRAME" || t === "SECTION") frames++;
        if (t === "COMPONENT" || t === "COMPONENT_SET") comps++;
        if (t === "INSTANCE") instances++;
        walkCount(child);
      }
    }
  }
  walkCount(currentPage);

  const result: FullExtract = {
    meta: {
      fileName: figma.root.name || "Untitled",
      extractDate: new Date().toISOString(),
      pluginVersion: PLUGIN_VERSION,
      totalPages: figma.root.children.length,
      extractionScope: "current page",
    },
    pages,
    textNodes,
    variables,
    styles,
    components,
    svgs,
    nodeCounts: {
      total,
      textNodes: textNodes.length,
      frames,
      components: comps,
      instances,
      svgsIncluded: svgs.length,
      byType,
    },
    hierarchy,
  };

  report(8, totalSteps, "Complete", `Ready: ${textNodes.length} texts, ${svgs.length} SVGs, ${variables.length} vars, ${styles.length} styles`);

  return result;
}

// ── Export Nodes (binary) ──────────────────────

async function exportNodes(
  nodeIds: string[],
  format: "SVG" | "PNG" | "JPG" | "PDF",
  scale: number
): Promise<ExportResultItem[]> {
  const results: ExportResultItem[] = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT") continue;
    const sceneNode = node as SceneNode;
    try {
      let bytes: Uint8Array;
      switch (format) {
        case "SVG":
          bytes = await sceneNode.exportAsync({ format: "SVG" } as ExportSettingsSVG);
          break;
        case "PNG":
          bytes = await sceneNode.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } } as ExportSettingsImage);
          break;
        case "JPG":
          bytes = await sceneNode.exportAsync({ format: "JPG", constraint: { type: "SCALE", value: scale } } as ExportSettingsImage);
          break;
        case "PDF":
          bytes = await sceneNode.exportAsync({ format: "PDF" } as ExportSettingsPDF);
          break;
        default:
          continue;
      }
      results.push({
        id: node.id,
        name: sanitizeName(node.name),
        format: format.toLowerCase(),
        bytes: Array.from(bytes),
      });
    } catch (err) {
      console.error(`Failed to export node ${node.name}:`, err);
    }
  }
  return results;
}

async function exportNodeAsSVGString(nodeId: string): Promise<{ id: string; name: string; svg: string } | null> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type === "PAGE" || node.type === "DOCUMENT") return null;
  try {
    const svgString = await (node as SceneNode).exportAsync({ format: "SVG_STRING" } as ExportSettingsSVGString);
    return { id: node.id, name: sanitizeName(node.name), svg: svgString };
  } catch (err) {
    console.error(`Failed to export SVG string for ${node.name}:`, err);
    return null;
  }
}

function postSelectionState() {
  const sel = figma.currentPage.selection;
  figma.ui.postMessage({
    type: "selection-state",
    count: sel.length,
    pageName: figma.currentPage.name,
    selectedTypes: sel.map((n: SceneNode) => n.type),
  });
}

// ── Build plain text dump (safe encoding) ──────

function buildPlainTextDump(textNodes: ExtractedText[]): string {
  const lines: string[] = [];
  lines.push("═══════════════════════════════════════════════");
  lines.push("  TEXT EXTRACTION — " + (figma.root.name || "Untitled"));
  lines.push("  " + new Date().toISOString());
  lines.push("═══════════════════════════════════════════════");
  lines.push("");

  for (const t of textNodes) {
    lines.push("── " + t.name + " ──────────────────");
    lines.push("  Page:      " + t.pageName);
    lines.push("  Parent:    " + t.parentPath);
    lines.push("  Font:      " + t.fontFamily + " " + t.fontStyle + " " + t.fontSize + "px");
    const hex = t.fills.length > 0 ? t.fills[0].hex : "none";
    lines.push("  Color:     " + hex);
    lines.push("  Position:  (" + t.absoluteX + ", " + t.absoluteY + ") " + t.width + "x" + t.height);
    // Clean emoji/special chars
    const safeChars = t.characters.replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{0080}-\u{009F}]/gu, "[icon]");
    lines.push("  Text:      " + safeChars);
    lines.push("");
  }

  lines.push("── END ──");
  lines.push("  " + textNodes.length + " text nodes total");
  return lines.join("\n");
}

// ── Lottie Bundle ──────────────────────────────

async function buildLottieExportBundle(nodeIds: string[]): Promise<any> {
  const items: any[] = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT") continue;
    try {
      const svgString = await (node as SceneNode).exportAsync({ format: "SVG_STRING" } as ExportSettingsSVGString);
      items.push({
        id: node.id, name: sanitizeName(node.name), type: node.type,
        pageName: getPageName(node), width: (node as SceneNode).width,
        height: (node as SceneNode).height, svg: svgString,
      });
    } catch (err) { console.error("Lottie export failed:", err); }
  }
  return {
    fileName: `${sanitizeName(figma.root.name)}_lottie.json`,
    exportDate: new Date().toISOString(),
    source: figma.root.name || "Untitled",
    items,
  };
}

function summarizeLottieImport(fileName: string, content: string): any {
  try {
    const parsed = JSON.parse(content);
    const topLevelKeys = parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
    const layers = Array.isArray(parsed?.layers) ? parsed.layers.length : 0;
    return {
      fileName, valid: true, topLevelKeys, layerCount: layers,
      warning: layers === 0 ? "No top-level layers array found." : "Imported successfully.",
    };
  } catch (err) {
    return { fileName, valid: false, topLevelKeys: [], layerCount: 0, warning: "Could not parse as JSON." };
  }
}

// ── Message Handler ────────────────────────────

figma.showUI(__html__, {
  width: 520,
  height: 680,
  title: "Extract All — Figma to Anything",
});

figma.on("selectionchange", postSelectionState);
figma.on("currentpagechange", postSelectionState);
postSelectionState();

figma.ui.onmessage = async (msg: any) => {
  // ═══════ FULL EXTRACT (the big one — includes SVGs!) ═══════
  if (msg.type === "get-full-extract") {
    const data = await buildFullExtract((progress) => {
      figma.ui.postMessage({ type: "full-extract-progress", progress });
    });

    // Send summary to UI
    figma.ui.postMessage({
      type: "full-extract",
      data: {
        textNodes: data.textNodes.length,
        variables: data.variables.length,
        styles: data.styles.length,
        components: data.components.length,
        svgs: data.svgs.length,
        totalNodes: data.nodeCounts.total,
      },
    });

    // 1. Download the main JSON (with embedded SVGs)
    const jsonStr = JSON.stringify(data, null, 2);
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_full-extract.json`,
      content: jsonStr,
      mimeType: "application/json",
    });

    // 2. Download plain text dump
    const txtContent = buildPlainTextDump(data.textNodes);
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_text.txt`,
      content: txtContent,
      mimeType: "text/plain",
    });

    // 3. Download individual SVG files for every embedded SVG
    // (these are also inside the JSON for convenience)
    for (const svgItem of data.svgs) {
      figma.ui.postMessage({
        type: "download-file",
        fileName: `svgs/${svgItem.pageName}/${svgItem.nodeName}.svg`,
        content: svgItem.svg,
        mimeType: "image/svg+xml",
      });
    }
  }

  // ═══════ TEXT ONLY ═══════
  if (msg.type === "get-text") {
    const textNodes = flattenNodeTree(figma.currentPage, (n) => n.type === "TEXT").map((n) => extractTextData(n as TextNode));
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_text.json`,
      content: JSON.stringify(textNodes, null, 2),
      mimeType: "application/json",
    });
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_text.txt`,
      content: buildPlainTextDump(textNodes),
      mimeType: "text/plain",
    });
  }

  // ═══════ VARIABLES ═══════
  if (msg.type === "get-variables") {
    const vars = await extractAllVariables();
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_variables.json`,
      content: JSON.stringify(vars, null, 2),
      mimeType: "application/json",
    });
  }

  // ═══════ STYLES ═══════
  if (msg.type === "get-styles") {
    const styles = await extractAllStyles();
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_styles.json`,
      content: JSON.stringify(styles, null, 2),
      mimeType: "application/json",
    });
  }

  // ═══════ COMPONENTS ═══════
  if (msg.type === "get-components") {
    const components = extractAllComponents();
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_components.json`,
      content: JSON.stringify(components, null, 2),
      mimeType: "application/json",
    });
  }

  // ═══════ PAGES ═══════
  if (msg.type === "get-pages") {
    const pages = extractPages();
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_pages.json`,
      content: JSON.stringify(pages, null, 2),
      mimeType: "application/json",
    });
  }

  // ═══════ SELECTED NODES EXPORT ═══════
  if (msg.type === "export-selected-svg" || msg.type === "export-selected-png" || msg.type === "export-selected-jpg") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "error", message: "No nodes selected." });
      return;
    }
    const format = msg.type === "export-selected-svg" ? "SVG" : msg.type === "export-selected-png" ? "PNG" : "JPG";
    const scaleNum = format === "SVG" ? (msg.scale || 1) : (msg.scale || 2);
    const results = await exportNodes(
      selection.map((n: SceneNode) => n.id), format, scaleNum
    );
    figma.ui.postMessage({ type: "export-results", results });
  }

  // ═══════ SVG CODE AS TEXT ═══════
  if (msg.type === "get-svg-as-text") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "error", message: "No nodes selected." });
      return;
    }
    for (const node of selection) {
      const result = await exportNodeAsSVGString(node.id);
      if (result) {
        figma.ui.postMessage({
          type: "download-file",
          fileName: `${result.name}.svg`,
          content: result.svg,
          mimeType: "image/svg+xml",
        });
      }
    }
  }

  // ═══════ LOTTIE EXPORT ═══════
  if (msg.type === "export-lottie-json") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "error", message: "No nodes selected." });
      return;
    }
    const bundle = await buildLottieExportBundle(selection.map((n: SceneNode) => n.id));
    figma.ui.postMessage({
      type: "download-file",
      fileName: bundle.fileName,
      content: JSON.stringify(bundle, null, 2),
      mimeType: "application/json",
    });
  }

  // ═══════ LOTTIE IMPORT/VALIDATE ═══════
  if (msg.type === "import-lottie-json") {
    const summary = summarizeLottieImport(msg.fileName || "lottie.json", String(msg.content || ""));
    figma.ui.postMessage({ type: "lottie-import-summary", summary });
  }

  // ═══════ BATCH EXPORT ═══════
  if (msg.type === "export-all-svg-page" || msg.type === "export-all-png-page") {
    const format = msg.type === "export-all-svg-page" ? "SVG" : "PNG";
    const scaleNum = format === "SVG" ? (msg.scale || 1) : (msg.scale || 2);
    const allNodes = flattenNodeTree(figma.currentPage).filter(isExportable);
    const batchSize = 20;
    for (let i = 0; i < allNodes.length; i += batchSize) {
      const batch = allNodes.slice(i, i + batchSize).map((n) => n.id);
      const results = await exportNodes(batch, format, scaleNum);
      figma.ui.postMessage({ type: "export-results", results });
      figma.ui.postMessage({
        type: "progress",
        current: Math.min(i + batchSize, allNodes.length),
        total: allNodes.length,
        label: `${format} export`,
      });
    }
    figma.ui.postMessage({ type: "export-complete" });
  }

  if (msg.type === "export-all-svg-all-pages" || msg.type === "export-all-png-all-pages") {
    const format = msg.type === "export-all-svg-all-pages" ? "SVG" : "PNG";
    const scaleNum = format === "SVG" ? (msg.scale || 1) : (msg.scale || 2);
    let totalNodes = 0, processedNodes = 0;
    for (const page of figma.root.children) {
      const nodes = flattenNodeTree(page).filter(isExportable);
      totalNodes += nodes.length;
      for (let i = 0; i < nodes.length; i += 20) {
        const batch = nodes.slice(i, i + 20).map((n) => n.id);
        const results = await exportNodes(batch, format, scaleNum);
        for (const r of results) r.name = sanitizeName(page.name) + "/" + r.name;
        figma.ui.postMessage({ type: "export-results", results });
        processedNodes += batch.length;
        figma.ui.postMessage({ type: "progress", current: Math.min(processedNodes, totalNodes), total: totalNodes, label: format + " all pages" });
      }
    }
    figma.ui.postMessage({ type: "export-complete" });
  }

  // ═══════ RESIZE / CLOSE ═══════
  if (msg.type === "resize") figma.ui.resize(msg.width, msg.height);
  if (msg.type === "close") figma.closePlugin();
};