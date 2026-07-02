// ──────────────────────────────────────────────
// Figma Extract All — v6.0.0
// Selection-scoped extraction. SVGs in AE/AI.
// Icons and assets properly named.
// ──────────────────────────────────────────────

interface ExtractedText {
  id: string; name: string; characters: string;
  pageName: string; parentPath: string; parentFrame: string;
  absoluteX: number; absoluteY: number; width: number; height: number;
  x: number; y: number;
  fontFamily: string; fontStyle: string; fontSize: number; fontWeight: number;
  lineHeight: { value: number; unit: string } | null;
  letterSpacing: { value: number; unit: string } | null;
  textAlignHorizontal: string; textAlignVertical: string;
  fills: FillInfo[]; opacity: number;
}

interface FillInfo {
  type: string; hex: string;
  rgba: { r: number; g: number; b: number; a: number };
  opacity: number; visible: boolean; blendMode: string;
  boundVariableId: string | null;
}

interface ExtractedVariable {
  id: string; name: string; resolvedType: string;
  valuesByMode: { [modeName: string]: VariableValueInfo };
  scopes: string[]; description: string; remote: boolean;
}

interface VariableValueInfo { raw: any; hex?: string; css?: string; }

interface ExtractedStyle {
  id: string; name: string; key: string; styleType: string;
  description: string; paints?: FillInfo[];
  fontSize?: number; fontFamily?: string; fontWeight?: number;
  lineHeight?: { value: number; unit: string } | null; remote: boolean;
}

interface ExtractedComponent {
  id: string; name: string; key: string; description: string;
  type: string; pageName: string; hasVariants: boolean;
  variantProperties: { [key: string]: any } | null;
  width: number; height: number; childCount: number;
}

interface ExtractedPage {
  id: string; name: string; nodeCount: number; background: any | null;
  topLevelFrames: { id: string; name: string; width: number; height: number; childCount: number }[];
}

interface HierarchyNode { id: string; name: string; type: string; childCount: number; children: HierarchyNode[]; }

interface FullExtract {
  meta: { fileName: string; extractDate: string; pluginVersion: string; totalPages: number; extractionScope: string; scopeDescription: string };
  pages: ExtractedPage[];
  textNodes: ExtractedText[];
  variables: ExtractedVariable[];
  styles: ExtractedStyle[];
  components: ExtractedComponent[];
  nodeCounts: { total: number; textNodes: number; frames: number; components: number; instances: number; byType: { [type: string]: number } };
  hierarchy: HierarchyNode[];
}

interface FullExtractProgress { step: number; totalSteps: number; label: string; detail: string; }
interface ExportResultItem { id: string; name: string; format: string; bytes: number[]; }
interface EmbeddedSVG { nodeId: string; nodeName: string; nodeType: string; pageName: string; parentPath: string; width: number; height: number; svg: string; }

const PLUGIN_VERSION = "6.0.0";
const ALL_TYPES = ["BOOLEAN_OPERATION","COMPONENT","COMPONENT_SET","ELLIPSE","FRAME","GROUP","INSTANCE","LINE","POLYGON","RECTANGLE","SECTION","STAR","TEXT","VECTOR"];
const SVG_TYPES = ["VECTOR","ELLIPSE","RECTANGLE","POLYGON","STAR","LINE","BOOLEAN_OPERATION","FRAME","GROUP","COMPONENT","COMPONENT_SET","INSTANCE","SECTION"];

