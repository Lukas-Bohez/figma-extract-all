# Figma Plugin Extraction Masterprompt

## Critical Rules for Figma Plugin Development

### 1. DynamicPageAccess & Page Loading (MOST CRITICAL)

**Problem:** `manifest.json` with `"documentAccess":"dynamic-page"` means Figma does NOT preload all pages. Accessing `figma.root.children` or any page's `.children` property will throw: `Cannot access property 'children' on a page that has not been explicitly loaded.`

**Fix:** Before any page enumeration, call:
```typescript
await figma.loadAllPagesAsync();
```
This must be the FIRST operation in any "extract all" or "batch export" flow. Without it, the plugin crashes on multi-page files.

**Alternative:** Use `"documentAccess":"all-pages"` in manifest to auto-load all pages at start (but incurs memory cost).

### 2. Single-Threaded Plugin Sandbox & Progress

**The fundamental constraint:** Figma runs plugin code on a single thread. ALL operations (plugin code, UI message delivery, state updates) execute sequentially. A long synchronous function **blocks everything** — progress bars, cancel buttons, error messages — nothing renders until the function returns.

**Fatal pattern:**
```typescript
// NEVER do this:
figma.ui.postMessage({type:"progress", pct:10});
for(let i=0;i<100000;i++){ /* heavy work */ }
figma.ui.postMessage({type:"progress", pct:90});
// Progress bar shows 10%, then jumps to 90% — user sees it stuck at 10% for minutes
```

**Correct pattern — batch with setTimeout yields:**
```typescript
let cursor=0; const BATCH=200;
function processBatch(){
  if(cursor>=total) return finish();
  const end=Math.min(cursor+BATCH,total);
  for(let i=cursor;i<end;i++){ /* process node */ }
  cursor=end;
  figma.ui.postMessage({type:"progress", pct:Math.round(cursor*100/total)});
  setTimeout(processBatch, 0); // yields to UI event loop
}
setTimeout(processBatch, 10);
```

Every `setTimeout` tick lets Figma's event loop process queued UI messages. The progress bar updates smoothly. The Cancel button works.

### 3. Node Collection: NEVER use recursive JS tree walks for large documents

**Why:** Every `node.children[i]` access crosses the C++/JS bridge. For documents with 5000+ nodes, this is thousands of bridge crossings that cumulatively block for seconds.

**Fast path (docs with no selection):**
```typescript
const allNodes = (figma.currentPage as any).findAll(() => true) as SceneNode[];
```
`findAll()` performs the tree traversal INSIDE Figma's C++ engine and returns all nodes in ONE array. Single bridge crossing, regardless of document size.

**Slow path (selections — usually small):**
```typescript
const allNodes = deepFlatten(selectionRoots);
```
For selections (usually <50 items), recursive JS walk is acceptable.

### 4. HTML Message Size Limits

`figma.ui.postMessage` has internal size limits (~64KB-128KB). Sending a large JSON as a single `download-file` message will be **silently dropped** by Figma.

**Always use chunked ZIP for any data that might exceed 10KB:**
```typescript
function flushZipChunked(nameBase:string){
  if(zipFiles.length===0)return;
  const zip=makeZip(zipFiles); // encode to binary
  zipFiles=[];
  const CHUNK=400000; // 400KB per chunk
  for(let i=0;i<zip.length;i+=CHUNK){
    figma.ui.postMessage({type:"zip-chunk", fileName:name, index:i/CHUNK, total:Math.ceil(zip.length/CHUNK), bytes:Array.from(zip.slice(i,i+CHUNK))});
  }
}
```
The UI reassembles chunks in JavaScript and creates a Blob download.

### 5. Avoid Expensive Per-Node Property Access

Walking parent chains per node is catastrophic:
```typescript
// SLOW — walks parent chain for EVERY node
function getPageName(node){ let c=node.parent; while(c&&c.type!=="PAGE")c=c.parent; return c?.name||"";}

// FAST — use known page name from context
const pageName = figma.currentPage.name;
```
For full-page extractions with thousands of nodes, use the current page name directly. Only walk parent chains for selection-scoped extractions (few nodes).

