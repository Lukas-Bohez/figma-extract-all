// ──────────────────────────────────────────────
// Figma Extract All — v5.0.0
// Robust extraction. Fast. Works.
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
  textAutoResize: string; textTruncation: string; maxLines: number | null;
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

interface VariableValueInfo {
  raw: any; hex?: string; css?: string;
}

interface ExtractedStyle {
  id: string; name: string; key: string; styleType: string;
  description: string; paints?: FillInfo[];
  fontSize?: number; fontFamily?: string; fontWeight?: number;
  lineHeight?: { value: number; unit: string } | null;
  remote: boolean;
}

interface ExtractedComponent {
  id: string; name: string; key: string; description: string;
  type: string; pageName: string; hasVariants: boolean;
  variantProperties: { [key: string]: any } | null;
  width: number; height: number; childCount: number;
}

interface ExtractedPage {
  id: string; name: string; nodeCount: number;
  background: any | null;
  topLevelFrames: { id: string; name: string; width: number; height: number; childCount: number }[];
}

interface HierarchyNode {
  id: string; name: string; type: string; childCount: number; children: HierarchyNode[];
}

interface FullExtract {
  meta: { fileName: string; extractDate: string; pluginVersion: string; totalPages: number; extractionScope: string };
  pages: ExtractedPage[];
  textNodes: ExtractedText[];
  variables: ExtractedVariable[];
  styles: ExtractedStyle[];
  components: ExtractedComponent[];
  nodeCounts: { total: number; textNodes: number; frames: number; components: number; instances: number; byType: { [type: string]: number } };
  hierarchy: HierarchyNode[];
}

interface FullExtractProgress {
  step: number; totalSteps: number; label: string; detail: string;
}

interface ExportResultItem {
  id: string; name: string; format: string; bytes: number[];
}

interface EmbeddedSVG {
  nodeId: string; nodeName: string; nodeType: string; pageName: string;
  parentPath: string; width: number; height: number; svg: string;
}

// ── Constants ──────────────────────────────────

const PLUGIN_VERSION = "5.0.0";
const EXPORTABLE_TYPES = [
  "BOOLEAN_OPERATION","COMPONENT","COMPONENT_SET","ELLIPSE","FRAME","GROUP",
  "INSTANCE","LINE","POLYGON","RECTANGLE","SECTION","STAR","TEXT","VECTOR"
];

// ── Helpers ────────────────────────────────────

function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g,"_").replace(/\.+$/,"").trim()||"unnamed";
}

function rgbToHex(r:number,g:number,b:number):string{
  const h=(n:number)=>{const x=Math.round(Math.max(0,Math.min(1,n))*255).toString(16);return x.length===1?"0"+x:x;};
  return "#"+h(r)+h(g)+h(b);
}

function rgbaToCSS(r:number,g:number,b:number,a:number):string{
  const ri=Math.round(r*255),gi=Math.round(g*255),bi=Math.round(b*255);
  if(a>=1)return `rgb(${ri},${gi},${bi})`;
  return `rgba(${ri},${gi},${bi},${Math.round(a*100)/100})`;
}

function getPageName(node:BaseNode):string{
  let c:BaseNode|null=node;
  while(c){if(c.type==="PAGE")return c.name;c=(c as any).parent||null;}
  return"(no page)";
}

function getParentPath(node:BaseNode):string{
  const p:string[]=[];
  let c:BaseNode|null=(node as any).parent||null;
  while(c){
    if(c.type==="PAGE"){p.unshift(c.name);break;}
    if(c.type==="FRAME"||c.type==="GROUP"||c.type==="COMPONENT"||c.type==="COMPONENT_SET"||c.type==="SECTION")p.unshift(c.name);
    c=(c as any).parent||null;
  }
  return p.join(" > ")||"(root)";
}

function getParentFrame(node:BaseNode):string{
  let c:BaseNode|null=(node as any).parent||null;
  while(c){
    if(c.type==="FRAME"||c.type==="COMPONENT"||c.type==="COMPONENT_SET"||c.type==="SECTION")return c.name;
    c=(c as any).parent||null;
  }
  return"(no frame)";
}

