/*
 * This file is deliberately plain JavaScript so it can be shared by the
 * browser service worker and the focused Node policy tests. It is not a
 * general request cache: only the explicit allowlist below may enter Cache
 * Storage.
 */
(function attachNiaCachePolicy(scope) {
  const CACHE_PREFIX = "nia-static-";
  const CACHE_NAME = "nia-static-v1";

  const NIA_STATIC_ASSETS = new Set([
    "/icons/nia-192.png",
    "/icons/nia-512.png",
    "/icons/nia-maskable-512.png",
    "/icons/nia-apple-touch-180.png",
    "/images/nia-app-icon.png",
    "/images/nia-logo.png",
    "/images/nia-hero.png",
  ]);

  function isImmutableNextStaticAsset(url) {
    return (
      url.pathname.startsWith("/_next/static/chunks/") ||
      url.pathname.startsWith("/_next/static/media/")
    );
  }

  function classifyRequest(request, url) {
    if (request.method !== "GET" || url.origin !== scope.location.origin) {
      return null;
    }

    if (isImmutableNextStaticAsset(url)) {
      return "immutable";
    }

    return NIA_STATIC_ASSETS.has(url.pathname) ? "brand" : null;
  }

  function isSafeResponse(response) {
    const cacheControl = response.headers.get("cache-control") || "";

    return (
      response.ok &&
      !response.redirected &&
      response.type === "basic" &&
      !cacheControl.includes("no-store") &&
      !cacheControl.includes("private")
    );
  }

  function isNiaCacheName(cacheName) {
    return cacheName.startsWith(CACHE_PREFIX);
  }

  const policy = {
    CACHE_PREFIX,
    CACHE_NAME,
    classifyRequest,
    isNiaCacheName,
    isSafeResponse,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = policy;
  }

  scope.NiaCachePolicy = policy;
})(typeof self === "undefined" ? globalThis : self);
