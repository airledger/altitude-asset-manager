// Pricing and invoices (stage 7, spec F12). Owners only: the database refuses everyone else, and the
// screens that use this are only shown to owners.
//
// Completing a job marks it "waiting to be invoiced". The next time an owner opens Invoices, each such job is
// priced by the rules in packages/domain and drafted through create_invoice, which numbers it under a lock
// and only ever gives a job one invoice, however many devices try at once.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays,
  exportInvoicesCsv,
  fgas,
  invoiceLines,
  invoiceTotals,
  linePrice,
  type AccountsApp,
  type Client,
  type Invoice,
  type InvoiceLine,
  type PriceList,
  type Settings,
} from "@airledger/domain";
import { toDomain, type ClientRow, type SystemRow, type UnitRow } from "./assets";
import { toJob, toLine, toUnit, type JobRecord, type JobRow, type MaterialRow } from "./jobs";
import { appOrigin } from "./native";

/** The live link to Xero or QuickBooks, as owners see it (never the tokens). */
export interface AccountsConnection {
  system: "xero" | "quickbooks";
  tenant_name: string;
  connected_at: string;
  last_sync_at: string | null;
  last_error: string;
}
export interface SyncResult {
  system: "xero" | "quickbooks";
  sent: number;
  paid: number;
  errors: { number: string; error: string }[];
}
export const SYSTEM_LABEL = { xero: "Xero", quickbooks: "QuickBooks" } as const;

export interface PriceListRow {
  labour_first: number | null;
  labour_additional: number | null;
  labour_hourly: number | null;
  leak_check_charge: number | null;
  refrigerant_per_kg: number | null;
  callout_charge: number | null;
}
export const PRICE_FIELDS: [keyof PriceListRow, string][] = [
  ["labour_first", "Service: first indoor unit and the outdoor"],
  ["labour_additional", "Service: each extra indoor unit"],
  ["labour_hourly", "Labour per hour"],
  ["leak_check_charge", "F-gas leak check"],
  ["refrigerant_per_kg", "Refrigerant per kg"],
  ["callout_charge", "Call-out (first hour)"],
];

export interface MaterialPriceRow {
  material_id: string;
  cost: number | null;
  sell: number | null;
  chargeable: boolean;
}

export interface ClientBillingRow {
  client_id: string;
  plan_price: number | null;
  plan_billing: "separate" | "visit" | null;
  accounts_name: string;
  sage_ref: string;
}

export interface AccountsSettings {
  accounts_app: AccountsApp;
  vat_registered: boolean;
  payment_days: number;
  xero_account_code: string;
  xero_tax_type: string;
  xero_tracking_name: string;
  xero_tracking_option: string;
  qb_item: string;
  qb_tax_code: string;
  sage_nominal: string;
  sage_tax_code: string;
  sage_no_vat_code: string;
  /** From the invoice counter. */
  prefix: string;
  next_number: number;
}
const ACCOUNT_COLUMNS =
  "accounts_app, vat_registered, payment_days, xero_account_code, xero_tax_type, xero_tracking_name, xero_tracking_option, qb_item, qb_tax_code, sage_nominal, sage_tax_code, sage_no_vat_code";

export interface LineRow {
  id?: string;
  position: number;
  description: string;
  qty: number;
  unit_price: number;
}

export interface InvoiceRow {
  id: string;
  number: string;
  client_id: string;
  job_id: string | null;
  date: string;
  due_date: string | null;
  reference: string;
  vat_rate: number;
  status: "draft" | "exported";
  exported_at: string | null;
  auto: boolean;
  external_system?: "xero" | "quickbooks" | "sage" | null;
  external_id?: string | null;
  sync_status?: "pending" | "synced" | "failed" | null;
  sync_error?: string;
  amount_paid?: number;
  paid_at?: string | null;
  /** The secret part of the invoice's card pay link. */
  pay_token?: string;
  invoice_lines: LineRow[];
  clients: { name: string; email?: string } | null;
  jobs: { id: string; type: string; date: string | null } | null;
}

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message);
};
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

export const toLines = (rows: LineRow[]): InvoiceLine[] =>
  [...rows]
    .sort((a, b) => a.position - b.position)
    .map((l) => ({ desc: l.description, qty: Number(l.qty), unit: Number(l.unit_price) }));

