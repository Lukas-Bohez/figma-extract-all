// ──────────────────────────────────────────────
// Figma Extract All – Main Plugin Code
// Extracts: text, SVGs, PNGs, variables, styles,
//           components, pages, and metadata
// ──────────────────────────────────────────────

// ── Types ──────────────────────────────────────

// (Renamed to avoid collision with Figma's built-in ExportSettings type)
interface PluginExportSettings {
  format: "SVG" | "PNG" | "JPG" | "PDF";
  scale: number;
  textNodes: boolean;
  variables: boolean;
  styles: boolean;
  components: boolean;
  pages: boolean;
  metadata: boolean;
}

interface ExtractedText {
  id: string;
  name: string;
  type: string;
  pageName: string;
  characters: string;
  fontName: { family: string; style: string } | null;
  fontSize: number;
  fontWeight: number;
  lineHeight: { value: number; unit: string } | null;
  letterSpacing: { value: number; unit: string } | null;
  textAlignHorizontal: string;
  textAlignVertical: string;
  fills: any[];
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  constraints: { horizontal: string; vertical: string };
}

interface ExtractedVariable {
  id: string;
  name: string;
  resolvedType: string;
  valuesByMode: { [modeId: string]: any };
  scopes: string[];
  codeSyntax: any;
  description: string;
  remote: boolean;
}

interface ExtractedStyle {
  id: string;
  name: string;
  key: string;
  styleType: string;
  description: string;
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
  variantProperties: { [key: string]: string } | null;
}

interface ExtractedPage {
  id: string;
  name: string;
  nodeCount: number;
  background: any | null;
}

interface FullExtract {
  fileName: string;
  extractDate: string;
  totalPages: number;
  pages: ExtractedPage[];
  textNodes: ExtractedText[];
  variables: ExtractedVariable[];
  styles: ExtractedStyle[];
  components: ExtractedComponent[];
  nodeCounts: {
    total: number;
    byType: { [type: string]: number };
  };
}

interface ExportRequest {
  type: "export-nodes";
  nodeIds: string[];
  format: "SVG" | "PNG" | "JPG" | "PDF";
  scale: number;
  constraint: "SCALE" | "WIDTH" | "HEIGHT";
}

interface ExportResultItem {
  id: string;
  name: string;
  format: string;
  bytes: number[];
}

// ── Constants ──────────────────────────────────

const EXPORTABLE_TYPES = [
  "BOOLEAN_OPERATION",
  "COMPONENT",
  "COMPONENT_SET",
  "ELLIPSE",
  "FRAME",
  "GROUP",
  "INSTANCE",
  "LINE",
  "POLYGON",
  "RECTANGLE",
  "SECTION",
  "STAR",
  "TEXT",
  "VECTOR",
];

// ── Helpers ────────────────────────────────────

function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.+$/, "").trim() || "unnamed";
}

function getPageName(node: BaseNode): string {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === "PAGE") return current.name;
    current = current.parent;
  }
  return "(no page)";
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

function countNodeTypes(root: PageNode | SceneNode): { total: number; byType: { [type: string]: number } } {
  const byType: { [type: string]: number } = {};
  let total = 0;
  function walk(node: BaseNode) {
    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) {
        total++;
        const t = child.type;
        byType[t] = (byType[t] || 0) + 1;
        walk(child);
      }
    }
  }
  walk(root);
  return { total, byType };
}

// Polyfill for Object.fromEntries (for ES2017 compatibility)
function objectFromEntries<K extends string, V>(entries: [K, V][]): Record<K, V> {
  const obj: Record<string, V> = {};
  for (const [key, value] of entries) {
    obj[key] = value;
  }
  return obj as Record<K, V>;
}

function isExportable(node: SceneNode): boolean {
  return node.visible !== false && EXPORTABLE_TYPES.indexOf(node.type) >= 0;
}

// ── Text Extraction ────────────────────────────

