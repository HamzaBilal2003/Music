'use strict';
const $=s=>document.querySelector(s),EXT=/\.(mp3|wav|ogg|m4a|flac|aac)$/i;
const fmt=t=>{t=isFinite(t)?Math.max(0,t|0):0;return(t/60|0)+':'+String(t%60).padStart(2,'0')};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ic=n=>`<svg class="i"><use href="#i-${n}"/></svg>`;
const hash=s=>{let h=7;for(const c of String(s))h=(h*31+c.charCodeAt(0))>>>0;return h};
const grad=s=>{const h=hash(s)%360;return`linear-gradient(135deg,hsl(${h} 75% 52%),hsl(${(h+50)%360} 70% 22%))`};
const PRE={Flat:[0,0,0,0,0],'Bass Boost':[7,5,0,0,0],Vocal:[-3,0,4,3,-1],Rock:[5,3,-2,3,5],Pop:[-1,3,4,2,-1]};
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a};

/* ---------- ID3v2 parser (title, artist, album, cover art) ---------- */
function txt(d){const e=d[0],enc=e==0?'iso-8859-1':e==3?'utf-8':e==1?'utf-16':'utf-16be';return new TextDecoder(enc).decode(d.subarray(1)).replace(/\0/g,'').trim()}
async function readTags(file){const o={};try{
 const b=new Uint8Array(await file.slice(0,Math.min(file.size,3<<20)).arrayBuffer());
 if(b[0]!==73||b[1]!==68||b[2]!==51)return o;
 const v=b[3],end=Math.min(10+((b[6]<<21)|(b[7]<<14)|(b[8]<<7)|b[9]),b.length);let p=10;
 if(b[5]&0x40)p+=((b[10]<<24)|(b[11]<<16)|(b[12]<<8)|b[13])>>>0;
 while(p+10<end){const id=String.fromCharCode(b[p],b[p+1],b[p+2],b[p+3]);
  const n=v==4?(b[p+4]<<21)|(b[p+5]<<14)|(b[p+6]<<7)|b[p+7]:((b[p+4]<<24)|(b[p+5]<<16)|(b[p+6]<<8)|b[p+7])>>>0;
  if(!n||b[p]===0||p+10+n>b.length)break;const d=b.subarray(p+10,p+10+n);
  if(id==='TIT2')o.title=txt(d);else if(id==='TPE1')o.artist=txt(d);else if(id==='TALB')o.album=txt(d);
  else if(id==='APIC'){const e=d[0];let i=1;while(i<d.length&&d[i])i++;const mime=new TextDecoder('iso-8859-1').decode(d.subarray(1,i));i+=2;
   if(e===1||e===2){while(i<d.length&&!(d[i]===0&&d[i+1]===0))i+=2;i+=2}else{while(i<d.length&&d[i])i++;i++}
   if(i<d.length)o.art=new Blob([d.slice(i)],{type:/^image\//.test(mime)?mime:'image/jpeg'})}
  p+=10+n}
}catch(e){}return o}
const getDur=f=>new Promise(r=>{const u=URL.createObjectURL(f),a=new Audio(),done=d=>{URL.revokeObjectURL(u);r(isFinite(d)?d:0)};a.preload='metadata';a.onloadedmetadata=()=>done(a.duration);a.onerror=()=>done(0);setTimeout(()=>done(0),5000);a.src=u});

/* ---------- IndexedDB ---------- */
class StorageDB{
 constructor(){this.p=new Promise((res,rej)=>{const r=indexedDB.open('pulse',1);r.onupgradeneeded=()=>{r.result.createObjectStore('songs',{keyPath:'id'});r.result.createObjectStore('kv',{keyPath:'k'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
 async tx(s,m,f){const d=await this.p;return new Promise((res,rej)=>{const t=d.transaction(s,m),q=f(t.objectStore(s));t.oncomplete=()=>res(q&&q.result);t.onerror=t.onabort=()=>rej(t.error)})}
 putSong(s){return this.tx('songs','readwrite',o=>o.put(s))}
 allSongs(){return this.tx('songs','readonly',o=>o.getAll())}
 get(k){return this.tx('kv','readonly',o=>o.get(k)).then(r=>r&&r.v).catch(()=>undefined)}
 set(k,v){return this.tx('kv','readwrite',o=>o.put({k,v})).catch(()=>{})}
}

/* ---------- Audio + Web Audio graph ---------- */
class AudioEngine{
 constructor(){this.a=new Audio();this.a.preload='metadata';this.vol=1;this.muted=false;this.gains=[0,0,0,0,0];this.bass=0;this.ctx=null}
 init(){if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume();return}
  const C=window.AudioContext||window.webkitAudioContext;if(!C)return;this.ctx=new C();const x=this.ctx;
  const src=x.createMediaElementSource(this.a);
  this.f=[60,230,910,3600,14000].map(hz=>{const f=x.createBiquadFilter();f.type='peaking';f.frequency.value=hz;f.Q.value=1;return f});
  this.bs=x.createBiquadFilter();this.bs.type='lowshelf';this.bs.frequency.value=110;
  this.g=x.createGain();this.an=x.createAnalyser();this.an.fftSize=128;this.an.smoothingTimeConstant=.8;
  let n=src;[...this.f,this.bs,this.g,this.an].forEach(y=>{n.connect(y);n=y});n.connect(x.destination);this.apply()}
 apply(){const v=this.muted?0:this.vol;if(!this.ctx){this.a.volume=v;return}
  this.f.forEach((f,i)=>f.gain.value=this.gains[i]);this.bs.gain.value=this.bass;this.g.gain.cancelScheduledValues(0);this.g.gain.value=v}
 fade(ms,cb){if(!this.ctx){cb();return}const t=this.ctx.currentTime;this.g.gain.setValueAtTime(this.g.gain.value,t);this.g.gain.linearRampToValueAtTime(0,t+ms/1000);setTimeout(()=>{cb();this.apply()},ms+50)}
}

/* ---------- Library ---------- */
class LibraryManager{
 constructor(db){this.db=db;this.all=[];this.map=new Map();this.favs=new Set();this.pls=[];this.sort='added';this.q=''}
 async load(){this.all=await this.db.allSongs()||[];this.all.forEach(s=>this.map.set(s.id,s));this.favs=new Set(await this.db.get('favs')||[]);this.pls=await this.db.get('pls')||[]}
 saveFavs(){return this.db.set('favs',[...this.favs])}savePls(){return this.db.set('pls',this.pls)}
 view(list=this.all){const q=this.q.trim().toLowerCase(),r=q?list.filter(s=>(s.title+' '+s.artist+' '+s.album).toLowerCase().includes(q)):list.slice();
  const c={az:(a,b)=>a.title.localeCompare(b.title),artist:(a,b)=>a.artist.localeCompare(b.artist)||a.title.localeCompare(b.title),dur:(a,b)=>a.duration-b.duration,added:(a,b)=>b.added-a.added};return r.sort(c[this.sort])}
 group(key){const m=new Map();this.all.forEach(s=>{if(!m.has(s[key]))m.set(s[key],[]);m.get(s[key]).push(s)});return[...m].sort((a,b)=>a[0].localeCompare(b[0]))}
 async ingest(items,cb){let n=0,k=0;
  for(const it of items){k++;try{const f=it.file||await it.handle.getFile();if(!EXT.test(f.name))continue;
   const id=f.name+'|'+f.size+'|'+f.lastModified;if(this.map.has(id))continue;
   const tg=/\.mp3$/i.test(f.name)?await readTags(f):{},base=f.name.replace(EXT,''),parts=base.split(' - '),hasA=parts.length>1;
   const s={id,title:tg.title||(hasA?parts.slice(1).join(' - '):base),artist:tg.artist||(hasA?parts[0]:'Unknown Artist'),album:tg.album||'Unknown Album',art:tg.art||null,duration:await getDur(f),added:Date.now()+k,handle:it.handle||null,blob:it.handle?null:f};
   try{await this.db.putSong(s)}catch(e){s.handle=null;s.blob=f;await this.db.putSong(s)}
   this.all.push(s);this.map.set(id,s);n++;if(k%4===0)cb(`Importing ${k}/${items.length}`,false)}catch(e){}}
  cb(n?`Added ${n} song${n>1?'s':''}`:'No new songs found',true)}
}

/* ---------- UI + queue ---------- */
class UIManager{
 constructor(db,eng,lib){this.db=db;this.eng=eng;this.lib=lib;this.q=[];this.o=[];this.i=-1;this.shuf=false;this.rep=0;this.tab='songs';this.open=null;this.urls=new Map();
  this.st={vol:1,muted:false,speed:1,gains:[0,0,0,0,0],bass:8,bassOn:false,preset:'Flat'};this.seeking=false;this.last=0;this.sEnd=false;this.npOpen=false}
 async init(){await this.lib.load();this.dir=await this.db.get('dir');
  const s=await this.db.get('app')||{};Object.assign(this.st,s.st||{});this.rep=s.rep||0;const E=this.eng,S=this.st;
  E.vol=S.vol;E.muted=S.muted;E.gains=S.gains.slice();E.bass=S.bassOn?S.bass:0;E.a.defaultPlaybackRate=E.a.playbackRate=S.speed;E.apply();
  $('#vol').value=S.vol;$('#bSpd').textContent=S.speed+'x';$('#bRep').dataset.m=this.rep;this.muteUI();
  this.bind();this.render();
  if(s.id&&this.lib.map.has(s.id)){this.o=this.q=this.lib.view().map(x=>x.id);this.i=this.q.indexOf(s.id);await this.load(s.id,false,s.t||0)}}
 save(){this.db.set('app',{st:this.st,rep:this.rep,id:this.q[this.i],t:this.eng.a.currentTime})}
 song(id){return this.lib.map.get(id)}
 url(s){if(!this.urls.has(s.id))this.urls.set(s.id,URL.createObjectURL(s.art));return this.urls.get(s.id)}
 artCss(s){return s.art?`center/cover url(${this.url(s)})`:grad(s.album+s.title)}
 toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(this.tt);this.tt=setTimeout(()=>t.classList.remove('show'),2200)}
 modal(title,c){$('#mdT').textContent=title;const b=$('#mdB');b.replaceChildren();if(typeof c==='string')b.innerHTML=c;else b.append(c);$('#md').classList.add('open')}
 closeModal(){$('#md').classList.remove('open')}
 menu(title,items){const d=document.createElement('div');items.forEach(([t,fn])=>{const b=document.createElement('button');b.className='mb';b.textContent=t;b.onclick=()=>{this.closeModal();fn()};d.append(b)});this.modal(title,d)}
 chips(title,opts,cur,fn){const d=document.createElement('div');d.className='chips';opts.forEach(([l,v])=>{const b=document.createElement('button');b.className='chip'+(String(v)===String(cur)?' on':'');b.textContent=l;b.onclick=()=>{this.closeModal();fn(v)};d.append(b)});this.modal(title,d)}

 /* --- library views --- */
 row(html,act,key,cls=''){const d=document.createElement('div');d.className='row '+cls;d.innerHTML=html;d.dataset.act=act;if(key!=null)d.dataset.k=key;return d}
 songRow(s){const r=this.row(`<div class="th" style="background:${this.artCss(s)}"></div><div class="mi"><b>${esc(s.title)}</b><small>${esc(s.artist)} · ${esc(s.album)}</small></div><span class="d">${fmt(s.duration)}</span><button class="ic" data-act="more" aria-label="More">${ic('more')}</button>`,'play',s.id);return r}
 render(){const L=this.lib,list=$('#list'),f=document.createDocumentFragment(),t=this.tab,o=this.open;let songs=null,pl=null;
  if(o){pl=t==='lists'&&L.pls.find(p=>p.id===o);
   const raw=pl?pl.ids.map(id=>L.map.get(id)).filter(Boolean):((L.group(t==='albums'?'album':'artist').find(g=>g[0]===o)||[0,[]])[1]);
   f.append(this.row(`<button class="ic" data-act="back" aria-label="Back">${ic('back')}</button><b class="mi">${esc(pl?pl.name:o)}</b>`+(pl?`<button class="ic" data-act="renpl" aria-label="Rename">${ic('edit')}</button><button class="ic" data-act="delpl" aria-label="Delete">${ic('x')}</button>`:'')));songs=L.view(raw)}
  else if(t==='songs')songs=L.view();else if(t==='favs')songs=L.view(L.all.filter(s=>L.favs.has(s.id)));
  else if(t==='lists'){f.append(this.row('<button class="pill" data-act="newpl">New playlist</button>'));
   L.pls.forEach(p=>f.append(this.row(`<div class="th" style="background:${grad(p.name)}"></div><div class="mi"><b>${esc(p.name)}</b><small>${p.ids.length} songs</small></div>`,'openpl',p.id)))}
  else L.group(t==='albums'?'album':'artist').filter(g=>!L.q||g[0].toLowerCase().includes(L.q.toLowerCase())).forEach(([n,a])=>f.append(this.row(`<div class="th" style="background:${this.artCss(a[0])}"></div><div class="mi"><b>${esc(n)}</b><small>${a.length} songs</small></div>`,'grp',n)));
  if(songs){this.shown=songs.map(s=>s.id);songs.forEach(s=>f.append(this.songRow(s)));
   if(!songs.length){const e=document.createElement('div');e.className='empty';e.innerHTML=!L.all.length?'<p>Your library is empty. Add songs from your device to start listening.</p><button class="pill" data-act="add">Add music</button>':'<p>Nothing here yet.</p>';f.append(e)}}
  list.replaceChildren(f);this.mark()}
 mark(){const id=this.q[this.i];document.querySelectorAll('#list .row[data-act=play]').forEach(r=>r.classList.toggle('cur',r.dataset.k===id))}
 addMenu(){const it=[];
  if(this.dir)it.push(['Rescan saved folder',async()=>{try{if(await this.dir.requestPermission({mode:'read'})!=='granted')return this.toast('Permission denied');this.scan(this.dir)}catch(e){this.toast('Could not open folder')}}]);
  if(window.showDirectoryPicker)it.push(['Choose music folder',async()=>{try{const h=await showDirectoryPicker({mode:'read'});this.dir=h;this.db.set('dir',h);this.scan(h)}catch(e){}}]);
  it.push(['Import audio files',()=>$('#fFiles').click()],['Import a folder',()=>$('#fDir').click()]);this.menu('Add music',it)}
 async scan(h){const items=[],walk=async d=>{for await(const[n,x]of d.entries()){if(x.kind==='directory')await walk(x);else if(EXT.test(n))items.push({handle:x})}};
  this.toast('Scanning…');try{await walk(h);await this.lib.ingest(items,(m,end)=>{this.toast(m);if(end)this.render()})}catch(e){this.toast('Scan failed')}}
 onFiles(fl){const items=[...fl].filter(f=>EXT.test(f.name)).map(file=>({file}));if(!items.length)return this.toast('No supported audio files');this.lib.ingest(items,(m,end)=>{this.toast(m);if(end)this.render()})}
 rowMenu(id){const L=this.lib,s=this.song(id),it=[['Play next',()=>this.enqueue(id,true)],['Add to queue',()=>this.enqueue(id,false)],['Set cover picture',()=>this.pickCover(id)],[L.favs.has(id)?'Remove from favorites':'Add to favorites',()=>this.fav(id)],
  ['Add to playlist',()=>{if(!L.pls.length)return this.toast('Create a playlist first');this.menu('Add to playlist',L.pls.map(p=>[p.name,()=>{if(!p.ids.includes(id))p.ids.push(id);L.savePls();this.toast('Added to '+p.name)}]))}]];
  const pl=this.tab==='lists'&&this.open&&L.pls.find(p=>p.id===this.open);if(pl)it.push(['Remove from this playlist',()=>{pl.ids=pl.ids.filter(x=>x!==id);L.savePls();this.render()}]);this.menu(s.title,it)}
 pickCover(id){if(!id)return this.toast('Play a song first');this.covId=id;$('#fCover').click()}
 async setCover(f){const s=this.song(this.covId);if(!f||!s)return;if(this.urls.has(s.id)){URL.revokeObjectURL(this.urls.get(s.id));this.urls.delete(s.id)}s.art=f.slice(0,f.size,f.type||'image/jpeg');await this.db.putSong(s);this.toast('Cover updated');this.render();this.qRender();if(this.q[this.i]===s.id)this.meta(s)}
 fav(id=this.q[this.i]){if(!id)return;const F=this.lib.favs;F.has(id)?F.delete(id):F.add(id);this.lib.saveFavs();this.favUI();if(this.tab==='favs')this.render()}
 favUI(){$('#bFav').classList.toggle('on',this.lib.favs.has(this.q[this.i]))}
 newPl(){const n=(prompt('Playlist name')||'').trim();if(!n)return;this.lib.pls.push({id:'p'+Date.now(),name:n,ids:[]});this.lib.savePls();this.render()}

 /* --- queue & playback --- */
 playList(ids,id){this.o=ids.slice();this.q=this.shuf?[id,...shuffle(ids.filter(x=>x!==id))]:ids.slice();this.i=this.q.indexOf(id);this.load(id,true)}
 enqueue(id,next){if(!this.q.length){this.o=this.q=[id];this.i=0;return this.load(id,false)}this.q=this.q.filter((x,k)=>k<=this.i||x!==id);next?this.q.splice(this.i+1,0,id):this.q.push(id);this.toast(next?'Playing next':'Added to queue');this.qRender()}
 async load(id,play,t=0){const s=this.song(id);if(!s)return;let f=s.blob;
  if(s.handle){try{if(await s.handle.queryPermission({mode:'read'})!=='granted'&&await s.handle.requestPermission({mode:'read'})!=='granted')throw 0;f=await s.handle.getFile()}catch(e){this.toast('File access needed. Rescan your folder.');return}}
  if(!f)return;const a=this.eng.a;if(this.src)URL.revokeObjectURL(this.src);this.src=URL.createObjectURL(f);a.src=this.src;a.playbackRate=this.st.speed;
  if(t)a.addEventListener('loadedmetadata',()=>{a.currentTime=t},{once:true});this.meta(s);if(play)this.play()}
 play(){this.eng.init();this.eng.apply();const p=this.eng.a.play();if(p)p.catch(()=>{})}
 pause(){this.eng.a.pause()}
 toggle(){if(!this.eng.a.src){if(this.lib.all.length)this.playList(this.lib.view().map(s=>s.id),this.lib.view()[0].id);return}this.eng.a.paused?this.play():this.pause()}
 stop(){const a=this.eng.a;a.pause();a.currentTime=0}
 next(auto){const n=this.q.length;if(!n)return;const a=this.eng.a;
  if(auto&&this.rep===2){a.currentTime=0;return this.play()}
  if(this.i+1<n)this.i++;else if(this.rep===1||!auto)this.i=0;else{this.i=0;return this.load(this.q[0],false)}this.load(this.q[this.i],true)}
 prev(){const a=this.eng.a;if(a.currentTime>3||!this.q.length){a.currentTime=0;return}this.i=this.i>0?this.i-1:(this.rep===1?this.q.length-1:0);this.load(this.q[this.i],true)}
 setShuffle(on){this.shuf=on;const cur=this.q[this.i];if(on&&cur){this.q=[cur,...shuffle(this.o.filter(x=>x!==cur))];this.i=0}else if(!on&&this.o.length){this.q=this.o.slice();this.i=Math.max(0,this.q.indexOf(cur))}$('#bShuf').classList.toggle('on',on);this.qRender()}
 meta(s){const u=s.art?this.url(s):'';$('#mArt').style.background=$('#npArt').style.background=this.artCss(s);
  $('#mT span').textContent=s.title;$('#mA').textContent=s.artist;$('#npT').textContent=s.title;$('#npA').textContent=s.artist+' · '+s.album;$('#mini').hidden=false;
  const e=$('#mT');e.classList.remove('mq');requestAnimationFrame(()=>{const d=e.firstChild.scrollWidth-e.clientWidth;if(d>0){e.style.setProperty('--d',-d+'px');e.classList.add('mq')}});
  this.amb(s);this.favUI();this.mark();this.qRender();document.title=s.title+' · Pulse';
  if('mediaSession' in navigator)navigator.mediaSession.metadata=new MediaMetadata({title:s.title,artist:s.artist,album:s.album,artwork:u?[{src:u,sizes:'512x512',type:s.art.type||'image/jpeg'}]:[]})}
 amb(s){const r=document.documentElement.style;if(!s.art){r.setProperty('--amb',`hsl(${hash(s.album+s.title)%360} 55% 22%)`);return}
  const i=new Image();i.onload=()=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.drawImage(i,0,0,1,1);const d=x.getImageData(0,0,1,1).data;r.setProperty('--amb',`rgb(${d[0]*.55|0},${d[1]*.55|0},${d[2]*.55|0})`)};i.src=this.url(s)}
 setIcons(){const p=this.eng.a.paused;['#mPlay','#bPlay'].forEach(q=>$(q).innerHTML=ic(p?'play':'pause'));if('mediaSession' in navigator)navigator.mediaSession.playbackState=p?'paused':'playing'}
 muteUI(){$('#bMute').innerHTML=ic(this.st.muted||this.st.vol===0?'mute':'vol')}
 viz(){cancelAnimationFrame(this.raf);const an=this.eng.an;if(!an||!this.npOpen||this.eng.a.paused)return;const cv=$('#viz'),c=cv.getContext('2d'),d=new Uint8Array(an.frequencyBinCount),n=32,w=cv.width/n;
  const loop=()=>{an.getByteFrequencyData(d);c.clearRect(0,0,cv.width,cv.height);c.fillStyle='#ff5a36';for(let i=0;i<n;i++){const h=Math.max(2,d[i]/255*cv.height);c.fillRect(i*w+2,cv.height-h,w-4,h)}this.raf=requestAnimationFrame(loop)};loop()}
 openNP(o){this.npOpen=o;$('#np').classList.toggle('open',o);o?this.viz():cancelAnimationFrame(this.raf)}
 qRender(){const b=$('#qB');if(!b)return;b.replaceChildren();const f=document.createDocumentFragment();
  this.q.forEach((id,k)=>{if(k<this.i)return;const s=this.song(id);if(!s)return;const d=document.createElement('div');d.className='qr'+(k===this.i?' cur':'');d.dataset.k=k;
   d.innerHTML=`<div class="th" style="background:${this.artCss(s)}" data-act="go"></div><div class="mi" data-act="go"><b>${esc(s.title)}</b><small>${k===this.i?'Now playing':esc(s.artist)}</small></div>`+(k>this.i?`<button class="ic" data-act="up">${ic('up')}</button><button class="ic" data-act="dn">${ic('down')}</button><button class="ic" data-act="rm">${ic('x')}</button>`:'');f.append(d)});
  if(!f.childNodes.length)b.innerHTML='<p class="empty">The queue is empty.</p>';else b.append(f)}
 qAct(e){const t=e.target.closest('[data-act]'),r=e.target.closest('.qr');if(!t||!r)return;const k=+r.dataset.k,q=this.q,a=t.dataset.act;
  if(a==='go'){this.i=k;this.load(q[k],true)}else if(a==='rm')q.splice(k,1);
  else if(a==='up'&&k-1>this.i)[q[k-1],q[k]]=[q[k],q[k-1]];else if(a==='dn'&&k+1<q.length)[q[k+1],q[k]]=[q[k],q[k+1]];this.qRender()}
 setSleep(m){clearTimeout(this.sT);clearInterval(this.sI);this.sEnd=m==='end';this.sAt=0;const l=$('#slp');l.textContent=this.sEnd?'Sleep: end of song':'';
  if(m&&!this.sEnd){this.sAt=Date.now()+m*6e4;this.sT=setTimeout(()=>this.eng.fade(4000,()=>{this.pause();this.setSleep(0)}),m*6e4-4000);
   const u=()=>{l.textContent='Sleep in '+Math.ceil((this.sAt-Date.now())/6e4)+' min'};u();this.sI=setInterval(u,15000)}
  $('#bTim').classList.toggle('on',!!m)}
 eqPanel(){const S=this.st,E=this.eng,d=document.createElement('div');
  d.innerHTML=`<div class="chips">${Object.keys(PRE).map(p=>`<button class="chip${S.preset===p?' on':''}" data-p="${p}">${p}</button>`).join('')}</div>`+['60 Hz','230 Hz','910 Hz','3.6 kHz','14 kHz'].map((n,i)=>`<label class="sl"><span>${n}</span><input type="range" min="-12" max="12" step="1" value="${S.gains[i]}" data-b="${i}"></label>`).join('')+`<label class="sl"><span>Bass boost</span><input type="range" min="0" max="15" value="${S.bass}" id="bbV"><input type="checkbox" id="bbOn" ${S.bassOn?'checked':''}></label>`;
  d.oninput=e=>{const t=e.target;if(t.dataset.b!=null){S.gains[+t.dataset.b]=+t.value;S.preset='Custom';d.querySelectorAll('.chip').forEach(c=>c.classList.remove('on'))}else if(t.id==='bbV')S.bass=+t.value;else if(t.id==='bbOn')S.bassOn=t.checked;else return;
   E.gains=S.gains.slice();E.bass=S.bassOn?S.bass:0;E.init();E.apply();this.save()};
  d.onclick=e=>{const p=e.target.dataset.p;if(!p)return;S.preset=p;S.gains=PRE[p].slice();E.gains=S.gains.slice();E.init();E.apply();d.querySelectorAll('[data-b]').forEach(r=>r.value=S.gains[r.dataset.b]);d.querySelectorAll('.chip').forEach(c=>c.classList.toggle('on',c.dataset.p===p));this.save()};
  this.modal('Equalizer',d)}

 bind(){const E=this.eng,a=E.a,S=this.st,$$=(q,f)=>$(q).addEventListener('click',f);
  $$('#btnAdd',()=>this.addMenu());
  $('#search').oninput=e=>{this.lib.q=e.target.value;this.render()};$('#sort').onchange=e=>{this.lib.sort=e.target.value;this.render()};
  $$('#tabs',e=>{const t=e.target.dataset.t;if(!t)return;this.tab=t;this.open=null;document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b===e.target));this.render()});
  $$('#list',e=>{const t=e.target.closest('[data-act]');if(!t)return;const row=t.closest('.row'),k=row&&row.dataset.k,A=t.dataset.act;
   if(A==='play')this.playList(this.shown,k);else if(A==='more')this.rowMenu(k);else if(A==='grp'||A==='openpl'){this.open=k;this.render();$('#list').scrollTop=0}
   else if(A==='back'){this.open=null;this.render()}else if(A==='newpl')this.newPl();else if(A==='add')this.addMenu();
   else if(A==='renpl'||A==='delpl'){const L=this.lib,p=L.pls.find(x=>x.id===this.open);if(A==='renpl'){const n=(prompt('Rename playlist',p.name)||'').trim();if(n){p.name=n;L.savePls();this.render()}}else if(confirm('Delete playlist "'+p.name+'"?')){L.pls=L.pls.filter(x=>x!==p);L.savePls();this.open=null;this.render()}}});
  $('#fCover').onchange=e=>{this.setCover(e.target.files[0]);e.target.value=''};$$('#bCov',()=>this.pickCover(this.q[this.i]));
  $('#fFiles').onchange=$('#fDir').onchange=e=>{this.onFiles(e.target.files);e.target.value=''};
  $$('#mini',e=>{if(!e.target.closest('button'))this.openNP(true)});$$('#mPlay',()=>this.toggle());$$('#mNext',()=>this.next());
  $$('#bClose',()=>this.openNP(false));$$('#bPlay',()=>this.toggle());$$('#bNext',()=>this.next());$$('#bPrev',()=>this.prev());$$('#bStop',()=>this.stop());$$('#bFav',()=>this.fav());
  $$('#bShuf',()=>this.setShuffle(!this.shuf));$$('#bRep',e=>{this.rep=(this.rep+1)%3;e.currentTarget.dataset.m=this.rep;this.toast(['Repeat off','Repeat all','Repeat one'][this.rep]);this.save()});
  $$('#bSpd',()=>this.chips('Playback speed',[.5,1,1.25,1.5,2].map(v=>[v+'x',v]),S.speed,v=>{S.speed=+v;a.defaultPlaybackRate=a.playbackRate=S.speed;$('#bSpd').textContent=v+'x';this.save()}));
  $$('#bEq',()=>this.eqPanel());
  $$('#bTim',()=>this.chips('Sleep timer',[['15 min',15],['30 min',30],['45 min',45],['60 min',60],['End of song','end'],['Off',0]],this.sEnd?'end':this.sAt?'x':0,v=>this.setSleep(v)));
  $$('#bQ',()=>{this.qRender();$('#qd').classList.add('open')});$('#qB').onclick=e=>this.qAct(e);
  $$('#bMute',()=>{S.muted=!S.muted;E.muted=S.muted;E.apply();this.muteUI();this.save()});
  $('#vol').oninput=e=>{S.vol=E.vol=+e.target.value;S.muted=E.muted=false;E.apply();this.muteUI()};$('#vol').onchange=()=>this.save();
  ['#md','#qd'].forEach(q=>$(q).onclick=e=>{if(e.target.id===q.slice(1))e.target.classList.remove('open')});
  const sk=$('#seek');sk.oninput=()=>{this.seeking=true;$('#tCur').textContent=fmt(sk.value)};sk.onchange=()=>{a.currentTime=+sk.value;this.seeking=false};
  a.onloadedmetadata=()=>{sk.max=a.duration||1;$('#tDur').textContent=fmt(a.duration)};
  a.ontimeupdate=()=>{if(!this.seeking){sk.value=a.currentTime;$('#tCur').textContent=fmt(a.currentTime)}const n=Date.now();if(n-this.last>5000){this.last=n;this.save()}
   if('mediaSession' in navigator&&isFinite(a.duration))try{navigator.mediaSession.setPositionState({duration:a.duration,position:Math.min(a.currentTime,a.duration),playbackRate:a.playbackRate})}catch(e){}};
  a.onplay=()=>{this.setIcons();this.viz()};a.onpause=()=>{this.setIcons();this.save()};
  a.onended=()=>{if(this.sEnd){this.setSleep(0);return}this.next(true)};a.onerror=()=>{if(a.src)this.toast('Cannot play this file')};
  const ms=navigator.mediaSession;if(ms){const h=(n,f)=>{try{ms.setActionHandler(n,f)}catch(e){}};h('play',()=>this.play());h('pause',()=>this.pause());h('stop',()=>this.stop());h('previoustrack',()=>this.prev());h('nexttrack',()=>this.next());
   h('seekto',d=>{a.currentTime=d.seekTime});h('seekbackward',d=>{a.currentTime-=d.seekOffset||10});h('seekforward',d=>{a.currentTime+=d.seekOffset||10})}
  /* gestures: swipe art left/right = next/prev, swipe down = minimize */
  let x0=0,y0=0;const art=$('#npArt'),np=$('#np');
  art.addEventListener('touchstart',e=>{x0=e.touches[0].clientX},{passive:true});
  art.addEventListener('touchmove',e=>{art.style.transform=`translateX(${(e.touches[0].clientX-x0)/3}px)`},{passive:true});
  art.addEventListener('touchend',e=>{art.style.transform='';const d=e.changedTouches[0].clientX-x0;if(d<-60)this.next();else if(d>60)this.prev()});
  np.addEventListener('touchstart',e=>{y0=e.touches[0].clientY},{passive:true});
  np.addEventListener('touchend',e=>{if(e.target.closest('input')||e.target.closest('#npArt'))return;if(e.changedTouches[0].clientY-y0>90&&np.scrollTop<5)this.openNP(false)});
  window.addEventListener('beforeunload',()=>this.save());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.save()})}
}

/* ---------- PWA install + service worker ---------- */
class PWAInstaller{
 constructor(ui){const b=$('#btnInstall'),ios=/iphone|ipad|ipod/i.test(navigator.userAgent),sa=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  addEventListener('beforeinstallprompt',e=>{e.preventDefault();this.ev=e;b.hidden=false});addEventListener('appinstalled',()=>{b.hidden=true});if(ios&&!sa)b.hidden=false;
  b.onclick=async()=>{if(this.ev){this.ev.prompt();await this.ev.userChoice;this.ev=null;b.hidden=true}else ui.modal('Install on iPhone or iPad','<p>1. Tap the Share button in Safari.<br>2. Choose <b>Add to Home Screen</b>.<br>3. Tap <b>Add</b>.</p>')};
  if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}))}
}

const db=new StorageDB(),eng=new AudioEngine(),lib=new LibraryManager(db),ui=new UIManager(db,eng,lib);
new PWAInstaller(ui);ui.init();
