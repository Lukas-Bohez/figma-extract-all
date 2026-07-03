"use strict";
const PLUGIN_VERSION = "8.0.0";
function sanitizeName(n) { return n.replace(/[<>:"\/\\|?*\x00-\x1f]/g, "_").replace(/\.+$/, "").trim() || "unnamed"; }
function rgbToHex(r, g, b) { const h = (n) => { const x = Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16); return x.length === 1 ? "0" + x : x; }; return "#" + h(r) + h(g) + h(b); }
function getPageName(node) { let c = node.parent || null; while (c) {
    if (c.type === "PAGE")
        return c.name;
    c = c.parent || null;
} return "(no page)"; }
function getParentPath(node) { const p = []; let c = node.parent || null; while (c) {
    if (c.type === "PAGE") {
        p.unshift(c.name);
        break;
    }
    if (c.type === "FRAME" || c.type === "GROUP" || c.type === "COMPONENT" || c.type === "COMPONENT_SET" || c.type === "SECTION")
        p.unshift(c.name);
    c = c.parent || null;
} return p.join(" > ") || "(root)"; }
function getAbsolutePos(node) { let ax = 0, ay = 0; let c = node; while (c && c.type !== "PAGE") {
    if ("x" in c && "y" in c) {
        ax += c.x;
        ay += c.y;
    }
    c = c.parent || null;
} return { x: ax, y: ay }; }
function deepFlatten(roots) {
    const results = [];
    function walk(n) {
        if (n.type !== "PAGE")
            results.push(n);
        if ("children" in n) {
            for (const c of n.children)
                walk(c);
        }
    }
    for (const r of roots)
        walk(r);
    return results;
}
function getScope() { const sel = figma.currentPage.selection; if (sel.length === 0)
    return { roots: [figma.currentPage], desc: "entire current page" }; return { roots: sel.map(s => s), desc: `${sel.length} selected: ${sel.map(s => s.name).join(", ")}` }; }
function isVisible(n) { return n.visible !== false; }
function extractFills(fills) { var _a, _b, _c, _d, _e, _f; if (fills === figma.mixed)
    return []; const r = []; for (const f of fills || []) {
    if (f.type === "SOLID" && f.color)
        r.push({ type: "SOLID", hex: rgbToHex(f.color.r, f.color.g, f.color.b), rgba: { r: f.color.r, g: f.color.g, b: f.color.b, a: (_a = f.opacity) !== null && _a !== void 0 ? _a : 1 }, opacity: (_b = f.opacity) !== null && _b !== void 0 ? _b : 1, visible: (_c = f.visible) !== null && _c !== void 0 ? _c : true, blendMode: (_d = f.blendMode) !== null && _d !== void 0 ? _d : "NORMAL", boundVariableId: ((_f = (_e = f.boundVariables) === null || _e === void 0 ? void 0 : _e.color) === null || _f === void 0 ? void 0 : _f.id) || null });
    else
        r.push({ type: f.type || "UNKNOWN", hex: "#000", rgba: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, blendMode: "NORMAL", boundVariableId: null });
} return r; }
function extractText(node) {
    let lh = null;
    const l = node.lineHeight;
    if (l !== figma.mixed && typeof l === "object" && "value" in l)
        lh = { value: l.value, unit: l.unit || "PIXELS" };
    let ls = null;
    const s = node.letterSpacing;
    if (s !== figma.mixed && typeof s === "object" && "value" in s)
        ls = { value: s.value, unit: s.unit || "PIXELS" };
    const ap = getAbsolutePos(node);
    return { id: node.id, name: node.name, characters: node.characters, pageName: getPageName(node), parentPath: getParentPath(node), parentFrame: (() => { let c = node.parent || null; while (c) {
            if (["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION"].includes(c.type))
                return c.name;
            c = c.parent || null;
        } return "(no frame)"; })(), absoluteX: Math.round(ap.x * 100) / 100, absoluteY: Math.round(ap.y * 100) / 100, width: Math.round(node.width * 100) / 100, height: Math.round(node.height * 100) / 100, x: Math.round(node.x * 100) / 100, y: Math.round(node.y * 100) / 100, fontFamily: node.fontName !== figma.mixed && typeof node.fontName === "object" ? node.fontName.family : "unknown", fontStyle: node.fontName !== figma.mixed && typeof node.fontName === "object" ? node.fontName.style : "Regular", fontSize: typeof node.fontSize === "number" ? node.fontSize : 0, fontWeight: typeof node.fontWeight === "number" ? node.fontWeight : 400, lineHeight: lh, letterSpacing: ls, textAlignHorizontal: node.textAlignHorizontal, textAlignVertical: node.textAlignVertical, fills: extractFills(node.fills), opacity: Math.round(node.opacity * 100) / 100 };
}
function extractAllComponents() { const c = []; for (const p of figma.root.children)
    wc(p, p.name, c); return c; }
function wc(node, pn, r) {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
        try {
            const sc = node;
            let vp = null;
            if (node.type === "COMPONENT_SET") {
                const rp = node.variantGroupProperties || node.variantProperties;
                if (rp) {
                    vp = {};
                    for (const k of Object.keys(rp))
                        vp[k] = rp[k];
                }
            }
            r.push({ id: node.id, name: node.name, key: node.key || "", description: node.description || "", type: node.type, pageName: pn, hasVariants: node.type === "COMPONENT_SET", variantProperties: vp, width: Math.round(sc.width * 100) / 100, height: Math.round(sc.height * 100) / 100, childCount: "children" in node ? node.children.length : 0 });
        }
        catch (e) { }
    }
    if ("children" in node)
        for (const ch of node.children)
            wc(ch, pn, r);
}
function extractPages() {
    const pages = [];
    for (const p of figma.root.children)
        pages.push({ id: p.id, name: p.name, nodeCount: deepFlatten([p]).length, background: typeof p.backgrounds !== "undefined" && p.backgrounds.length > 0 ? JSON.parse(JSON.stringify(p.backgrounds[0])) : null, topLevelFrames: (p.children || []).map((c) => ({ id: c.id, name: c.name, width: Math.round(c.width * 100) / 100, height: Math.round(c.height * 100) / 100, childCount: "children" in c ? c.children.length : 0 })) });
    return pages;
}
function buildHierarchy(root) {
    const nodes = [];
    if ("children" in root)
        for (const c of root.children) {
            const sc = c;
            const n = { id: sc.id, name: sc.name, type: sc.type, childCount: "children" in sc ? sc.children.length : 0, children: [] };
            if ("children" in sc)
                n.children = buildHierarchy(sc);
            nodes.push(n);
        }
    return nodes;
}
function buildFullExtractSync(onProgress) {
    const scope = getScope();
    const rpt = (s, l, d) => { if (onProgress)
        onProgress({ step: s, totalSteps: 3, label: l, detail: d }); };
    rpt(0, "Starting", "Scanning...");
    const allDeepNodes = deepFlatten(scope.roots);
    rpt(1, "Text", `${allDeepNodes.filter(n => n.type === "TEXT").length} texts, ${allDeepNodes.length} nodes`);
    const texts = [];
    for (const n of allDeepNodes) {
        if (n.type === "TEXT")
            texts.push(extractText(n));
    }
    const comps = extractAllComponents();
    const pages = extractPages();
    const hierarchy = [];
    for (const r of scope.roots)
        hierarchy.push(...buildHierarchy(r));
    rpt(2, "Components & Pages", `${comps.length} components, ${pages.length} pages`);
    const byType = {};
    let totalN = 0, fc = 0, cc = 0, ic = 0;
    function cn(n) { if ("children" in n)
        for (const c of n.children) {
            totalN++;
            const t = c.type;
            byType[t] = (byType[t] || 0) + 1;
            if (t === "FRAME" || t === "SECTION")
                fc++;
            if (t === "COMPONENT" || t === "COMPONENT_SET")
                cc++;
            if (t === "INSTANCE")
                ic++;
            cn(c);
        } }
    for (const r of scope.roots)
        cn(r);
    rpt(3, "Done", `${texts.length} texts, ${totalN} nodes`);
    return { meta: { fileName: figma.root.name || "Untitled", extractDate: new Date().toISOString(), pluginVersion: PLUGIN_VERSION, totalPages: figma.root.children.length, extractionScope: "scoped", scopeDescription: scope.desc }, pages, textNodes: texts, variables: [], styles: [], components: comps, nodeCounts: { total: totalN, textNodes: texts.length, frames: fc, components: cc, instances: ic, byType }, hierarchy };
}
async function fetchAndDownloadVariables() {
    var _a;
    try {
        const localVars = await figma.variables.getLocalVariablesAsync();
        const vars = [];
        let modeMap = {};
        try {
            const cols = await figma.variables.getLocalVariableCollectionsAsync();
            for (const col of cols || []) {
                modeMap[col.id] = {};
                for (const m of col.modes)
                    modeMap[col.id][m.modeId] = m.name;
            }
        }
        catch (e) { }
        for (const v of localVars || []) {
            const enriched = {};
            const raw = v.valuesByMode || {};
            const colId = v.variableCollectionId || "";
            for (const [modeId, value] of Object.entries(raw)) {
                const mn = ((_a = modeMap[colId]) === null || _a === void 0 ? void 0 : _a[modeId]) || modeId;
                if (value && typeof value === "object" && "r" in value)
                    enriched[mn] = { raw: value, hex: rgbToHex(value.r, value.g, value.b), css: "" };
                else
                    enriched[mn] = { raw: value };
            }
            vars.push({ id: v.id, name: v.name, resolvedType: v.resolvedType, valuesByMode: enriched, scopes: v.scopes || [], description: v.description || "", remote: v.remote || false });
        }
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_variables.json`, content: JSON.stringify(vars, null, 2), mimeType: "application/json" });
        figma.ui.postMessage({ type: "async-data", data: { variables: vars.length } });
    }
    catch (e) {
        figma.ui.postMessage({ type: "async-data", data: { variables: 0, error: true } });
    }
}
async function fetchAndDownloadStyles() {
    var _a, _b;
    try {
        const styles = [];
        const ps = await figma.getLocalPaintStylesAsync();
        for (const s of ps || []) {
            const paints = s.paints && s.paints.length > 0 ? extractFills(s.paints) : undefined;
            styles.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", paints, remote: s.remote || false });
        }
        const ts = await figma.getLocalTextStylesAsync();
        for (const s of ts || []) {
            styles.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", fontSize: s.fontSize, fontFamily: ((_a = s.fontName) === null || _a === void 0 ? void 0 : _a.family) || undefined, fontWeight: ((_b = s.fontName) === null || _b === void 0 ? void 0 : _b.style) || undefined, lineHeight: s.lineHeight && typeof s.lineHeight === "object" && "value" in s.lineHeight ? { value: s.lineHeight.value, unit: s.lineHeight.unit || "PIXELS" } : null, remote: s.remote || false });
        }
        const es = await figma.getLocalEffectStylesAsync();
        for (const s of es || []) {
            styles.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", remote: s.remote || false });
        }
        const gs = await figma.getLocalGridStylesAsync();
        for (const s of gs || []) {
            styles.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", remote: s.remote || false });
        }
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_styles.json`, content: JSON.stringify(styles, null, 2), mimeType: "application/json" });
        figma.ui.postMessage({ type: "async-data", data: { styles: styles.length } });
    }
    catch (e) {
        figma.ui.postMessage({ type: "async-data", data: { styles: 0, error: true } });
    }
}
async function exportNodeAsSVGEmbedded(nodeId) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node)
        return null;
    const sn = node;
    try {
        const s = await sn.exportAsync({ format: "SVG_STRING" });
        if (!s || s.length < 10)
            return null;
        return { nodeId: node.id, nodeName: sanitizeName(node.name), nodeType: node.type, pageName: getPageName(node), parentPath: getParentPath(node), width: Math.round(sn.width * 100) / 100, height: Math.round(sn.height * 100) / 100, svg: s };
    }
    catch (e) {
        return null;
    }
}
async function exportAllSVGsForScope(roots, onProgress) {
    const allNodes = deepFlatten(roots).filter(n => n.type !== "TEXT" && n.type !== "PAGE" && isVisible(n));
    const total = allNodes.length;
    if (onProgress)
        onProgress(0, total);
    for (let i = 0; i < allNodes.length; i += 8) {
        if (cancelRequested)
            break;
        const b = allNodes.slice(i, i + 8);
        const r = await Promise.all(b.map(n => exportNodeAsSVGEmbedded(n.id)));
        for (const x of r) {
            if (x)
                figma.ui.postMessage({ type: "download-file", fileName: `svgs/${sanitizeName(x.pageName)}/${x.nodeName}.svg`, content: x.svg, mimeType: "image/svg+xml" });
        }
        if (onProgress)
            onProgress(Math.min(i + 8, total), total);
        figma.ui.postMessage({ type: "progress", current: Math.min(i + 8, total), total: total, label: "SVGs" });
    }
}
async function exportNodes(nodeIds, format, scale) {
    const r = [];
    for (const id of nodeIds) {
        const n = await figma.getNodeByIdAsync(id);
        if (!n)
            continue;
        const sn = n;
        try {
            let b;
            switch (format) {
                case "SVG":
                    b = await sn.exportAsync({ format: "SVG" });
                    break;
                case "PNG":
                    b = await sn.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
                    break;
                case "JPG":
                    b = await sn.exportAsync({ format: "JPG", constraint: { type: "SCALE", value: scale } });
                    break;
                case "PDF":
                    b = await sn.exportAsync({ format: "PDF" });
                    break;
                default: continue;
            }
            r.push({ id: n.id, name: sanitizeName(n.name), format: format.toLowerCase(), bytes: Array.from(b) });
        }
        catch (e) { }
    }
    return r;
}
async function buildLottieBundle(roots) {
    const allNodes = deepFlatten(roots);
    const items = [];
    for (const n of allNodes) {
        if (n.type === "PAGE")
            continue;
        try {
            const s = await n.exportAsync({ format: "SVG_STRING" });
            if (s && s.length > 10)
                items.push({ id: n.id, name: sanitizeName(n.name), type: n.type, pageName: getPageName(n), width: n.width, height: n.height, svg: s });
        }
        catch (e) { }
    }
    return { fileName: `${sanitizeName(figma.root.name)}_lottie.json`, exportDate: new Date().toISOString(), source: figma.root.name || "Untitled", itemCount: items.length, items };
}
function buildPlainText(textNodes) {
    const lines = [`════ TEXT — ${figma.root.name || "Untitled"}`, `  ${new Date().toISOString()}`, `════`, ` `];
    for (const t of textNodes) {
        lines.push(`── ${t.name} ──`, `  Page:     ${t.pageName}`, `  Parent:   ${t.parentPath}`, `  Font:     ${t.fontFamily} ${t.fontStyle} ${t.fontSize}px`, `  Color:    ${t.fills.length > 0 ? t.fills[0].hex : "none"}`, `  Position: (${t.absoluteX},${t.absoluteY}) ${t.width}×${t.height}`, `  Text:     ${t.characters.replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{27BF}\u{0080}-\u{009F}]/gu, "[icon]")}`, ` `);
    }
    lines.push(`── END (${textNodes.length} texts) ──`);
    return lines.join("\n");
}
figma.showUI(__html__, { width: 520, height: 680, title: "Extract All" });
let cancelRequested = false;
function postSel() { figma.ui.postMessage({ type: "selection-state", count: figma.currentPage.selection.length, pageName: figma.currentPage.name }); }
figma.on("selectionchange", postSel);
figma.on("currentpagechange", postSel);
postSel();
figma.ui.onmessage = async (msg) => {
    cancelRequested = false;
    const scope = getScope();
    if (msg.type === "get-full-extract" && !msg.aeOpts && !msg.aiOpts) {
        const data = buildFullExtractSync((p) => { figma.ui.postMessage({ type: "full-extract-progress", progress: p }); });
        figma.ui.postMessage({ type: "full-extract", data: { textNodes: data.textNodes.length, variables: 0, styles: 0, components: data.components.length, totalNodes: data.nodeCounts.total, scope: data.meta.scopeDescription } });
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_full-extract.json`, content: JSON.stringify(data, null, 2), mimeType: "application/json" });
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_text.txt`, content: buildPlainText(data.textNodes), mimeType: "text/plain" });
        fetchAndDownloadVariables();
        fetchAndDownloadStyles();
    }
    if (msg.type === "get-full-extract" && msg.aeOpts) {
        const data = buildFullExtractSync((p) => { figma.ui.postMessage({ type: "full-extract-progress", progress: p }); });
        if (cancelRequested)
            return;
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_full-extract.json`, content: JSON.stringify(data, null, 2), mimeType: "application/json" });
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_text.txt`, content: buildPlainText(data.textNodes), mimeType: "text/plain" });
        fetchAndDownloadVariables();
        fetchAndDownloadStyles();
        if (msg.aeOpts.includeSVGs && !cancelRequested) {
            await exportAllSVGsForScope(scope.roots, (c, t) => { figma.ui.postMessage({ type: "svgs-progress", current: c, total: t }); });
        }
        if (msg.aeOpts.includeLottie && !cancelRequested) {
            const b = await buildLottieBundle(scope.roots);
            figma.ui.postMessage({ type: "download-file", fileName: b.fileName, content: JSON.stringify(b, null, 2), mimeType: "application/json" });
        }
        if (!cancelRequested)
            figma.ui.postMessage({ type: "full-extract", data: { textNodes: data.textNodes.length, variables: 0, styles: 0, components: data.components.length, totalNodes: data.nodeCounts.total, scope: data.meta.scopeDescription } });
    }
    if (msg.type === "get-full-extract" && msg.aiOpts) {
        const data = buildFullExtractSync((p) => { figma.ui.postMessage({ type: "full-extract-progress", progress: p }); });
        if (cancelRequested)
            return;
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_full-extract.json`, content: JSON.stringify(data, null, 2), mimeType: "application/json" });
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_text.txt`, content: buildPlainText(data.textNodes), mimeType: "text/plain" });
        fetchAndDownloadVariables();
        fetchAndDownloadStyles();
        if (msg.aiOpts.includeSVGs && !cancelRequested) {
            await exportAllSVGsForScope(scope.roots, (c, t) => { figma.ui.postMessage({ type: "svgs-progress", current: c, total: t }); });
        }
        if (!cancelRequested)
            figma.ui.postMessage({ type: "full-extract", data: { textNodes: data.textNodes.length, variables: 0, styles: 0, components: data.components.length, totalNodes: data.nodeCounts.total, scope: data.meta.scopeDescription } });
    }
    if (msg.type === "get-text") {
        const nodes = deepFlatten(scope.roots);
        const tn = nodes.filter(n => n.type === "TEXT").map(n => extractText(n));
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_text.json`, content: JSON.stringify(tn, null, 2), mimeType: "application/json" });
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_text.txt`, content: buildPlainText(tn), mimeType: "text/plain" });
    }
    if (msg.type === "get-variables") {
        fetchAndDownloadVariables();
    }
    if (msg.type === "get-styles") {
        fetchAndDownloadStyles();
    }
    if (msg.type === "get-components") {
        const c = extractAllComponents();
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_components.json`, content: JSON.stringify(c, null, 2), mimeType: "application/json" });
    }
    if (msg.type === "get-pages") {
        const p = extractPages();
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_pages.json`, content: JSON.stringify(p, null, 2), mimeType: "application/json" });
    }
    if (msg.type === "export-selected-svg" || msg.type === "export-selected-png" || msg.type === "export-selected-jpg") {
        const sel = figma.currentPage.selection;
        if (sel.length === 0) {
            figma.ui.postMessage({ type: "error", message: "No nodes selected" });
            return;
        }
        const fmt = msg.type === "export-selected-svg" ? "SVG" : msg.type === "export-selected-png" ? "PNG" : "JPG";
        const sc = fmt === "SVG" ? (msg.scale || 1) : (msg.scale || 2);
        const results = await exportNodes(sel.map((n) => n.id), fmt, sc);
        if (results.length > 0)
            figma.ui.postMessage({ type: "export-results", results });
    }
    if (msg.type === "get-svg-as-text") {
        const sel = figma.currentPage.selection;
        if (sel.length === 0) {
            figma.ui.postMessage({ type: "error", message: "No nodes selected" });
            return;
        }
        for (const node of sel) {
            const s = await node.exportAsync({ format: "SVG_STRING" });
            if (s)
                figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(node.name)}.svg`, content: s, mimeType: "image/svg+xml" });
        }
    }
    if (msg.type === "export-lottie-json") {
        const bundle = await buildLottieBundle(scope.roots);
        figma.ui.postMessage({ type: "download-file", fileName: bundle.fileName, content: JSON.stringify(bundle, null, 2), mimeType: "application/json" });
    }
    if (msg.type === "import-lottie-json") {
        try {
            const p = JSON.parse(String(msg.content || ""));
            const keys = p && typeof p === "object" ? Object.keys(p) : [];
            const ly = Array.isArray(p === null || p === void 0 ? void 0 : p.layers) ? p.layers.length : 0;
            figma.ui.postMessage({ type: "lottie-import-summary", summary: { fileName: msg.fileName || "lottie.json", valid: true, topLevelKeys: keys, layerCount: ly, warning: ly === 0 ? "No layers" : "OK" } });
        }
        catch (e) {
            figma.ui.postMessage({ type: "lottie-import-summary", summary: { fileName: msg.fileName || "lottie.json", valid: false, topLevelKeys: [], layerCount: 0, warning: "Invalid JSON" } });
        }
    }
    if (msg.type === "export-all-svg-page" || msg.type === "export-all-png-page" || msg.type === "export-all-svg-all-pages" || msg.type === "export-all-png-all-pages") {
        const fmt = msg.type.includes("svg") ? "SVG" : "PNG";
        const sc = fmt === "SVG" ? (msg.scale || 1) : (msg.scale || 2);
        const pages = msg.type.includes("all-pages") ? [...figma.root.children] : [figma.currentPage];
        let tN = 0;
        for (const pg of pages)
            tN += deepFlatten([pg]).filter((n) => isVisible(n) && n.type !== "PAGE").length;
        let pN = 0;
        for (const pg of pages) {
            const ns = deepFlatten([pg]).filter((n) => isVisible(n) && n.type !== "PAGE");
            for (let i = 0; i < ns.length; i += 20) {
                if (cancelRequested)
                    break;
                const b = ns.slice(i, i + 20).map(n => n.id);
                const r = await exportNodes(b, fmt, sc);
                for (const x of r)
                    if (pages.length > 1)
                        x.name = sanitizeName(pg.name) + "/" + x.name;
                if (r.length > 0)
                    figma.ui.postMessage({ type: "export-results", results: r });
                pN += b.length;
                figma.ui.postMessage({ type: "progress", current: Math.min(pN, tN), total: tN, label: fmt });
            }
        }
        if (!cancelRequested)
            figma.ui.postMessage({ type: "export-complete" });
    }
    if (msg.type === "cancel") {
        cancelRequested = true;
    }
    if (msg.type === "resize") {
        figma.ui.resize(msg.width, msg.height);
    }
    if (msg.type === "close") {
        figma.closePlugin();
    }
};