function getAbsolutePos(node:SceneNode):{x:number;y:number}{
  let ax=0,ay=0;
  let c:BaseNode|null=node;
  while(c&&c.type!=="PAGE"){
    if("x" in c&&"y" in c){ax+=(c as any).x;ay+=(c as any).y;}
    c=(c as any).parent||null;
  }
  return{x:ax,y:ay};
}

// Flatten nodes on a page or frame
function flatten(root:PageNode|SceneNode, pred?:(n:SceneNode)=>boolean):SceneNode[]{
  const r:SceneNode[]=[];
  function w(n:BaseNode){
    if("children" in n){for(const c of (n as ChildrenMixin).children){const s=c as SceneNode;if(!pred||pred(s))r.push(s);w(s);}}
  }
  w(root);return r;
}

function buildHierarchy(root:PageNode|SceneNode):HierarchyNode[]{
  const nodes:HierarchyNode[]=[];
  if("children" in root){
    for(const c of (root as ChildrenMixin).children){
      const sc=c as SceneNode;
      const n:HierarchyNode={id:sc.id,name:sc.name,type:sc.type,childCount:"children" in sc?(sc as any).children.length:0,children:[]};
      if("children" in sc)n.children=buildHierarchy(sc);
      nodes.push(n);
    }
  }
  return nodes;
}

function isExportable(node:SceneNode):boolean{
  return node.visible!==false&&EXPORTABLE_TYPES.indexOf(node.type)>=0;
}

// ── Rich Fill Extraction ───────
function extractFills(fills:ReadonlyArray<Paint>|typeof figma.mixed):FillInfo[]{
  if(fills===figma.mixed)return[];
  const r:FillInfo[]=[];
  for(const f of fills){
    if(f.type==="SOLID"&&f.color){
      r.push({type:"SOLID",hex:rgbToHex(f.color.r,f.color.g,f.color.b),rgba:{r:f.color.r,g:f.color.g,b:f.color.b,a:f.opacity??1},opacity:f.opacity??1,visible:f.visible??true,blendMode:f.blendMode??"NORMAL",boundVariableId:(f as any).boundVariables?.color?.id||null});
    }else if(f.type==="GRADIENT_LINEAR"||f.type==="GRADIENT_RADIAL"||f.type==="GRADIENT_ANGULAR"||f.type==="GRADIENT_DIAMOND"){
      const stops=(f as GradientPaint).gradientStops?.map((s:any)=>({position:s.position,hex:rgbToHex(s.color.r,s.color.g,s.color.b),rgba:{r:s.color.r,g:s.color.g,b:s.color.b,a:s.color.a}}))||[];
      r.push({type:f.type,hex:stops.length>0?stops[0].hex:"#000000",rgba:stops.length>0?stops[0].rgba:{r:0,g:0,b:0,a:1},opacity:f.opacity??1,visible:f.visible??true,blendMode:f.blendMode??"NORMAL",boundVariableId:null});
    }else{
      r.push({type:f.type,hex:"#000000",rgba:{r:0,g:0,b:0,a:1},opacity:f.opacity??1,visible:f.visible??true,blendMode:f.blendMode??"NORMAL",boundVariableId:null});
    }
  }
  return r;
}

