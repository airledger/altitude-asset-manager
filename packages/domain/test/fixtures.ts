// Made-up businesses for the comparison tests: a seeded random generator, so every run sees the same data,
// with values chosen to hit the edges (blank fields, string numbers, month ends, plan and non-plan clients).

import { addDays } from "../src/dates";
import { JOB_TYPES } from "../src/types";
import type { LegacyData } from "./legacy";

export function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}

const REFRIGERANTS = ["R32", "R410A", "R454B", "R290", "R407C", "R22", "Other", "", "R1234ze"];
const INDOOR = ["Wall mounted", "Cassette", "Ducted", "Floor console", "Ceiling suspended", "Other", ""];
const CONTROLLERS = ["Wireless remote", "Wired controller", "Wi-Fi / app", "None", "", undefined];
const FILTERS = ["Washable", "Replaceable", "None", "", undefined];
const APPLIES = [
  "visit",
  "indoor",
  "outdoor",
  "wall",
  "cassette",
  "ducted",
  "console",
  "pump",
  "filter",
  "remote",
  "",
  "junk",
];
const WHEN = ["service", "leak", "any", "pick", "", undefined];
const NAMES = [
  "Smith & Co, Ltd",
  'The "Old" Mill',
  "Ünïcode Café",
  "",
  "Brown\nHouse",
  "Acme Offices",
  "O'Neill Dental",
];
const MONEY = [95, "95", 45.5, "", undefined, 0, 12.345, "abc", 60, 1e3, 0.005];

export const TODAY = "2026-10-30";

