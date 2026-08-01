// Figma Extract All v18.1.0 — Dynamic-page-aware extraction
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
interface FullExtract {meta:{fileName:string;extractDate:string;pluginVersion:string;totalPages:number;extractionScope:string;scopeDescription:string};pages:ExtractedPage[];textNodes:ExtractedText[];variables:ExtractedVariable[];styles:ExtractedStyle[];components:ExtractedComponent[];nodeCounts:{total:number;textNodes:number;frames:number;components:number;instances:number;byType:{[t:string]:number}};hierarchy:HierarchyNode[];}
interface FullExtractProgress {step:number;totalSteps:number;label:string;detail:string;}
interface ExportResultItem {id:string;name:string;format:string;bytes:number[];}
interface ZipFileEntry {name:string;data:Uint8Array;}
interface LottieAnalysis {fileName:string;valid:boolean;errors:string[];meta:{frameRate:number;inPoint:number;outPoint:number;width:number;height:number;duration:number};stats:{layers:number;shapes:number;paths:number;images:number;texts:number;solids:number;nulls:number;precomps:number};assets:AssetInfo[];expressions:string[];markers:MarkerInfo[];warnings:WarningInfo[];layerTree:any[];bodymovinSettings:BMCheckResult;layerTreeRaw:any[];hasKeyframes:boolean;hasAssets:boolean;totalFrames:number;}
interface AssetInfo {id:string;type:string;name:string;refId?:string;width?:number;height?:number;embedded:boolean;}
interface MarkerInfo {name:string;time:number;duration:number;}
interface WarningInfo {type:string;message:string;fix:string;}
interface BMCheckResult {includeAssets:boolean;includeKeyframes:boolean;includeExpressions:boolean;hiddenLayers:boolean;compressedJson:boolean;settingsOK:boolean;}

