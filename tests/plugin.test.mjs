import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../figma-plugin/code.js',import.meta.url),'utf8');
function host(){
 let seq=0,failExport=false;const messages=[],created=[];
 const page={id:'page',children:[],selection:[],appendChild(n){if(n.parent?.children)n.parent.children=n.parent.children.filter(x=>x!==n);this.children.push(n);n.parent=this;}};
 function node(type){const n={id:String(++seq),type,name:type,width:100,height:200,x:0,y:0,visible:true,removed:false,parent:null,children:[],data:{},resize(w,h){this.width=w;this.height=h;},appendChild:page.appendChild,remove(){this.removed=true;this.parent.children=this.parent.children.filter(x=>x!==this);},setPluginData(k,v){this.data[k]=v;},getPluginData(k){return this.data[k]||'';},clone(){const c=node(this.type);c.absoluteTransform=this.absoluteTransform.map(r=>[...r]);c.absoluteBoundingBox={...this.absoluteBoundingBox};return c;},async exportAsync(settings){if(failExport&&this.name==='BoardZip temporary export')throw new Error('Native export failed');this.lastSettings=settings;return new Uint8Array([137,80,78,71]);},absoluteTransform:[[1,0,10],[0,1,20]],absoluteBoundingBox:{x:10,y:20,width:100,height:200}};created.push(n);page.appendChild(n);return n;}
 const figma={editorType:'figma',showUI(){},on(){},currentPage:page,viewport:{center:{x:400,y:300},scrollAndZoomIntoView(){}},createFrame:()=>node('FRAME'),createRectangle:()=>node('RECTANGLE'),createImage:()=>({hash:'fixture-image',getSizeAsync:async()=>({width:100,height:200})}),ui:{postMessage:m=>messages.push(m)}};
 const context={figma,__html__:'',Uint8Array,console};vm.createContext(context);vm.runInContext(code,context);
 return {figma,page,created,node,messages,fail(){failExport=true;},async request(type,data={}){const id=++seq;await figma.ui.onmessage({type,id,...data});return messages.find(m=>m.type==='result'&&m.id===id);}};
}
test('plugin imports separate image layers with source metadata and a correctly sized grid',async()=>{
 const h=host();assert((await h.request('import-begin',{title:'My board',columns:2,width:360,gap:24})).ok);
 for(const id of ['111','222'])assert((await h.request('import-image',{bytes:[137,80,78,71],title:id,pinId:id,pinURL:`https://www.pinterest.com/pin/${id}/`})).ok);
 const result=await h.request('import-finish');assert.equal(result.data.count,2);const frame=h.page.selection[0];assert.equal(frame.width,744);assert.equal(frame.height,720);assert.equal(frame.children[1].x,384);assert.equal(frame.children[0].data['boardzip-source'],'https://www.pinterest.com/pin/111/');
});
test('empty failed import removes only the new empty frame',async()=>{
 const h=host(),original=h.node('RECTANGLE');await h.request('import-begin',{columns:2,width:300,gap:20});await h.request('import-finish');assert.equal(original.removed,false);assert.equal(h.page.children.length,1);
});
test('export respects PNG scale and drops selected descendants to avoid duplicate exports',async()=>{
 const h=host(),parent=h.node('FRAME'),child=h.node('RECTANGLE');parent.appendChild(child);h.page.selection=[parent,child];const result=await h.request('export-selection',{format:'PNG',scale:3,combined:false});assert(result.ok);assert.equal(result.data.files.length,1);assert.equal(parent.lastSettings.constraint.value,3);assert.equal(child.lastSettings,undefined);
});
test('combined area preserves absolute placement, original layers, and selection; removes temp nodes on failure',async()=>{
 const h=host(),a=h.node('RECTANGLE'),b=h.node('RECTANGLE');b.absoluteTransform=[[0,-1,210],[1,0,220]];b.absoluteBoundingBox={x:10,y:220,width:200,height:100};h.page.selection=[a,b];
 const result=await h.request('export-selection',{format:'PNG',scale:2,combined:true});assert(result.ok);const temp=h.created.find(n=>n.name==='BoardZip temporary export');assert.equal(temp.removed,true);assert.equal(temp.width,200);assert.equal(temp.height,300);assert.deepEqual(JSON.parse(JSON.stringify(temp.children[1].relativeTransform)),[[0,-1,200],[1,0,200]]);assert.equal(a.removed,false);assert.equal(a.parent,h.page);assert.equal(h.page.selection[0],a);
 h.fail();const fail=await h.request('export-selection',{format:'PNG',scale:2,combined:true});assert.equal(fail.ok,false);assert.match(fail.error,/Native export failed/);assert.equal(h.page.children.filter(n=>n.name==='BoardZip temporary export').length,0);assert.equal(h.page.selection[1],b);
});
test('selection export rejects invalid settings and gives a clear FigJam combined-area boundary',async()=>{
 const h=host();h.page.selection=[h.node('RECTANGLE')];assert.equal((await h.request('export-selection',{format:'EXE',scale:1})).ok,false);assert.equal((await h.request('export-selection',{format:'PNG',scale:200})).ok,false);h.figma.editorType='figjam';const result=await h.request('export-selection',{format:'PNG',scale:1,combined:true});assert.equal(result.ok,false);assert.match(result.error,/Figma Design/);
});
