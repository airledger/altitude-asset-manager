// Golden files: a fixed set of invoices must always export to exactly these bytes. The files were made by the
// live app's export code (UPDATE_GOLDEN=1 rewrites them from it), and stay as the reference after cut-over.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { quickbooksRows, sageRows, toCsv, xeroRows, type Client, type Invoice, type Settings } from "../src";
import { loadLegacy, type LegacyData } from "./legacy";

const dir = resolve(import.meta.dirname, "golden");
const input = JSON.parse(readFileSync(resolve(dir, "invoices.json"), "utf8")) as {
  settings: Settings;
  clients: Client[];
  invoices: Invoice[];
};
const clientOf = (id: string | undefined) => input.clients.find((c) => c.id === id);

const formats = { xero: xeroRows, quickbooks: quickbooksRows, sage: sageRows };
const legacyNames = { xero: "xeroRows", quickbooks: "quickbooksRows", sage: "sageRows" } as const;

describe.each(Object.keys(formats) as (keyof typeof formats)[])("%s export", (app) => {
  const file = resolve(dir, `${app}.csv`);
  const L = loadLegacy("2026-10-30", {
    ...input,
    systems: [],
    units: [],
    jobs: [],
    materials: [],
    reports: [],
    pricing: [],
  } as unknown as LegacyData);
  const live = L.toCSV(L[legacyNames[app]](input.invoices, input.settings)) as string;
  if (process.env.UPDATE_GOLDEN) writeFileSync(file, live);
  const golden = readFileSync(file, "utf8");

  it("matches the golden file byte for byte", () =>
    expect(toCsv(formats[app](input.invoices, input.settings, clientOf))).toBe(golden));
  it("is still what the live app makes", () => expect(live).toBe(golden));
});