function extractTextData(node: TextNode): ExtractedText {
  // Handle lineHeight (may be figma.mixed or a specific value)
  let lineHeight: { value: number; unit: string } | null = null;
  const lh = node.lineHeight;
  if (lh !== figma.mixed && typeof lh === "object" && "value" in lh && "unit" in lh) {
    lineHeight = { value: (lh as LineHeight & { value: number }).value, unit: (lh as LineHeight & { unit: "PIXELS" | "PERCENT" }).unit };
  }

  // Handle letterSpacing (may be figma.mixed or a specific value)
  let letterSpacing: { value: number; unit: string } | null = null;
  const ls = node.letterSpacing;
  if (ls !== figma.mixed && typeof ls === "object" && "value" in ls && "unit" in ls) {
    letterSpacing = { value: (ls as LetterSpacing & { value: number }).value, unit: (ls as LetterSpacing & { unit: "PIXELS" | "PERCENT" }).unit };
  }

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    pageName: getPageName(node),
    characters: node.characters,
    fontName:
      typeof node.fontName === "object" && "family" in node.fontName
        ? { family: node.fontName.family, style: node.fontName.style }
        : null,
    fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
    fontWeight: typeof (node as any).fontWeight === "number" ? (node as any).fontWeight : 400,
    lineHeight,
    letterSpacing,
    textAlignHorizontal: node.textAlignHorizontal,
    textAlignVertical: node.textAlignVertical,
    fills: node.fills !== figma.mixed ? JSON.parse(JSON.stringify(node.fills)) : [],
    opacity: node.opacity,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    constraints: { horizontal: node.constraints.horizontal, vertical: node.constraints.vertical },
  };
}

// ── Variable Extraction ────────────────────────

async function extractAllVariables(): Promise<ExtractedVariable[]> {
  const vars: ExtractedVariable[] = [];
  try {
    const localVars = await figma.variables.getLocalVariablesAsync();
    for (const v of localVars) {
      vars.push({
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType,
        valuesByMode: v.valuesByMode,
        scopes: v.scopes || [],
        codeSyntax: (v as any).codeSyntax || {},
        description: v.description || "",
        remote: (v as any).remote || false,
      });
    }
  } catch (_) {
    // variables API may not be available
  }
  return vars;
}

// ── Style Extraction ───────────────────────────

async function extractAllStyles(): Promise<ExtractedStyle[]> {
  const styles: ExtractedStyle[] = [];
  try {
    const paintStyles = await figma.getLocalPaintStylesAsync();
    const textStyles = await figma.getLocalTextStylesAsync();
    const effectStyles = await figma.getLocalEffectStylesAsync();
    const gridStyles = await figma.getLocalGridStylesAsync();

    const allStyles = [...paintStyles, ...textStyles, ...effectStyles, ...gridStyles];
    for (const s of allStyles) {
      styles.push({
        id: s.id,
        name: s.name,
        key: s.key,
        styleType: s.type,
        description: s.description || "",
        remote: (s as any).remote || false,
      });
    }
  } catch (_) {
    // styles API might fail in some contexts
  }
  return styles;
}

// ── Component Extraction ───────────────────────

function extractAllComponents(currentPage: PageNode): ExtractedComponent[] {
  const components: ExtractedComponent[] = [];

  try {
    const compNodes = figma.root.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] });
    for (const comp of compNodes) {
      const componentNode = comp as ComponentNode;
      const isComponentSet = comp.type === "COMPONENT_SET";

      let variantProps: { [key: string]: string } | null = null;
      if (isComponentSet) {
        const csNode = comp as ComponentSetNode;
        // Figma API uses variantGroupProperties
        const rawProps = (csNode as any).variantGroupProperties || (csNode as any).variantProperties || {};
        variantProps = objectFromEntries(
          Object.keys(rawProps).map((k) => [k, String(rawProps[k])])
        );
      }

      components.push({
        id: comp.id,
        name: comp.name,
        key: componentNode.key || "",
        description: componentNode.description || "",
        type: comp.type,
        pageName: getPageName(comp),
        hasVariants: isComponentSet,
        variantProperties: variantProps,
      });
    }
  } catch (_) {
    // findAllWithCriteria may not be available
  }

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
    });
  }
  return pages;
}

