import {boardURL} from './core.js';
const $=id=>document.getElementById(id);let sourceTab=null,panelReady=false,running=false;
const error=message=>{$('error').hidden=false;$('error').textContent=message;};
async function init(){
 try{
  const requested=Number(new URL(location.href).searchParams.get('tab'));
  sourceTab=requested?await chrome.tabs.get(requested):(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0];
  const state=await chrome.runtime.sendMessage({type:'boardzip-state'}).catch(()=>null);running=!!state?.busy;
  if(!running)await chrome.sidePanel.setOptions({path:`panel.html?mode=sidebar&tab=${sourceTab.id}`,enabled:true});
  panelReady=true;
  let url;try{url=boardURL(sourceTab.url);}catch{$('message').textContent='Open a board or section on Pinterest. You can also paste its URL in the workspace.';return;}
  $('title').textContent=decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean)[1]).replaceAll('-',' ');
  $('extract').disabled=false;$('visible').disabled=running;
  if(running){$('extract').textContent='Return to running export →';$('message').textContent='An export is running in the side panel. Keep that panel open.';return;}
  try{
   const [result]=await chrome.scripting.executeScript({target:{tabId:sourceTab.id},func:()=>{
    const path=location.pathname.split('/').filter(Boolean);let board;
    for(const s of document.querySelectorAll('script#__PWS_INITIAL_PROPS__,script#__PWS_DATA__')){try{const j=JSON.parse(s.textContent),r=j.initialReduxState||j.props?.initialReduxState;board=Object.values(r?.boards||{}).find(b=>b.url?.replace(/\/$/,'')===`/${path[0]}/${path[1]}`);if(board)break;}catch{}}
    return {title:board?.name||document.querySelector('h1')?.textContent||document.title,count:board?.pin_count};
   }});
   if(result.result?.title)$('title').textContent=result.result.title;
   $('meta').textContent=result.result?.count!=null?`${result.result.count} pins · original resolution`:'Board ready · original resolution';
  }catch{}
  $('message').textContent='Extract the board, choose your pins, then download a ZIP or copy to Figma. Everything runs in your browser.';
 }catch(e){error(e.message);}
}
function openPanel(command){
 if(!panelReady||!sourceTab){error('Open the workspace to start.');return;}
 // Keep this call directly inside the click handler: Chrome requires a user gesture.
 chrome.sidePanel.open({windowId:sourceTab.windowId}).then(async()=>{
  if(running){window.close();return;}
  for(let attempt=0;attempt<12;attempt++){
   const response=await chrome.runtime.sendMessage({type:'boardzip-launch',command,tabId:sourceTab.id}).catch(()=>null);
   if(response?.accepted){window.close();return;}
   await new Promise(r=>setTimeout(r,150));
  }
  error('Panel opened. Use its Extract board button to begin.');
 }).catch(e=>error(`Could not open the side panel: ${e.message}. Use Open workspace.`));
}
$('extract').onclick=()=>openPanel('extract');$('visible').onclick=()=>openPanel('visible');$('figma').onclick=()=>openPanel('figma');
$('workspace').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL(`panel.html?mode=workspace&restore=1&tab=${sourceTab?.id||''}`)}).then(()=>window.close()).catch(e=>error(e.message));
init();
