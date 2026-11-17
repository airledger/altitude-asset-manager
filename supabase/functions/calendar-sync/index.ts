// Reads each person's connected calendar (Google, Outlook or iCloud, by its private address) and saves the times
// they're busy for the next nine weeks, so the Schedule can show them next to jobs.
// Called by the app with the signed-in user's token when the Schedule opens: it checks they belong to the
// business, then refreshes that business's calendars that haven't been read in the last 10 minutes
// (or all of them, or just the caller's, when asked).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { busyTimes } from "./ics.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/i;
/** Same list as the database check: only these are ever fetched. */
const HOSTS = /^(calendar\.google\.com|outlook\.office365\.com|outlook\.live\.com|outlook\.office\.com|p[0-9]+-caldav\.icloud\.com|p[0-9]+-calendars\.icloud\.com)$/;
const FRESH_MS = 10 * 60_000;
const MAX_BYTES = 5_000_000;

async function download(url: string): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !HOSTS.test(u.hostname)) throw new Error("That isn't a calendar address we can read");
  const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
  if (!HOSTS.test(new URL(res.url).hostname)) throw new Error("The calendar sent us somewhere else");
  if (res.status === 404 || res.status === 401 || res.status === 403)
    throw new Error("The calendar address no longer works. Copy it again from your calendar app.");
  if (!res.ok) throw new Error(`The calendar service didn't answer (${res.status})`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("That calendar is too big to read");
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That address doesn't give a calendar. Use the private iCal / ICS address.");
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "Please sign in again" }, 401);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const orgId = String(b.orgId ?? "");
  if (!UUID.test(orgId)) return json({ error: "Bad request" }, 400);
  const { data: member } = await asUser.rpc("is_member", { p_org: orgId });
  if (member !== true) return json({ error: "Business not found" }, 403);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let q = admin.from("diary_links").select("id, user_id, url, show_titles, synced_at").eq("org_id", orgId);
  if (b.mine === true) q = q.eq("user_id", user.id);
  const { data: links, error } = await q;
  if (error) return json({ error: error.message }, 500);
  const now = Date.now();
  const due = (links ?? []).filter(
    (l) => b.mine === true || b.force === true || !l.synced_at || now - Date.parse(l.synced_at) > FRESH_MS,
  );
  const from = new Date(now - 24 * 3600_000), to = new Date(now + 63 * 24 * 3600_000);
  const results = await Promise.all(due.map(async (l) => {
    // Note the time first, so two people opening the Schedule together don't both read it.
    await admin.from("diary_links").update({ synced_at: new Date().toISOString() }).eq("id", l.id);
    try {
      const busy = busyTimes(await download(l.url), from, to);
      await admin.from("busy_blocks").delete().eq("org_id", orgId).eq("user_id", l.user_id);
      if (busy.length) {
        const { error: e } = await admin.from("busy_blocks").insert(busy.map((x) => ({
          ...x, org_id: orgId, user_id: l.user_id, title: l.show_titles ? x.title : "Busy",
        })));
        if (e) throw new Error(e.message);
      }
      await admin.from("diary_links").update({ error: "" }).eq("id", l.id);
      return { userId: l.user_id, busy: busy.length };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin.from("diary_links").update({ error: message.slice(0, 300) }).eq("id", l.id);
      return { userId: l.user_id, error: message };
    }
  }));
  return json({ synced: results });
});