export const toInvoice = (r: InvoiceRow): Invoice => ({
  id: r.id,
  clientId: r.client_id,
  jobId: r.job_id ?? "",
  number: r.number,
  date: r.date,
  dueDate: r.due_date ?? r.date,
  reference: r.reference,
  lines: toLines(r.invoice_lines ?? []),
  vat: Number(r.vat_rate) > 0,
  status: r.status,
});

export const totals = (r: InvoiceRow) => invoiceTotals(toInvoice(r));

export const toClient = (c: ClientRow, b: ClientBillingRow | null | undefined): Client => ({
  id: c.id,
  name: c.name,
  contactName: c.contact_name,
  phone: c.phone,
  email: c.email,
  billingAddress: c.billing_address,
  postcode: c.postcode,
  servicePlan: c.on_service_plan ? "Annual service plan" : "",
  planBilling: b?.plan_billing ?? "",
  xeroContactName: b?.accounts_name ?? "",
  sageRef: b?.sage_ref ?? "",
});

export const toPriceList = (p: PriceListRow | null): PriceList => ({
  labourFirst: p?.labour_first ?? "",
  labourAdditional: p?.labour_additional ?? "",
  labourHourly: p?.labour_hourly ?? "",
  leakCheckCharge: p?.leak_check_charge ?? "",
  refrigerantPerKg: p?.refrigerant_per_kg ?? "",
  calloutCharge: p?.callout_charge ?? "",
});

export const toAccountsSettings = (a: AccountsSettings): Settings => ({
  vatRegistered: a.vat_registered,
  paymentDays: a.payment_days,
  accountsApp: a.accounts_app,
  accountCode: a.xero_account_code,
  taxType: a.xero_tax_type,
  trackingName: a.xero_tracking_name,
  trackingOption: a.xero_tracking_option,
  qbItem: a.qb_item,
  qbTaxCode: a.qb_tax_code,
  sageNominal: a.sage_nominal,
  sageTaxCode: a.sage_tax_code,
  sageNoVatCode: a.sage_no_vat_code,
  invoicePrefix: a.prefix,
  nextInvoiceNo: a.next_number,
});

/** Everything pricing a job needs, loaded once for a batch of jobs. */
export interface PricingData {
  prices: PriceList;
  materials: MaterialRow[];
  materialPrices: MaterialPriceRow[];
  accounts: AccountsSettings;
}

/** A completed job's invoice lines, by the domain rules. `ignorePlan` is "Invoice anyway" on a plan visit. */
export function linesForJob(a: {
  job: JobRow;
  record: JobRecord;
  system: SystemRow;
  client: ClientRow | null;
  billing: ClientBillingRow | null;
  units: UnitRow[];
  quote: number | null;
  pricing: PricingData;
  ignorePlan?: boolean;
}): InvoiceLine[] {
  const sys = toDomain(a.system);
  const client = a.client ? toClient(a.client, a.billing) : undefined;
  const lc = a.record.leak;
  const job = {
    ...toJob(a.job),
    leakCheck: { performed: !!lc?.performed, addedKg: lc?.added_kg ?? "" },
    materialsUsed: a.record.used.map(toLine),
  };
  const byId = new Map(a.pricing.materials.map((m) => [m.id, m]));
  const priceById = new Map(a.pricing.materialPrices.map((p) => [p.material_id, p]));
  return invoiceLines({
    job,
    system: sys,
    client: a.ignorePlan && client ? { ...client, servicePlan: "" } : client,
    units: a.units.map(toUnit),
    info: {
      fgas: fgas({
        refrigerant: a.system.refrigerant,
        gwp: a.system.gwp,
        factoryChargeKg: a.system.factory_charge_kg,
        addedChargeKg: a.system.added_charge_kg,
        hermetic: a.system.hermetic,
        leakDetection: a.system.leak_detection,
      }),
    },
    prices: a.pricing.prices,
    planPrice: a.billing?.plan_price ?? "",
    quote: a.quote ?? "",
    kit: () => [],
    priceOf: (line) => {
      const m = byId.get(line.id ?? "");
      const p = priceById.get(line.id ?? "");
      return linePrice(
        m ? { id: m.id, name: m.name } : undefined,
        line,
        p ? { cost: p.cost ?? "", sell: p.sell ?? "", chargeable: p.chargeable } : undefined,
      );
    },
  });
}

