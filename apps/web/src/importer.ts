// Import (spec: switching from other software): read a spreadsheet saved as CSV, match its columns to Air Ledger's,
// check every row, and send it to import_rows in batches. Each import can be undone.
import type { SupabaseClient } from "@supabase/supabase-js";

/** Air Ledger's fields a column can fill, in the order they're shown. */
export const FIELDS = [
  { key: "client_name", label: "Client name", group: "Client", required: true },
  { key: "client_ref", label: "Client reference (from your old system)", group: "Client" },
  { key: "contact_name", label: "Contact name", group: "Client" },
  { key: "email", label: "Email", group: "Client" },
  { key: "phone", label: "Phone", group: "Client" },
  { key: "billing_address", label: "Billing address", group: "Client" },
  { key: "postcode", label: "Billing postcode", group: "Client" },
  { key: "site_name", label: "Install or site name", group: "Install" },
  { key: "site_ref", label: "Install reference (from your old system)", group: "Install" },
  { key: "site_address", label: "Site address", group: "Install" },
  { key: "site_postcode", label: "Site postcode", group: "Install" },
  { key: "install_date", label: "Install date", group: "Install" },
  { key: "refrigerant", label: "Refrigerant", group: "Install" },
  { key: "charge_kg", label: "Refrigerant charge (kg)", group: "Install" },
  { key: "interval_months", label: "Service every (months)", group: "Install" },
  { key: "last_service", label: "Last service date", group: "Install" },
  { key: "role", label: "Indoor or outdoor", group: "Unit" },
  { key: "indoor_type", label: "Indoor type (wall, cassette…)", group: "Unit" },
  { key: "manufacturer", label: "Manufacturer", group: "Unit" },
  { key: "model", label: "Model", group: "Unit" },
  { key: "serial", label: "Serial number", group: "Unit" },
  { key: "capacity_kw", label: "Capacity (kW)", group: "Unit" },
  { key: "location", label: "Unit location", group: "Unit" },
] as const;
export type FieldKey = (typeof FIELDS)[number]["key"];
export type Mapping = Partial<Record<FieldKey, number>>;

/** Words other systems use for each field's column heading. */
const ALIASES: Record<FieldKey, string[]> = {
  client_name: [
    "client",
    "client name",
    "customer",
    "customer name",
    "company",
    "company name",
    "account",
    "account name",
    "name",
  ],
  client_ref: [
    "client ref",
    "client reference",
    "customer ref",
    "customer reference",
    "customer id",
    "client id",
    "account number",
    "account no",
    "customer number",
    "customer no",
  ],
  contact_name: ["contact", "contact name", "main contact", "contact person"],
  email: ["email", "e-mail", "email address", "contact email"],
  phone: ["phone", "telephone", "tel", "mobile", "phone number", "contact number", "mobile number"],
  billing_address: ["billing address", "address", "invoice address", "customer address"],
  postcode: ["billing postcode", "postcode", "post code", "zip", "postal code"],
  site_name: ["site", "site name", "install", "installation", "system", "system name", "property"],
  site_ref: ["site ref", "site reference", "site id", "system id", "install id", "property id"],
  site_address: ["site address", "installation address", "property address", "job address"],
  site_postcode: [
    "site postcode",
    "site post code",
    "installation postcode",
    "property postcode",
    "job postcode",
  ],
  install_date: [
    "install date",
    "installation date",
    "installed",
    "date installed",
    "commissioned",
    "commissioning date",
  ],
  refrigerant: ["refrigerant", "gas", "refrigerant type", "gas type"],
  charge_kg: [
    "charge",
    "charge kg",
    "refrigerant charge",
    "gas charge",
    "charge (kg)",
    "factory charge",
    "total charge",
  ],
  interval_months: ["service interval", "interval", "service frequency", "frequency", "interval months"],
  last_service: [
    "last service",
    "last service date",
    "last serviced",
    "last visit",
    "date of last service",
    "serviced",
  ],
  role: ["indoor/outdoor", "indoor or outdoor", "role", "unit type", "type", "in/out"],
  indoor_type: ["indoor type", "indoor unit type", "style", "head type", "mounting"],
  manufacturer: ["manufacturer", "make", "brand"],
  model: ["model", "model number", "model no", "unit model"],
  serial: ["serial", "serial number", "serial no", "s/n", "sn"],
  capacity_kw: ["capacity", "capacity kw", "kw", "size", "capacity (kw)", "cooling capacity", "output"],
  location: ["location", "unit location", "room", "position", "area"],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\-.:#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Reads CSV text (commas, semicolons or tabs; quoted fields; Excel's byte-order mark). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0] ?? ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Matches the file's headings to Air Ledger's fields; each heading is used once. */
export function guessMapping(headers: string[]): Mapping {
  const out: Mapping = {};
  const used = new Set<number>();
  const heads = headers.map(norm);
  // Exact names first, so "site postcode" isn't taken by "postcode".
  for (const pass of ["exact", "contains"] as const)
    for (const f of FIELDS) {
      if (out[f.key] !== undefined) continue;
      const i = heads.findIndex(
        (h, i) =>
          !used.has(i) &&
          (pass === "exact"
            ? h === norm(f.label) || ALIASES[f.key].includes(h)
            : ALIASES[f.key].some((a) => a.length > 3 && h.includes(a))),
      );
      if (i >= 0) {
        out[f.key] = i;
        used.add(i);
      }
    }
  return out;
}

/** A date as YYYY-MM-DD from 2026-03-01, 01/03/2026, 1.3.26, 1 Mar 2026 and the like (UK day-first). */
export function parseDate(raw: string): string | null | "bad" {
  const s = raw.trim();
  if (!s) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const ok = (y: number, m: number, d: number) => {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y &&
      t.getUTCMonth() === m - 1 &&
      t.getUTCDate() === d &&
      y >= 1950 &&
      y <= 2100
      ? `${y}-${pad(m)}-${pad(d)}`
      : "bad";
  };
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mon = (t: string) => months.indexOf(t.slice(0, 3).toLowerCase()) + 1;
  const [, y1 = "", m1 = "", d1 = ""] = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s) ?? [];
  if (y1) return ok(+y1, +m1, +d1);
  const [, d2 = "", m2 = "", y2 = ""] = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s) ?? [];
  if (d2) return ok(y2.length === 2 ? 2000 + +y2 : +y2, +m2, +d2);
  const [, d3 = "", m3 = "", y3 = ""] =
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i.exec(s) ?? [];
  if (d3) return mon(m3) ? ok(+y3, mon(m3), +d3) : "bad";
  const [, m4 = "", y4 = ""] = /^([a-z]{3})[a-z]*\.?\s+(\d{4})$/i.exec(s) ?? [];
  if (m4) return mon(m4) ? ok(+y4, mon(m4), 1) : "bad";
  return "bad";
}

