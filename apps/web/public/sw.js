// Keeps Air Ledger itself on the device so it opens with no signal. Pages load from the network when
// there is one (so updates arrive straight away) and from the saved copy when there isn't. The app's
// files have unique names per release, so they're saved the first time they load. Database reads are
// saved separately by the app (src/offline.ts); calendar links (/cal/) always go to the network.
const VERSION = "v1";
const APP = `airledger-app-${VERSION}`;
const START = ["/", "/manifest.webmanifest", "/icon-192.png", "/logo-reverse.svg", "/favicon-32.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(APP)
      .then((c) => c.addAll(START))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("airledger-app-") && k !== APP).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const save = (req, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(APP).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const fonts = url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com";
  if (url.origin !== self.location.origin && !fonts) return;
  if (url.pathname.startsWith("/cal/")) return;

  // Pages: network first, the saved app when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => save(new Request("/"), res))
        .catch(() => caches.match("/")),
    );
    return;
  }
  // Release files and fonts never change once published: saved copy first.
  if (url.pathname.startsWith("/assets/") || fonts) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => save(req, res))));
    return;
  }
  // Icons and the rest: network, falling back to the saved copy.
  e.respondWith(
    fetch(req)
      .then((res) => save(req, res))
      .catch(() => caches.match(req)),
  );
});
