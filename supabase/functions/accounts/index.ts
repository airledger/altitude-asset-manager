// Live accounts sync with Xero and QuickBooks Online (part 2). One function, deployed without the gateway's
// sign-in check because Xero and Intuit send the browser back here (GET) after the owner approves; every POST
// checks the caller's sign-in itself and that they own the business.
//
// POST { action: "connect", orgId, system, returnTo }  → { url } to send the owner to Xero/Intuit
// GET  ?code&state[&realmId]                          → stores the connection, sends the browser back to the app
// POST { action: "sync", orgId, invoices?: [ids] }     → sends those invoices (and their customers) across, then
//                                                        brings back what's been paid on invoices already sent
// POST { action: "disconnect", orgId }
//
// Tokens are encrypted (AES-GCM) before they're stored, and only this function can read the table.
// Secrets: XERO_CLIENT_ID, XERO_CLIENT_SECRET, QB_CLIENT_ID, QB_CLIENT_SECRET, optional QB_ENV=sandbox,
// optional ACCOUNTS_TOKEN_KEY (otherwise a key is derived from the service key).
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  apiError,
  contactName,
  qbCustomer,
  qbInvoice,
  qbPaid,
  qbQuote,
  xeroContact,
  xeroInvoice,
  xeroPaid,
  type Paid,
  type SyncClient,
  type SyncInvoice,
  type SyncSettings,
  type System,
} from "./map.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const REDIRECT = `${SUPABASE_URL}/functions/v1/accounts`;
const admin = createClient(SUPABASE_URL, env("SUPABASE_SERVICE_ROLE_KEY"));

class Problem extends Error {}

// ---------- providers ----------

const PROVIDER = {
  xero: {
    label: "Xero",
    id: () => env("XERO_CLIENT_ID"),
    secret: () => env("XERO_CLIENT_SECRET"),
    authorize: "https://login.xero.com/identity/connect/authorize",
    token: "https://identity.xero.com/connect/token",
    revoke: "https://identity.xero.com/connect/revocation",
    // Granular scopes: apps made after 2 March 2026 can't ask for the old broad ones.
    scope: "offline_access accounting.contacts accounting.invoices",
  },
  quickbooks: {
    label: "QuickBooks",
    id: () => env("QB_CLIENT_ID"),
    secret: () => env("QB_CLIENT_SECRET"),
    authorize: "https://appcenter.intuit.com/connect/oauth2",
    token: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    revoke: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
    scope: "com.intuit.quickbooks.accounting",
  },
} as const;
const qbBase = () =>
  env("QB_ENV") === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";

type Tokens = { access: string; refresh: string };

async function tokenRequest(system: System, form: Record<string, string>) {
  const p = PROVIDER[system];
  const res = await fetch(p.token, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${p.id()}:${p.secret()}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form),
  });
  const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof b.access_token !== "string")
    throw new Problem(`${p.label} sign-in failed (${String(b.error ?? res.status)}). Connect again.`);
  return {
    tokens: { access: b.access_token, refresh: String(b.refresh_token ?? "") } as Tokens,
    expiresAt: new Date(Date.now() + (Number(b.expires_in) || 1800) * 1000),
  };
}

// ---------- token encryption ----------

let keyPromise: Promise<CryptoKey> | null = null;
function key() {
  keyPromise ??= (async () => {
    const raw = env("ACCOUNTS_TOKEN_KEY") || `accounts-tokens:${env("SUPABASE_SERVICE_ROLE_KEY")}`;
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  })();
  return keyPromise;
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function seal(t: Tokens): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(t)));
  return `${b64(iv)}.${b64(new Uint8Array(data))}`;
}
async function open(s: string): Promise<Tokens> {
  const [iv, data] = s.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(data));
  return JSON.parse(new TextDecoder().decode(plain)) as Tokens;
}

// ---------- the connection ----------

type Connection = {
  org_id: string;
  system: System;
  tenant_id: string;
  tenant_name: string;
  tokens: string;
  expires_at: string;
};

