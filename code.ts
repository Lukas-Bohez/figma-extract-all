// Figma Extract All v9.0.0 — ZIP bundle, no download spam
interface ExtractedText {
  id:string;name:string;characters:string;pageName:string;parentPath:string;parentFrame:string;
  absoluteX:number;absoluteY:number;width:number;height:number;x:number;y:number;
  fontFamily:string;fontStyle:string;fontSize:number;fontWeight:number;
  lineHeight:{value:number;unit:string}|null;letterSpacing:{value:number;unit:string}|null;
  textAlignHorizontal:string;textAlignVertical:string;fills:FillInfo[];opacity:number;
}
interface FillInfo {type:string;hex:string;rgba:{r:number;g:number;b:number;a:number};opacity:number;visible:boolean;blendMode:string;boundVariableId:string|null;}
interface ExtractedVariable {id:string;name:string;resolvedType:string;valuesByMode:{[modeName:string]:VariableValueInfo};scopes:string[];description:string;remote:boolean;}
interface VariableValueInfo {raw:any;hex?:string;css?:string;}
interface ExtractedStyle {id:string;name:string;key:string;styleType:string;description:string;paints?:FillInfo[];fontSize?:number;fontFamily?:string;fontWeight?:string;lineHeight?:{value:number;unit:string}|null;remote:boolean;}
interface ExtractedComponent {id:string;name:string;key:string;description:string;type:string;pageName:string;hasVariants:boolean;variantProperties:{[k:string]:any}|null;width:number;height:number;childCount:number;}
interface ExtractedPage {id:string;name:string;nodeCount:number;background:any|null;topLevelFrames:{id:string;name:string;width:number;height:number;childCount:number}[];}
interface HierarchyNode {id:string;name:string;type:string;childCount:number;children:HierarchyNode[];}
interface FullExtract {
  meta:{fileName:string;extractDate:string;pluginVersion:string;totalPages:number;extractionScope:string;scopeDescription:string};
  pages:ExtractedPage[];textNodes:ExtractedText[];variables:ExtractedVariable[];styles:ExtractedStyle[];components:ExtractedComponent[];
  nodeCounts:{total:number;textNodes:number;frames:number;components:number;instances:number;byType:{[t:string]:number}};hierarchy:HierarchyNode[];
}
interface FullExtractProgress {step:number;totalSteps:number;label:string;detail:string;}
interface ExportResultItem {id:string;name:string;format:string;bytes:number[];}
interface ZipFileEntry {name:string;data:Uint8Array;}

const PLUGIN_VERSION="9.0.0";
// TextEncoder polyfill (available as global in Figma sandbox)
const TE={encode:(s:string)=>{const r=new Uint8Array(s.length);for(let i=0;i<s.length;i++)r[i]=s.charCodeAt(i)&0xFF;return r;}};

