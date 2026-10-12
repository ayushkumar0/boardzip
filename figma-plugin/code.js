figma.showUI(__html__,{width:470,height:700,themeColors:true});
let session=null,working=false;
function selectionInfo(){figma.ui.postMessage({type:'selection',nodes:figma.currentPage.selection.map(n=>({id:n.id,name:n.name,type:n.type,canExport:typeof n.exportAsync==='function',source:n.getPluginData('boardzip-source')}))});}
figma.on('selectionchange',selectionInfo);selectionInfo();
function topSelection(){
 const nodes=[...figma.currentPage.selection],ids=new Set(nodes.map(n=>n.id));
 return nodes.filter(n=>{let p=n.parent;while(p){if(ids.has(p.id))return false;p=p.parent;}return true;});
}
async function combinedExport(nodes,settings){
 if(figma.editorType!=='figma')throw new Error('Combined-area export is available in Figma Design. In FigJam, group the selected objects and export that group.');
 const bounds=nodes.map(n=>n.absoluteRenderBounds||n.absoluteBoundingBox).filter(Boolean);
 if(!bounds.length)throw new Error('Selected nodes have no renderable bounds.');
 const x=Math.min(...bounds.map(b=>b.x)),y=Math.min(...bounds.map(b=>b.y));
 const width=Math.max(...bounds.map(b=>b.x+b.width))-x,height=Math.max(...bounds.map(b=>b.y+b.height))-y;
 if(width<=0||height<=0)throw new Error('Selected area has no size.');
 const oldSelection=[...figma.currentPage.selection];const temporary=figma.createFrame();
 try{
  temporary.name='BoardZip temporary export';temporary.fills=[];temporary.clipsContent=true;temporary.resize(width,height);temporary.x=x;temporary.y=y;
  for(const n of nodes){const t=n.absoluteTransform.map(row=>[...row]);const clone=n.clone();temporary.appendChild(clone);clone.relativeTransform=[[t[0][0],t[0][1],t[0][2]-x],[t[1][0],t[1][1],t[1][2]-y]];}
  return await temporary.exportAsync(settings);
 }finally{temporary.remove();figma.currentPage.selection=oldSelection.filter(n=>!n.removed);}
}
figma.ui.onmessage=async m=>{
 if(m.type==='ready'){selectionInfo();return;}
 if(working){figma.ui.postMessage({type:'result',id:m.id,ok:false,error:'Another canvas operation is running.'});return;}
 working=true;
 try{
  let data;
  if(m.type==='import-begin'){
   if(session)throw new Error('Finish the previous import first.');
   const columns=Math.round(Number(m.columns)||4),width=Number(m.width),gap=Number(m.gap);
   if(columns<1||columns>12||!Number.isFinite(width)||width<0||width>5000||!Number.isFinite(gap)||gap<0||gap>500)throw new Error('Invalid layout settings.');
   let frame=null;if(figma.editorType==='figma'){frame=figma.createFrame();frame.name=String(m.title||'Pinterest moodboard').slice(0,200);frame.fills=[];frame.clipsContent=false;}
   session={nodes:[],frame,columns,width,gap,origin:{...figma.viewport.center}};data={started:true};
  }else if(m.type==='import-image'){
   if(!session)throw new Error('Start an import first.');
   const bytes=new Uint8Array(m.bytes);if(!bytes.length||bytes.length>100*1024*1024)throw new Error('Invalid image size.');
   const image=figma.createImage(bytes);const size=await image.getSizeAsync();
   const node=figma.createRectangle();
   try{
    node.name=String(m.title||`Pin ${m.pinId}`).slice(0,200);const width=session.width||size.width;node.resize(width,width*size.height/size.width);
    node.fills=[{type:'IMAGE',imageHash:image.hash,scaleMode:'FIT'}];
    node.setPluginData('boardzip-pin-id',String(m.pinId||''));node.setPluginData('boardzip-source',String(m.pinURL||''));node.setPluginData('boardzip-original-size',JSON.stringify(size));
    if(session.frame)session.frame.appendChild(node);session.nodes.push(node);data={nodeId:node.id,width:size.width,height:size.height};
   }catch(e){node.remove();throw e;}
  }else if(m.type==='import-finish'){
   if(!session)throw new Error('No active import.');
   const s=session;session=null;
   if(!s.nodes.length){s.frame?.remove();data={count:0};}
   else{
    const widths=Array(s.columns).fill(0),heights=[];
    s.nodes.forEach((n,i)=>{widths[i%s.columns]=Math.max(widths[i%s.columns],n.width);const row=Math.floor(i/s.columns);heights[row]=Math.max(heights[row]||0,n.height);});
    const offsets=(values)=>values.map((_,i)=>values.slice(0,i).reduce((a,b)=>a+b+s.gap,0));const xs=offsets(widths),ys=offsets(heights);
    const usedCols=Math.min(s.columns,s.nodes.length);const w=widths.slice(0,usedCols).reduce((a,b)=>a+b,0)+s.gap*(usedCols-1),h=heights.reduce((a,b)=>a+b,0)+s.gap*(heights.length-1);
    if(s.frame){s.frame.resize(Math.max(w,1),Math.max(h,1));s.frame.x=s.origin.x-w/2;s.frame.y=s.origin.y-h/2;}
    s.nodes.forEach((n,i)=>{n.x=xs[i%s.columns]+(s.frame?0:s.origin.x-w/2);n.y=ys[Math.floor(i/s.columns)]+(s.frame?0:s.origin.y-h/2);});
    figma.currentPage.selection=s.frame?[s.frame]:s.nodes;figma.viewport.scrollAndZoomIntoView(figma.currentPage.selection);data={count:s.nodes.length};
   }
  }else if(m.type==='export-selection'){
   const nodes=topSelection().filter(n=>n.visible!==false);if(!nodes.length)throw new Error('Select frames, layers, a group, or a slice on the canvas first.');
   const format=m.format;if(!['PNG','JPG','SVG','PDF'].includes(format))throw new Error('Unsupported export format.');
   const scale=Number(m.scale);if(![1,2,3,4].includes(scale))throw new Error('Choose 1×, 2×, 3× or 4× export scale.');
   const settings=['PNG','JPG'].includes(format)?{format,constraint:{type:'SCALE',value:scale}}:{format};
   const files=[],failures=[];
   if(m.combined){const bytes=await combinedExport(nodes,settings);files.push({name:'Selected area',nodeId:nodes.map(n=>n.id).join(','),format,bytes});}
   else {for(const n of nodes){try{if(typeof n.exportAsync!=='function')throw new Error('This node cannot be exported.');const bytes=await n.exportAsync(settings);files.push({name:n.name,nodeId:n.id,format,bytes});}catch(e){failures.push({nodeId:n.id,name:n.name,error:e.message});}}}
   data={files,failures,scale};
  }else throw new Error('Unsupported plugin operation.');
  figma.ui.postMessage({type:'result',id:m.id,ok:true,data});
 }catch(e){figma.ui.postMessage({type:'result',id:m.id,ok:false,error:e.message||String(e)});}
 finally{working=false;}
};
