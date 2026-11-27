// Keep one coherent release active; never activate a partial or mixed offline cache.
importScripts('./runtime-assets.js');
const CACHE='poseframe-'+self.PF_VERSION, REV='?v=1170', ASSET_URLS=new Map(self.PF_ASSETS.map(f=>[new URL(f,self.location.href).href,f]));
async function verifiedFetch(file){
 const expected=self.PF_SHA256?.[file];if(!/^[0-9a-f]{64}$/.test(expected||''))throw Error('离线资源缺少摘要：'+file);
 const res=await fetch(new Request(new URL(file,self.location.href).href,{cache:'reload'}));
 if(!res.ok)throw Error('离线资源不可用：'+file+' HTTP '+res.status);
 const bytes=await res.clone().arrayBuffer(),actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(actual!==expected)throw Error('离线资源 SHA256 不匹配：'+file);return res;
}
async function cachedAsset(file){const c=await caches.open(CACHE);const cached=await c.match(file);if(cached)return cached;const res=await verifiedFetch(file);await c.put(file,res.clone());return res}
self.addEventListener('install',e=>e.waitUntil((async()=>{
 const c=await caches.open(CACHE);
 try{for(const file of self.PF_ASSETS)await c.put(file,await verifiedFetch(file));}
 catch(err){await caches.delete(CACHE);throw err;}
 // Do not skipWaiting: running pages may still use the previous release.
})()));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('poseframe-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.includes('/models/'))return;
 const scope=new URL('./',self.location.href);if(!u.pathname.startsWith(scope.pathname))return;
 if(e.request.mode==='navigate'&&(u.pathname===scope.pathname||u.pathname===new URL('index.html',scope).pathname)){
  e.respondWith(cachedAsset('./index.html'));return;
 }
 if(u.search===REV){const clean=new URL(u.href);clean.search='';const file=ASSET_URLS.get(clean.href);if(file)e.respondWith(cachedAsset(file));return;}
 // Do not remap a different release's versioned script to this cache.
 if(u.search){const clean=new URL(u.href);clean.search='';if(u.searchParams.has('v')&&ASSET_URLS.has(clean.href))e.respondWith(Promise.reject(Error('离线资源版本不一致：'+u.pathname)));return;}
 if(!ASSET_URLS.has(u.href))return;
 e.respondWith(cachedAsset(ASSET_URLS.get(u.href)));
});
self.addEventListener('message',e=>{if(e.data?.type!=='pf-cache-status'||!e.ports[0])return;e.waitUntil((async()=>{try{const c=await caches.open(CACHE);let ok=true;for(const f of self.PF_ASSETS){if(!await c.match(f)){ok=false;break}}e.ports[0].postMessage({ok,version:self.PF_VERSION,revision:REV.slice(3)})}catch(err){e.ports[0].postMessage({ok:false})}})())});
