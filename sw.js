// Nestbau Service Worker – Network-first, damit Aenderungen an index.html sofort sichtbar sind.
const CACHE = "nestbau-v3";
const ASSETS = [
  "./", "./index.html", "./manifest.json", "./icon.svg", "./oauth-callback.html",
  "./js/nb-core.js", "./js/nb-config.js", "./js/nb-oauth.js",
  "./js/nb-google-calendar.js", "./js/nb-outlook-calendar.js", "./js/nb-calendar-sync.js",
  "./js/nb-firebase.js", "./js/nb-migrate.js", "./js/nb-integrations-ui.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Nur eigene Dateien. Aufrufe an Google, Microsoft Graph und Firebase muessen
  // unberuehrt durchlaufen: sie sind auth-pflichtig, duerfen nicht im Cache
  // landen, und ein Offline-Fallback auf index.html wuerde die Sync-Logik mit
  // HTML statt JSON fuettern.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Die Callback-Seite traegt den Autorisierungscode in der Adresse – nie cachen.
  if (url.pathname.endsWith("/oauth-callback.html")) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(event.request).then((r) => {
          if (r) return r;
          // Fallback auf die App-Huelle nur fuer Seitenaufrufe, nicht fuer Skripte.
          return event.request.mode === "navigate" ? caches.match("./index.html") : Response.error();
        })
      )
  );
});
