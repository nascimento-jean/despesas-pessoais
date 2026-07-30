const CACHE="despesas-pessoais-github-v10";
const ROOT="/despesas-pessoais/";
const SHELL=[ROOT,ROOT+"index.html",ROOT+"styles.css?refresh=2",ROOT+"sharing.css?v=1",ROOT+"app.js?sharing=1",ROOT+"supabase-config.js",ROOT+"manifest.webmanifest",ROOT+"icon.svg"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  const alwaysFresh=url.pathname.endsWith("/app.js")||url.pathname.endsWith("/styles.css");
  if(event.request.mode==="navigate"||alwaysFresh){
    event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match(ROOT+"index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response})));
});
