const {chromium}=require(process.env.BOARDZIP_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const context=await chromium.launchPersistentContext(path.join(require('node:os').tmpdir(),'boardzip-figma-ui-test'),{headless:true,executablePath:process.env.BOARDZIP_CHROMIUM||chromium.executablePath(),acceptDownloads:true,viewport:{width:620,height:900}});
 try{
  const png=fs.readFileSync(path.resolve(__dirname,'fixture.png'));
  const ui=fs.readFileSync(path.resolve(__dirname,'../figma-plugin/ui.html'),'utf8');
  await context.route('https://i.pinimg.com/**',r=>r.request().url().endsWith('.png')?r.fulfill({contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'},body:png}):r.fulfill({status:404,headers:{'Access-Control-Allow-Origin':'*'},body:'missing'}));
  await context.route('https://boardzip.test/**',r=>{
   if(r.request().url().endsWith('/plugin'))return r.fulfill({contentType:'text/html',body:ui});
   r.fulfill({contentType:'text/html',body:`<style>body{margin:20px;background:#eee}iframe{width:470px;height:850px;border:0;border-radius:12px}</style><iframe src="/plugin"></iframe><script>
   window.imported=[];window.calls=[];window.onmessage=e=>{const m=e.data.pluginMessage;if(!m)return;calls.push(m);const frame=document.querySelector('iframe').contentWindow;
   if(m.type==='ready'){frame.postMessage({pluginMessage:{type:'selection',nodes:[{id:'1:1',name:'My frame',type:'FRAME',canExport:true,source:''}]}},'*');return;}
   let data;if(m.type==='import-begin')data={started:true};else if(m.type==='import-image'){imported.push(m);data={nodeId:'new',width:64,height:96};}else if(m.type==='import-finish')data={count:imported.length};else if(m.type==='export-selection')data={files:[{name:'My frame',nodeId:'1:1',format:m.format,bytes:new Uint8Array(${JSON.stringify([...png])})}],failures:[],scale:m.scale};
   frame.postMessage({pluginMessage:{type:'result',id:m.id,ok:true,data}},'*');};<\/script>`});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('https://boardzip.test/');const frame=page.frameLocator('iframe');
  const transfer=fs.readFileSync(path.resolve(__dirname,'../test-output/pinterest-transfer.json'),'utf8');
  await frame.locator('#transfer').fill(transfer);await frame.locator('#import').click();await frame.locator('#status').filter({hasText:'1 images imported. 0 failed.'}).waitFor();
  assert.equal(await page.evaluate(()=>imported.length),1);assert.equal(await page.evaluate(()=>imported[0].pinId),'222');
  await frame.locator('#export-tab').click();await frame.locator('#combined').check();
  const zipPromise=page.waitForEvent('download');await frame.locator('#export').click();const zip=await zipPromise;await zip.saveAs(path.resolve(__dirname,'../test-output/figma-selection.zip'));
  await frame.locator('#status').filter({hasText:'1 exports packaged'}).waitFor();
  const bridgePromise=page.waitForEvent('download');await frame.locator('#pinterest').click();const bridge=await bridgePromise;await bridge.saveAs(path.resolve(__dirname,'../test-output/figma-transfer.json'));
  const data=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../test-output/figma-transfer.json')));assert.equal(data.kind,'boardzip/figma');assert.equal(data.files.length,1);assert.equal(data.scale,2);assert.equal(Buffer.from(data.files[0].base64,'base64').equals(png),true);
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.type==='export-selection').every(c=>c.combined&&c.scale===2)),true);assert.equal(errors.length,0);
  await page.screenshot({path:path.resolve(__dirname,'../test-output/figma-plugin.png'),fullPage:true});
  console.log('Figma plugin UI browser harness passed: copied Pinterest transfer imported, image bytes sent to simulated canvas host, selection ZIP, combined-area settings, reverse PNG transfer, no JS errors. Native Figma host remains unverified.');
 }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
