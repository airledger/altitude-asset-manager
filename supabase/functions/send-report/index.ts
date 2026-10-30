// Emails a signed service report PDF to the client, with the office copied.
// Called by the app (service-report.js) with the signed-in user's token. The PDF is read with
// that token, so storage rules mean a user can only send their own business's reports.
// Secrets: RESEND_API_KEY (required), REPORT_FROM (optional, default reports@airledger.co.uk).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ error: "Email isn't set up yet (RESEND_API_KEY missing)" }, 503);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "Please sign in again" }, 401);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const orgId = clean(b.orgId, 64), pdf = clean(b.pdf, 200);
  const to = (Array.isArray(b.to) ? b.to : []).map((x) => clean(x, 200)).filter(Boolean);
  const cc = (Array.isArray(b.cc) ? b.cc : []).map((x) => clean(x, 200)).filter(Boolean);
  if (!to.length || to.length + cc.length > 5 || ![...to, ...cc].every((e) => EMAIL.test(e)))
    return json({ error: "Check the email addresses" }, 400);
  if (!pdf.startsWith(orgId + "/") || !pdf.endsWith(".pdf")) return json({ error: "Not a report" }, 400);

  // Both reads go through row-level security, so they fail unless the user belongs to this business.
  const { data: org } = await sb.from("orgs").select("name").eq("id", orgId).maybeSingle();
  if (!org) return json({ error: "Business not found" }, 403);
  const { data: file, error } = await sb.storage.from("photos").download(pdf);
  if (error || !file) return json({ error: "Couldn't read the report" }, 403);

  const replyTo = clean(b.replyTo, 200);
  const from = Deno.env.get("REPORT_FROM") ?? "reports@airledger.co.uk";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${clean(org.name, 80).replace(/[<>"]/g, "")} <${from}>`,
      to, cc: cc.length ? cc : undefined,
      reply_to: EMAIL.test(replyTo) ? replyTo : undefined,
      subject: clean(b.subject, 200) || "Your service report",
      text: String(b.message ?? "").slice(0, 5000),
      attachments: [{ filename: clean(b.filename, 120).replace(/[^\w.-]/g, "-") || "service-report.pdf", content: encodeBase64(new Uint8Array(await file.arrayBuffer())) }],
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: (out as { message?: string }).message || "Email service error" }, 502);
  return json({ id: (out as { id?: string }).id, sentBy: user.email });
});
