'use strict';
const PF_LONG=(()=>{
const tiers={original:0,high:2560,balanced:1920,small:1280};
const clone=x=>typeof structuredClone==='function'?structuredClone(x):JSON.parse(JSON.stringify(x));
const key=(g,t)=>JSON.stringify([g,t]);
const cmp=(a,b)=>(Number(a?.n)||0)-(Number(b?.n)||0)||(String(a?.d||'')<String(b?.d||'')?-1:String(a?.d||'')>String(b?.d||'')?1:0);
// Equal legacy clocks can disagree; use a deterministic removal-wins tie-break.
const flagWinner=(l,r)=>!l?r:!r?l:cmp(l,r)>0?l:cmp(l,r)<0?r:l.on===r.on?l:l.on?r:l;
function baseline(x){let r={...(x.clocks||{})};for(let [g,ts] of Object.entries(x.tags||{}))for(let t of ts)if(!r[key(g,t)])r[key(g,t)]={n:Number(x.added)||0,d:'legacy',on:true,manual:!!x.aiManual?.[key(g,t)]};for(let k of Object.keys(x.aiBlocked||{}))if(!r[k])r[k]={n:Number(x.updated)||0,d:'legacy',on:false,manual:true};return r}
function nextClock(now,...clocks){let n=now;for(const c of clocks){let v=Number(c?.n)||0;if(v>=Number.MAX_SAFE_INTEGER)throw Error("同步时钟超出可用范围");n=Math.max(n,v+1)}return n}
// Manual state and user intent are separate: undo may restore an unprotected AI tag
// (or no tag at all), but its user decision must outrank an older manual clock.
const intentOf=c=>c?.manual?{n:c.n,d:c.d}:c?.intent;
function tagWinner(l,r){if(!l||!r)return l||r;const a=intentOf(l),b=intentOf(r);if(!!a!==!!b)return a?l:r;if(a&&b){const order=cmp(a,b);if(order)return order>0?l:r}const order=cmp(l,r);if(order)return order>0?l:r;if(l.manual!==r.manual)return l.manual?l:r;return flagWinner(l,r)}
function stamp(x,old,device,now=Date.now(),undoTags=false){let r=baseline(old||{}),before=new Set(Object.entries(old?.tags||{}).flatMap(([g,ts])=>ts.map(t=>key(g,t)))),after=new Set(Object.entries(x.tags||{}).flatMap(([g,ts])=>ts.map(t=>key(g,t))));let n=nextClock(now,old?.rev,old?.life,...Object.values(r));for(let k of new Set([...before,...after,...Object.keys(x.aiManual||{}),...Object.keys(x.aiBlocked||{}),...Object.keys(old?.aiManual||{}),...Object.keys(old?.aiBlocked||{})])){let manual=!!(x.aiManual?.[k]||x.aiBlocked?.[k]),changed=before.has(k)!==after.has(k)||manual!==!!r[k]?.manual;if(changed||!r[k]){const prior=intentOf(r[k]);const v={n,d:device,on:after.has(k),manual};if(!manual){if(undoTags&&changed)v.intent={n,d:device};else if(prior)v.intent=prior}r[k]=v}}x.clocks=r;x.rev={n,d:device};x.changed=now;if(!old||!!x.deleted!==!!old.deleted)x.life={n,d:device,on:!x.deleted};else x.life=old.life||{n:Number(old.added)||0,d:'legacy',on:!old.deleted};return x}
function merge(a,b){if(!a)return clone(b);let winner=cmp(a.rev||{n:a.updated},b.rev||{n:b.updated})>=0?a:b;let out=clone(winner);out.id=a.id;out.hash=a.hash||b.hash||out.hash;out.clocks={};out.tags={};out.aiManual={};out.aiBlocked={};let aa=baseline(a),bb=baseline(b);for(let k of new Set([...Object.keys(aa),...Object.keys(bb)])){let l=aa[k],r=bb[k],v=tagWinner(l,r);let pair;try{pair=JSON.parse(k)}catch{continue}if(!Array.isArray(pair)||pair.length!==2)continue;let [g,t]=pair;if(typeof g!=='string'||typeof t!=='string'||g in Object.prototype||g==='prototype')continue;out.clocks[k]=v;if(v.on)(out.tags[g]??=[]).push(t);if(v.manual)(v.on?out.aiManual:out.aiBlocked)[k]=true;}let al=a.life||{n:a.added||0,d:'legacy',on:!a.deleted},bl=b.life||{n:b.added||0,d:'legacy',on:!b.deleted};out.life=flagWinner(al,bl);out.deleted=out.life.on?0:Math.max(a.deleted||0,b.deleted||0,1);out.changed=Math.max(a.changed||0,b.changed||0);return out}
// Exact radius-six candidate generation for valid 64-bit binary fingerprints.
// Four 16-bit blocks: if all blocks differ by >=2, total distance is >=8.
// Bounded work and explicit truncation keep adversarial buckets responsive.
async function visualDuplicates(rows,{limit=100,budget=5000000,stop=()=>false,yieldNow=()=>new Promise(r=>setTimeout(r,0))}={}){
 const buckets=Array.from({length:4},()=>new Map()),pairs=[];let checked=0,comparisons=0,work=0,eligible=0;
 const valid=x=>!x.deleted&&typeof x.phash==='string'&&/^[01]{64}$/.test(x.phash);
 const result=reason=>({pairs,checked,eligible,comparisons,reason});
 const pop=v=>{v=v-((v>>>1)&0x55555555);v=(v&0x33333333)+((v>>>2)&0x33333333);return (((v+(v>>>4))&0x0f0f0f0f)*0x01010101)>>>24};
 for(const x of rows)if(valid(x))eligible++;
 for(const x of rows){if(stop())return result('cancelled');if(!valid(x))continue;
  const keys=Array.from({length:4},(_,k)=>parseInt(x.phash.slice(k*16,k*16+16),2)),seen=new Set(),entry={id:x.id,hi:(keys[0]<<16)|keys[1],lo:(keys[2]<<16)|keys[3]};
  for(let k=0;k<4;k++)for(let bit=-1;bit<16;bit++){
   if(++work%8192===0){await yieldNow();if(stop())return result('cancelled')}
   const key=bit<0?keys[k]:keys[k]^(1<<bit),bucket=buckets[k].get(key);if(!bucket)continue;
   for(const y of bucket){if(++work%8192===0){await yieldNow();if(stop())return result('cancelled')}
    if(seen.has(y.id))continue;seen.add(y.id);if(y.id===x.id)continue;
    if(comparisons>=budget)return result('budget');comparisons++;
    const d=pop(entry.hi^y.hi)+pop(entry.lo^y.lo);if(d<=6){pairs.push([y.id,x.id,d]);if(pairs.length>=limit)return result('limit')}
   }
  }
  for(let k=0;k<4;k++){let b=buckets[k].get(keys[k]);if(!b)buckets[k].set(keys[k],b=[]);b.push(entry)}checked++;
 }
 return result(stop()?'cancelled':'complete');
}
function distance(a,b){if(!a||!b||a.length!==b.length)return Infinity;let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;return n}
function parts(rows,max=256*1024*1024,maxRows=3000){let out=[],cur=[],n=0;for(let row of rows){if(cur.length&&(n+row.bytes>max||cur.length>=maxRows)){out.push(cur);cur=[];n=0}cur.push(row);n+=row.bytes}if(cur.length||!out.length)out.push(cur);return out}
function diversify(pool,count,history=[],mode='random',rand=Math.random){let list=[...pool],out=[],prev=history.slice(-4);while(list.length&&out.length<count){let i=Math.floor(rand()*list.length);if(mode!=='random'){let score=x=>{let ts=new Set(Object.values(x.tags||{}).flat());let sim=y=>{let ys=Object.values(y.tags||{}).flat();return ys.filter(t=>ts.has(t)).length/Math.max(1,new Set([...ts,...ys]).size)};return Math.max(0,...[...prev,...out].map(sim))};let candidates=Array.from({length:Math.min(32,list.length)},()=>Math.floor(rand()*list.length));if(mode==='set'){let used=new Set(out.flatMap(x=>x.tags?.景别||[]));let fresh=candidates.filter(j=>(list[j].tags?.景别||[]).some(t=>!used.has(t)));if(fresh.length)candidates=fresh;}i=candidates.reduce((best,j)=>score(list[j])<score(list[best])?j:best,i);if(mode==='set'&&candidates.length)i=candidates.reduce((best,j)=>score(list[j])<score(list[best])?j:best,candidates[0]);}out.push(list.splice(i,1)[0]);}return out}
function collectionBase(c){let m={...(c?.members||{})};for(let id of c?.ids||[])if(!m[id])m[id]={n:0,d:'legacy',on:true};return m}
function stampCollection(c,old,device,now=Date.now()){let m=collectionBase(old),before=new Set(old?.ids||[]),after=new Set(c.ids||[]),rev={n:nextClock(now,old?.rev,...Object.values(m)),d:device};for(let id of new Set([...before,...after]))if(before.has(id)!==after.has(id)||!m[id])m[id]={...rev,on:after.has(id)};c.members=m;c.rev=rev;return c}
function mergeCollection(a,b){if(!a)return clone(b);let winner=cmp(a.rev,b.rev)>=0?a:b,out=clone(winner),l=collectionBase(a),r=collectionBase(b);out.members={};for(let k of new Set([...Object.keys(l),...Object.keys(r)])){if(k in Object.prototype)continue;out.members[k]=flagWinner(l[k],r[k])}out.ids=Object.keys(out.members).filter(k=>out.members[k].on);return out}
return {tiers,key,cmp,stamp,merge,distance,visualDuplicates,parts,diversify,stampCollection,mergeCollection};})();
if(typeof module!=='undefined')module.exports=PF_LONG;
