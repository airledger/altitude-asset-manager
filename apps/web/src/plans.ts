// Paid plans: the plans, a business's own plan (trial, limits, Direct Debit), and Air Ledger Ltd's view of
// every business with who to bill each month (as a Xero import, collected by Adfin Direct Debit).
import { toCsv, type Cell } from "@airledger/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Plan {
  code: string;
  name: string;
  monthly: number;
  yearly: number;
  engineers: number;
  /** null: unlimited. */
  assets: number | null;
  extra_engineer: number;
  blurb: string;
  sort: number;
  active: boolean;
}
export type PlanStatus = "trial" | "active" | "past_due" | "cancelled" | "free";
export type DdStatus = "none" | "requested" | "active" | "failed" | "cancelled";
export interface OrgPlan {
  org_id: string;
  plan: string;
  billing: "monthly" | "yearly";
  status: PlanStatus;
  trial_ends: string;
  extra_engineers: number;
  billing_name: string;
  billing_email: string;
  chosen_at: string | null;
  dd_status: DdStatus;
  dd_ref: string;
  paid_until: string | null;
}
export interface PlatformSettings {
  require_invite: boolean;
  dd_setup_url: string;
  vat_registered: boolean;
  trial_days: number;
}
export type PlatformBusiness = OrgPlan & {
  name: string;
  created_at: string;
  owner_email: string | null;
  plan_name: string;
  engineers: number;
  subcontractors: number;
  assets: number;
  amount: number;
};

export const STATUS_LABEL: Record<PlanStatus, string> = {
  trial: "Free trial",
  active: "Paying",
  past_due: "Payment failed",
  cancelled: "Cancelled",
  free: "Free",
};
export const DD_LABEL: Record<DdStatus, string> = {
  none: "Not set up",
  requested: "Set up, waiting for Air Ledger to confirm",
  active: "Direct Debit active",
  failed: "Direct Debit failed",
  cancelled: "Direct Debit cancelled",
};

const day = 86_400_000;
const pounds = (n: number) =>
  `£${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** What it costs: the plan plus extra engineers, monthly or for the year. */
export function price(
  p: Pick<Plan, "monthly" | "yearly" | "extra_engineer">,
  billing: "monthly" | "yearly",
  extra = 0,
) {
  return billing === "yearly"
    ? p.yearly + extra * p.extra_engineer * 12
    : p.monthly + extra * p.extra_engineer;
}
export const priceText = (n: number, billing: "monthly" | "yearly") =>
  `${pounds(n)} ${billing === "yearly" ? "a year" : "a month"}`;

/** Whether the business can add new work, and what to tell them. */
export function planState(o: Pick<OrgPlan, "status" | "trial_ends" | "dd_status">, today: string) {
  const left = Math.round((Date.parse(o.trial_ends) - Date.parse(today)) / day);
  const live =
    o.status === "free" ||
    o.status === "active" ||
    o.status === "past_due" ||
    (o.status === "trial" && left >= 0);
  const message =
    o.status === "trial"
      ? left < 0
        ? "Your free trial has ended. Choose a plan and set up the Direct Debit to keep adding work. Everything you've added is still here."
        : left === 0
          ? "Your free trial ends today."
          : `Your free trial has ${left} day${left === 1 ? "" : "s"} left.`
      : o.status === "cancelled"
        ? "Your plan is cancelled. You can still see and download everything, but not add new work. Choose a plan to start again."
        : o.status === "past_due"
          ? "Your last payment didn't go through. Check the Direct Debit with your bank, or contact Air Ledger."
          : "";
  return { live, daysLeft: o.status === "trial" ? left : null, message };
}

/** Who to bill this month: paying businesses, monthly ones every month, yearly ones when they're due. */
export function dueThisMonth(rows: PlatformBusiness[], month: string): PlatformBusiness[] {
  const end = `${month}-31`;
  return rows.filter(
    (r) =>
      (r.status === "active" || r.status === "past_due" || (r.status === "trial" && r.trial_ends <= end)) &&
      r.dd_status !== "cancelled" &&
      (r.billing === "monthly" || !r.paid_until || r.paid_until <= end),
  );
}

/** This month's invoices as a Xero sales invoice import, one per business. */
export function billingCsv(rows: PlatformBusiness[], month: string, vat: boolean): string {
  const [y = "", m = ""] = month.split("-");
  const first = `01/${m}/${y}`;
  const header = [
    "*ContactName",
    "EmailAddress",
    "*InvoiceNumber",
    "Reference",
    "*InvoiceDate",
    "*DueDate",
    "*Description",
    "*Quantity",
    "*UnitAmount",
    "*AccountCode",
    "*TaxType",
    "Currency",
  ];
  const out: Cell[][] = [header];
  rows.forEach((r, i) => {
    const what = `Air Ledger ${r.plan_name} plan, ${r.billing === "yearly" ? "12 months" : new Date(`${month}-01T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}${r.extra_engineers ? `, with ${r.extra_engineers} extra engineer${r.extra_engineers === 1 ? "" : "s"}` : ""}`;
    out.push([
      r.billing_name || r.name,
      r.billing_email || r.owner_email || "",
      `AL-${y}${m}-${String(i + 1).padStart(3, "0")}`,
      r.dd_ref ? `Direct Debit ${r.dd_ref}` : "Direct Debit",
      first,
      first,
      what,
      1,
      Number(r.amount).toFixed(2),
      "200",
      vat ? "20% (VAT on Income)" : "No VAT",
      "GBP",
    ]);
  });
  return toCsv(out);
}

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
const ORG_PLAN =
  "org_id, plan, billing, status, trial_ends, extra_engineers, billing_name, billing_email, chosen_at, dd_status, dd_ref, paid_until";

