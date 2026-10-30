// Parts needed for a job, and the order list. Rule source: specs/02-domain-model.md ("Materials needed for a job").

import { addDays, type IsoDate } from "./dates";
import type { SystemInfo } from "./service";
import { isServiceType, type Job, type Material, type MaterialLine, type Unit } from "./types";

export const APPLIES_TO = {
  visit: "Per visit",
  indoor: "Per indoor unit",
  outdoor: "Per outdoor unit",
  wall: "Per wall-mounted unit",
  cassette: "Per cassette",
  ducted: "Per ducted unit",
  console: "Per floor console",
  pump: "Per condensate pump",
  filter: "Per replaceable filter unit",
  remote: "Per wireless remote",
} as const;

export const NEEDED_WHEN = {
  service: "Services only",
  leak: "When leak check due",
  any: "Every job",
  pick: "Only when the engineer adds it",
} as const;

/** How many of a system's units a material is counted against. */
export function countFor(appliesTo: string, units: readonly Unit[]): number {
  const indoor = units.filter((u) => u.role === "indoor");
  const indoorOfType = (t: string) => indoor.filter((u) => u.indoorType === t).length;
  switch (appliesTo) {
    case "visit":
      return 1;
    case "indoor":
      return indoor.length;
    case "outdoor":
      return units.filter((u) => u.role === "outdoor").length;
    case "wall":
      return indoorOfType("Wall mounted");
    case "cassette":
      return indoorOfType("Cassette");
    case "ducted":
      return indoorOfType("Ducted");
    case "console":
      return indoorOfType("Floor console");
    case "pump":
      return units.filter((u) => u.condensatePump).length;
    case "filter":
      return indoor.filter((u) => u.filterType === "Replaceable").length;
    case "remote":
      // A blank controller counts as a wireless remote.
      return indoor.filter((u) => (u.controller || "Wireless remote") === "Wireless remote").length;
  }
  return 0;
}

/** The service kit worked out for a job from the materials catalogue. */
export function materialsForJob(
  job: Job,
  units: readonly Unit[],
  info: Pick<SystemInfo, "fgas" | "nextLeakCheck">,
  materials: readonly Material[],
  today: IsoDate,
): MaterialLine[] {
  const service = isServiceType(job.type);
  const leakDue =
    job.type === "Leak check" ||
    (info.fgas.required && !!info.nextLeakCheck && info.nextLeakCheck <= addDays(job.date || today, 31));
  const out: MaterialLine[] = [];
  for (const m of materials) {
    if (m.active === false) continue;
    const when = m.when || "service";
    if (when === "service" && !service) continue;
    if (when === "leak" && !leakDue) continue;
    if (when === "pick") continue;
    const count = countFor(m.appliesTo || "visit", units);
    if (!count) continue;
    const raw = count * (Number(m.qtyPer) || 1);
    out.push({
      id: m.id,
      name: m.name ?? "",
      sku: m.sku || "",
      supplier: m.supplier || "Unassigned",
      raw,
      // The tolerance stops 0.1 × 30 = 3.0000000000000004 rounding up to 4.
      qty: Math.ceil(raw - 1e-9),
    });
  }
  return out;
}

/** A job's parts list: frozen when ordered, what was used once completed, otherwise worked out. */
export function jobMaterials(job: Job, calculate: () => MaterialLine[]): MaterialLine[] {
  return (
    (job.materialsOrdered && job.materialsSnapshot) ||
    (job.status === "completed" && job.materialsUsed) ||
    calculate()
  );
}

/** Adds up parts lists across jobs for the order list, by supplier then name. */
export function aggregateOrder(lists: readonly (readonly MaterialLine[])[]): MaterialLine[] {
  const byKey = new Map<string, MaterialLine & { raw: number }>();
  for (const list of lists)
    for (const line of list) {
      const key = line.id || line.name;
      const entry = byKey.get(key) ?? { ...line, raw: 0 };
      // Lines from the live app always carry raw; qty is the fallback for hand-made lines.
      entry.raw += line.raw ?? line.qty;
      byKey.set(key, entry);
    }
  return [...byKey.values()]
    .map((x) => ({ ...x, qty: Math.ceil(x.raw - 1e-9) }))
    .sort((a, b) => (a.supplier ?? "").localeCompare(b.supplier ?? "") || a.name.localeCompare(b.name));
}
