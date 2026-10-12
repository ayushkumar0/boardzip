const {chromium}=require(process.env.BOARDZIP_PLAYWRIGHT || 'playwright');
const path=require('node:path');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const ext=path.resolve(__dirname,'../extension');
 const context=await chromium.launchPersistentContext(path.join(require('node:os').tmpdir(),'boardzip-chrome-test'),{headless:true,executablePath:process.env.BOARDZIP_CHROMIUM || chromium.executablePath(),args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`],acceptDownloads:true,viewport:{width:1100,height:1000}});
 try {
 await context.route('https://widgets.pinterest.com/**',r=>r.fulfill({status:404,body:'no public fixture'}));
 await context.route('https://www.pinterest.com/**',route=>{
  const section=route.request().url().includes('/section/');
  route.fulfill({contentType:'text/html',body:`<h1>Fixture Board</h1>${section?'':'<a href="/me/art/section/">Section</a>'}<div data-test-id="pin"><a href="/pin/${section?'222':'111'}/"><img alt="Fixture image" src="https://i.pinimg.com/236x/ab/cd/image.jpg"></a></div><h2>More like this</h2><a href="/pin/999/"><img src="https://i.pinimg.com/236x/ab/cd/image.jpg"></a>`});
 });
 const png=fs.readFileSync(path.resolve(__dirname,'fixture.png'));
 await context.route('https://i.pinimg.com/**',route=>(route.request().url().endsWith('.png')||route.request().url().includes('/236x/'))?route.fulfill({contentType:'image/png',body:png}):route.fulfill({status:404,body:'missing'}));
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).hostname;
 const panel=await context.newPage();const errors=[];panel.on('pageerror',e=>{errors.push(e.message);console.error('PANEL ERROR',e.message);});
 await panel.goto(`chrome-extension://${id}/panel.html`);
 // Extension-created tabs can begin navigation before Playwright attaches interception.
 // Delay only fixture navigation so no real Pinterest request escapes the test.
 await panel.evaluate(()=>{const create=chrome.tabs.create.bind(chrome.tabs);chrome.tabs.create=async options=>{const tab=await create({...options,url:'about:blank'});await new Promise(r=>setTimeout(r,400));await chrome.tabs.update(tab.id,{url:options.url});return tab;};});
 await panel.locator('#url').fill('https://www.pinterest.com/me/art/');
 const downloads=[];panel.on('download',d=>downloads.push(d));
 await panel.locator('#start').click();
 await panel.waitForFunction(()=>['Choose pins','Collection needs attention'].includes(document.getElementById('phase').textContent),{},{timeout:120000});
 assert.equal(await panel.locator('#phase').textContent(),'Choose pins',(await panel.locator('#status').textContent())+' '+(await panel.locator('#log').textContent()));
 assert.equal(await panel.locator('#picker input').count(),2);
 await panel.locator('#download').click();
 await panel.waitForFunction(()=>document.getElementById('phase').textContent==='Export prepared',{},{timeout:120000});
 assert.match(await panel.locator('#status').textContent(),/2 images packaged; 0 failed/);
 assert.equal(errors.length,0);
 // chrome.downloads API downloads are not necessarily dispatched as Playwright download events.
 const files=await panel.evaluate(async()=>{
  const results=[];for(const a of document.querySelectorAll('#files a'))results.push({name:a.download,data:Array.from(new Uint8Array(await (await fetch(a.href)).arrayBuffer()))});return results;
 });
 fs.mkdirSync(path.resolve(__dirname,'../test-output'),{recursive:true});
 for(const f of files)fs.writeFileSync(path.resolve(__dirname,'../test-output',f.name),Buffer.from(f.data));
 const report=JSON.parse(Buffer.from(files.find(f=>f.name.endsWith('.json')).data));
 assert.equal(report.saved,2);assert.equal(report.pages.length,2);assert.equal(report.pins.some(p=>p.id==='999'),false);assert(report.pins.every(p=>p.original&&p.width===64));
 await panel.screenshot({path:path.resolve(__dirname,'../test-output/panel.png'),fullPage:true});
 await panel.locator('#none').click();
 assert.equal(await panel.locator('#download').isDisabled(),true);
 await panel.locator('#picker input').nth(1).check();
 await panel.locator('#transfer').click();
 const transfer=await panel.evaluate(async()=>JSON.parse(await (await fetch([...document.querySelectorAll('#files a')].find(a=>a.download.endsWith('-to-figma.json')).href)).text()));
 assert.equal(transfer.kind,'boardzip/pinterest');assert.equal(transfer.pins.length,1);assert.equal(transfer.pins[0].id,'222');
 fs.writeFileSync(path.resolve(__dirname,'../test-output/pinterest-transfer.json'),JSON.stringify(transfer));
 await panel.locator('#figma-tab').click();
 await panel.locator('#figma-file').setInputFiles({name:'figma-transfer.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({kind:'boardzip/figma',version:1,files:[{name:'Figma.png',title:'Figma image',type:'image/png',base64:png.toString('base64')}]}))});
 await panel.waitForFunction(()=>document.getElementById('figma-picker').children.length===1);
 await panel.locator('#figma-text').fill(JSON.stringify({kind:'boardzip/figma',version:1,files:[{name:'Figma.png',title:'Pasted image',type:'image/png',base64:png.toString('base64')}]}));
 await panel.locator('#load-figma-text').click();assert.equal(await panel.locator('#figma-picker span').textContent(),'Pasted image');
 await context.route('https://www.pinterest.com/pin-creation-tool/',r=>r.fulfill({contentType:'text/html',body:'<h1>Create Pin</h1><input type="file" accept="image/*"><script>document.querySelector("input").onchange=e=>document.body.dataset.file=e.target.files[0].name;<\/script>'}));
 const tabPromise=context.waitForEvent('page');
 await panel.locator('#figma-picker button').click();const upload=await tabPromise;
 await panel.waitForFunction(()=>document.getElementById('phase').textContent==='Upload form prepared',{},{timeout:30000});
 assert.equal(await upload.locator('body').getAttribute('data-file'),'Figma.png');
 assert.equal(await upload.locator('input').evaluate(e=>e.files[0].size),png.length);
 console.log('Real Chromium extension fixture passed: extension loaded, board + section collected, recommendations excluded, PNG original fallback, ZIP and report generated, selected transfer, Figma image upload staging, no page errors.');
 }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