const PLUGIN_VERSION="18.1.1";
const TE={encode:(s:string)=>{const r=new Uint8Array(s.length);for(let i=0;i<s.length;i++)r[i]=s.charCodeAt(i)&0xFF;return r;}};
const CRC_TABLE:Uint32Array=((()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[i]=c>>>0;}return t;}))();
function crc32(d:Uint8Array):number{let c=0xFFFFFFFF;for(let i=0;i<d.length;i++)c=CRC_TABLE[(c^d[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function makeZip(files:ZipFileEntry[]):Uint8Array{const locals:Uint8Array[]=[],cdirs:Uint8Array[]=[];let off=0;for(const f of files){const nb=TE.encode(f.name);const crc=crc32(f.data);const sz=f.data.length;const lh=new Uint8Array(30+nb.length);new DataView(lh.buffer).setUint32(0,0x04034b50,true);lh[6]=0;lh[7]=0;lh[8]=0;lh[9]=0;new DataView(lh.buffer).setUint32(14,crc,true);new DataView(lh.buffer).setUint32(18,sz,true);new DataView(lh.buffer).setUint32(22,sz,true);new DataView(lh.buffer).setUint16(26,nb.length,true);lh[28]=0;lh[29]=0;lh.set(nb,30);locals.push(lh,f.data);const entryOff=off;off+=30+nb.length+sz;const cd=new Uint8Array(46+nb.length);new DataView(cd.buffer).setUint32(0,0x02014b50,true);cd[6]=0;cd[7]=0;cd[8]=0;cd[9]=0;new DataView(cd.buffer).setUint32(16,crc,true);new DataView(cd.buffer).setUint32(20,sz,true);new DataView(cd.buffer).setUint32(24,sz,true);new DataView(cd.buffer).setUint16(28,nb.length,true);new DataView(cd.buffer).setUint32(42,entryOff,true);cd.set(nb,46);cdirs.push(cd);}const cdOff=off;const cdSz=cdirs.reduce((s,a)=>s+a.length,0);const eocd=new Uint8Array(22);new DataView(eocd.buffer).setUint32(0,0x06054b50,true);new DataView(eocd.buffer).setUint16(8,files.length,true);new DataView(eocd.buffer).setUint16(10,files.length,true);new DataView(eocd.buffer).setUint32(12,cdSz,true);new DataView(eocd.buffer).setUint32(16,cdOff,true);const total=off+cdSz+22;const result=new Uint8Array(total);let pos=0;for(const p of locals){result.set(p,pos);pos+=p.length;}for(const p of cdirs){result.set(p,pos);pos+=p.length;}result.set(eocd,pos);return result;}

function analyzeLottieFile(fileName:string,content:string):LottieAnalysis{
  const a:LottieAnalysis={fileName,valid:false,errors:[],meta:{frameRate:0,inPoint:0,outPoint:0,width:0,height:0,duration:0},stats:{layers:0,shapes:0,paths:0,images:0,texts:0,solids:0,nulls:0,precomps:0},assets:[],expressions:[],markers:[],warnings:[],layerTree:[],layerTreeRaw:[],bodymovinSettings:{includeAssets:false,includeKeyframes:false,includeExpressions:false,hiddenLayers:false,compressedJson:true,settingsOK:false},hasKeyframes:false,hasAssets:false,totalFrames:0};
  let json:any;try{json=JSON.parse(content);a.valid=true;}catch(e){a.errors.push("Invalid JSON");return a;}
  if(!json){a.errors.push("Empty file");return a;}
  a.meta.frameRate=json.fr||0;a.meta.inPoint=json.ip||0;a.meta.outPoint=json.op||0;a.meta.width=json.w||0;a.meta.height=json.h||0;a.meta.duration=a.meta.frameRate>0?(a.meta.outPoint-a.meta.inPoint)/a.meta.frameRate:0;a.totalFrames=a.meta.outPoint-a.meta.inPoint;return a;
}

function sanitizeName(n:string):string{return n.replace(/[<>:"\/\\|?*\x00-\x1f]/g,"_").replace(/\.+$/,"").trim()||"unnamed";}
function getPageName(node:BaseNode):string{let c:BaseNode|null=(node as any).parent||null;while(c){if(c.type==="PAGE")return c.name;c=(c as any).parent||null;}return"(unknown)";}
function extractFills(f:any):FillInfo[]{if(f===figma.mixed)return[];const r:FillInfo[]=[];for(const fi of f||[]){if(fi.type==="SOLID"&&fi.color)r.push({type:"SOLID",hex:"#000",rgba:{r:fi.color.r,g:fi.color.g,b:fi.color.b,a:fi.opacity??1},opacity:fi.opacity??1,visible:fi.visible??true,blendMode:fi.blendMode??"NORMAL",boundVariableId:fi.boundVariables?.color?.id||null});}return r;}
function extractText(node:TextNode):ExtractedText{
  return{id:node.id,name:node.name,characters:node.characters,
    pageName:"(page)",parentPath:"(path)",parentFrame:"(frame)",
    absoluteX:0,absoluteY:0,width:Math.round(node.width*100)/100,height:Math.round(node.height*100)/100,
    x:Math.round(node.x*100)/100,y:Math.round(node.y*100)/100,
    fontFamily:node.fontName!==figma.mixed&&typeof node.fontName==="object"?node.fontName.family:"unknown",
    fontStyle:node.fontName!==figma.mixed&&typeof node.fontName==="object"?node.fontName.style:"Regular",
    fontSize:typeof node.fontSize==="number"?node.fontSize:0,
    fontWeight:typeof(node as any).fontWeight==="number"?(node as any).fontWeight:400,
    lineHeight:null,letterSpacing:null,
    textAlignHorizontal:node.textAlignHorizontal,textAlignVertical:node.textAlignVertical,
    fills:[],opacity:Math.round(node.opacity*100)/100};
}
function buildPlainText(texts:ExtractedText[]):string{const l:string[]=[`═══ TEXT — ${figma.root.name||"Untitled"}`,`  ${new Date().toISOString()}`,`═══`,` `];for(const t of texts){l.push(`── ${t.name} ──`,`  Font: ${t.fontFamily} ${t.fontStyle} ${t.fontSize}px`,`  Text: ${t.characters.split('\n').join('↵')}`,` `);}l.push(`── END (${texts.length} texts) ──`);return l.join("\n");}

let zipFiles:ZipFileEntry[]=[];
function addToZip(n:string,c:string|Uint8Array){if(typeof c==="string")zipFiles.push({name:n,data:TE.encode(c)});else zipFiles.push({name:n,data:c});}
function flushZipChunked(fb:string){if(zipFiles.length===0)return;const zip=makeZip(zipFiles);zipFiles=[];const CH=400000;const t=Math.ceil(zip.length/CH);const zn=`${sanitizeName(fb)}_extract.zip`;for(let i=0;i<t;i++){const s=i*CH,e=Math.min(s+CH,zip.length);figma.ui.postMessage({type:"zip-chunk",fileName:zn,index:i,total:t,bytes:Array.from(zip.slice(s,e))});}}
function downloadFile(fn:string,ct:string,m:string){figma.ui.postMessage({type:"download-file",fileName:fn,content:ct,mimeType:m});}
async function fetchVars(baseName:string){try{const vars:ExtractedVariable[]=[];let mm:{[c:string]:{[m:string]:string}}={};const[lv,c]=await Promise.all([figma.variables.getLocalVariablesAsync().catch(()=>null),figma.variables.getLocalVariableCollectionsAsync().catch(()=>null)]);if(c)for(const col of c||[]){mm[col.id]={};for(const m of col.modes)mm[col.id][m.modeId]=m.name;}if(lv)for(const v of lv||[]){const en:{[mn:string]:VariableValueInfo}={};const raw:any=v.valuesByMode||{};const ci=(v as any).variableCollectionId||"";for(const[mi,val]of Object.entries(raw)){const mn=mm[ci]?.[mi]||mi;en[mn]={raw:val};}vars.push({id:v.id,name:v.name,resolvedType:v.resolvedType,valuesByMode:en,scopes:v.scopes||[],description:v.description||"",remote:(v as any).remote||false});}addToZip(`${baseName}_variables.json`,JSON.stringify(vars));}catch(e){addToZip(`${baseName}_variables.json`,"[]");}}
async function fetchStyles(baseName:string){try{const ss:ExtractedStyle[]=[];const[ps,ts,es,gs]=await Promise.all([figma.getLocalPaintStylesAsync().catch(()=>[]),figma.getLocalTextStylesAsync().catch(()=>[]),figma.getLocalEffectStylesAsync().catch(()=>[]),figma.getLocalGridStylesAsync().catch(()=>[])]);for(const s of ps||[]){ss.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",paints:s.paints&&s.paints.length>0?extractFills(s.paints):undefined,remote:(s as any).remote||false});}for(const s of ts||[]){ss.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",fontSize:s.fontSize as number,fontFamily:(s as any).fontName?.family||undefined,fontWeight:(s as any).fontName?.style||undefined,lineHeight:(s as any).lineHeight&&typeof(s as any).lineHeight==="object"&&"value" in (s as any).lineHeight?{value:(s as any).lineHeight.value,unit:(s as any).lineHeight.unit||"PIXELS"}:null,remote:(s as any).remote||false});}for(const s of es||[]){ss.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",remote:(s as any).remote||false});}for(const s of gs||[]){ss.push({id:s.id,name:s.name,key:s.key,styleType:s.type,description:s.description||"",remote:(s as any).remote||false});}addToZip(`${baseName}_styles.json`,JSON.stringify(ss));}catch(e){addToZip(`${baseName}_styles.json`,"[]");}}
async function svgExport(nid:string,pageName:string):Promise<ZipFileEntry|null>{try{const n=await figma.getNodeByIdAsync(nid);if(!n)return null;const s=await(n as SceneNode).exportAsync({format:"SVG_STRING"}as ExportSettingsSVGString);if(!s||s.length<10)return null;return{name:`svgs/${sanitizeName(pageName)}/${sanitizeName(n.name)}.svg`,data:TE.encode(s)};}catch(e){return null;}}
async function exportNodes(nodeIds:string[],format:"SVG"|"PNG"|"JPG"|"PDF",scale:number):Promise<ExportResultItem[]>{const r:ExportResultItem[]=[];for(const id of nodeIds){const n=await figma.getNodeByIdAsync(id);if(!n)continue;try{let b:Uint8Array;switch(format){case"SVG":b=await(n as SceneNode).exportAsync({format:"SVG"}as ExportSettingsSVG);break;case"PNG":b=await(n as SceneNode).exportAsync({format:"PNG",constraint:{type:"SCALE",value:scale}}as ExportSettingsImage);break;case"JPG":b=await(n as SceneNode).exportAsync({format:"JPG",constraint:{type:"SCALE",value:scale}}as ExportSettingsImage);break;case"PDF":b=await(n as SceneNode).exportAsync({format:"PDF"}as ExportSettingsPDF);break;default:continue;}r.push({id:n.id,name:sanitizeName(n.name),format:format.toLowerCase(),bytes:Array.from(b)});}catch(e){}}return r;}

// ═══════════════ MAIN PLUGIN ═══════════════
figma.showUI(__html__,{width:520,height:700,title:"Extract All"});
let cancelRequested=false;
function postSel(){figma.ui.postMessage({type:"selection-state",count:figma.currentPage.selection.length,pageName:figma.currentPage.name});}
figma.on("selectionchange",postSel);figma.on("currentpagechange",postSel);postSel();
let lastAnalysis:LottieAnalysis|null=null;
let runningExtract=false;

figma.ui.onmessage=async(msg:any)=>{
  cancelRequested=false;zipFiles=[];const baseName=sanitizeName(figma.root.name||"Untitled");
  if(msg.type==="import-lottie-json"){lastAnalysis=analyzeLottieFile(msg.fileName||"lottie.json",String(msg.content||""));figma.ui.postMessage({type:"lottie-analysis",analysis:lastAnalysis,rawJson:String(msg.content||"")});return;}
  if(msg.type==="lottie-gif-rendered"){try{const bytes=new Uint8Array(msg.bytes);const image=figma.createImage(bytes);const rect=figma.createRectangle();rect.resize(msg.width,msg.height);rect.name=(msg.fileName?sanitizeName(msg.fileName.replace(/\.json$/,''))+' (Lottie GIF)':'Lottie Animation');rect.fills=[{type:'IMAGE',imageHash:image.hash,scaleMode:'FILL'}];const center=figma.viewport.center;rect.x=Math.round(center.x-msg.width/2);rect.y=Math.round(center.y-msg.height/2);figma.currentPage.appendChild(rect);figma.viewport.scrollAndZoomIntoView([rect]);figma.ui.postMessage({type:"animation-placed",name:rect.name,x:rect.x,y:rect.y});}catch(e){figma.ui.postMessage({type:"error",message:"Failed to place GIF: "+(e as Error).message});}return;}
  if(msg.type==="cancel"){cancelRequested=true;runningExtract=false;zipFiles=[];return;}
  if(msg.type==="resize"){figma.ui.resize(msg.width,msg.height);return;}
  if(msg.type==="close"){figma.closePlugin();return;}

  if(msg.type==="get-full-extract"){
    if(runningExtract){figma.ui.postMessage({type:"error",message:"Already extracting"});return;}
    runningExtract=true;
    const opts=msg.aeOpts||msg.aiOpts;
    try{await figma.loadAllPagesAsync();}catch(e){figma.ui.postMessage({type:"error",message:"Page load failed: "+(e as Error).message});runningExtract=false;return;}
    const sel=figma.currentPage.selection;
    const isScoped=sel.length>0;
    const pgName=figma.currentPage.name;
    
    figma.ui.postMessage({type:"full-extract-progress",progress:{step:0,totalSteps:3,label:"Scan",detail:"Collecting nodes…"}});
    
    let workingNodes:SceneNode[];
    if(isScoped){workingNodes=[]; for(const s of sel)walk(s as any,workingNodes);}
    else{workingNodes=(figma.currentPage as any).findAll(()=>true) as SceneNode[];}
    
    if(cancelRequested){runningExtract=false;return;}
    const total=workingNodes.length;
    const texts:ExtractedText[]=[];const comps:ExtractedComponent[]=[];const byType:{[t:string]:number}={};
    let cursor=0;const BATCH=200;
    
    function walk(n:any,r:any[]){if(n.type!=="PAGE")r.push(n);if(n.children)for(const c of n.children)walk(c,r);}
    
    function processBatch(){
      if(cancelRequested||cursor>=total){return finishExtract();}
      const end=Math.min(cursor+BATCH,total);
      for(let i=cursor;i<end;i++){
        const n=workingNodes[i];const t=n.type;byType[t]=(byType[t]||0)+1;
        if(t==="TEXT"){try{texts.push(extractText(n as TextNode));}catch(e){}}
        else if(t==="COMPONENT"||t==="COMPONENT_SET"){try{const sc=n as SceneNode;let vp:any=null;if(t==="COMPONENT_SET"){const rp=(n as any).variantGroupProperties||(n as any).variantProperties;if(rp){vp={};for(const k of Object.keys(rp))vp[k]=rp[k];}}comps.push({id:n.id,name:n.name,key:(n as ComponentNode).key||"",description:(n as ComponentNode).description||"",type:t,pageName:isScoped?getPageName(n):pgName,hasVariants:t==="COMPONENT_SET",variantProperties:vp,width:Math.round((n as any).width*100)/100,height:Math.round((n as any).height*100)/100,childCount:(n as any).children?((n as any).children.length):0});}catch(e){}}
      }
      cursor=end;
      figma.ui.postMessage({type:"full-extract-progress",progress:{step:1,totalSteps:3,label:"Extract",detail:`${cursor}/${total} (${texts.length} texts)`}});
      setTimeout(processBatch,0);
    }
    
    function finishExtract(){
      figma.ui.postMessage({type:"full-extract-progress",progress:{step:2,totalSteps:3,label:"Build",detail:"Assembling…"}});
      const pages:ExtractedPage[]=[];
      for(const pg of figma.root.children){
        const pgd=pg as any;
        const topFrames=(pgd.children||[]).map((c:any)=>({id:c.id,name:c.name||"",width:Math.round(c.width*100)/100,height:Math.round(c.height*100)/100,childCount:c.children?c.children.length:0}));
        pages.push({id:pg.id,name:pgd.name||"",nodeCount:0,background:pgd.backgrounds&&pgd.backgrounds.length>0?JSON.parse(JSON.stringify(pgd.backgrounds[0])):null,topLevelFrames:topFrames});
      }
      const data:FullExtract={meta:{fileName:figma.root.name||"Untitled",extractDate:new Date().toISOString(),pluginVersion:PLUGIN_VERSION,totalPages:figma.root.children.length,extractionScope:isScoped?"selection":"page",scopeDescription:isScoped?`${sel.length} items`:"entire page"},pages,textNodes:texts,variables:[],styles:[],components:comps,nodeCounts:{total,textNodes:texts.length,frames:byType["FRAME"]||0,components:byType["COMPONENT"]||0,instances:byType["INSTANCE"]||0,byType},hierarchy:[]};
      const tc=buildPlainText(texts);
      if(tc.length<65000)downloadFile(`${baseName}_text.txt`,tc,"text/plain");
      else addToZip(`${baseName}_text.txt`,tc);
      addToZip(`${baseName}_full-extract.json`,JSON.stringify(data));
      flushZipChunked(baseName);
      figma.ui.postMessage({type:"full-extract",data:{textNodes:texts.length,variables:0,styles:0,components:comps.length,totalNodes:total,scope:isScoped?`${sel.length} items`:"entire page"}});
      runningExtract=false;
      if(opts){
        setTimeout(()=>{
          (async()=>{try{
            await fetchVars(baseName);await fetchStyles(baseName);
            if(opts.includeSVGs&&!cancelRequested){
              const an=workingNodes.filter(n=>n.type!=="TEXT"&&(n.type as string)!=="PAGE"&&n.visible!==false);
              figma.ui.postMessage({type:"progress",current:0,total:an.length,label:"SVG Export"});
              for(let i=0;i<an.length&&!cancelRequested;i+=4){
                try{const br=await Promise.all(an.slice(i,i+4).map(n=>svgExport(n.id,pgName)));for(const r of br)if(r)zipFiles.push(r);}catch(e){}
                figma.ui.postMessage({type:"progress",current:Math.min(i+4,an.length),total:an.length,label:"SVG Export"});
              }
            }
            if(msg.aeOpts&&msg.aeOpts.includeLottie&&!cancelRequested){try{addToZip(`${baseName}_lottie.json`,"[]");}catch(e){}}
            if(zipFiles.length>0)flushZipChunked(baseName+"_extras");
          }catch(e){figma.ui.postMessage({type:"error",message:"Extras: "+(e as Error).message});}})();
        },100);
      }
    }
    setTimeout(processBatch,10);
    return;
  }

  if(msg.type==="get-text"){await figma.loadAllPagesAsync();const nodes=(figma.currentPage as any).findAll(()=>true)as SceneNode[];const tn:ExtractedText[]=[];for(const n of nodes)if(n.type==="TEXT")try{tn.push(extractText(n as TextNode));}catch(e){}const txt=buildPlainText(tn);if(txt.length<65000)downloadFile(`${baseName}_text.txt`,txt,"text/plain");else addToZip(`${baseName}_text.txt`,txt);addToZip(`${baseName}_text.json`,JSON.stringify(tn));flushZipChunked(baseName+"_text");return;}
  if(msg.type==="get-components"){await figma.loadAllPagesAsync();const nodes=(figma.currentPage as any).findAll(()=>true)as SceneNode[];const cc:ExtractedComponent[]=[];for(const n of nodes){if(n.type==="COMPONENT"||n.type==="COMPONENT_SET"){try{const sc=n as SceneNode;let vp:any=null;if(n.type==="COMPONENT_SET"){const rp=(n as any).variantGroupProperties||(n as any).variantProperties;if(rp){vp={};for(const k of Object.keys(rp))vp[k]=rp[k];}}cc.push({id:n.id,name:n.name,key:(n as ComponentNode).key||"",description:(n as ComponentNode).description||"",type:n.type,pageName:getPageName(n),hasVariants:n.type==="COMPONENT_SET",variantProperties:vp,width:Math.round(sc.width*100)/100,height:Math.round(sc.height*100)/100,childCount:(n as any).children?((n as any).children.length):0});}catch(e){}}}addToZip(`${baseName}_components.json`,JSON.stringify(cc));flushZipChunked(baseName+"_components");return;}
  if(msg.type==="get-variables"){await fetchVars(baseName);flushZipChunked(baseName+"_variables");return;}
  if(msg.type==="get-styles"){await fetchStyles(baseName);flushZipChunked(baseName+"_styles");return;}
  if(msg.type==="get-pages"){await figma.loadAllPagesAsync();const pp:ExtractedPage[]=[];for(const pg of figma.root.children){const pgd=pg as any;pp.push({id:pg.id,name:pgd.name||"",nodeCount:0,background:pgd.backgrounds&&pgd.backgrounds.length>0?JSON.parse(JSON.stringify(pgd.backgrounds[0])):null,topLevelFrames:(pgd.children||[]).map((c:any)=>({id:c.id,name:c.name||"",width:Math.round(c.width*100)/100,height:Math.round(c.height*100)/100,childCount:c.children?c.children.length:0}))});}addToZip(`${baseName}_pages.json`,JSON.stringify(pp));flushZipChunked(baseName+"_pages");return;}
  if(msg.type==="export-selected-svg"||msg.type==="export-selected-png"||msg.type==="export-selected-jpg"){const sel=figma.currentPage.selection;if(sel.length===0){figma.ui.postMessage({type:"error",message:"No nodes selected"});return;}const fmt=msg.type==="export-selected-svg"?"SVG":msg.type==="export-selected-png"?"PNG":"JPG";const sc=fmt==="SVG"?(msg.scale||1):(msg.scale||2);const results=await exportNodes(sel.map((n:SceneNode)=>n.id),fmt,sc);if(results.length<=3){if(results.length>0)figma.ui.postMessage({type:"export-results",results});}else{for(const x of results)addToZip(`${x.name}.${x.format.toLowerCase()}`,new Uint8Array(x.bytes));flushZipChunked(baseName+"_selected");}return;}
  if(msg.type==="get-svg-as-text"){const sel=figma.currentPage.selection;if(sel.length===0){figma.ui.postMessage({type:"error",message:"No nodes selected"});return;}for(const node of sel){const s=await(node as SceneNode).exportAsync({format:"SVG_STRING"}as ExportSettingsSVGString);if(s)downloadFile(`${sanitizeName(node.name)}.svg`,s,"image/svg+xml");}return;}
  if(msg.type==="export-lottie-json"){downloadFile(`${baseName}_lottie.json`,"[]","application/json");return;}
  if(msg.type==="export-all-svg-page"||msg.type==="export-all-png-page"||msg.type==="export-all-svg-all-pages"||msg.type==="export-all-png-all-pages"){await figma.loadAllPagesAsync();const fmt=msg.type.includes("svg")?"SVG":"PNG";const sc=fmt==="SVG"?(msg.scale||1):(msg.scale||2);const pages=msg.type.includes("all-pages")?[...figma.root.children]:[figma.currentPage];let tN=0;for(const pg of pages){const ns=(pg as any).findAll(()=>true).filter((n:any)=>n.visible!==false&&n.type!=="PAGE");tN+=ns.length;}let pN=0;for(const pg of pages){const ns=(pg as any).findAll(()=>true).filter((n:any)=>n.visible!==false&&n.type!=="PAGE");for(let i=0;i<ns.length;i+=20){if(cancelRequested)break;const r=await exportNodes(ns.slice(i,i+20).map((n:any)=>n.id),fmt,sc);for(const x of r){const fname=pages.length>1?`${sanitizeName((pg as any).name||"")}/${x.name}.${x.format.toLowerCase()}`:`${x.name}.${x.format.toLowerCase()}`;zipFiles.push({name:fname,data:new Uint8Array(x.bytes)});}pN+=Math.min(20,ns.length-i);figma.ui.postMessage({type:"progress",current:pN,total:tN,label:fmt});}}if(!cancelRequested){flushZipChunked(baseName+"_batch");figma.ui.postMessage({type:"export-complete"});}return;}
};