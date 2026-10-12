export function boardURL(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !/^([a-z0-9-]+\.)?pinterest\.(com|co\.uk|in|ca|de|fr|com\.au)$/.test(u.hostname)) throw new Error('Open a Pinterest board on a supported Pinterest domain.');
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts.length > 3 || ['pin','search','ideas','today','settings','business','_'].includes(parts[0])) throw new Error('Open a board or board section, not a pin, profile, or home feed.');
  u.search = ''; u.hash = ''; u.pathname = '/' + parts.join('/') + '/';
  return u.href;
}
export function safeName(s) { return String(s || 'Pinterest-board').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\.+$/g, '').trim().slice(0,100) || 'Pinterest-board'; }
export function candidates(urls) {
  const originals = [], resized = [];
  for (const value of urls) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.hostname !== 'i.pinimg.com') continue;
      const m = u.pathname.match(/^\/(originals|\d+x[^/]*)\/(.+)\.(jpg|jpeg|png|webp|gif|avif)$/i);
      if (!m) continue;
      originals.push(`https://i.pinimg.com/originals/${m[2]}.${m[3]}`);
      for (const ext of ['png','jpg','webp','gif','jpeg','avif']) originals.push(`https://i.pinimg.com/originals/${m[2]}.${ext}`);
      resized.push(u.href);
    } catch {}
  }
  resized.sort((a,b) => (Number(b.match(/\/(\d+)x/)?.[1]) || 0) - (Number(a.match(/\/(\d+)x/)?.[1]) || 0));
  return [...new Set([...originals, ...resized])];
}
const table = Uint32Array.from({length:256}, (_, n) => { for(let j=0;j<8;j++) n = (n&1) ? 0xedb88320^(n>>>1) : n>>>1; return n>>>0; });
export function crc32(data) { let c=0xffffffff; for(const b of data) c=table[(c^b)&255]^(c>>>8); return (c^0xffffffff)>>>0; }
export class Zip {
  constructor() { this.parts=[]; this.entries=[]; this.size=0; }
  add(name, data) {
    if (!(data instanceof Uint8Array)) data=new TextEncoder().encode(data);
    const n=new TextEncoder().encode(name), crc=crc32(data);
    if (this.entries.length >= 65534 || this.size+data.length > 0xffffffff) throw new Error('ZIP size limit reached.');
    const header=new Uint8Array(30+n.length), v=new DataView(header.buffer);
    v.setUint32(0,0x04034b50,true); v.setUint16(4,20,true); v.setUint16(6,0x800,true); v.setUint16(12,33,true);
    v.setUint32(14,crc,true); v.setUint32(18,data.length,true); v.setUint32(22,data.length,true); v.setUint16(26,n.length,true); header.set(n,30);
    this.entries.push({n,crc,length:data.length,offset:this.size}); this.parts.push(header,data); this.size+=header.length+data.length;
  }
  blob() {
    const central=[]; let centralSize=0;
    for (const e of this.entries) {
      const h=new Uint8Array(46+e.n.length), v=new DataView(h.buffer);
      v.setUint32(0,0x02014b50,true); v.setUint16(4,20,true); v.setUint16(6,20,true); v.setUint16(8,0x800,true); v.setUint16(14,33,true);
      v.setUint32(16,e.crc,true); v.setUint32(20,e.length,true); v.setUint32(24,e.length,true); v.setUint16(28,e.n.length,true); v.setUint32(42,e.offset,true); h.set(e.n,46); central.push(h); centralSize+=h.length;
    }
    const end=new Uint8Array(22), v=new DataView(end.buffer); v.setUint32(0,0x06054b50,true); v.setUint16(8,this.entries.length,true); v.setUint16(10,this.entries.length,true); v.setUint32(12,centralSize,true); v.setUint32(16,this.size,true);
    return new Blob([...this.parts,...central,end],{type:'application/zip'});
  }
}
export function pinterestTransfer(pins, {board='',title='',strict=true}={}) {
  if(!Array.isArray(pins) || !pins.length) throw new Error('Select at least one pin.');
  return {kind:'boardzip/pinterest',version:1,board,title,strict,pins:pins.map(p=>({id:String(p.id),title:String(p.title||''),url:String(p.url||''),images:candidates(p.images)}))};
}
export function parseTransfer(text,kind) {
  if(typeof text!=='string' || text.length>300*1024*1024) throw new Error('Transfer file is too large.');
  const p=JSON.parse(text);
  if(p.version!==1 || p.kind!==kind) throw new Error('This is not a supported BoardZip transfer.');
  if(kind==='boardzip/pinterest') {
    if(!Array.isArray(p.pins)||!p.pins.length) throw new Error('The transfer contains no pins.');
    p.pins=p.pins.map(pin=>({...pin,id:String(pin.id),title:String(pin.title||'').slice(0,500),images:candidates(Array.isArray(pin.images)?pin.images:[]).filter(u=>!p.strict||new URL(u).pathname.startsWith('/originals/'))}));
  } else if(kind==='boardzip/figma') {
    if(!Array.isArray(p.files)||!p.files.length) throw new Error('The transfer contains no exported images.');
    for(const f of p.files) {
      if(!['image/png','image/jpeg'].includes(f.type) || typeof f.base64!=='string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64) || !f.base64.length || f.base64.length>140*1024*1024) throw new Error('Pinterest transfers require PNG or JPEG image data below 100 MB.');
      f.name=safeName(f.name);f.title=String(f.title||f.name).slice(0,100);
    }
  }
  return p;
}
