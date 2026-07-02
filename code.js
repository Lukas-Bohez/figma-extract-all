"use strict";
const EXPORTABLE_TYPES = [
    "BOOLEAN_OPERATION", "COMPONENT", "COMPONENT_SET",
    "ELLIPSE", "FRAME", "GROUP", "INSTANCE", "LINE",
    "POLYGON", "RECTANGLE", "SECTION", "STAR", "TEXT", "VECTOR",
];
const PLUGIN_VERSION = "2.0.0";
function sanitizeName(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.+$/, "").trim() || "unnamed";
}
function rgbToHex(r, g, b) {
    const toHex = (n) => {
        const h = Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16);
        return h.length === 1 ? "0" + h : h;
    };
    return "#" + toHex(r) + toHex(g) + toHex(b);
}
function rgbaToCSS(r, g, b, a) {
    const ri = Math.round(r * 255);
    const gi = Math.round(g * 255);
    const bi = Math.round(b * 255);
    if (a >= 1)
        return `rgb(${ri}, ${gi}, ${bi})`;
    return `rgba(${ri}, ${gi}, ${bi}, ${Math.round(a * 100) / 100})`;
}
function getPageName(node) {
    let current = node;
    while (current) {
        if (current.type === "PAGE")
            return current.name;
        current = current.parent;
    }
    return "(no page)";
}
function getParentPath(node) {
    const parts = [];
    let current = node.parent || null;
    while (current) {
        if (current.type === "PAGE") {
            parts.unshift(current.name);
            break;
        }
        if (current.type === "FRAME" || current.type === "GROUP" ||
            current.type === "COMPONENT" || current.type === "COMPONENT_SET" ||
            current.type === "SECTION") {
            parts.unshift(current.name);
        }
        current = current.parent || null;
    }
    return parts.join(" > ") || "(root)";
}
function getParentFrame(node) {
    let current = node.parent || null;
    while (current) {
        if (current.type === "FRAME" || current.type === "COMPONENT" ||
            current.type === "COMPONENT_SET" || current.type === "SECTION") {
            return current.name;
        }
        current = current.parent || null;
    }
    return "(no frame)";
}
function getAbsolutePosition(node) {
    let absX = 0;
    let absY = 0;
    let current = node;
    while (current && current.type !== "PAGE") {
        if ("x" in current && "y" in current) {
            absX += current.x;
            absY += current.y;
        }
        current = current.parent || null;
    }
    return { x: absX, y: absY };
}
function flattenNodeTree(root, predicate) {
    const results = [];
    function walk(node) {
        if ("children" in node) {
            for (const child of node.children) {
                const sceneNode = child;
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
function buildHierarchy(root) {
    const nodes = [];
    if ("children" in root) {
        for (const child of root.children) {
            const sceneChild = child;
            const node = {
                id: sceneChild.id,
                name: sceneChild.name,
                type: sceneChild.type,
                childCount: "children" in sceneChild ? sceneChild.children.length : 0,
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
function isExportable(node) {
    return node.visible !== false && EXPORTABLE_TYPES.indexOf(node.type) >= 0;
}
function extractFills(fills) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    if (fills === figma.mixed)
        return [];
    const result = [];
    for (const f of fills) {
        if (f.type === "SOLID" && f.color) {
            result.push({
                type: "SOLID",
                hex: rgbToHex(f.color.r, f.color.g, f.color.b),
                rgba: { r: f.color.r, g: f.color.g, b: f.color.b, a: (_a = f.opacity) !== null && _a !== void 0 ? _a : 1 },
                opacity: (_b = f.opacity) !== null && _b !== void 0 ? _b : 1,
                visible: (_c = f.visible) !== null && _c !== void 0 ? _c : true,
                blendMode: (_d = f.blendMode) !== null && _d !== void 0 ? _d : "NORMAL",
                boundVariableId: ((_f = (_e = f.boundVariables) === null || _e === void 0 ? void 0 : _e.color) === null || _f === void 0 ? void 0 : _f.id) || null,
            });
        }
        else if (f.type === "GRADIENT_LINEAR" || f.type === "GRADIENT_RADIAL" || f.type === "GRADIENT_ANGULAR" || f.type === "GRADIENT_DIAMOND") {
            const stops = ((_g = f.gradientStops) === null || _g === void 0 ? void 0 : _g.map((s) => ({
                position: s.position,
                hex: rgbToHex(s.color.r, s.color.g, s.color.b),
                rgba: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
            }))) || [];
            result.push({
                type: f.type,
                hex: stops.length > 0 ? stops[0].hex : "#000000",
                rgba: stops.length > 0 ? stops[0].rgba : { r: 0, g: 0, b: 0, a: 1 },
                opacity: (_h = f.opacity) !== null && _h !== void 0 ? _h : 1,
                visible: (_j = f.visible) !== null && _j !== void 0 ? _j : true,
                blendMode: (_k = f.blendMode) !== null && _k !== void 0 ? _k : "NORMAL",
                boundVariableId: null,
            });
        }
        else {
            result.push({
                type: f.type,
                hex: "#000000",
                rgba: { r: 0, g: 0, b: 0, a: 1 },
                opacity: (_l = f.opacity) !== null && _l !== void 0 ? _l : 1,
                visible: (_m = f.visible) !== null && _m !== void 0 ? _m : true,
                blendMode: (_o = f.blendMode) !== null && _o !== void 0 ? _o : "NORMAL",
                boundVariableId: null,
            });
        }
    }
    return result;
}
function extractTextData(node) {
    let lineHeight = null;
    const lh = node.lineHeight;
    if (lh !== figma.mixed && typeof lh === "object" && "value" in lh && "unit" in lh) {
        lineHeight = { value: lh.value, unit: lh.unit };
    }
    let letterSpacing = null;
    const ls = node.letterSpacing;
    if (ls !== figma.mixed && typeof ls === "object" && "value" in ls && "unit" in ls) {
        letterSpacing = { value: ls.value, unit: ls.unit };
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
        fontWeight: typeof node.fontWeight === "number" ? node.fontWeight : 400,
        lineHeight,
        letterSpacing,
        textAlignHorizontal: node.textAlignHorizontal,
        textAlignVertical: node.textAlignVertical,
        fills: extractFills(node.fills),
        opacity: Math.round(node.opacity * 100) / 100,
        textAutoResize: node.textAutoResize,
        textTruncation: node.textTruncation || "DISABLED",
        maxLines: node.maxLines || null,
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
            for (const mode of col.modes) {
                modeMap[col.id][mode.modeId] = mode.name;
            }
        }
        for (const v of localVars) {
            const enriched = {};
            const rawValues = v.valuesByMode || {};
            const varCollectionId = v.variableCollectionId || "";
            for (const [modeId, value] of Object.entries(rawValues)) {
                const modeName = ((_a = modeMap[varCollectionId]) === null || _a === void 0 ? void 0 : _a[modeId]) || modeId;
                if (value && typeof value === "object" && "r" in value) {
                    enriched[modeName] = {
                        raw: value,
                        hex: rgbToHex(value.r, value.g, value.b),
                        css: rgbaToCSS(value.r, value.g, value.b, value.a || 1),
                    };
                }
                else {
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
                remote: v.remote || false,
            });
        }
    }
    catch (_) {
    }
    return vars;
}
async function extractAllStyles() {
    var _a, _b;
    const styles = [];
    try {
        const paintStyles = await figma.getLocalPaintStylesAsync();
        const textStyles = await figma.getLocalTextStylesAsync();
        const effectStyles = await figma.getLocalEffectStylesAsync();
        const gridStyles = await figma.getLocalGridStylesAsync();
        for (const s of paintStyles) {
            const paints = s.paints && s.paints.length > 0 ? extractFills(s.paints) : undefined;
            styles.push({
                id: s.id, name: s.name, key: s.key, styleType: s.type,
                description: s.description || "", paints, remote: s.remote || false,
            });
        }
        for (const s of textStyles) {
            styles.push({
                id: s.id, name: s.name, key: s.key, styleType: s.type,
                description: s.description || "",
                fontSize: s.fontSize,
                fontFamily: ((_a = s.fontName) === null || _a === void 0 ? void 0 : _a.family) || undefined,
                fontWeight: ((_b = s.fontName) === null || _b === void 0 ? void 0 : _b.style) || undefined,
                lineHeight: s.lineHeight && typeof s.lineHeight === "object" && "value" in s.lineHeight
                    ? { value: s.lineHeight.value, unit: s.lineHeight.unit } : null,
                remote: s.remote || false,
            });
        }
        for (const s of effectStyles) {
            styles.push({
                id: s.id, name: s.name, key: s.key, styleType: s.type,
                description: s.description || "", remote: s.remote || false,
            });
        }
        for (const s of gridStyles) {
            styles.push({
                id: s.id, name: s.name, key: s.key, styleType: s.type,
                description: s.description || "", remote: s.remote || false,
            });
        }
    }
    catch (_) { }
    return styles;
}
function extractAllComponents() {
    const components = [];
    try {
        for (const page of figma.root.children) {
            function walk(node) {
                if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
                    const comp = node;
                    const sceneComp = node;
                    let variantProps = null;
                    if (node.type === "COMPONENT_SET") {
                        const csNode = node;
                        const rawProps = csNode.variantGroupProperties || {};
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
                        childCount: "children" in node ? node.children.length : 0,
                    });
                }
                if ("children" in node) {
                    for (const child of node.children) {
                        walk(child);
                    }
                }
            }
            walk(page);
        }
    }
    catch (_) { }
    return components;
}
function extractPages() {
    const pages = [];
    for (const page of figma.root.children) {
        pages.push({
            id: page.id,
            name: page.name,
            nodeCount: flattenNodeTree(page).length,
            background: typeof page.backgrounds !== "undefined" && page.backgrounds.length > 0
                ? JSON.parse(JSON.stringify(page.backgrounds[0]))
                : null,
            topLevelFrames: (page.children || []).map((c) => ({
                id: c.id,
                name: c.name,
                width: Math.round(c.width * 100) / 100,
                height: Math.round(c.height * 100) / 100,
                childCount: "children" in c ? c.children.length : 0,
            })),
        });
    }
    return pages;
}
async function exportNodeAsSVGEmbedded(nodeId) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT")
        return null;
    const sceneNode = node;
    try {
        const svgString = await sceneNode.exportAsync({ format: "SVG_STRING" });
        if (!svgString || svgString.length < 10)
            return null;
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
    }
    catch (_) {
        return null;
    }
}
async function buildFullExtract(onProgress) {
    const currentPage = figma.currentPage;
    const report = (step, totalSteps, label, detail) => {
        if (onProgress)
            onProgress({ step, totalSteps, label, detail });
    };
    const totalSteps = 8;
    report(0, totalSteps, "Initializing", "Scanning document...");
    const allTextScenes = flattenNodeTree(currentPage, (n) => n.type === "TEXT");
    const textNodes = allTextScenes.map((n) => extractTextData(n));
    report(1, totalSteps, "Text extracted", `${textNodes.length} text nodes found`);
    const variables = await extractAllVariables();
    report(2, totalSteps, "Variables extracted", `${variables.length} variables found`);
    const styles = await extractAllStyles();
    report(3, totalSteps, "Styles extracted", `${styles.length} styles found`);
    const components = extractAllComponents();
    report(4, totalSteps, "Components extracted", `${components.length} components found`);
    const pages = extractPages();
    report(5, totalSteps, "Pages extracted", `${pages.length} pages`);
    const allNodes = flattenNodeTree(currentPage);
    const exportableNodes = allNodes.filter(isExportable);
    report(6, totalSteps, "Exporting SVGs", `0 / ${exportableNodes.length}`);
    const svgs = [];
    const batchSize = 15;
    for (let i = 0; i < exportableNodes.length; i += batchSize) {
        const batch = exportableNodes.slice(i, i + batchSize);
        const promises = batch.map((n) => exportNodeAsSVGEmbedded(n.id));
        const results = await Promise.all(promises);
        for (const r of results) {
            if (r)
                svgs.push(r);
        }
        report(6, totalSteps, "Exporting SVGs", `${Math.min(i + batchSize, exportableNodes.length)} / ${exportableNodes.length}`);
    }
    const hierarchy = buildHierarchy(currentPage);
    report(7, totalSteps, "Building hierarchy", `${hierarchy.length} top-level nodes`);
    const byType = {};
    let total = 0, frames = 0, comps = 0, instances = 0;
    function walkCount(node) {
        if ("children" in node) {
            for (const child of node.children) {
                total++;
                const t = child.type;
                byType[t] = (byType[t] || 0) + 1;
                if (t === "FRAME" || t === "SECTION")
                    frames++;
                if (t === "COMPONENT" || t === "COMPONENT_SET")
                    comps++;
                if (t === "INSTANCE")
                    instances++;
                walkCount(child);
            }
        }
    }
    walkCount(currentPage);
    const result = {
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
async function exportNodes(nodeIds, format, scale) {
    const results = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || node.type === "PAGE" || node.type === "DOCUMENT")
            continue;
        const sceneNode = node;
        try {
            let bytes;
            switch (format) {
                case "SVG":
                    bytes = await sceneNode.exportAsync({ format: "SVG" });
                    break;
                case "PNG":
                    bytes = await sceneNode.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
                    break;
                case "JPG":
                    bytes = await sceneNode.exportAsync({ format: "JPG", constraint: { type: "SCALE", value: scale } });
                    break;
                case "PDF":
                    bytes = await sceneNode.exportAsync({ format: "PDF" });
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
        }
        catch (err) {
            console.error(`Failed to export node ${node.name}:`, err);
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
    catch (err) {
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
        selectedTypes: sel.map((n) => n.type),
    });
}
function buildPlainTextDump(textNodes) {
    const lines = [];
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
        const safeChars = t.characters.replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{0080}-\u{009F}]/gu, "[icon]");
        lines.push("  Text:      " + safeChars);
        lines.push("");
    }
    lines.push("── END ──");
    lines.push("  " + textNodes.length + " text nodes total");
    return lines.join("\n");
}
async function buildLottieExportBundle(nodeIds) {
    const items = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || node.type === "PAGE" || node.type === "DOCUMENT")
            continue;
        try {
            const svgString = await node.exportAsync({ format: "SVG_STRING" });
            items.push({
                id: node.id, name: sanitizeName(node.name), type: node.type,
                pageName: getPageName(node), width: node.width,
                height: node.height, svg: svgString,
            });
        }
        catch (err) {
            console.error("Lottie export failed:", err);
        }
    }
    return {
        fileName: `${sanitizeName(figma.root.name)}_lottie.json`,
        exportDate: new Date().toISOString(),
        source: figma.root.name || "Untitled",
        items,
    };
}
function summarizeLottieImport(fileName, content) {
    try {
        const parsed = JSON.parse(content);
        const topLevelKeys = parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
        const layers = Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.layers) ? parsed.layers.length : 0;
        return {
            fileName, valid: true, topLevelKeys, layerCount: layers,
            warning: layers === 0 ? "No top-level layers array found." : "Imported successfully.",
        };
    }
    catch (err) {
        return { fileName, valid: false, topLevelKeys: [], layerCount: 0, warning: "Could not parse as JSON." };
    }
}
figma.showUI(__html__, {
    width: 520,
    height: 680,
    title: "Extract All — Figma to Anything",
});
figma.on("selectionchange", postSelectionState);
figma.on("currentpagechange", postSelectionState);
postSelectionState();
figma.ui.onmessage = async (msg) => {
    if (msg.type === "get-full-extract") {
        const data = await buildFullExtract((progress) => {
            figma.ui.postMessage({ type: "full-extract-progress", progress });
        });
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
        const jsonStr = JSON.stringify(data, null, 2);
        figma.ui.postMessage({
            type: "download-file",
            fileName: `${sanitizeName(figma.root.name)}_full-extract.json`,
            content: jsonStr,
            mimeType: "application/json",
        });
        const txtContent = buildPlainTextDump(data.textNodes);
        figma.ui.postMessage({
            type: "download-file",
            fileName: `${sanitizeName(figma.root.name)}_text.txt`,
            content: txtContent,
            mimeType: "text/plain",
        });
        for (const svgItem of data.svgs) {
            figma.ui.postMessage({
                type: "download-file",
                fileName: `svgs/${svgItem.pageName}/${svgItem.nodeName}.svg`,
                content: svgItem.svg,
                mimeType: "image/svg+xml",
            });
        }
    }
    if (msg.type === "get-text") {
        const textNodes = flattenNodeTree(figma.currentPage, (n) => n.type === "TEXT").map((n) => extractTextData(n));
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
    if (msg.type === "get-variables") {
        const vars = await extractAllVariables();
        figma.ui.postMessage({
            type: "download-file",
            fileName: `${sanitizeName(figma.root.name)}_variables.json`,
            content: JSON.stringify(vars, null, 2),
            mimeType: "application/json",
        });
    }
    if (msg.type === "get-styles") {
        const styles = await extractAllStyles();
        figma.ui.postMessage({
            type: "download-file",
            fileName: `${sanitizeName(figma.root.name)}_styles.json`,
            content: JSON.stringify(styles, null, 2),
            mimeType: "application/json",
        });
    }
    if (msg.type === "get-components") {
        const components = extractAllComponents();
        figma.ui.postMessage({
            type: "download-file",
            fileName: `${sanitizeName(figma.root.name)}_components.json`,
            content: JSON.stringify(components, null, 2),
            mimeType: "application/json",
        });
    }
    if (msg.type === "get-pages") {
        const pages = extractPages();
        figma.ui.postMessage({
            type: "download-file",
            fileName: `${sanitizeName(figma.root.name)}_pages.json`,
            content: JSON.stringify(pages, null, 2),
            mimeType: "application/json",
        });
    }
    if (msg.type === "export-selected-svg" || msg.type === "export-selected-png" || msg.type === "export-selected-jpg") {
        const selection = figma.currentPage.selection;
        if (selection.length === 0) {
            figma.ui.postMessage({ type: "error", message: "No nodes selected." });
            return;
        }
        const format = msg.type === "export-selected-svg" ? "SVG" : msg.type === "export-selected-png" ? "PNG" : "JPG";
        const scaleNum = format === "SVG" ? (msg.scale || 1) : (msg.scale || 2);
        const results = await exportNodes(selection.map((n) => n.id), format, scaleNum);
        figma.ui.postMessage({ type: "export-results", results });
    }
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
    if (msg.type === "export-lottie-json") {
        const selection = figma.currentPage.selection;
        if (selection.length === 0) {
            figma.ui.postMessage({ type: "error", message: "No nodes selected." });
            return;
        }
        const bundle = await buildLottieExportBundle(selection.map((n) => n.id));
        figma.ui.postMessage({
            type: "download-file",
            fileName: bundle.fileName,
            content: JSON.stringify(bundle, null, 2),
            mimeType: "application/json",
        });
    }
    if (msg.type === "import-lottie-json") {
        const summary = summarizeLottieImport(msg.fileName || "lottie.json", String(msg.content || ""));
        figma.ui.postMessage({ type: "lottie-import-summary", summary });
    }
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
                for (const r of results)
                    r.name = sanitizeName(page.name) + "/" + r.name;
                figma.ui.postMessage({ type: "export-results", results });
                processedNodes += batch.length;
                figma.ui.postMessage({ type: "progress", current: Math.min(processedNodes, totalNodes), total: totalNodes, label: format + " all pages" });
            }
        }
        figma.ui.postMessage({ type: "export-complete" });
    }
    if (msg.type === "resize")
        figma.ui.resize(msg.width, msg.height);
    if (msg.type === "close")
        figma.closePlugin();
};