export function plansApi(sb: SupabaseClient) {
  return {
    async plans(): Promise<Plan[]> {
      const { data, error } = await sb.from("plans").select("*").order("sort");
      fail(error);
      return (data ?? []) as Plan[];
    },
    /** The business's plan; null if it can't be read (an engineer's view of an older database). */
    async mine(orgId: string): Promise<OrgPlan | null> {
      const { data, error } = await sb.from("org_plans").select(ORG_PLAN).eq("org_id", orgId).maybeSingle();
      fail(error);
      return (data as OrgPlan | null) ?? null;
    },
    async choose(
      orgId: string,
      c: { plan: string; billing: "monthly" | "yearly"; extra: number; name: string; email: string },
    ) {
      const { error } = await sb.rpc("choose_plan", {
        p_org: orgId,
        p_plan: c.plan,
        p_billing: c.billing,
        p_extra: c.extra,
        p_name: c.name,
        p_email: c.email,
      });
      fail(error);
    },
    async ddRequested(orgId: string) {
      const { error } = await sb.rpc("dd_requested", { p_org: orgId });
      fail(error);
    },
    async cancel(orgId: string) {
      const { error } = await sb.rpc("cancel_plan", { p_org: orgId });
      fail(error);
    },
    async settings(): Promise<PlatformSettings> {
      const { data, error } = await sb
        .from("platform")
        .select("require_invite, dd_setup_url, vat_registered, trial_days")
        .maybeSingle();
      fail(error);
      return (
        (data as PlatformSettings | null) ?? {
          require_invite: true,
          dd_setup_url: "",
          vat_registered: false,
          trial_days: 14,
        }
      );
    },
    // ---------- Air Ledger Ltd only ----------
    async isAdmin(): Promise<boolean> {
      const { data, error } = await sb.from("platform_admins").select("user_id").limit(1);
      if (error) return false;
      return (data ?? []).length > 0;
    },
    async businesses(): Promise<PlatformBusiness[]> {
      const { data, error } = await sb.rpc("platform_businesses");
      fail(error);
      return (data ?? []) as PlatformBusiness[];
    },
    async setPlan(
      orgId: string,
      patch: Partial<
        Pick<
          OrgPlan,
          | "plan"
          | "billing"
          | "status"
          | "trial_ends"
          | "extra_engineers"
          | "dd_status"
          | "dd_ref"
          | "paid_until"
        >
      >,
    ) {
      const { error } = await sb.rpc("platform_set_plan", { p_org: orgId, p: patch });
      fail(error);
    },
    async saveSettings(s: PlatformSettings) {
      const { error } = await sb.from("platform").update(s).eq("id", true);
      fail(error);
    },
    async savePlan(p: Plan) {
      const { code, ...rest } = p;
      const { error } = await sb.from("plans").update(rest).eq("code", code);
      fail(error);
    },
    /** An invite code for a new business, while sign-up is invite-only. */
    async businessInvite(email: string): Promise<string> {
      const { data, error } = await sb.rpc("create_invite", { p_org: null, p_email: email || null });
      fail(error);
      return String(data);
    },
  };
}

export type PlansApi = ReturnType<typeof plansApi>;