// ── Text Extraction ────────────
function extractText(node:TextNode):ExtractedText{
  let lh:{value:number;unit:string}|null=null;
  const l=node.lineHeight;
  if(l!==figma.mixed&&typeof l==="object"&&"value" in l&&"unit" in l)lh={value:(l as any).value,unit:(l as any).unit};
  let ls:{value:number;unit:string}|null=null;
  const s=node.letterSpacing;
  if(s!==figma.mixed&&typeof s==="object"&&"value" in s&&"unit" in s)ls={value:(s as any).value,unit:(s as any).unit};
  const ap=getAbsolutePos(node);
  return{
    id:node.id,name:node.name,characters:node.characters,pageName:getPageName(node),
    parentPath:getParentPath(node),parentFrame:getParentFrame(node),
    absoluteX:Math.round(ap.x*100)/100,absoluteY:Math.round(ap.y*100)/100,
    width:Math.round(node.width*100)/100,height:Math.round(node.height*100)/100,
    x:Math.round(node.x*100)/100,y:Math.round(node.y*100)/100,
    fontFamily:typeof node.fontName==="object"&&"family" in node.fontName?node.fontName.family:"unknown",
    fontStyle:typeof node.fontName==="object"&&"style" in node.fontName?node.fontName.style:"Regular",
    fontSize:typeof node.fontSize==="number"?node.fontSize:0,
    fontWeight:typeof(node as any).fontWeight==="number"?(node as any).fontWeight:400,
    lineHeight:lh,letterSpacing:ls,
    textAlignHorizontal:node.textAlignHorizontal,textAlignVertical:node.textAlignVertical,
    fills:extractFills(node.fills),opacity:Math.round(node.opacity*100)/100,
    textAutoResize:node.textAutoResize,textTruncation:(node as any).textTruncation||"DISABLED",maxLines:(node as any).maxLines||null
  };
}

// ── Variables ──────────────────
async function extractAllVariables():Promise<ExtractedVariable[]>{
  const vars:ExtractedVariable[]=[];
  try{
    const localVars=await figma.variables.getLocalVariablesAsync();
    const modeMap:{[colId:string]:{[modeId:string]:string}}={};
    const collections=await figma.variables.getLocalVariableCollectionsAsync();
    for(const col of collections){modeMap[col.id]={};for(const m of col.modes)modeMap[col.id][m.modeId]=m.name;}
    for(const v of localVars){
      const enriched:{[modeName:string]:VariableValueInfo}={};
      const raw:any=v.valuesByMode||{};
      const colId=(v as any).variableCollectionId||"";
      for(const [modeId,value] of Object.entries(raw)){
        const modeName=modeMap[colId]?.[modeId]||modeId;
        if(value&&typeof value==="object"&&"r" in value){
          enriched[modeName]={raw:value,hex:rgbToHex((value as any).r,(value as any).g,(value as any).b),css:rgbaToCSS((value as any).r,(value as any).g,(value as any).b,(value as any).a||1)};
        }else{enriched[modeName]={raw:value};}
      }
      vars.push({id:v.id,name:v.name,resolvedType:v.resolvedType,valuesByMode:enriched,scopes:v.scopes||[],description:v.description||"",remote:(v as any).remote||false});
    }
  }catch(e){/* silently return empty if variables API unavailable */}
  return vars;
}

