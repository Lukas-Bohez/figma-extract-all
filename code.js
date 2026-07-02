"use strict";
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
function sanitizeName(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.+$/, "").trim() || "unnamed";
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
function countNodeTypes(root) {
    const byType = {};
    let total = 0;
    function walk(node) {
        if ("children" in node) {
            for (const child of node.children) {
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
function objectFromEntries(entries) {
    const obj = {};
    for (const [key, value] of entries) {
        obj[key] = value;
    }
    return obj;
}
function isExportable(node) {
    return node.visible !== false && EXPORTABLE_TYPES.indexOf(node.type) >= 0;
}
function postSelectionState() {
    figma.ui.postMessage({
        type: "selection-state",
        count: figma.currentPage.selection.length,
        pageName: figma.currentPage.name,
    });
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
    return {
        id: node.id,
        name: node.name,
        type: node.type,
        pageName: getPageName(node),
        characters: node.characters,
        fontName: typeof node.fontName === "object" && "family" in node.fontName
            ? { family: node.fontName.family, style: node.fontName.style }
            : null,
        fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
        fontWeight: typeof node.fontWeight === "number" ? node.fontWeight : 400,
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
async function extractAllVariables() {
    const vars = [];
    try {
        const localVars = await figma.variables.getLocalVariablesAsync();
        for (const v of localVars) {
            vars.push({
                id: v.id,
                name: v.name,
                resolvedType: v.resolvedType,
                valuesByMode: v.valuesByMode,
                scopes: v.scopes || [],
                codeSyntax: v.codeSyntax || {},
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
    const styles = [];
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
                remote: s.remote || false,
            });
        }
    }
    catch (_) {
    }
    return styles;
}
function extractAllComponents(currentPage) {
    const components = [];
    try {
        const compNodes = figma.root.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] });
        for (const comp of compNodes) {
            const componentNode = comp;
            const isComponentSet = comp.type === "COMPONENT_SET";
            let variantProps = null;
            if (isComponentSet) {
                const csNode = comp;
                const rawProps = csNode.variantGroupProperties || csNode.variantProperties || {};
                variantProps = objectFromEntries(Object.keys(rawProps).map((k) => [k, String(rawProps[k])]));
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
    }
    catch (_) {
    }
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
        });
    }
    return pages;
}
async function buildFullExtract(currentPage, onProgress) {
    const totalSteps = 6;
    const reportProgress = (current, label) => {
        if (onProgress) {
            onProgress({ current, total: totalSteps, label });
        }
    };
    reportProgress(0, "Starting full extract");
    const allTextNodes = flattenNodeTree(currentPage, (n) => n.type === "TEXT").map((n) => extractTextData(n));
    reportProgress(1, "Extracted text nodes");
    const variables = await extractAllVariables();
    reportProgress(2, "Extracted variables");
    const styles = await extractAllStyles();
    reportProgress(3, "Extracted styles");
    const components = extractAllComponents(currentPage);
    reportProgress(4, "Extracted components");
    const pages = extractPages();
    reportProgress(5, "Extracted page data");
    const nodeCounts = countNodeTypes(currentPage);
    reportProgress(6, "Full extract complete");
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
async function buildLottieExportBundle(nodeIds) {
    const items = [];
    for (const id of nodeIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || node.type === "PAGE" || node.type === "DOCUMENT") {
            continue;
        }
        try {
            const svgString = await node.exportAsync({
                format: "SVG_STRING",
            });
            items.push({
                id: node.id,
                name: sanitizeName(node.name),
                type: node.type,
                pageName: getPageName(node),
                width: node.width,
                height: node.height,
                svg: svgString,
            });
        }
        catch (err) {
            console.error(`Failed to build Lottie export for ${node.name}:`, err);
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
            fileName,
            valid: true,
            topLevelKeys,
            layerCount: layers,
            warning: layers === 0 ? "No top-level layers array was found." : "Imported successfully.",
        };
    }
    catch (err) {
        return {
            fileName,
            valid: false,
            topLevelKeys: [],
            layerCount: 0,
            warning: "The file could not be parsed as JSON.",
        };
    }
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
                    bytes = await sceneNode.exportAsync({
                        format: "SVG",
                    });
                    break;
                case "PNG":
                    bytes = await sceneNode.exportAsync({
                        format: "PNG",
                        constraint: { type: "SCALE", value: scale },
                    });
                    break;
                case "JPG":
                    bytes = await sceneNode.exportAsync({
                        format: "JPG",
                        constraint: { type: "SCALE", value: scale },
                    });
                    break;
                case "PDF":
                    bytes = await sceneNode.exportAsync({
                        format: "PDF",
                    });
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
        const svgString = await node.exportAsync({
            format: "SVG_STRING",
        });
        return { id: node.id, name: sanitizeName(node.name), svg: svgString };
    }
    catch (err) {
        console.error(`Failed to export SVG string for ${node.name}:`, err);
        return null;
    }
}
figma.showUI(__html__, {
    width: 480,
    height: 640,
    title: "Extract All – Figma to Anything",
});
figma.on("selectionchange", postSelectionState);
figma.on("currentpagechange", postSelectionState);
postSelectionState();
figma.ui.onmessage = async (msg) => {
    if (msg.type === "get-full-extract") {
        const currentPage = figma.currentPage;
        const data = await buildFullExtract(currentPage, (progress) => {
            figma.ui.postMessage({ type: "full-extract-progress", progress });
        });
        figma.ui.postMessage({ type: "full-extract", data });
        const jsonStr = JSON.stringify(data, null, 2);
        figma.ui.postMessage({
            type: "download-file",
            fileName: `${sanitizeName(figma.root.name)}_full-extract.json`,
            content: jsonStr,
            mimeType: "application/json",
        });
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
    if (msg.type === "get-text") {
        const textNodes = flattenNodeTree(figma.currentPage, (n) => n.type === "TEXT").map((n) => extractTextData(n));
        figma.ui.postMessage({
            type: "download-file",
            fileName: `${sanitizeName(figma.root.name)}_text.json`,
            content: JSON.stringify(textNodes, null, 2),
            mimeType: "application/json",
        });
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
        const components = extractAllComponents(figma.currentPage);
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
    if (msg.type === "export-all-svg-page" || msg.type === "export-all-png-page") {
        const format = msg.type === "export-all-svg-page" ? "SVG" : "PNG";
        const scaleNum = format === "SVG" ? (msg.scale || 1) : (msg.scale || 2);
        await batchExportPage(figma.currentPage, format, scaleNum, false);
        figma.ui.postMessage({ type: "export-complete" });
    }
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
    if (msg.type === "resize") {
        figma.ui.resize(msg.width, msg.height);
    }
    if (msg.type === "close") {
        figma.closePlugin();
    }
};
async function batchExportPage(page, format, scale, isAllPages) {
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
