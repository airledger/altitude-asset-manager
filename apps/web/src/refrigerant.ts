// Refrigerant log (part 2): the business's cylinders, and every kilo charged into or recovered from a system on
// a completed job. The log is a database view over the job records (refrigerant_log), so it always matches them.
import { REFRIGERANT_GWP, formatUk, type Cell } from "@airledger/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CylinderKind = "new" | "recovery";
export type CylinderStatus = "in_use" | "empty" | "returned";

export interface Cylinder {
  id: string;
  code: string;
  refrigerant: string;
  kind: CylinderKind;
  size_kg: number;
  supplier: string;
  holder: string;
  received_on: string;
  status: CylinderStatus;
  returned_on: string | null;
  notes: string;
  /** Charged from it (new gas) and recovered into it, from the job records. */
  used_kg: number;
  recovered_kg: number;
}

export type CylinderInput = Pick<
  Cylinder,
  "code" | "refrigerant" | "kind" | "size_kg" | "supplier" | "holder" | "received_on" | "notes"
>;

export interface LogRow {
  job_id: string;
  date: string | null;
  engineer: string;
  job_type: string;
  system_id: string;
  system_name: string;
  site_postcode: string;
  client_name: string;
  refrigerant: string;
  kind: "added" | "recovered";
  kg: number;
  cylinder_id: string | null;
}

export const KIND_LABEL: Record<CylinderKind, string> = { new: "New gas", recovery: "Recovery" };
export const STATUS_LABEL: Record<CylinderStatus, string> = {
  in_use: "In use",
  empty: "Empty",
  returned: "Returned",
};

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message);
};
const num = (v: unknown) => Number(v ?? 0);
const round = (n: number) => Math.round(n * 1000) / 1000;

export function refrigerantApi(sb: SupabaseClient, orgId: string) {
  return {
    async cylinders(): Promise<Cylinder[]> {
      const { data, error } = await sb
        .from("cylinder_levels")
        .select("*")
        .eq("org_id", orgId)
        .order("received_on", { ascending: false });
      fail(error);
      return ((data ?? []) as Cylinder[]).map((c) => ({
        ...c,
        size_kg: num(c.size_kg),
        used_kg: num(c.used_kg),
        recovered_kg: num(c.recovered_kg),
      }));
    },
    async save(c: CylinderInput, id?: string): Promise<void> {
      const { error } = id
        ? await sb.from("cylinders").update(c).eq("id", id)
        : await sb.from("cylinders").insert({ ...c, org_id: orgId });
      fail(error);
    },
    async setStatus(id: string, status: CylinderStatus, on: string | null = null): Promise<void> {
      const { error } = await sb
        .from("cylinders")
        .update({ status, returned_on: status === "returned" ? on : null })
        .eq("id", id);
      fail(error);
    },
    async remove(id: string): Promise<void> {
      const { data, error } = await sb.from("cylinders").delete().eq("id", id).select("id");
      fail(error);
      if (Array.isArray(data) && data.length === 0) throw new Error("Only an owner can delete a cylinder.");
    },
    async log(from: string, to: string): Promise<LogRow[]> {
      const { data, error } = await sb
        .from("refrigerant_log")
        .select("*")
        .eq("org_id", orgId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
        .limit(5000);
      fail(error);
      return ((data ?? []) as LogRow[]).map((r) => ({ ...r, kg: num(r.kg) }));
    },
  };
}

export type RefrigerantApi = ReturnType<typeof refrigerantApi>;

/** What's left in a new-gas cylinder, or what's in a recovery one. */
export const contents = (c: Cylinder) =>
  round(c.kind === "new" ? Math.max(0, c.size_kg - c.used_kg) : c.recovered_kg);

/** "6.3 of 9 kg left" / "4.2 kg recovered into a 12 kg cylinder" */
export const levelText = (c: Cylinder) =>
  c.kind === "new"
    ? `${contents(c)} of ${c.size_kg} kg left`
    : `${contents(c)} kg recovered into a ${c.size_kg} kg cylinder`;

/** How full it is, 0 to 1, for the bar. */
export const fullness = (c: Cylinder) => Math.min(1, Math.max(0, contents(c) / c.size_kg));

export const cylinderName = (c: Pick<Cylinder, "code" | "refrigerant" | "kind">) =>
  `${c.code || "No number"} · ${c.refrigerant} ${c.kind === "new" ? "new gas" : "recovery"}`;

const gwpOf = (refrigerant: string): number | null =>
  (REFRIGERANT_GWP as Record<string, number>)[refrigerant] ?? null;

export interface GasTotal {
  refrigerant: string;
  added: number;
  recovered: number;
  /** Tonnes CO₂e charged, when the refrigerant's GWP is known. */
  tonnes: number | null;
}

/** Totals by refrigerant, most charged first. */
export function totals(rows: LogRow[]): GasTotal[] {
  const by = new Map<string, GasTotal>();
  for (const r of rows) {
    const key = r.refrigerant || "Not set";
    const t = by.get(key) ?? { refrigerant: key, added: 0, recovered: 0, tonnes: null };
    if (r.kind === "added") t.added += r.kg;
    else t.recovered += r.kg;
    by.set(key, t);
  }
  return [...by.values()]
    .map((t) => {
      const gwp = gwpOf(t.refrigerant);
      return {
        ...t,
        added: round(t.added),
        recovered: round(t.recovered),
        tonnes: gwp == null ? null : Math.round(t.added * gwp) / 1000,
      };
    })
    .sort((a, b) => b.added - a.added || a.refrigerant.localeCompare(b.refrigerant));
}

/** Rows for the CSV, header first: one line per amount charged or recovered. */
export function logCsvRows(rows: LogRow[], cylinders: Cylinder[]): Cell[][] {
  const cyl = new Map(cylinders.map((c) => [c.id, c]));
  return [
    [
      "Date",
      "Client",
      "Install",
      "Postcode",
      "Job type",
      "Engineer",
      "Refrigerant",
      "GWP",
      "Charged kg",
      "Recovered kg",
      "Tonnes CO2e charged",
      "Cylinder",
      "Cylinder type",
    ],
    ...rows.map((r) => {
      const c = r.cylinder_id ? cyl.get(r.cylinder_id) : undefined;
      const gwp = gwpOf(r.refrigerant);
      return [
        formatUk(r.date),
        r.client_name,
        r.system_name,
        r.site_postcode,
        r.job_type,
        r.engineer,
        r.refrigerant,
        gwp ?? "",
        r.kind === "added" ? r.kg : "",
        r.kind === "recovered" ? r.kg : "",
        r.kind === "added" && gwp != null ? Math.round(r.kg * gwp) / 1000 : "",
        c?.code ?? "",
        c ? KIND_LABEL[c.kind] : "",
      ];
    }),
  ];
}

/** Cylinders an engineer can pick on a job: in use, of the right kind, the system's gas first. */
export function pickable<C extends Pick<Cylinder, "id" | "code" | "kind" | "status" | "refrigerant">>(
  all: C[],
  kind: CylinderKind,
  refrigerant: string,
  keep?: string | null,
) {
  return all
    .filter((c) => (c.status === "in_use" && c.kind === kind) || c.id === keep)
    .sort(
      (a, b) =>
        Number(b.refrigerant === refrigerant) - Number(a.refrigerant === refrigerant) ||
        a.code.localeCompare(b.code),
    );
}
