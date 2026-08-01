# Figma Plugin Masterprompt — Bulletproof Extraction

This document is the authoritative reference for building a Figma plugin that extracts text, components, styles, variables, SVGs, and handles Lottie JSON import. It was developed through iterative debugging of the `figma-extract-all` plugin and captures every failure mode encountered.

---

## 0. Runtime Environment

Figma plugins run in a **single-threaded JavaScript sandbox** inside a WebAssembly-based engine. All plugin code, UI message delivery, and Figma API calls execute on one thread. Figma's C++ engine communicates with your JS via a **bridge** — every `node.children`, `node.parent`, `node.width` etc crosses this bridge and has latency.

---

## 1. Page Loading (MOST COMMON CRASH)

If your `manifest.json` uses `"documentAccess":"dynamic-page"`, Figma does NOT pre-load other pages. Accessing `.children` on unloaded pages throws:
> `Cannot access property 'children' on a page that has not been explicitly loaded.`

**Solution:** Always call before any enumeration:
```typescript
await figma.loadAllPagesAsync();
```
Alternatively, change to `"documentAccess":"all-pages"` in the manifest (costs memory).

---

## 2. The Single-Threaded Sandbox & Progress Updates

A long synchronous function call blocks ALL UI updates. `figma.ui.postMessage()` sends a message, but the UI cannot receive or render it until your handler returns or the event loop runs.

**Broken pattern:**
```typescript
figma.ui.postMessage({type:"progress", pct:5});
for(let i=0;i<10000;i++){ processNode(i); }  // sync — blocks all UI
figma.ui.postMessage({type:"progress", pct:95});
// User sees 0%, waits minutes, then sees 95% flash and complete
```

**Working pattern — `setTimeout` batch with yields:**
```typescript
let cursor=0; const BATCH_SIZE=200;
function processBatch(){
  if(cursor>=total) return finish();
  const end=Math.min(cursor+BATCH_SIZE,total);
  for(let i=cursor;i<end;i++){ processNode(i); }
  cursor=end;
  figma.ui.postMessage({type:"progress", current:cursor, total});
  setTimeout(processBatch, 0); // yields to UI event loop
}
setTimeout(processBatch, 10);
```
Handler calls `setTimeout(processBatch,10)` which fires in the next tick. Handler returns immediately — UI processes the "start" progress message. Each batch yields with `setTimeout(...,0)` so the progress bar updates smoothly and the Cancel button works.

---

## 3. Node Collection — NEVER use recursive JS tree walks

Every `node.children[i]` crosses the C++/JS bridge. For a document with 5000+ nodes, a recursive JS walk crosses the bridge ~5000 times, taking **seconds** during which the UI is frozen.

**Use Figma's native C++ walker:**

For whole-page extraction:
```typescript
const allNodes = (figma.currentPage as any).findAll(() => true) as SceneNode[];
```
This performs the entire traversal inside C++ and returns all nodes in ONE array — a single bridge crossing.

For selection-scoped extraction (usually <50 items):
```typescript
function deepFlatten(roots:BaseNode[]):SceneNode[]{
  const r:SceneNode[]=[];
  function w(n:BaseNode){if(n.type!=="PAGE")r.push(n as SceneNode);if("children" in n)for(const c of (n as any).children)w(c);}
  for(const ro of roots)w(ro);return r;
}
const selNodes = deepFlatten([...selection]);
```
Only use recursive JS walks on small scoped extractions.

---

## 4. postMessage Size Limits → Chunked ZIP Delivery

`figma.ui.postMessage()` silently drops messages exceeding ~64KB. Sending a large JSON as `type:"download-file"` will **fail silently** with no error.

**Always deliver via chunked ZIP:**
```typescript
// Plugin side (code.ts)
let zipFiles:{name:string, data:Uint8Array}[]=[];
function addToZip(name:string, content:string|Uint8Array){ /* add entry */ }
function flushZipChunked(nameBase:string){
  const zip=makeZip(zipFiles); // custom ZIP encoder
  zipFiles=[];
  const CHUNK=400000; // 400KB chunks
  for(let i=0;i<zip.length;i+=CHUNK){
    figma.ui.postMessage({type:"zip-chunk", fileName:name+"_extract.zip", index:Math.floor(i/CHUNK), total:Math.ceil(zip.length/CHUNK), bytes:Array.from(zip.subarray(i, Math.min(i+CHUNK, zip.length)))});
  }
}

// UI side (ui.html)
const chunks:Record<string,Uint8Array[]>={};
window.addEventListener("message",(e)=>{
  const m=e.data.pluginMessage;
  if(m.type==="zip-chunk"){
    if(!chunks[m.fileName])chunks[m.fileName]=[];
    chunks[m.fileName][m.index]=new Uint8Array(m.bytes);
    // Check if all chunks received
    let complete=true;
    for(let i=0;i<m.total;i++)if(!chunks[m.fileName][i]){complete=false;break;}
    if(complete){
      const totalLen=chunks[m.fileName].reduce((s,a)=>s+a.length,0);
      const result=new Uint8Array(totalLen);
      let pos=0;
      for(const c of chunks[m.fileName]){result.set(c,pos);pos+=c.length;}
      const blob=new Blob([result],{type:"application/zip"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download=m.fileName;
      a.click();URL.revokeObjectURL(url);
      delete chunks[m.fileName];
    }
  }
});
```

The built-in `download-file` message type is only safe for small text files (<64KB confirmed).

---

## 5. Avoid Expensive Per-Node Property Calls

