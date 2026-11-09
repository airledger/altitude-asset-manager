// Card payments (part 2): the business connects its own Stripe account, every invoice has a private pay link,
// and the customer pays by card, Apple Pay or Google Pay on Stripe's checkout. Everything that talks to Stripe
// happens in the payments server function.
import type { SupabaseClient } from "@supabase/supabase-js";
import { appOrigin } from "./native";

export interface PaymentStatus {
  connected: boolean;
  charges_enabled: boolean;
  details_submitted: boolean;
}

export interface CardPayment {
  amount: number;
  paid_at: string;
}

/** What the pay page shows a customer. */
export interface PayInfo {
  number: string;
  business: string;
  client: string;
  total: number;
  paid: number;
  due: number;
  canPay: boolean;
}

const NOT_CONNECTED: PaymentStatus = { connected: false, charges_enabled: false, details_submitted: false };

async function call<T>(sb: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.functions.invoke("payments", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const out = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    throw new Error((out as { error?: string } | null)?.error || error.message);
  }
  return data as T;
}

/** The link to send a customer: the app's own address, so it looks like the business's app, not a server. */
export const payLink = (token: string, origin = appOrigin()) => `${origin}/?pay=${token}`;

export function paymentsApi(sb: SupabaseClient, orgId: string) {
  return {
    async status(): Promise<PaymentStatus> {
      const { data, error } = await sb.rpc("payment_status", { p_org: orgId });
      if (error) throw new Error(error.message);
      return ((data as PaymentStatus[] | null) ?? [])[0] ?? NOT_CONNECTED;
    },
    /** Where to send the owner to set up (or finish setting up) their Stripe account. */
    async connectUrl(): Promise<string> {
      return (await call<{ url: string }>(sb, { action: "connect", orgId, returnTo: appOrigin() })).url;
    },
    /** Asks Stripe whether the account can take payments yet. */
    refresh: () => call<PaymentStatus>(sb, { action: "status", orgId }),
    disconnect: () => call<{ ok: boolean }>(sb, { action: "disconnect", orgId }),
    async received(invoiceId: string): Promise<CardPayment[]> {
      const { data, error } = await sb
        .from("card_payments")
        .select("amount, paid_at")
        .eq("invoice_id", invoiceId)
        .order("paid_at");
      if (error) throw new Error(error.message);
      return ((data ?? []) as CardPayment[]).map((x) => ({ ...x, amount: Number(x.amount) }));
    },
  };
}

export type PaymentsApi = ReturnType<typeof paymentsApi>;

// ---------- the customer's side (not signed in) ----------

export const payInfo = (sb: SupabaseClient, token: string) => call<PayInfo>(sb, { action: "invoice", token });

export async function checkoutUrl(sb: SupabaseClient, token: string): Promise<string> {
  return (await call<{ url: string }>(sb, { action: "checkout", token, returnTo: appOrigin() })).url;
}

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A pay link (?pay=) or Stripe sending the customer back after paying (?paid=). */
export function payParams(search = window.location.search): { token: string; paid: boolean } | null {
  const q = new URLSearchParams(search);
  const token = (q.get("pay") ?? q.get("paid") ?? "").trim();
  return TOKEN.test(token) ? { token, paid: q.has("paid") } : null;
}
