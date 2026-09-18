const CACHE = "eodicamp-cache-v4";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

function isCatalogRequest(url) {
  return url.pathname.includes("/data/") && url.pathname.endsWith(".json");
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const dest = event.request.destination;
  const url = new URL(event.request.url);

  // 캠핑장 목록은 항상 네트워크만 사용 (캐시 때문에 신규 검색 실패 방지)
  if (isCatalogRequest(url)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  if (event.request.mode === "navigate" || dest === "document" || dest === "script") {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
