// Equipment and parts catalogue (part 2): Air Ledger's shared list of manufacturers, ranges and sizes, plus the
// models each business has typed in before (learned by the database, with their refrigerant and factory
// charge once the install has them). Pick from it or type: typing always works.

export interface EquipmentModel {
  id: string;
  org_id: string | null;
  manufacturer: string;
  range: string;
  model: string;
  role: "indoor" | "outdoor";
  indoor_type: string | null;
  capacity_kw: number | null;
  refrigerant: string;
  charge_kg: number | null;
}

export interface CataloguePart {
  name: string;
  applies_to: string;
  qty_per: number;
  needed_when: string;
}

/** What a business's own typed-in models are listed under. */
export const OWN_RANGE = "Your models";

const key = (s: string) => s.trim().toLowerCase();
const byName = (a: string, b: string) => a.localeCompare(b, "en-GB", { sensitivity: "base" });

/** The business's own entry wins over Air Ledger's for the same model (it knows the charge). */
function merged(list: EquipmentModel[]): EquipmentModel[] {
  const own = new Map(
    list.filter((e) => e.org_id && e.model).map((e) => [`${key(e.manufacturer)}|${key(e.model)}`, e]),
  );
  return list
    .filter((e) => e.org_id || !e.model || !own.has(`${key(e.manufacturer)}|${key(e.model)}`))
    .map((e) => {
      if (e.org_id) {
        // Keep the shared entry's range, if the model is one of Air Ledger's.
        const shared = list.find(
          (s) =>
            !s.org_id &&
            s.model &&
            key(s.model) === key(e.model) &&
            key(s.manufacturer) === key(e.manufacturer),
        );
        return {
          ...e,
          range: e.range || shared?.range || OWN_RANGE,
          indoor_type: e.indoor_type ?? shared?.indoor_type ?? null,
        };
      }
      return e;
    });
}

export function manufacturers(list: EquipmentModel[], role?: string): string[] {
  const seen = new Map<string, string>();
  for (const e of list)
    if (!role || e.role === role)
      seen.set(key(e.manufacturer), seen.get(key(e.manufacturer)) ?? e.manufacturer.trim());
  return [...seen.values()].sort(byName);
}

export function ranges(list: EquipmentModel[], manufacturer: string, role: string): string[] {
  const out = new Set<string>();
  for (const e of merged(list))
    if (e.role === role && key(e.manufacturer) === key(manufacturer)) out.add(e.range || OWN_RANGE);
  return [...out].sort((a, b) => (a === OWN_RANGE ? -1 : b === OWN_RANGE ? 1 : byName(a, b)));
}

export function sizes(
  list: EquipmentModel[],
  manufacturer: string,
  range: string,
  role: string,
): EquipmentModel[] {
  return merged(list)
    .filter(
      (e) => e.role === role && key(e.manufacturer) === key(manufacturer) && (e.range || OWN_RANGE) === range,
    )
    .sort((a, b) => (a.capacity_kw ?? 0) - (b.capacity_kw ?? 0) || byName(a.model, b.model));
}

/** "2.5 kW · FTXM25R · Wall mounted" */
export const sizeLabel = (e: EquipmentModel) =>
  [e.capacity_kw != null ? `${e.capacity_kw} kW` : "", e.model, e.indoor_type ?? ""]
    .filter(Boolean)
    .join(" · ") || "Unnamed";

/** Models already known for this manufacturer, for the model box's suggestions. */
export function modelsFor(list: EquipmentModel[], manufacturer: string, role: string): string[] {
  return [
    ...new Set(
      merged(list)
        .filter((e) => e.model && e.role === role && key(e.manufacturer) === key(manufacturer))
        .map((e) => e.model),
    ),
  ].sort(byName);
}

/** The catalogue entry for a typed manufacturer and model, the business's own first. */
export function findModel(
  list: EquipmentModel[],
  manufacturer: string,
  model: string,
): EquipmentModel | null {
  if (!manufacturer.trim() || !model.trim()) return null;
  return (
    merged(list).find(
      (e) => e.model && key(e.manufacturer) === key(manufacturer) && key(e.model) === key(model),
    ) ?? null
  );
}
