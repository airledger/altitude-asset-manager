import { describe, expect, it } from "vitest";
import { fgas } from "./fgas";
import { draftInvoice, invoiceLines, invoiceTotals, type JobPricingInput } from "./invoices";
import type { Client, Job, Unit } from "./types";

const prices = {
  labourFirst: 95,
  labourAdditional: 45,
  labourHourly: 60,
  leakCheckCharge: 40,
  refrigerantPerKg: 60,
  calloutCharge: 75,
};
const system = {
  id: "s",
  clientId: "c",
  name: "Office",
  siteAddress: "2 Low Rd, Hull",
  sitePostcode: "HU1 2BB",
  refrigerant: "R410A",
};
const units: Unit[] = [
  { id: "AC-1", role: "outdoor" },
  { id: "AC-2", role: "indoor" },
  { id: "AC-3", role: "indoor" },
];
const outOfContract: Client = { id: "c", name: "Acme", servicePlan: "None" };
const onPlan: Client = { id: "c", name: "Acme", servicePlan: "Annual service plan", planBilling: "visit" };
const kit = [{ id: "m", name: "Coil cleaner", qty: 1 }];

const price = (job: Partial<Job>, over: Partial<JobPricingInput> = {}) =>
  invoiceLines({
    job: { id: "j", status: "completed", ...job },
    system,
    client: outOfContract,
    units,
    info: { fgas: fgas({ refrigerant: "R410A", factoryChargeKg: 3 }) }, // 6.3 t: leak checks required
    prices,
    planPrice: "",
    quote: "",
    kit: () => kit,
    priceOf: () => ({ sell: 8.5, chargeable: true }),
    ...over,
  });

describe("invoiceLines", () => {
  it("charges an out-of-contract service per indoor unit, plus the mandatory leak check and the kit", () => {
    expect(price({ type: "Annual service", leakCheck: { performed: true } })).toEqual([
      {
        desc: "Annual air conditioning service – Office, 2 Low Rd HU1 2BB (first indoor unit + outdoor)",
        qty: 1,
        unit: 95,
      },
      { desc: "Additional indoor unit serviced", qty: 1, unit: 45 },
      { desc: "Mandatory F-gas leak check (6.26 t CO₂e)", qty: 1, unit: 40 },
      { desc: "Coil cleaner", qty: 1, unit: 8.5 },
    ]);
  });

  it("covers a plan client's service, charging only the plan price, refrigerant and extras", () => {
    const lines = price(
      {
        type: "Annual service",
        leakCheck: { performed: true, addedKg: 0.5 },
        materialsUsed: [
          { id: "m", name: "Coil cleaner", qty: 1 },
          { id: "x", name: "Drain pump", qty: 1, extra: true },
        ],
      },
      { client: onPlan, planPrice: 120 },
    );
    expect(lines.map((l) => [l.desc, l.qty, l.unit])).toEqual([
      ["Annual air conditioning service (service plan) – Office, 2 Low Rd HU1 2BB – 2 indoor units", 1, 120],
      ["R410A top-up (kg)", 0.5, 60],
      ["Drain pump", 1, 8.5],
    ]);
  });

  it("makes no lines for a plan visit paid outside Air Ledger", () => {
    expect(
      price(
        { type: "Annual service", materialsUsed: kit },
        { client: { ...onPlan, planBilling: "separate" } },
      ),
    ).toEqual([]);
  });

  it("charges a breakdown as a call-out plus hours after the first", () => {
    expect(
      price({ type: "Repair / breakdown", durationHrs: 2.5, materialsUsed: [] }).map((l) => [l.qty, l.unit]),
    ).toEqual([
      [1, 75],
      [1.5, 60],
    ]);
  });

  it("charges an install at its quote, or by the hour without one", () => {
    expect(price({ type: "Installation", materialsUsed: [] }, { quote: "2500" })[0]?.desc).toBe(
      "Supply and installation of air conditioning – Office, 2 Low Rd HU1 2BB (1 outdoor + 2 indoor)",
    );
    expect(price({ type: "Installation", durationHrs: 6, materialsUsed: [] })[0]).toMatchObject({
      qty: 6,
      unit: 60,
    });
  });
});

describe("invoiceTotals", () => {
  it("rounds each line to pence, then adds 20% VAT", () => {
    const lines = [
      { desc: "a", qty: 3, unit: 0.335 }, // 1.005 → 1.01 (in floating point, 1.0050000000000001)
      { desc: "b", qty: 1, unit: 99.99 },
    ];
    expect(invoiceTotals({ lines, vat: true })).toEqual({ net: 101, vat: 20.2, gross: 121.2 });
    expect(invoiceTotals({ lines, vat: false }).vat).toBe(0);
  });
});

describe("draftInvoice", () => {
  const lines = [{ desc: "Service", qty: 1, unit: 95 }];
  const settings = { invoicePrefix: "AC-", nextInvoiceNo: 1042, paymentDays: 14, vatRegistered: true };

  it("uses the next number and sets the due date and reference", () => {
    const r = draftInvoice({
      job: { id: "j", type: "Annual service" },
      system,
      client: outOfContract,
      lines,
      settings,
      today: "2026-10-30",
    });
    expect(r).toMatchObject({ billing: "charged", nextInvoiceNo: 1043 });
    expect(r.invoice).toMatchObject({
      number: "AC-1042",
      date: "2026-10-30",
      dueDate: "2026-11-13",
      reference: "Annual service HU1 2BB",
      vat: true,
      status: "draft",
    });
  });

  it("marks plan jobs with nothing to charge as covered, without an invoice", () => {
    const r = draftInvoice({
      job: { id: "j" },
      system,
      client: onPlan,
      lines: [],
      settings,
      today: "2026-10-30",
    });
    expect(r).toEqual({ billing: "plan", invoice: null, nextInvoiceNo: null });
  });

  it("marks plan jobs with extras as plan-extras", () => {
    expect(
      draftInvoice({ job: { id: "j" }, system, client: onPlan, lines, settings, today: "2026-10-30" })
        .billing,
    ).toBe("plan-extras");
  });
});