These functions walk the parent chain for EVERY node — catastrophic at scale:
```typescript
function getPageName(node){    // walks node.parent until PAGE
function getParentPath(node){  // walks node.parent, builds path string
function getAbsolutePos(node){ // walks node.parent, sums x/y offsets
function getParentFrame(node){ // walks node.parent until FRAME/COMPONENT
}
```
For full-page extractions with thousands of nodes, use context:
```typescript
const pageName = figma.currentPage.name; // O(1)
const parentPath = "(deferred)";          // placeholder
const absolutePos = {x:0, y:0};          // placeholder
const parentFrame = "(deferred)";         // placeholder
```
Only walk parent chains for selection-scoped extractions (few nodes).

---

## 6. JSON Serialization Without Pretty-Print

`JSON.stringify(data, null, 2)` is 2-3× slower and produces 2-3× larger output than compact JSON:
```typescript
JSON.stringify(data) // compact, fast
```
For extraction results with thousands of text entries, this matters.

---

## 7. Empty/Shallow Hierarchies

Building a recursive `children:[]` tree mirroring the entire document creates a massive object that `JSON.stringify` takes seconds to process. Use an empty array for hierarchy — it's not needed for AI/export purposes:

```typescript
return { ..., hierarchy: [] };
```

---

## 8. Fire-and-Forget Extras

After the core extraction (text + components) completes, optional extras (variables, styles, SVGs, Lottie bundles) should run in a background async IIFE that does NOT block the handler:

```typescript
// Core extraction delivers immediately, then:
if(opts){(async()=>{
  try{
    await fetchVars(baseName);
    await fetchStyles(baseName);
    if(opts.includeSVGs){ /* batch SVG export with try/catch per batch */ }
    if(zipFiles.length>0)flushZipChunked(baseName+"_extras");
  }catch(e){figma.ui.postMessage({type:"error",message:"Extras: "+e.message});}
})();}
```

---

## 9. Batch Export Pattern (SVGs/PNGs)

Each `exportAsync` is an async API call. Batch them with `Promise.all` but ALWAYS wrap in try/catch:

```typescript
const BATCH=4;
for(let i=0;i<allNodes.length&&!cancelRequested;i+=BATCH){
  try{
    const results=await Promise.all(
      allNodes.slice(i,i+BATCH).map(n=>n.exportAsync({format:"SVG"}))
    );
    for(const buf of results) if(buf) zipFiles.push({name:..., data:buf});
  }catch(e){/* continue to next batch — don't die */}
  figma.ui.postMessage({type:"progress", current:Math.min(i+BATCH, allNodes.length), total:allNodes.length});
}
```

---

## 10. Safe Property Access

Always guard property access on nodes returned from `findAll()`:
```typescript
const width = ("width" in node) ? Math.round((node as any).width*100)/100 : 0;
const height = ("height" in node) ? Math.round((node as any).height*100)/100 : 0;
const childCount = (node as any).children ? (node as any).children.length : 0;
```

Page objects from `loadAllPagesAsync()` also need guards:
```typescript
const topFrames = (pgd.children||[]).map(c=>({...}));
pages.push({..., background: pgd.backgrounds?.length>0 ? JSON.parse(JSON.stringify(pgd.backgrounds[0])) : null });
```

---

## 11. Lottie JSON Import (Not dotLottie)

dotLottie (`.lottie`) is proprietary. Only accept plain JSON:
```typescript
// ui.html
const reader=new FileReader();
reader.onload=function(e){
  let json;
  try{json=JSON.parse(e.target.result);}
  catch(ex){log("Invalid JSON","err");return;}
  if(!json.fr||!json.op||!json.w||!json.h){log("Not a valid Lottie file","err");return;}
  parent.postMessage({pluginMessage:{type:"import-lottie-json", fileName:file.name, content:e.target.result}},"*");
};
reader.readAsText(file);
```

For GIF rendering from Lottie, use lottie-web + canvas + omggif (all bundled for zero network access).

---

## 12. Duplicate-Run Guard

Prevent user from clicking Extract twice:
```typescript
let runningExtract=false;
figma.ui.onmessage=async(msg)=>{
  if(msg.type==="get-full-extract"){
    if(runningExtract){figma.ui.postMessage({type:"error",message:"Already extracting"});return;}
    runningExtract=true;
    // ... extraction ends with runningExtract=false
  }
};
```

---

## 13. Complete Extraction Pipeline (TL;DR)

```
1. await figma.loadAllPagesAsync()          ← Required for dynamic-page manifest
2. const nodes = figma.currentPage.findAll() ← C++ native, single bridge call
3. setTimeout batch: 200 nodes/tick          ← Progress bar renders, Cancel works
4. for(const n of nodes){ type, text, comps } ← Flat loop, no parent walks
5. data = { texts, comps, pages:[], hierarchy:[] } ← Compact, no deep tree
6. addToZip("data.json", JSON.stringify(data))    ← Compact JSON
7. flushZipChunked(name)                  ← Chunked ZIP to UI
8. (async()=>{ vars, styles, svgs })()    ← Fire-and-forget extras
```

---

## 14. Manifest Configuration

```json
{
  "name": "Extract All",
  "id": "...",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma"],
  "documentAccess": "dynamic-page",
  "networkAccess": { "allowedDomains": ["none"] }
}
```
- `dynamic-page` = opt-in page loading (call `loadAllPagesAsync()`)
- `networkAccess: none` = no network requests (all dependencies bundled)
- `editorType: ["figma"]` = Figma design files only