### 6. JSON Serialization Performance

`JSON.stringify(data, null, 2)` (pretty-printed) is 2-3× slower and 2-3× larger than compact JSON:
```typescript
JSON.stringify(data) // compact — fast
JSON.stringify(data, null, 2) // pretty — slow, large
```
For large datasets, the pretty-print overhead can add seconds.

### 7. async vs sync in Plugin Handlers

**The pattern that works:**
- Handler calls `setTimeout` to defer all heavy work to the next event loop tick
- Handler returns immediately — UI messages get processed
- Within the `setTimeout` callback, sync operations (node walking, text extraction) execute
- Between batches, `setTimeout(processBatch,0)` yields to UI

**What DOESN'T work:**
- `await` inside the handler for long sync work — still blocks the event loop
- Firing async operations and hoping messages deliver — they won't until the sync call finishes

### 8. Reliable Download Mechanism

| Method | Reliability | Max Size |
|--------|-------------|----------|
| `download-file` message | ❌ Silent failure if >64KB | ~64KB |
| Chunked ZIP | ✅ Always works | Unlimited |
| Individual small files | ✅ For <64KB files | ~64KB each |

**Rule:** Always use chunked ZIP as the PRIMARY delivery mechanism. Use `download-file` only for text files known to be small (<64KB).

### 9. Manifest Configuration for Extraction Plugins

```json
{
  "documentAccess": "dynamic-page",  // Must call loadAllPagesAsync()
  "networkAccess": { "allowedDomains": ["none"] },  // No network needed
  "api": "1.0.0"
}
```

### 10. Batch Export Pattern (SVGs, PNGs)

For batch exporting multiple nodes (e.g., all SVGs on a page):
```typescript
const PAGE_BATCH = 4; // 4 concurrent exports (Figma's limit)
for(let i=0;i<allNodes.length;i+=PAGE_BATCH){
  if(cancelRequested) break;
  const batch = allNodes.slice(i, i+PAGE_BATCH);
  try {
    const results = await Promise.all(batch.map(n => n.exportAsync({format:"SVG"})));
    for(const buf of results) if(buf) zipFiles.push({name:..., data:buf});
  } catch(e) { /* individual node failure shouldn't stop batch */ }
  figma.ui.postMessage({type:"progress", current:i+PAGE_BATCH, total:allNodes.length});
}
```
Wrap each `Promise.all` in try/catch so one node's export failure doesn't kill the entire batch.

### 11. Lottie Import (JSON only, NOT dotLottie)

dotLottie (`.lottie`) is a proprietary compressed format. The plugin should ONLY accept plain JSON (`.json`) Lottie/Bodymovin files.

Validation:
```typescript
const content = String(fileContent);
let json;
try { json = JSON.parse(content); }
catch(e) { return error("Invalid JSON file"); }
if(!json.fr || !json.op || !json.w || !json.h) return error("Not a valid Lottie/Bodymovin animation");
```

### 12. Progress Communication Contract

The plugin code (`code.ts`) sends progress to the UI (`ui.html`) via `postMessage`:
```typescript
// Standard progress message format
figma.ui.postMessage({type:"full-extract-progress", progress:{
  step: number,      // current step
  totalSteps: number, // total steps
  label: string,     // phase name
  detail: string     // human-readable detail
}});

// Completion message
figma.ui.postMessage({type:"full-extract", data:{
  textNodes: number,
  components: number,
  totalNodes: number,
  scope: string
}});
```

### Summary: The Proven Extraction Pipeline

```
1. figma.loadAllPagesAsync()          ← MUST be first
2. figma.currentPage.findAll()        ← C++ native walk, single call
3. setTimeout batch processing        ← yield to UI every 200 nodes
4. Compact JSON to ZIP                ← avoid size limits
5. flushZipChunked() → chunks to UI  ← reliable delivery
6. Fire-and-forget extras             ← variables/styles/SVGs in background