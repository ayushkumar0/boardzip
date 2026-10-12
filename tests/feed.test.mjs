import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../extension/feed.js',import.meta.url),'utf8');
const pin=id=>({id:String(id),images:{'236x':{url:`https://i.pinimg.com/236x/ab/cd/${id}.jpg`},orig:{url:`https://i.pinimg.com/originals/ab/cd/${id}.png`}}});
function runtime(fetch){const c={URL,Map,Set,AbortController,setTimeout:f=>{queueMicrotask(f);return 1;},clearTimeout(){},fetch};vm.createContext(c);vm.runInContext(script,c);return c.BoardZipFeed;}
test('page-state membership recovers pins missing from rendered DOM without importing recommendation cache',()=>{
 const f=runtime();const state={initialReduxState:{boards:{42:{id:'42',url:'/me/art/',name:'Art',pin_count:45}},pins:{...Object.fromEntries(Array.from({length:25},(_,i)=>[i+1,pin(i+1)])),999:pin(999)},feeds:{'boardfeed:42':Array.from({length:25},(_,i)=>({id:String(i+1),type:'pin'}))},resources:{BoardFeedResource:{'[ ["board_id","42"] ]':{data:Array.from({length:25},(_,i)=>pin(i+1)),nextBookmark:'cursor-25'}}}}};
 const result=f.seed('https://www.pinterest.com/me/art/',{querySelectorAll:()=>[{textContent:JSON.stringify(state)}]});assert.equal(result.expected,45);assert.equal(result.pins.length,25);assert.equal(result.pins.some(p=>p.id==='999'),false);assert(result.pins[0].images[0].includes('/originals/'));
});
test('pagination collects 45 pins when only 13 were initially rendered',async()=>{
 let requests=0;const f=runtime(async()=>{requests++;const start=requests===1?14:30,end=requests===1?29:45;return {ok:true,json:async()=>({resource_response:{data:Array.from({length:end-start+1},(_,i)=>pin(start+i))},resource:{options:{bookmarks:[requests===1?'cursor-29':'-end-']}}})};});
 const initial=Array.from({length:13},(_,i)=>f.pinRecord(pin(i+1),'https://www.pinterest.com'));
 const result=await f.paginate({board:{id:'42'},feed:{resource:'BoardFeedResource',options:{board_id:'42'},bookmark:'cursor-13'},pins:initial,expected:45},'https://www.pinterest.com/me/art/',{cancelled:()=>false,progress(){}});
 assert.equal(result.pins.length,45);assert.equal(result.complete,true);assert.equal(requests,2);
});
test('end cursor below advertised count is incomplete and a repeated cursor cannot hang the scan',async()=>{
 let requests=0;const f=runtime(async()=>({ok:true,json:async()=>({resource_response:{data:[pin(++requests)]},resource:{options:{bookmarks:['same']}}})}));
 const info={board:{id:'42'},feed:{resource:'BoardFeedResource',options:{board_id:'42'},bookmark:'same'},pins:[],expected:45};const result=await f.paginate(info,'https://www.pinterest.com/me/art/',{cancelled:()=>false,progress(){}});assert.equal(result.complete,false);assert.match(result.reason,/repeated/);assert.equal(requests,1);
});
test('no fixed board size limit across many feed pages',async()=>{
 let page=0;const f=runtime(async()=>{const start=page++*100+1;return {ok:true,json:async()=>({resource_response:{data:Array.from({length:100},(_,i)=>pin(start+i))},resource:{options:{bookmarks:[page===12?'-end-':`page-${page}`]}}})};});
 const result=await f.paginate({board:{id:'42'},feed:{resource:'BoardFeedResource',options:{board_id:'42'}},pins:[],expected:1200},'https://www.pinterest.com/me/art/',{cancelled:()=>false,progress(){}});assert.equal(result.pins.length,1200);assert.equal(result.complete,true);assert.equal(page,12);
});
test('transient or blocked later pages preserve pins already collected',async()=>{
 let calls=0;const f=runtime(async()=>{if(++calls>1)throw new Error('HTTP 429');return {ok:true,json:async()=>({resource_response:{data:Array.from({length:25},(_,i)=>pin(i+1))},resource:{options:{bookmarks:['next']}}})};});
 const result=await f.paginate({board:{id:'42'},feed:{resource:'BoardFeedResource',options:{board_id:'42'}},pins:[],expected:45},'https://www.pinterest.com/me/art/',{cancelled:()=>false,progress(){}});assert.equal(result.pins.length,25);assert.equal(result.complete,false);assert.match(result.reason,/429/);
});