// ── Full JSON Dump ─────────────────────────────

async function buildFullExtract(currentPage: PageNode): Promise<FullExtract> {
  const allTextNodes = flattenNodeTree(currentPage, (n) => n.type === "TEXT").map((n) =>
    extractTextData(n as TextNode)
  );

  const variables = await extractAllVariables();
  const styles = await extractAllStyles();
  const components = extractAllComponents(currentPage);
  const pages = extractPages();
  const nodeCounts = countNodeTypes(currentPage);

  return {
    fileName: figma.root.name || "Untitled",
    extractDate: new Date().toISOString(),
    totalPages: figma.root.children.length,
    pages,
    textNodes: allTextNodes,
    variables,
    styles,
    components,
    nodeCounts,
  };
}

// ── Export Nodes ───────────────────────────────

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
          bytes = await sceneNode.exportAsync({
            format: "SVG",
            // SVG specific options
          } as ExportSettingsSVG);
          break;
        case "PNG":
          bytes = await sceneNode.exportAsync({
            format: "PNG",
            constraint: { type: "SCALE", value: scale },
          } as ExportSettingsImage);
          break;
        case "JPG":
          bytes = await sceneNode.exportAsync({
            format: "JPG",
            constraint: { type: "SCALE", value: scale },
          } as ExportSettingsImage);
          break;
        case "PDF":
          bytes = await sceneNode.exportAsync({
            format: "PDF",
          } as ExportSettingsPDF);
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
    const svgString = await (node as SceneNode).exportAsync({
      format: "SVG_STRING",
    } as ExportSettingsSVGString);
    return { id: node.id, name: sanitizeName(node.name), svg: svgString };
  } catch (err) {
    console.error(`Failed to export SVG string for ${node.name}:`, err);
    return null;
  }
}

// ── Message Handler ────────────────────────────

figma.showUI(__html__, {
  width: 480,
  height: 700,
  title: "Extract All – Figma to Anything",
});

