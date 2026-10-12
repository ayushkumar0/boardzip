(() => {
  if (globalThis.__boardZipInstalled==='2.1.0') return;
  globalThis.__boardZipInstalled='2.1.0';
  let cancelled=false, running=false;
  const pause = ms => new Promise(r=>setTimeout(r,ms));
  chrome.runtime.onMessage.addListener((m, sender, respond) => {
    if (m.type==='boardzip-stop') {cancelled=true; respond({ok:true}); return;}
    if (!['boardzip-scan','boardzip-visible'].includes(m.type)) return;
    if (running) {respond({error:'A scan is already running.'}); return;}
    cancelled=false; running=true;
    scan(m).then(respond).catch(e=>respond({error:e.message})).finally(()=>{running=false;});
    return true;
  });
  async function scan(m) {
    const startURL=location.href, startY=scrollY, pins=new Map(), sections=new Set();
    const root=new URL(m.root), rootParts=root.pathname.split('/').filter(Boolean);
    let scrollRoot=document.scrollingElement;
    for(let p=document.querySelector('a[href^="/pin/"]')?.parentElement;p;p=p.parentElement){
      if(p.clientHeight>0&&p.scrollHeight>p.clientHeight+100&&typeof getComputedStyle==='function'&&/auto|scroll/.test(getComputedStyle(p).overflowY)){scrollRoot=p;break;}
    }
    const rootStart=scrollRoot?.scrollTop||0;
    const viewport=()=>scrollRoot===document.scrollingElement?innerHeight:scrollRoot.clientHeight;
    const scroll=(delta)=>{if(scrollRoot===document.scrollingElement)window.scrollBy(0,delta);else scrollRoot.scrollTop+=delta;};
    let excluded=0, stable=0, reachedEnd=false;let feedInfo=null,feedWarning=null;
    const gather=()=> {
      const boundary=[...document.querySelectorAll('h1,h2,h3,[role="heading"]')].find(e=>/^(more like this|more ideas|find more ideas|related pins)$/i.test(e.textContent.trim()));
      const boundaryTop=feedInfo?.expected!=null && pins.size<feedInfo.expected ? undefined : boundary?.getBoundingClientRect().top;
      for(const a of document.querySelectorAll('a[href]')) {
        let u; try {u=new URL(a.href);} catch {continue;}
        if(u.origin!==location.origin) continue;
        const sectionParts=u.pathname.split('/').filter(Boolean);
        if(rootParts.length===2 && sectionParts.length===3 && sectionParts[0]===rootParts[0] && sectionParts[1]===rootParts[1]) sections.add(u.origin+'/'+sectionParts.join('/')+'/');
        const rect=a.getBoundingClientRect();
        if(m.type==='boardzip-visible' && (rect.bottom<=0||rect.top>=innerHeight)) continue;
        if(boundaryTop!==undefined && rect.top>=boundaryTop) continue;
        const match=u.pathname.match(/^\/pin\/(\d+)\/?$/); if(!match) continue;
        // Recommendation blocks are outside the board grid and must not be included.
        if(a.closest('[data-test-id*="related"], [data-test-id*="recommend"], [data-test-id*="more-ideas"]')) {excluded++; continue;}
        const card=a.closest('[data-test-id="pin"], [data-test-id="pinWrapper"]') || a;
        const imgs=[...card.querySelectorAll('img')];
        const urls=imgs.flatMap(img=>[img.currentSrc,img.src,...(img.srcset||'').split(',').map(s=>s.trim().split(/\s+/)[0])]).filter(s=>/^https:\/\/i\.pinimg\.com\//.test(s));
        if(!urls.length) continue;
        const old=pins.get(match[1]);
        pins.set(match[1], {id:match[1],url:u.origin+'/pin/'+match[1]+'/',title:imgs[0]?.alt||'',images:[...new Set([...(old?.images||[]),...urls])],video:!!card.querySelector('video') || !!old?.video});
      }
    };
    try {
      if(m.type==='boardzip-visible'){gather();return {pins:[...pins.values()],sections:[],title:document.querySelector('h1')?.textContent?.trim()||document.title,stopped:false,settled:false,source:startURL,visibleOnly:true};}
      if(globalThis.BoardZipFeed){
        feedInfo=BoardZipFeed.seed(m.root,document);
        for(const p of feedInfo.pins)pins.set(p.id,p);
        for(const section of feedInfo.sections)sections.add(section);
        try{const feed=await BoardZipFeed.paginate(feedInfo,m.root,{cancelled:()=>cancelled,progress:count=>chrome.runtime.sendMessage({type:'boardzip-progress',count,expected:feedInfo.expected,method:'board-feed'}).catch(()=>{})});
          for(const p of feed.pins)pins.set(p.id,p);feedWarning=feed.reason;
          if(feed.complete)return {pins:[...pins.values()],sections:[...sections],title:feedInfo.title||document.title,stopped:cancelled,settled:true,expected:feedInfo.expected,method:'board-feed',source:startURL};
        }catch(e){feedWarning=e.message;}
      }
      if(scrollRoot===document.scrollingElement)window.scrollTo(0,0);else scrollRoot.scrollTop=0; await pause(1500);
      for(let step=0;!cancelled;step++) {
        if(location.href!==startURL) throw new Error('Pinterest page changed during scanning. Start again on the board.');
        const before=pins.size+sections.size; gather();
        const more=[...document.querySelectorAll('h1,h2,h3,[role="heading"]')].find(e=>/^(more like this|more ideas|find more ideas|related pins)$/i.test(e.textContent.trim()) && e.getBoundingClientRect().top < innerHeight);
        // An ideas heading alone is not an end-of-board signal.
        const el=scrollRoot;
        const atBottom=el.scrollTop+viewport() >= el.scrollHeight-20;
        stable=before===pins.size+sections.size && atBottom ? stable+1 : 0;
        chrome.runtime.sendMessage({type:'boardzip-progress',count:pins.size,sections:sections.size,step}).catch(()=>{});
        if(stable>=20){reachedEnd=feedInfo?.expected==null||pins.size>=feedInfo.expected;break;}
        if(feedInfo?.expected!=null&&pins.size>=feedInfo.expected){reachedEnd=true;break;}
        scroll(Math.max(400,viewport()*0.7)); await pause(atBottom ? 1500 : 700);
      }
      gather();
      return {pins:[...pins.values()],sections:[...sections],title:document.querySelector('h1')?.textContent?.trim() || document.title,stopped:cancelled,settled:reachedEnd,expected:feedInfo?.expected??null,method:'scroll-fallback',warning:feedWarning,excluded,source:startURL};
    } finally {if(m.type!=='boardzip-visible'){if(scrollRoot===document.scrollingElement)window.scrollTo(0,startY);else scrollRoot.scrollTop=rootStart;}}
  }
})();
