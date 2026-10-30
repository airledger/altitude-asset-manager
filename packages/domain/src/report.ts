// Service report references and the record fingerprint. Rule source: specs/02-domain-model.md ("Service report").

import { isInstallType, type Client, type Job, type SiteRecord, type System, type Unit } from "./types";
import { STICKER_ALPHABET } from "./stickers";
import type { IsoDate } from "./dates";

/** "SR-261030-XXXX" (installs "CR-…"). */
export function newReportRef(
  job: Job,
  today: IsoDate,
  random: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n)),
): string {
  const code = Array.from(random(4), (x) => STICKER_ALPHABET[x % STICKER_ALPHABET.length]).join("");
  return (isInstallType(job.type) ? "CR-" : "SR-") + today.slice(2).replace(/-/g, "") + "-" + code;
}

/** JSON with sorted keys and undefined values left out, so the same record always gives the same text. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (
      "{" +
      Object.keys(o)
        .sort()
        .filter((k) => o[k] !== undefined)
        .map((k) => JSON.stringify(k) + ":" + stableJson(o[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(v);
}

const pick = (o: object, keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown>)[k] ?? ""]));

/** Everything a service report states. Billing fields are left out: invoicing a job doesn't change what was done. */
export function reportSnapshot(args: {
  job: Job;
  system: System | undefined;
  client: Client | undefined;
  /** In display order (see sortUnits). */
  units: readonly Unit[];
  /** The job's site records, oldest first. */
  records: readonly SiteRecord[];
}): unknown {
  const left = new Set(["serviceReports", "invoiceId", "toInvoice", "billing"]);
  const job = Object.fromEntries(Object.entries(args.job).filter(([k]) => !left.has(k)));
  return {
    job,
    system: pick(args.system ?? {}, [
      "name",
      "siteAddress",
      "sitePostcode",
      "refrigerant",
      "factoryChargeKg",
      "addedChargeKg",
    ]),
    client: pick(args.client ?? {}, ["name", "contactName", "phone", "email", "billingAddress", "postcode"]),
    units: args.units.map((u) =>
      pick(u, ["id", "role", "indoorType", "manufacturer", "model", "serial", "location"]),
    ),
    reports: args.records.map((r) => pick(r, ["kind", "date", "author", "text", "photos", "unitId"])),
  };
}

/** SHA-256 (hex) of the report snapshot. If it changes after a report is issued, the job page says so. */
export async function reportFingerprint(snapshot: unknown): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(snapshot)));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
