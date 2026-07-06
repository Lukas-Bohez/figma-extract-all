"use strict";
const PLUGIN_VERSION = "17.0.0";
const TE = { encode: (s) => { const r = new Uint8Array(s.length); for (let i = 0; i < s.length; i++)
        r[i] = s.charCodeAt(i) & 0xFF; return r; } };
const CRC_TABLE = ((() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++)
        c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
} return t; }))();
function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++)
    c = CRC_TABLE[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) { const locals = [], cdirs = []; let off = 0; for (const f of files) {
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
} const cdOff = off; const cdSz = cdirs.reduce((s, a) => s + a.length, 0); const eocd = new Uint8Array(22); new DataView(eocd.buffer).setUint32(0, 0x06054b50, true); new DataView(eocd.buffer).setUint16(8, files.length, true); new DataView(eocd.buffer).setUint16(10, files.length, true); new DataView(eocd.buffer).setUint32(12, cdSz, true); new DataView(eocd.buffer).setUint32(16, cdOff, true); const total = off + cdSz + 22; const result = new Uint8Array(total); let pos = 0; for (const p of locals) {
    result.set(p, pos);
    pos += p.length;
} for (const p of cdirs) {
    result.set(p, pos);
    pos += p.length;
} result.set(eocd, pos); return result; }
function analyzeLottieFile(fileName, content) {
    const a = { fileName, valid: false, errors: [], meta: { frameRate: 0, inPoint: 0, outPoint: 0, width: 0, height: 0, duration: 0 }, stats: { layers: 0, shapes: 0, paths: 0, images: 0, texts: 0, solids: 0, nulls: 0, precomps: 0 }, assets: [], expressions: [], markers: [], warnings: [], layerTree: [], layerTreeRaw: [], bodymovinSettings: { includeAssets: false, includeKeyframes: false, includeExpressions: false, hiddenLayers: false, compressedJson: true, settingsOK: false }, hasKeyframes: false, hasAssets: false, totalFrames: 0 };
    let json;
    try {
        json = JSON.parse(content);
        a.valid = true;
    }
    catch (e) {
        a.errors.push("Invalid JSON");
        return a;
    }
    if (!json) {
        a.errors.push("Empty file");
        return a;
    }
    a.meta.frameRate = json.fr || 0;
    a.meta.inPoint = json.ip || 0;
    a.meta.outPoint = json.op || 0;
    a.meta.width = json.w || 0;
    a.meta.height = json.h || 0;
    a.meta.duration = a.meta.frameRate > 0 ? (a.meta.outPoint - a.meta.inPoint) / a.meta.frameRate : 0;
    a.totalFrames = a.meta.outPoint - a.meta.inPoint;
    return a;
}
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
function deepFlatten(roots) { const r = []; function w(n) { if (n.type !== "PAGE")
    r.push(n); if ("children" in n)
    for (const c of n.children)
        w(c); } for (const ro of roots)
    w(ro); return r; }
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
function extractText(node) { let lh = null; const l = node.lineHeight; if (l !== figma.mixed && typeof l === "object" && "value" in l)
    lh = { value: l.value, unit: l.unit || "PIXELS" }; let ls = null; const s = node.letterSpacing; if (s !== figma.mixed && typeof s === "object" && "value" in s)
    ls = { value: s.value, unit: s.unit || "PIXELS" }; const ap = getAbsolutePos(node); return { id: node.id, name: node.name, characters: node.characters, pageName: getPageName(node), parentPath: getParentPath(node), parentFrame: (() => { let c = node.parent || null; while (c) {
        if (["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION"].includes(c.type))
            return c.name;
        c = c.parent || null;
    } return "(no frame)"; })(), absoluteX: Math.round(ap.x * 100) / 100, absoluteY: Math.round(ap.y * 100) / 100, width: Math.round(node.width * 100) / 100, height: Math.round(node.height * 100) / 100, x: Math.round(node.x * 100) / 100, y: Math.round(node.y * 100) / 100, fontFamily: node.fontName !== figma.mixed && typeof node.fontName === "object" ? node.fontName.family : "unknown", fontStyle: node.fontName !== figma.mixed && typeof node.fontName === "object" ? node.fontName.style : "Regular", fontSize: typeof node.fontSize === "number" ? node.fontSize : 0, fontWeight: typeof node.fontWeight === "number" ? node.fontWeight : 400, lineHeight: lh, letterSpacing: ls, textAlignHorizontal: node.textAlignHorizontal, textAlignVertical: node.textAlignVertical, fills: extractFills(node.fills), opacity: Math.round(node.opacity * 100) / 100 }; }
