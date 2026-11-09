// Card payments with Stripe Connect (part 2). Each business connects its own Stripe account, so customers pay
// the business directly and Air Ledger never holds the money. Deployed without the gateway's sign-in check,
// because customers paying an invoice aren't signed in and Stripe posts its events here; owner actions check the
// caller's sign-in themselves.
//
// POST { action: "invoice", token }                    → what the pay page shows
// POST { action: "checkout", token, returnTo }         → { url } of Stripe's checkout for what's still owed
// POST { action: "connect", orgId, returnTo }  owner   → { url } of Stripe's set-up pages (makes the account first)
// POST { action: "status", orgId }             owner   → asks Stripe whether the account can take payments yet
// POST { action: "disconnect", orgId }         owner
// POST with a Stripe-Signature header                  → Stripe's events: checkout.session.completed, account.updated
//
// Secrets: STRIPE_SECRET_KEY (Air Ledger's platform key), STRIPE_WEBHOOK_SECRET (signing secret of the webhook
// for events on connected accounts, pointed at this function).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Where Stripe may send people back to: Air Ledger's own sites, the beta, and a developer's machine.
const RETURN = /^(https:\/\/([a-z0-9-]+\.)*(airledger\.co\.uk|workers\.dev)|http:\/\/localhost(:\d+)?)$/i;
const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

class Problem extends Error {}

// ---------- Stripe ----------

/** Stripe's form encoding: { a: { b: 1 } } → a[b]=1. */
export function form(o: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? form(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>, account?: string) {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new Problem("Card payments aren't set up yet (STRIPE_SECRET_KEY missing).");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(account ? { "Stripe-Account": account } : {}),
    },
    body: body ? form(body) : undefined,
  });
  const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const e = (b.error ?? {}) as { message?: string };
    throw new Problem(`Stripe: ${e.message ?? `error ${res.status}`}`);
  }
  return b as T;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Checks Stripe's signature on an event (and that it's recent), as Stripe's own libraries do. */
export async function verifySignature(body: string, header: string, secret: string, now = Date.now()) {
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const want = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return sigs.some((s) => s.length === want.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ want.charCodeAt(i)), 0) === 0);
}

// ---------- paying an invoice ----------

type PayInfo = {
  invoice_id: string;
  org_id: string;
  number: string;
  business: string;
  client: string;
  gross: number;
  paid: number;
  due: number;
  stripe_account: string | null;
  can_pay: boolean;
};

async function payInfo(token: string): Promise<PayInfo | null> {
  if (!UUID.test(token)) return null;
  const { data, error } = await admin.rpc("invoice_for_payment", { p_token: token });
  if (error) throw new Error(error.message);
  const r = (data as PayInfo[] | null)?.[0];
  return r ? { ...r, gross: Number(r.gross), paid: Number(r.paid), due: Number(r.due) } : null;
}

async function checkout(token: string, returnTo: string) {
  const p = await payInfo(token);
  if (!p) throw new Problem("This pay link isn't valid. Ask the business for a new one.");
  if (p.due <= 0) throw new Problem("This invoice is already paid. Thank you.");
  if (!p.can_pay || !p.stripe_account) throw new Problem(`${p.business} isn't taking card payments yet.`);
  const session = await stripe<{ url: string }>(
    "POST",
    "checkout/sessions",
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: Math.round(p.due * 100),
            product_data: { name: `Invoice ${p.number} from ${p.business}` },
          },
        },
      ],
      client_reference_id: p.invoice_id,
      metadata: { invoice_id: p.invoice_id, org_id: p.org_id, number: p.number },
      payment_intent_data: { description: `Invoice ${p.number}`, metadata: { invoice_id: p.invoice_id } },
      success_url: `${returnTo}/?paid=${token}`,
      cancel_url: `${returnTo}/?pay=${token}`,
    },
    p.stripe_account,
  );
  return session.url;
}

// ---------- Stripe's events ----------

type StripeEvent = { type: string; account?: string; data: { object: Record<string, unknown> } };

