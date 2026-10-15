"use strict";
const PLUGIN_VERSION = "19.1.0";
const TE = {
    encode: (s) => {
        const r = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++)
            r[i] = s.charCodeAt(i) & 0xff;
        return r;
    },
};
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c >>> 0;
    }
    return t;
})();
function crc32(d) {
    let c = 0xffffffff;
    for (let i = 0; i < d.length; i++)
        c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function makeZip(files) {
    const locals = [];
    const cdirs = [];
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
function rgbToHex(r, g, b) {
    const toHex = (v) => {
        const x = Math.round(Math.max(0, Math.min(1, v)) * 255);
        return x.toString(16).padStart(2, "0");
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function sanitizeName(n) {
    return n.replace(/[<>:"\/\\|?*\x00-\x1f]/g, "_").replace(/\.+$/, "").trim() || "unnamed";
}
function extractFills(f) {
    var _a, _b, _c, _d, _e;
    if (f === figma.mixed)
        return [];
    const r = [];
    for (const fi of f || []) {
        if (fi.type === "SOLID" && fi.color) {
            const opacity = (_a = fi.opacity) !== null && _a !== void 0 ? _a : 1;
            r.push({
                type: "SOLID",
                hex: rgbToHex(fi.color.r, fi.color.g, fi.color.b),
                rgba: { r: fi.color.r, g: fi.color.g, b: fi.color.b, a: opacity },
                opacity,
                visible: (_b = fi.visible) !== null && _b !== void 0 ? _b : true,
                blendMode: (_c = fi.blendMode) !== null && _c !== void 0 ? _c : "NORMAL",
                boundVariableId: ((_e = (_d = fi.boundVariables) === null || _d === void 0 ? void 0 : _d.color) === null || _e === void 0 ? void 0 : _e.id) || null,
            });
        }
    }
    return r;
}
function parseLineHeight(lh) {
    if (!lh || lh === figma.mixed)
        return null;
    if (typeof lh === "number")
        return { value: lh, unit: "PIXELS" };
    if (typeof lh === "object") {
        if ("value" in lh && typeof lh.value === "number")
            return { value: lh.value, unit: lh.unit || "PIXELS" };
        if ("fontSize" in lh && typeof lh.fontSize === "number")
            return { value: lh.fontSize, unit: "PERCENT" };
    }
    return null;
}
function parseLetterSpacing(ls) {
    if (!ls || ls === figma.mixed)
        return null;
    if (typeof ls === "number")
        return { value: ls, unit: "PIXELS" };
    if (typeof ls === "object" && "value" in ls && typeof ls.value === "number")
        return { value: ls.value, unit: ls.unit || "PIXELS" };
    return null;
}
function getNodeContext(node) {
    let pageName = "(unknown)";
    let parentFrame = "";
    let parentPath = "";
    let absoluteX = 0;
    let absoluteY = 0;
    try {
        const pathParts = [];
        let cur = node.parent || null;
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
            cur = cur.parent || null;
        }
        parentPath = pathParts.join(" > ");
        cur = node;
        while (cur && cur.type !== "PAGE") {
            if ("x" in cur && "y" in cur) {
                absoluteX += cur.x;
                absoluteY += cur.y;
            }
            cur = cur.parent || null;
        }
    }
    catch (e) {
    }
    return {
        pageName,
        parentPath,
        parentFrame,
        absoluteX: Math.round(absoluteX * 100) / 100,
        absoluteY: Math.round(absoluteY * 100) / 100,
    };
}
function extractText(node) {
    var _a, _b;
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
        fontFamily: (_a = fontName === null || fontName === void 0 ? void 0 : fontName.family) !== null && _a !== void 0 ? _a : "unknown",
        fontStyle: (_b = fontName === null || fontName === void 0 ? void 0 : fontName.style) !== null && _b !== void 0 ? _b : "Regular",
        fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
        fontWeight: typeof node.fontWeight === "number" ? node.fontWeight : 400,
        lineHeight: parseLineHeight(node.lineHeight),
        letterSpacing: parseLetterSpacing(node.letterSpacing),
        textAlignHorizontal: node.textAlignHorizontal,
        textAlignVertical: node.textAlignVertical,
        fills: extractFills(node.fills),
        opacity: Math.round(node.opacity * 100) / 100,
    };
}
function buildPlainText(texts) {
    const l = [`═══ TEXT — ${figma.root.name || "Untitled"}`, `  ${new Date().toISOString()}`, `═══`, ` `];
    for (const t of texts) {
        const fills = t.fills.map((f) => f.hex).join(", ") || "none";
        l.push(`── ${t.name} ──`, `  Page: ${t.pageName} | Frame: ${t.parentFrame || "(none)"}`, `  Font: ${t.fontFamily} ${t.fontStyle} ${t.fontSize}px`, `  Position: ${t.absoluteX}, ${t.absoluteY} | Size: ${t.width}×${t.height}`, `  Fills: ${fills}`, `  Text: ${t.characters.split("\n").join("↵")}`, ` `);
    }
    l.push(`── END (${texts.length} texts) ──`);
    return l.join("\n");
}
let zipFiles = [];
function addToZip(n, c) {
    if (typeof c === "string")
        zipFiles.push({ name: n, data: TE.encode(c) });
    else
        zipFiles.push({ name: n, data: c });
}
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64Encode(u8) {
    const out = [];
    const len = u8.length;
    for (let i = 0; i < len; i += 3) {
        const a = u8[i];
        const hasB = i + 1 < len;
        const hasC = i + 2 < len;
        const b = hasB ? u8[i + 1] : 0;
        const c = hasC ? u8[i + 2] : 0;
        const t = (a << 16) | (b << 8) | c;
        out.push(B64_CHARS[(t >> 18) & 63], B64_CHARS[(t >> 12) & 63], hasB ? B64_CHARS[(t >> 6) & 63] : "=", hasC ? B64_CHARS[t & 63] : "=");
    }
    return out.join("");
}
function flushZipChunked(fb) {
    if (zipFiles.length === 0)
        return;
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
function flushZipPart(fb, part) {
    if (zipFiles.length === 0)
        return;
    flushZipChunked(`${fb}_${part}`);
}
function downloadFile(fn, ct, m) {
    figma.ui.postMessage({ type: "download-file", fileName: fn, content: ct, mimeType: m });
}
async function fetchVars(baseName) {
    var _a, _b;
    try {
        const vars = [];
        const mm = {};
        const [lv, c] = await Promise.all([
            figma.variables.getLocalVariablesAsync().catch(() => null),
            figma.variables.getLocalVariableCollectionsAsync().catch(() => null),
        ]);
        if (c) {
            for (const col of c || []) {
                mm[col.id] = {};
                for (const m of col.modes)
                    mm[col.id][m.modeId] = m.name;
            }
        }
        if (lv) {
            for (const v of lv || []) {
                const en = {};
                const raw = v.valuesByMode || {};
                const ci = v.variableCollectionId || "";
                for (const [mi, val] of Object.entries(raw)) {
                    const mn = ((_a = mm[ci]) === null || _a === void 0 ? void 0 : _a[mi]) || mi;
                    const info = { raw: val };
                    if (v.resolvedType === "COLOR" && val && typeof val === "object" && "r" in val) {
                        const cval = val;
                        info.hex = rgbToHex(cval.r, cval.g, cval.b);
                        info.css = `rgba(${Math.round(cval.r * 255)}, ${Math.round(cval.g * 255)}, ${Math.round(cval.b * 255)}, ${(_b = cval.a) !== null && _b !== void 0 ? _b : 1})`;
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
                    remote: v.remote || false,
                });
            }
        }
        addToZip(`${baseName}_variables.json`, JSON.stringify(vars));
    }
    catch (e) {
        addToZip(`${baseName}_variables.json`, "[]");
    }
}
async function fetchStyles(baseName) {
    try {
        const ss = [];
        const [ps, ts, es, gs] = await Promise.all([
            figma.getLocalPaintStylesAsync().catch(() => []),
            figma.getLocalTextStylesAsync().catch(() => []),
            figma.getLocalEffectStylesAsync().catch(() => []),
            figma.getLocalGridStylesAsync().catch(() => []),
        ]);
        for (const s of ps || []) {
            ss.push({
                id: s.id,
                name: s.name,
                key: s.key,
                styleType: s.type,
                description: s.description || "",
                paints: s.paints && s.paints.length > 0 ? extractFills(s.paints) : undefined,
                remote: s.remote || false,
            });
        }
        for (const s of ts || []) {
            const fontName = s.fontName;
            ss.push({
                id: s.id,
                name: s.name,
                key: s.key,
                styleType: s.type,
                description: s.description || "",
                fontSize: s.fontSize,
                fontFamily: fontName === null || fontName === void 0 ? void 0 : fontName.family,
                fontWeight: fontName === null || fontName === void 0 ? void 0 : fontName.style,
                lineHeight: parseLineHeight(s.lineHeight),
                remote: s.remote || false,
            });
        }
        for (const s of es || []) {
            ss.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", remote: s.remote || false });
        }
        for (const s of gs || []) {
            ss.push({ id: s.id, name: s.name, key: s.key, styleType: s.type, description: s.description || "", remote: s.remote || false });
        }
        addToZip(`${baseName}_styles.json`, JSON.stringify(ss));
    }
    catch (e) {
        addToZip(`${baseName}_styles.json`, "[]");
    }
}
async function svgExport(nid, pageName) {
    try {
        const n = await figma.getNodeByIdAsync(nid);
        if (!n)
            return null;
        const s = await n.exportAsync({ format: "SVG_STRING" });
        if (!s || s.length < 10)
            return null;
        return { name: `svgs/${sanitizeName(pageName)}/${sanitizeName(n.name)}.svg`, data: TE.encode(s) };
    }
    catch (e) {
        return null;
    }
}
async function exportNodes(nodeIds, format, scale) {
    const r = [];
    for (const id of nodeIds) {
        const n = await figma.getNodeByIdAsync(id);
        if (!n)
            continue;
        try {
            let b;
            switch (format) {
                case "SVG":
                    b = await n.exportAsync({ format: "SVG" });
                    break;
                case "PNG":
                    b = await n.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
                    break;
                case "JPG":
                    b = await n.exportAsync({ format: "JPG", constraint: { type: "SCALE", value: scale } });
                    break;
                case "PDF":
                    b = await n.exportAsync({ format: "PDF" });
                    break;
                default:
                    continue;
            }
            r.push({ id: n.id, name: sanitizeName(n.name), format: format.toLowerCase(), bytes: Array.from(b) });
        }
        catch (e) {
        }
    }
    return r;
}
function analyzeLottieFile(fileName, content) {
    var _a, _b, _c, _d, _e, _f;
    const a = {
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
    let json;
    try {
        json = JSON.parse(content);
        a.valid = true;
    }
    catch (e) {
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
    if (a.meta.frameRate <= 0)
        a.warnings.push({ type: "metadata", message: "Frame rate missing or invalid", fix: "Re-export with Bodymovin using a valid composition frame rate." });
    if (a.meta.width <= 0 || a.meta.height <= 0)
        a.warnings.push({ type: "metadata", message: "Animation dimensions missing", fix: "Verify the Bodymovin export includes width and height." });
    const assets = Array.isArray(json.assets) ? json.assets : [];
    a.hasAssets = assets.length > 0;
    for (const asset of assets) {
        if (!asset || typeof asset !== "object")
            continue;
        const type = asset.layers ? "precomp" : asset.p ? "image" : "data";
        if (type === "precomp")
            a.stats.precomps++;
        if (type === "image")
            a.stats.images++;
        a.assets.push({
            id: String((_a = asset.id) !== null && _a !== void 0 ? _a : ""),
            type,
            name: String((_c = (_b = asset.nm) !== null && _b !== void 0 ? _b : asset.id) !== null && _c !== void 0 ? _c : ""),
            refId: asset.refId,
            width: asset.w,
            height: asset.h,
            embedded: type === "image" ? !asset.u && !asset.p : true,
        });
    }
    if (Array.isArray(json.markers)) {
        for (const m of json.markers) {
            if (m && typeof m === "object") {
                a.markers.push({ name: String((_d = m.cm) !== null && _d !== void 0 ? _d : ""), time: ((_e = m.tm) !== null && _e !== void 0 ? _e : 0) / (a.meta.frameRate || 1), duration: ((_f = m.dr) !== null && _f !== void 0 ? _f : 0) / (a.meta.frameRate || 1) });
            }
        }
    }
    const layers = Array.isArray(json.layers) ? json.layers : [];
    a.stats.layers = layers.length;
    a.layerTreeRaw = layers;
    const ICONS = { 0: "precomp", 1: "solid", 2: "image", 3: "null", 4: "shape", 5: "text" };
    function inspectLayer(layer, depth, parentList) {
        var _a;
        if (!layer || typeof layer !== "object")
            return;
        const ty = layer.ty;
        const hidden = layer.hd === true;
        const node = {
            type: ICONS[ty] || "unknown",
            name: String((_a = layer.nm) !== null && _a !== void 0 ? _a : "(unnamed)"),
            hidden,
            children: [],
        };
        parentList.push(node);
        if (hidden)
            a.bodymovinSettings.hiddenLayers = true;
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
        if (ty === 4 && Array.isArray(layer.shapes)) {
            for (const shape of layer.shapes)
                inspectShape(shape);
        }
        scanProperties(layer.ks);
        if (layer.ao)
            scanProperties(layer.ao);
        if (Array.isArray(layer.ef)) {
            for (const eff of layer.ef)
                scanProperties(eff);
        }
    }
    function inspectShape(shape) {
        if (!shape || typeof shape !== "object")
            return;
        const ty = shape.ty;
        if (ty === "gr" && Array.isArray(shape.it)) {
            for (const child of shape.it)
                inspectShape(child);
        }
        else if (ty === "sh") {
            a.stats.paths++;
        }
        else if (ty === "rc" || ty === "el" || ty === "sr") {
            a.stats.shapes++;
        }
        scanProperties(shape);
    }
    function scanProperties(obj) {
        if (!obj || typeof obj !== "object")
            return;
        if (Array.isArray(obj)) {
            for (const item of obj)
                scanProperties(item);
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
figma.showUI(__html__, { width: 520, height: 700, title: "Extract All" });
let cancelRequested = false;
function postSel() {
    figma.ui.postMessage({ type: "selection-state", count: figma.currentPage.selection.length, pageName: figma.currentPage.name });
}
figma.on("selectionchange", postSel);
figma.on("currentpagechange", postSel);
postSel();
let lastAnalysis = null;
let runningExtract = false;
figma.ui.onmessage = async (msg) => {
    if (isFeatureMessage(msg))
        return;
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
        }
        catch (e) {
            figma.ui.postMessage({ type: "error", message: "Failed to place GIF: " + e.message });
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
        let watchdog = null;
        const armWatchdog = () => {
            if (watchdog)
                clearTimeout(watchdog);
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
        }
        catch (e) {
            figma.ui.postMessage({ type: "error", message: "Page load failed: " + e.message });
            runningExtract = false;
            if (watchdog)
                clearTimeout(watchdog);
            return;
        }
        const sel = figma.currentPage.selection;
        const isScoped = sel.length > 0;
        const pgName = figma.currentPage.name;
        const aeOpts = msg.aeOpts;
        const aiOpts = msg.aiOpts;
        const opts = aeOpts || aiOpts;
        figma.ui.postMessage({ type: "full-extract-progress", progress: { step: 0, totalSteps: 3, label: "Scan", detail: "Collecting nodes…" } });
        let workingNodes;
        if (isScoped) {
            workingNodes = [];
            function walk(n, r) {
                if (n.type !== "PAGE")
                    r.push(n);
                if (n.children)
                    for (const c of n.children)
                        walk(c, r);
            }
            for (const s of sel)
                walk(s, workingNodes);
        }
        else {
            workingNodes = figma.currentPage.findAll(() => true);
        }
        if (cancelRequested) {
            workingNodes.length = 0;
            runningExtract = false;
            return;
        }
        const total = workingNodes.length;
        const texts = [];
        const comps = [];
        const byType = {};
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
                        texts.push(extractText(n));
                    }
                    catch (e) {
                    }
                }
                else if (t === "COMPONENT" || t === "COMPONENT_SET") {
                    try {
                        let vp = null;
                        if (t === "COMPONENT_SET") {
                            const rp = n.variantGroupProperties || n.variantProperties;
                            if (rp) {
                                vp = {};
                                for (const k of Object.keys(rp))
                                    vp[k] = rp[k];
                            }
                        }
                        comps.push({
                            id: n.id,
                            name: n.name,
                            key: n.key || "",
                            description: n.description || "",
                            type: t,
                            pageName: isScoped ? getNodeContext(n).pageName : pgName,
                            hasVariants: t === "COMPONENT_SET",
                            variantProperties: vp,
                            width: Math.round(n.width * 100) / 100,
                            height: Math.round(n.height * 100) / 100,
                            childCount: n.children ? n.children.length : 0,
                        });
                    }
                    catch (e) {
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
            const pages = [];
            for (const pg of figma.root.children) {
                const pgd = pg;
                const topFrames = (pgd.children || []).map((c) => ({
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
            const data = {
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
            if (tc.length < 65000)
                downloadFile(`${baseName}_text.txt`, tc, "text/plain");
            else
                addToZip(`${baseName}_text.txt`, tc);
            addToZip(`${baseName}_full-extract.json`, JSON.stringify(data));
            flushZipChunked(baseName);
            let svgTargets = [];
            if (opts && opts.includeSVGs && !cancelRequested) {
                svgTargets = workingNodes
                    .filter((n) => n.type !== "TEXT" && n.visible !== false)
                    .map((n) => ({ id: n.id, pageName: pgName }));
            }
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
                            if (shouldFetchVars)
                                await fetchVars(baseName);
                            if (shouldFetchStyles)
                                await fetchStyles(baseName);
                            if (opts.includeSVGs && svgTargets.length > 0 && !cancelRequested) {
                                figma.ui.postMessage({ type: "progress", current: 0, total: svgTargets.length, label: "SVG Export" });
                                let extrasPart = 0;
                                for (let i = 0; i < svgTargets.length && !cancelRequested; i += 4) {
                                    try {
                                        const br = await Promise.all(svgTargets.slice(i, i + 4).map((n) => svgExport(n.id, n.pageName)));
                                        for (const r of br)
                                            if (r)
                                                zipFiles.push(r);
                                    }
                                    catch (e) {
                                    }
                                    figma.ui.postMessage({ type: "progress", current: Math.min(i + 4, svgTargets.length), total: svgTargets.length, label: "SVG Export" });
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
                                    addToZip(`${baseName}_lottie.json`, JSON.stringify({
                                        note: "Lottie bundle placeholder. Use SVGs in svgs/ and positions in the full-extract.json for After Effects composition.",
                                        source: figma.root.name || "Untitled",
                                        exportedAt: new Date().toISOString(),
                                        pluginVersion: PLUGIN_VERSION,
                                    }));
                                }
                                catch (e) {
                                }
                            }
                            if (zipFiles.length > 0)
                                flushZipChunked(baseName + "_extras");
                            figma.ui.postMessage({ type: "extras-complete", scope: isScoped ? `${sel.length} items` : "entire page" });
                        }
                        catch (e) {
                            figma.ui.postMessage({ type: "error", message: "Extras failed: " + e.message });
                        }
                        finally {
                            runningExtract = false;
                            if (watchdog)
                                clearTimeout(watchdog);
                        }
                    })();
                }, 100);
            }
            else {
                runningExtract = false;
                if (watchdog)
                    clearTimeout(watchdog);
                figma.ui.postMessage({ type: "extras-complete", scope: isScoped ? `${sel.length} items` : "entire page" });
            }
        }
        setTimeout(processBatch, 10);
        return;
    }
    if (msg.type === "get-text") {
        await figma.loadAllPagesAsync();
        const nodes = figma.currentPage.findAll(() => true);
        const tn = [];
        for (const n of nodes) {
            if (n.type === "TEXT") {
                try {
                    tn.push(extractText(n));
                }
                catch (e) { }
            }
        }
        nodes.length = 0;
        const txt = buildPlainText(tn);
        if (txt.length < 65000)
            downloadFile(`${baseName}_text.txt`, txt, "text/plain");
        else
            addToZip(`${baseName}_text.txt`, txt);
        addToZip(`${baseName}_text.json`, JSON.stringify(tn));
        flushZipChunked(baseName + "_text");
        return;
    }
    if (msg.type === "get-components") {
        await figma.loadAllPagesAsync();
        const nodes = figma.currentPage.findAll(() => true);
        const cc = [];
        for (const n of nodes) {
            if (n.type === "COMPONENT" || n.type === "COMPONENT_SET") {
                try {
                    let vp = null;
                    if (n.type === "COMPONENT_SET") {
                        const rp = n.variantGroupProperties || n.variantProperties;
                        if (rp) {
                            vp = {};
                            for (const k of Object.keys(rp))
                                vp[k] = rp[k];
                        }
                    }
                    cc.push({
                        id: n.id,
                        name: n.name,
                        key: n.key || "",
                        description: n.description || "",
                        type: n.type,
                        pageName: getNodeContext(n).pageName,
                        hasVariants: n.type === "COMPONENT_SET",
                        variantProperties: vp,
                        width: Math.round(n.width * 100) / 100,
                        height: Math.round(n.height * 100) / 100,
                        childCount: n.children ? n.children.length : 0,
                    });
                }
                catch (e) { }
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
        const pp = [];
        for (const pg of figma.root.children) {
            const pgd = pg;
            pp.push({
                id: pg.id,
                name: pgd.name || "",
                nodeCount: 0,
                background: pgd.backgrounds && pgd.backgrounds.length > 0 ? JSON.parse(JSON.stringify(pgd.backgrounds[0])) : null,
                topLevelFrames: (pgd.children || []).map((c) => ({
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
                const s = await node.exportAsync({ format: "SVG_STRING" });
                if (s)
                    downloadFile(`${sanitizeName(node.name)}.svg`, s, "image/svg+xml");
            }
            catch (e) {
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
            const ns = pg.findAll(() => true).filter((n) => n.visible !== false && n.type !== "PAGE");
            tN += ns.length;
        }
        let pN = 0;
        let batchPart = 0;
        for (const pg of pages) {
            const ns = pg.findAll(() => true).filter((n) => n.visible !== false && n.type !== "PAGE");
            for (let i = 0; i < ns.length; i += 20) {
                if (cancelRequested)
                    break;
                const r = await exportNodes(ns.slice(i, i + 20).map((n) => n.id), fmt, sc);
                for (const x of r) {
                    const fname = pages.length > 1 ? `${sanitizeName(pg.name || "")}/${x.name}.${x.format.toLowerCase()}` : `${x.name}.${x.format.toLowerCase()}`;
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
const FEATURE_VERSION = "19.1.0";
function isFeatureMessage(msg) {
    return !!msg && typeof msg.type === "string" && msg.type.indexOf("x:") === 0;
}
function uiSend(type, payload = {}) {
    figma.ui.postMessage(Object.assign({ type }, payload));
}
function errMsg(e) {
    return e instanceof Error ? e.message : String(e);
}
const yieldToFigma = () => new Promise((r) => setTimeout(r, 0));
function hex2(n) { return Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0"); }
function toHex(c) {
    const a = c.a;
    return "#" + hex2(c.r) + hex2(c.g) + hex2(c.b) + (a !== undefined && a < 1 ? hex2(a) : "");
}
function parseColor(input) {
    if (input && typeof input === "object" && "r" in input) {
        return { r: +input.r, g: +input.g, b: +input.b, a: input.a === undefined ? 1 : +input.a };
    }
    const s = String(input || "").trim();
    let m = s.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4)
            h = h.split("").map((ch) => ch + ch).join("");
        const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
        return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
    }
    m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
        const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
        return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p[3] === undefined ? 1 : p[3] };
    }
    throw new Error(`Onbekende kleur: ${s}`);
}
function solid(c) {
    return { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
}
const SPACING_SCALE = [
    ["space/1", 4], ["space/2", 8], ["space/3", 12], ["space/4", 16],
    ["space/5", 24], ["space/6", 32], ["space/7", 48], ["space/8", 64],
];
const RADIUS_SCALE = [["radius/sm", 6], ["radius/md", 10], ["radius/lg", 14], ["radius/full", 999]];
const TEXT_SCALE = [
    { name: "text/xs", size: 12, style: "Regular", line: 1.5 },
    { name: "text/sm", size: 14, style: "Regular", line: 1.5 },
    { name: "text/base", size: 16, style: "Regular", line: 1.5 },
    { name: "text/lg", size: 18, style: "Medium", line: 1.2 },
    { name: "text/xl", size: 22, style: "Semi Bold", line: 1.2 },
    { name: "text/2xl", size: 28, style: "Semi Bold", line: 1.2 },
    { name: "text/3xl", size: 36, style: "Semi Bold", line: 1.2 },
];
const GRID = 4;
function hasFills(n) {
    return "fills" in n;
}
async function rubricAudit() {
    await figma.loadAllPagesAsync();
    const r = {};
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const variables = await figma.variables.getLocalVariablesAsync();
    r.collections = collections.map((c) => ({ name: c.name, modes: c.modes.map((m) => m.name), count: c.variableIds.length }));
    const byType = {};
    let aliasCount = 0;
    for (const v of variables) {
        byType[v.resolvedType] = (byType[v.resolvedType] || 0) + 1;
        if (Object.keys(v.valuesByMode).some((k) => {
            const val = v.valuesByMode[k];
            return val && typeof val === "object" && val.type === "VARIABLE_ALIAS";
        }))
            aliasCount++;
    }
    r.variableTypes = byType;
    r.aliasCount = aliasCount;
    r.hasSpacing = SPACING_SCALE.every(([n]) => variables.some((v) => v.name === n));
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
    r.genericVariants = [];
    for (const s of sets) {
        const defs = s.componentPropertyDefinitions || {};
        for (const p of Object.keys(defs)) {
            const vals = defs[p].variantOptions || [];
            const generic = vals.filter((x) => /^(Variant ?\d+|Property ?\d+|Default)$/i.test(x));
            if (/^Property ?\d+$/i.test(p) || generic.length)
                r.genericVariants.push({ set: s.name, prop: p, values: vals });
        }
    }
    const textStyles = await figma.getLocalTextStylesAsync();
    r.textStyles = textStyles.map((s) => ({ name: s.name, size: s.fontSize, font: s.fontName.style }));
    r.missingTextStyles = TEXT_SCALE.filter((t) => !textStyles.some((s) => s.name === t.name)).map((t) => t.name);
    const scaleSizes = TEXT_SCALE.map((t) => t.size);
    const texts = figma.root.findAllWithCriteria({ types: ["TEXT"] });
    let unstyled = 0;
    const offScale = {};
    for (const t of texts) {
        if (!t.textStyleId || t.textStyleId === figma.mixed)
            unstyled++;
        if (typeof t.fontSize === "number" && scaleSizes.indexOf(Math.round(t.fontSize)) < 0) {
            const k = String(Math.round(t.fontSize * 100) / 100);
            offScale[k] = (offScale[k] || 0) + 1;
        }
    }
    r.textTotal = texts.length;
    r.textUnstyled = unstyled;
    r.offScale = Object.keys(offScale).map((k) => [k, offScale[k]]).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const frames = figma.root.findAllWithCriteria({ types: ["FRAME", "COMPONENT", "INSTANCE"] });
    let auto = 0;
    const offGrid = [];
    const noAuto = [];
    for (const f of frames) {
        if (f.layoutMode && f.layoutMode !== "NONE") {
            auto++;
            const vals = [f.paddingLeft, f.paddingRight, f.paddingTop, f.paddingBottom, f.itemSpacing];
            const bad = vals.filter((n) => typeof n === "number" && n > 0 && n % GRID !== 0);
            if (bad.length)
                offGrid.push({ id: f.id, name: f.name, values: bad });
        }
        else if ("children" in f && f.children.length > 1 && f.type !== "INSTANCE") {
            noAuto.push({ id: f.id, name: f.name, children: f.children.length });
        }
    }
    r.frameTotal = frames.length;
    r.frameAuto = auto;
    r.offGrid = offGrid.slice(0, 15);
    r.offGridTotal = offGrid.length;
    r.noAutoLayout = noAuto.sort((a, b) => b.children - a.children).slice(0, 10);
    let bound = 0, raw = 0;
    const rawColors = {};
    const all = figma.root.findAll((n) => hasFills(n));
    for (const n of all) {
        const fills = n.fills;
        if (!Array.isArray(fills))
            continue;
        for (const f of fills) {
            if (f.type !== "SOLID" || f.visible === false)
                continue;
            if (f.boundVariables && f.boundVariables.color)
                bound++;
            else {
                raw++;
                const h = toHex(f.color);
                rawColors[h] = (rawColors[h] || 0) + 1;
            }
        }
    }
    r.fillsBound = bound;
    r.fillsRaw = raw;
    r.topRawColors = Object.keys(rawColors).map((h) => [h, rawColors[h]]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    r.pages = figma.root.children.map((p) => p.name);
    r.fileName = figma.root.name;
    return r;
}
async function createSpacingVariables() {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const existing = await figma.variables.getLocalVariablesAsync();
    let col = collections.find((c) => c.name === "primitives");
    if (!col)
        col = figma.variables.createVariableCollection("primitives");
    const modeId = col.modes[0].modeId;
    const made = [];
    for (const [name, value] of SPACING_SCALE.concat(RADIUS_SCALE)) {
        if (existing.some((v) => v.name === name))
            continue;
        const v = figma.variables.createVariable(name, col, "FLOAT");
        v.setValueForMode(modeId, value);
        v.scopes = name.indexOf("radius/") === 0 ? ["CORNER_RADIUS"] : ["GAP", "WIDTH_HEIGHT"];
        made.push(`${name} = ${value}`);
    }
    return made;
}
async function createTextStyles() {
    const existing = await figma.getLocalTextStylesAsync();
    const made = [], failed = [];
    for (const t of TEXT_SCALE) {
        if (existing.some((s) => s.name === t.name))
            continue;
        try {
            const font = await resolveFont("Inter", t.style === "Regular" ? 400 : t.style === "Medium" ? 500 : 600, false);
            const s = figma.createTextStyle();
            s.name = t.name;
            s.fontName = font;
            s.fontSize = t.size;
            s.lineHeight = { unit: "PERCENT", value: t.line * 100 };
            made.push(`${t.name} — ${t.size}px ${font.style}`);
        }
        catch (e) {
            failed.push(`${t.name}: ${errMsg(e)}`);
        }
    }
    return { made, failed };
}
const WEIGHT_NAMES = {
    100: ["Thin", "Hairline"], 200: ["Extra Light", "ExtraLight", "Ultra Light"], 300: ["Light"],
    400: ["Regular", "Normal", "Book"], 500: ["Medium"], 600: ["Semi Bold", "SemiBold", "Demi Bold"],
    700: ["Bold"], 800: ["Extra Bold", "ExtraBold", "Ultra Bold"], 900: ["Black", "Heavy"],
};
let fontListCache = null;
const fontResolveCache = {};
const loadedFonts = {};
const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, "");
function styleWeight(style) {
    const s = norm(style.replace(/italic|oblique/i, ""));
    for (const w of Object.keys(WEIGHT_NAMES)) {
        if (WEIGHT_NAMES[+w].some((n) => norm(n) === s))
            return +w;
    }
    return s === "" ? 400 : 400;
}
async function resolveFont(family, weight, italic) {
    const key = `${family}|${weight}|${italic}`;
    if (fontResolveCache[key])
        return fontResolveCache[key];
    if (!fontListCache)
        fontListCache = await figma.listAvailableFontsAsync();
    const generic = /^(system-ui|-apple-system|sans-serif|serif|monospace|ui-sans-serif|ui-monospace|blinkmacsystemfont|inherit|initial)$/i;
    const wanted = generic.test(family) ? "Inter" : family;
    let styles = fontListCache.filter((f) => norm(f.fontName.family) === norm(wanted)).map((f) => f.fontName);
    if (!styles.length)
        styles = fontListCache.filter((f) => f.fontName.family === "Inter").map((f) => f.fontName);
    if (!styles.length)
        styles = [{ family: "Roboto", style: "Regular" }];
    const withItalic = styles.filter((s) => /italic|oblique/i.test(s.style) === italic);
    const pool = withItalic.length ? withItalic : styles;
    pool.sort((a, b) => Math.abs(styleWeight(a.style) - weight) - Math.abs(styleWeight(b.style) - weight));
    const pick = pool[0];
    const lk = `${pick.family}|${pick.style}`;
    if (!loadedFonts[lk]) {
        await figma.loadFontAsync(pick);
        loadedFonts[lk] = true;
    }
    fontResolveCache[key] = pick;
    return pick;
}
const TEXT_CASE = { UPPER: "UPPER", LOWER: "LOWER", TITLE: "TITLE", ORIGINAL: "ORIGINAL" };
const TEXT_DECO = { UNDERLINE: "UNDERLINE", STRIKETHROUGH: "STRIKETHROUGH", NONE: "NONE" };
function rgba(c) {
    return c ? { r: c.r, g: c.g, b: c.b, a: c.a === undefined ? 1 : c.a } : null;
}
async function importLayout(doc, opts = {}) {
    if (!doc || doc.format !== "figma-layout" || !doc.root) {
        throw new Error("This is not a figma-layout document (expected format \"figma-layout\" with a root).");
    }
    const autoLayout = opts.autoLayout !== false;
    const counts = { FRAME: 0, TEXT: 0, SVG: 0, IMAGE: 0 };
    const warnings = [];
    const warn = (m) => { if (warnings.length < 50)
        warnings.push(m); };
    let made = 0;
    const needed = {};
    (function collect(n) {
        if (n.type === "TEXT") {
            for (const r of n.runs || [{ text: n.text || "", font: n.font }]) {
                if (r.font)
                    needed[`${r.font.family}|${r.font.weight}|${r.font.italic}`] = r.font;
            }
        }
        for (const c of n.children || [])
            collect(c);
    })(doc.root);
    for (const k of Object.keys(needed)) {
        const f = needed[k];
        try {
            await resolveFont(f.family, f.weight, f.italic);
        }
        catch (e) {
            warn(`font ${f.family} ${f.weight}: ${errMsg(e)}`);
        }
    }
    const fontFor = (f) => fontResolveCache[`${f.family}|${f.weight}|${f.italic}`] || { family: "Inter", style: "Regular" };
    async function build(n, parentX, parentY, parentAuto) {
        made++;
        if (made % 150 === 0) {
            uiSend("x:layout-progress", { made });
            await yieldToFigma();
        }
        let node = null;
        try {
            if (n.type === "TEXT")
                node = await buildText(n);
            else if (n.type === "SVG")
                node = buildSvg(n);
            else if (n.type === "IMAGE")
                node = buildImage(n);
            else
                node = await buildFrame(n);
        }
        catch (e) {
            warn(`${n.type} "${n.name}": ${errMsg(e)}`);
            return null;
        }
        if (!node)
            return null;
        counts[n.type]++;
        node.__abs = n.absolute || !parentAuto;
        node.x = n.x - parentX;
        node.y = n.y - parentY;
        return node;
    }
    async function buildFrame(n) {
        const f = figma.createFrame();
        f.name = n.name || "frame";
        f.fills = [];
        for (const fill of n.fills || []) {
            const c = rgba(fill.color);
            if (fill.type === "SOLID" && c)
                f.fills = [...f.fills, solid(c)];
        }
        if (n.stroke) {
            const c = rgba(n.stroke.color);
            f.strokes = [solid(c)];
            f.strokeAlign = "INSIDE";
            const [t, rgt, b, l] = n.stroke.weights;
            if (t === rgt && t === b && t === l)
                f.strokeWeight = t;
            else {
                f.strokeTopWeight = t;
                f.strokeRightWeight = rgt;
                f.strokeBottomWeight = b;
                f.strokeLeftWeight = l;
            }
        }
        if (n.radius) {
            const [tl, tr, br, bl] = n.radius;
            if (tl === tr && tl === br && tl === bl)
                f.cornerRadius = tl;
            else {
                f.topLeftRadius = tl;
                f.topRightRadius = tr;
                f.bottomRightRadius = br;
                f.bottomLeftRadius = bl;
            }
        }
        if (n.shadows && n.shadows.length) {
            f.effects = n.shadows.map((s) => ({
                type: s.inset ? "INNER_SHADOW" : "DROP_SHADOW",
                color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a === undefined ? 1 : s.color.a },
                offset: { x: s.x, y: s.y }, radius: s.blur, spread: s.spread,
                visible: true, blendMode: "NORMAL",
            }));
        }
        if (n.opacity !== undefined)
            f.opacity = n.opacity;
        f.clipsContent = !!n.clip;
        const useAuto = autoLayout && !!n.layout;
        if (useAuto) {
            const L = n.layout;
            f.layoutMode = L.mode;
            f.primaryAxisSizingMode = "FIXED";
            f.counterAxisSizingMode = "FIXED";
            f.itemSpacing = L.primary === "SPACE_BETWEEN" ? 0 : L.gap;
            [f.paddingTop, f.paddingRight, f.paddingBottom, f.paddingLeft] = L.padding;
            f.primaryAxisAlignItems = (["MIN", "CENTER", "MAX", "SPACE_BETWEEN"].indexOf(L.primary) >= 0 ? L.primary : "MIN");
            const counter = L.counter === "BASELINE" && L.mode !== "HORIZONTAL" ? "MIN" : L.counter;
            f.counterAxisAlignItems = (["MIN", "CENTER", "MAX", "BASELINE"].indexOf(counter) >= 0 ? counter : "MIN");
            if (L.wrap && L.mode === "HORIZONTAL") {
                f.layoutWrap = "WRAP";
                if (L.crossGap)
                    f.counterAxisSpacing = L.crossGap;
            }
        }
        f.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
        for (const c of n.children || []) {
            const child = await build(c, n.x, n.y, useAuto);
            if (!child)
                continue;
            f.appendChild(child);
            if (useAuto) {
                if (child.__abs) {
                    child.layoutPositioning = "ABSOLUTE";
                    child.x = c.x - n.x;
                    child.y = c.y - n.y;
                }
                else if ("layoutSizingHorizontal" in child) {
                    try {
                        child.layoutSizingHorizontal = "FIXED";
                        child.layoutSizingVertical = "FIXED";
                    }
                    catch (e) { }
                }
            }
            delete child.__abs;
        }
        return f;
    }
    async function buildText(n) {
        const text = n.text || "";
        if (!text.trim())
            return null;
        const t = figma.createText();
        const base = n.font;
        t.fontName = fontFor(base);
        t.characters = text;
        t.name = n.name || text.slice(0, 40);
        t.fontSize = Math.max(1, base.size);
        if (base.lineHeight)
            t.lineHeight = { unit: "PIXELS", value: base.lineHeight };
        if (base.letterSpacing)
            t.letterSpacing = { unit: "PIXELS", value: base.letterSpacing };
        const col = rgba(n.color);
        t.fills = col ? [solid(col)] : [];
        t.textCase = TEXT_CASE[n.transform || "ORIGINAL"] || "ORIGINAL";
        t.textDecoration = TEXT_DECO[n.decoration || "NONE"] || "NONE";
        t.textAlignHorizontal = (["LEFT", "CENTER", "RIGHT", "JUSTIFIED"].indexOf(n.align || "") >= 0 ? n.align : "LEFT");
        if (n.runs && n.runs.length > 1) {
            let at = 0;
            for (const r of n.runs) {
                const end = at + r.text.length;
                if (end > at && end <= text.length) {
                    t.setRangeFontName(at, end, fontFor(r.font));
                    t.setRangeFontSize(at, end, Math.max(1, r.font.size));
                    const rc = rgba(r.color);
                    if (rc)
                        t.setRangeFills(at, end, [solid(rc)]);
                    if (r.decoration)
                        t.setRangeTextDecoration(at, end, TEXT_DECO[r.decoration] || "NONE");
                    if (r.transform)
                        t.setRangeTextCase(at, end, TEXT_CASE[r.transform] || "ORIGINAL");
                    if (r.font.letterSpacing)
                        t.setRangeLetterSpacing(at, end, { unit: "PIXELS", value: r.font.letterSpacing });
                }
                at = end;
            }
        }
        if (n.wrap || (n.align && n.align !== "LEFT")) {
            t.textAutoResize = "HEIGHT";
            t.resize(Math.max(n.w, 1), Math.max(n.h, 1));
        }
        else {
            t.textAutoResize = "WIDTH_AND_HEIGHT";
        }
        return t;
    }
    function buildSvg(n) {
        try {
            const f = figma.createNodeFromSvg(n.svg || "<svg xmlns='http://www.w3.org/2000/svg'/>");
            f.name = n.name || "svg";
            if (Math.abs(f.width - n.w) > 0.5 || Math.abs(f.height - n.h) > 0.5)
                f.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
            return f;
        }
        catch (e) {
            warn(`SVG "${n.name}" not readable by Figma, replaced by a rectangle: ${errMsg(e)}`);
            const r = figma.createRectangle();
            r.name = `${n.name || "svg"} (niet geïmporteerd)`;
            r.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
            r.fills = [solid({ r: 0.9, g: 0.9, b: 0.9, a: 1 })];
            return r;
        }
    }
    function buildImage(n) {
        const r = figma.createRectangle();
        r.name = n.name || "image";
        r.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
        const m = (n.src || "").match(/^data:image\/[a-z+]+;base64,(.+)$/i);
        if (m) {
            const img = figma.createImage(figma.base64Decode(m[1]));
            r.fills = [{ type: "IMAGE", imageHash: img.hash, scaleMode: n.fit === "FIT" ? "FIT" : "FILL" }];
        }
        else {
            r.fills = [solid({ r: 0.88, g: 0.89, b: 0.9, a: 1 })];
            warn(`image "${n.name}" had no readable source (CORS), placed a grey rectangle`);
        }
        return r;
    }
    const rootNode = await build(doc.root, doc.root.x, doc.root.y, false);
    if (!rootNode)
        throw new Error("Could not build the root. " + (warnings[0] || ""));
    const src = doc.source || {};
    rootNode.name = opts.name || [src.title || doc.root.name || "Import", src.colorScheme ? `(${src.colorScheme})` : ""].join(" ").trim();
    let parent = figma.currentPage;
    if (opts.parentId) {
        const p = await figma.getNodeByIdAsync(opts.parentId);
        if (p && "appendChild" in p)
            parent = p;
    }
    parent.appendChild(rootNode);
    if (opts.x !== undefined && opts.y !== undefined) {
        rootNode.x = opts.x;
        rootNode.y = opts.y;
    }
    else if (parent.type === "PAGE") {
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
const varNameCache = {};
async function varName(id) {
    if (varNameCache[id])
        return varNameCache[id];
    const v = await figma.variables.getVariableByIdAsync(id);
    varNameCache[id] = v ? v.name : id;
    return varNameCache[id];
}
async function describePaints(paints) {
    if (paints === figma.mixed)
        return "mixed";
    const out = [];
    for (const p of paints) {
        if (p.visible === false)
            continue;
        if (p.type === "SOLID") {
            const e = { type: "SOLID", hex: toHex({ r: p.color.r, g: p.color.g, b: p.color.b, a: p.opacity === undefined ? 1 : p.opacity }) };
            if (p.boundVariables && p.boundVariables.color)
                e.variable = await varName(p.boundVariables.color.id);
            out.push(e);
        }
        else
            out.push({ type: p.type });
    }
    return out;
}
async function describeNode(n, depth) {
    const d = { id: n.id, name: n.name, type: n.type };
    if ("x" in n) {
        d.x = Math.round(n.x);
        d.y = Math.round(n.y);
    }
    if ("width" in n) {
        d.w = Math.round(n.width);
        d.h = Math.round(n.height);
    }
    if (!n.visible)
        d.visible = false;
    if ("opacity" in n && n.opacity < 1)
        d.opacity = Math.round(n.opacity * 100) / 100;
    if ("fills" in n && n.type !== "TEXT") {
        const f = await describePaints(n.fills);
        if (f === "mixed" || f.length)
            d.fills = f;
    }
    if ("strokes" in n && n.strokes.length) {
        d.strokes = await describePaints(n.strokes);
        d.strokeWeight = n.strokeWeight === figma.mixed ? "mixed" : n.strokeWeight;
    }
    if ("cornerRadius" in n)
        d.radius = n.cornerRadius === figma.mixed ? "mixed" : n.cornerRadius || undefined;
    if ("layoutMode" in n && n.layoutMode !== "NONE") {
        const f = n;
        d.autoLayout = {
            mode: f.layoutMode, gap: f.itemSpacing,
            padding: [f.paddingTop, f.paddingRight, f.paddingBottom, f.paddingLeft],
            primary: f.primaryAxisAlignItems, counter: f.counterAxisAlignItems,
            wrap: f.layoutWrap,
        };
    }
    if ("layoutSizingHorizontal" in n && n.parent && "layoutMode" in n.parent && n.parent.layoutMode !== "NONE") {
        d.sizing = { h: n.layoutSizingHorizontal, v: n.layoutSizingVertical };
    }
    if ("boundVariables" in n && n.boundVariables) {
        const bv = {};
        for (const k of Object.keys(n.boundVariables)) {
            const v = n.boundVariables[k];
            if (v && v.id)
                bv[k] = await varName(v.id);
        }
        if (Object.keys(bv).length)
            d.boundVariables = bv;
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
    if (n.type === "COMPONENT_SET")
        d.variantProperties = Object.keys(n.componentPropertyDefinitions || {});
    if (n.type === "COMPONENT" && n.parent && n.parent.type === "COMPONENT_SET")
        d.variant = n.variantProperties;
    if (n.type === "INSTANCE") {
        const main = await n.getMainComponentAsync();
        d.mainComponent = main ? main.name : null;
        if (main) {
            d.mainComponentId = main.id;
            if (main.remote)
                d.remote = true;
            if (main.parent && main.parent.type === "COMPONENT_SET")
                d.componentSet = { id: main.parent.id, name: main.parent.name };
            let pg = main.parent;
            while (pg && pg.type !== "PAGE")
                pg = pg.parent;
            if (pg)
                d.mainComponentPage = pg.name;
        }
    }
    if ("reactions" in n && n.reactions.length)
        d.reactions = n.reactions.map(describeReaction);
    if ("children" in n) {
        if (depth > 0) {
            d.children = [];
            for (const c of n.children)
                d.children.push(await describeNode(c, depth - 1));
        }
        else if (n.children.length)
            d.childCount = n.children.length;
    }
    return d;
}
async function nodesFrom(p) {
    const ids = p.ids || (p.id ? [p.id] : []);
    if (!ids.length) {
        const sel = figma.currentPage.selection;
        if (!sel.length)
            throw new Error("Geef ids mee of selecteer eerst iets in Figma.");
        return sel.slice();
    }
    const out = [];
    for (const id of ids) {
        const n = await figma.getNodeByIdAsync(id);
        if (!n || n.type === "DOCUMENT" || n.type === "PAGE")
            throw new Error(`Geen laag met id ${id}`);
        out.push(n);
    }
    return out;
}
async function findVariable(ref) {
    const byId = await figma.variables.getVariableByIdAsync(ref).catch(() => null);
    if (byId)
        return byId;
    const all = await figma.variables.getLocalVariablesAsync();
    const v = all.find((x) => x.name === ref) || all.find((x) => x.name.toLowerCase() === ref.toLowerCase());
    if (!v)
        throw new Error(`Variabele "${ref}" niet gevonden`);
    return v;
}
async function loadAllFontsOf(t) {
    const fonts = t.fontName === figma.mixed ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
    for (const f of fonts)
        await figma.loadFontAsync(f);
}
async function applyProps(n, p) {
    const any = n;
    if (p.name !== undefined)
        n.name = String(p.name);
    if (p.visible !== undefined)
        n.visible = !!p.visible;
    if (p.opacity !== undefined && "opacity" in n)
        any.opacity = +p.opacity;
    if (p.text !== undefined || p.fontSize !== undefined || p.fontFamily !== undefined || p.fontWeight !== undefined) {
        if (n.type !== "TEXT")
            throw new Error(`${n.name} is geen tekstlaag`);
        await loadAllFontsOf(n);
        if (p.fontFamily !== undefined || p.fontWeight !== undefined) {
            const cur = n.fontName === figma.mixed ? { family: "Inter", style: "Regular" } : n.fontName;
            n.fontName = await resolveFont(p.fontFamily || cur.family, p.fontWeight || styleWeight(cur.style), /italic/i.test(cur.style));
        }
        if (p.text !== undefined)
            n.characters = String(p.text);
        if (p.fontSize !== undefined)
            n.fontSize = +p.fontSize;
        if (p.lineHeight !== undefined)
            n.lineHeight = p.lineHeight === "auto" ? { unit: "AUTO" } : { unit: "PIXELS", value: +p.lineHeight };
        if (p.textAlign !== undefined)
            n.textAlignHorizontal = String(p.textAlign).toUpperCase();
        if (p.textAutoResize !== undefined)
            n.textAutoResize = p.textAutoResize;
    }
    if (p.width !== undefined || p.height !== undefined) {
        if (!("resize" in n))
            throw new Error(`${n.name} kan niet geschaald worden`);
        any.resize(p.width !== undefined ? +p.width : any.width, p.height !== undefined ? +p.height : any.height);
    }
    if (p.x !== undefined)
        n.x = +p.x;
    if (p.y !== undefined)
        n.y = +p.y;
    if (p.fill !== undefined || p.fills !== undefined) {
        const list = p.fills !== undefined ? p.fills : [p.fill];
        any.fills = (list || []).filter((c) => c !== null && c !== "none").map((c) => solid(parseColor(c)));
    }
    if (p.stroke !== undefined) {
        if (p.stroke === null || p.stroke === "none")
            any.strokes = [];
        else {
            const s = typeof p.stroke === "object" && !("r" in p.stroke) ? p.stroke : { color: p.stroke };
            any.strokes = [solid(parseColor(s.color))];
            if (s.weight !== undefined)
                any.strokeWeight = +s.weight;
            any.strokeAlign = s.align || "INSIDE";
        }
    }
    if (p.cornerRadius !== undefined)
        any.cornerRadius = +p.cornerRadius;
    if (p.layout !== undefined) {
        if (!("layoutMode" in n))
            throw new Error(`${n.name} kan geen auto layout krijgen`);
        const L = p.layout;
        if (L === null || L === "none" || L.mode === "NONE")
            any.layoutMode = "NONE";
        else {
            if (L.mode)
                any.layoutMode = String(L.mode).toUpperCase();
            if (L.gap !== undefined)
                any.itemSpacing = +L.gap;
            if (L.padding !== undefined) {
                const pd = Array.isArray(L.padding) ? L.padding : [L.padding, L.padding, L.padding, L.padding];
                const [t, r, b, l] = pd.length === 2 ? [pd[0], pd[1], pd[0], pd[1]] : pd;
                any.paddingTop = +t;
                any.paddingRight = +r;
                any.paddingBottom = +b;
                any.paddingLeft = +l;
            }
            if (L.primary)
                any.primaryAxisAlignItems = String(L.primary).toUpperCase();
            if (L.counter)
                any.counterAxisAlignItems = String(L.counter).toUpperCase();
            if (L.wrap !== undefined)
                any.layoutWrap = L.wrap ? "WRAP" : "NO_WRAP";
        }
    }
    if (p.sizing !== undefined) {
        if (p.sizing.h)
            any.layoutSizingHorizontal = String(p.sizing.h).toUpperCase();
        if (p.sizing.v)
            any.layoutSizingVertical = String(p.sizing.v).toUpperCase();
    }
    if (p.shadow !== undefined) {
        any.effects = p.shadow === null ? [] : [{
                type: "DROP_SHADOW", color: parseColor(p.shadow.color || "#00000026"),
                offset: { x: +(p.shadow.x || 0), y: +(p.shadow.y || 2) }, radius: +(p.shadow.blur || 8),
                spread: +(p.shadow.spread || 0), visible: true, blendMode: "NORMAL",
            }];
    }
}
async function createNode(p) {
    const kind = String(p.kind || p.type || "FRAME").toUpperCase();
    let n;
    if (kind === "FRAME") {
        const f = figma.createFrame();
        f.fills = [];
        n = f;
    }
    else if (kind === "RECTANGLE")
        n = figma.createRectangle();
    else if (kind === "ELLIPSE")
        n = figma.createEllipse();
    else if (kind === "TEXT") {
        const t = figma.createText();
        t.fontName = await resolveFont(p.fontFamily || "Inter", p.fontWeight || 400, false);
        t.characters = String(p.text || "Text");
        n = t;
    }
    else if (kind === "SVG")
        n = figma.createNodeFromSvg(String(p.svg || ""));
    else
        throw new Error(`Onbekend soort laag: ${kind} (FRAME, RECTANGLE, ELLIPSE, TEXT of SVG)`);
    let parent = figma.currentPage;
    if (p.parentId) {
        const pn = await figma.getNodeByIdAsync(p.parentId);
        if (!pn || !("appendChild" in pn))
            throw new Error(`Ouder ${p.parentId} kan geen kinderen hebben`);
        parent = pn;
    }
    parent.appendChild(n);
    const props = Object.assign({}, p);
    delete props.text;
    delete props.fontFamily;
    delete props.fontWeight;
    if (kind === "TEXT" && p.text === undefined)
        delete props.text;
    await applyProps(n, props);
    return n;
}
async function screenshot(p) {
    let nodes;
    if (p.ids || p.id)
        nodes = await nodesFrom(p);
    else if (figma.currentPage.selection.length)
        nodes = figma.currentPage.selection.slice();
    else
        nodes = figma.currentPage.children.slice(0, 1);
    if (!nodes.length)
        throw new Error("Niets om te fotograferen: de pagina is leeg.");
    const maxPx = Math.min(+(p.maxSize || 1600), 4096);
    const images = [];
    for (const n of nodes.slice(0, 4)) {
        const w = n.width || 1, h = n.height || 1;
        const scale = Math.min(+(p.scale || 1), maxPx / Math.max(w, h));
        const bytes = await n.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: Math.max(scale, 0.05) } });
        images.push({ id: n.id, name: n.name, width: Math.round(w * scale), height: Math.round(h * scale), base64: figma.base64Encode(bytes) });
    }
    return { images };
}
async function getVariablesDump() {
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    const out = [];
    for (const c of cols) {
        const vars = [];
        for (const id of c.variableIds) {
            const v = await figma.variables.getVariableByIdAsync(id);
            if (!v)
                continue;
            const values = {};
            for (const m of c.modes) {
                const val = v.valuesByMode[m.modeId];
                if (val && typeof val === "object" && val.type === "VARIABLE_ALIAS")
                    values[m.name] = { alias: await varName(val.id) };
                else if (val && typeof val === "object" && "r" in val)
                    values[m.name] = toHex(val);
                else
                    values[m.name] = val;
            }
            vars.push({ id: v.id, name: v.name, type: v.resolvedType, values, scopes: v.scopes });
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
async function createVariables(p) {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    let col = collections.find((c) => c.name === p.collection);
    if (!col)
        col = figma.variables.createVariableCollection(String(p.collection || "tokens"));
    const modeNames = p.modes || [];
    modeNames.forEach((name, i) => {
        if (col.modes.some((m) => m.name === name))
            return;
        if (i === 0 && col.modes.length === 1 && col.variableIds.length === 0)
            col.renameMode(col.modes[0].modeId, name);
        else
            col.addMode(name);
    });
    const modeId = (name) => {
        const m = col.modes.find((x) => x.name === name);
        if (!m)
            throw new Error(`Mode "${name}" bestaat niet in ${col.name}`);
        return m.modeId;
    };
    const existing = await figma.variables.getLocalVariablesAsync();
    const results = [];
    for (const spec of p.variables || []) {
        const type = String(spec.type || "COLOR").toUpperCase();
        let v = existing.find((x) => x.name === spec.name && x.variableCollectionId === col.id);
        const isNew = !v;
        if (!v)
            v = figma.variables.createVariable(spec.name, col, type);
        const values = spec.values || (spec.value !== undefined ? { [col.modes[0].name]: spec.value } : {});
        for (const modeName of Object.keys(values)) {
            const raw = values[modeName];
            let val;
            if (raw && typeof raw === "object" && raw.alias)
                val = figma.variables.createVariableAlias(await findVariable(raw.alias));
            else if (type === "COLOR")
                val = parseColor(raw);
            else if (type === "FLOAT")
                val = +raw;
            else if (type === "BOOLEAN")
                val = !!raw;
            else
                val = String(raw);
            v.setValueForMode(modeId(modeName), val);
        }
        if (spec.scopes)
            v.scopes = spec.scopes;
        results.push(`${isNew ? "nieuw" : "bijgewerkt"}: ${v.name}`);
    }
    return { collection: col.name, modes: col.modes.map((m) => m.name), results };
}
async function bindVariable(p) {
    const nodes = await nodesFrom(p);
    const v = await findVariable(String(p.variable));
    const field = String(p.field);
    let done = 0;
    for (const n of nodes) {
        const any = n;
        if (field === "fill" || field === "fills" || field === "stroke" || field === "strokes") {
            const prop = field.indexOf("fill") === 0 ? "fills" : "strokes";
            if (!(prop in n))
                continue;
            const current = any[prop] === figma.mixed ? [] : any[prop].slice();
            const base = current.find((x) => x.type === "SOLID") || { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
            any[prop] = [figma.variables.setBoundVariableForPaint(base, "color", v)];
        }
        else {
            if (!("setBoundVariable" in n))
                continue;
            n.setBoundVariable(field, v);
        }
        done++;
    }
    return { bound: done, variable: v.name, field };
}
async function applyTextStyle(p) {
    const nodes = (await nodesFrom(p)).filter((n) => n.type === "TEXT");
    const styles = await figma.getLocalTextStylesAsync();
    const s = styles.find((x) => x.id === p.style || x.name === p.style);
    if (!s)
        throw new Error(`Tekststijl "${p.style}" niet gevonden. Bestaand: ${styles.map((x) => x.name).join(", ") || "geen"}`);
    await figma.loadFontAsync(s.fontName);
    for (const t of nodes) {
        await loadAllFontsOf(t);
        await t.setTextStyleIdAsync(s.id);
    }
    return { applied: nodes.length, style: s.name };
}
function pageNameOf(n) {
    let cur = n;
    while (cur && cur.type !== "PAGE")
        cur = cur.parent;
    return cur ? cur.name : "?";
}
async function textNodesIn(p) {
    await figma.loadAllPagesAsync();
    const ids = p.ids || (p.id ? [p.id] : []);
    if (!ids.length)
        return figma.root.findAllWithCriteria({ types: ["TEXT"] });
    const out = [];
    for (const n of await nodesFrom(p)) {
        if (n.type === "TEXT")
            out.push(n);
        else if ("findAllWithCriteria" in n)
            out.push(...n.findAllWithCriteria({ types: ["TEXT"] }));
    }
    return out;
}
function lineHeightLabel(t) {
    const lh = t.lineHeight;
    if (lh === figma.mixed)
        return "mixed";
    if (lh.unit === "AUTO")
        return "auto";
    return `${Math.round(lh.value * 100) / 100}${lh.unit === "PERCENT" ? "%" : "px"}`;
}
async function textInventory(p) {
    const texts = await textNodesIn(p);
    const groups = {};
    let styled = 0, mixed = 0;
    for (const t of texts) {
        if (t.textStyleId && t.textStyleId !== figma.mixed)
            styled++;
        if (t.fontSize === figma.mixed || t.fontName === figma.mixed) {
            mixed++;
            continue;
        }
        const fn = t.fontName;
        const key = `${fn.family}|${t.fontSize}|${styleWeight(fn.style)}|${lineHeightLabel(t)}`;
        const g = groups[key] || (groups[key] = { family: fn.family, size: t.fontSize, weight: styleWeight(fn.style), lineHeight: lineHeightLabel(t), count: 0, pages: {}, samples: [] });
        g.count++;
        const pg = pageNameOf(t);
        g.pages[pg] = (g.pages[pg] || 0) + 1;
        if (g.samples.length < 3)
            g.samples.push({ id: t.id, text: t.characters.slice(0, 28) });
    }
    const list = Object.keys(groups).map((k) => groups[k]).sort((a, b) => b.count - a.count);
    return { total: texts.length, styled, mixed, groups: list };
}
async function createTextStylesBulk(p) {
    const defs = p.styles || [];
    if (!defs.length)
        throw new Error("Geef styles mee: [{ name, size, weight, lineHeightPercent }]");
    const existing = await figma.getLocalTextStylesAsync();
    const made = [], updated = [], skipped = [];
    for (const d of defs) {
        let s = existing.find((x) => x.name === d.name);
        if (s && !p.update) {
            skipped.push(d.name);
            continue;
        }
        const font = await resolveFont(d.family || "Inter", d.weight || 400, false);
        await figma.loadFontAsync(font);
        if (!s) {
            s = figma.createTextStyle();
            s.name = d.name;
            made.push(`${d.name} (${d.size}px ${font.style})`);
        }
        else
            updated.push(d.name);
        s.fontName = font;
        s.fontSize = d.size;
        if (d.lineHeightPx !== undefined)
            s.lineHeight = { unit: "PIXELS", value: d.lineHeightPx };
        else
            s.lineHeight = { unit: "PERCENT", value: d.lineHeightPercent !== undefined ? d.lineHeightPercent : 150 };
    }
    return { made, updated, skipped };
}
async function applyTextStylesAuto(p) {
    const rules = p.rules || [];
    if (!rules.length)
        throw new Error("Geef rules mee: [{ size, weight, style }]");
    const styles = await figma.getLocalTextStylesAsync();
    const resolved = rules.map((r) => {
        const s = styles.find((x) => x.name === r.style || x.id === r.style);
        if (!s)
            throw new Error(`Tekststijl "${r.style}" bestaat niet`);
        return { size: r.size, weight: r.weight, style: s };
    });
    const texts = await textNodesIn(p);
    const started = Date.now();
    const budget = p.timeBudgetMs === undefined ? 40000 : Number(p.timeBudgetMs);
    const fontsLoaded = new Set();
    const ensureFont = async (f) => {
        const key = f.family + "|" + f.style;
        if (fontsLoaded.has(key))
            return;
        await figma.loadFontAsync(f);
        fontsLoaded.add(key);
    };
    const applied = {};
    const unmatched = {};
    let skippedMixed = 0, already = 0, done = 0, more = 0;
    for (const t of texts) {
        if (t.fontSize === figma.mixed || t.fontName === figma.mixed) {
            skippedMixed++;
            continue;
        }
        if (p.skipInstances && insideInstance(t))
            continue;
        if (p.onlyUnstyled && t.textStyleId && t.textStyleId !== figma.mixed) {
            already++;
            continue;
        }
        const w = styleWeight(t.fontName.style);
        const rule = resolved.find((r) => Math.abs(r.size - t.fontSize) < 0.05 && r.weight === w);
        if (!rule) {
            const k = `${t.fontSize}/${w}`;
            const u = unmatched[k] || (unmatched[k] = { count: 0, sample: t.id });
            u.count++;
            continue;
        }
        if (t.textStyleId === rule.style.id) {
            already++;
            continue;
        }
        if (p.limit && done >= p.limit) {
            more++;
            continue;
        }
        if (bridgeCancelRequested || (budget > 0 && Date.now() - started > budget)) {
            more++;
            continue;
        }
        done++;
        if (!p.dryRun) {
            await ensureFont(t.fontName);
            await ensureFont(rule.style.fontName);
            await t.setTextStyleIdAsync(rule.style.id);
        }
        applied[rule.style.name] = (applied[rule.style.name] || 0) + 1;
    }
    return { dryRun: !!p.dryRun, total: texts.length, applied, already, skippedMixed, unmatched, remaining: more, cancelled: bridgeCancelRequested, ms: Date.now() - started };
}
function insideInstance(n) {
    let cur = n.parent;
    while (cur && cur.type !== "PAGE" && cur.type !== "DOCUMENT") {
        if (cur.type === "INSTANCE")
            return true;
        cur = cur.parent;
    }
    return false;
}
const GENERIC_NAME = /^(Frame|Rectangle|Group|Vector|Ellipse|Line|Polygon|Star|Boolean|Slice|Section|Component|Instance|Text|Image)( \d+)?$/;
async function layerAudit(p) {
    await figma.loadAllPagesAsync();
    const all = figma.root.findAll(() => true);
    const own = all.filter((n) => !insideInstance(n));
    const generic = {};
    const noAuto = {};
    const offGrid = [];
    const raw = {};
    for (const n of own) {
        if (GENERIC_NAME.test(n.name)) {
            const k = n.type;
            const g = generic[k] || (generic[k] = { count: 0, samples: [], parents: {} });
            g.count++;
            if (g.samples.length < 6)
                g.samples.push(`${n.id} "${n.name}"`);
            const pn = n.parent ? n.parent.name : "?";
            g.parents[pn] = (g.parents[pn] || 0) + 1;
        }
        if ((n.type === "FRAME" || n.type === "COMPONENT") && "layoutMode" in n) {
            const f = n;
            if (f.layoutMode === "NONE" && f.children.length > 0 && f.name.charAt(0) !== "_") {
                const k = f.name.replace(/\d+/g, "#");
                const g = noAuto[k] || (noAuto[k] = { count: 0, children: 0, samples: [], pages: {} });
                g.count++;
                g.children += f.children.length;
                if (g.samples.length < 4)
                    g.samples.push(f.id);
                const pg = pageNameOf(f);
                g.pages[pg] = (g.pages[pg] || 0) + 1;
            }
            if (f.layoutMode !== "NONE") {
                const vals = [f.paddingLeft, f.paddingRight, f.paddingTop, f.paddingBottom, f.itemSpacing].concat(f.layoutWrap === "WRAP" ? [f.counterAxisSpacing || 0] : []);
                const bad = vals.filter((v) => v % GRID !== 0);
                if (bad.length)
                    offGrid.push({ id: f.id, name: f.name, page: pageNameOf(f), values: vals });
            }
        }
        const paints = [];
        if ("fills" in n && Array.isArray(n.fills))
            n.fills.forEach((x) => paints.push({ kind: "fill", paint: x }));
        if ("strokes" in n)
            n.strokes.forEach((x) => paints.push({ kind: "stroke", paint: x }));
        for (const { kind, paint } of paints) {
            if (paint.type !== "SOLID" || paint.visible === false)
                continue;
            if (paint.boundVariables && paint.boundVariables.color)
                continue;
            if ("fillStyleId" in n && kind === "fill" && n.fillStyleId)
                continue;
            const hex = "#" + [paint.color.r, paint.color.g, paint.color.b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
            const g = raw[hex] || (raw[hex] = { count: 0, pages: {}, types: {}, samples: [] });
            g.count++;
            const pg = pageNameOf(n);
            g.pages[pg] = (g.pages[pg] || 0) + 1;
            g.types[n.type + ":" + kind] = (g.types[n.type + ":" + kind] || 0) + 1;
            if (g.samples.length < 4)
                g.samples.push(`${n.id} "${n.name}"`);
        }
    }
    return { nodesOutsideInstances: own.length, generic, noAuto, offGridCount: offGrid.length, offGrid: offGrid.slice(0, p.max || 60), raw };
}
async function bindRawColors(p) {
    await figma.loadAllPagesAsync();
    const map = p.map || {};
    const vars = await figma.variables.getLocalVariablesAsync("COLOR");
    const byName = {};
    vars.forEach((v) => (byName[v.name] = v));
    for (const hex of Object.keys(map))
        if (!byName[map[hex]])
            throw new Error(`Variabele "${map[hex]}" bestaat niet`);
    const roots = p.ids && p.ids.length ? await nodesFrom(p) : [figma.root];
    const nodes = [];
    for (const r of roots) {
        if (r.type !== "DOCUMENT" && r.type !== "PAGE")
            nodes.push(r);
        if ("findAll" in r)
            nodes.push(...r.findAll(() => true));
    }
    const done = {};
    let more = 0, count = 0;
    for (const n of nodes) {
        if (insideInstance(n))
            continue;
        for (const kind of ["fills", "strokes"]) {
            if (!(kind in n))
                continue;
            const list = n[kind];
            if (!Array.isArray(list))
                continue;
            let changed = false;
            const next = list.map((paint) => {
                if (paint.type !== "SOLID" || (paint.boundVariables && paint.boundVariables.color))
                    return paint;
                const hex = "#" + [paint.color.r, paint.color.g, paint.color.b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
                const target = map[hex];
                if (!target)
                    return paint;
                if (p.limit && count >= p.limit) {
                    more++;
                    return paint;
                }
                count++;
                changed = true;
                done[hex + " -> " + target] = (done[hex + " -> " + target] || 0) + 1;
                return figma.variables.setBoundVariableForPaint(paint, "color", byName[target]);
            });
            if (changed && !p.dryRun)
                n[kind] = next;
        }
    }
    return { dryRun: !!p.dryRun, bound: done, remaining: more };
}
async function snapToGrid(p) {
    await figma.loadAllPagesAsync();
    const roots = p.ids && p.ids.length ? await nodesFrom(p) : [figma.root];
    const nodes = [];
    for (const r of roots) {
        if (r.type !== "DOCUMENT" && r.type !== "PAGE")
            nodes.push(r);
        if ("findAll" in r)
            nodes.push(...r.findAll(() => true));
    }
    const snap = (v) => (v % GRID === 0 ? v : Math.round(v / GRID) * GRID || (v > 0 ? GRID : 0));
    const changes = {};
    let count = 0, more = 0;
    for (const n of nodes) {
        if ((n.type !== "FRAME" && n.type !== "COMPONENT" && n.type !== "COMPONENT_SET") || insideInstance(n))
            continue;
        const f = n;
        if (f.layoutMode === "NONE")
            continue;
        const fields = ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "itemSpacing"];
        for (const key of fields) {
            const v = f[key];
            if (v % GRID === 0)
                continue;
            if (p.limit && count >= p.limit) {
                more++;
                continue;
            }
            count++;
            const to = snap(v);
            changes[`${key}: ${v} -> ${to}`] = (changes[`${key}: ${v} -> ${to}`] || 0) + 1;
            if (!p.dryRun)
                f[key] = to;
        }
    }
    return { dryRun: !!p.dryRun, changes, remaining: more };
}
async function dedupeTextStyles() {
    await figma.loadAllPagesAsync();
    const styles = await figma.getLocalTextStylesAsync();
    const used = {};
    for (const t of figma.root.findAllWithCriteria({ types: ["TEXT"] })) {
        if (t.textStyleId && t.textStyleId !== figma.mixed)
            used[t.textStyleId] = (used[t.textStyleId] || 0) + 1;
    }
    const byName = {};
    styles.forEach((x) => (byName[x.name] = (byName[x.name] || []).concat([x])));
    const removed = [];
    for (const name of Object.keys(byName)) {
        const group = byName[name];
        if (group.length < 2)
            continue;
        group.sort((a, b) => (used[b.id] || 0) - (used[a.id] || 0));
        for (const extra of group.slice(1)) {
            if (used[extra.id])
                continue;
            extra.remove();
            removed.push(name);
        }
    }
    return { removed };
}
async function listColorVariables() {
    const vars = await figma.variables.getLocalVariablesAsync("COLOR");
    return { names: vars.map((v) => v.name) };
}
async function renameGeneric(p) {
    await figma.loadAllPagesAsync();
    const nodes = figma.root.findAll((n) => !insideInstance(n) && GENERIC_NAME.test(n.name) && (n.type === "FRAME" || n.type === "ELLIPSE" || n.type === "VECTOR"));
    const made = {};
    for (const n of nodes) {
        let name = "";
        if (n.type === "ELLIPSE")
            name = n.width <= 12 ? "Status dot" : "Circle";
        else if (n.type === "VECTOR")
            name = "Icon path";
        else {
            const f = n;
            const text = f.findOne((c) => c.type === "TEXT");
            const kids = f.children;
            if (kids.length === 0)
                name = "Spacer";
            else if (kids.every((c) => c.type === "VECTOR" || c.type === "ELLIPSE" || c.type === "BOOLEAN_OPERATION"))
                name = "Icon";
            else if (text && kids.length === 1 && kids[0].type === "TEXT")
                name = "Label";
            else if (text)
                name = (f.layoutMode === "VERTICAL" ? "Stack: " : f.layoutMode === "HORIZONTAL" ? "Row: " : "Group: ") + text.characters.replace(/\s+/g, " ").slice(0, 24);
            else
                name = f.layoutMode === "VERTICAL" ? "Stack" : f.layoutMode === "HORIZONTAL" ? "Row" : "Container";
        }
        made[name.split(":")[0]] = (made[name.split(":")[0]] || 0) + 1;
        if (!p.dryRun)
            n.name = name;
    }
    return { dryRun: !!p.dryRun, renamed: nodes.length, byName: made };
}
function describeReaction(r) {
    const acts = r.actions || (r.action ? [r.action] : []);
    return {
        trigger: r.trigger ? r.trigger.type : null,
        actions: acts.map((a) => ({ type: a.type, navigation: a.navigation, destinationId: a.destinationId, transition: a.transition ? a.transition.type : undefined })),
    };
}
async function duplicateNodes(p) {
    const out = [];
    for (const n of await nodesFrom(p)) {
        const c = n.clone();
        const props = Object.assign({}, p.props || {});
        if (props.x === undefined && props.y === undefined && "width" in n)
            props.x = n.x + n.width + 24;
        await applyProps(c, props);
        out.push({ id: c.id, name: c.name, type: c.type });
    }
    return { created: out };
}
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: geen antwoord binnen ${ms / 1000} s`)), ms))]);
function collectInstances(n, out) {
    if (n.type === "INSTANCE")
        out.push(n);
    if ("children" in n)
        for (const c of n.children)
            collectInstances(c, out);
}
async function componentSetsFrom(p) {
    const sets = new Map();
    const skipped = [];
    const seenMain = new Set();
    let candidates = await nodesFrom(p);
    if (p.deep) {
        const inst = [];
        for (const n of candidates)
            collectInstances(n, inst);
        candidates = inst;
    }
    for (const n of candidates) {
        let s = n;
        try {
            if (n.type === "INSTANCE")
                s = await withTimeout(n.getMainComponentAsync(), 5000, `hoofdcomponent van ${n.name}`);
        }
        catch (e) {
            skipped.push({ node: n.name, id: n.id, reason: e.message });
            continue;
        }
        if (s && s.type === "COMPONENT") {
            if (seenMain.has(s.id))
                continue;
            seenMain.add(s.id);
            if (s.remote) {
                skipped.push({ node: n.name, id: n.id, reason: "komt uit een bibliotheek: voeg hover toe in het bibliotheekbestand" });
                continue;
            }
            s = s.parent;
        }
        if (!s || s.type !== "COMPONENT_SET") {
            if (!p.deep)
                skipped.push({ node: n.name, id: n.id, reason: "geen component set, variant of instance ervan" });
            continue;
        }
        sets.set(s.id, s);
    }
    return { sets: [...sets.values()], skipped };
}
async function setHover(p) {
    const ms = p.duration !== undefined ? +p.duration : 150;
    const kind = String(p.transition || "smart").toLowerCase();
    const transition = kind === "instant" ? null : {
        type: kind === "dissolve" ? "DISSOLVE" : "SMART_ANIMATE",
        easing: { type: String(p.easing || "EASE_OUT").toUpperCase() },
        duration: ms / 1000,
    };
    const result = [];
    const { sets, skipped } = await componentSetsFrom(p);
    for (const set of sets) {
        try {
            result.push(await hoverForSet(set, p, transition));
        }
        catch (e) {
            result.push({ set: set.name, id: set.id, error: e.message });
        }
    }
    return { sets: result, skipped };
}
async function hoverForSet(set, p, transition) {
    const variants = set.children.filter((c) => c.type === "COMPONENT");
    const defs = Object.keys(set.componentPropertyDefinitions || {}).filter((k) => set.componentPropertyDefinitions[k].type === "VARIANT");
    const toValue = String(p.to || "hover");
    const key = p.property
        ? defs.find((k) => same(k, String(p.property)))
        : defs.find((k) => (set.componentPropertyDefinitions[k].variantOptions || []).some((v) => same(v, toValue)));
    if (!key)
        return { set: set.name, id: set.id, error: `Geen variant-property met de waarde "${toValue}". Maak eerst een hover-variant.`, properties: defs };
    const options = set.componentPropertyDefinitions[key].variantOptions || [];
    const fromValue = p.from ? String(p.from) : options.find((v) => ["default", "rest", "normal", "idle", "base"].some((d) => same(v, d)));
    if (!fromValue)
        return { set: set.name, id: set.id, error: `Geef "from" mee: welke waarde van ${key} is de rusttoestand?`, options };
    const linked = [], missing = [];
    for (const src of variants) {
        const vp = src.variantProperties || {};
        if (!vp[key] || !same(vp[key], fromValue))
            continue;
        const dst = variants.find((v) => {
            const tp = v.variantProperties || {};
            return tp[key] && same(tp[key], toValue) && Object.keys(vp).every((k) => k === key || tp[k] === vp[k]);
        });
        if (!dst) {
            missing.push(src.name);
            continue;
        }
        const kept = src.reactions.filter((r) => !(r.trigger && r.trigger.type === "ON_HOVER"));
        await src.setReactionsAsync([...kept, {
                trigger: { type: "ON_HOVER" },
                actions: [{ type: "NODE", destinationId: dst.id, navigation: "CHANGE_TO", transition, resetVideoPosition: false }],
            }]);
        linked.push({ from: src.name, to: dst.name });
    }
    return { set: set.name, id: set.id, property: key, from: fromValue, to: toValue, linked, missing };
}
const GUARDED_COMMANDS = new Set([
    "apply_text_styles_auto", "create_text_styles_bulk", "bind_raw_colors", "snap_to_grid", "rename_generic", "dedupe_text_styles",
]);
const runningCommands = new Map();
let bridgeCancelRequested = false;
async function bridgeCommand(cmd, p) {
    if (cmd === "cancel") {
        bridgeCancelRequested = true;
        return { bridgeCancelRequested: true, running: Array.from(runningCommands.keys()) };
    }
    if (!GUARDED_COMMANDS.has(cmd))
        return runBridgeCommand(cmd, p);
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
    }
    finally {
        runningCommands.delete(cmd);
    }
}
async function runBridgeCommand(cmd, p) {
    var _a, _b;
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
                    children: pg.children.slice(0, 200).map((c) => ({ id: c.id, name: c.name, type: c.type, w: Math.round(c.width || 0), h: Math.round(c.height || 0) })),
                })),
            };
        }
        case "get_selection": {
            const out = [];
            for (const n of figma.currentPage.selection)
                out.push(await describeNode(n, +((_a = p.depth) !== null && _a !== void 0 ? _a : 1)));
            return { selection: out };
        }
        case "get_node": {
            const nodes = await nodesFrom(p);
            const out = [];
            for (const n of nodes)
                out.push(await describeNode(n, Math.min(+((_b = p.depth) !== null && _b !== void 0 ? _b : 2), 6)));
            return { nodes: out };
        }
        case "screenshot": return screenshot(p);
        case "get_variables": return getVariablesDump();
        case "get_styles": return getStylesDump();
        case "rubric_check": return rubricAudit();
        case "create": {
            const n = await createNode(p);
            return { id: n.id, name: n.name, type: n.type };
        }
        case "update": {
            const nodes = await nodesFrom(p);
            for (const n of nodes)
                await applyProps(n, p.props || {});
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
                if (p.name && nodes.length === 1)
                    c.name = p.name;
                return { id: c.id, name: c.name };
            });
            return { components: out };
        }
        case "combine_as_variants": {
            const nodes = await nodesFrom(p);
            const comps = nodes.map((n) => (n.type === "COMPONENT" ? n : figma.createComponentFromNode(n)));
            const parent = (comps[0].parent && "appendChild" in comps[0].parent ? comps[0].parent : figma.currentPage);
            const set = figma.combineAsVariants(comps, parent);
            if (p.name)
                set.name = p.name;
            return { id: set.id, name: set.name, variantProperties: Object.keys(set.componentPropertyDefinitions) };
        }
        case "duplicate": return duplicateNodes(p);
        case "set_hover": return setHover(p);
        case "create_variables": return createVariables(p);
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
        case "snap_to_grid": return snapToGrid(p);
        case "import_layout": return importLayout(p.doc, p.options || p);
        case "set_selection": {
            const nodes = await nodesFrom(p);
            figma.currentPage.selection = nodes;
            if (p.zoom !== false)
                figma.viewport.scrollAndZoomIntoView(nodes);
            return { selected: nodes.map((n) => n.id) };
        }
        case "notify":
            figma.notify(String(p.message || "").slice(0, 200));
            return { ok: true };
        default:
            throw new Error(`Onbekend commando "${cmd}"`);
    }
}
figma.on("currentpagechange", () => uiSend("x:page", { page: figma.currentPage.name, fileName: figma.root.name }));
figma.ui.on("message", async (msg) => {
    if (!isFeatureMessage(msg))
        return;
    try {
        switch (msg.type) {
            case "x:hello":
                uiSend("x:info", { featureVersion: FEATURE_VERSION, fileName: figma.root.name, page: figma.currentPage.name, bridge: (await figma.clientStorage.getAsync("bridge")) || null });
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
                }
                catch (e) {
                    uiSend("x:bridge-result", { id: msg.id, ok: false, error: errMsg(e) });
                }
                break;
        }
    }
    catch (e) {
        uiSend("x:error", { message: errMsg(e), during: msg.type });
    }
});
