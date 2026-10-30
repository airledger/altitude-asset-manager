// Pricing a completed job and drafting its invoice. Rule source: specs/02-domain-model.md
// ("Invoice lines from a completed job"). Only business owners ever run these, because they read prices.

import { addDays, type IsoDate } from "./dates";
import { formatNumber, roundPence } from "./format";
import type { SystemInfo } from "./service";
import {
  isInstallType,
  isServiceType,
  type Client,
  type Invoice,
  type InvoiceLine,
  type Job,
  type Material,
  type MaterialLine,
  type MaterialPrice,
  type Num,
  type PriceList,
  type Settings,
  type System,
  type Unit,
} from "./types";

export const onServicePlan = (c: Client | null | undefined): boolean =>
  !!c && c.servicePlan === "Annual service plan";

/** "visit" = invoice the plan price at each service; "separate" = the plan is paid outside Air Ledger. */
export const planBilling = (c: Client, planPrice: Num): string =>
  c.planBilling || (Number(planPrice) ? "visit" : "separate");

/** Price of a parts-list line: the owner's price list, then the old price on the material or the line. */
export function linePrice(
  material: Material | undefined,
  line: MaterialLine,
  price: MaterialPrice | undefined,
): { cost: number; sell: number; chargeable: boolean } {
  const p = price ?? {};
  const src = material ?? line;
  return {
    cost: Number(p.cost ?? src.cost) || 0,
    sell: Number(p.sell ?? src.sell) || 0,
    chargeable: !!(p.chargeable ?? src.chargeable),
  };
}

/** First line of the site address plus postcode. */
export const siteShort = (s: System): string =>
  (s.siteAddress || "").split(/\n|,/)[0] + (s.sitePostcode ? " " + s.sitePostcode : "");

export function unitsSummary(units: readonly Unit[]): string {
  const indoor = units.filter((u) => u.role === "indoor").length;
  const outdoor = units.filter((u) => u.role === "outdoor").length;
  const parts: string[] = [];
  if (outdoor) parts.push(`${outdoor} outdoor`);
  if (indoor) parts.push(`${indoor} indoor`);
  return parts.join(" + ") || "no units yet";
}

export interface JobPricingInput {
  job: Job;
  system: System | undefined;
  client: Client | undefined;
  units: readonly Unit[];
  info: Pick<SystemInfo, "fgas">;
  prices: PriceList;
  /** The client's plan price (owner-only), "" when not set. */
  planPrice: Num;
  /** The job's quote (owner-only, installs), "" when not set. */
  quote: Num;
  /** The service kit, used when the job has no parts-used list. */
  kit: () => MaterialLine[];
  priceOf: (line: MaterialLine) => { sell: number; chargeable: boolean };
}

/**
 * Invoice lines for a completed job. Clients on a service plan have the routine visit (service or leak
 * check labour, the mandatory leak check and the service kit) covered; repairs, call-outs, refrigerant and
 * parts the engineer added are charged.
 */
