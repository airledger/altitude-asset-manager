// Planned maintenance contracts (part 2). Everyone in the business can see a client's contracts, so engineers
// know a site is covered; only owners can change them, and only owners can read the price (contract_prices).
// Saving a contract books the year's visits as unassigned jobs; the database does the booking and the billing
// (book_contract_visits, renew_contract, bill_due_contracts) so two devices can't double up.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, addMonths } from "@airledger/domain";

export const VISITS_PER_YEAR = [1, 2, 3, 4, 6, 12] as const;
export const VISIT_TYPES = ["Annual service", "Leak check"] as const;
export const BILLING = {
  monthly: "Monthly",
  quarterly: "Every 3 months",
  yearly: "Once a year",
  visit: "Each visit",
} as const;
export type Billing = keyof typeof BILLING;

export interface ContractRow {
  id: string;
  client_id: string;
  name: string;
  start_date: string;
  end_date: string;
  visits_per_year: number;
  visit_type: string;
  auto_renew: boolean;
  status: "active" | "cancelled";
  notes: string;
  contract_systems: { system_id: string }[];
}

export interface ContractPriceRow {
  contract_id: string;
  price: number;
  billing: Billing;
  next_bill_date: string | null;
}

export type ContractInput = Omit<ContractRow, "id" | "contract_systems" | "status"> & { id?: string };

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message);
};

/** A contract runs a year from its start unless told otherwise. */
export const defaultEnd = (start: string) => addMonths(start, 12);

/** The visit dates in the contract year, as the database books them. */
export function visitDates(c: Pick<ContractRow, "start_date" | "end_date" | "visits_per_year">): string[] {
  const step = 12 / c.visits_per_year;
  return Array.from({ length: c.visits_per_year }, (_, i) => addMonths(c.start_date, i * step)).filter(
    (d) => d < c.end_date,
  );
}

/** Where a contract stands today, for its label. */
export function contractState(c: Pick<ContractRow, "status" | "end_date" | "start_date">, today: string) {
  if (c.status === "cancelled") return { label: "Cancelled", tone: "" };
  if (c.end_date <= today) return { label: "Ended", tone: "red" };
  if (c.start_date > today) return { label: "Starts later", tone: "" };
  if (c.end_date <= addDays(today, 30)) return { label: "Renewal due", tone: "amber" };
  return { label: "Active", tone: "green" };
}

/** How the price reads: "£1,200 a year, billed monthly (£100.00)" or "£90 a visit". */
export function priceText(p: Pick<ContractPriceRow, "price" | "billing">): string {
  const money = (n: number) => n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
  if (p.billing === "visit") return `${money(Number(p.price))} a visit`;
  const months = p.billing === "monthly" ? 1 : p.billing === "quarterly" ? 3 : 12;
  const each = Math.round((Number(p.price) * months * 100) / 12) / 100;
  return months === 12
    ? `${money(Number(p.price))} a year, billed yearly`
    : `${money(Number(p.price))} a year, billed ${months === 1 ? "monthly" : "every 3 months"} (${money(each)})`;
}

export function contractsApi(sb: SupabaseClient, orgId: string) {
  const api = {
    async forClient(clientId: string): Promise<ContractRow[]> {
      const { data, error } = await sb
        .from("contracts")
        .select("*, contract_systems(system_id)")
        .eq("client_id", clientId)
        .order("end_date", { ascending: false });
      fail(error);
      return (data ?? []) as ContractRow[];
    },

    /** Owners only: engineers get an empty list from the database. */
    async prices(ids: string[]): Promise<ContractPriceRow[]> {
      if (!ids.length) return [];
      const { data, error } = await sb
        .from("contract_prices")
        .select("contract_id, price, billing, next_bill_date")
        .in("contract_id", ids);
      fail(error);
      return (data ?? []) as ContractPriceRow[];
    },

    /** The next booked visit for each contract. */
    async nextVisits(ids: string[], today: string): Promise<Map<string, string>> {
      const out = new Map<string, string>();
      if (!ids.length) return out;
      const { data, error } = await sb
        .from("jobs")
        .select("contract_id, date")
        .in("contract_id", ids)
        .is("deleted_at", null)
        .neq("status", "cancelled")
        .gte("date", today)
        .order("date")
        .limit(200);
      fail(error);
      for (const j of (data ?? []) as { contract_id: string; date: string }[])
        if (!out.has(j.contract_id)) out.set(j.contract_id, j.date);
      return out;
    },

    /** Saves a contract, the installs it covers and its price, then books any visits not yet booked. */
    async save(
      c: ContractInput,
      systemIds: string[],
      price: { price: number; billing: Billing },
    ): Promise<{ id: string; booked: number }> {
      const { id, ...rest } = c;
      const row = { ...rest, org_id: orgId, updated_at: new Date().toISOString(), ...(id ? { id } : {}) };
      const saved = await sb.from("contracts").upsert(row).select("id").single();
      fail(saved.error);
      const cid = (saved.data as { id: string }).id;

      const now = await sb.from("contract_systems").select("system_id").eq("contract_id", cid);
      fail(now.error);
      const had = new Set(((now.data ?? []) as { system_id: string }[]).map((r) => r.system_id));
      const gone = [...had].filter((s) => !systemIds.includes(s));
      const added = systemIds.filter((s) => !had.has(s));
      if (gone.length) {
        const { error } = await sb
          .from("contract_systems")
          .delete()
          .eq("contract_id", cid)
          .in("system_id", gone);
        fail(error);
      }
      if (added.length) {
        const { error } = await sb
          .from("contract_systems")
          .insert(added.map((system_id) => ({ contract_id: cid, system_id, org_id: orgId })));
        fail(error);
      }
      const p = await sb.from("contract_prices").upsert(
        {
          contract_id: cid,
          org_id: orgId,
          price: price.price,
          billing: price.billing,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "contract_id" },
      );
      fail(p.error);
      return { id: cid, booked: await api.bookVisits(cid) };
    },

    async bookVisits(id: string): Promise<number> {
      const { data, error } = await sb.rpc("book_contract_visits", { p_contract: id });
      fail(error);
      return Number(data ?? 0);
    },

    async renew(id: string): Promise<string> {
      const { data, error } = await sb.rpc("renew_contract", { p_contract: id });
      fail(error);
      return String(data);
    },

    /** Cancels the contract and takes its visits that haven't happened yet out of the diary. */
    async cancel(id: string, today: string): Promise<void> {
      const { error } = await sb
        .from("contracts")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("org_id", orgId);
      fail(error);
      const j = await sb
        .from("jobs")
        .update({ status: "cancelled" })
        .eq("contract_id", id)
        .eq("status", "booked")
        .gte("date", today)
        .select("id, engineer_id");
      fail(j.error);
      // Take any that were given to an engineer out of their calendar.
      for (const r of (j.data ?? []) as { id: string; engineer_id: string | null }[])
        if (r.engineer_id)
          void Promise.resolve(sb.functions.invoke("job-invite", { body: { job: r.id } })).catch(
            () => undefined,
          );
    },

    /** Active contracts ending within `days`, or already ended, for the renewal reminder on Home. */
    async renewingSoon(
      today: string,
      days = 30,
    ): Promise<(ContractRow & { clients: { name: string } | null })[]> {
      const { data, error } = await sb
        .from("contracts")
        .select("*, contract_systems(system_id), clients(name)")
        .eq("org_id", orgId)
        .eq("status", "active")
        .lte("end_date", addDays(today, days))
        .order("end_date");
      fail(error);
      return (data ?? []) as never;
    },
  };
  return api;
}

export type ContractsApi = ReturnType<typeof contractsApi>;