/** A working access token, refreshing it (and storing the new refresh token) when it's about to run out. */
async function accessFor(c: Connection): Promise<string> {
  const t = await open(c.tokens);
  if (new Date(c.expires_at).getTime() - Date.now() > 60_000) return t.access;
  const { tokens, expiresAt } = await tokenRequest(c.system, { grant_type: "refresh_token", refresh_token: t.refresh });
  if (!tokens.refresh) tokens.refresh = t.refresh;
  await admin
    .from("accounts_connections")
    .update({ tokens: await seal(tokens), expires_at: expiresAt.toISOString() })
    .eq("org_id", c.org_id);
  return tokens.access;
}

/** Calls the accounts system's API, turning its error replies into a readable reason. */
function apiFor(c: Connection, access: string) {
  return async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url =
      c.system === "xero"
        ? `https://api.xero.com/api.xro/2.0/${path}`
        : `${qbBase()}/v3/company/${c.tenant_id}/${path}${path.includes("?") ? "&" : "?"}minorversion=75`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${access}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(c.system === "xero" ? { "xero-tenant-id": c.tenant_id } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) throw new Problem(apiError(c.system, res.status, b));
    return b as T;
  };
}

// ---------- connect ----------

async function startConnect(orgId: string, userId: string, system: System, returnTo: string) {
  const p = PROVIDER[system];
  if (!p.id() || !p.secret())
    throw new Problem(`${p.label} isn't set up on this server yet (its developer app keys are missing).`);
  const state = crypto.randomUUID() + crypto.randomUUID().slice(0, 8);
  await admin.from("accounts_oauth_states").delete().lt("created_at", new Date(Date.now() - 3600_000).toISOString());
  const { error } = await admin
    .from("accounts_oauth_states")
    .insert({ state, org_id: orgId, user_id: userId, system, return_to: returnTo });
  if (error) throw new Problem(error.message);
  const q = new URLSearchParams({
    response_type: "code",
    client_id: p.id(),
    redirect_uri: REDIRECT,
    scope: p.scope,
    state,
  });
  return `${p.authorize}?${q}`;
}

