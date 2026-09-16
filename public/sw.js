/* global NiaCachePolicy */
importScripts("/sw-policy.js");

const { CACHE_NAME, classifyRequest, isNiaCacheName, isSafeResponse } = NiaCachePolicy;

async function cacheResponse(request, response) {
  if (isSafeResponse(response)) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }

  return response;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  return cached || cacheResponse(request, await fetch(request));
}

async function networkFirst(request) {
  try {
    return await cacheResponse(request, await fetch(request));
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    if (cached) {
      return cached;
    }

    throw new Error("NIA static asset is unavailable offline.");
  }
}

self.addEventListener("install", () => {
  // No hardcoded build chunk list and no skipWaiting: old tabs finish with the
  // worker they started with, avoiding an old-HTML/new-chunk mismatch.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => isNiaCacheName(cacheName) && cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName)),
        ),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const classification = classifyRequest(event.request, url);

  // All navigations, RSC/Flight traffic, APIs, authentication, and every
  // mutation fall through to the browser's normal network behavior.
  if (!classification) {
    return;
  }

  event.respondWith(
    classification === "immutable" ? cacheFirst(event.request) : networkFirst(event.request),
  );
});