// ── Helpers ──
function sanitizeName(n:string):string{return n.replace(/[<>:"/\\|?*\x00-\x1f]/g,"_").replace(/\.+$/,"").trim()||"unnamed";}
function rgbToHex(r:number,g:number,b:number):string{const h=(n:number)=>{const x=Math.round(Math.max(0,Math.min(1,n))*255).toString(16);return x.length===1?"0"+x:x;};return"#"+h(r)+h(g)+h(b);}
function getPageName(node:BaseNode):string{let c:BaseNode|null=node;while(c){if(c.type==="PAGE")return c.name;c=(c as any).parent||null;}return"(no page)";}
function getParentPath(node:BaseNode):string{const p:string[]=[];let c:BaseNode|null=(node as any).parent||null;while(c){if(c.type==="PAGE"){p.unshift(c.name);break;}if(c.type==="FRAME"||c.type==="GROUP"||c.type==="COMPONENT"||c.type==="COMPONENT_SET"||c.type==="SECTION")p.unshift(c.name);c=(c as any).parent||null;}return p.join(" > ")||"(root)";}
function getAbsolutePos(node:SceneNode):{x:number;y:number}{let ax=0,ay=0;let c:BaseNode|null=node;while(c&&c.type!=="PAGE"){if("x" in c&&"y" in c){ax+=(c as any).x;ay+=(c as any).y;}c=(c as any).parent||null;}return{x:ax,y:ay};}

// Flatten ALL children of a node (including the node itself as first element)
function flattenAll(root:BaseNode):SceneNode[]{
  const r:SceneNode[]=[];
  if(root.type!=="PAGE"&&root.type!=="DOCUMENT")r.push(root as SceneNode);
  if("children" in root){for(const c of (root as ChildrenMixin).children){r.push(...flattenAll(c));}}
  return r;
}

function flatten(root:BaseNode, pred?:(n:SceneNode)=>boolean):SceneNode[]{
  const all=flattenAll(root);
  return pred?all.filter(pred):all;
}

function buildHierarchy(root:BaseNode):HierarchyNode[]{
  const nodes:HierarchyNode[]=[];
  if("children" in root){for(const c of (root as ChildrenMixin).children){const sc=c as SceneNode;const n:HierarchyNode={id:sc.id,name:sc.name,type:sc.type,childCount:"children" in sc?(sc as any).children.length:0,children:[]};if("children" in sc)n.children=buildHierarchy(sc);nodes.push(n);}}
  return nodes;
}

function isExportable(node:SceneNode):boolean{return node.visible!==false&&ALL_TYPES.includes(node.type);}
function isSVGType(node:SceneNode):boolean{return SVG_TYPES.includes(node.type);}

// ── Get all nodes to extract (selection scope with children, or entire page) ──
function getScopedNodes():{nodes:SceneNode[],scopeDesc:string}{
  const sel=figma.currentPage.selection;
  if(sel.length===0){
    return {nodes:flattenAll(figma.currentPage),scopeDesc:"entire current page"};
  }
  // Selection scope: flatten all children under each selected node
  const all:SceneNode[]=[];
  for(const s of sel)all.push(...flattenAll(s));
  return {nodes:all,scopeDesc:`${sel.length} selected: ${sel.map(s=>s.name).join(", ")}`};
}

// ── Rich Fill Extraction ──
function extractFills(fills:ReadonlyArray<Paint>|typeof figma.mixed):FillInfo[]{
  if(fills===figma.mixed)return[];
  const r:FillInfo[]=[];
  for(const f of fills){
    if(f.type==="SOLID"&&f.color){r.push({type:"SOLID",hex:rgbToHex(f.color.r,f.color.g,f.color.b),rgba:{r:f.color.r,g:f.color.g,b:f.color.b,a:f.opacity??1},opacity:f.opacity??1,visible:f.visible??true,blendMode:f.blendMode??"NORMAL",boundVariableId:(f as any).boundVariables?.color?.id||null});}
    else{r.push({type:f.type,hex:"#000000",rgba:{r:0,g:0,b:0,a:1},opacity:f.opacity??1,visible:f.visible??true,blendMode:f.blendMode??"NORMAL",boundVariableId:null});}
  }
  return r;
}

// ── Text ──
function extractText(node:TextNode):ExtractedText{
  let lh:{value:number;unit:string}|null=null;
  const l=node.lineHeight;if(l!==figma.mixed&&typeof l==="object"&&"value" in l&&"unit" in l)lh={value:(l as any).value,unit:(l as any).unit};
  let ls:{value:number;unit:string}|null=null;
  const s=node.letterSpacing;if(s!==figma.mixed&&typeof s==="object"&&"value" in s&&"unit" in s)ls={value:(s as any).value,unit:(s as any).unit};
  const ap=getAbsolutePos(node);
  return{id:node.id,name:node.name,characters:node.characters,pageName:getPageName(node),parentPath:getParentPath(node),parentFrame:(()=>{let c:BaseNode|null=(node as any).parent||null;while(c){if(c.type==="FRAME"||c.type==="COMPONENT"||c.type==="COMPONENT_SET"||c.type==="SECTION")return c.name;c=(c as any).parent||null;}return"(no frame)";})(),absoluteX:Math.round(ap.x*100)/100,absoluteY:Math.round(ap.y*100)/100,width:Math.round(node.width*100)/100,height:Math.round(node.height*100)/100,x:Math.round(node.x*100)/100,y:Math.round(node.y*100)/100,fontFamily:typeof node.fontName==="object"&&"family" in node.fontName?node.fontName.family:"unknown",fontStyle:typeof node.fontName==="object"&&"style" in node.fontName?node.fontName.style:"Regular",fontSize:typeof node.fontSize==="number"?node.fontSize:0,fontWeight:typeof(node as any).fontWeight==="number"?(node as any).fontWeight:400,lineHeight:lh,letterSpacing:ls,textAlignHorizontal:node.textAlignHorizontal,textAlignVertical:node.textAlignVertical,fills:extractFills(node.fills),opacity:Math.round(node.opacity*100)/100};
}

// ── Extractors ──
async function extractAllVariables():Promise<ExtractedVariable[]>{
  const vars:ExtractedVariable[]=[];
  try{
    const localVars=await figma.variables.getLocalVariablesAsync();
    const modeMap:{[c:string]:{[m:string]:string}}={};
    const cols=await figma.variables.getLocalVariableCollectionsAsync();
    for(const col of cols){modeMap[col.id]={};for(const m of col.modes)modeMap[col.id][m.modeId]=m.name;}
    for(const v of localVars){
      const enriched:{[modeName:string]:VariableValueInfo}={};
      const raw:any=v.valuesByMode||{};const colId=(v as any).variableCollectionId||"";
      for(const [modeId,value] of Object.entries(raw)){
        const mn=modeMap[colId]?.[modeId]||modeId;
        if(value&&typeof value==="object"&&"r" in value){enriched[mn]={raw:value,hex:rgbToHex((value as any).r,(value as any).g,(value as any).b),css:""};}
        else{enriched[mn]={raw:value};}
      }
      vars.push({id:v.id,name:v.name,resolvedType:v.resolvedType,valuesByMode:enriched,scopes:v.scopes||[],description:v.description||"",remote:(v as any).remote||false});
    }
  }catch(e){}
  return vars;
}

async function extractAllStyles():Promise<ExtractedStyle[]>{
  const styles:ExtractedStyle[]=[];
  try{
    const ps=await figma.getLocalPaintStylesAsync(),ts=await figma.getLocalTextStylesAsync(),es=await figma.getLocalEffectStylesAsync(),gs=await figma.getLocalGridStylesAsync();
    for(const s of ps){const paints=s.paints&&s.paints.length>0?extractFills(s.paints as any):undefined;styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",paints,remote:(s as any).remote||false});}
    for(const s of ts){styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",fontSize:s.fontSize as number,fontFamily:(s as any).fontName?.family||undefined,fontWeight:(s as any).fontWeight||undefined,lineHeight:(s as any).lineHeight&&typeof(s as any).lineHeight==="object"&&"value" in (s as any).lineHeight?{value:(s as any).lineHeight.value,unit:(s as any).lineHeight.unit}:null,remote:(s as any).remote||false});}
    for(const s of es){styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",remote:(s as any).remote||false});}
    for(const s of gs){styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",remote:(s as any).remote||false});}
  }catch(e){}
  return styles;
}

function extractAllComponents():ExtractedComponent[]{
  const c:ExtractedComponent[]=[];
  for(const p of figma.root.children)walkComps(p,p.name,c);
  return c;
}
function walkComps(node:BaseNode,pn:string,r:ExtractedComponent[]):void{
  if(node.type==="COMPONENT"||node.type==="COMPONENT_SET"){
    try{
      const sc=node as SceneNode;let vp:{[k:string]:any}|null=null;
      if(node.type==="COMPONENT_SET"){const rp=(node as any).variantGroupProperties||(node as any).variantProperties;if(rp&&typeof rp==="object"){vp={};for(const k of Object.keys(rp))vp[k]=rp[k];}}
      r.push({id:node.id,name:node.name,key:(node as ComponentNode).key||"",description:(node as ComponentNode).description||"",type:node.type,pageName:pn,hasVariants:node.type==="COMPONENT_SET",variantProperties:vp,width:Math.round(sc.width*100)/100,height:Math.round(sc.height*100)/100,childCount:"children" in node?(node as any).children.length:0});
    }catch(e){}
  }
  if("children" in node)for(const ch of (node as ChildrenMixin).children)walkComps(ch,pn,r);
}

function extractPages():ExtractedPage[]{
  const pages:ExtractedPage[]=[];
  for(const p of figma.root.children)pages.push({id:p.id,name:p.name,nodeCount:flattenAll(p).length,background:typeof p.backgrounds!=="undefined"&&p.backgrounds.length>0?JSON.parse(JSON.stringify(p.backgrounds[0])):null,topLevelFrames:(p.children||[]).map((c:SceneNode)=>({id:c.id,name:c.name,width:Math.round(c.width*100)/100,height:Math.round(c.height*100)/100,childCount:"children" in c?(c as any).children.length:0}))});
  return pages;
}

// ── Full Extract ──
async function buildFullExtract(onProgress?:(p:FullExtractProgress)=>void):Promise<FullExtract>{
  const scoped=getScopedNodes();
  const total=4;
  const rpt=(s:number,l:string,d:string)=>{if(onProgress)onProgress({step:s,totalSteps:total,label:l,detail:d});};
  rpt(0,"Starting",`Scanning (${scoped.scopeDesc})...`);

  const texts:ExtractedText[]=[];
  for(const n of scoped.nodes){if(n.type==="TEXT")texts.push(extractText(n as TextNode));}
  rpt(1,"Text",`${texts.length} text nodes`);

  const [vars,styles]=await Promise.all([extractAllVariables(),extractAllStyles()]);
  rpt(2,"Variables & Styles",`${vars.length} vars, ${styles.length} styles`);

  const comps=extractAllComponents();
  const pages=extractPages();
  const hierarchy:any[]=[];
  const sel=figma.currentPage.selection;
  if(sel.length>0){for(const s of sel)hierarchy.push(...buildHierarchy(s));}
  else{hierarchy.push(...buildHierarchy(figma.currentPage));}
  rpt(3,"Components",`${comps.length} components`);

  const byType:{[t:string]:number}={};let totalNodes=0,fc=0,cc=0,ic=0;
  function cn(n:BaseNode){if("children" in n){for(const c of (n as ChildrenMixin).children){totalNodes++;const t=c.type;byType[t]=(byType[t]||0)+1;if(t==="FRAME"||t==="SECTION")fc++;if(t==="COMPONENT"||t==="COMPONENT_SET")cc++;if(t==="INSTANCE")ic++;cn(c);}}}
  if(sel.length>0){for(const s of sel)cn(s);}else{cn(figma.currentPage);}
  rpt(4,"Done",`${texts.length} texts, ${scoped.nodes.length} nodes`);

  return{
    meta:{fileName:figma.root.name||"Untitled",extractDate:new Date().toISOString(),pluginVersion:PLUGIN_VERSION,totalPages:figma.root.children.length,extractionScope:"scoped",scopeDescription:scoped.scopeDesc},
    pages,textNodes:texts,variables:vars,styles,components:comps,
    nodeCounts:{total:totalNodes,textNodes:texts.length,frames:fc,components:cc,instances:ic,byType},hierarchy
  };
}

// ── Export SVGs for scoped nodes ──
async function exportSVGsForScope(onProgress?:(cur:number,tot:number)=>void):Promise<void>{
  const scoped=getScopedNodes();
  const svgNodes=scoped.nodes.filter(n=>isExportable(n)&&isSVGType(n));
  const total=svgNodes.length;
  if(onProgress)onProgress(0,total);

  for(let i=0;i<svgNodes.length;i+=8){
    if(cancelRequested)break;
    const batch=svgNodes.slice(i,i+8);
    const promises=batch.map(n=>exportNodeAsSVGEmbedded(n.id));
    const results=await Promise.all(promises);
    for(const r of results){
      if(r)figma.ui.postMessage({type:"download-file",fileName:`svgs/${sanitizeName(r.pageName)}/${r.nodeName}.svg`,content:r.svg,mimeType:"image/svg+xml"});
    }
    if(onProgress)onProgress(Math.min(i+8,total),total);
  }
}

// ── Export Nodes (binary) ──
async function exportNodes(nodeIds:string[],format:"SVG"|"PNG"|"JPG"|"PDF",scale:number):Promise<ExportResultItem[]>{
  const results:ExportResultItem[]=[];
  for(const id of nodeIds){
    const node=await figma.getNodeByIdAsync(id);
    if(!node||node.type==="PAGE"||node.type==="DOCUMENT")continue;
    const sn=node as SceneNode;
    try{let bytes:Uint8Array;switch(format){case"SVG":bytes=await sn.exportAsync({format:"SVG"}as ExportSettingsSVG);break;case"PNG":bytes=await sn.exportAsync({format:"PNG",constraint:{type:"SCALE",value:scale}}as ExportSettingsImage);break;case"JPG":bytes=await sn.exportAsync({format:"JPG",constraint:{type:"SCALE",value:scale}}as ExportSettingsImage);break;case"PDF":bytes=await sn.exportAsync({format:"PDF"}as ExportSettingsPDF);break;default:continue;}results.push({id:node.id,name:sanitizeName(node.name),format:format.toLowerCase(),bytes:Array.from(bytes)});}catch(e){}
  }
  return results;
}

async function exportNodeAsSVGString(nodeId:string):Promise<{id:string;name:string;svg:string}|null>{
  const node=await figma.getNodeByIdAsync(nodeId);
  if(!node||node.type==="PAGE"||node.type==="DOCUMENT")return null;
  try{const s=await(node as SceneNode).exportAsync({format:"SVG_STRING"}as ExportSettingsSVGString);return{id:node.id,name:sanitizeName(node.name),svg:s};}catch(e){return null;}
}

async function exportNodeAsSVGEmbedded(nodeId:string):Promise<EmbeddedSVG|null>{
  const node=await figma.getNodeByIdAsync(nodeId);
  if(!node||node.type==="PAGE"||node.type==="DOCUMENT")return null;
  const sn=node as SceneNode;
  try{const s=await sn.exportAsync({format:"SVG_STRING"}as ExportSettingsSVGString);if(!s||s.length<10)return null;return{nodeId:node.id,nodeName:sanitizeName(node.name),nodeType:node.type,pageName:getPageName(node),parentPath:getParentPath(node),width:Math.round(sn.width*100)/100,height:Math.round(sn.height*100)/100,svg:s};}catch(e){return null;}
}

// ── Lottie ──
async function buildLottieBundle(nodeIds:string[]):Promise<any>{
  const items:any[]=[];
  for(const id of nodeIds){const node=await figma.getNodeByIdAsync(id);if(!node||node.type==="PAGE"||node.type==="DOCUMENT")continue;try{const s=await(node as SceneNode).exportAsync({format:"SVG_STRING"}as ExportSettingsSVGString);items.push({id:node.id,name:sanitizeName(node.name),type:node.type,pageName:getPageName(node),width:(node as SceneNode).width,height:(node as SceneNode).height,svg:s});}catch(e){}}
  return{fileName:`${sanitizeName(figma.root.name)}_lottie.json`,exportDate:new Date().toISOString(),source:figma.root.name||"Untitled",items};
}

function summarizeLottieImport(fileName:string,content:string):any{
  try{const p=JSON.parse(content);const keys=p&&typeof p==="object"?Object.keys(p):[];const layers=Array.isArray(p?.layers)?p.layers.length:0;return{fileName,valid:true,topLevelKeys:keys,layerCount:layers,warning:layers===0?"No layers":"Imported"};}catch(e){return{fileName,valid:false,topLevelKeys:[],layerCount:0,warning:"Not valid JSON"};}
}

function buildPlainText(textNodes:ExtractedText[]):string{
  const lines:string[]=[`════ TEXT — ${figma.root.name||"Untitled"}`,`  ${new Date().toISOString()}`,`════`,` `];
  for(const t of textNodes){lines.push(`── ${t.name} ──`,`  Page:     ${t.pageName}`,`  Parent:   ${t.parentPath}`,`  Font:     ${t.fontFamily} ${t.fontStyle} ${t.fontSize}px`,`  Color:    ${t.fills.length>0?t.fills[0].hex:"none"}`,`  Position: (${t.absoluteX},${t.absoluteY}) ${t.width}x${t.height}`,`  Text:     ${t.characters.replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{27BF}\u{0080}-\u{009F}]/gu,"[icon]")}`,` `);}
  lines.push(`── END (${textNodes.length} texts) ──`);return lines.join("\n");
}

// ── Message Handler ──
figma.showUI(__html__,{width:520,height:680,title:"Extract All — Figma to Anything"});
let cancelRequested=false;

function postSel(){figma.ui.postMessage({type:"selection-state",count:figma.currentPage.selection.length,pageName:figma.currentPage.name});}
figma.on("selectionchange",postSel);figma.on("currentpagechange",postSel);postSel();

figma.ui.onmessage=async(msg:any)=>{
  cancelRequested=false;

  // ═══ PLAIN FULL EXTRACT (no AE/AI opts) ═══
  if(msg.type==="get-full-extract"&&!msg.aeOpts&&!msg.aiOpts){
    const data=await buildFullExtract((p)=>{figma.ui.postMessage({type:"full-extract-progress",progress:p});});
    if(cancelRequested){figma.ui.postMessage({type:"error",message:"Cancelled"});return;}
    const scope=getScopedNodes();
    figma.ui.postMessage({type:"full-extract",data:{textNodes:data.textNodes.length,variables:data.variables.length,styles:data.styles.length,components:data.components.length,totalNodes:data.nodeCounts.total,scope:scope.scopeDesc}});
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_full-extract.json`,content:JSON.stringify(data,null,2),mimeType:"application/json"});
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_text.txt`,content:buildPlainText(data.textNodes),mimeType:"text/plain"});
  }

  // ═══ AE EXTRACT = Full Extract + SVGs + optional Lottie ═══
  if(msg.type==="get-full-extract"&&msg.aeOpts){
    // Step 1: Data
    const data=await buildFullExtract((p)=>{figma.ui.postMessage({type:"full-extract-progress",progress:p});});
    if(cancelRequested)return;
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_full-extract.json`,content:JSON.stringify(data,null,2),mimeType:"application/json"});
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_text.txt`,content:buildPlainText(data.textNodes),mimeType:"text/plain"});

    // Step 2: SVGs (if checked)
    if(msg.aeOpts.includeSVGs){
      await exportSVGsForScope((c,t)=>{figma.ui.postMessage({type:"progress",current:c,total:t,label:"SVGs"});});
    }

    // Step 3: Lottie (if checked and nodes selected)
    if(msg.aeOpts.includeLottie&&!cancelRequested){
      const sel=figma.currentPage.selection;
      if(sel.length>0){const b=await buildLottieBundle(sel.map((n:SceneNode)=>n.id));figma.ui.postMessage({type:"download-file",fileName:b.fileName,content:JSON.stringify(b,null,2),mimeType:"application/json"});}
    }

    const scope=getScopedNodes();
    if(!cancelRequested)figma.ui.postMessage({type:"full-extract",data:{textNodes:data.textNodes.length,variables:data.variables.length,styles:data.styles.length,components:data.components.length,totalNodes:data.nodeCounts.total,scope:scope.scopeDesc}});
  }

  // ═══ AI EXTRACT = Full Extract + SVGs ═══
  if(msg.type==="get-full-extract"&&msg.aiOpts){
    const data=await buildFullExtract((p)=>{figma.ui.postMessage({type:"full-extract-progress",progress:p});});
    if(cancelRequested)return;
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_full-extract.json`,content:JSON.stringify(data,null,2),mimeType:"application/json"});
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_text.txt`,content:buildPlainText(data.textNodes),mimeType:"text/plain"});

    if(msg.aiOpts.includeSVGs&&!cancelRequested){
      await exportSVGsForScope((c,t)=>{figma.ui.postMessage({type:"progress",current:c,total:t,label:"SVGs"});});
    }

    const scope=getScopedNodes();
    if(!cancelRequested)figma.ui.postMessage({type:"full-extract",data:{textNodes:data.textNodes.length,variables:data.variables.length,styles:data.styles.length,components:data.components.length,totalNodes:data.nodeCounts.total,scope:scope.scopeDesc}});
  }

  // ═══ TEXT ONLY ═══
  if(msg.type==="get-text"){
    const scoped=getScopedNodes();
    const tn=scoped.nodes.filter(n=>n.type==="TEXT").map(n=>extractText(n as TextNode));
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_text.json`,content:JSON.stringify(tn,null,2),mimeType:"application/json"});
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_text.txt`,content:buildPlainText(tn),mimeType:"text/plain"});
  }

  // ═══ SIMPLE DOWNLOADS ═══
  if(msg.type==="get-variables"){const v=await extractAllVariables();figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_variables.json`,content:JSON.stringify(v,null,2),mimeType:"application/json"});}
  if(msg.type==="get-styles"){const s=await extractAllStyles();figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_styles.json`,content:JSON.stringify(s,null,2),mimeType:"application/json"});}
  if(msg.type==="get-components"){const c=extractAllComponents();figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_components.json`,content:JSON.stringify(c,null,2),mimeType:"application/json"});}
  if(msg.type==="get-pages"){const p=extractPages();figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_pages.json`,content:JSON.stringify(p,null,2),mimeType:"application/json"});}

  // ═══ SELECTED NODES ═══
  if(msg.type==="export-selected-svg"||msg.type==="export-selected-png"||msg.type==="export-selected-jpg"){
    const sel=figma.currentPage.selection;if(sel.length===0){figma.ui.postMessage({type:"error",message:"No nodes selected"});return;}
    const fmt=msg.type==="export-selected-svg"?"SVG":msg.type==="export-selected-png"?"PNG":"JPG";
    const sc=fmt==="SVG"?(msg.scale||1):(msg.scale||2);
    const results=await exportNodes(sel.map((n:SceneNode)=>n.id),fmt,sc);
    if(results.length>0)figma.ui.postMessage({type:"export-results",results});
  }

  if(msg.type==="get-svg-as-text"){const sel=figma.currentPage.selection;if(sel.length===0){figma.ui.postMessage({type:"error",message:"No nodes selected"});return;}for(const node of sel){const r=await exportNodeAsSVGString(node.id);if(r)figma.ui.postMessage({type:"download-file",fileName:`${r.name}.svg`,content:r.svg,mimeType:"image/svg+xml"});}}

  // ═══ LOTTIE ═══
  if(msg.type==="export-lottie-json"){const sel=figma.currentPage.selection;if(sel.length===0){figma.ui.postMessage({type:"error",message:"No nodes selected"});return;}const bundle=await buildLottieBundle(sel.map((n:SceneNode)=>n.id));figma.ui.postMessage({type:"download-file",fileName:bundle.fileName,content:JSON.stringify(bundle,null,2),mimeType:"application/json"});}
  if(msg.type==="import-lottie-json"){figma.ui.postMessage({type:"lottie-import-summary",summary:summarizeLottieImport(msg.fileName||"lottie.json",String(msg.content||""))});}

  // ═══ BATCH EXPORT ═══
  if(msg.type==="export-all-svg-page"||msg.type==="export-all-png-page"||msg.type==="export-all-svg-all-pages"||msg.type==="export-all-png-all-pages"){
    const fmt=msg.type.includes("svg")?"SVG":"PNG";const sc=fmt==="SVG"?(msg.scale||1):(msg.scale||2);
    const pagesToExport=msg.type.includes("all-pages")?[...figma.root.children]:[figma.currentPage];
    let totalN=0,procN=0;
    for(const pg of pagesToExport){totalN+=flattenAll(pg).filter(isExportable).length;}
    for(const pg of pagesToExport){
      const nodes=flattenAll(pg).filter(isExportable);
      for(let i=0;i<nodes.length;i+=20){if(cancelRequested)break;const batch=nodes.slice(i,i+20).map(n=>n.id);const r=await exportNodes(batch,fmt,sc);for(const x of r)if(pagesToExport.length>1)x.name=sanitizeName(pg.name)+"/"+x.name;if(r.length>0)figma.ui.postMessage({type:"export-results",results:r});procN+=batch.length;figma.ui.postMessage({type:"progress",current:Math.min(procN,totalN),total:totalN,label:fmt});}
    }
    if(!cancelRequested)figma.ui.postMessage({type:"export-complete"});
  }

  if(msg.type==="cancel"){cancelRequested=true;}
  if(msg.type==="resize"){figma.ui.resize(msg.width,msg.height);}
  if(msg.type==="close"){figma.closePlugin();}
};