async function finishConnect(url: URL): Promise<Response> {
  const state = url.searchParams.get("state") ?? "";
  const { data: st } = await admin.from("accounts_oauth_states").select("*").eq("state", state).maybeSingle();
  if (st) await admin.from("accounts_oauth_states").delete().eq("state", state);
  const back = (msg: string) => {
    const base = String(st?.return_to || env("APP_URL") || "https://app.airledger.co.uk").replace(/#.*$/, "");
    return Response.redirect(`${base}#/pricing?accounts=${encodeURIComponent(msg)}`, 302);
  };
  if (!st || Date.now() - new Date(st.created_at).getTime() > 3600_000) return back("expired");
  if (url.searchParams.get("error")) return back("declined");
  const system = st.system as System;
  try {
    const { tokens, expiresAt } = await tokenRequest(system, {
      grant_type: "authorization_code",
      code: url.searchParams.get("code") ?? "",
      redirect_uri: REDIRECT,
    });
    let tenantId = "";
    let tenantName = "";
    if (system === "xero") {
      const res = await fetch("https://api.xero.com/connections", {
        headers: { Authorization: `Bearer ${tokens.access}`, Accept: "application/json" },
      });
      const list = (await res.json().catch(() => [])) as { tenantId: string; tenantName: string; tenantType: string; updatedDateUtc?: string }[];
      // The organisation just approved is the most recently updated one.
      const orgs = list
        .filter((t) => t.tenantType === "ORGANISATION")
        .sort((a, b) => String(b.updatedDateUtc ?? "").localeCompare(String(a.updatedDateUtc ?? "")));
      if (!orgs[0]) return back("no-organisation");
      tenantId = orgs[0].tenantId;
      tenantName = orgs[0].tenantName;
    } else {
      tenantId = url.searchParams.get("realmId") ?? "";
      if (!tenantId) return back("no-organisation");
      const res = await fetch(`${qbBase()}/v3/company/${tenantId}/companyinfo/${tenantId}?minorversion=75`, {
        headers: { Authorization: `Bearer ${tokens.access}`, Accept: "application/json" },
      });
      const b = (await res.json().catch(() => ({}))) as { CompanyInfo?: { CompanyName?: string } };
      tenantName = b.CompanyInfo?.CompanyName ?? "";
    }
    const { data: prev } = await admin
      .from("accounts_connections")
      .select("system, tenant_id")
      .eq("org_id", st.org_id)
      .maybeSingle();
    // A different company: customer ids from the old one mean nothing there.
    if (prev && (prev.system !== system || prev.tenant_id !== tenantId))
      await admin
        .from("client_billing")
        .update({ external_system: null, external_id: null })
        .eq("org_id", st.org_id);
    const { error } = await admin.from("accounts_connections").upsert({
      org_id: st.org_id,
      system,
      tenant_id: tenantId,
      tenant_name: tenantName,
      tokens: await seal(tokens),
      expires_at: expiresAt.toISOString(),
      connected_by: st.user_id,
      connected_at: new Date().toISOString(),
      last_error: "",
    });
    if (error) throw new Problem(error.message);
    // Remember which accounts software the business uses, so exports and the Invoices page match.
    await admin.from("org_settings").update({ accounts_app: system }).eq("org_id", st.org_id);
    return back("connected");
  } catch (e) {
    console.error("connect failed", e);
    return back("failed");
  }
}

async function disconnect(orgId: string) {
  const { data } = await admin.from("accounts_connections").select("*").eq("org_id", orgId).maybeSingle();
  if (!data) return;
  const c = data as Connection;
  try {
    const t = await open(c.tokens);
    const p = PROVIDER[c.system];
    await fetch(p.revoke, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${p.id()}:${p.secret()}`)}`,
        "Content-Type": c.system === "xero" ? "application/x-www-form-urlencoded" : "application/json",
        Accept: "application/json",
      },
      body: c.system === "xero" ? new URLSearchParams({ token: t.refresh }) : JSON.stringify({ token: t.refresh }),
    });
  } catch (e) {
    console.warn("revoke failed", e);
  }
  await admin.from("accounts_connections").delete().eq("org_id", orgId);
  await admin.from("client_billing").update({ external_system: null, external_id: null }).eq("org_id", orgId);
}

// ---------- sync ----------

type InvoiceRow = SyncInvoice & {
  id: string;
  client_id: string;
  external_id: string | null;
  external_system: string | null;
  invoice_lines: SyncInvoice["lines"];
};

