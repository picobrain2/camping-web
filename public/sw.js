const CACHE = "eodicamp-cache-v7";
const PRECACHE = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isCatalogRequest(url) {
  return url.pathname.includes("/data/") && url.pathname.endsWith(".json");
}

function isAuthHelperRequest(url) {
  return url.pathname.startsWith("/__/auth") || url.pathname.startsWith("/__/firebase");
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const dest = event.request.destination;
  const url = new URL(event.request.url);

  if (!isSameOrigin(url)) return;
  if (isAuthHelperRequest(url)) return;

  // 캠핑장 목록 · Firestore 대체 JSON은 항상 네트워크
  if (isCatalogRequest(url)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  // 앱 셸: 네트워크 우선, 실패 시 캐시 (오프라인 설치 앱용)
  if (event.request.mode === "navigate" || dest === "document") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/index.html")))
    );
    return;
  }

  if (dest === "script" || dest === "style" || dest === "image" || dest === "font" || url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response && response.status === 200 && response.type === "basic") {
              const clone = response.clone();
              caches.open(CACHE).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
      )
    );
  }
});
