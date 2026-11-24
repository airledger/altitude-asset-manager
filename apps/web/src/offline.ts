// Working with no signal, part 1: reading. Every successful read from the database is kept on the
// device, and when the network is down the last copy is used instead, so an engineer can still open
// today's jobs, the install and its units in a plant room with no signal.
//
// The copy lives in the browser's Cache Storage under the signed-in user's id, and is cleared on sign-out.

import { isNative } from "./native";
const CACHE = "airledger-data-v1";
const listeners = new Set<() => void>();
let usingCopy = false;

/** True while the app is showing saved copies because the network is down. */
export const showingSavedCopy = () => usingCopy;
export function onConnectionChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
function setUsingCopy(v: boolean) {
  if (usingCopy === v) return;
  usingCopy = v;
  listeners.forEach((fn) => fn());
}
// When the signal comes back, stop saying "No signal" straight away rather than waiting for the next read.
// A read that started before then and fails afterwards is old news, so it doesn't bring the message back.
let backOnlineAt = 0;
if (typeof window !== "undefined")
  window.addEventListener("online", () => {
    backOnlineAt = Date.now();
    setUsingCopy(false);
  });

/** A fetch failure caused by having no connection, rather than the server saying no. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e
        ? String((e as { message?: unknown }).message)
        : String(e);
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|internet connection/i.test(
    msg,
  );
}

const cacheKey = (req: Request) => {
  // Single-row and list reads of the same URL come back in different shapes.
  const one = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");
  return one ? `${req.url}${req.url.includes("?") ? "&" : "?"}__one=1` : req.url;
};

/** Wraps fetch for the Supabase client: keeps database reads, and falls back to them offline. */
export function cachingFetch(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init);
    const isRead = req.method === "GET" && req.url.includes("/rest/v1/");
    if (!isRead || typeof caches === "undefined") return base(req);
    const started = Date.now();
    try {
      const res = await base(req.clone());
      if (res.ok) {
        const copy = res.clone();
        void caches
          .open(CACHE)
          .then((c) => c.put(cacheKey(req), copy))
          .catch(() => undefined);
      }
      setUsingCopy(false);
      return res;
    } catch (e) {
      const saved = await caches
        .open(CACHE)
        .then((c) => c.match(cacheKey(req)))
        .catch(() => undefined);
      if (!saved) throw e;
      if (started >= backOnlineAt) setUsingCopy(true);
      return saved;
    }
  };
}

// Documents an engineer may need to read with no signal (a job's risk assessments) are kept here too.
const docKey = (fileId: string) => `${location.origin}/__saved-doc/${encodeURIComponent(fileId)}`;

/** Keeps a copy of a document on the device, unless it's already there. getUrl gives a link to download it. */
export async function keepDocument(fileId: string, getUrl: () => Promise<string>): Promise<void> {
  if (typeof caches === "undefined") return;
  const c = await caches.open(CACHE);
  if (await c.match(docKey(fileId))) return;
  const res = await fetch(await getUrl());
  if (res.ok) await c.put(docKey(fileId), res);
}

/** The copy of a document kept on this device, if there is one. */
export async function savedDocument(fileId: string): Promise<Blob | null> {
  if (typeof caches === "undefined") return null;
  const hit = await caches
    .open(CACHE)
    .then((c) => c.match(docKey(fileId)))
    .catch(() => undefined);
  return hit ? hit.blob() : null;
}

/** Forget everything saved on this device (on sign-out). */
export async function clearSavedCopies() {
  if (typeof caches !== "undefined") await caches.delete(CACHE).catch(() => false);
}

/** Registers the service worker that keeps the app itself on the device. */
export function registerAppCache() {
  // The phone apps carry their own copy of the files, so they need no service worker.
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD || isNative()) return;
  window.addEventListener(
    "load",
    () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined),
  );
}
