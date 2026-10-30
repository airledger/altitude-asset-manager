// F-gas leak check interval. Rule source: specs/02-domain-model.md ("F-gas leak check interval").

export const REFRIGERANT_GWP = {
  R32: 675,
  R410A: 2088,
  R454B: 466,
  R452B: 698,
  R290: 3,
  R407C: 1774,
  R134a: 1430,
  R513A: 631,
  R1234ze: 7,
  R744: 1,
  R22: 1810,
} as const;

export type Refrigerant = keyof typeof REFRIGERANT_GWP;

export interface FgasInput {
  refrigerant: Refrigerant | "Other" | string;
  /** Only used when the refrigerant isn't in the table. */
  gwp?: number | null;
  factoryChargeKg?: number | null;
  addedChargeKg?: number | null;
  hermetic?: boolean;
  leakDetection?: boolean;
}

export interface Fgas {
  gwp: number;
  kg: number;
  tonnesCo2e: number;
  /** Months between leak checks, or 0 when none are required. */
  months: number;
  required: boolean;
  /** CO₂e threshold that applied (5 t, or 10 t for hermetically sealed systems). */
  threshold: number;
}

export function fgas(sys: FgasInput): Fgas {
  const gwp = (REFRIGERANT_GWP as Record<string, number>)[sys.refrigerant] ?? (Number(sys.gwp) || 0);
  const kg = (Number(sys.factoryChargeKg) || 0) + (Number(sys.addedChargeKg) || 0);
  const tonnesCo2e = (kg * gwp) / 1000;
  const threshold = sys.hermetic ? 10 : 5;
  let months = 0;
  if (tonnesCo2e >= 500) months = 3;
  else if (tonnesCo2e >= 50) months = 6;
  else if (tonnesCo2e >= threshold) months = 12;
  if (months && sys.leakDetection) months *= 2;
  return { gwp, kg, tonnesCo2e, months, required: months > 0, threshold };
}