// ── ZIP creator ────────────────────────────────
const CRC_TABLE:Uint32Array = (()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[i]=c>>>0;}return t;})();
function crc32(d:Uint8Array):number{let c=0xFFFFFFFF;for(let i=0;i<d.length;i++)c=CRC_TABLE[(c^d[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}

function makeZip(files:ZipFileEntry[]):Uint8Array{
  const locals:Uint8Array[]=[],cdirs:Uint8Array[]=[];
  let off=0;

  function w32(v:number):Uint8Array{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,v,true);return b;}
  function w16(v:number):Uint8Array{const b=new Uint8Array(2);new DataView(b.buffer).setUint16(0,v,true);return b;}
  function push(out:Uint8Array[],...arrays:(Uint8Array|number)[]){
    for(const a of arrays)out.push(typeof a==="number"?new Uint8Array([a]):a);
  }

  for(const f of files){
    const nb=TE.encode(f.name);const crc=crc32(f.data);const sz=f.data.length;

    // local header
    const lh=new Uint8Array(30+nb.length);
    new DataView(lh.buffer).setUint32(0,0x04034b50,true);
    lh[6]=0;lh[7]=0; // flags
    lh[8]=0;lh[9]=0; // store
    new DataView(lh.buffer).setUint32(14,crc,true);
    new DataView(lh.buffer).setUint32(18,sz,true);
    new DataView(lh.buffer).setUint32(22,sz,true);
    new DataView(lh.buffer).setUint16(26,nb.length,true);
    lh[28]=0;lh[29]=0;
    lh.set(nb,30);
    locals.push(lh,f.data);
    const entryOff=off;
    off+=30+nb.length+sz;
    const cl=(f.data as any).compressedSize!==undefined;
    if(cl&&(f.data as any).compressedSize!==sz)continue; // skip invalid compressed

    // central dir
    const cd=new Uint8Array(46+nb.length);
    new DataView(cd.buffer).setUint32(0,0x02014b50,true);
    cd[6]=0;cd[7]=0;cd[8]=0;cd[9]=0;
    new DataView(cd.buffer).setUint32(16,crc,true);
    new DataView(cd.buffer).setUint32(20,sz,true);
    new DataView(cd.buffer).setUint32(24,sz,true);
    new DataView(cd.buffer).setUint16(28,nb.length,true);
    new DataView(cd.buffer).setUint32(42,entryOff,true);
    cd.set(nb,46);
    cdirs.push(cd);
  }

  // eocd
  const cdOff=off;const cdSz=cdirs.reduce((s,a)=>s+a.length,0);
  const eocd=new Uint8Array(22);
  new DataView(eocd.buffer).setUint32(0,0x06054b50,true);
  new DataView(eocd.buffer).setUint16(8,files.length,true);
  new DataView(eocd.buffer).setUint16(10,files.length,true);
  new DataView(eocd.buffer).setUint32(12,cdSz,true);
  new DataView(eocd.buffer).setUint32(16,cdOff,true);

  const total=off+cdSz+22;
  const result=new Uint8Array(total);
  let pos=0;
  for(const p of locals){result.set(p,pos);pos+=p.length;}
  for(const p of cdirs){result.set(p,pos);pos+=p.length;}
  result.set(eocd,pos);
  return result;
}

// ── Helpers ──
function sanitizeName(n:string):string{return n.replace(/[<>:"\/\\|?*\x00-\x1f]/g,"_").replace(/\.+$/,"").trim()||"unnamed";}
function rgbToHex(r:number,g:number,b:number):string{const h=(n:number)=>{const x=Math.round(Math.max(0,Math.min(1,n))*255).toString(16);return x.length===1?"0"+x:x;};return"#"+h(r)+h(g)+h(b);}
function getPageName(node:BaseNode):string{let c:BaseNode|null=(node as any).parent||null;while(c){if(c.type==="PAGE")return c.name;c=(c as any).parent||null;}return"(no page)";}
function getParentPath(node:BaseNode):string{const p:string[]=[];let c:BaseNode|null=(node as any).parent||null;while(c){if(c.type==="PAGE"){p.unshift(c.name);break;}if(c.type==="FRAME"||c.type==="GROUP"||c.type==="COMPONENT"||c.type==="COMPONENT_SET"||c.type==="SECTION")p.unshift(c.name);c=(c as any).parent||null;}return p.join(" > ")||"(root)";}
function getAbsolutePos(node:SceneNode):{x:number;y:number}{let ax=0,ay=0;let c:BaseNode|null=node;while(c&&c.type!=="PAGE"){if("x" in c&&"y" in c){ax+=(c as any).x;ay+=(c as any).y;}c=(c as any).parent||null;}return{x:ax,y:ay};}
function deepFlatten(roots:BaseNode[]):SceneNode[]{const r:SceneNode[]=[];function w(n:BaseNode){if(n.type!=="PAGE")r.push(n as SceneNode);if("children" in n)for(const c of (n as any).children)w(c);}for(const ro of roots)w(ro);return r;}
function getScope(){const sel=figma.currentPage.selection;if(sel.length===0)return{roots:[figma.currentPage as any],desc:"entire current page"};return{roots:sel.map(s=>s),desc:`${sel.length} selected: ${sel.map(s=>s.name).join(", ")}`};}
function isVisible(n:SceneNode):boolean{return n.visible!==false;}
function extractFills(fills:any):FillInfo[]{if(fills===figma.mixed)return[];const r:FillInfo[]=[];for(const f of fills||[]){if(f.type==="SOLID"&&f.color)r.push({type:"SOLID",hex:rgbToHex(f.color.r,f.color.g,f.color.b),rgba:{r:f.color.r,g:f.color.g,b:f.color.b,a:f.opacity??1},opacity:f.opacity??1,visible:f.visible??true,blendMode:f.blendMode??"NORMAL",boundVariableId:(f as any).boundVariables?.color?.id||null});else r.push({type:f.type||"UNKNOWN",hex:"#000",rgba:{r:0,g:0,b:0,a:1},opacity:1,visible:true,blendMode:"NORMAL",boundVariableId:null});}return r;}
function extractText(node:TextNode):ExtractedText{
  let lh:any=null;const l=node.lineHeight;if(l!==figma.mixed&&typeof l==="object"&&"value" in l)lh={value:(l as any).value,unit:(l as any).unit||"PIXELS"};
  let ls:any=null;const s=node.letterSpacing;if(s!==figma.mixed&&typeof s==="object"&&"value" in s)ls={value:(s as any).value,unit:(s as any).unit||"PIXELS"};
  const ap=getAbsolutePos(node);
  return{id:node.id,name:node.name,characters:node.characters,pageName:getPageName(node),parentPath:getParentPath(node),parentFrame:(()=>{let c:BaseNode|null=(node as any).parent||null;while(c){if(["FRAME","COMPONENT","COMPONENT_SET","SECTION"].includes(c.type))return c.name;c=(c as any).parent||null;}return"(no frame)";})(),absoluteX:Math.round(ap.x*100)/100,absoluteY:Math.round(ap.y*100)/100,width:Math.round(node.width*100)/100,height:Math.round(node.height*100)/100,x:Math.round(node.x*100)/100,y:Math.round(node.y*100)/100,fontFamily:node.fontName!==figma.mixed&&typeof node.fontName==="object"?node.fontName.family:"unknown",fontStyle:node.fontName!==figma.mixed&&typeof node.fontName==="object"?node.fontName.style:"Regular",fontSize:typeof node.fontSize==="number"?node.fontSize:0,fontWeight:typeof(node as any).fontWeight==="number"?(node as any).fontWeight:400,lineHeight:lh,letterSpacing:ls,textAlignHorizontal:node.textAlignHorizontal,textAlignVertical:node.textAlignVertical,fills:extractFills(node.fills),opacity:Math.round(node.opacity*100)/100};
}
function extractAllComponents():ExtractedComponent[]{const c:ExtractedComponent[]=[];for(const p of figma.root.children)wc(p,p.name,c);return c;}
function wc(node:BaseNode,pn:string,r:ExtractedComponent[]):void{if(node.type==="COMPONENT"||node.type==="COMPONENT_SET"){try{const sc=node as SceneNode;let vp:any=null;if(node.type==="COMPONENT_SET"){const rp=(node as any).variantGroupProperties||(node as any).variantProperties;if(rp){vp={};for(const k of Object.keys(rp))vp[k]=rp[k];}}r.push({id:node.id,name:node.name,key:(node as ComponentNode).key||"",description:(node as ComponentNode).description||"",type:node.type,pageName:pn,hasVariants:node.type==="COMPONENT_SET",variantProperties:vp,width:Math.round(sc.width*100)/100,height:Math.round(sc.height*100)/100,childCount:"children" in node?(node as any).children.length:0});}catch(e){}}if("children" in node)for(const ch of (node as any).children)wc(ch,pn,r);}
function extractPages():ExtractedPage[]{const p:ExtractedPage[]=[];for(const pg of figma.root.children)p.push({id:pg.id,name:pg.name,nodeCount:deepFlatten([pg]).length,background:typeof pg.backgrounds!=="undefined"&&pg.backgrounds.length>0?JSON.parse(JSON.stringify(pg.backgrounds[0])):null,topLevelFrames:(pg.children||[]).map((c:SceneNode)=>({id:c.id,name:c.name,width:Math.round(c.width*100)/100,height:Math.round(c.height*100)/100,childCount:"children" in c?(c as any).children.length:0}))});return p;}
function buildHierarchy(root:BaseNode):HierarchyNode[]{const n:HierarchyNode[]=[];if("children" in root)for(const c of (root as any).children){const sc=c as SceneNode;const node:HierarchyNode={id:sc.id,name:sc.name,type:sc.type,childCount:"children" in sc?(sc as any).children.length:0,children:[]};if("children" in sc)node.children=buildHierarchy(sc);n.push(node);}return n;}
function buildPlainText(texts:ExtractedText[]):string{
  const l:string[]=[`════ TEXT — ${figma.root.name||"Untitled"}`,`  ${new Date().toISOString()}`,`════`,` `];
  for(const t of texts){l.push(`── ${t.name} ──`,`  Page:     ${t.pageName}`,`  Parent:   ${t.parentPath}`,`  Font:     ${t.fontFamily} ${t.fontStyle} ${t.fontSize}px`,`  Color:    ${t.fills.length>0?t.fills[0].hex:"none"}`,`  Position: (${t.absoluteX},${t.absoluteY}) ${t.width}×${t.height}`,`  Text:     ${t.characters.replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{27BF}\u{0080}-\u{009F}]/gu,"[icon]")}`,` `);}
  l.push(`── END (${texts.length} texts) ──`);return l.join("\n");
}

// ── ZIP accumulator ──
let zipFiles:ZipFileEntry[]=[];
function addToZip(name:string,content:string|Uint8Array){
  if(typeof content==="string")zipFiles.push({name,data:TE.encode(content)});
  else zipFiles.push({name,data:content});
}
function flushZipAndDownload(fileNameBase:string){
  if(zipFiles.length===0)return;
  const zip=makeZip(zipFiles);
  figma.ui.postMessage({type:"download-file-zip",fileName:`${sanitizeName(fileNameBase)}_extract.zip`,bytes:Array.from(zip)});
  zipFiles=[];
}

// ── Sync Full Extract ──
function buildFullExtractSync(onProgress?:(p:FullExtractProgress)=>void):FullExtract{
  const scope=getScope();
  const rpt=(s:number,l:string,d:string)=>{if(onProgress)onProgress({step:s,totalSteps:3,label:l,detail:d});};
  rpt(0,"Starting","Scanning...");
  const allDeepNodes=deepFlatten(scope.roots);
  rpt(1,"Text",`${allDeepNodes.filter(n=>n.type==="TEXT").length} texts, ${allDeepNodes.length} nodes`);
  const texts:ExtractedText[]=[];for(const n of allDeepNodes){if(n.type==="TEXT")texts.push(extractText(n as TextNode));}
  const comps=extractAllComponents();const pages=extractPages();
  const hierarchy:any[]=[];for(const r of scope.roots)hierarchy.push(...buildHierarchy(r));
  rpt(2,"Components & Pages",`${comps.length} components, ${pages.length} pages`);
  const byType:{[t:string]:number}={};let totalN=0,fc=0,cc=0,ic=0;
  function cn(n:BaseNode){if("children" in n)for(const c of (n as any).children){totalN++;const t=c.type;byType[t]=(byType[t]||0)+1;if(t==="FRAME"||t==="SECTION")fc++;if(t==="COMPONENT"||t==="COMPONENT_SET")cc++;if(t==="INSTANCE")ic++;cn(c);}}
  for(const r of scope.roots)cn(r);
  rpt(3,"Done",`${texts.length} texts, ${totalN} nodes`);
  return{meta:{fileName:figma.root.name||"Untitled",extractDate:new Date().toISOString(),pluginVersion:PLUGIN_VERSION,totalPages:figma.root.children.length,extractionScope:"scoped",scopeDescription:scope.desc},pages,textNodes:texts,variables:[],styles:[],components:comps,nodeCounts:{total:totalN,textNodes:texts.length,frames:fc,components:cc,instances:ic,byType},hierarchy};
}

// ── Async helpers ──
async function fetchAndDownloadVariables(){try{const localVars=await figma.variables.getLocalVariablesAsync();const vars:ExtractedVariable[]=[];let modeMap:{[c:string]:{[m:string]:string}}={};try{const cols=await figma.variables.getLocalVariableCollectionsAsync();for(const col of cols||[]){modeMap[col.id]={};for(const m of col.modes)modeMap[col.id][m.modeId]=m.name;}}catch(e){}for(const v of localVars||[]){const enriched:{[mn:string]:VariableValueInfo}={};const raw:any=v.valuesByMode||{};const colId=(v as any).variableCollectionId||"";for(const [modeId,value] of Object.entries(raw)){const mn=modeMap[colId]?.[modeId]||modeId;if(value&&typeof value==="object"&&"r" in value)enriched[mn]={raw:value,hex:rgbToHex((value as any).r,(value as any).g,(value as any).b),css:""};else enriched[mn]={raw:value};}vars.push({id:v.id,name:v.name,resolvedType:v.resolvedType,valuesByMode:enriched,scopes:v.scopes||[],description:v.description||"",remote:(v as any).remote||false});}addToZip(`${sanitizeName(figma.root.name)}_variables.json`,JSON.stringify(vars,null,2));figma.ui.postMessage({type:"async-data",data:{variables:vars.length}});}catch(e){figma.ui.postMessage({type:"async-data",data:{variables:0,error:true}});}}
async function fetchAndDownloadStyles(){try{const styles:ExtractedStyle[]=[];const ps=await figma.getLocalPaintStylesAsync();for(const s of ps||[]){const paints=s.paints&&s.paints.length>0?extractFills(s.paints):undefined;styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",paints,remote:(s as any).remote||false});}const ts=await figma.getLocalTextStylesAsync();for(const s of ts||[]){styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",fontSize:s.fontSize as number,fontFamily:(s as any).fontName?.family||undefined,fontWeight:(s as any).fontName?.style||undefined,lineHeight:(s as any).lineHeight&&typeof(s as any).lineHeight==="object"&&"value" in (s as any).lineHeight?{value:(s as any).lineHeight.value,unit:(s as any).lineHeight.unit||"PIXELS"}:null,remote:(s as any).remote||false});}const es=await figma.getLocalEffectStylesAsync();for(const s of es||[]){styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",remote:(s as any).remote||false});}const gs=await figma.getLocalGridStylesAsync();for(const s of gs||[]){styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",remote:(s as any).remote||false});}addToZip(`${sanitizeName(figma.root.name)}_styles.json`,JSON.stringify(styles,null,2));figma.ui.postMessage({type:"async-data",data:{styles:styles.length}});}catch(e){figma.ui.postMessage({type:"async-data",data:{styles:0,error:true}});}}

// Export utilities
async function exportNodeAsSVGEmbedded(nodeId:string):Promise<ZipFileEntry|null>{const n=await figma.getNodeByIdAsync(nodeId);if(!n)return null;const sn=n as SceneNode;try{const s=await sn.exportAsync({format:"SVG_STRING"}as ExportSettingsSVGString);if(!s||s.length<10)return null;return{name:`svgs/${sanitizeName(getPageName(n))}/${sanitizeName(n.name)}.svg`,data:TE.encode(s)};}catch(e){return null;}}
async function exportNodes(nodeIds:string[],format:"SVG"|"PNG"|"JPG"|"PDF",scale:number):Promise<ExportResultItem[]>{const r:ExportResultItem[]=[];for(const id of nodeIds){const n=await figma.getNodeByIdAsync(id);if(!n)continue;const sn=n as SceneNode;try{let b:Uint8Array;switch(format){case"SVG":b=await sn.exportAsync({format:"SVG"}as ExportSettingsSVG);break;case"PNG":b=await sn.exportAsync({format:"PNG",constraint:{type:"SCALE",value:scale}}as ExportSettingsImage);break;case"JPG":b=await sn.exportAsync({format:"JPG",constraint:{type:"SCALE",value:scale}}as ExportSettingsImage);break;case"PDF":b=await sn.exportAsync({format:"PDF"}as ExportSettingsPDF);break;default:continue;}r.push({id:n.id,name:sanitizeName(n.name),format:format.toLowerCase(),bytes:Array.from(b)});}catch(e){}}return r;}
async function buildLottieBundle(roots:BaseNode[]):Promise<any>{const allNodes=deepFlatten(roots);const items:any[]=[];for(const n of allNodes){if((n.type as string)==="PAGE")continue;try{const s=await(n as SceneNode).exportAsync({format:"SVG_STRING"}as ExportSettingsSVGString);if(s&&s.length>10)items.push({id:n.id,name:sanitizeName(n.name),type:n.type,pageName:getPageName(n),width:(n as SceneNode).width,height:(n as SceneNode).height,svg:s});}catch(e){}}return{fileName:`${sanitizeName(figma.root.name)}_lottie.json`,exportDate:new Date().toISOString(),source:figma.root.name||"Untitled",itemCount:items.length,items};}

// ── Message Handler ──
figma.showUI(__html__,{width:520,height:680,title:"Extract All"});
let cancelRequested=false;
function postSel(){figma.ui.postMessage({type:"selection-state",count:figma.currentPage.selection.length,pageName:figma.currentPage.name});}
figma.on("selectionchange",postSel);figma.on("currentpagechange",postSel);postSel();

figma.ui.onmessage=async(msg:any)=>{
  cancelRequested=false;
  zipFiles=[];
  const scope=getScope();
  const baseName=figma.root.name||"Untitled";

  // ═══ FULL EXTRACT (plain) ═══
  if(msg.type==="get-full-extract"&&!msg.aeOpts&&!msg.aiOpts){
    const data=buildFullExtractSync((p)=>{figma.ui.postMessage({type:"full-extract-progress",progress:p});});
    addToZip(`${baseName}_full-extract.json`,JSON.stringify(data,null,2));
    addToZip(`${baseName}_text.txt`,buildPlainText(data.textNodes));
    figma.ui.postMessage({type:"full-extract",data:{textNodes:data.textNodes.length,variables:0,styles:0,components:data.components.length,totalNodes:data.nodeCounts.total,scope:data.meta.scopeDescription}});
    flushZipAndDownload(baseName);
    fetchAndDownloadVariables();fetchAndDownloadStyles();
  }

  // ═══ AE EXTRACT ═══
  if(msg.type==="get-full-extract"&&msg.aeOpts){
    const data=buildFullExtractSync((p)=>{figma.ui.postMessage({type:"full-extract-progress",progress:p});});
    if(cancelRequested)return;
    addToZip(`${baseName}_full-extract.json`,JSON.stringify(data,null,2));
    addToZip(`${baseName}_text.txt`,buildPlainText(data.textNodes));
    if(msg.aeOpts.includeSVGs&&!cancelRequested){
      const allNodes=deepFlatten(scope.roots).filter(n=>n.type!=="TEXT"&&(n.type as string)!=="PAGE"&&isVisible(n));
      const total=allNodes.length;
      for(let i=0;i<allNodes.length;i+=8){
        if(cancelRequested)break;
        const batch=allNodes.slice(i,i+8);const results=await Promise.all(batch.map(n=>exportNodeAsSVGEmbedded(n.id)));
        for(const r of results){if(r)zipFiles.push(r);}
        figma.ui.postMessage({type:"progress",current:Math.min(i+8,total),total:total,label:"SVGs"});
      }
    }
    if(msg.aeOpts.includeLottie&&!cancelRequested){
      const bundle=await buildLottieBundle(scope.roots);
      addToZip(bundle.fileName,JSON.stringify(bundle,null,2));
    }
    figma.ui.postMessage({type:"full-extract",data:{textNodes:data.textNodes.length,variables:0,styles:0,components:data.components.length,totalNodes:data.nodeCounts.total,scope:data.meta.scopeDescription}});
    flushZipAndDownload(baseName);
    fetchAndDownloadVariables();fetchAndDownloadStyles();
  }

  // ═══ AI EXTRACT ═══
  if(msg.type==="get-full-extract"&&msg.aiOpts){
    const data=buildFullExtractSync((p)=>{figma.ui.postMessage({type:"full-extract-progress",progress:p});});
    if(cancelRequested)return;
    addToZip(`${baseName}_full-extract.json`,JSON.stringify(data,null,2));
    addToZip(`${baseName}_text.txt`,buildPlainText(data.textNodes));
    if(msg.aiOpts.includeSVGs&&!cancelRequested){
      const allNodes=deepFlatten(scope.roots).filter(n=>n.type!=="TEXT"&&(n.type as string)!=="PAGE"&&isVisible(n));
      const total=allNodes.length;
      for(let i=0;i<allNodes.length;i+=8){
        if(cancelRequested)break;
        const batch=allNodes.slice(i,i+8);const results=await Promise.all(batch.map(n=>exportNodeAsSVGEmbedded(n.id)));
        for(const r of results){if(r)zipFiles.push(r);}
        figma.ui.postMessage({type:"progress",current:Math.min(i+8,total),total:total,label:"SVGs"});
      }
    }
    figma.ui.postMessage({type:"full-extract",data:{textNodes:data.textNodes.length,variables:0,styles:0,components:data.components.length,totalNodes:data.nodeCounts.total,scope:data.meta.scopeDescription}});
    flushZipAndDownload(baseName);
    fetchAndDownloadVariables();fetchAndDownloadStyles();
  }

  // ═══ TEXT ONLY ═══
  if(msg.type==="get-text"){const nodes=deepFlatten(scope.roots);const tn=nodes.filter(n=>n.type==="TEXT").map(n=>extractText(n as TextNode));addToZip(`${baseName}_text.json`,JSON.stringify(tn,null,2));addToZip(`${baseName}_text.txt`,buildPlainText(tn));flushZipAndDownload(baseName+"_text");}

  // ═══ INDIVIDUAL DOWNLOADS (single files — no ZIP needed) ═══
  if(msg.type==="get-variables"){const v=await fetchAndDownloadVariablesInner();figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(baseName)}_variables.json`,content:JSON.stringify(v,null,2),mimeType:"application/json"});}
  if(msg.type==="get-styles"){const s=await fetchAndDownloadStylesInner();figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(baseName)}_styles.json`,content:JSON.stringify(s,null,2),mimeType:"application/json"});}
  if(msg.type==="get-components"){const c=extractAllComponents();figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(baseName)}_components.json`,content:JSON.stringify(c,null,2),mimeType:"application/json"});}
  if(msg.type==="get-pages"){const p=extractPages();figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(baseName)}_pages.json`,content:JSON.stringify(p,null,2),mimeType:"application/json"});}

  // ═══ SELECTED NODES (direct download, few files) ═══
  if(msg.type==="export-selected-svg"||msg.type==="export-selected-png"||msg.type==="export-selected-jpg"){
    const sel=figma.currentPage.selection;if(sel.length===0){figma.ui.postMessage({type:"error",message:"No nodes selected"});return;}
    const fmt=msg.type==="export-selected-svg"?"SVG":msg.type==="export-selected-png"?"PNG":"JPG";const sc=fmt==="SVG"?(msg.scale||1):(msg.scale||2);
    const results=await exportNodes(sel.map((n:SceneNode)=>n.id),fmt,sc);if(results.length>0)figma.ui.postMessage({type:"export-results",results});
  }
  if(msg.type==="get-svg-as-text"){const sel=figma.currentPage.selection;if(sel.length===0){figma.ui.postMessage({type:"error",message:"No nodes selected"});return;}for(const node of sel){const s=await(node as SceneNode).exportAsync({format:"SVG_STRING"}as ExportSettingsSVGString);if(s)figma.ui.postMessage({type:"download-file",fileName:`${sanitizeName(node.name)}.svg`,content:s,mimeType:"image/svg+xml"});}}

  // ═══ LOTTIE ═══
  if(msg.type==="export-lottie-json"){const bundle=await buildLottieBundle(scope.roots);figma.ui.postMessage({type:"download-file",fileName:bundle.fileName,content:JSON.stringify(bundle,null,2),mimeType:"application/json"});}
  if(msg.type==="import-lottie-json"){try{const p=JSON.parse(String(msg.content||""));const keys=p&&typeof p==="object"?Object.keys(p):[];const ly=Array.isArray(p?.layers)?p.layers.length:0;figma.ui.postMessage({type:"lottie-import-summary",summary:{fileName:msg.fileName||"lottie.json",valid:true,topLevelKeys:keys,layerCount:ly,warning:ly===0?"No layers":"OK"}});}catch(e){figma.ui.postMessage({type:"lottie-import-summary",summary:{fileName:msg.fileName||"lottie.json",valid:false,topLevelKeys:[],layerCount:0,warning:"Invalid JSON"}});}}

  // ═══ BATCH EXPORT (ZIP) ═══
  if(msg.type==="export-all-svg-page"||msg.type==="export-all-png-page"||msg.type==="export-all-svg-all-pages"||msg.type==="export-all-png-all-pages"){
    const fmt=msg.type.includes("svg")?"SVG":"PNG";const sc=fmt==="SVG"?(msg.scale||1):(msg.scale||2);
    const pages=msg.type.includes("all-pages")?[...figma.root.children]:[figma.currentPage];
    let tN=0;for(const pg of pages)tN+=deepFlatten([pg]).filter((n:any)=>isVisible(n)&&n.type!=="PAGE").length;
    let pN=0;
    for(const pg of pages){const ns=deepFlatten([pg]).filter((n:any)=>isVisible(n)&&n.type!=="PAGE");
      for(let i=0;i<ns.length;i+=20){if(cancelRequested)break;
        const batch=ns.slice(i,i+20).map(n=>n.id);const r=await exportNodes(batch,fmt,sc);
        for(const x of r){
          const ext=fmt.toLowerCase();const fname=pages.length>1?`${sanitizeName(pg.name)}/${x.name}.${ext}`:`${x.name}.${ext}`;
          zipFiles.push({name:fname,data:new Uint8Array(x.bytes)});
        }
        pN+=batch.length;figma.ui.postMessage({type:"progress",current:Math.min(pN,tN),total:tN,label:fmt});
      }
    }
    if(!cancelRequested){flushZipAndDownload(baseName+"_batch");figma.ui.postMessage({type:"export-complete"});}
  }

  if(msg.type==="cancel"){cancelRequested=true;zipFiles=[];}
  if(msg.type==="resize"){figma.ui.resize(msg.width,msg.height);}
  if(msg.type==="close"){figma.closePlugin();}
};