export function makeBusiness(seed: number): LegacyData {
  const r = rng(seed);
  const date = (lo: number, hi: number) => addDays(TODAY, r.int(lo, hi));
  const maybe = <T>(v: T, p = 0.8) => (r.chance(p) ? v : undefined);

  const settings = {
    defaultInterval: r.pick([12, 6, "", "24", undefined]),
    reminderLeadDays: r.pick([30, 14, "60", 0]),
    chaseAfterDays: r.pick([14, 7, "21"]),
    warrantyYears: r.pick([5, 3, "", 0, "7"]),
    vatRegistered: r.chance(0.7),
    invoicePrefix: r.pick(["AC-", "INV", ""]),
    nextInvoiceNo: r.pick([1001, "1500", "", undefined]),
    paymentDays: r.pick([14, 30, "7"]),
    accountsApp: r.pick(["xero", "quickbooks", "sage", "", undefined]),
    accountCode: "200",
    taxType: "20% (VAT on Income)",
    trackingName: r.pick(["", "Region"]),
    trackingOption: "North",
    qbItem: "Services",
    qbTaxCode: "20.0% S",
    sageNominal: "4000",
    sageTaxCode: "T1",
    sageNoVatCode: "T9",
    labourFirst: r.pick(MONEY),
    labourAdditional: r.pick(MONEY),
    labourHourly: r.pick(MONEY),
    leakCheckCharge: r.pick(MONEY),
    refrigerantPerKg: r.pick(MONEY),
    calloutCharge: r.pick(MONEY),
  };

  const clients = Array.from({ length: r.int(1, 4) }, (_, i) => ({
    id: `c${seed}-${i}`,
    name: r.pick(NAMES),
    contactName: maybe("Pat Jones"),
    phone: maybe("07700 900123"),
    email: maybe(`c${i}@example.invalid`),
    billingAddress: r.pick([
      "1 High St, Leeds\nWest Yorks, Unit 4, Floor 2, extra",
      "",
      "Somewhere",
      undefined,
    ]),
    postcode: maybe("LS1 1AA"),
    servicePlan: r.pick(["None", "Annual service plan", "", undefined]),
    planBilling: r.pick(["separate", "visit", "", undefined]),
    xeroContactName: maybe("Xero Name", 0.3),
    sageRef: maybe("SAGE01", 0.3),
  }));

  const systems = clients.flatMap((c, ci) =>
    Array.from({ length: r.int(1, 3) }, (_, i) => ({
      id: `s${seed}-${ci}-${i}`,
      clientId: r.chance(0.95) ? c.id : "missing",
      name: r.pick(["Office", "Server room", "Shop floor"]),
      siteAddress: r.pick(["2 Low Rd, Hull", "Line one\nLine two", "", undefined]),
      sitePostcode: maybe("HU1 2BB"),
      installDate: r.chance(0.9)
        ? r.pick([date(-2000, 30), "2024-01-31", "2023-02-28", "2024-02-29"])
        : r.pick(["", null]),
      serviceIntervalMonths: r.pick(["", 6, 12, "3", undefined]),
      warrantyYears: r.pick(["", undefined, 2, "10", 0]),
      refrigerant: r.pick(REFRIGERANTS),
      gwp: r.pick(["", 1500, "2000", undefined]),
      factoryChargeKg: r.pick([1.2, 2.4, "3.5", 30, 300, "", 0.75, undefined]),
      addedChargeKg: r.pick([0, 0.5, "1.1", "", undefined]),
      hermetic: r.chance(0.3),
      leakDetection: r.chance(0.3),
      accessNotes: maybe("Key at reception; ring first", 0.4),
      inactive: r.chance(0.08),
      contactLog: Array.from({ length: r.int(0, 3) }, () => ({ date: date(-500, 0), method: "Email" })),
    })),
  );

  const units = systems.flatMap((s, si) =>
    Array.from({ length: r.int(0, 5) }, (_, i) => {
      const indoor = i > 0 || r.chance(0.2);
      return {
        id: `AC-${seed}${si}${i}`,
        systemId: s.id,
        role: indoor ? "indoor" : "outdoor",
        indoorType: indoor ? r.pick(INDOOR) : "",
        manufacturer: maybe("Daikin"),
        model: maybe("FTXM25R"),
        location: r.pick(["Office", "Hall", "", undefined]),
        filterType: r.pick(FILTERS),
        controller: r.pick(CONTROLLERS),
        condensatePump: r.chance(0.3),
      };
    }),
  );

  const materials = Array.from({ length: r.int(0, 6) }, (_, i) => ({
    id: `m${seed}-${i}`,
    name: r.pick(["Coil cleaner", "Filter", "Pump tablets", "Remote batteries", "Leak spray"]) + i,
    supplier: r.pick(["Wolseley", "Climate Center", "", undefined]),
    sku: maybe("SKU" + i),
    appliesTo: r.pick(APPLIES),
    qtyPer: r.pick([1, 0.25, "0.1", "", 2, undefined]),
    when: r.pick(WHEN),
    active: r.pick([true, false, undefined]),
    // Prices from before they moved to the owner-only list, on some materials.
    ...(r.chance(0.3) ? { cost: 2, sell: "4.5", chargeable: true } : {}),
  }));

  const pricing: object[] = [];
  if (r.chance(0.7))
    pricing.push({ id: "settings", labourFirst: r.pick(MONEY), labourHourly: r.pick([...MONEY, ""]) });
  for (const m of materials)
    if (r.chance(0.6))
      pricing.push({
        id: "mat:" + m.id,
        cost: r.pick(MONEY),
        sell: r.pick(MONEY),
        chargeable: r.pick([true, false, undefined]),
      });
  for (const c of clients)
    if (r.chance(0.5)) pricing.push({ id: "client:" + c.id, planPrice: r.pick([120, "99.99", "", 0]) });

  const jobs = systems.flatMap((s, si) =>
    Array.from({ length: r.int(0, 5) }, (_, i) => {
      const status = r.pick(["booked", "completed", "completed", "cancelled"]);
      const id = `j${seed}-${si}-${i}`;
      if (r.chance(0.4)) pricing.push({ id: "job:" + id, quote: r.pick([2500, "1999.5", "", 0]) });
      const mats = materials.filter(() => r.chance(0.5));
      return {
        id,
        systemId: s.id,
        type: r.pick(JOB_TYPES),
        status,
        date: r.chance(0.95) ? date(-700, 60) : "",
        time: r.pick(["09:00", "13:30", "23:15", "", undefined]),
        durationHrs: r.pick([1, 0.5, "2", "", 3.25, undefined, "0"]),
        notes: maybe("Bring ladder", 0.3),
        materialsOrdered: r.chance(0.2),
        materialsSnapshot: r.chance(0.2)
          ? [{ id: "m-old", name: "Old part", supplier: "X", qty: 2, raw: 1.5 }]
          : null,
        ...(status === "completed"
          ? {
              leakCheck: r.chance(0.6)
                ? { performed: r.chance(0.6), addedKg: r.pick([0, 0.4, "1.25", "", undefined]) }
                : undefined,
              materialsUsed: r.chance(0.7)
                ? mats.map((m) => ({
                    id: r.chance(0.9) ? m.id : "gone",
                    name: m.name,
                    sku: "",
                    supplier: "S",
                    qty: r.pick([0, 1, 2, 0.5]),
                    extra: r.chance(0.3),
                    ...(r.chance(0.2) ? { sell: 7, chargeable: true } : {}),
                  }))
                : undefined,
              toInvoice: true,
              billing: "charged",
              invoiceId: "i" + id,
            }
          : {}),
      };
    }),
  );

  const invoices = Array.from({ length: r.int(0, 4) }, (_, i) => ({
    id: `i${seed}-${i}`,
    clientId: r.pick([...clients.map((c) => c.id), "missing"]),
    number: `AC-${1000 + i}`,
    date: date(-30, 0),
    dueDate: r.chance(0.9) ? date(0, 30) : "",
    reference: r.pick(["Annual service HU1 2BB", "", 'Has "quotes", commas']),
    vat: r.chance(0.7),
    status: "draft",
    lines: Array.from({ length: r.int(1, 4) }, () => ({
      desc: r.pick([
        "Service",
        "A very long description that goes on past sixty characters for Sage, yes",
        "Parts, misc",
        "",
      ]),
      qty: r.pick([1, 2, 0.5, "3", 1.333]),
      unit: r.pick([95, 45.5, "12.345", 0.005, 1e3, 99.995]),
    })),
  }));

  const reports = jobs
    .filter(() => r.chance(0.2))
    .map((j, i) => ({
      id: `r${i}`,
      jobId: j.id,
      kind: "Site note",
      date: j.date,
      text: "Note " + i,
      createdAt: `2026-0${(i % 9) + 1}-01`,
    }));

  return { settings, clients, systems, units, jobs, materials, invoices, reports, pricing };
}
