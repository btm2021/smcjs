// SMC.js PWA Service Worker (Fullscreen Mode)
// User requirement: DO NOT cache JavaScript files. Network-only pass-through.

const SW_VERSION = "smcjs-pwa-v1";

self.addEventListener("install", (event) => {
  // Activate immediately without waiting for old tabs to close
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Claim control of all clients immediately
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass all requests directly to network (no JS or data caching)
  event.respondWith(
    fetch(event.request).catch((err) => {
      // In case of total offline failure, log warning
      console.warn("[SW] Network request failed:", event.request.url, err);
      throw err;
    })
  );
});