// Individual fetch helpers for single-file downloads
async function fetchAndDownloadVariablesInner():Promise<ExtractedVariable[]>{try{const localVars=await figma.variables.getLocalVariablesAsync();const vars:ExtractedVariable[]=[];let modeMap:{[c:string]:{[m:string]:string}}={};try{const cols=await figma.variables.getLocalVariableCollectionsAsync();for(const col of cols||[]){modeMap[col.id]={};for(const m of col.modes)modeMap[col.id][m.modeId]=m.name;}}catch(e){}for(const v of localVars||[]){const enriched:{[mn:string]:VariableValueInfo}={};const raw:any=v.valuesByMode||{};const colId=(v as any).variableCollectionId||"";for(const [modeId,value] of Object.entries(raw)){const mn=modeMap[colId]?.[modeId]||modeId;if(value&&typeof value==="object"&&"r" in value)enriched[mn]={raw:value,hex:rgbToHex((value as any).r,(value as any).g,(value as any).b),css:""};else enriched[mn]={raw:value};}vars.push({id:v.id,name:v.name,resolvedType:v.resolvedType,valuesByMode:enriched,scopes:v.scopes||[],description:v.description||"",remote:(v as any).remote||false});}return vars;}catch(e){return[];}}
async function fetchAndDownloadStylesInner():Promise<ExtractedStyle[]>{try{const styles:ExtractedStyle[]=[];const ps=await figma.getLocalPaintStylesAsync();for(const s of ps||[]){const paints=s.paints&&s.paints.length>0?extractFills(s.paints):undefined;styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",paints,remote:(s as any).remote||false});}const ts=await figma.getLocalTextStylesAsync();for(const s of ts||[]){styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",fontSize:s.fontSize as number,fontFamily:(s as any).fontName?.family||undefined,fontWeight:(s as any).fontName?.style||undefined,lineHeight:(s as any).lineHeight&&typeof(s as any).lineHeight==="object"&&"value" in (s as any).lineHeight?{value:(s as any).lineHeight.value,unit:(s as any).lineHeight.unit||"PIXELS"}:null,remote:(s as any).remote||false});}const es=await figma.getLocalEffectStylesAsync();for(const s of es||[]){styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",remote:(s as any).remote||false});}const gs=await figma.getLocalGridStylesAsync();for(const s of gs||[]){styles.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",remote:(s as any).remote||false});}return styles;}catch(e){return[];}}