// ── Styles ─────────────────────
async function extractAllStyles():Promise<ExtractedStyle[]>{
  const styles:ExtractedStyle[]=[];
  try{
    const paintStyles=await figma.getLocalPaintStylesAsync();
    const textStyles=await figma.getLocalTextStylesAsync();
    const effectStyles=await figma.getLocalEffectStylesAsync();
    const gridStyles=await figma.getLocalGridStylesAsync();
    for(const s of paintStyles){
      const paints=s.paints&&s.paints.length>0?extractFills(s.paints as any):undefined;
      styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",paints,remote:(s as any).remote||false});
    }
    for(const s of textStyles){
      styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",fontSize:s.fontSize as number,fontFamily:(s as any).fontName?.family||undefined,fontWeight:(s as any).fontWeight||undefined,lineHeight:(s as any).lineHeight&&typeof(s as any).lineHeight==="object"&&"value" in (s as any).lineHeight?{value:(s as any).lineHeight.value,unit:(s as any).lineHeight.unit}:null,remote:(s as any).remote||false});
    }
    for(const s of effectStyles){styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",remote:(s as any).remote||false});}
    for(const s of gridStyles){styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",remote:(s as any).remote||false});}
  }catch(e){/* silently return empty */}
  return styles;
}

// ── Components (robust walker, no silent error swallowing) ─
function extractAllComponents():ExtractedComponent[]{
  const components:ExtractedComponent[]=[];
  for(const page of figma.root.children){
    walkPageForComponents(page, page.name, components);
  }
  return components;
}

function walkPageForComponents(node:BaseNode, pageName:string, result:ExtractedComponent[]):void{
  if(node.type==="COMPONENT"||node.type==="COMPONENT_SET"){
    try{
      const sc=node as SceneNode;
      let variantProps:{[key:string]:any}|null=null;
      if(node.type==="COMPONENT_SET"){
        const rawProps=(node as any).variantGroupProperties||(node as any).variantProperties;
        if(rawProps&&typeof rawProps==="object"){
          variantProps={};
          for(const k of Object.keys(rawProps))variantProps[k]=rawProps[k];
        }
      }
      result.push({
        id:node.id,name:node.name,key:(node as ComponentNode).key||"",
        description:(node as ComponentNode).description||"",
        type:node.type,pageName:pageName,
        hasVariants:node.type==="COMPONENT_SET",variantProperties:variantProps,
        width:Math.round(sc.width*100)/100,height:Math.round(sc.height*100)/100,
        childCount:"children" in node?(node as any).children.length:0
      });
    }catch(e){/* skip this one component, continue */ }
  }
  if("children" in node){
    for(const child of (node as ChildrenMixin).children){
      walkPageForComponents(child, pageName, result);
    }
  }
}

// ── Pages ──────────────────────
function extractPages():ExtractedPage[]{
  const pages:ExtractedPage[]=[];
  for(const page of figma.root.children){
    pages.push({
      id:page.id,name:page.name,nodeCount:flatten(page).length,
      background:typeof page.backgrounds!=="undefined"&&page.backgrounds.length>0?JSON.parse(JSON.stringify(page.backgrounds[0])):null,
      topLevelFrames:(page.children||[]).map((c:SceneNode)=>({id:c.id,name:c.name,width:Math.round(c.width*100)/100,height:Math.round(c.height*100)/100,childCount:"children" in c?(c as any).children.length:0}))
    });
  }
  return pages;
}

// ── Full Extract ───────────────
async function buildFullExtract(
  onProgress?:(p:FullExtractProgress)=>void
):Promise<FullExtract>{
  const page=figma.currentPage;
  const total=4;
  const rpt=(step:number,label:string,detail:string)=>{if(onProgress)onProgress({step,totalSteps:total,label,detail});};

  rpt(0,"Starting","Scanning...");
  const texts=flatten(page,(n)=>n.type==="TEXT").map(n=>extractText(n as TextNode));
  rpt(1,"Text extracted",`${texts.length} text nodes`);
  
  const [vars,styles]=await Promise.all([extractAllVariables(),extractAllStyles()]);
  rpt(2,"Variables & Styles",`${vars.length} vars, ${styles.length} styles`);
  
  const comps=extractAllComponents();
  const pagess=extractPages();
  const hierarchy=buildHierarchy(page);
  rpt(3,"Components & Pages",`${comps.length} components, ${pagess.length} pages`);
  
  // Count
  const byType:{[type:string]:number}={};
  let totalNodes=0,framesC=0,compsC=0,instancesC=0;
  function wc(n:BaseNode){
    if("children" in n)for(const c of (n as ChildrenMixin).children){
      totalNodes++;const t=c.type;byType[t]=(byType[t]||0)+1;
      if(t==="FRAME"||t==="SECTION")framesC++;
      if(t==="COMPONENT"||t==="COMPONENT_SET")compsC++;
      if(t==="INSTANCE")instancesC++;
      wc(c);
    }
  }
  wc(page);
  rpt(4,"Complete",`${texts.length} texts, ${comps.length} comps`);
  
  return {
    meta:{fileName:figma.root.name||"Untitled",extractDate:new Date().toISOString(),pluginVersion:PLUGIN_VERSION,totalPages:figma.root.children.length,extractionScope:"current page"},
    pages:pagess,textNodes:texts,variables:vars,styles,components:comps,
    nodeCounts:{total:totalNodes,textNodes:texts.length,frames:framesC,components:compsC,instances:instancesC,byType},
    hierarchy
  };
}

// ── Export Nodes (binary) ──────
async function exportNodes(nodeIds:string[],format:"SVG"|"PNG"|"JPG"|"PDF",scale:number):Promise<ExportResultItem[]>{
  const results:ExportResultItem[]=[];
  for(const id of nodeIds){
    const node=await figma.getNodeByIdAsync(id);
    if(!node||node.type==="PAGE"||node.type==="DOCUMENT")continue;
    const sn=node as SceneNode;
    try{
      let bytes:Uint8Array;
      switch(format){
        case"SVG":bytes=await sn.exportAsync({format:"SVG"}as ExportSettingsSVG);break;
        case"PNG":bytes=await sn.exportAsync({format:"PNG",constraint:{type:"SCALE",value:scale}}as ExportSettingsImage);break;
        case"JPG":bytes=await sn.exportAsync({format:"JPG",constraint:{type:"SCALE",value:scale}}as ExportSettingsImage);break;
        case"PDF":bytes=await sn.exportAsync({format:"PDF"}as ExportSettingsPDF);break;
        default:continue;
      }
      results.push({id:node.id,name:sanitizeName(node.name),format:format.toLowerCase(),bytes:Array.from(bytes)});
    }catch(err){console.error("export failed:",(err as Error).message);}
  }
  return results;
}

async function exportNodeAsSVGString(nodeId:string):Promise<{id:string;name:string;svg:string}|null>{
  const node=await figma.getNodeByIdAsync(nodeId);
  if(!node||node.type==="PAGE"||node.type==="DOCUMENT")return null;
  try{
    const svgString=await(node as SceneNode).exportAsync({format:"SVG_STRING"}as ExportSettingsSVGString);
    return{id:node.id,name:sanitizeName(node.name),svg:svgString};
  }catch(e){return null;}
}

// ── SVG Export (standalone, for AE panel) ──
async function exportAllSVGs(pageNode:PageNode,onSVG?:(svg:EmbeddedSVG)=>void):Promise<EmbeddedSVG[]>{
  const nodes=flatten(pageNode).filter(isExportable);
  const svgs:EmbeddedSVG[]=[];
  for(let i=0;i<nodes.length;i+=10){
    const batch=nodes.slice(i,i+10);
    const promises=batch.map(n=>exportNodeAsSVGEmbedded(n.id));
    const results=await Promise.all(promises);
    for(const r of results){
      if(r){
        svgs.push(r);
        if(onSVG)onSVG(r);
      }
    }
  }
  return svgs;
}

async function exportNodeAsSVGEmbedded(nodeId:string):Promise<EmbeddedSVG|null>{
  const node=await figma.getNodeByIdAsync(nodeId);
  if(!node||node.type==="PAGE"||node.type==="DOCUMENT")return null;
  const sn=node as SceneNode;
  try{
    const svgString=await sn.exportAsync({format:"SVG_STRING"}as ExportSettingsSVGString);
    if(!svgString||svgString.length<10)return null;
    return{nodeId:node.id,nodeName:sanitizeName(node.name),nodeType:node.type,pageName:getPageName(node),parentPath:getParentPath(node),width:Math.round(sn.width*100)/100,height:Math.round(sn.height*100)/100,svg:svgString};
  }catch(e){return null;}
}

// ── Lottie ─────────────────────
async function buildLottieBundle(nodeIds:string[]):Promise<any>{
  const items:any[]=[];
  for(const id of nodeIds){
    const node=await figma.getNodeByIdAsync(id);
    if(!node||node.type==="PAGE"||node.type==="DOCUMENT")continue;
    try{
      const svgString=await(node as SceneNode).exportAsync({format:"SVG_STRING"}as ExportSettingsSVGString);
      items.push({id:node.id,name:sanitizeName(node.name),type:node.type,pageName:getPageName(node),width:(node as SceneNode).width,height:(node as SceneNode).height,svg:svgString});
    }catch(e){}
  }
  return{fileName:`${sanitizeName(figma.root.name)}_lottie.json`,exportDate:new Date().toISOString(),source:figma.root.name||"Untitled",items};
}

function summarizeLottieImport(fileName:string,content:string):any{
  try{
    const parsed=JSON.parse(content);
    const keys=parsed&&typeof parsed==="object"?Object.keys(parsed):[];
    const layers=Array.isArray(parsed?.layers)?parsed.layers.length:0;
    return{fileName,valid:true,topLevelKeys:keys,layerCount:layers,warning:layers===0?"No layers array found":"Imported"};
  }catch(e){return{fileName,valid:false,topLevelKeys:[],layerCount:0,warning:"Not valid JSON"};}
}

// ── Text dump ──────────────────
function buildPlainText(textNodes:ExtractedText[]):string{
  const lines:string[]=[];
  lines.push("════ TEXT EXTRACTION — "+(figma.root.name||"Untitled"));
  lines.push("  "+new Date().toISOString());
  lines.push("════");
  lines.push("");
  for(const t of textNodes){
    lines.push("── "+t.name+" ──");
    lines.push("  Page:     "+t.pageName);
    lines.push("  Parent:   "+t.parentPath);
    lines.push("  Font:     "+t.fontFamily+" "+t.fontStyle+" "+t.fontSize+"px");
    lines.push("  Color:    "+(t.fills.length>0?t.fills[0].hex:"none"));
    lines.push("  Position: ("+t.absoluteX+","+t.absoluteY+") "+t.width+"x"+t.height);
    const safe=t.characters.replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{27BF}\u{0080}-\u{009F}]/gu,"[icon]");
    lines.push("  Text:     "+safe);
    lines.push("");
  }
  lines.push("── END ("+textNodes.length+" text nodes) ──");
  return lines.join("\n");
}