async function handleEvent(e: StripeEvent) {
  const o = e.data.object;
  if (e.type === "checkout.session.completed" || e.type === "checkout.session.async_payment_succeeded") {
    if (o.payment_status !== "paid") return "not paid yet";
    const meta = (o.metadata ?? {}) as Record<string, string>;
    if (!UUID.test(meta.invoice_id ?? "")) return "not ours";
    // Only count it against an invoice of the business whose Stripe account took the payment.
    const { data: inv } = await admin.from("invoices").select("org_id").eq("id", meta.invoice_id).maybeSingle();
    const { data: acct } = await admin
      .from("payment_accounts")
      .select("org_id")
      .eq("stripe_account", e.account ?? "")
      .maybeSingle();
    if (!inv || !acct || inv.org_id !== acct.org_id) return "account mismatch";
    const { error } = await admin.rpc("record_card_payment", {
      p_invoice: meta.invoice_id,
      p_session: String(o.id),
      p_amount: Number(o.amount_total ?? 0) / 100,
      p_currency: String(o.currency ?? "gbp"),
    });
    if (error) throw new Error(error.message);
    return "recorded";
  }
  if (e.type === "account.updated") {
    await admin
      .from("payment_accounts")
      .update({
        charges_enabled: !!o.charges_enabled,
        details_submitted: !!o.details_submitted,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_account", String(o.id));
    return "updated";
  }
  return "ignored";
}

// ---------- the business's Stripe account ----------

type Account = { id: string; charges_enabled: boolean; details_submitted: boolean };

async function connect(orgId: string, userId: string, email: string, returnTo: string) {
  const { data: row } = await admin.from("payment_accounts").select("stripe_account").eq("org_id", orgId).maybeSingle();
  let account = row?.stripe_account as string | undefined;
  if (!account) {
    const { data: org } = await admin.from("orgs").select("name").eq("id", orgId).maybeSingle();
    const made = await stripe<Account>("POST", "accounts", {
      type: "standard",
      country: "GB",
      email: email || undefined,
      business_profile: { name: org?.name || undefined },
      metadata: { org_id: orgId },
    });
    account = made.id;
    const { error } = await admin
      .from("payment_accounts")
      .insert({ org_id: orgId, stripe_account: account, connected_by: userId });
    if (error) throw new Error(error.message);
  }
  const link = await stripe<{ url: string }>("POST", "account_links", {
    account,
    type: "account_onboarding",
    refresh_url: `${returnTo}/?stripe=retry#/pricing`,
    return_url: `${returnTo}/?stripe=back#/pricing`,
  });
  return link.url;
}

async function refresh(orgId: string) {
  const { data: row } = await admin.from("payment_accounts").select("stripe_account").eq("org_id", orgId).maybeSingle();
  if (!row) return { connected: false, charges_enabled: false, details_submitted: false };
  const a = await stripe<Account>("GET", `accounts/${row.stripe_account}`);
  await admin
    .from("payment_accounts")
    .update({ charges_enabled: a.charges_enabled, details_submitted: a.details_submitted, updated_at: new Date().toISOString() })
    .eq("org_id", orgId);
  return { connected: true, charges_enabled: a.charges_enabled, details_submitted: a.details_submitted };
}

// ---------- requests ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Stripe's events.
  const signature = req.headers.get("Stripe-Signature");
  if (signature) {
    const body = await req.text();
    const secret = env("STRIPE_WEBHOOK_SECRET");
    if (!secret || !(await verifySignature(body, signature, secret))) return json({ error: "Bad signature" }, 400);
    try {
      return json({ ok: true, result: await handleEvent(JSON.parse(body) as StripeEvent) });
    } catch (e) {
      console.error(e);
      // Stripe tries again later.
      return json({ error: "Couldn't record it" }, 500);
    }
  }

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const returnTo = String(b.returnTo ?? "").replace(/\/+$/, "");
  try {
    // ---------- customers paying (not signed in) ----------
    if (b.action === "invoice") {
      const p = await payInfo(String(b.token ?? ""));
      if (!p) return json({ error: "This pay link isn't valid. Ask the business for a new one." }, 404);
      return json({
        number: p.number,
        business: p.business,
        client: p.client,
        total: p.gross,
        paid: p.paid,
        due: p.due,
        canPay: p.can_pay,
      });
    }
    if (b.action === "checkout") {
      if (!RETURN.test(returnTo)) return json({ error: "Bad request" }, 400);
      return json({ url: await checkout(String(b.token ?? ""), returnTo) });
    }

    // ---------- the business (owners) ----------
    const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return json({ error: "Please sign in again" }, 401);
    const orgId = String(b.orgId ?? "");
    if (!UUID.test(orgId)) return json({ error: "Bad request" }, 400);
    const { data: m } = await admin
      .from("members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (m?.role !== "owner") return json({ error: "Only business owners can set up card payments." }, 403);

    switch (b.action) {
      case "connect":
        if (!RETURN.test(returnTo)) return json({ error: "Bad request" }, 400);
        return json({ url: await connect(orgId, user.id, user.email ?? "", returnTo) });
      case "status":
        return json(await refresh(orgId));
      case "disconnect":
        await admin.from("payment_accounts").delete().eq("org_id", orgId);
        return json({ ok: true });
      default:
        return json({ error: "Bad request" }, 400);
    }
  } catch (e) {
    if (e instanceof Problem) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