async function sync(orgId: string, ids: string[]) {
  const { data } = await admin.from("accounts_connections").select("*").eq("org_id", orgId).maybeSingle();
  if (!data) throw new Problem("Connect Xero or QuickBooks first, from Prices and accounts.");
  const c = data as Connection;
  const label = PROVIDER[c.system].label;
  const call = apiFor(c, await accessFor(c));
  const { data: s } = await admin
    .from("org_settings")
    .select("xero_account_code, qb_item, qb_tax_code")
    .eq("org_id", orgId)
    .maybeSingle();
  const settings = (s ?? { xero_account_code: "200", qb_item: "Services", qb_tax_code: "20.0% S" }) as SyncSettings;

  const errors: { number: string; error: string }[] = [];
  let sent = 0;

  // QuickBooks needs its own ids for the product/service and the VAT codes; looked up once.
  let qbRefs: { itemId: string; vatCodeId: string; noVatCodeId: string } | null = null;
  async function refs() {
    if (qbRefs) return qbRefs;
    type Q = { QueryResponse: { Item?: { Id: string }[]; TaxCode?: { Id: string; Name: string }[] } };
    const item = await call<Q>("GET", `query?query=${encodeURIComponent(`select Id from Item where Name = ${qbQuote(settings.qb_item || "Services")}`)}`);
    const codes = await call<Q>("GET", `query?query=${encodeURIComponent("select Id, Name from TaxCode where Active = true")}`);
    const itemId = item.QueryResponse.Item?.[0]?.Id;
    if (!itemId)
      throw new Problem(`QuickBooks has no product or service called "${settings.qb_item}". Add it there, or change the name in Prices and accounts.`);
    const byName = new Map((codes.QueryResponse.TaxCode ?? []).map((t) => [t.Name.toLowerCase(), t.Id]));
    const vatCodeId = byName.get((settings.qb_tax_code || "20.0% S").toLowerCase());
    const noVatCodeId = byName.get("no vat") ?? byName.get("exempt") ?? byName.get("0.0% z");
    if (!vatCodeId || !noVatCodeId)
      throw new Problem(`QuickBooks has no VAT code called "${settings.qb_tax_code}". Check the VAT code in Prices and accounts.`);
    qbRefs = { itemId, vatCodeId, noVatCodeId };
    return qbRefs;
  }

  /** The customer's id in the accounts: remembered, found by name, or created. */
  async function customerId(clientId: string): Promise<string> {
    const [{ data: cl }, { data: bill }] = await Promise.all([
      admin.from("clients").select("name, email, billing_address, postcode, contact_name, phone").eq("id", clientId).eq("org_id", orgId).single(),
      admin.from("client_billing").select("accounts_name, external_system, external_id").eq("client_id", clientId).maybeSingle(),
    ]);
    if (!cl) throw new Problem("Client not found");
    if (bill?.external_system === c.system && bill.external_id) return bill.external_id;
    const client = { ...cl, accounts_name: bill?.accounts_name ?? "" } as SyncClient;
    const name = contactName(client);
    let id = "";
    if (c.system === "xero") {
      const found = await call<{ Contacts: { ContactID: string; Name: string }[] }>(
        "GET",
        `Contacts?where=${encodeURIComponent(`Name=="${name.replace(/"/g, '\\"')}"`)}`,
      );
      id = found.Contacts?.[0]?.ContactID ?? "";
      if (!id) {
        const made = await call<{ Contacts: { ContactID: string }[] }>("POST", "Contacts", { Contacts: [xeroContact(client)] });
        id = made.Contacts[0].ContactID;
      }
    } else {
      const body = qbCustomer(client);
      const found = await call<{ QueryResponse: { Customer?: { Id: string }[] } }>(
        "GET",
        `query?query=${encodeURIComponent(`select Id from Customer where DisplayName = ${qbQuote(body.DisplayName)}`)}`,
      );
      id = found.QueryResponse.Customer?.[0]?.Id ?? "";
      if (!id) id = (await call<{ Customer: { Id: string } }>("POST", "customer", body)).Customer.Id;
    }
    if (bill)
      await admin.from("client_billing").update({ external_system: c.system, external_id: id }).eq("client_id", clientId);
    else
      await admin
        .from("client_billing")
        .insert({ client_id: clientId, org_id: orgId, external_system: c.system, external_id: id });
    return id;
  }

  if (ids.length) {
    const { data: list } = await admin
      .from("invoices")
      .select("id, number, client_id, date, due_date, reference, vat_rate, external_id, external_system, invoice_lines(position, description, qty, unit_price)")
      .eq("org_id", orgId)
      .in("id", ids.slice(0, 100));
    for (const inv of (list ?? []) as InvoiceRow[]) {
      if (inv.external_id && inv.external_system === c.system) continue;
      const invoice = { ...inv, lines: inv.invoice_lines };
      try {
        const cid = await customerId(inv.client_id);
        let externalId = "";
        if (c.system === "xero") {
          const r = await call<{ Invoices: { InvoiceID: string }[] }>("POST", "Invoices", {
            Invoices: [xeroInvoice(invoice, cid, settings)],
          });
          externalId = r.Invoices[0].InvoiceID;
        } else {
          externalId = (await call<{ Invoice: { Id: string } }>("POST", "invoice", qbInvoice(invoice, cid, await refs()))).Invoice.Id;
        }
        const now = new Date().toISOString();
        await admin
          .from("invoices")
          .update({ external_system: c.system, external_id: externalId, sync_status: "synced", synced_at: now, sync_error: "", status: "exported", exported_at: now })
          .eq("id", inv.id);
        sent++;
      } catch (e) {
        const error = e instanceof Problem ? e.message : `Couldn't reach ${label}.`;
        if (!(e instanceof Problem)) console.error("sync failed", e);
        errors.push({ number: inv.number, error });
        await admin.from("invoices").update({ sync_status: "failed", sync_error: error }).eq("id", inv.id);
      }
    }
  }

  // What's been paid, on invoices already sent and not yet fully paid.
  let paid = 0;
  const { data: open } = await admin
    .from("invoices")
    .select("id, external_id")
    .eq("org_id", orgId)
    .eq("external_system", c.system)
    .not("external_id", "is", null)
    .is("paid_at", null)
    .order("date", { ascending: false })
    .limit(100);
  const outstanding = (open ?? []) as { id: string; external_id: string }[];
  if (outstanding.length) {
    const byExt = new Map(outstanding.map((o) => [o.external_id, o.id]));
    const found = new Map<string, Paid>();
    if (c.system === "xero") {
      const r = await call<{ Invoices: { InvoiceID: string; Status: string; AmountPaid: number; FullyPaidOnDate?: string }[] }>(
        "GET",
        `Invoices?IDs=${outstanding.map((o) => o.external_id).join(",")}&summaryOnly=true`,
      );
      for (const x of r.Invoices ?? []) found.set(x.InvoiceID, xeroPaid(x));
    } else {
      const q = `select Id, TotalAmt, Balance, MetaData from Invoice where Id in (${outstanding.map((o) => qbQuote(o.external_id)).join(", ")})`;
      const r = await call<{ QueryResponse: { Invoice?: { Id: string; TotalAmt: number; Balance: number }[] } }>(
        "GET",
        `query?query=${encodeURIComponent(q)}`,
      );
      for (const x of r.QueryResponse.Invoice ?? []) found.set(x.Id, qbPaid(x));
    }
    for (const [ext, p] of found) {
      const id = byExt.get(ext);
      if (!id || (!p.amountPaid && !p.paidOn)) continue;
      await admin.from("invoices").update({ amount_paid: p.amountPaid, paid_at: p.paidOn }).eq("id", id);
      if (p.paidOn) paid++;
    }
  }

  await admin
    .from("accounts_connections")
    .update({ last_sync_at: new Date().toISOString(), last_error: errors[0]?.error ?? "" })
    .eq("org_id", orgId);
  return { system: c.system, sent, paid, errors };
}

