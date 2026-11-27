// Keep one coherent release active; never activate a partial offline cache.
importScripts('./runtime-assets.js');
const CACHE='poseframe-'+self.PF_VERSION, REV='?v=1011', ASSET_URLS=new Set(self.PF_ASSETS.map(f=>new URL(f,self.location.href).href));
self.addEventListener('install',e=>e.waitUntil((async()=>{
 const c=await caches.open(CACHE);
 try{for(const file of self.PF_ASSETS)await c.add(new Request(file,{cache:'reload'}));}
 catch(err){await caches.delete(CACHE);throw err;}
 // Do not skipWaiting: running pages may still use the previous release.
})()));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('poseframe-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.includes('/models/'))return;
 const scope=new URL('./',self.location.href);if(!u.pathname.startsWith(scope.pathname))return;
 if(e.request.mode==='navigate'&&(u.pathname===scope.pathname||u.pathname===new URL('index.html',scope).pathname)){
  // Serve the shell matching this worker; new release activates after all old tabs close.
  e.respondWith(caches.open(CACHE).then(async c=>await c.match('./index.html')||fetch(e.request)));return;
 }
 if(u.search===REV){const clean=new URL(u.href);clean.search='';e.respondWith(caches.open(CACHE).then(async c=>await c.match(clean.href)||fetch(e.request)));return;}
 // Do not remap a different release's versioned script to this cache.
 if(u.search||!ASSET_URLS.has(u.href))return;
 e.respondWith(caches.open(CACHE).then(async c=>await c.match(e.request)||fetch(e.request)));
});
self.addEventListener('message',e=>{if(e.data?.type!=='pf-cache-status'||!e.ports[0])return;e.waitUntil((async()=>{try{const c=await caches.open(CACHE);let ok=true;for(const f of self.PF_ASSETS){if(!await c.match(f)){ok=false;break}}e.ports[0].postMessage({ok,version:self.PF_VERSION})}catch(err){e.ports[0].postMessage({ok:false})}})())});