// ── Message Handler ────────────

figma.showUI(__html__,{width:520,height:680,title:"Extract All — Figma to Anything"});

let cancelRequested=false;

function postSel(){figma.ui.postMessage({type:"selection-state",count:figma.currentPage.selection.length,pageName:figma.currentPage.name});}
figma.on("selectionchange",postSel);
figma.on("currentpagechange",postSel);
postSel();

figma.ui.onmessage=async(msg:any)=>{
  cancelRequested=false;

  // ── FULL EXTRACT ──
  if(msg.type==="get-full-extract"){
    const data=await buildFullExtract((p)=>{figma.ui.postMessage({type:"full-extract-progress",progress:p});});
    if(cancelRequested){figma.ui.postMessage({type:"error",message:"Cancelled"});return;}

    // Summary
    figma.ui.postMessage({type:"full-extract",data:{
      textNodes:data.textNodes.length,variables:data.variables.length,styles:data.styles.length,
      components:data.components.length,totalNodes:data.nodeCounts.total
    }});

    // Download JSON
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_full-extract.json`,content:JSON.stringify(data,null,2),mimeType:"application/json"});

    // Download TXT
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_text.txt`,content:buildPlainText(data.textNodes),mimeType:"text/plain"});
  }

  // ── TEXT ONLY ──
  if(msg.type==="get-text"){
    const tn=flatten(figma.currentPage,(n)=>n.type==="TEXT").map(n=>extractText(n as TextNode));
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_text.json`,content:JSON.stringify(tn,null,2),mimeType:"application/json"});
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_text.txt`,content:buildPlainText(tn),mimeType:"text/plain"});
  }

  // ── VARIABLES ──
  if(msg.type==="get-variables"){
    const v=await extractAllVariables();
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_variables.json`,content:JSON.stringify(v,null,2),mimeType:"application/json"});
  }

  // ── STYLES ──
  if(msg.type==="get-styles"){
    const s=await extractAllStyles();
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_styles.json`,content:JSON.stringify(s,null,2),mimeType:"application/json"});
  }

  // ── COMPONENTS ──
  if(msg.type==="get-components"){
    const c=extractAllComponents();
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_components.json`,content:JSON.stringify(c,null,2),mimeType:"application/json"});
  }

  // ── PAGES ──
  if(msg.type==="get-pages"){
    const p=extractPages();
    figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(figma.root.name)}_pages.json`,content:JSON.stringify(p,null,2),mimeType:"application/json"});
  }

  // ── SELECTED NODES ──
  if(msg.type==="export-selected-svg"||msg.type==="export-selected-png"||msg.type==="export-selected-jpg"){
    const sel=figma.currentPage.selection;
    if(sel.length===0){figma.ui.postMessage({type:"error",message:"No nodes selected"});return;}
    const fmt=msg.type==="export-selected-svg"?"SVG":msg.type==="export-selected-png"?"PNG":"JPG";
    const sc=fmt==="SVG"?(msg.scale||1):(msg.scale||2);
    const results=await exportNodes(sel.map((n:SceneNode)=>n.id),fmt,sc);
    if(results.length>0)figma.ui.postMessage({type:"export-results",results});
    else figma.ui.postMessage({type:"error",message:"Export failed"});
  }

  // ── SVG AS TEXT ──
  if(msg.type==="get-svg-as-text"){
    const sel=figma.currentPage.selection;
    if(sel.length===0){figma.ui.postMessage({type:"error",message:"No nodes selected"});return;}
    for(const node of sel){
      const r=await exportNodeAsSVGString(node.id);
      if(r)figma.ui.postMessage({type:"download-file",fileName:`${r.name}.svg`,content:r.svg,mimeType:"image/svg+xml"});
    }
  }

  // ── LOTTIE EXPORT ──
  if(msg.type==="export-lottie-json"){
    const sel=figma.currentPage.selection;
    if(sel.length===0){figma.ui.postMessage({type:"error",message:"No nodes selected"});return;}
    const bundle=await buildLottieBundle(sel.map((n:SceneNode)=>n.id));
    figma.ui.postMessage({type:"download-file",fileName:bundle.fileName,content:JSON.stringify(bundle,null,2),mimeType:"application/json"});
  }

  // ── LOTTIE IMPORT ──
  if(msg.type==="import-lottie-json"){
    figma.ui.postMessage({type:"lottie-import-summary",summary:summarizeLottieImport(msg.fileName||"lottie.json",String(msg.content||""))});
  }

  // ── BATCH EXPORT CURRENT PAGE ──
  if(msg.type==="export-all-svg-page"||msg.type==="export-all-png-page"){
    const fmt=msg.type==="export-all-svg-page"?"SVG":"PNG";
    const sc=fmt==="SVG"?(msg.scale||1):(msg.scale||2);
    const nodes=flatten(figma.currentPage).filter(isExportable);
    await batchExportNodes(nodes,fmt,sc,false);
    if(!cancelRequested)figma.ui.postMessage({type:"export-complete"});
  }

  // ── BATCH EXPORT ALL PAGES ──
  if(msg.type==="export-all-svg-all-pages"||msg.type==="export-all-png-all-pages"){
    const fmt=msg.type==="export-all-svg-all-pages"?"SVG":"PNG";
    const sc=fmt==="SVG"?(msg.scale||1):(msg.scale||2);
    let totalNodes=0,procNodes=0;
    for(const pg of figma.root.children){
      const nodes=flatten(pg).filter(isExportable);
      totalNodes+=nodes.length;
      for(let i=0;i<nodes.length;i+=20){
        if(cancelRequested)break;
        const batch=nodes.slice(i,i+20).map(n=>n.id);
        const results=await exportNodes(batch,fmt,sc);
        for(const r of results)r.name=sanitizeName(pg.name)+"/"+r.name;
        if(results.length>0)figma.ui.postMessage({type:"export-results",results});
        procNodes+=batch.length;
        figma.ui.postMessage({type:"progress",current:Math.min(procNodes,totalNodes),total:totalNodes,label:`${fmt} all pages`});
      }
    }
    if(!cancelRequested)figma.ui.postMessage({type:"export-complete"});
  }

  // ── CANCEL / RESIZE / CLOSE ──
  if(msg.type==="cancel"){cancelRequested=true;}
  if(msg.type==="resize"){figma.ui.resize(msg.width,msg.height);}
  if(msg.type==="close"){figma.closePlugin();}
};

async function batchExportNodes(nodes:SceneNode[],format:"SVG"|"PNG",scale:number,isAllPages:boolean):Promise<void>{
  for(let i=0;i<nodes.length;i+=20){
    if(cancelRequested)return;
    const batch=nodes.slice(i,i+20).map(n=>n.id);
    const results=await exportNodes(batch,format,scale);
    if(results.length>0)figma.ui.postMessage({type:"export-results",results});
    figma.ui.postMessage({type:"progress",current:Math.min(i+20,nodes.length),total:nodes.length,label:`${format} export`});
  }
}