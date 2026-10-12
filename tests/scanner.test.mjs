import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../extension/scanner.js',import.meta.url),'utf8');
function fixture() {
 let listener,pass=0,y=0;
 const img={currentSrc:'https://i.pinimg.com/236x/ab/cd/a.jpg',src:'https://i.pinimg.com/236x/ab/cd/a.jpg',srcset:'https://i.pinimg.com/736x/ab/cd/a.jpg 736w',alt:'Picture'};
 const anchor=(href,recommended=false)=>({href,closest:s=>s.includes('related')?(recommended?{}:null):null,querySelectorAll:()=>[img],querySelector:()=>null,getBoundingClientRect:()=>({top:0})});
 const anchors=[anchor('https://www.pinterest.com/me/art/section/'),anchor('https://www.pinterest.com/pin/111/'),anchor('https://www.pinterest.com/pin/999/',true)];
 const context={URL,Map,Set,innerHeight:800,location:{href:'https://www.pinterest.com/me/art/',origin:'https://www.pinterest.com'},chrome:{runtime:{onMessage:{addListener:f=>listener=f},sendMessage:async()=>{}}},setTimeout:f=>{pass++;f();},document:{scrollingElement:{scrollTop:0,scrollHeight:800},title:'Art',querySelector:()=>({textContent:'Art'}),querySelectorAll:s=>s==='a[href]'?anchors:[]},window:{scrollTo:(_,n)=>y=n,scrollBy:()=>{}},get scrollY(){return y;}};
 vm.createContext(context);vm.runInContext(code,context);
 return {context,request:m=>new Promise(r=>listener(m,{},r))};
}
test('collects pin ids, deduplicates candidates, discovers sections, excludes recommendation cards',async()=>{
 const f=fixture();const result=await f.request({type:'boardzip-scan',root:'https://www.pinterest.com/me/art/'});
 assert.equal(result.pins.length,1);assert.equal(result.pins[0].id,'111');assert.equal(result.pins[0].images.length,2);assert.equal(result.sections.length,1);assert.equal(result.settled,true);
});
test('stop returns collected data and marks partial scan',async()=>{
 const f=fixture();const pending=f.request({type:'boardzip-scan',root:'https://www.pinterest.com/me/art/'});
 await f.request({type:'boardzip-stop'});const result=await pending;assert.equal(result.stopped,true);assert.equal(result.settled,false);
});
test('visible mode does not scroll or include sections',async()=>{
 const f=fixture();f.context.window.scrollTo=()=>{throw new Error('Visible collection must not scroll');};
 const result=await f.request({type:'boardzip-visible',root:'https://www.pinterest.com/me/art/'});assert.equal(result.pins.length,1);assert.equal(result.visibleOnly,true);assert.equal(result.sections.length,0);
});
test('inline ideas heading does not terminate a 45-pin virtualized board after 13 cards',async()=>{
 const f=fixture();let offset=1;const img={currentSrc:'https://i.pinimg.com/236x/ab/cd/a.jpg',src:'https://i.pinimg.com/236x/ab/cd/a.jpg',alt:'Pin',srcset:''};
 const anchor=id=>({href:`https://www.pinterest.com/pin/${id}/`,closest:()=>null,querySelectorAll:()=>[img],querySelector:()=>null,getBoundingClientRect:()=>({top:100,bottom:200})});
 f.context.BoardZipFeed={seed:()=>({pins:[],sections:[],expected:45,title:'45-pin board'}),paginate:async()=>({pins:[],complete:false,reason:'Fixture API unavailable'})};
 f.context.document.querySelectorAll=s=>s==='a[href]'?Array.from({length:Math.min(13,46-offset)},(_,i)=>anchor(offset+i)):[{textContent:'More ideas',getBoundingClientRect:()=>({top:50})}];
 f.context.document.scrollingElement={scrollTop:0,scrollHeight:100000};f.context.window.scrollBy=()=>{offset=Math.min(40,offset+10);};
 const result=await f.request({type:'boardzip-scan',root:'https://www.pinterest.com/me/art/'});assert.equal(result.pins.length,45);assert.equal(result.expected,45);assert.equal(result.settled,true);
});
