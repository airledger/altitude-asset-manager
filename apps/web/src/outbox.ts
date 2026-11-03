// Working with no signal, part 2: writing. Completing a job, logging a contact and adding a site note
// (with photos) are saved on the device when there's no connection, then sent in order once it's back.
// Photos are uploaded first and the records that use them are updated with the real file ids.
//
// Something the server turns down (say the office cancelled the job while you were offline) stays in
// the outbox marked as failed, with the reason, so it can be retried after fixing it or thrown away.
import type { SupabaseClient } from "@supabase/supabase-js";
import { assets, type ContactLogRow, type New, type SiteRecordRow } from "./assets";
import { jobsApi, type Completion } from "./jobs";
import { isNetworkError } from "./offline";

export type OutboxItem = {
  id: string;
  orgId: string;
  createdAt: string;
  /** Shown in the outbox list, e.g. "Annual service · Harbour Dental". */
  label: string;
  error?: string;
} & (
  | { kind: "photo"; tempId: string; blob: Blob }
  | { kind: "complete"; jobId: string; completion: Completion }
  | { kind: "contact"; row: Omit<ContactLogRow, "id"> }
  | { kind: "siteRecord"; row: New<SiteRecordRow> }
);

export type NewItem = OutboxItem extends infer T
  ? T extends OutboxItem
    ? Omit<T, "id" | "createdAt" | "error">
    : never
  : never;

/** Photo ids made on the device start with this until the photo is uploaded. */
export const LOCAL_PHOTO = "local-";

// ---------- storage: IndexedDB on devices, memory where it isn't available (tests) ----------

interface Store {
  all(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
}

function memoryStore(): Store {
  const items = new Map<string, OutboxItem>();
  return {
    all: async () => [...items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    put: async (i) => void items.set(i.id, i),
    remove: async (id) => void items.delete(id),
  };
}

function idbStore(): Store {
  const open = () =>
    new Promise<IDBDatabase>((ok, fail) => {
      const r = indexedDB.open("airledger-outbox", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("items", { keyPath: "id" });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return new Promise<T>((ok, fail) => {
      const req = fn(db.transaction("items", mode).objectStore("items"));
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    }).finally(() => db.close());
  };
  return {
    all: async () =>
      ((await tx("readonly", (s) => s.getAll())) as OutboxItem[]).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
    put: async (i) => void (await tx("readwrite", (s) => s.put(i))),
    remove: async (id) => void (await tx("readwrite", (s) => s.delete(id))),
  };
}

let store: Store = typeof indexedDB === "undefined" ? memoryStore() : idbStore();
/** Tests start each case with an empty outbox. */
export const resetOutboxForTests = () => {
  store = memoryStore();
  notify();
};

// ---------- state everyone can watch ----------

let items: OutboxItem[] = [];
let sending = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
export const outboxItems = () => items;
export const outboxSending = () => sending;
export function onOutboxChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
async function refresh() {
  items = await store.all();
  notify();
}

let counter = 0;
const newId = () =>
  `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function enqueue(item: NewItem): Promise<void> {
  await store.put({ ...item, id: newId(), createdAt: new Date().toISOString() } as OutboxItem);
  await refresh();
}

/** Saves photos on the device and returns ids to use in a record until they're uploaded. */
export async function enqueuePhotos(orgId: string, label: string, blobs: Blob[]): Promise<string[]> {
  const ids: string[] = [];
  for (const blob of blobs) {
    const tempId = LOCAL_PHOTO + newId();
    await enqueue({ kind: "photo", orgId, label, tempId, blob });
    ids.push(tempId);
  }
  return ids;
}

export async function discard(id: string) {
  await store.remove(id);
  await refresh();
}

/** Is a completion for this job waiting to send? */
export const pendingCompletion = (jobId: string) =>
  items.find((i) => i.kind === "complete" && i.jobId === jobId) ?? null;

// ---------- sending ----------

const swap = (ids: string[], from: string, to: string) => ids.map((x) => (x === from ? to : x));

/** Sends everything waiting, oldest first. Stops at the first network failure and tries again later. */
export async function flush(sb: SupabaseClient): Promise<void> {
  if (sending) return;
  sending = true;
  notify();
  try {
    await refresh();
    for (const item of items) {
      if (item.error) continue;
      try {
        await send(sb, item);
        await store.remove(item.id);
      } catch (e) {
        if (isNetworkError(e)) break;
        await store.put({ ...item, error: e instanceof Error ? e.message : String(e) });
      }
      await refresh();
    }
  } finally {
    sending = false;
    await refresh();
  }
}

async function send(sb: SupabaseClient, item: OutboxItem) {
  // A record still waiting on one of its photos isn't sent before it.
  const waitingOn = (ids: string[]) => ids.some((x) => x.startsWith(LOCAL_PHOTO));
  switch (item.kind) {
    case "photo": {
      const fileId = await assets(sb, item.orgId).uploadPhoto(item.blob);
      // Point every waiting record at the uploaded photo.
      for (const other of await store.all()) {
        if (other.kind === "complete" && other.completion.photo_file_ids.includes(item.tempId))
          await store.put({
            ...other,
            completion: {
              ...other.completion,
              photo_file_ids: swap(other.completion.photo_file_ids, item.tempId, fileId),
            },
          });
        if (other.kind === "siteRecord" && other.row.photo_file_ids.includes(item.tempId))
          await store.put({
            ...other,
            row: { ...other.row, photo_file_ids: swap(other.row.photo_file_ids, item.tempId, fileId) },
          });
      }
      return;
    }
    case "complete": {
      const latest = (await store.all()).find((x) => x.id === item.id);
      const c = latest?.kind === "complete" ? latest.completion : item.completion;
      if (waitingOn(c.photo_file_ids))
        throw new Error("A photo for this job didn't upload. Retry it, or discard it first.");
      return jobsApi(sb, item.orgId).complete(item.jobId, c);
    }
    case "contact":
      return assets(sb, item.orgId).logContact(item.row);
    case "siteRecord": {
      const latest = (await store.all()).find((x) => x.id === item.id);
      const row = latest?.kind === "siteRecord" ? latest.row : item.row;
      if (waitingOn(row.photo_file_ids))
        throw new Error("A photo for this note didn't upload. Retry it, or discard it first.");
      await assets(sb, item.orgId).saveSiteRecord(row);
      return;
    }
  }
}

/** Clears an item's failure so the next send tries it again. */
export async function retry(sb: SupabaseClient, id: string) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  const { error: _gone, ...rest } = item;
  void _gone;
  await store.put(rest as OutboxItem);
  await flush(sb);
}

/**
 * Runs `online` and, if there's no connection (before or during), saves the work with `offline` instead.
 * Returns "sent" or "saved" so the screen can say which happened.
 */
export async function sendOrSave(
  online: () => Promise<unknown>,
  offline: () => Promise<void>,
): Promise<"sent" | "saved"> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    await offline();
    return "saved";
  }
  try {
    await online();
    return "sent";
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await offline();
    return "saved";
  }
}

/** Sends the outbox now, whenever the connection comes back, when the app is reopened, and every 30 s. */
export function startOutbox(sb: SupabaseClient): () => void {
  const go = () => void flush(sb);
  void refresh().then(go);
  const visible = () => document.visibilityState === "visible" && go();
  window.addEventListener("online", go);
  document.addEventListener("visibilitychange", visible);
  const timer = window.setInterval(() => items.some((i) => !i.error) && go(), 30_000);
  return () => {
    window.removeEventListener("online", go);
    document.removeEventListener("visibilitychange", visible);
    window.clearInterval(timer);
  };
}
