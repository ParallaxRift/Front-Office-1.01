// Front Office: service worker (lets the site be installed on a phone and open quickly)
// - Site code and styles (js/, css/, icons/) are saved on the phone after the first visit. Every
//   release changes their ?v= number in index.html, so a new release always loads fresh files.
// - The page itself and the data files (values, player cards) always try the network first, so
//   values are never stale; the saved copy is only used when the phone is offline.
// - Sleeper, FantasyPros and other outside requests are not touched.
const CACHE = "front-office-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const isAsset = /\/(js|css|icons)\//.test(url.pathname);
  if (isAsset){
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok){
        c.put(req, r.clone());
        // drop older versions of this same file (same path, different ?v=) so the phone's copy doesn't keep growing
        c.keys().then(keys => keys.forEach(k => { const u = new URL(k.url); if (u.pathname === url.pathname && u.search !== url.search) c.delete(k); }));
      }
      return r;
    }))));
    return;
  }
  // the page and data: network first, saved copy when offline
  e.respondWith(fetch(req).then(r => { if (r.ok && (req.mode === "navigate" || url.pathname.endsWith(".json") || url.pathname.endsWith(".html"))) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })
    .catch(() => caches.match(req).then(hit => hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error()))));   // only page visits fall back to the saved page
});
