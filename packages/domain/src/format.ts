import type { IsoDate } from "./dates";
import { toNum, type Num } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-30" → "30 Oct 2026"; blank → "—". */
export function formatDate(iso: IsoDate | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** "2026-10-30" → "30/10/2026" (accounts CSVs); blank → "". */
export function formatUk(iso: IsoDate | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Rounds to pence the way the live app does (half away from zero only for positive values, like Math.round). */
export const roundPence = (n: Num): number => Math.round(toNum(n) * 100) / 100;

/** Up to `dp` decimal places, en-GB grouping ("1,234.5"). */
export const formatNumber = (n: Num, dp = 2): string =>
  toNum(n).toLocaleString("en-GB", { maximumFractionDigits: dp });
