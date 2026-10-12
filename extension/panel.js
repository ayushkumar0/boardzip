import {boardURL,safeName,candidates,Zip,pinterestTransfer,parseTransfer} from './core.js';
const $=id=>document.getElementById(id);
const params=new URL(location.href).searchParams;
if(params.get('mode')==='sidebar')document.body.classList.add('sidebar');
let busy=false,stopped=false,scanTab=null,abort=null;
let collection=null;
const selected=new Set(),links=[],figmaLinks=[];
const controls=['start','visible','url','sections','strict','download','copy','transfer','all','none','figma-file','load-figma-text'];
const log=s=>{$('log').textContent+=s+'\n';$('log').scrollTop=$('log').scrollHeight;};
const status=s=>{$('status').textContent=s;};
function lock(on){busy=on;for(const id of controls)$(id).disabled=on;$('stop').disabled=!on;if(!on)refreshSelection();}
function resetFiles(){$('files').replaceChildren();for(const u of links)URL.revokeObjectURL(u);links.length=0;}
function refreshSelection(){
 const n=selected.size;$('selection-count').textContent=`${n} / ${collection?.pins.length||0} selected`;
 for(const id of ['download','copy','transfer'])$(id).disabled=busy||!n;
}
function renderPins(){
 $('picker-section').hidden=false;$('picker').replaceChildren();selected.clear();
 const fragment=document.createDocumentFragment();
 for(const pin of collection.pins){
  selected.add(pin.id);const label=document.createElement('label');label.className='pin-card';
  const image=document.createElement('img');image.src=pin.images.find(u=>/^https:\/\/i\.pinimg\.com\//.test(u))||'';image.alt=pin.title||`Pin ${pin.id}`;image.loading='lazy';image.referrerPolicy='no-referrer';
  const check=document.createElement('input');check.type='checkbox';check.checked=true;check.dataset.id=pin.id;
  check.onchange=()=>{if(check.checked)selected.add(pin.id);else selected.delete(pin.id);refreshSelection();};
  const text=document.createElement('span');text.textContent=pin.title||`Pin ${pin.id}`;text.title=text.textContent;
  label.append(image,check,text);fragment.append(label);
 }
 $('picker').append(fragment);refreshSelection();
}
function picked(){return collection.pins.filter(p=>selected.has(p.id));}
for(const [id,on] of [['all',true],['none',false]])$(id).onclick=()=>{for(const c of $('picker').querySelectorAll('input')){c.checked=on;if(on)selected.add(c.dataset.id);else selected.delete(c.dataset.id);}refreshSelection();};
function view(figma){$('figma-view').hidden=!figma;$('pinterest-view').hidden=figma;for(const [id,active] of [['figma-tab',figma],['pinterest-tab',!figma]]){$(id).classList.toggle('secondary',!active);$(id).setAttribute('aria-pressed',String(active));}}
$('pinterest-tab').onclick=()=>view(false);$('figma-tab').onclick=()=>view(true);
chrome.runtime.onMessage.addListener((m,sender)=>{if(m.type==='boardzip-progress'&&sender.tab?.id===scanTab){$('count').textContent=`${m.count} pins on current page`;$('progress').removeAttribute('value');}});
let initialTab=Number(params.get('tab'));
const initialReady=(async()=>{
 if(!initialTab){const tab=(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0];if(tab)initialTab=tab.id;}
 if(initialTab)try{const t=await chrome.tabs.get(initialTab);$('url').value=boardURL(t.url);}catch{}
 if(params.get('restore')==='1'){
  const snapshot=await chrome.runtime.sendMessage({type:'boardzip-workspace-snapshot',tabId:initialTab}).catch(()=>null);
  if(snapshot?.collection){collection=snapshot.collection;$('url').value=collection.root;renderPins();selected.clear();for(const id of snapshot.selected)selected.add(id);for(const c of $('picker').querySelectorAll('input'))c.checked=selected.has(c.dataset.id);refreshSelection();$('phase').textContent='Choose pins';$('count').textContent=`${collection.pins.length} pins collected`;status('Selection copied from the side panel. Choose an export action.');}
 }
})();
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
 if(m.type==='boardzip-state'){respond({busy,sourceTab:initialTab,title:collection?.title,count:collection?.pins.length});return;}
 if(m.type==='boardzip-workspace-snapshot'&&collection&&Number(m.tabId)===initialTab){respond({collection,selected:[...selected]});return;}
 if(m.type==='boardzip-launch'&&Number(m.tabId)===initialTab){
  initialReady.then(()=>{respond({accepted:true});if(m.command==='figma'){view(true);return;}if(!busy){view(false);extract(m.command==='visible');}}).catch(e=>respond({accepted:false,error:e.message}));return true;
 }
});
$('expand').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL(`panel.html?mode=workspace&restore=1&tab=${initialTab||''}`)});
$('stop').onclick=()=>{stopped=true;abort?.abort();if(scanTab!==null)chrome.tabs.sendMessage(scanTab,{type:'boardzip-stop'}).catch(()=>{});$('stop').disabled=true;status('Stopping. Collected pins and completed images will remain available.');};
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
async function ready(id){const deadline=Date.now()+60000;while(Date.now()<deadline){if(stopped)return;const t=await chrome.tabs.get(id);if(t.status==='complete'){await new Promise(r=>setTimeout(r,2000));return;}await new Promise(r=>setTimeout(r,500));}throw new Error('Pinterest did not finish loading within 60 seconds.');}
async function publicBoard(root){
 const u=new URL(root),parts=u.pathname.split('/').filter(Boolean);if(parts.length!==2)return null;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch(`https://widgets.pinterest.com/v3/pidgets/boards/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/pins/`,{credentials:'omit',signal:controller.signal});
  if(!response.ok)return null;const payload=await response.json(),data=payload.data;if(!data?.board||!Array.isArray(data.pins))return null;
  const expected=Number(data.board.pin_count);if(!Number.isFinite(expected))return null;
  const pins=data.pins.map(p=>({id:String(p.id),url:`${u.origin}/pin/${p.id}/`,title:p.title||p.description||'',images:Object.values(p.images||{}).map(v=>v?.url).filter(v=>/^https:\/\/i\.pinimg\.com\//.test(v)),video:!!p.videos})).filter(p=>/^\d+$/.test(p.id)&&p.images.length);
  // Widgets may return only a sample on large boards. They are complete only when the count matches.
  const unique=[...new Map(pins.map(p=>[p.id,p])).values()];if(unique.length!==expected)return null;
  return {pins:unique,sections:[],title:data.board.name||'Pinterest-board',expected,settled:true,stopped:false,source:root,method:'public-board-data'};
 }catch{return null;}finally{clearTimeout(timer);}
}
async function collect(url,root){
 if(scanTab===null){const t=await chrome.tabs.create({url,active:false});scanTab=t.id;}else await chrome.tabs.update(scanTab,{url});
 await ready(scanTab);if(stopped)return null;
 const loaded=await chrome.tabs.get(scanTab);log(`Loaded scan URL: ${loaded.url || '(unavailable)'}`);if(boardURL(loaded.url)!==boardURL(url))throw new Error('Pinterest redirected away from the requested board or section. Check sign-in and access.');
 await chrome.scripting.executeScript({target:{tabId:scanTab},files:['feed.js','scanner.js']});
 const result=await chrome.tabs.sendMessage(scanTab,{type:'boardzip-scan',root});if(result.error)throw new Error(result.error);return result;
}
async function extract(visible=false){
 if(busy)return;let root;try{root=boardURL($('url').value);}catch(e){status(e.message);return;}
 lock(true);stopped=false;$('log').textContent='';$('phase').textContent=visible?'Collecting visible pins':'Extracting board';$('progress').removeAttribute('value');
 const pins=new Map(),pages=[],errors=[];let title='Pinterest-board';
 const merge=r=>{title=pages.length?title:r.title;pages.push({url:r.source,pins:r.pins.length,settled:r.settled,stopped:r.stopped,expected:r.expected??null,method:r.method,warning:r.warning,visibleOnly:!!r.visibleOnly});for(const p of r.pins){const old=pins.get(p.id);pins.set(p.id,{...p,images:[...new Set([...(old?.images||[]),...p.images])]});}};
 try{
  let first;
  if(visible){
   if(!initialTab)throw new Error('Open this extension by clicking its icon on a Pinterest board.');
   const tab=await chrome.tabs.get(initialTab);if(boardURL(tab.url)!==root)throw new Error('Visible collection uses the Pinterest tab you opened this extension from. Return to that board and reopen BoardZip.');
   await chrome.scripting.executeScript({target:{tabId:initialTab},files:['feed.js','scanner.js']});
   first=await chrome.tabs.sendMessage(initialTab,{type:'boardzip-visible',root});if(first.error)throw new Error(first.error);
  }else {status('Scrolling a separate Pinterest tab. Keep this export page open.');first=await publicBoard(root);if(!first&&!stopped)first=await collect(root,root);}
  if(first){merge(first);log(`Collected ${first.pins.length} pins; ${first.sections.length} sections discovered.`);}
  if(first&&!visible&&$('sections').checked){for(const section of first.sections){if(stopped)break;status(`Extracting section ${section}`);try{const r=await collect(section,root);if(r)merge(r);}catch(e){errors.push({url:section,error:e.message});log(`Section failed: ${e.message}`);}}}
  if(!pins.size)throw new Error('No pin images found. Check board access, sign-in, and whether Pinterest changed its layout.');
  collection={root,title,pins:[...pins.values()],pages,errors,partial:stopped||pages.some(p=>!p.settled),visible};renderPins();
  $('phase').textContent='Choose pins';$('count').textContent=`${pins.size} pins collected`;$('progress').value=100;
  status(`${pins.size}${first?.expected!=null?' / '+first.expected:''} pins ready. Uncheck anything you do not want, then download a ZIP or copy to Figma. ${collection.partial?'This is a partial or visible-only collection. ':''}${first?.expected!=null&&first.settled?'Collected count matches Pinterest’s advertised count.':'Board completeness is not independently verified.'}`);
 }catch(e){$('phase').textContent='Collection needs attention';status(e.message);log(e.message);}
 finally{if(scanTab!==null){await chrome.tabs.remove(scanTab).catch(()=>{});scanTab=null;}lock(false);}
}
$('start').onclick=()=>extract(false);$('visible').onclick=()=>extract(true);
async function getImage(pin,strict) {
  const urls=candidates(pin.images).filter(u=>!strict||u.includes('/originals/'));
  for(const url of urls) {
    if(stopped) throw new Error('Stopped');
    abort=new AbortController(); const timer=setTimeout(()=>abort.abort(),18000);
    try {
      const r=await fetch(url,{signal:abort.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if(!r.ok) continue;
      if(new URL(r.url).hostname!=='i.pinimg.com') continue;
      const type=r.headers.get('content-type')?.split(';')[0].toLowerCase();
      const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif'}[type];
      if(!ext) continue;
      if(strict&&!new URL(r.url).pathname.startsWith('/originals/')) continue;
      const limit=Infinity;
      if(Number(r.headers.get('content-length'))>limit) {await r.body?.cancel();continue;}
      const reader=r.body.getReader(), chunks=[];let total=0;
      while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();throw new Error('Image exceeds 100 MB safety limit');}chunks.push(value);}
      const raw=new Blob(chunks,{type}); if(!raw.size) continue;
      let width=null,height=null;
      try {const bitmap=await createImageBitmap(raw); width=bitmap.width;height=bitmap.height;bitmap.close();}catch{continue;}
      if(!width || !height) continue;
      return {data:new Uint8Array(await raw.arrayBuffer()),ext,url:r.url,width,height,original:new URL(r.url).pathname.startsWith('/originals/')};
    }catch(e){if(stopped)throw e;}finally{clearTimeout(timer);abort=null;}
  }
  throw new Error(strict?'Original image unavailable or blocked':'No supported image could be downloaded');
}
function showFile(blob,name) {
  const url=URL.createObjectURL(blob); links.push(url);
  const a=document.createElement('a');a.href=url;a.download=name;a.className='file';a.textContent=`Save ${name}`;$('files').append(a);
  return {url,name};
}
async function saveFile(blob,name) {
  const f=showFile(blob,name);
  try {
    const id=await chrome.downloads.download({url:f.url,filename:f.name,saveAs:false});
    log(`Archive handed to Chrome: ${name} (download ${id}). Confirm completion in Chrome Downloads.`);
  }catch(e){log(`Automatic save unavailable: ${e.message}. Use the Save link.`);}
}
$('download').onclick=async()=>{
 if(busy||!selected.size)return;lock(true);stopped=false;resetFiles();
 const pins=picked();let completed=0,failed=0,part=1,zip=new Zip(),partImages=0;
 const report={board:collection.root,title:collection.title,started:new Date().toISOString(),mode:$('strict').checked?'originals-only':'originals-with-preview-fallback',media:'Images; video covers only',collection:'Board-data/pagination with DOM fallback; compare advertised count',pages:collection.pages,collectionErrors:collection.errors,collectionPartial:collection.partial,discovered:collection.pins.length,selected:pins.length,pins:[]};
 const flush=async(final=false)=>{if(!partImages&&!final)return;zip.add('export-report.json',JSON.stringify({...report,part,stopped,finished:new Date().toISOString()},null,2));await saveFile(zip.blob(),`${safeName(collection.title)}-part-${String(part).padStart(3,'0')}.zip`);zip=new Zip();partImages=0;part++;};
 try{
  $('phase').textContent='Downloading selected images';let processed=0;
  for(const pin of pins){if(stopped)break;status(`Fetching ${processed+1} of ${pins.length}. ${completed} saved, ${failed} failed.`);
   try{const img=await getImage(pin,$('strict').checked);if((zip.size+img.data.length>200*1024*1024||zip.entries.length>=60000)&&partImages)await flush();const filename=`images/${pin.id}-${safeName(pin.title).slice(0,60)}.${img.ext}`;zip.add(filename,img.data);partImages++;completed++;report.pins.push({id:pin.id,pinURL:pin.url,title:pin.title,status:'saved',file:filename,part,imageURL:img.url,width:img.width,height:img.height,bytes:img.data.length,original:img.original,videoCover:pin.video});}
   catch(e){if(stopped)break;failed++;report.pins.push({id:pin.id,pinURL:pin.url,title:pin.title,status:'failed',reason:e.message});log(`Pin ${pin.id}: ${e.message}`);}
   processed++;$('progress').value=processed/pins.length*100;$('count').textContent=`${completed} saved · ${failed} failed`;
  }
  const done=new Set(report.pins.map(p=>p.id));report.unprocessed=pins.filter(p=>!done.has(p.id)).map(p=>p.id);report.saved=completed;report.failed=failed;
  await flush(true);await saveFile(new Blob([JSON.stringify({...report,stopped,finished:new Date().toISOString()},null,2)],{type:'application/json'}),`${safeName(collection.title)}-complete-report.json`);
  $('phase').textContent=stopped?'Partial export prepared':'Export prepared';status(`${completed} images packaged; ${failed} failed; ${report.unprocessed.length} unprocessed. Check Chrome Downloads for completed saves.`);
 }catch(e){$('phase').textContent='Export needs attention';status(e.message);log(e.message);}finally{abort=null;lock(false);}
};
function transferText(){return JSON.stringify(pinterestTransfer(picked(),{board:collection.root,title:collection.title,strict:$('strict').checked}));}
$('copy').onclick=async()=>{try{const text=transferText();await navigator.clipboard.writeText(text);status(`${selected.size} pins copied. In Figma, run BoardZip and paste into the import field.`);}catch(e){$('clipboard-fallback').hidden=false;$('clipboard-fallback').value=transferText();$('clipboard-fallback').select();status('Clipboard access unavailable. Copy the selected text manually, or save a Figma transfer file.');}};
$('transfer').onclick=async()=>{try{await saveFile(new Blob([transferText()],{type:'application/json'}),`${safeName(collection.title)}-to-figma.json`);status('Transfer file prepared. Load it in the BoardZip Figma plugin.');}catch(e){status(e.message);}};
function bytesFromBase64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
$('figma-file').onchange=async()=>{
 if(busy)return;const file=$('figma-file').files[0];if(!file)return;
 try{
  if(file.size>300*1024*1024)throw new Error('Transfer files must be below 300 MB.');
  loadFigmaTransfer(await file.text());
 }catch(e){status(e.message);}
};
$('load-figma-text').onclick=()=>{try{loadFigmaTransfer($('figma-text').value);}catch(e){status(e.message);}};
function loadFigmaTransfer(text){
 const transfer=parseTransfer(text,'boardzip/figma');$('figma-picker').replaceChildren();for(const u of figmaLinks)URL.revokeObjectURL(u);figmaLinks.length=0;
  for(const f of transfer.files){
   const data=bytesFromBase64(f.base64);const sig=f.type==='image/png'?[137,80,78,71,13,10,26,10]:[255,216,255];
   if(!sig.every((b,i)=>data[i]===b))throw new Error('The file is not valid PNG/JPEG data.');
   const blob=new Blob([data],{type:f.type});const objectURL=URL.createObjectURL(blob);figmaLinks.push(objectURL);
   const card=document.createElement('div');card.className='pin-card';const img=document.createElement('img');img.src=objectURL;img.alt=f.title;
   const name=document.createElement('span');name.textContent=f.title;const prepare=document.createElement('button');prepare.textContent='Prepare Pinterest upload';
   prepare.onclick=()=>preparePinterest(f,prepare);const download=document.createElement('a');download.href=objectURL;download.download=f.name;download.textContent='Download image';
   card.append(img,name,prepare,download);$('figma-picker').append(card);
  }
  status(`${transfer.files.length} Figma images loaded. Prepare each in Pinterest, then choose its destination board and publish.`);
}
async function preparePinterest(file,button){
 if(busy)return;lock(true);stopped=false;button.disabled=true;
 try{
  const tab=await chrome.tabs.create({url:'https://www.pinterest.com/pin-creation-tool/',active:true});await ready(tab.id);if(stopped)throw new Error('Stopped before preparing upload.');
  const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:async f=>{
   if(location.hostname!=='www.pinterest.com'||!location.pathname.startsWith('/pin-creation-tool'))throw new Error('Pinterest redirected away from Create Pin. Sign in and use the Download image link to upload manually.');
   let input;const until=Date.now()+20000;
   while(Date.now()<until){input=[...document.querySelectorAll('input[type="file"]')].find(e=>!e.accept||/image|png|jpeg|jpg/i.test(e.accept));if(input)break;await new Promise(r=>setTimeout(r,500));}
   if(!input)throw new Error('Upload field not found. Use Download image and upload it through Pinterest manually.');
   const bytes=Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],f.name,{type:f.type}));input.files=dt.files;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
   return {provided:input.files.length===1};
  },args:[file]});
  if(!result?.result?.provided)throw new Error('Upload input did not accept the image. Use Download image and upload manually.');
  $('phase').textContent='Upload form prepared';status('Image provided to Pinterest’s upload form. Verify the preview, add a title, select the board, and publish in Pinterest.');
 }catch(e){status(e.message);log(e.message);}finally{button.disabled=false;lock(false);}
}