figma.ui.onmessage = async (msg: any) => {
  // ── Get Full JSON Extract ──
  if (msg.type === "get-full-extract") {
    const currentPage = figma.currentPage;
    const data = await buildFullExtract(currentPage);
    figma.ui.postMessage({ type: "full-extract", data });

    const jsonStr = JSON.stringify(data, null, 2);
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_full-extract.json`,
      content: jsonStr,
      mimeType: "application/json",
    });
  }

  // ── Get Text Only ──
  if (msg.type === "get-text") {
    const textNodes = flattenNodeTree(figma.currentPage, (n) => n.type === "TEXT").map((n) =>
      extractTextData(n as TextNode)
    );

    // JSON version
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_text.json`,
      content: JSON.stringify(textNodes, null, 2),
      mimeType: "application/json",
    });

    // Plain text version
    let plainText = "";
    for (const t of textNodes) {
      plainText += `// ── ${t.name} (${t.pageName}) ──\n${t.characters}\n\n`;
    }
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_text.txt`,
      content: plainText,
      mimeType: "text/plain",
    });
  }

  // ── Get Variables ──
  if (msg.type === "get-variables") {
    const vars = await extractAllVariables();
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_variables.json`,
      content: JSON.stringify(vars, null, 2),
      mimeType: "application/json",
    });
  }

  // ── Get Styles ──
  if (msg.type === "get-styles") {
    const styles = await extractAllStyles();
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_styles.json`,
      content: JSON.stringify(styles, null, 2),
      mimeType: "application/json",
    });
  }

  // ── Get Components ──
  if (msg.type === "get-components") {
    const components = extractAllComponents(figma.currentPage);
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_components.json`,
      content: JSON.stringify(components, null, 2),
      mimeType: "application/json",
    });
  }

  // ── Get Pages Info ──
  if (msg.type === "get-pages") {
    const pages = extractPages();
    figma.ui.postMessage({
      type: "download-file",
      fileName: `${sanitizeName(figma.root.name)}_pages.json`,
      content: JSON.stringify(pages, null, 2),
      mimeType: "application/json",
    });
  }

  // ── Export Selected Nodes ──
  if (msg.type === "export-selected-svg" || msg.type === "export-selected-png" || msg.type === "export-selected-jpg") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({ type: "error", message: "No nodes selected." });
      return;
    }

    const format = msg.type === "export-selected-svg" ? "SVG" : msg.type === "export-selected-png" ? "PNG" : "JPG";
    const scaleNum = format === "SVG" ? (msg.scale || 1) : (msg.scale || 2);
    const results = await exportNodes(
      selection.map((n: SceneNode) => n.id),
      format,
      scaleNum
    );
    figma.ui.postMessage({ type: "export-results", results });
  }

  // ── Export SVG Code as Text ──
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

  // ── Get Node Tree ──
  if (msg.type === "get-node-tree") {
    const nodes = flattenNodeTree(figma.currentPage).map((n: SceneNode) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      visible: n.visible,
      pageName: getPageName(n),
    }));
    figma.ui.postMessage({ type: "node-tree", nodes });
  }

  // ── Batch Export on Current Page ──
  if (msg.type === "export-all-svg-page" || msg.type === "export-all-png-page") {
    const format = msg.type === "export-all-svg-page" ? "SVG" : "PNG";
    const scaleNum = format === "SVG" ? (msg.scale || 1) : (msg.scale || 2);
    await batchExportPage(figma.currentPage, format, scaleNum, false);
    figma.ui.postMessage({ type: "export-complete" });
  }

  // ── Batch Export on All Pages ──
  if (msg.type === "export-all-svg-all-pages" || msg.type === "export-all-png-all-pages") {
    const format = msg.type === "export-all-svg-all-pages" ? "SVG" : "PNG";
    const scaleNum = format === "SVG" ? (msg.scale || 1) : (msg.scale || 2);
    let totalNodes = 0;
    let processedNodes = 0;

    for (const page of figma.root.children) {
      const allNodes = flattenNodeTree(page);
      const exportableNodes = allNodes.filter(isExportable);

      if (exportableNodes.length > 0) {
        totalNodes += exportableNodes.length;
        const batchSize = 20;
        for (let i = 0; i < exportableNodes.length; i += batchSize) {
          const batch = exportableNodes.slice(i, i + batchSize).map((n) => n.id);
          const results = await exportNodes(batch, format, scaleNum);
          // Prepend page name for disambiguation
          for (const r of results) {
            r.name = sanitizeName(page.name) + "/" + r.name;
          }
          figma.ui.postMessage({ type: "export-results", results });
          processedNodes += batch.length;
          figma.ui.postMessage({
            type: "progress",
            current: Math.min(processedNodes, totalNodes),
            total: totalNodes,
          });
        }
      }
    }
    figma.ui.postMessage({ type: "export-complete" });
  }

  // ── Resize UI ──
  if (msg.type === "resize") {
    figma.ui.resize(msg.width, msg.height);
  }

  // ── Close ──
  if (msg.type === "close") {
    figma.closePlugin();
  }
};

// ── Batch Export Helper ───────────────────────

async function batchExportPage(
  page: PageNode,
  format: "SVG" | "PNG",
  scale: number,
  isAllPages: boolean
): Promise<void> {
  const allNodes = flattenNodeTree(page);
  const exportableIds = allNodes.filter(isExportable).map((n) => n.id);

  if (exportableIds.length === 0) {
    figma.ui.postMessage({ type: "error", message: `No exportable nodes on page "${page.name}".` });
    return;
  }

  const batchSize = 20;
  for (let i = 0; i < exportableIds.length; i += batchSize) {
    const batch = exportableIds.slice(i, i + batchSize);
    const results = await exportNodes(batch, format, scale);
    figma.ui.postMessage({ type: "export-results", results });
    figma.ui.postMessage({
      type: "progress",
      current: Math.min(i + batchSize, exportableIds.length),
      total: exportableIds.length,
    });
  }
}