export function invoiceLines(input: JobPricingInput): InvoiceLine[] {
  const { job: j, prices: p, info } = input;
  const s = input.system ?? ({ id: "" } as System);
  const c = input.client ?? ({ id: "" } as Client);
  const indoor = Math.max(1, input.units.filter((u) => u.role === "indoor").length);
  const site = siteShort(s);
  const service = isServiceType(j.type);
  const covered = onServicePlan(c) && (service || j.type === "Leak check");
  const planPrice = Number(input.planPrice) || 0;
  const quote = Number(input.quote);
  const lines: InvoiceLine[] = [];

  if (covered && planBilling(c, input.planPrice) === "visit" && planPrice)
    lines.push({
      desc: `${j.type === "Leak check" ? "F-gas leak check" : "Annual air conditioning service"} (service plan) – ${s.name}, ${site} – ${indoor} indoor unit${indoor > 1 ? "s" : ""}`,
      qty: 1,
      unit: planPrice,
    });

  if (service) {
    if (!covered) {
      lines.push({
        desc: `Annual air conditioning service – ${s.name}, ${site} (first indoor unit + outdoor)`,
        qty: 1,
        unit: Number(p.labourFirst),
      });
      if (indoor > 1)
        lines.push({
          desc: "Additional indoor unit serviced",
          qty: indoor - 1,
          unit: Number(p.labourAdditional),
        });
    }
    if (j.type === "Service + repair" && j.durationHrs)
      lines.push({ desc: "Repair labour", qty: 1, unit: Number(p.labourHourly) });
  } else if (j.type === "Leak check") {
    if (!covered)
      lines.push({ desc: `F-gas leak check – ${s.name}, ${site}`, qty: 1, unit: Number(p.leakCheckCharge) });
  } else if (j.type === "Repair / breakdown") {
    lines.push({ desc: `Call-out – ${s.name}, ${site}`, qty: 1, unit: Number(p.calloutCharge) });
    const extraHours = Math.max(0, (Number(j.durationHrs) || 1) - 1);
    if (extraHours)
      lines.push({ desc: "Additional labour (hours)", qty: extraHours, unit: Number(p.labourHourly) });
  } else if (isInstallType(j.type) && quote) {
    lines.push({
      desc:
        j.type === "Installation"
          ? `Supply and installation of air conditioning – ${s.name}, ${site} (${unitsSummary(input.units)})`
          : `Commissioning – ${s.name}, ${site}`,
      qty: 1,
      unit: quote,
    });
  } else {
    // Surveys, and installs without a quote, are charged by the hour.
    lines.push({
      desc: `${j.type} – ${s.name}, ${site}`,
      qty: Number(j.durationHrs) || 1,
      unit: Number(p.labourHourly),
    });
  }

  if (!covered && service && info.fgas.required && j.leakCheck?.performed)
    lines.push({
      desc: `Mandatory F-gas leak check (${formatNumber(info.fgas.tonnesCo2e)} t CO₂e)`,
      qty: 1,
      unit: Number(p.leakCheckCharge),
    });
  if (j.leakCheck?.addedKg)
    lines.push({
      desc: `${s.refrigerant || "Refrigerant"} top-up (kg)`,
      qty: Number(j.leakCheck.addedKg),
      unit: Number(p.refrigerantPerKg),
    });

  for (const m of j.materialsUsed || input.kit()) {
    // The service kit is covered by the plan; parts the engineer added are still charged.
    if (!m.qty || (covered && !m.extra)) continue;
    const price = input.priceOf(m);
    if (price.chargeable) lines.push({ desc: m.name, qty: m.qty, unit: price.sell });
  }
  return lines.map((l) => ({ ...l, unit: roundPence(l.unit) }));
}

export interface Totals {
  net: number;
  vat: number;
  gross: number;
}

/** Each line is rounded to pence before adding up; VAT is 20% of the rounded net. */
export function invoiceTotals(inv: Pick<Invoice, "lines" | "vat">): Totals {
  const net = roundPence(
    inv.lines.reduce((t, l) => t + roundPence((Number(l.qty) || 0) * (Number(l.unit) || 0)), 0),
  );
  const vat = inv.vat ? roundPence(net * 0.2) : 0;
  return { net, vat, gross: roundPence(net + vat) };
}

export type JobBilling = "plan" | "plan-extras" | "charged";

export interface DraftResult {
  /** How the job was billed. "plan" means covered, with no invoice. */
  billing: JobBilling;
  invoice: (Invoice & { auto: true }) | null;
  /** The invoice number to use next, when an invoice was drafted. */
  nextInvoiceNo: number | null;
}

/** Turns a completed job's lines into a draft invoice using the next invoice number. */
export function draftInvoice(args: {
  job: Job;
  system: System | undefined;
  client: Client | undefined;
  lines: InvoiceLine[];
  settings: Settings;
  today: IsoDate;
}): DraftResult {
  const { job, lines, settings, today } = args;
  if (!lines.length) return { billing: "plan", invoice: null, nextInvoiceNo: null };
  const s = args.system ?? ({ id: "" } as System);
  const n = Number(settings.nextInvoiceNo) || 1001;
  return {
    billing: onServicePlan(args.client) ? "plan-extras" : "charged",
    invoice: {
      clientId: s.clientId || "",
      jobId: job.id,
      number: (settings.invoicePrefix || "") + n,
      date: today,
      dueDate: addDays(today, Number(settings.paymentDays) || 0),
      reference: `${job.type} ${s.sitePostcode || ""}`.trim(),
      lines,
      vat: !!settings.vatRegistered,
      status: "draft",
      auto: true,
    },
    nextInvoiceNo: n + 1,
  };
}
