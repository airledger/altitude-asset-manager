// The whole business at a glance: every install with its client, units, jobs, contacts, due status and
// F-gas figures. Home, Reminders, Orders and the asset register all read this one load.
import {
  addDays,
  aggregateOrder,
  dueStatus,
  formatDate,
  jobMaterials,
  materialsForJob,
  siteShort,
  systemInfo,
  unitsSummary,
  type DueStatus,
  type MaterialLine,
  type SystemInfo,
} from "@airledger/domain";
import {
  fillTemplate,
  toDomain,
  toSettings,
  type Assets,
  type ClientRow,
  type ContactLogRow,
  type ReminderSettings,
  type SystemRow,
  type UnitRow,
} from "./assets";
import { toJob, toMaterial, toUnit, type JobListRow, type JobsApi, type MaterialRow } from "./jobs";

export interface SiteView {
  system: SystemRow;
  client: ClientRow | null;
  units: UnitRow[];
  jobs: JobListRow[];
  contacts: ContactLogRow[];
  info: SystemInfo;
  status: DueStatus;
}

export interface Overview {
  sites: SiteView[];
  jobs: JobListRow[];
  materials: MaterialRow[];
  templates: ReminderSettings;
  today: string;
}

export async function loadOverview(assets: Assets, jobs: JobsApi, today: string): Promise<Overview> {
  const [systems, clients, jobRows, contacts, rules, units, materials, templates] = await Promise.all([
    assets.allSystems(),
    assets.clients(),
    jobs.jobs(),
    assets.contactLogs(),
    assets.ruleSettings(),
    assets.allUnits(),
    jobs.materials(),
    assets.reminderSettings(),
  ]);
  const settings = toSettings(rules);
  const group = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const unitsBy = group(units, (u) => u.system_id);
  const jobsBy = group(jobRows, (j) => j.system_id);
  const contactsBy = group(contacts, (c) => c.system_id);
  const clientsById = new Map(clients.map((c) => [c.id, c as ClientRow]));
  const sites = systems.map((system) => {
    const sysContacts = contactsBy.get(system.id) ?? [];
    const sys = {
      ...toDomain(system),
      contactLog: sysContacts.map((c) => ({ date: c.date, method: c.method, note: c.note })),
    };
    const sysJobs = jobsBy.get(system.id) ?? [];
    const info = systemInfo(sys, sysJobs.map(toJob), settings, today);
    return {
      system,
      client: clientsById.get(system.client_id) ?? null,
      units: unitsBy.get(system.id) ?? [],
      jobs: sysJobs,
      contacts: sysContacts,
      info,
      status: dueStatus(sys, info, settings, today),
    };
  });
  return { sites, jobs: jobRows, materials, templates, today };
}

/** The reminder email and text for an install, from the business's templates. */
export function reminderMessages(
  site: SiteView,
  t: ReminderSettings,
  businessName: string,
  engineer: string,
) {
  const c = site.client;
  const map = {
    contact: (c?.contact_name || c?.name || "").split(" ")[0] || "there",
    client: c?.name ?? "",
    site: siteShort(toDomain(site.system)),
    dueDate: formatDate(site.info.nextDue),
    units: unitsSummary(site.units.map(toUnit)),
    phone: t.phone || "[your number]",
    engineer: engineer || t.default_engineer,
    business: t.trading_as || businessName,
  };
  return {
    subject: fillTemplate(t.email_subject, map),
    email: fillTemplate(t.email_body, map),
    sms: fillTemplate(t.sms_body, map),
  };
}

export interface OrderJob {
  job: JobListRow;
  site: SiteView;
  lines: MaterialLine[];
}

/** Booked jobs from today to `days` ahead whose parts aren't ordered yet, each with its parts list. */
export function jobsToOrder(o: Overview, days: number): OrderJob[] {
  const until = addDays(o.today, days);
  const byId = new Map(o.sites.map((s) => [s.system.id, s]));
  const catalogue = o.materials.map(toMaterial);
  return o.jobs
    .filter(
      (j) => j.status === "booked" && !j.materials_ordered && j.date && j.date >= o.today && j.date <= until,
    )
    .flatMap((j) => {
      const site = byId.get(j.system_id);
      if (!site) return [];
      const job = toJob(j);
      const lines = jobMaterials(job, () =>
        materialsForJob(job, site.units.map(toUnit), site.info, catalogue, o.today),
      );
      return lines.length ? [{ job: j, site, lines }] : [];
    });
}

/** The order for a set of jobs, one list per supplier. */
export function bySupplier(list: OrderJob[]): [string, MaterialLine[]][] {
  const total = aggregateOrder(list.map((x) => x.lines));
  const m = new Map<string, MaterialLine[]>();
  for (const l of total) m.set(l.supplier || "Unassigned", [...(m.get(l.supplier || "Unassigned") ?? []), l]);
  return [...m.entries()].sort(([a], [b]) =>
    a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b),
  );
}
