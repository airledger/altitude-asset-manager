// Two-way calendar: each person can connect their own Google, Outlook or iCloud calendar by its private address.
// The calendar-sync server function reads it; the times they're busy show on the Schedule next to their jobs.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DiaryLink {
  id: string;
  url: string;
  show_titles: boolean;
  synced_at: string | null;
  error: string;
}
export interface DiaryStatus {
  user_id: string;
  synced_at: string | null;
  error: string;
}
export interface BusyBlock {
  id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  title: string;
}

/** The calendar services we read (the database allows only these). */
const HOSTS =
  /^https:\/\/(calendar\.google\.com|outlook\.office365\.com|outlook\.live\.com|outlook\.office\.com|p[0-9]+-caldav\.icloud\.com|p[0-9]+-calendars\.icloud\.com)\//;

/** A pasted calendar address, tidied (webcal:// is https://), or an error to show. */
export function diaryUrl(raw: string): { url: string } | { error: string } {
  const url = raw.trim().replace(/^webcals?:\/\//i, "https://");
  if (!url) return { error: "Paste your calendar's private address." };
  if (!HOSTS.test(url))
    return {
      error:
        "That doesn't look like a Google, Outlook or iCloud calendar address. Follow the steps below to copy it.",
    };
  return { url };
}

export function diaryProvider(url: string): string {
  if (url.includes("google.com")) return "Google Calendar";
  if (url.includes("icloud.com")) return "iCloud Calendar";
  return "Outlook";
}

const pad = (n: number) => String(n).padStart(2, "0");
/** The local date of a time, as YYYY-MM-DD. */
export const localDate = (t: string | Date) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** The local time of day, as HH:MM. */
export const localTime = (t: string) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Busy times that fall on a day (all-day entries cover each day up to their end). */
export function busyOn(blocks: BusyBlock[], iso: string): BusyBlock[] {
  return blocks
    .filter((b) =>
      b.all_day
        ? b.starts_at.slice(0, 10) <= iso && iso < b.ends_at.slice(0, 10)
        : localDate(b.starts_at) <= iso && iso <= localDate(new Date(Date.parse(b.ends_at) - 1)),
    )
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.starts_at.localeCompare(b.starts_at));
}

/** "All day" or "10:00–11:30". */
export function busyWhen(b: BusyBlock): string {
  return b.all_day ? "All day" : `${localTime(b.starts_at)}–${localTime(b.ends_at)}`;
}

/** Book a job in the time someone has blocked out in their calendar. */
export function jobFromBusy(b: BusyBlock, iso: string, personId: string | null): string {
  const q = new URLSearchParams({ date: iso });
  if (personId) q.set("engineer", personId);
  if (!b.all_day && localDate(b.starts_at) === iso) {
    q.set("time", localTime(b.starts_at));
    const hours = Math.round(((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 3_600_000) * 4) / 4;
    if (hours > 0 && hours <= 24) q.set("hours", String(hours));
  }
  if (b.title && b.title !== "Busy") q.set("notes", b.title);
  return `#/job/new?${q.toString()}`;
}

export function diaryApi(sb: SupabaseClient, orgId: string) {
  return {
    async mine(): Promise<DiaryLink | null> {
      const { data, error } = await sb
        .from("diary_links")
        .select("id, url, show_titles, synced_at, error")
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as DiaryLink | null) ?? null;
    },
    /** Saves the address (replacing any earlier one), then reads it straight away. */
    async connect(url: string, showTitles: boolean, existing: string | null): Promise<void> {
      const { error } = existing
        ? await sb.from("diary_links").update({ url, show_titles: showTitles }).eq("id", existing)
        : await sb.from("diary_links").insert({ org_id: orgId, url, show_titles: showTitles });
      if (error) throw new Error(error.message);
      await this.sync({ mine: true });
    },
    async disconnect(id: string): Promise<void> {
      const { error } = await sb.from("diary_links").delete().eq("id", id);
      if (error) throw new Error(error.message);
      // Clears the busy times the sync saved for this person.
      await this.sync({ mine: true }).catch(() => undefined);
    },
    async status(): Promise<DiaryStatus[]> {
      const { data, error } = await sb.rpc("diary_status", { p_org: orgId });
      if (error) throw new Error(error.message);
      return (data as DiaryStatus[] | null) ?? [];
    },
    /** Refreshes the business's calendars that haven't been read for 10 minutes (or just mine, now). */
    async sync(o: { mine?: boolean; force?: boolean } = {}): Promise<{ userId: string; error?: string }[]> {
      const { data, error } = await sb.functions.invoke("calendar-sync", { body: { orgId, ...o } });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const body = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
        throw new Error((body as { error?: string } | null)?.error || error.message);
      }
      return ((data as { synced?: { userId: string; error?: string }[] } | null)?.synced ?? []) as {
        userId: string;
        error?: string;
      }[];
    },
    async busy(fromIso: string, toIso: string): Promise<BusyBlock[]> {
      const { data, error } = await sb
        .from("busy_blocks")
        .select("id, user_id, starts_at, ends_at, all_day, title")
        .eq("org_id", orgId)
        .lt("starts_at", `${toIso}T23:59:59Z`)
        .gte("ends_at", `${fromIso}T00:00:00Z`)
        .order("starts_at");
      if (error) throw new Error(error.message);
      return (data as BusyBlock[] | null) ?? [];
    },
  };
}

export type DiaryApi = ReturnType<typeof diaryApi>;
