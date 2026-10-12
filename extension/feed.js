(() => {
  function pinRecord(pin,origin) {
    if(!pin || !/^\d+$/.test(String(pin.id)))return null;
    const images=Object.entries(pin.images||{}).sort(([a],[b])=> (b==='orig'?Infinity:parseInt(b)||0)-(a==='orig'?Infinity:parseInt(a)||0)).map(([,v])=>v?.url).filter(u=>/^https:\/\/i\.pinimg\.com\//.test(u));
    if(!images.length)return null;
    return {id:String(pin.id),url:`${origin}/pin/${pin.id}/`,title:pin.title||pin.grid_title||pin.description||'',images:[...new Set(images)],video:!!pin.videos};
  }
  function seed(root,doc) {
    const target=new URL(root),parts=target.pathname.split('/').filter(Boolean);
    const result={pins:[],sections:[],expected:null,title:null,board:null,feed:null};
    for(const script of doc.querySelectorAll('script#__PWS_INITIAL_PROPS__,script#__PWS_DATA__')) {
      let state;try{const j=JSON.parse(script.textContent);state=j.initialReduxState||j.props?.initialReduxState||j.props?.initialProps?.initialReduxState;if(j.appVersion)result.appVersion=j.appVersion;}catch{continue;}
      if(!state)continue;
      const board=Object.values(state.boards||{}).find(b=>b.url?.replace(/\/$/,'')===`/${parts[0]}/${parts[1]}`);
      if(!board)continue;result.board=board;result.title=board.name;
      const section=parts.length===3?Object.values(state.boardsections||{}).find(s=>s.slug===decodeURIComponent(parts[2])||s.url?.replace(/\/$/,'')===target.pathname.replace(/\/$/,'')):null;
      if(parts.length===2)result.expected=Number.isFinite(board.pin_count)?board.pin_count:null;
      else if(section)result.expected=Number.isFinite(section.pin_count)?section.pin_count:null;
      const resourceName=parts.length===3?'BoardSectionPinsResource':'BoardFeedResource';
      for(const [key,resource] of Object.entries(state.resources?.[resourceName]||{})) {
        let options;try{const parsed=JSON.parse(key);options=Array.isArray(parsed)?Object.fromEntries(parsed):parsed;}catch{continue;}
        if(parts.length===2?String(options.board_id)!==String(board.id):!section||String(options.section_id)!==String(section.id))continue;
        for(const item of resource.data||[]){const p=pinRecord(item.images?item:state.pins?.[item.id],target.origin);if(p)result.pins.push(p);}
        result.feed={resource:resourceName,options,bookmark:resource.nextBookmark};
      }
      if(!result.feed && (parts.length===2||section))result.feed={resource:resourceName,options:parts.length===2?{board_id:board.id,field_set_key:'react_grid_pin',filter_section_pins:false,prepend:false}:{section_id:section.id}};
      // Feeds contain membership ids; do not include unrelated cached/recommended pins.
      if(parts.length===2)for(const item of state.feeds?.[`boardfeed:${board.id}`]||[]){const p=pinRecord(state.pins?.[item.id],target.origin);if(p)result.pins.push(p);}
      for(const s of Object.values(state.boardsections||{})){if(String(s.board?.id||s.board_id)!==String(board.id))continue;const path=s.url||`/${parts[0]}/${parts[1]}/${s.slug||'id:'+s.id}/`;result.sections.push(target.origin+path);}
    }
    result.pins=[...new Map(result.pins.map(p=>[p.id,p])).values()];return result;
  }
  async function paginate(info,root,{cancelled,progress}) {
    if(!info.board||!info.feed)return {pins:info.pins,complete:false,reason:'No board feed found in page data.'};
    const target=new URL(root),pins=new Map(info.pins.map(p=>[p.id,p])),seen=new Set();let bookmark=info.feed.bookmark;
    // A logged-out initial render can say end after a gated first batch. Request the normal board feed before declaring completion.
    if(bookmark==='-end-' && info.expected!==null && pins.size>=info.expected)return {pins:[...pins.values()],complete:true};
    if(!bookmark||bookmark==='-end-')bookmark=null;
    while(!cancelled()) {
      const key=JSON.stringify(Array.isArray(bookmark)?bookmark[0]:bookmark);if(seen.has(key))return {pins:[...pins.values()],complete:false,reason:'Pinterest repeated its pagination cursor.'};seen.add(key);
      const options={...info.feed.options,page_size:100,filter_section_pins:false};delete options.gated;
      if(bookmark)options.bookmarks=Array.isArray(bookmark)?bookmark:[bookmark];else delete options.bookmarks;
      const u=new URL(`/resource/${info.feed.resource}/get/`,target.origin);u.searchParams.set('source_url',target.pathname);u.searchParams.set('data',JSON.stringify({options,context:{}}));
      let data;
      for(let attempt=0;attempt<3;attempt++) {
        if(cancelled())break;
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
        try{const response=await fetch(u.href,{credentials:'same-origin',signal:controller.signal,headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest','X-Pinterest-Source-Url':target.pathname,'X-Pinterest-AppState':'active',...(info.appVersion?{'X-App-Version':info.appVersion}:{})}});if(!response.ok)throw new Error(`Board feed returned HTTP ${response.status}`);data=await response.json();break;}catch(e){if(attempt===2)return {pins:[...pins.values()],complete:false,reason:e.message};await new Promise(r=>setTimeout(r,1500*(attempt+1)));}finally{clearTimeout(timer);}
      }
      if(!data)break;
      const rows=data.resource_response?.data;const records=Array.isArray(rows)?rows:rows?.results;
      if(!Array.isArray(records))return {pins:[...pins.values()],complete:false,reason:'Pinterest returned an unfamiliar board-feed response.'};
      for(const item of records){const p=pinRecord(item,target.origin);if(p)pins.set(p.id,p);}
      progress(pins.size);
      const next=data.resource?.options?.bookmarks??data.resource_response?.bookmark;
      const cursor=Array.isArray(next)?next[0]:next;
      if(!cursor||cursor==='-end-')return {pins:[...pins.values()],complete:info.expected===null||pins.size>=info.expected,reason:info.expected!==null&&pins.size<info.expected?'Pinterest ended its feed before the advertised pin count.':null};
      bookmark=next;await new Promise(r=>setTimeout(r,250));
    }
    return {pins:[...pins.values()],complete:false,reason:'Collection stopped.'};
  }
  globalThis.BoardZipFeed={pinRecord,seed,paginate};
})();