function extractAllComponents() { const c = []; for (const p of figma.root.children)
    wc(p, p.name, c); return c; }
function wc(node, pn, r) { if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
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
} if ("children" in node)
    for (const ch of node.children)
        wc(ch, pn, r); }
function extractPages() { const p = []; for (const pg of figma.root.children)
    p.push({ id: pg.id, name: pg.name, nodeCount: deepFlatten([pg]).length, background: typeof pg.backgrounds !== "undefined" && pg.backgrounds.length > 0 ? JSON.parse(JSON.stringify(pg.backgrounds[0])) : null, topLevelFrames: (pg.children || []).map((c) => ({ id: c.id, name: c.name, width: Math.round(c.width * 100) / 100, height: Math.round(c.height * 100) / 100, childCount: "children" in c ? c.children.length : 0 })) }); return p; }
function buildHierarchy(root) { const n = []; if ("children" in root)
    for (const c of root.children) {
        const sc = c;
        const node = { id: sc.id, name: sc.name, type: sc.type, childCount: "children" in sc ? sc.children.length : 0, children: [] };
        if ("children" in sc)
            node.children = buildHierarchy(sc);
        n.push(node);
    } return n; }
function buildPlainText(texts) { const l = [`════ TEXT — ${figma.root.name || "Untitled"}`, `  ${new Date().toISOString()}`, `════`, ` `]; for (const t of texts) {
    l.push(`── ${t.name} ──`, `  Page: ${t.pageName}`, `  Parent: ${t.parentPath}`, `  Font: ${t.fontFamily} ${t.fontStyle} ${t.fontSize}px`, `  Color: ${t.fills.length > 0 ? t.fills[0].hex : "none"}`, `  Position: (${t.absoluteX},${t.absoluteY}) ${t.width}×${t.height}`, `  Text: ${t.characters.replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{27BF}\u{0080}-\u{009F}]/gu, "[icon]")}`, ` `);
} l.push(`── END (${texts.length} texts) ──`); return l.join("\n"); }
function buildFullExtractSync(onProgress) {
    const scope = getScope();
    const rpt = (s, l, d) => { if (onProgress)
        onProgress({ step: s, totalSteps: 3, label: l, detail: d }); };
    rpt(0, "Starting", "Scanning");
    const nodes = deepFlatten(scope.roots);
    rpt(1, "Text", `${nodes.filter(n => n.type === "TEXT").length} texts`);
    const texts = [];
    for (const n of nodes) {
        if (n.type === "TEXT")
            texts.push(extractText(n));
    }
    const comps = extractAllComponents();
    const pages = extractPages();
    const hierarchy = buildHierarchy(scope.roots[0]);
    rpt(2, "Components", `${comps.length} comps`);
    const byType = {};
    let tN = 0;
    function cn(n) { if ("children" in n)
        for (const c of n.children) {
            tN++;
            byType[c.type] = (byType[c.type] || 0) + 1;
            cn(c);
        } }
    for (const r of scope.roots)
        cn(r);
    rpt(3, "Done", `${texts.length} texts`);
    return { meta: { fileName: figma.root.name || "Untitled", extractDate: new Date().toISOString(), pluginVersion: PLUGIN_VERSION, totalPages: figma.root.children.length, extractionScope: "scoped", scopeDescription: scope.desc }, pages, textNodes: texts, variables: [], styles: [], components: comps, nodeCounts: { total: tN, textNodes: texts.length, frames: 0, components: 0, instances: 0, byType }, hierarchy };
}
let zipFiles = [];
function addToZip(n, c) { if (typeof c === "string")
    zipFiles.push({ name: n, data: TE.encode(c) });
else
    zipFiles.push({ name: n, data: c }); }
