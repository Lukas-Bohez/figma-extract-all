"use strict";
const PLUGIN_VERSION = "5.0.0";
const EXPORTABLE_TYPES = [
    "BOOLEAN_OPERATION", "COMPONENT", "COMPONENT_SET", "ELLIPSE", "FRAME", "GROUP",
    "INSTANCE", "LINE", "POLYGON", "RECTANGLE", "SECTION", "STAR", "TEXT", "VECTOR"
];
function sanitizeName(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.+$/, "").trim() || "unnamed";
}
function rgbToHex(r, g, b) {
    const h = (n) => { const x = Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16); return x.length === 1 ? "0" + x : x; };
    return "#" + h(r) + h(g) + h(b);
}
function rgbaToCSS(r, g, b, a) {
    const ri = Math.round(r * 255), gi = Math.round(g * 255), bi = Math.round(b * 255);
    if (a >= 1)
        return `rgb(${ri},${gi},${bi})`;
    return `rgba(${ri},${gi},${bi},${Math.round(a * 100) / 100})`;
}
function getPageName(node) {
    let c = node;
    while (c) {
        if (c.type === "PAGE")
            return c.name;
        c = c.parent || null;
    }
    return "(no page)";
}
function getParentPath(node) {
    const p = [];
    let c = node.parent || null;
    while (c) {
        if (c.type === "PAGE") {
            p.unshift(c.name);
            break;
        }
        if (c.type === "FRAME" || c.type === "GROUP" || c.type === "COMPONENT" || c.type === "COMPONENT_SET" || c.type === "SECTION")
            p.unshift(c.name);
        c = c.parent || null;
    }
    return p.join(" > ") || "(root)";
}
function getParentFrame(node) {
    let c = node.parent || null;
    while (c) {
        if (c.type === "FRAME" || c.type === "COMPONENT" || c.type === "COMPONENT_SET" || c.type === "SECTION")
            return c.name;
        c = c.parent || null;
    }
    return "(no frame)";
}
function getAbsolutePos(node) {
    let ax = 0, ay = 0;
    let c = node;
    while (c && c.type !== "PAGE") {
        if ("x" in c && "y" in c) {
            ax += c.x;
            ay += c.y;
        }
        c = c.parent || null;
    }
    return { x: ax, y: ay };
}
function flatten(root, pred) {
    const r = [];
    function w(n) {
        if ("children" in n) {
            for (const c of n.children) {
                const s = c;
                if (!pred || pred(s))
                    r.push(s);
                w(s);
            }
        }
    }
    w(root);
    return r;
}
function buildHierarchy(root) {
    const nodes = [];
    if ("children" in root) {
        for (const c of root.children) {
            const sc = c;
            const n = { id: sc.id, name: sc.name, type: sc.type, childCount: "children" in sc ? sc.children.length : 0, children: [] };
            if ("children" in sc)
                n.children = buildHierarchy(sc);
            nodes.push(n);
        }
    }
    return nodes;
}
function isExportable(node) {
    return node.visible !== false && EXPORTABLE_TYPES.indexOf(node.type) >= 0;
}
function extractFills(fills) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    if (fills === figma.mixed)
        return [];
    const r = [];
    for (const f of fills) {
        if (f.type === "SOLID" && f.color) {
            r.push({ type: "SOLID", hex: rgbToHex(f.color.r, f.color.g, f.color.b), rgba: { r: f.color.r, g: f.color.g, b: f.color.b, a: (_a = f.opacity) !== null && _a !== void 0 ? _a : 1 }, opacity: (_b = f.opacity) !== null && _b !== void 0 ? _b : 1, visible: (_c = f.visible) !== null && _c !== void 0 ? _c : true, blendMode: (_d = f.blendMode) !== null && _d !== void 0 ? _d : "NORMAL", boundVariableId: ((_f = (_e = f.boundVariables) === null || _e === void 0 ? void 0 : _e.color) === null || _f === void 0 ? void 0 : _f.id) || null });
        }
        else if (f.type === "GRADIENT_LINEAR" || f.type === "GRADIENT_RADIAL" || f.type === "GRADIENT_ANGULAR" || f.type === "GRADIENT_DIAMOND") {
            const stops = ((_g = f.gradientStops) === null || _g === void 0 ? void 0 : _g.map((s) => ({ position: s.position, hex: rgbToHex(s.color.r, s.color.g, s.color.b), rgba: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a } }))) || [];
            r.push({ type: f.type, hex: stops.length > 0 ? stops[0].hex : "#000000", rgba: stops.length > 0 ? stops[0].rgba : { r: 0, g: 0, b: 0, a: 1 }, opacity: (_h = f.opacity) !== null && _h !== void 0 ? _h : 1, visible: (_j = f.visible) !== null && _j !== void 0 ? _j : true, blendMode: (_k = f.blendMode) !== null && _k !== void 0 ? _k : "NORMAL", boundVariableId: null });
        }
        else {
            r.push({ type: f.type, hex: "#000000", rgba: { r: 0, g: 0, b: 0, a: 1 }, opacity: (_l = f.opacity) !== null && _l !== void 0 ? _l : 1, visible: (_m = f.visible) !== null && _m !== void 0 ? _m : true, blendMode: (_o = f.blendMode) !== null && _o !== void 0 ? _o : "NORMAL", boundVariableId: null });
        }
    }
    return r;
}
function extractText(node) {
    let lh = null;
    const l = node.lineHeight;
    if (l !== figma.mixed && typeof l === "object" && "value" in l && "unit" in l)
        lh = { value: l.value, unit: l.unit };
    let ls = null;
    const s = node.letterSpacing;
    if (s !== figma.mixed && typeof s === "object" && "value" in s && "unit" in s)
        ls = { value: s.value, unit: s.unit };
    const ap = getAbsolutePos(node);
    return {
        id: node.id, name: node.name, characters: node.characters, pageName: getPageName(node),
        parentPath: getParentPath(node), parentFrame: getParentFrame(node),
        absoluteX: Math.round(ap.x * 100) / 100, absoluteY: Math.round(ap.y * 100) / 100,
        width: Math.round(node.width * 100) / 100, height: Math.round(node.height * 100) / 100,
        x: Math.round(node.x * 100) / 100, y: Math.round(node.y * 100) / 100,
        fontFamily: typeof node.fontName === "object" && "family" in node.fontName ? node.fontName.family : "unknown",
        fontStyle: typeof node.fontName === "object" && "style" in node.fontName ? node.fontName.style : "Regular",
        fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
        fontWeight: typeof node.fontWeight === "number" ? node.fontWeight : 400,
        lineHeight: lh, letterSpacing: ls,
        textAlignHorizontal: node.textAlignHorizontal, textAlignVertical: node.textAlignVertical,
        fills: extractFills(node.fills), opacity: Math.round(node.opacity * 100) / 100,
        textAutoResize: node.textAutoResize, textTruncation: node.textTruncation || "DISABLED", maxLines: node.maxLines || null
    };
}
async function extractAllVariables() {
    var _a;
    const vars = [];
    try {
        const localVars = await figma.variables.getLocalVariablesAsync();
        const modeMap = {};
        const collections = await figma.variables.getLocalVariableCollectionsAsync();
        for (const col of collections) {
            modeMap[col.id] = {};
            for (const m of col.modes)
                modeMap[col.id][m.modeId] = m.name;
        }
        for (const v of localVars) {
            const enriched = {};
            const raw = v.valuesByMode || {};
            const colId = v.variableCollectionId || "";
            for (const [modeId, value] of Object.entries(raw)) {
                const modeName = ((_a = modeMap[colId]) === null || _a === void 0 ? void 0 : _a[modeId]) || modeId;
                if (value && typeof value === "object" && "r" in value) {
                    enriched[modeName] = { raw: value, hex: rgbToHex(value.r, value.g, value.b), css: rgbaToCSS(value.r, value.g, value.b, value.a || 1) };
                }
                else {
                    enriched[modeName] = { raw: value };
                }
            }
            vars.push({ id: v.id, name: v.name, resolvedType: v.resolvedType, valuesByMode: enriched, scopes: v.scopes || [], description: v.description || "", remote: v.remote || false });
        }
    }
    catch (e) { }
    return vars;
}
async function extractAllStyles() {
    var _a;
    const styles = [];
    try {
        const paintStyles = await figma.getLocalPaintStylesAsync();
        const textStyles = await figma.getLocalTextStylesAsync();
        const effectStyles = await figma.getLocalEffectStylesAsync();
        const gridStyles = await figma.getLocalGridStylesAsync();
        for (const s of paintStyles) {
            const paints = s.paints && s.paints.length > 0 ? extractFills(s.paints) : undefined;
            styles.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", paints, remote: s.remote || false });
        }
        for (const s of textStyles) {
            styles.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", fontSize: s.fontSize, fontFamily: ((_a = s.fontName) === null || _a === void 0 ? void 0 : _a.family) || undefined, fontWeight: s.fontWeight || undefined, lineHeight: s.lineHeight && typeof s.lineHeight === "object" && "value" in s.lineHeight ? { value: s.lineHeight.value, unit: s.lineHeight.unit } : null, remote: s.remote || false });
        }
        for (const s of effectStyles) {
            styles.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", remote: s.remote || false });
        }
        for (const s of gridStyles) {
            styles.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", remote: s.remote || false });
        }
    }
    catch (e) { }
    return styles;
}
function extractAllComponents() {
    const components = [];
    for (const page of figma.root.children) {
        walkPageForComponents(page, page.name, components);
    }
    return components;
}
function walkPageForComponents(node, pageName, result) {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
        try {
            const sc = node;
            let variantProps = null;
            if (node.type === "COMPONENT_SET") {
                const rawProps = node.variantGroupProperties || node.variantProperties;
                if (rawProps && typeof rawProps === "object") {
                    variantProps = {};
                    for (const k of Object.keys(rawProps))
                        variantProps[k] = rawProps[k];
                }
            }
            result.push({
                id: node.id, name: node.name, key: node.key || "",
                description: node.description || "",
                type: node.type, pageName: pageName,
                hasVariants: node.type === "COMPONENT_SET", variantProperties: variantProps,
                width: Math.round(sc.width * 100) / 100, height: Math.round(sc.height * 100) / 100,
                childCount: "children" in node ? node.children.length : 0
            });
        }
        catch (e) { }
    }
    if ("children" in node) {
        for (const child of node.children) {
            walkPageForComponents(child, pageName, result);
        }
    }
}
function extractPages() {
    const pages = [];
    for (const page of figma.root.children) {
        pages.push({
            id: page.id, name: page.name, nodeCount: flatten(page).length,
            background: typeof page.backgrounds !== "undefined" && page.backgrounds.length > 0 ? JSON.parse(JSON.stringify(page.backgrounds[0])) : null,
            topLevelFrames: (page.children || []).map((c) => ({ id: c.id, name: c.name, width: Math.round(c.width * 100) / 100, height: Math.round(c.height * 100) / 100, childCount: "children" in c ? c.children.length : 0 }))
        });
    }
    return pages;
}
async function buildFullExtract(onProgress) {
    const page = figma.currentPage;
    const total = 4;
    const rpt = (step, label, detail) => { if (onProgress)
        onProgress({ step, totalSteps: total, label, detail }); };
    rpt(0, "Starting", "Scanning...");
    const texts = flatten(page, (n) => n.type === "TEXT").map(n => extractText(n));
    rpt(1, "Text extracted", `${texts.length} text nodes`);
    const [vars, styles] = await Promise.all([extractAllVariables(), extractAllStyles()]);
    rpt(2, "Variables & Styles", `${vars.length} vars, ${styles.length} styles`);
    const comps = extractAllComponents();
    const pagess = extractPages();
    const hierarchy = buildHierarchy(page);
    rpt(3, "Components & Pages", `${comps.length} components, ${pagess.length} pages`);
    const byType = {};
    let totalNodes = 0, framesC = 0, compsC = 0, instancesC = 0;
    function wc(n) {
        if ("children" in n)
            for (const c of n.children) {
                totalNodes++;
                const t = c.type;
                byType[t] = (byType[t] || 0) + 1;
                if (t === "FRAME" || t === "SECTION")
                    framesC++;
                if (t === "COMPONENT" || t === "COMPONENT_SET")
                    compsC++;
                if (t === "INSTANCE")
                    instancesC++;
                wc(c);
            }
    }
    wc(page);
    rpt(4, "Complete", `${texts.length} texts, ${comps.length} comps`);
    return {
        meta: { fileName: figma.root.name || "Untitled", extractDate: new Date().toISOString(), pluginVersion: PLUGIN_VERSION, totalPages: figma.root.children.length, extractionScope: "current page" },
        pages: pagess, textNodes: texts, variables: vars, styles, components: comps,
        nodeCounts: { total: totalNodes, textNodes: texts.length, frames: framesC, components: compsC, instances: instancesC, byType },
        hierarchy
    };
}
async function exportNodes(nodeIds, format, scale) {
    const results = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || node.type === "PAGE" || node.type === "DOCUMENT")
            continue;
        const sn = node;
        try {
            let bytes;
            switch (format) {
                case "SVG":
                    bytes = await sn.exportAsync({ format: "SVG" });
                    break;
                case "PNG":
                    bytes = await sn.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
                    break;
                case "JPG":
                    bytes = await sn.exportAsync({ format: "JPG", constraint: { type: "SCALE", value: scale } });
                    break;
                case "PDF":
                    bytes = await sn.exportAsync({ format: "PDF" });
                    break;
                default: continue;
            }
            results.push({ id: node.id, name: sanitizeName(node.name), format: format.toLowerCase(), bytes: Array.from(bytes) });
        }
        catch (err) {
            console.error("export failed:", err.message);
        }
    }
    return results;
}
async function exportNodeAsSVGString(nodeId) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT")
        return null;
    try {
        const svgString = await node.exportAsync({ format: "SVG_STRING" });
        return { id: node.id, name: sanitizeName(node.name), svg: svgString };
    }
    catch (e) {
        return null;
    }
}
async function exportAllSVGs(pageNode, onSVG) {
    const nodes = flatten(pageNode).filter(isExportable);
    const svgs = [];
    for (let i = 0; i < nodes.length; i += 10) {
        const batch = nodes.slice(i, i + 10);
        const promises = batch.map(n => exportNodeAsSVGEmbedded(n.id));
        const results = await Promise.all(promises);
        for (const r of results) {
            if (r) {
                svgs.push(r);
                if (onSVG)
                    onSVG(r);
            }
        }
    }
    return svgs;
}
async function exportNodeAsSVGEmbedded(nodeId) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT")
        return null;
    const sn = node;
    try {
        const svgString = await sn.exportAsync({ format: "SVG_STRING" });
        if (!svgString || svgString.length < 10)
            return null;
        return { nodeId: node.id, nodeName: sanitizeName(node.name), nodeType: node.type, pageName: getPageName(node), parentPath: getParentPath(node), width: Math.round(sn.width * 100) / 100, height: Math.round(sn.height * 100) / 100, svg: svgString };
    }
    catch (e) {
        return null;
    }
}
async function buildLottieBundle(nodeIds) {
    const items = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || node.type === "PAGE" || node.type === "DOCUMENT")
            continue;
        try {
            const svgString = await node.exportAsync({ format: "SVG_STRING" });
            items.push({ id: node.id, name: sanitizeName(node.name), type: node.type, pageName: getPageName(node), width: node.width, height: node.height, svg: svgString });
        }
        catch (e) { }
    }
    return { fileName: `${sanitizeName(figma.root.name)}_lottie.json`, exportDate: new Date().toISOString(), source: figma.root.name || "Untitled", items };
}
function summarizeLottieImport(fileName, content) {
    try {
        const parsed = JSON.parse(content);
        const keys = parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
        const layers = Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.layers) ? parsed.layers.length : 0;
        return { fileName, valid: true, topLevelKeys: keys, layerCount: layers, warning: layers === 0 ? "No layers array found" : "Imported" };
    }
    catch (e) {
        return { fileName, valid: false, topLevelKeys: [], layerCount: 0, warning: "Not valid JSON" };
    }
}
function buildPlainText(textNodes) {
    const lines = [];
    lines.push("════ TEXT EXTRACTION — " + (figma.root.name || "Untitled"));
    lines.push("  " + new Date().toISOString());
    lines.push("════");
    lines.push("");
    for (const t of textNodes) {
        lines.push("── " + t.name + " ──");
        lines.push("  Page:     " + t.pageName);
        lines.push("  Parent:   " + t.parentPath);
        lines.push("  Font:     " + t.fontFamily + " " + t.fontStyle + " " + t.fontSize + "px");
        lines.push("  Color:    " + (t.fills.length > 0 ? t.fills[0].hex : "none"));
        lines.push("  Position: (" + t.absoluteX + "," + t.absoluteY + ") " + t.width + "x" + t.height);
        const safe = t.characters.replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{27BF}\u{0080}-\u{009F}]/gu, "[icon]");
        lines.push("  Text:     " + safe);
        lines.push("");
    }
    lines.push("── END (" + textNodes.length + " text nodes) ──");
    return lines.join("\n");
}
figma.showUI(__html__, { width: 520, height: 680, title: "Extract All — Figma to Anything" });
let cancelRequested = false;
function postSel() { figma.ui.postMessage({ type: "selection-state", count: figma.currentPage.selection.length, pageName: figma.currentPage.name }); }
figma.on("selectionchange", postSel);
figma.on("currentpagechange", postSel);
postSel();
figma.ui.onmessage = async (msg) => {
    cancelRequested = false;
    if (msg.type === "get-full-extract") {
        const data = await buildFullExtract((p) => { figma.ui.postMessage({ type: "full-extract-progress", progress: p }); });
        if (cancelRequested) {
            figma.ui.postMessage({ type: "error", message: "Cancelled" });
            return;
        }
        figma.ui.postMessage({ type: "full-extract", data: {
                textNodes: data.textNodes.length, variables: data.variables.length, styles: data.styles.length,
                components: data.components.length, totalNodes: data.nodeCounts.total
            } });
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_full-extract.json`, content: JSON.stringify(data, null, 2), mimeType: "application/json" });
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_text.txt`, content: buildPlainText(data.textNodes), mimeType: "text/plain" });
    }
    if (msg.type === "get-text") {
        const tn = flatten(figma.currentPage, (n) => n.type === "TEXT").map(n => extractText(n));
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_text.json`, content: JSON.stringify(tn, null, 2), mimeType: "application/json" });
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_text.txt`, content: buildPlainText(tn), mimeType: "text/plain" });
    }
    if (msg.type === "get-variables") {
        const v = await extractAllVariables();
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_variables.json`, content: JSON.stringify(v, null, 2), mimeType: "application/json" });
    }
    if (msg.type === "get-styles") {
        const s = await extractAllStyles();
        figma.ui.postMessage({ type: "download-file", fileName: `${sanitizeName(figma.root.name)}_styles.json`, content: JSON.stringify(s, null, 2), mimeType: "application/json" });
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
        else
            figma.ui.postMessage({ type: "error", message: "Export failed" });
    }
    if (msg.type === "get-svg-as-text") {
        const sel = figma.currentPage.selection;
        if (sel.length === 0) {
            figma.ui.postMessage({ type: "error", message: "No nodes selected" });
            return;
        }
        for (const node of sel) {
            const r = await exportNodeAsSVGString(node.id);
            if (r)
                figma.ui.postMessage({ type: "download-file", fileName: `${r.name}.svg`, content: r.svg, mimeType: "image/svg+xml" });
        }
    }
    if (msg.type === "export-lottie-json") {
        const sel = figma.currentPage.selection;
        if (sel.length === 0) {
            figma.ui.postMessage({ type: "error", message: "No nodes selected" });
            return;
        }
        const bundle = await buildLottieBundle(sel.map((n) => n.id));
        figma.ui.postMessage({ type: "download-file", fileName: bundle.fileName, content: JSON.stringify(bundle, null, 2), mimeType: "application/json" });
    }
    if (msg.type === "import-lottie-json") {
        figma.ui.postMessage({ type: "lottie-import-summary", summary: summarizeLottieImport(msg.fileName || "lottie.json", String(msg.content || "")) });
    }
    if (msg.type === "export-all-svg-page" || msg.type === "export-all-png-page") {
        const fmt = msg.type === "export-all-svg-page" ? "SVG" : "PNG";
        const sc = fmt === "SVG" ? (msg.scale || 1) : (msg.scale || 2);
        const nodes = flatten(figma.currentPage).filter(isExportable);
        await batchExportNodes(nodes, fmt, sc, false);
        if (!cancelRequested)
            figma.ui.postMessage({ type: "export-complete" });
    }
    if (msg.type === "export-all-svg-all-pages" || msg.type === "export-all-png-all-pages") {
        const fmt = msg.type === "export-all-svg-all-pages" ? "SVG" : "PNG";
        const sc = fmt === "SVG" ? (msg.scale || 1) : (msg.scale || 2);
        let totalNodes = 0, procNodes = 0;
        for (const pg of figma.root.children) {
            const nodes = flatten(pg).filter(isExportable);
            totalNodes += nodes.length;
            for (let i = 0; i < nodes.length; i += 20) {
                if (cancelRequested)
                    break;
                const batch = nodes.slice(i, i + 20).map(n => n.id);
                const results = await exportNodes(batch, fmt, sc);
                for (const r of results)
                    r.name = sanitizeName(pg.name) + "/" + r.name;
                if (results.length > 0)
                    figma.ui.postMessage({ type: "export-results", results });
                procNodes += batch.length;
                figma.ui.postMessage({ type: "progress", current: Math.min(procNodes, totalNodes), total: totalNodes, label: `${fmt} all pages` });
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
async function batchExportNodes(nodes, format, scale, isAllPages) {
    for (let i = 0; i < nodes.length; i += 20) {
        if (cancelRequested)
            return;
        const batch = nodes.slice(i, i + 20).map(n => n.id);
        const results = await exportNodes(batch, format, scale);
        if (results.length > 0)
            figma.ui.postMessage({ type: "export-results", results });
        figma.ui.postMessage({ type: "progress", current: Math.min(i + 20, nodes.length), total: nodes.length, label: `${format} export` });
    }
}
