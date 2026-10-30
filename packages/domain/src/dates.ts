// Dates are ISO calendar days ("2026-10-30") in UK local time, with no time of day.
export type IsoDate = string;

const parse = (iso: IsoDate): [number, number, number] => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Not an ISO date: ${iso}`);
  return [y, m, d];
};

/** Adds whole months, clamping to the last day of the month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const [y, m, d] = parse(iso);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const t = new Date(iso + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Whole days from `today` to `iso` (negative when `iso` is in the past). */
export function daysBetween(today: IsoDate, iso: IsoDate): number {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000);
}
