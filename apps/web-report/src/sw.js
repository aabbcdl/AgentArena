const CACHE_NAME = "agentarena-report-v9";
const serviceWorker = /** @type {typeof globalThis & { clients: { claim(): Promise<void> }, skipWaiting(): void | Promise<void> }} */ (globalThis);
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./view-model.js",
  "./i18n.js",
  "./styles.css",
  "./icon.svg",
  "./manifest.json",
  "./trace-replay.js",
  "./trace-replay-bridge.js",
  "./launcher/module.js",
  "./report/dashboard.js",
  "./report/cross-run.js",
  "./report/detail-fragments.js",
  "./results/loaders.js"
];

// Install: cache all core assets
serviceWorker.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Use Promise.allSettled to not fail the entire install if some assets fail
      const results = await Promise.allSettled(
        CORE_ASSETS.map((url) => cache.add(url))
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.warn(`SW: ${failures.length} assets failed to cache:`, failures.map((r) => r.reason));
      }
    })
  );
});

// Activate: delete old caches
serviceWorker.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => serviceWorker.clients.claim())
  );
});

// Fetch: network-first for HTML/JS, cache-first for static assets
serviceWorker.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip API requests
  if (url.pathname.startsWith("/api/")) return;

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // For HTML, JS, CSS, and manifest, use network-first strategy so local UI changes
  // become visible immediately instead of waiting for a cache-first asset refresh.
  const isNavigational = event.request.destination === "document";
  const isScript = event.request.destination === "script";
  const isStyle = event.request.destination === "style";
  const isManifest = url.pathname.endsWith("/manifest.json") || url.pathname.endsWith("manifest.json");

  if (isNavigational || isScript || isStyle || isManifest) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => (await caches.match(event.request)) ?? caches.match("./index.html"))
    );
    return;
  }

  // For static assets (CSS, images, etc.), use cache-first strategy
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// Update notification: notify clients when a new version is available
serviceWorker.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    serviceWorker.skipWaiting();
  }
});