export function invoicesApi(sb: SupabaseClient, orgId: string) {
  async function accountsCall<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.functions.invoke("accounts", { body: { ...body, orgId } });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const out = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
      throw new Error((out as { error?: string } | null)?.error || error.message);
    }
    return data as T;
  }
  async function upsert(table: string, row: Record<string, unknown>, key: string) {
    const { error } = await sb.from(table).upsert({ ...row, org_id: orgId }, { onConflict: key });
    fail(error);
  }

  const api = {
    orgId,

    async priceList(): Promise<PriceListRow | null> {
      const { data, error } = await sb.from("price_list").select("*").eq("org_id", orgId).maybeSingle();
      fail(error);
      return (data as PriceListRow | null) ?? null;
    },
    savePriceList: (row: PriceListRow) => upsert("price_list", { ...row }, "org_id"),

    async materialPrices(): Promise<MaterialPriceRow[]> {
      const { data, error } = await sb
        .from("material_prices")
        .select("material_id, cost, sell, chargeable")
        .eq("org_id", orgId);
      fail(error);
      return (data ?? []) as MaterialPriceRow[];
    },
    saveMaterialPrice: (row: MaterialPriceRow) => upsert("material_prices", { ...row }, "material_id"),

    async clientBilling(clientId: string): Promise<ClientBillingRow | null> {
      const { data, error } = await sb
        .from("client_billing")
        .select("client_id, plan_price, plan_billing, accounts_name, sage_ref")
        .eq("client_id", clientId)
        .maybeSingle();
      fail(error);
      return (data as ClientBillingRow | null) ?? null;
    },
    async allClientBilling(): Promise<ClientBillingRow[]> {
      const { data, error } = await sb
        .from("client_billing")
        .select("client_id, plan_price, plan_billing, accounts_name, sage_ref")
        .eq("org_id", orgId);
      fail(error);
      return (data ?? []) as ClientBillingRow[];
    },
    saveClientBilling: (row: ClientBillingRow) => upsert("client_billing", { ...row }, "client_id"),

    async quote(jobId: string): Promise<number | null> {
      const { data, error } = await sb.from("job_quotes").select("quote").eq("job_id", jobId).maybeSingle();
      fail(error);
      return n((data as { quote: number } | null)?.quote);
    },
    async saveQuote(jobId: string, quote: number | null): Promise<void> {
      if (quote == null) {
        const { error } = await sb.from("job_quotes").delete().eq("job_id", jobId);
        fail(error);
      } else await upsert("job_quotes", { job_id: jobId, quote }, "job_id");
    },

    async accounts(): Promise<AccountsSettings> {
      const [s, c] = await Promise.all([
        sb.from("org_settings").select(ACCOUNT_COLUMNS).eq("org_id", orgId).maybeSingle(),
        sb.from("invoice_counters").select("prefix, next_number").eq("org_id", orgId).maybeSingle(),
      ]);
      fail(s.error);
      fail(c.error);
      const r = (s.data ?? {}) as Partial<AccountsSettings>;
      const k = (c.data ?? {}) as { prefix?: string; next_number?: number };
      return {
        accounts_app: r.accounts_app === "quickbooks" || r.accounts_app === "sage" ? r.accounts_app : "xero",
        vat_registered: !!r.vat_registered,
        payment_days: Number(r.payment_days ?? 14),
        xero_account_code: r.xero_account_code ?? "200",
        xero_tax_type: r.xero_tax_type ?? "20% (VAT on Income)",
        xero_tracking_name: r.xero_tracking_name ?? "",
        xero_tracking_option: r.xero_tracking_option ?? "",
        qb_item: r.qb_item ?? "Services",
        qb_tax_code: r.qb_tax_code ?? "20.0% S",
        sage_nominal: r.sage_nominal ?? "4000",
        sage_tax_code: r.sage_tax_code ?? "T1",
        sage_no_vat_code: r.sage_no_vat_code ?? "T9",
        prefix: k.prefix ?? "",
        next_number: Number(k.next_number ?? 1001),
      };
    },
    async saveAccounts(a: AccountsSettings): Promise<void> {
      const { prefix, next_number, ...settings } = a;
      const { data, error } = await sb
        .from("org_settings")
        .update(settings)
        .eq("org_id", orgId)
        .select("org_id");
      fail(error);
      if (Array.isArray(data) && data.length === 0) throw new Error("Only an owner can change this.");
      await upsert("invoice_counters", { prefix, next_number }, "org_id");
    },

    async invoices(): Promise<InvoiceRow[]> {
      const { data, error } = await sb
        .from("invoices")
        .select("*, invoice_lines(*), clients(name, email), jobs(id, type, date)")
        .eq("org_id", orgId)
        .order("date", { ascending: false })
        .limit(2000);
      fail(error);
      return (data ?? []) as InvoiceRow[];
    },
    async invoice(id: string): Promise<InvoiceRow | null> {
      const { data, error } = await sb
        .from("invoices")
        .select("*, invoice_lines(*), clients(name, email), jobs(id, type, date)")
        .eq("id", id)
        .maybeSingle();
      fail(error);
      return (data as InvoiceRow | null) ?? null;
    },
    async jobInvoice(jobId: string): Promise<InvoiceRow | null> {
      const { data, error } = await sb
        .from("invoices")
        .select("*, invoice_lines(*), clients(name, email), jobs(id, type, date)")
        .eq("job_id", jobId)
        .maybeSingle();
      fail(error);
      return (data as InvoiceRow | null) ?? null;
    },

    async save(
      id: string,
      d: { date: string; due_date: string | null; reference: string; vat: boolean },
      lines: InvoiceLine[],
    ): Promise<void> {
      const { error } = await sb.rpc("save_invoice", {
        p_invoice: id,
        p_date: d.date,
        p_due_date: d.due_date,
        p_reference: d.reference,
        p_vat: d.vat,
        p_lines: lines,
      });
      fail(error);
    },

    async remove(id: string): Promise<void> {
      const { error } = await sb.from("invoices").delete().eq("id", id).eq("org_id", orgId);
      fail(error);
    },

    async setExported(ids: string[], exported: boolean): Promise<void> {
      if (!ids.length) return;
      const { error } = await sb
        .from("invoices")
        .update({
          status: exported ? "exported" : "draft",
          exported_at: exported ? new Date().toISOString() : null,
        })
        .in("id", ids)
        .eq("org_id", orgId);
      fail(error);
    },

    async create(a: {
      clientId: string;
      jobId: string | null;
      date: string;
      reference: string;
      lines: InvoiceLine[];
      accounts: AccountsSettings;
      auto: boolean;
    }): Promise<string> {
      const { data, error } = await sb.rpc("create_invoice", {
        p_org: orgId,
        p_client: a.clientId,
        p_job: a.jobId,
        p_date: a.date,
        p_due_date: addDays(a.date, Number(a.accounts.payment_days) || 0),
        p_reference: a.reference,
        p_vat: a.accounts.vat_registered,
        p_lines: a.lines,
        p_auto: a.auto,
      });
      fail(error);
      return data as string;
    },

    async setBilling(jobId: string, billing: "plan" | "pending"): Promise<void> {
      const { error } = await sb.from("jobs").update({ billing }).eq("id", jobId).eq("org_id", orgId);
      fail(error);
    },

    async pricing(): Promise<PricingData> {
      const [prices, materials, materialPrices, accounts] = await Promise.all([
        api.priceList(),
        sb.from("materials").select("*").eq("org_id", orgId),
        api.materialPrices(),
        api.accounts(),
      ]);
      fail(materials.error);
      return {
        prices: toPriceList(prices),
        materials: (materials.data ?? []) as MaterialRow[],
        materialPrices,
        accounts,
      };
    },

    /** Completed jobs waiting to be invoiced, or covered by a plan (for "Invoice anyway"). */
    async jobsBilled(billing: "pending" | "plan"): Promise<
      (JobRow & {
        systems: {
          client_id: string;
          name: string;
          site_postcode: string;
          clients: { name: string } | null;
        } | null;
      })[]
    > {
      const { data, error } = await sb
        .from("jobs")
        .select("*, systems(client_id, name, site_postcode, clients(name))")
        .eq("org_id", orgId)
        .eq("billing", billing)
        .eq("status", "completed")
        .order("date", { ascending: false })
        .limit(200);
      fail(error);
      return (data ?? []) as never;
    },

    /** What drafting one job needs. */
    async jobInputs(job: JobRow, record: () => Promise<JobRecord>) {
      const [sys, units, quote, rec] = await Promise.all([
        sb.from("systems").select("*").eq("id", job.system_id).single(),
        sb.from("units").select("*").eq("system_id", job.system_id).order("created_at"),
        api.quote(job.id),
        record(),
      ]);
      fail(sys.error);
      fail(units.error);
      const system = sys.data as SystemRow;
      const [cl, billing] = await Promise.all([
        sb.from("clients").select("*").eq("id", system.client_id).maybeSingle(),
        api.clientBilling(system.client_id),
      ]);
      fail(cl.error);
      return {
        system,
        units: (units.data ?? []) as UnitRow[],
        quote,
        record: rec,
        client: (cl.data as ClientRow | null) ?? null,
        billing,
      };
    },

    /**
     * Drafts every job waiting to be invoiced. A plan visit with nothing extra is marked covered instead.
     * Returns how many invoices were drafted and how many jobs were covered.
     */
    async draftPending(record: (jobId: string) => Promise<JobRecord>, today: string) {
      const pending = await api.jobsBilled("pending");
      if (!pending.length) return { drafted: 0, covered: 0 };
      const pricing = await api.pricing();
      let drafted = 0;
      let covered = 0;
      for (const job of pending) {
        const inp = await api.jobInputs(job, () => record(job.id));
        const lines = linesForJob({ job, ...inp, pricing });
        if (!lines.length) {
          await api.setBilling(job.id, "plan");
          covered++;
          continue;
        }
        await api.create({
          clientId: inp.system.client_id,
          jobId: job.id,
          date: job.date ?? today,
          reference: `${job.type} ${inp.system.site_postcode || ""}`.trim(),
          lines,
          accounts: pricing.accounts,
          auto: true,
        });
        drafted++;
      }
      return { drafted, covered };
    },

    /** The live connection to Xero or QuickBooks, if there is one. */
    async connection(): Promise<AccountsConnection | null> {
      const { data, error } = await sb.rpc("accounts_connection", { p_org: orgId });
      fail(error);
      return ((data as AccountsConnection[] | null) ?? [])[0] ?? null;
    },

    /** Asks the server where to send the owner to approve the connection. */
    async connectUrl(system: "xero" | "quickbooks"): Promise<string> {
      const out = await accountsCall<{ url: string }>({
        action: "connect",
        system,
        returnTo: `${appOrigin()}/`,
      });
      return out.url;
    },
    disconnect: () => accountsCall<{ ok: boolean }>({ action: "disconnect" }),
    /** Sends these invoices (and their customers) across, then brings back what's been paid. */
    sync: (ids: string[]) => accountsCall<SyncResult>({ action: "sync", invoices: ids }),

    /** Renews contracts set to renew by themselves and drafts any contract bills that have come round. */
    async billContracts(): Promise<number> {
      const { data, error } = await sb.rpc("bill_due_contracts", { p_org: orgId });
      fail(error);
      return Number(data ?? 0);
    },

    /** The CSV for the business's accounts software. */
    async exportCsv(list: InvoiceRow[]): Promise<{ csv: string; app: AccountsApp }> {
      const accounts = await api.accounts();
      const ids = [...new Set(list.map((i) => i.client_id))];
      const [cl, bl] = await Promise.all([
        sb.from("clients").select("*").in("id", ids),
        api.allClientBilling(),
      ]);
      fail(cl.error);
      const billing = new Map(bl.map((b) => [b.client_id, b]));
      const clients = new Map(
        ((cl.data ?? []) as ClientRow[]).map((c) => [c.id, toClient(c, billing.get(c.id))]),
      );
      const st = toAccountsSettings(accounts);
      return {
        csv: exportInvoicesCsv(list.map(toInvoice), st, (id) => clients.get(id ?? "")),
        app: accounts.accounts_app,
      };
    },
  };
  return api;
}

export type InvoicesApi = ReturnType<typeof invoicesApi>;
