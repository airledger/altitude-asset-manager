// Sends a text message to a customer: "on my way" from a job, or a service-due reminder.
// Called by the app with the signed-in user's token; the business and its settings are read with that token,
// so row-level security means people can only text for their own business.
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (a Twilio number or messaging service id, used
// where a business hasn't set its own sender name or the destination doesn't allow names).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);
const UUID = /^[0-9a-f-]{36}$/i;
/** A business can send this many texts a day, so a mistake can't run up a bill. */
const DAILY_LIMIT = 300;

/** A phone number as +<country><number>; UK numbers can be typed 07…; UK landlines can't take texts. */
export function toMobile(raw: string): string | null {
  let n = raw.replace(/[\s().-]/g, "");
  if (n.startsWith("00")) n = "+" + n.slice(2);
  if (/^07\d{9}$/.test(n)) n = "+44" + n.slice(1);
  if (n.startsWith("+44")) return /^\+447\d{9}$/.test(n) ? n : null;
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID"), token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fallbackFrom = Deno.env.get("TWILIO_FROM") ?? "";
  if (!sid || !token || !fallbackFrom)
    return json({ error: "Text messages aren't set up yet. Use Open Messages for now." }, 503);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "Please sign in again" }, 401);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const orgId = clean(b.orgId, 64);
  const to = toMobile(clean(b.to, 40));
  const body = clean(b.message, 612);
  const kind = ["on_the_way", "service_due"].includes(String(b.kind)) ? String(b.kind) : "other";
  const id = (k: string) => (UUID.test(String(b[k] ?? "")) ? String(b[k]) : null);
  if (!to) return json({ error: "That isn't a mobile number that can get texts" }, 400);
  if (!body) return json({ error: "The message is empty" }, 400);

  const { data: org } = await sb.from("orgs").select("name").eq("id", orgId).maybeSingle();
  if (!org) return json({ error: "Business not found" }, 403);
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await sb.from("sms_log").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).gte("sent_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: "That's the most texts for today. Try again tomorrow." }, 429);
  const { data: settings } = await sb.from("org_settings").select("sms_sender").eq("org_id", orgId).maybeSingle();
  // Sender names work in the UK and many countries, not in the US or Canada.
  const name = String((settings as { sms_sender?: string } | null)?.sms_sender ?? "");
  const from = name && !to.startsWith("+1") ? name : fallbackFrom;

  const form = new URLSearchParams({ To: to, Body: body });
  form.set(from.startsWith("MG") ? "MessagingServiceSid" : "From", from);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const out = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok) return json({ error: out.message || "The text service didn't take it" }, 502);

  await sb.from("sms_log").insert({
    org_id: orgId, client_id: id("clientId"), job_id: id("jobId"), system_id: id("systemId"),
    kind, sent_to: to, body, provider_id: out.sid ?? "",
  });
  return json({ id: out.sid, to });
});
