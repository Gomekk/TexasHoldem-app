// ネットワーク優先（更新がすぐ反映される）。オフライン時だけキャッシュを使う
const CACHE = "poker-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase等は素通し
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: "no-store" });
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
