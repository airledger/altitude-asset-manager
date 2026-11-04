// Puts a booked job straight into the engineer's own calendar by emailing them a calendar invite.
// Apple Calendar, Google Calendar and Outlook all add invites by themselves, so engineers set nothing up.
// The app calls this after a job is booked, changed, moved, cancelled or deleted, with { job: "<id>" }.
// The job is read with the caller's token, so row-level security means only the business's own team can
// trigger it. What was last sent is kept in job_invites (service key only), so:
//   - a change to the date, time, place or details sends an update (same UID, higher SEQUENCE);
//   - giving the job to someone else cancels it in the old engineer's calendar and invites the new one;
//   - cancelling or deleting the job removes it from the calendar;
//   - saving with nothing that shows in the calendar changed sends nothing.
// Secrets: RESEND_API_KEY (required), INVITE_FROM (optional, default jobs@airledger.co.uk).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

type Job = {
  id: string;
  org_id: string;
  type: string;
  status: string;
  date: string | null;
  time: string | null;
  duration_hrs: number | null;
  notes: string;
  deleted_at: string | null;
  people: { name: string; email: string } | null;
  systems: {
    name: string;
    site_address: string;
    site_postcode: string;
    access_notes: string;
    clients: { name: string; phone: string; contact_name: string } | null;
  } | null;
  orgs: { name: string } | null;
};
type Sent = { job_id: string; email: string; sequence: number; fingerprint: string; cancelled: boolean };

/** iCalendar text escaping, and lines folded at 74 characters as the standard asks. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** A UK wall-clock date and time as the real moment, allowing for British Summer Time. */
function londonToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(guess);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const offsetHrs = (h - hh + 24) % 24; // 0 in winter, 1 in summer
  return new Date(guess.getTime() - offsetHrs * 3600_000);
}

function details(j: Job, appUrl: string) {
  const s = j.systems;
  const client = s?.clients?.name ?? "";
  const where = [s?.site_address, s?.site_postcode].filter(Boolean).join(", ");
  const lines = [
    s?.name,
    s?.clients?.contact_name && `Contact: ${s.clients.contact_name}${s.clients.phone ? `, ${s.clients.phone}` : ""}`,
    s?.access_notes && `Access: ${s.access_notes}`,
    j.notes,
    `Open in Air Ledger: ${appUrl}/#/job/${j.id}`,
  ].filter(Boolean) as string[];
  return { summary: `${j.type}${client ? ` · ${client}` : ""}`, where, description: lines.join("\n") };
}

function ics(method: "REQUEST" | "CANCEL", j: Job, seq: number, to: string, from: string, appUrl: string) {
  const { summary, where, description } = details(j, appUrl);
  const when =
    j.date && j.time
      ? (() => {
          const start = londonToUtc(j.date, j.time);
          const mins = Math.max(15, Math.round((Number(j.duration_hrs) || 1) * 60));
          return [`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + mins * 60_000))}`];
        })()
      : j.date
        ? (() => {
            const d = j.date.replace(/-/g, "");
            const next = new Date(j.date + "T00:00:00Z");
            next.setUTCDate(next.getUTCDate() + 1);
            return [`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`];
          })()
        : [`DTSTART;VALUE=DATE:${stamp(new Date()).slice(0, 8)}`];
  const org = j.orgs?.name ?? "Air Ledger";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Air Ledger//Job invites//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${j.id}@airledger.co.uk`,
    `SEQUENCE:${seq}`,
    `DTSTAMP:${stamp(new Date())}`,
    ...when,
    `SUMMARY:${esc(summary)}`,
    `LOCATION:${esc(where)}`,
    `DESCRIPTION:${esc(description)}`,
    `URL:${appUrl}/#/job/${j.id}`,
    `ORGANIZER;CN=${esc(org)}:mailto:${from}`,
    `ATTENDEE;CN=${esc(j.people?.name || to)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${to}`,
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .map(fold)
    .join("\r\n");
}

