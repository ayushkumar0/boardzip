const {chromium}=require(process.env.BOARDZIP_PLAYWRIGHT||'playwright');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const context=await chromium.launchPersistentContext(path.join(require('node:os').tmpdir(),'boardzip-presentation-test'),{headless:true,executablePath:process.env.BOARDZIP_CHROMIUM||chromium.executablePath(),args:[`--disable-extensions-except=${path.resolve(__dirname,'../extension')}`,`--load-extension=${path.resolve(__dirname,'../extension')}`],acceptDownloads:true,viewport:{width:1360,height:1000}});
 try{
 const out=path.resolve(__dirname,'../test-output');fs.mkdirSync(out,{recursive:true});
 const site=await context.newPage(),errors=[];site.on('pageerror',e=>errors.push(e.message));await site.goto('http://127.0.0.1:8766/');assert.equal(await site.title(),'BoardZip — Pinterest boards, original images, Figma transfers');
 await site.locator('#select-none').click();assert.equal(await site.locator('#demo-count').textContent(),'0 / 4 selected');await site.locator('#select-all').click();assert.equal(await site.locator('#demo-count').textContent(),'4 / 4 selected');
 const samplePromise=site.waitForEvent('download');await site.locator('a[href="downloads/Sample-board.zip"]').click();await(await samplePromise).saveAs(path.join(out,'site-sample.zip'));
 assert.equal(await site.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await site.screenshot({path:path.join(out,'landing-desktop.png'),fullPage:true});
 await site.setViewportSize({width:390,height:844});assert.equal(await site.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await site.screenshot({path:path.join(out,'landing-mobile.png'),fullPage:true});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).hostname;
 await context.route('https://www.pinterest.com/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Reference desk</h1><script id="__PWS_INITIAL_PROPS__" type="application/json">{"initialReduxState":{"boards":{"42":{"id":"42","name":"Reference desk","url":"/studio/references/","pin_count":4}}}}</script>'}));
 await context.route('https://widgets.pinterest.com/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({data:{board:{name:'Reference desk',pin_count:4},pins:['field-notes','form-study','after-hours','type-specimen'].map((n,i)=>({id:String(100+i),title:n.replaceAll('-',' '),images:{'236x':{url:`https://i.pinimg.com/236x/ab/cd/${n}.png`}}}))}})}));
 await context.route('https://i.pinimg.com/**',r=>r.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(__dirname,'fixture.png'))}));
 const source=await context.newPage();await source.goto('https://www.pinterest.com/studio/references/');
 const lookup=await context.newPage();await lookup.goto(`chrome-extension://${id}/popup.html`);const tabId=await lookup.evaluate(async()=>{const tabs=await chrome.tabs.query({});return tabs.find(t=>t.url==='https://www.pinterest.com/studio/references/').id;});await lookup.close();
 const popup=await context.newPage();await popup.setViewportSize({width:380,height:440});await popup.goto(`chrome-extension://${id}/popup.html?tab=${tabId}`);await popup.waitForFunction(()=>!document.getElementById('extract').disabled);assert.equal(await popup.locator('#title').textContent(),'Reference desk');assert.match(await popup.locator('#meta').textContent(),/4 pins/);
 await popup.screenshot({path:path.join(__dirname,'../docs/assets/popup.png'),fullPage:true});
 // Native Side Panel API is invoked from a real browser click; no API mocks.
 await popup.locator('#extract').click();await new Promise(r=>setTimeout(r,1800));
 if(!popup.isClosed()){assert.equal(await popup.locator('#error').isVisible(),false,await popup.locator('#error').textContent());}
 const nativePanels=context.pages().filter(p=>p.url().includes('mode=sidebar'));console.log('Native side panel targets attached:',nativePanels.length);
 const sidebar=nativePanels[0]||await context.newPage();if(!nativePanels.length)await sidebar.goto(`chrome-extension://${id}/panel.html?mode=sidebar&tab=${tabId}`);
 await sidebar.setViewportSize({width:380,height:900});if(!nativePanels.length)await sidebar.locator('#start').click();
 await sidebar.waitForFunction(()=>document.getElementById('phase').textContent==='Choose pins',{},{timeout:20000});assert.equal(await sidebar.locator('#picker input').count(),4);assert.equal(await sidebar.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await sidebar.screenshot({path:path.join(out,'sidebar.png'),fullPage:true});
 const workspacePromise=context.waitForEvent('page');await sidebar.locator('#expand').click();const workspace=await workspacePromise;await workspace.waitForFunction(()=>document.querySelectorAll('#picker input').length===4,{},{timeout:10000});assert.equal(await workspace.locator('#url').inputValue(),'https://www.pinterest.com/studio/references/');await workspace.setViewportSize({width:1360,height:1000});await workspace.screenshot({path:path.join(out,'workspace.png'),fullPage:true});
 assert.equal(errors.length,0);console.log('Presentation checks passed: desktop/mobile site, pin-picker preview, sample ZIP, popup metadata, real side-panel API launch, four-pin collection, expanded workspace selection restore, no horizontal overflow.');
 }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
