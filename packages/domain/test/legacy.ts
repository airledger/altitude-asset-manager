// Loads the rule functions from the live app (index.html and its scripts at the repo root) into a sandbox,
// so tests can check the new code gives the same answers as the code people use today.
// The live app is frozen apart from bug fixes during the rebuild; if a fix changes a rule, these tests
// fail until the same fix is made here.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";

const ROOT = resolve(import.meta.dirname, "../../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

/** The source of `function name(...) {...}`, found by matching braces. */
function fn(src: string, name: string): string {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  if (start < 0) throw new Error(`Live app has no function ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`Couldn't find the end of ${name}`);
}

/** A one-line `const name = ...;` declaration. */
function constLine(src: string, name: string): string {
  const m = src.match(new RegExp(`^\\s*const ${name}\\s*=.*$`, "m"));
  if (!m) throw new Error(`Live app has no const ${name}`);
  return m[0].trim();
}

export interface LegacyData {
  settings: Record<string, unknown>;
  clients: object[];
  systems: object[];
  units: object[];
  jobs: object[];
  materials: object[];
  invoices: object[];
  reports: object[];
  pricing: object[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the live app is untyped JavaScript
export type Legacy = any;

export function loadLegacy(today: string, data: LegacyData): Legacy {
  const html = read("index.html");
  const main = html.slice(html.indexOf('<script>\n"use strict";'), html.lastIndexOf("</script>"));
  const calendar = read("calendar.js");
  const report = read("service-report.js");

  const consts = ["REFRIGERANTS", "SERVICE_TYPES", "INSTALL_TYPES", "isInstall", "MON"];
  const lookups = ["client", "system", "unit", "job", "invoice", "unitsOf", "systemsOf", "jobsOf"];
  const fns = [
    "addMonths",
    "addDays",
    "daysUntil",
    "fmtDate",
    "fmtUK",
    "r2",
    "num",
    "byDateDesc",
    "byDateAsc",
    "clone",
    "unitLabel",
    "unitsSummary",
    "siteShort",
    "fgas",
    "sysInfo",
    "dueStatus",
    "countFor",
    "materialsFor",
    "jobMaterials",
    "aggregate",
    "invTotals",
    "invoiceLines",
    "toCSV",
    "xeroRows",
    "quickbooksRows",
    "sageRef",
    "sageRows",
    "parseScan",
    "icsEsc",
    "icsFold",
    "icsDT",
    "calEvent",
    "buildICS",
    "appUrl",
  ];

  const code = [
    ...consts.map((c) => constLine(main, c)),
    ...lookups.map((c) => constLine(main, c)),
    ...fns.map((f) => fn(main, f)),
    // Billing runs whole: it only defines things at load time.
    read("billing.js"),
    constLine(calendar, "q"),
    fn(calendar, "ukOffset"),
    fn(calendar, "googleLink"),
    fn(calendar, "outlookLink"),
    fn(report, "stable"),
    fn(report, "sha256"),
    fn(report, "snapshot"),
    constLine(report, "jobReports"),
    constLine(report, "fingerprint"),
    `globalThis.L = {${[...fns, "googleLink", "outlookLink", "fingerprint", "stable", "snapshot"].join(",")},
      Billing, set, sysInfo};`,
  ].join("\n");

  const ctx = createContext({
    S: data,
    set: () => ({ ...data.settings }),
    todayISO: () => today,
    APP_URL_DEFAULT: "https://app.example/",
    Biz: { isOwner: true },
    crypto: globalThis.crypto,
    TextEncoder,
    Intl,
  });
  runInContext(code, ctx);
  return (ctx as unknown as { L: Legacy }).L;
}
