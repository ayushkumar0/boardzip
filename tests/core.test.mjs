import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {boardURL,candidates,safeName,Zip,crc32} from '../extension/core.js';
test('board URLs reject unrelated hosts and non-board pages',()=>{
 assert.equal(boardURL('https://www.pinterest.com/person/art/?x=1'),'https://www.pinterest.com/person/art/');
 assert.equal(boardURL('https://in.pinterest.com/person/art/section/').includes('section'),true);
 for(const u of ['https://evil.com/person/art','https://pinterest.com.evil.com/person/art','https://www.pinterest.com/pin/123/','https://www.pinterest.com/person/','http://www.pinterest.com/person/art']) assert.throws(()=>boardURL(u));
});
test('original URL candidates precede previews and never fetch arbitrary hosts',()=>{
 const urls=candidates(['https://i.pinimg.com/236x/ab/cd/hash.jpg','https://i.pinimg.com/1200x/ab/cd/hash.jpg','https://evil.com/originals/file.jpg']);
 assert.equal(urls[0],'https://i.pinimg.com/originals/ab/cd/hash.jpg');
 assert(urls.indexOf('https://i.pinimg.com/1200x/ab/cd/hash.jpg')<urls.indexOf('https://i.pinimg.com/236x/ab/cd/hash.jpg'));
 assert(urls.includes('https://i.pinimg.com/originals/ab/cd/hash.png'));
 assert(urls.every(u=>new URL(u).hostname==='i.pinimg.com'));
 assert.equal(urls.length,new Set(urls).size);
});
test('safe filenames and standard CRC',()=>{
 assert(!/[<>:"/\\|?*]/.test(safeName('x/y:foo?')));
 assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
});
test('write independent ZIP roundtrip fixture with Unicode and binary data',async()=>{
 const zip=new Zip();zip.add('images/हिंदी.png',new Uint8Array([0,1,2,255]));zip.add('report.json','{"saved":1}');
 writeFileSync(join(tmpdir(),'boardzip-test.zip'),new Uint8Array(await zip.blob().arrayBuffer()));
});
const {pinterestTransfer,parseTransfer}=await import('../extension/core.js');
test('Pinterest transfer is selected-only, validates version, and restricts CDN fetches',()=>{
 const t=pinterestTransfer([{id:'111',title:'Test',url:'https://www.pinterest.com/pin/111/',images:['https://i.pinimg.com/236x/ab/cd/hash.jpg','https://evil.com/a.jpg']}],{strict:true});
 const p=parseTransfer(JSON.stringify(t),'boardzip/pinterest');assert.equal(p.pins.length,1);assert(p.pins[0].images.every(u=>u.startsWith('https://i.pinimg.com/originals/')));
 assert.throws(()=>parseTransfer(JSON.stringify({...t,version:999}),'boardzip/pinterest'));
 assert.throws(()=>pinterestTransfer([]));
});
test('Figma transfer rejects unsafe types and malformed image payloads',()=>{
 const t={kind:'boardzip/figma',version:1,files:[{name:'My:Frame.png',type:'image/png',base64:'iVBORw=='}]};
 assert.equal(parseTransfer(JSON.stringify(t),'boardzip/figma').files[0].name,'My-Frame.png');
 assert.throws(()=>parseTransfer(JSON.stringify({...t,files:[{...t.files[0],type:'text/html'}]}),'boardzip/figma'));
 assert.throws(()=>parseTransfer(JSON.stringify({...t,files:[{...t.files[0],base64:'<script>'}]}),'boardzip/figma'));
});