// ---------- the endpoint ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  if (req.method === "GET") return finishConnect(url);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb: SupabaseClient = createClient(SUPABASE_URL, env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
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
  const orgId = String(b.orgId ?? "");
  if (!UUID.test(orgId)) return json({ error: "Bad request" }, 400);
  const { data: m } = await admin
    .from("members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (m?.role !== "owner") return json({ error: "Only business owners can connect the accounts." }, 403);

  try {
    switch (b.action) {
      case "connect": {
        const system = b.system === "quickbooks" ? "quickbooks" : b.system === "xero" ? "xero" : null;
        if (!system) return json({ error: "Bad request" }, 400);
        const returnTo = /^https:\/\/[^\s]+$/.test(String(b.returnTo ?? "")) ? String(b.returnTo) : "";
        return json({ url: await startConnect(orgId, user.id, system, returnTo) });
      }
      case "sync": {
        const ids = Array.isArray(b.invoices) ? b.invoices.map(String).filter((x) => UUID.test(x)) : [];
        return json(await sync(orgId, ids));
      }
      case "disconnect":
        await disconnect(orgId);
        return json({ ok: true });
      default:
        return json({ error: "Bad request" }, 400);
    }
  } catch (e) {
    if (e instanceof Problem) {
      await admin.from("accounts_connections").update({ last_error: e.message }).eq("org_id", orgId);
      return json({ error: e.message }, 422);
    }
    console.error(e);
    return json({ error: "Something went wrong talking to the accounts software." }, 500);
  }
});
