// What the iPhone and Android apps add (apps/mobile wraps this web app with Capacitor).
// On the website none of this runs: isNative() is false and every caller keeps its web behaviour.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { addDays, siteShort, formatDate } from "@airledger/domain";
import { toDomain } from "./assets";
import type { Overview } from "./overview";

interface ScannerPlugin {
  scanBarcode(o: {
    hint: number;
    scanInstructions?: string;
    scanButton?: boolean;
    scanText?: string;
    cameraDirection?: number;
    scanOrientation?: number;
  }): Promise<{ ScanResult?: string }>;
}
interface FilesystemPlugin {
  writeFile(o: { path: string; data: string; directory: string }): Promise<{ uri: string }>;
}
interface SharePlugin {
  share(o: { title?: string; files?: string[] }): Promise<unknown>;
}
export interface Reminder {
  id: number;
  title: string;
  body: string;
  schedule: { at: Date; allowWhileIdle: boolean };
  extra: { hash: string };
}
interface NotificationsPlugin {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  getPending(): Promise<{ notifications: { id: number }[] }>;
  cancel(o: { notifications: { id: number }[] }): Promise<void>;
  schedule(o: { notifications: Reminder[] }): Promise<unknown>;
  addListener(
    event: "localNotificationActionPerformed",
    fn: (a: { notification?: { extra?: { hash?: string } } }) => void,
  ): Promise<unknown>;
}
interface SplashPlugin {
  hide(): Promise<void>;
}

const Scanner = registerPlugin<ScannerPlugin>("CapacitorBarcodeScanner");
const Files = registerPlugin<FilesystemPlugin>("Filesystem");
const Share = registerPlugin<SharePlugin>("Share");
const Notes = registerPlugin<NotificationsPlugin>("LocalNotifications");
const Splash = registerPlugin<SplashPlugin>("SplashScreen");

export const isNative = () => Capacitor.isNativePlatform();

/** The web address links and QR codes should use. In the app the page itself lives at capacitor://localhost. */
export function appOrigin(): string {
  if (!isNative()) return window.location.origin;
  return (import.meta.env.VITE_APP_URL as string | undefined)?.trim() || "https://app.airledger.co.uk";
}

const cancelled = (e: unknown) =>
  /cancel/i.test(String((e as { message?: string; code?: string })?.message ?? e));

/** Opens the phone's live camera scanner. Null when the user closes it. */
export async function scanCode(): Promise<string | null> {
  try {
    const r = await Scanner.scanBarcode({
      hint: 0, // QR code
      scanInstructions: "Point at the asset label",
      scanButton: false,
      scanText: " ",
      cameraDirection: 1, // back camera
      scanOrientation: 3, // adaptive
    });
    return r?.ScanResult || null;
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error("Couldn't read the file"));
    r.readAsDataURL(blob);
  });
}

/** Phones have no downloads folder for the web view, so a file goes to the share sheet instead. */
export async function shareFile(blob: Blob, name: string): Promise<void> {
  const path = name.replace(/[^\w.-]+/g, "-");
  const w = await Files.writeFile({ path, data: await base64(blob), directory: "CACHE" });
  try {
    await Share.share({ title: path, files: [w.uri] });
  } catch (e) {
    if (!cancelled(e)) throw e;
  }
}

const NOTIFY_HOUR = 8;
const MAX_NOTES = 40;
const KEY = "al-notify-plan";

/**
 * One 8am notification on each day an install comes into its reminder window, falls due, or needs a leak
 * check. Ids are the date (20261104), so planning again replaces rather than duplicates.
 */
export function reminderPlan(o: Overview, leadDays: number, now = new Date()): Reminder[] {
  const afterHour = now.getHours() >= NOTIFY_HOUR;
  const days = new Map<string, string[]>();
  const add = (iso: string | null, line: string) => {
    if (!iso || iso < o.today || (iso === o.today && afterHour)) return;
    days.set(iso, [...(days.get(iso) ?? []), line]);
  };
  for (const s of o.sites) {
    if (s.system.inactive) continue;
    const name = [s.client?.name, s.system.name || siteShort(toDomain(s.system))].filter(Boolean).join(" · ");
    const { nextDue, booked, nextLeakCheck } = s.info;
    if (nextDue && !booked) {
      add(addDays(nextDue, -leadDays), `Service due ${formatDate(nextDue)}: ${name}`);
      add(nextDue, `Service due today: ${name}`);
    }
    add(nextLeakCheck, `F-gas leak check due: ${name}`);
  }
  return [...days.keys()]
    .sort()
    .slice(0, MAX_NOTES)
    .map((iso) => {
      const lines = days.get(iso) ?? [];
      const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
      return {
        id: Number(iso.replace(/-/g, "")),
        title: lines.length === 1 ? "Air Ledger reminder" : `${lines.length} Air Ledger reminders`,
        body: lines.slice(0, 4).join("\n") + (lines.length > 4 ? `\n+${lines.length - 4} more` : ""),
        schedule: { at: new Date(y, m - 1, d, NOTIFY_HOUR), allowWhileIdle: true },
        extra: { hash: "#/reminders" },
      };
    });
}

let asked = false;
/** Replaces the phone's scheduled reminders with a fresh plan. Does nothing on the website. */
export async function scheduleReminders(o: Overview, leadDays: number): Promise<void> {
  if (!isNative()) return;
  try {
    const want = reminderPlan(o, leadDays);
    const sig = JSON.stringify(want);
    let last: string | null = null;
    try {
      last = localStorage.getItem(KEY);
    } catch {
      /* private mode */
    }
    if (sig === last) return;
    let p = await Notes.checkPermissions();
    if (p.display !== "granted" && want.length && !asked) {
      asked = true;
      p = await Notes.requestPermissions();
    }
    if (p.display !== "granted") return;
    const pending = await Notes.getPending();
    if (pending.notifications.length)
      await Notes.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    if (want.length) await Notes.schedule({ notifications: want });
    try {
      localStorage.setItem(KEY, sig);
    } catch {
      /* private mode */
    }
  } catch (e) {
    console.warn("Reminder scheduling failed", e);
  }
}

/** Called once at start-up in the app: tapping a reminder opens Reminders, and the splash screen goes. */
export function startNative() {
  if (!isNative()) return;
  document.documentElement.classList.add("native");
  void Notes.addListener("localNotificationActionPerformed", (a) => {
    const h = a.notification?.extra?.hash;
    if (h) window.location.hash = h;
  });
  void Splash.hide().catch(() => undefined);
}