function flushZipChunked(fb) { if (zipFiles.length === 0)
    return; const zip = makeZip(zipFiles); zipFiles = []; const CH = 400000; const t = Math.ceil(zip.length / CH); const zn = `${sanitizeName(fb)}_extract.zip`; for (let i = 0; i < t; i++) {
    const s = i * CH, e = Math.min(s + CH, zip.length);
    figma.ui.postMessage({ type: "zip-chunk", fileName: zn, index: i, total: t, bytes: Array.from(zip.slice(s, e)) });
} }
function downloadFile(fn, ct, m) { figma.ui.postMessage({ type: "download-file", fileName: fn, content: ct, mimeType: m }); }
async function fetchAndSendVars() { var _a; try {
    const lv = await figma.variables.getLocalVariablesAsync();
    const vars = [];
    let mm = {};
    try {
        const c = await figma.variables.getLocalVariableCollectionsAsync();
        for (const col of c || []) {
            mm[col.id] = {};
            for (const m of col.modes)
                mm[col.id][m.modeId] = m.name;
        }
    }
    catch (e) { }
    for (const v of lv || []) {
        const en = {};
        const raw = v.valuesByMode || {};
        const ci = v.variableCollectionId || "";
        for (const [mi, val] of Object.entries(raw)) {
            const mn = ((_a = mm[ci]) === null || _a === void 0 ? void 0 : _a[mi]) || mi;
            if (val && typeof val === "object" && "r" in val)
                en[mn] = { raw: val, hex: rgbToHex(val.r, val.g, val.b), css: "" };
            else
                en[mn] = { raw: val };
        }
        vars.push({ id: v.id, name: v.name, resolvedType: v.resolvedType, valuesByMode: en, scopes: v.scopes || [], description: v.description || "", remote: v.remote || false });
    }
    addToZip(`${sanitizeName(figma.root.name)}_variables.json`, JSON.stringify(vars, null, 2));
}
catch (e) { } }
async function fetchAndSendStyles() { var _a, _b; try {
    const ss = [];
    const ps = await figma.getLocalPaintStylesAsync();
    for (const s of ps || []) {
        ss.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", paints: s.paints && s.paints.length > 0 ? extractFills(s.paints) : undefined, remote: s.remote || false });
    }
    const ts = await figma.getLocalTextStylesAsync();
    for (const s of ts || []) {
        ss.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", fontSize: s.fontSize, fontFamily: ((_a = s.fontName) === null || _a === void 0 ? void 0 : _a.family) || undefined, fontWeight: ((_b = s.fontName) === null || _b === void 0 ? void 0 : _b.style) || undefined, lineHeight: s.lineHeight && typeof s.lineHeight === "object" && "value" in s.lineHeight ? { value: s.lineHeight.value, unit: s.lineHeight.unit || "PIXELS" } : null, remote: s.remote || false });
    }
    const es = await figma.getLocalEffectStylesAsync();
    for (const s of es || []) {
        ss.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", remote: s.remote || false });
    }
    const gs = await figma.getLocalGridStylesAsync();
    for (const s of gs || []) {
        ss.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", remote: s.remote || false });
    }
    addToZip(`${sanitizeName(figma.root.name)}_styles.json`, JSON.stringify(ss, null, 2));
}
catch (e) { } }
async function exportNodeSVG(nodeId) { const n = await figma.getNodeByIdAsync(nodeId); if (!n)
    return null; const sn = n; try {
    const s = await sn.exportAsync({ format: "SVG_STRING" });
    if (!s || s.length < 10)
        return null;
    return { name: `svgs/${sanitizeName(getPageName(n))}/${sanitizeName(n.name)}.svg`, data: TE.encode(s) };
}
catch (e) {
    return null;
} }
async function exportNodes(nodeIds, format, scale) { const r = []; for (const id of nodeIds) {
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
} return r; }
async function buildLottieBundle(roots) { const allNodes = deepFlatten(roots); const items = []; for (const n of allNodes) {
    if (n.type === "PAGE")
        continue;
    try {
        const s = await n.exportAsync({ format: "SVG_STRING" });
        if (s && s.length > 10)
            items.push({ id: n.id, name: sanitizeName(n.name), type: n.type, pageName: getPageName(n), width: n.width, height: n.height, svg: s });
    }
    catch (e) { }
} return { fileName: `${sanitizeName(figma.root.name)}_lottie.json`, exportDate: new Date().toISOString(), source: figma.root.name || "Untitled", itemCount: items.length, items }; }
figma.showUI(__html__, { width: 520, height: 700, title: "Extract All" });
let cancelRequested = false;
function postSel() { figma.ui.postMessage({ type: "selection-state", count: figma.currentPage.selection.length, pageName: figma.currentPage.name }); }
figma.on("selectionchange", postSel);
figma.on("currentpagechange", postSel);
postSel();
let lastAnalysis = null;
figma.ui.onmessage = async (msg) => {
    cancelRequested = false;
    zipFiles = [];
    const scope = getScope();
    const baseName = figma.root.name || "Untitled";
    if (msg.type === "import-lottie-json") {
        lastAnalysis = analyzeLottieFile(msg.fileName || "lottie.json", String(msg.content || ""));
        figma.ui.postMessage({ type: "lottie-analysis", analysis: lastAnalysis, rawJson: String(msg.content || "") });
    }
    if (msg.type === "lottie-gif-rendered") {
        try {
            const bytes = new Uint8Array(msg.bytes);
            const image = figma.createImage(bytes);
            const rect = figma.createRectangle();
            rect.resize(msg.width, msg.height);
            rect.name = (msg.fileName ? sanitizeName(msg.fileName.replace(/\.json$/, '')) + ' (Lottie GIF)' : 'Lottie Animation');
            rect.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];
            const center = figma.viewport.center;
            rect.x = Math.round(center.x - msg.width / 2);
            rect.y = Math.round(center.y - msg.height / 2);
            figma.currentPage.appendChild(rect);
            figma.viewport.scrollAndZoomIntoView([rect]);
            figma.ui.postMessage({ type: "animation-placed", name: rect.name, x: rect.x, y: rect.y });
        }
        catch (e) {
            figma.ui.postMessage({ type: "error", message: "Failed to place GIF: " + e.message });
        }
    }
    if (msg.type === "get-full-extract" && !msg.aeOpts && !msg.aiOpts) {
        const data = buildFullExtractSync((p) => { figma.ui.postMessage({ type: "full-extract-progress", progress: p }); });
        if (cancelRequested)
            return;
        downloadFile(`${sanitizeName(baseName)}_full-extract.json`, JSON.stringify(data, null, 2), "application/json");
        downloadFile(`${sanitizeName(baseName)}_text.txt`, buildPlainText(data.textNodes), "text/plain");
        figma.ui.postMessage({ type: "full-extract", data: { textNodes: data.textNodes.length, variables: 0, styles: 0, components: data.components.length, totalNodes: data.nodeCounts.total, scope: data.meta.scopeDescription } });
    }
    if (msg.type === "get-full-extract" && msg.aeOpts) {
        const data = buildFullExtractSync((p) => { figma.ui.postMessage({ type: "full-extract-progress", progress: p }); });
        if (cancelRequested)
            return;
        addToZip(`${sanitizeName(baseName)}_full-extract.json`, JSON.stringify(data, null, 2));
        addToZip(`${sanitizeName(baseName)}_text.txt`, buildPlainText(data.textNodes));
        fetchAndSendVars();
        fetchAndSendStyles();
        if (msg.aeOpts.includeSVGs && !cancelRequested) {
            const an = deepFlatten(scope.roots).filter(n => n.type !== "TEXT" && n.type !== "PAGE" && isVisible(n));
            for (let i = 0; i < an.length; i += 4) {
                if (cancelRequested)
                    break;
                const br = await Promise.all(an.slice(i, i + 4).map(n => exportNodeSVG(n.id)));
                for (const r of br) {
                    if (r)
                        zipFiles.push(r);
                }
                figma.ui.postMessage({ type: "progress", current: Math.min(i + 4, an.length), total: an.length, label: "SVGs" });
            }
        }
        if (msg.aeOpts.includeLottie && !cancelRequested) {
            const bundle = await buildLottieBundle(scope.roots);
            addToZip(bundle.fileName, JSON.stringify(bundle, null, 2));
        }
        addToZip(`${sanitizeName(baseName)}_variables.json`, "[]");
        addToZip(`${sanitizeName(baseName)}_styles.json`, "[]");
        figma.ui.postMessage({ type: "full-extract", data: { textNodes: data.textNodes.length, variables: 0, styles: 0, components: data.components.length, totalNodes: data.nodeCounts.total, scope: data.meta.scopeDescription } });
        flushZipChunked(baseName);
    }
    if (msg.type === "get-full-extract" && msg.aiOpts) {
        const data = buildFullExtractSync((p) => { figma.ui.postMessage({ type: "full-extract-progress", progress: p }); });
        if (cancelRequested)
            return;
        addToZip(`${sanitizeName(baseName)}_full-extract.json`, JSON.stringify(data, null, 2));
        addToZip(`${sanitizeName(baseName)}_text.txt`, buildPlainText(data.textNodes));
        fetchAndSendVars();
        fetchAndSendStyles();
        if (msg.aiOpts.includeSVGs && !cancelRequested) {
            const an = deepFlatten(scope.roots).filter(n => n.type !== "TEXT" && n.type !== "PAGE" && isVisible(n));
            for (let i = 0; i < an.length; i += 4) {
                if (cancelRequested)
                    break;
                const br = await Promise.all(an.slice(i, i + 4).map(n => exportNodeSVG(n.id)));
                for (const r of br) {
                    if (r)
                        zipFiles.push(r);
                }
                figma.ui.postMessage({ type: "progress", current: Math.min(i + 4, an.length), total: an.length, label: "SVGs" });
            }
        }
        figma.ui.postMessage({ type: "full-extract", data: { textNodes: data.textNodes.length, variables: 0, styles: 0, components: data.components.length, totalNodes: data.nodeCounts.total, scope: data.meta.scopeDescription } });
        flushZipChunked(baseName);
    }
    if (msg.type === "get-text") {
        const nodes = deepFlatten(scope.roots);
        const tn = nodes.filter(n => n.type === "TEXT").map(n => extractText(n));
        downloadFile(`${sanitizeName(baseName)}_text.json`, JSON.stringify(tn, null, 2), "application/json");
        downloadFile(`${sanitizeName(baseName)}_text.txt`, buildPlainText(tn), "text/plain");
    }
    if (msg.type === "get-variables") {
        addToZip(`${sanitizeName(baseName)}_variables.json`, "");
        fetchAndSendVars();
        flushZipChunked(baseName + "_variables");
    }
    if (msg.type === "get-styles") {
        addToZip(`${sanitizeName(baseName)}_styles.json`, "");
        fetchAndSendStyles();
        flushZipChunked(baseName + "_styles");
    }
    if (msg.type === "get-components") {
        addToZip(`${sanitizeName(baseName)}_components.json`, JSON.stringify(extractAllComponents(), null, 2));
        flushZipChunked(baseName + "_components");
    }
    if (msg.type === "get-pages") {
        addToZip(`${sanitizeName(baseName)}_pages.json`, JSON.stringify(extractPages(), null, 2));
        flushZipChunked(baseName + "_pages");
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
        if (results.length <= 3) {
            if (results.length > 0)
                figma.ui.postMessage({ type: "export-results", results });
        }
        else {
            for (const x of results)
                addToZip(`${x.name}.${x.format.toLowerCase()}`, new Uint8Array(x.bytes));
            flushZipChunked(baseName + "_selected");
        }
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
                downloadFile(`${sanitizeName(node.name)}.svg`, s, "image/svg+xml");
        }
    }
    if (msg.type === "export-lottie-json") {
        const bundle = await buildLottieBundle(scope.roots);
        downloadFile(bundle.fileName, JSON.stringify(bundle, null, 2), "application/json");
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
                const batch = ns.slice(i, i + 20).map((n) => n.id);
                const r = await exportNodes(batch, fmt, sc);
                for (const x of r) {
                    const ext = fmt.toLowerCase();
                    const fname = pages.length > 1 ? `${sanitizeName(pg.name)}/${x.name}.${ext}` : `${x.name}.${ext}`;
                    zipFiles.push({ name: fname, data: new Uint8Array(x.bytes) });
                }
                pN += batch.length;
                figma.ui.postMessage({ type: "progress", current: Math.min(pN, tN), total: tN, label: fmt });
            }
        }
        if (!cancelRequested) {
            flushZipChunked(baseName + "_batch");
            figma.ui.postMessage({ type: "export-complete" });
        }
    }
    if (msg.type === "cancel") {
        cancelRequested = true;
        zipFiles = [];
    }
    if (msg.type === "resize") {
        figma.ui.resize(msg.width, msg.height);
    }
    if (msg.type === "close") {
        figma.closePlugin();
    }
};
