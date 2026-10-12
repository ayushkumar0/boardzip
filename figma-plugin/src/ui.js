const $=id=>document.getElementById(id);let busy=false,stopped=false,requestId=0,exportTransfer='',selectedNodes=[];
const requests=new Map(),objectURLs=[];
const status=s=>$('status').textContent=s;
function send(type,data={}){const id=++requestId;return new Promise((resolve,reject)=>{requests.set(id,{resolve,reject});parent.postMessage({pluginMessage:{type,id,...data}},'*');});}
function lock(value){busy=value;for(const id of ['import','export','pinterest','copy-export','import-file','format','scale','combined','columns','width','gap'])$(id).disabled=value;$('cancel').disabled=!value;}
function toggle(exporting){$('import-view').hidden=exporting;$('export-view').hidden=!exporting;$('import-tab').classList.toggle('secondary',exporting);$('export-tab').classList.toggle('secondary',!exporting);}
$('import-tab').onclick=()=>toggle(false);$('export-tab').onclick=()=>toggle(true);
window.onmessage=e=>{
 if(e.source!==parent)return;const m=e.data.pluginMessage;if(!m)return;
 if(m.type==='selection'){selectedNodes=m.nodes;$('selection').textContent=m.nodes.length?`${m.nodes.length} selected: ${m.nodes.map(n=>n.name).join(', ')}`:'No selection — select something on the canvas';$('source').hidden=!(m.nodes.length===1&&/^https:\/\/(?:[a-z0-9-]+\.)?pinterest\.[^/]+\/pin\/\d+\/?$/.test(m.nodes[0].source));return;}
 if(m.type==='result'){const r=requests.get(m.id);if(!r)return;requests.delete(m.id);if(m.ok)r.resolve(m.data);else r.reject(new Error(m.error));}
};
$('source').onclick=()=>{try{const u=new URL(selectedNodes[0].source);if(/^([a-z0-9-]+\.)?pinterest\.(com|in|co\.uk|ca|de|fr|com\.au)$/.test(u.hostname)&&/^\/pin\/\d+\/?$/.test(u.pathname))window.open(u.href,'_blank','noopener');}catch{}};
$('import-file').onchange=async()=>{const file=$('import-file').files[0];if(!file)return;if(file.size>300*1024*1024){status('Transfer file is too large.');return;}$('transfer').value=await file.text();};
$('cancel').onclick=()=>{stopped=true;status('Stopping after the current image. Completed imports will remain on the canvas.');};
async function fetchPin(pin,strict){
 for(const url of pin.images){if(stopped)throw new Error('Stopped');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
  try{
   const r=await fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)continue;
   const finalURL=new URL(r.url);if(finalURL.hostname!=='i.pinimg.com'||finalURL.protocol!=='https:'||(strict&&!finalURL.pathname.startsWith('/originals/')))continue;
   const type=r.headers.get('content-type')?.split(';')[0];if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(type))continue;
   if(Number(r.headers.get('content-length'))>100*1024*1024){await r.body?.cancel();continue;}
   const reader=r.body.getReader(),chunks=[];let total=0;
   while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>100*1024*1024){await reader.cancel();throw new Error('Image exceeds 100 MB');}chunks.push(value);}
   const raw=new Blob(chunks,{type});if(!raw.size)continue;
   // Normalize formats Figma may not accept, while keeping original pixel dimensions.
   if(['image/webp','image/avif','image/gif'].includes(type)){
    const bitmap=await createImageBitmap(raw);const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!png)continue;return new Uint8Array(await png.arrayBuffer());
   }
   return new Uint8Array(await raw.arrayBuffer());
  }catch(e){if(stopped)throw e;}finally{clearTimeout(timer);}
 }
 throw new Error(strict?'Original unavailable; pin skipped':'No supported image available');
}
$('import').onclick=async()=>{
 if(busy)return;let transfer;try{transfer=parseTransfer($('transfer').value,'boardzip/pinterest');}catch(e){status(e.message);return;}
 lock(true);stopped=false;let started=false,count=0,failed=[];
 try{
  await send('import-begin',{title:transfer.title,columns:Number($('columns').value),width:Number($('width').value),gap:Number($('gap').value)});started=true;
  for(let i=0;i<transfer.pins.length&&!stopped;i++){
   const pin=transfer.pins[i];status(`Importing ${i+1} of ${transfer.pins.length}…`);
   try{const bytes=await fetchPin(pin,transfer.strict);if(stopped)break;await send('import-image',{bytes,pinId:pin.id,pinURL:pin.url,title:pin.title});count++;}
   catch(e){if(stopped)break;failed.push({id:pin.id,error:e.message});}
   $('progress').value=(i+1)/transfer.pins.length*100;
  }
  await send('import-finish');started=false;
  status(`${count} images imported. ${failed.length} failed.${stopped?' Import stopped early.':''}${failed.length?'\n'+failed.map(p=>`${p.id}: ${p.error}`).join('\n'):''}`);
 }catch(e){status(e.message);}finally{if(started)await send('import-finish').catch(()=>{});lock(false);}
};
function download(blob,name){const u=URL.createObjectURL(blob);objectURLs.push(u);const a=document.createElement('a');a.href=u;a.download=name;a.textContent=`Save ${name}`;a.className='save';$('files').append(a);a.click();}
function resetFiles(){$('files').replaceChildren();for(const u of objectURLs)URL.revokeObjectURL(u);objectURLs.length=0;$('copy-export').hidden=true;exportTransfer='';}
function base64(bytes){let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out);}
async function exportSelection(pinterest){
 if(busy)return;lock(true);resetFiles();$('progress').removeAttribute('value');status('Rendering selection with Figma’s export engine…');
 try{
  const format=pinterest?'PNG':$('format').value;const result=await send('export-selection',{format,scale:Number($('scale').value),combined:$('combined').checked});
  if(!result.files.length)throw new Error('No selected nodes could be exported. '+result.failures.map(f=>f.error).join('; '));
  const extension={PNG:'png',JPG:'jpg',SVG:'svg',PDF:'pdf'}[format],mime={PNG:'image/png',JPG:'image/jpeg',SVG:'image/svg+xml',PDF:'application/pdf'}[format];
  if(pinterest){
   const transfer={kind:'boardzip/figma',version:1,created:new Date().toISOString(),scale:result.scale,failures:result.failures,files:result.files.map((f,i)=>({name:`${String(i+1).padStart(3,'0')}-${safeName(f.name)}.${extension}`,title:f.name,nodeId:f.nodeId,type:mime,base64:base64(new Uint8Array(f.bytes))}))};
   exportTransfer=JSON.stringify(transfer);if(exportTransfer.length>300*1024*1024)throw new Error('Transfer exceeds 300 MB. Export fewer selections per transfer.');
   download(new Blob([exportTransfer],{type:'application/json'}),'Figma-to-Pinterest.boardzip.json');$('copy-export').hidden=false;
   status(`${transfer.files.length} PNG images prepared. Load the JSON in Chrome’s BoardZip → Figma → Pinterest.${result.failures.length?' Some nodes failed; see the transfer report.':''}`);
  }else{
   let zip=new Zip(),part=1,filesInPart=0;const report={created:new Date().toISOString(),format,scale:result.scale,combined:$('combined').checked,failures:result.failures,files:[]};
   const flush=()=>{zip.add('export-report.json',JSON.stringify(report,null,2));download(zip.blob(),`Figma-selection-part-${String(part).padStart(3,'0')}.zip`);zip=new Zip();part++;filesInPart=0;};
   result.files.forEach((f,i)=>{const bytes=new Uint8Array(f.bytes);if(zip.size+bytes.length>200*1024*1024&&filesInPart)flush();const name=`${String(i+1).padStart(3,'0')}-${safeName(f.name)}.${extension}`;zip.add(name,bytes);filesInPart++;report.files.push({name,nodeId:f.nodeId,bytes:bytes.length,part});});flush();
   status(`${result.files.length} exports packaged in ${part-1} ZIP archive(s). ${result.failures.length} nodes failed. Save links remain available below.`);
  }
  $('progress').value=100;
 }catch(e){status(e.message);$('progress').value=0;}finally{lock(false);}
}
$('export').onclick=()=>exportSelection(false);$('pinterest').onclick=()=>exportSelection(true);
$('copy-export').onclick=async()=>{if(!exportTransfer)return;try{await navigator.clipboard.writeText(exportTransfer);status('Pinterest transfer copied. You can also use the saved JSON file in Chrome.');}catch{const t=document.createElement('textarea');t.value=exportTransfer;document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();status(ok?'Pinterest transfer copied.':'Clipboard unavailable. Use the saved JSON transfer file.');}};
parent.postMessage({pluginMessage:{type:'ready'}},'*');
