// Customer portal emails (part 2).
//   { job: "<id>" }      from the business's app after a visit is booked, moved, cancelled or deleted: emails
//                        the client's portal users the visit, with a link to accept it or ask for another time.
//                        What was last sent is kept in portal_notices, so an unchanged save sends nothing.
//   { request: "<id>" }  from the portal after a customer asks for a visit: emails the business's owners.
// The job is read with the caller's own token, so only the business's team can trigger visit emails; a request
// email is only sent for a request the caller (a portal user of that client) made.
// Secrets: RESEND_API_KEY, optional PORTAL_FROM (default visits@airledger.co.uk).
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

const niceDate = (date: string | null, time: string | null) =>
  date
    ? new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }) + (time ? ` at ${time.slice(0, 5)}` : "")
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
  const from = Deno.env.get("PORTAL_FROM") ?? "visits@airledger.co.uk";

  async function appUrlFor(orgId: string) {
    const { data } = await admin.from("org_settings").select("app_url, email").eq("org_id", orgId).maybeSingle();
    return {
      app: String(data?.app_url || Deno.env.get("APP_URL") || "https://app.airledger.co.uk").replace(/\/+$/, ""),
      replyTo: EMAIL.test(String(data?.email ?? "")) ? String(data?.email) : undefined,
    };
  }
  async function send(to: string[], subject: string, text: string, fromName: string, replyTo?: string) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName.replace(/[<>"]/g, "")} <${from}>`,
        to,
        reply_to: replyTo,
        subject,
        text,
      }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message || "Email service error");
  }

  try {
    // ---------- a visit booked, moved or cancelled: tell the customer ----------
    if (typeof b.job === "string") {
      if (!UUID.test(b.job)) return json({ error: "Bad request" }, 400);
      const { data: job } = await sb
        .from("jobs")
        .select("id, org_id, type, status, date, time, deleted_at, systems(client_id, name, site_postcode), orgs(name)")
        .eq("id", b.job)
        .maybeSingle();
      if (!job) return json({ error: "Job not found" }, 404);
      const j = job as unknown as {
        id: string;
        org_id: string;
        type: string;
        status: string;
        date: string | null;
        time: string | null;
        deleted_at: string | null;
        systems: { client_id: string; name: string; site_postcode: string } | null;
        orgs: { name: string } | null;
      };
      const { data: users } = await admin
        .from("portal_users")
        .select("email")
        .eq("client_id", j.systems?.client_id ?? "");
      const to = [...new Set((users ?? []).map((u) => String(u.email).toLowerCase()).filter((e) => EMAIL.test(e)))];
      if (!to.length) return json({ sent: [] });
      const { data: prev } = await admin.from("portal_notices").select("fingerprint").eq("job_id", j.id).maybeSingle();
      const gone = !!j.deleted_at || j.status === "cancelled";
      const fingerprint = JSON.stringify(gone ? ["gone"] : [j.status, j.date, j.time]);
      // Only booked visits with a date, and only when something the customer sees has changed.
      if (prev?.fingerprint === fingerprint || (!prev && (gone || j.status !== "booked" || !j.date)))
        return json({ sent: [] });
      if (j.status === "completed") return json({ sent: [] });
      const { app, replyTo } = await appUrlFor(j.org_id);
      const biz = j.orgs?.name ?? "Your air conditioning engineers";
      const when = niceDate(j.date, j.time);
      const what = `${j.type}${j.systems?.name ? ` at ${j.systems.name}` : ""}`;
      const subject = gone
        ? `Visit cancelled: ${what}`
        : prev && prev.fingerprint !== JSON.stringify(["gone"])
          ? `Visit moved: ${what}, ${when}`
          : `Visit booked: ${what}, ${when}`;
      const text = gone
        ? `${biz} has cancelled this visit:\n\n${what}\n${when}\n\nIf you still need it, ask for a new one in your portal:\n${app}/#/`
        : `${biz} has booked a visit:\n\n${what}\n${when}${j.time ? "" : " (time to be confirmed)"}\n\n` +
          `Please accept it, or ask for another time, in your portal:\n${app}/#/visit/${j.id}\n\n` +
          `You can see your units, past visits and service reports there too.`;
      await send(to, subject, text, biz, replyTo);
      await admin.from("portal_notices").upsert({ job_id: j.id, fingerprint, sent_at: new Date().toISOString() });
      return json({ sent: to.map(() => "customer") });
    }

    // ---------- a customer asked for a visit: tell the business ----------
    if (typeof b.request === "string") {
      if (!UUID.test(b.request)) return json({ error: "Bad request" }, 400);
      const { data: q } = await admin
        .from("service_requests")
        .select("id, org_id, client_id, kind, message, preferred, status, job_id, created_by, clients(name), systems(name), jobs(date, time), orgs(name)")
        .eq("id", b.request)
        .maybeSingle();
      if (!q || q.created_by !== user.id) return json({ error: "Request not found" }, 404);
      const r = q as unknown as {
        org_id: string;
        kind: string;
        message: string;
        preferred: string;
        status: string;
        clients: { name: string } | null;
        systems: { name: string } | null;
        jobs: { date: string | null; time: string | null } | null;
        orgs: { name: string } | null;
      };
      const { data: owners } = await admin.from("members").select("email").eq("org_id", r.org_id).eq("role", "owner");
      const { app } = await appUrlFor(r.org_id);
      const { data: s } = await admin.from("org_settings").select("email").eq("org_id", r.org_id).maybeSingle();
      const to = [
        ...new Set(
          [...(owners ?? []).map((o) => String(o.email ?? "")), String(s?.email ?? "")]
            .map((e) => e.trim().toLowerCase())
            .filter((e) => EMAIL.test(e)),
        ),
      ].slice(0, 5);
      if (!to.length) return json({ sent: [] });
      const client = r.clients?.name ?? "A customer";
      const booked = r.status === "booked" && r.jobs?.date;
      await send(
        to,
        booked
          ? `Booked by ${client}: ${r.kind.toLowerCase()} on ${niceDate(r.jobs!.date, r.jobs!.time)}`
          : `Visit request from ${client}: ${r.kind.toLowerCase()}`,
        [
          booked
            ? `${client} has booked a ${r.kind.toLowerCase()} visit in their portal for ${niceDate(r.jobs!.date, r.jobs!.time)}. It's on the schedule with no engineer yet.`
            : `${client} has asked for a ${r.kind.toLowerCase()} visit.`,
          r.systems?.name && `Site: ${r.systems.name}`,
          r.message && `What they said: ${r.message}`,
          r.preferred && `When suits them: ${r.preferred}`,
          `\nOpen Air Ledger to book it in: ${app}/#/`,
        ]
          .filter(Boolean)
          .join("\n"),
        "Air Ledger",
      );
      return json({ sent: to.map(() => "owner") });
    }
    return json({ error: "Bad request" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Email failed" }, 502);
  }
});