const niceDate = (j: Job) =>
  j.date
    ? new Date(j.date + "T12:00:00Z").toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }) + (j.time ? ` ${j.time.slice(0, 5)}` : "")
    : "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ error: "Email isn't set up yet (RESEND_API_KEY missing)" }, 503);
  const url = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return json({ error: "Please sign in again" }, 401);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const id = String(b.job ?? "");
  if (!UUID.test(id)) return json({ error: "Bad request" }, 400);

  // Through row-level security: fails unless the caller is in the job's business.
  const { data: job, error } = await sb
    .from("jobs")
    .select(
      "id, org_id, type, status, date, time, duration_hrs, notes, deleted_at, people(name, email), " +
        "systems(name, site_address, site_postcode, access_notes, clients(name, phone, contact_name)), orgs(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !job) return json({ error: "Job not found" }, 404);
  const j = job as unknown as Job;

  const { data: settings } = await admin.from("org_settings").select("app_url").eq("org_id", j.org_id).maybeSingle();
  const appUrl = String(settings?.app_url || Deno.env.get("APP_URL") || "https://app.airledger.co.uk").replace(/\/+$/, "");
  const from = Deno.env.get("INVITE_FROM") ?? "jobs@airledger.co.uk";
  const org = (j.orgs?.name ?? "Air Ledger").replace(/[<>"]/g, "");

  const { data: prev } = await admin.from("job_invites").select("*").eq("job_id", id).maybeSingle();
  const last = prev as Sent | null;
  const email = (j.people?.email ?? "").trim().toLowerCase();
  const wanted = !j.deleted_at && j.status !== "cancelled" && !!j.date && EMAIL.test(email);
  const fingerprint = JSON.stringify([j.date, j.time, j.duration_hrs, details(j, appUrl)]);

  async function send(method: "REQUEST" | "CANCEL", to: string, seq: number) {
    const body = ics(method, j, seq, to, from, appUrl);
    const { summary, where } = details(j, appUrl);
    const verb = method === "CANCEL" ? "Cancelled" : last && last.email === to && !last.cancelled ? "Changed" : "New job";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${org} <${from}>`,
        to: [to],
        reply_to: user!.email && EMAIL.test(user!.email) ? user!.email : undefined,
        subject: `${verb}: ${summary}${niceDate(j) ? ` · ${niceDate(j)}` : ""}`,
        text:
          (method === "CANCEL"
            ? "This job has been cancelled or moved to someone else, so it's been taken out of your calendar.\n\n"
            : "This job is in your calendar. If it changes, your calendar updates by itself.\n\n") +
          [summary, niceDate(j), where].filter(Boolean).join("\n") +
          `\n\n${appUrl}/#/job/${j.id}`,
        attachments: [
          {
            filename: method === "CANCEL" ? "cancel.ics" : "invite.ics",
            content: btoa(unescape(encodeURIComponent(body))),
            content_type: `text/calendar; charset=utf-8; method=${method}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message || "Email service error");
  }

  let seq = last?.sequence ?? 0;
  let state = last ? { email: last.email, cancelled: last.cancelled } : null;
  const sent: string[] = [];
  try {
    // Out of the old calendar: cancelled, deleted, unassigned, or given to someone else.
    if (last && !last.cancelled && (!wanted || last.email !== email)) {
      seq += 1;
      await send("CANCEL", last.email, seq);
      state = { email: last.email, cancelled: true };
      sent.push(`cancel ${last.email}`);
    }
    if (wanted && (!last || last.cancelled || last.email !== email || last.fingerprint !== fingerprint)) {
      seq += 1;
      await send("REQUEST", email, seq);
      state = { email, cancelled: false };
      sent.push(`invite ${email}`);
    }
  } finally {
    if (sent.length && state) {
      await admin.from("job_invites").upsert({
        job_id: id,
        org_id: j.org_id,
        ...state,
        sequence: seq,
        fingerprint,
        sent_at: new Date().toISOString(),
      });
    }
  }
  return json({ sent });
});
