// Service due dates, leak check dates, warranty and the due status shown on every system.
// Rule source: specs/02-domain-model.md ("Service due", "Due status").

import { addDays, addMonths, daysBetween, type IsoDate } from "./dates";
import { fgas, type Fgas } from "./fgas";
import { formatDate } from "./format";
import { isServiceType, type ContactLogEntry, type Job, type Settings, type System } from "./types";

/** Defaults for the settings these rules read (spec 02, "Business settings"). */
export const RULE_DEFAULTS = {
  defaultInterval: 12,
  reminderLeadDays: 30,
  chaseAfterDays: 14,
  warrantyYears: 5,
} as const;

const byDateDesc = (a: Job, b: Job) =>
  (b.date ?? "").localeCompare(a.date ?? "") || (b.time ?? "").localeCompare(a.time ?? "");
const byDateAsc = (a: Job, b: Job) =>
  (a.date ?? "").localeCompare(b.date ?? "") || (a.time ?? "").localeCompare(b.time ?? "");

export interface SystemInfo {
  /** Date of the last completed service, if any. */
  lastService: IsoDate | null;
  nextDue: IsoDate | null;
  intervalMonths: number;
  fgas: Fgas;
  lastLeakCheck: IsoDate | null;
  nextLeakCheck: IsoDate | null;
  /** Booked jobs, soonest first. */
  upcoming: Job[];
  /** The soonest booked service job. */
  booked: Job | null;
  /** The latest contact logged this cycle. */
  lastContact: ContactLogEntry | null;
  warrantyEnd: IsoDate | null;
  /** Completed jobs, newest first. */
  completed: Job[];
}

/**
 * Works out a system's dates from its jobs.
 * @param jobs the system's jobs, in stored order (ties on date and time keep that order).
 */
export function systemInfo(
  sys: System,
  jobs: readonly Job[],
  settings: Settings,
  today: IsoDate,
): SystemInfo {
  const completed = jobs.filter((j) => j.status === "completed").sort(byDateDesc);
  const lastService = completed.find((j) => isServiceType(j.type))?.date ?? null;
  const intervalMonths = Number(sys.serviceIntervalMonths) || Number(settings.defaultInterval) || 12;
  const base = lastService || sys.installDate;
  const nextDue = base ? addMonths(base, intervalMonths) : null;

  const f = fgas({
    refrigerant: sys.refrigerant ?? "",
    gwp: Number(sys.gwp) || 0,
    factoryChargeKg: Number(sys.factoryChargeKg) || 0,
    addedChargeKg: Number(sys.addedChargeKg) || 0,
    hermetic: !!sys.hermetic,
    leakDetection: !!sys.leakDetection,
  });
  const lastLeakCheck = completed.find((j) => j.leakCheck?.performed)?.date ?? null;
  const leakBase = lastLeakCheck || sys.installDate;
  const nextLeakCheck = f.required && leakBase ? addMonths(leakBase, f.months) : null;

  const upcoming = jobs.filter((j) => j.status === "booked").sort(byDateAsc);
  const booked = upcoming.find((j) => isServiceType(j.type)) ?? null;

  // Contacts count for this cycle if they're on or after the last service (or install) and less than
  // 120 days before the due date. The latest one logged wins.
  const cycleStart = lastService || sys.installDate || "";
  const windowStart = addDays(nextDue || today, -120);
  const contacts = (sys.contactLog ?? []).filter((c) => c.date >= cycleStart && c.date > windowStart);
  const lastContact = contacts.at(-1) ?? null;

  const ownYears = sys.warrantyYears;
  const years = ownYears === "" || ownYears == null ? Number(settings.warrantyYears) : Number(ownYears);
  const warrantyEnd = sys.installDate && years ? addMonths(sys.installDate, 12 * years) : null;

  return {
    lastService,
    nextDue,
    intervalMonths,
    fgas: f,
    lastLeakCheck,
    nextLeakCheck,
    upcoming,
    booked,
    lastContact,
    warrantyEnd,
    completed,
  };
}

export type DueKey = "off" | "none" | "booked" | "ok" | "chase" | "contacted" | "overdue" | "due";
export type Tone = "grey" | "green" | "amber" | "red" | "plain";

export interface DueStatus {
  key: DueKey;
  label: string;
  tone: Tone;
  /** Shown in the dashboard's service reminders. */
  needsAction: boolean;
}

/** The first matching rule wins (spec 02, "Due status"). */
export function dueStatus(sys: System, info: SystemInfo, settings: Settings, today: IsoDate): DueStatus {
  if (sys.inactive) return { key: "off", label: "Inactive", tone: "grey", needsAction: false };
  if (!info.nextDue) return { key: "none", label: "No install date", tone: "grey", needsAction: false };
  const days = daysBetween(today, info.nextDue);
  if (info.booked)
    return {
      key: "booked",
      label: `Booked ${formatDate(info.booked.date)}`,
      tone: "green",
      needsAction: false,
    };
  if (days > Number(settings.reminderLeadDays))
    return { key: "ok", label: `Due ${formatDate(info.nextDue)}`, tone: "grey", needsAction: false };
  if (info.lastContact) {
    const since = -daysBetween(today, info.lastContact.date);
    if (since >= Number(settings.chaseAfterDays))
      return { key: "chase", label: `Chase – contacted ${since}d ago`, tone: "amber", needsAction: true };
    return {
      key: "contacted",
      label: `Contacted ${formatDate(info.lastContact.date)}`,
      tone: "plain",
      needsAction: false,
    };
  }
  if (days < 0)
    return { key: "overdue", label: `Overdue ${-days}d – contact`, tone: "red", needsAction: true };
  return {
    key: "due",
    label: `${days === 0 ? "Due today" : `Due in ${days}d`} – contact`,
    tone: "amber",
    needsAction: true,
  };
}