/** A number from "3.5", "3.5kW", "1,2 kg" or "£" free text; null if blank, "bad" if not a number. */
export function parseNumber(raw: string): number | null | "bad" {
  const s = raw
    .trim()
    .replace(/(kw|kg|months?|mths?)$/i, "")
    .trim()
    .replace(/^(\d+),(\d+)$/, "$1.$2");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : "bad";
}

const INDOOR_TYPES: [RegExp, string][] = [
  [/wall|hi.?wall|split/i, "Wall mounted"],
  [/cassette|ceiling cassette|4.?way/i, "Cassette"],
  [/duct/i, "Ducted"],
  [/floor|console/i, "Floor console"],
  [/suspend|under.?ceiling/i, "Ceiling suspended"],
];

export interface ImportRow {
  client: Record<string, string>;
  system: Record<string, string | number | null>;
  unit: Record<string, string | number | null> | null;
  last_service: string | null;
}
export interface Checked {
  rows: ImportRow[];
  /** Row numbers as people see them in their spreadsheet (heading is row 1). */
  problems: { row: number; message: string }[];
  clients: number;
  systems: number;
  units: number;
  services: number;
}

/** Turns the file's rows into what import_rows takes, and lists anything that needs fixing first. */
export function checkRows(data: string[][], map: Mapping): Checked {
  const rows: ImportRow[] = [];
  const problems: Checked["problems"] = [];
  const clients = new Set<string>();
  const systems = new Set<string>();
  let units = 0;
  let services = 0;
  data.forEach((cells, i) => {
    const n = i + 2;
    const get = (k: FieldKey) => {
      const at = map[k];
      return at === undefined ? "" : (cells[at] ?? "").trim();
    };
    const name = get("client_name");
    if (!name) {
      problems.push({ row: n, message: "No client name" });
      return;
    }
    const date = (k: FieldKey, label: string) => {
      const d = parseDate(get(k));
      if (d === "bad") problems.push({ row: n, message: `${label} "${get(k)}" isn't a date we understand` });
      return d === "bad" ? null : d;
    };
    const num = (k: FieldKey, label: string, max: number) => {
      const v = parseNumber(get(k));
      if (v === "bad" || (v !== null && v > max)) {
        problems.push({ row: n, message: `${label} "${get(k)}" isn't a number we can use` });
        return null;
      }
      return v;
    };
    const email = get("email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      problems.push({ row: n, message: `Email "${email}" doesn't look right` });
    const installDate = date("install_date", "Install date");
    const last = date("last_service", "Last service date");
    if (last && last > new Date().toISOString().slice(0, 10))
      problems.push({ row: n, message: "The last service date is in the future" });
    const interval = num("interval_months", "Service interval", 120);
    const roleText = get("role").toLowerCase();
    const typeText = `${get("indoor_type")} ${roleText}`;
    const role = /out|condens|odu|external/.test(roleText) ? "outdoor" : "indoor";
    const unitBits = [
      "manufacturer",
      "model",
      "serial",
      "location",
      "capacity_kw",
      "role",
      "indoor_type",
    ] as const;
    const hasUnit = unitBits.some((k) => get(k) !== "");
    const capacity = num("capacity_kw", "Capacity", 1000);
    const unit = hasUnit
      ? {
          role,
          indoor_type:
            role === "indoor" ? (INDOOR_TYPES.find(([re]) => re.test(typeText))?.[1] ?? null) : null,
          manufacturer: get("manufacturer"),
          model: get("model"),
          serial: get("serial"),
          capacity_kw: capacity,
          location: get("location"),
        }
      : null;
    const row: ImportRow = {
      client: {
        name,
        ref: get("client_ref"),
        contact_name: get("contact_name"),
        email,
        phone: get("phone"),
        billing_address: get("billing_address"),
        postcode: get("postcode"),
      },
      system: {
        name: get("site_name"),
        ref: get("site_ref"),
        site_address: get("site_address"),
        site_postcode: get("site_postcode") || get("postcode"),
        install_date: installDate,
        refrigerant: get("refrigerant").toUpperCase().replace(/\s+/g, ""),
        factory_charge_kg: num("charge_kg", "Refrigerant charge", 1000),
        service_interval_months: interval === null ? null : Math.max(1, Math.round(interval)),
      },
      unit,
      last_service: last,
    };
    rows.push(row);
    const clientKey = row.client.ref || name.toLowerCase();
    clients.add(clientKey);
    systems.add(
      `${clientKey}|${String(row.system.ref || row.system.name || row.system.site_address || "").toLowerCase()}|${String(row.system.site_postcode).replace(/\s/g, "").toLowerCase()}`,
    );
    if (unit) units++;
    if (last) services++;
  });
  return { rows, problems, clients: clients.size, systems: systems.size, units, services };
}

/** A starter spreadsheet with every column Air Ledger reads, and one example row. */
export function templateRows(): string[][] {
  return [
    FIELDS.map((f) => f.label),
    [
      "Harbour Dental",
      "C-1001",
      "Pat Lee",
      "pat@harbourdental.co.uk",
      "07700 900123",
      "1 Quay St, Poole",
      "BH15 1AA",
      "Surgery",
      "S-2001",
      "1 Quay St, Poole",
      "BH15 1AA",
      "01/03/2025",
      "R32",
      "1.2",
      "12",
      "01/03/2026",
      "Indoor",
      "Wall mounted",
      "Daikin",
      "FTXM25R",
      "K012345",
      "2.5",
      "Reception",
    ],
  ];
}

export interface ImportRecord {
  id: string;
  file_name: string;
  clients: number;
  systems: number;
  units: number;
  jobs: number;
  created_at: string;
  undone_at: string | null;
}

const BATCH = 250;

export function importApi(sb: SupabaseClient, orgId: string) {
  return {
    /** Sends the rows in batches; `progress` hears how many are done. Returns the import's id and totals. */
    async run(
      file: string,
      rows: ImportRow[],
      progress: (done: number) => void,
    ): Promise<{ id: string; clients: number; systems: number; units: number; jobs: number }> {
      let id: string | null = null;
      const total = { clients: 0, systems: 0, units: 0, jobs: 0 };
      for (let i = 0; i < rows.length; i += BATCH) {
        const { data, error } = await sb.rpc("import_rows", {
          p_org: orgId,
          p_import: id,
          p_file: file,
          p_rows: rows.slice(i, i + BATCH),
        });
        if (error)
          throw new Error(
            i === 0
              ? error.message
              : `${error.message}. The first ${i} rows went in; undo the import below to start again.`,
          );
        const r = data as { import: string; clients: number; systems: number; units: number; jobs: number };
        id = r.import;
        total.clients += r.clients;
        total.systems += r.systems;
        total.units += r.units;
        total.jobs += r.jobs;
        progress(Math.min(rows.length, i + BATCH));
      }
      return { id: id ?? "", ...total };
    },
    async history(): Promise<ImportRecord[]> {
      const { data, error } = await sb
        .from("imports")
        .select("id, file_name, clients, systems, units, jobs, created_at, undone_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return (data as ImportRecord[] | null) ?? [];
    },
    async undo(id: string): Promise<void> {
      const { error } = await sb.rpc("undo_import", { p_import: id });
      if (error) throw new Error(error.message);
    },
  };
}

export type ImportApi = ReturnType<typeof importApi>;
