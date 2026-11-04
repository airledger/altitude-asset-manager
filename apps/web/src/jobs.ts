// Jobs, the materials catalogue and completion records (stage 5). Rows keep the database's column names;
// the to*() helpers turn them into the shapes packages/domain's rules read.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job, Material, MaterialLine, Unit } from "@airledger/domain";
import type { New, UnitRow } from "./assets";
import { appOrigin } from "./native";

export const CHECKS = {
  filters: "Filters cleaned or replaced",
  coil: "Coils cleaned and sanitised",
  drain: "Condensate drain tested",
  fan: "Fans and louvres checked",
  electrical: "Electrical checks",
  operation: "Heat and cool operation tested",
} as const;
export const INSTALL_CHECKS = {
  mounted: "Mounted level and secure",
  pipework: "Pipework insulated and clipped",
  drain: "Condensate fall and drain tested",
  electrical: "Electrical tests and isolation",
  operation: "Heat and cool operation tested",
  sticker: "Asset label fitted",
  handoverU: "Controls shown to customer",
} as const;
export const ALL_CHECKS: Record<string, string> = { ...CHECKS, ...INSTALL_CHECKS };
/** Checks that only make sense on an indoor unit. */
export const INDOOR_ONLY = ["filters", "drain", "handoverU"];

export const LEAK_METHODS = [
  "Direct – electronic detector",
  "Direct – bubble solution",
  "Indirect – pressure/temperature analysis",
  "Automatic leak detection system",
] as const;

export interface JobRow {
  id: string;
  system_id: string;
  type: string;
  status: "booked" | "completed" | "cancelled";
  date: string | null;
  time: string | null;
  duration_hrs: number | null;
  engineer: string;
  /** Whose diary the job is in. engineer stays as the name printed on reports. */
  engineer_id: string | null;
  notes: string;
  materials_ordered: boolean;
  completed_at: string | null;
  completion_notes: string;
  billing: string;
}

export type JobListRow = JobRow & {
  systems: {
    id: string;
    name: string;
    site_address: string;
    site_postcode: string;
    access_notes: string;
    client_id: string;
    clients: { name: string } | null;
  } | null;
  job_leak_checks: { performed: boolean } | { performed: boolean }[] | null;
};

export interface PartRow {
  material_id: string | null;
  name: string;
  sku: string;
  supplier: string;
  qty: number;
  raw_qty: number | null;
  extra: boolean;
}

export interface MaterialRow {
  id: string;
  name: string;
  supplier: string;
  sku: string;
  applies_to: string;
  qty_per: number;
  needed_when: string;
  active: boolean;
}

/** Someone who can be booked on jobs. user_id is empty until they've joined with their invite. */
export interface PersonRow {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  phone: string;
  fgas_cert: string;
  active: boolean;
}

/** Everyone, or the people a feed is for: the calendar app links for a calendar feed. */
export function calendarUrls(token: string, name: string, origin = appOrigin()) {
  const https = `${origin}/cal/${token}.ics`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return {
    https,
    apple: webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(name)}`,
    outlookWork: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(name)}`,
  };
}

export interface UnitCheckRow {
  unit_id: string;
  checks: string[];
  off_coil: number | null;
  on_coil: number | null;
  amps: number | null;
  pressure: number | null;
  notes: string;
}

export interface LeakCheckRow {
  performed: boolean;
  method: string;
  result: "pass" | "fail" | null;
  added_kg: number | null;
  recovered_kg: number | null;
  notes: string;
}

export interface CommissioningRow {
  pressure_bar: number | null;
  pressure_mins: number | null;
  pressure_held: boolean | null;
  vacuum_microns: number | null;
  decay_held: boolean | null;
  pipe_m: number | null;
  added_kg: number | null;
  customer_name: string;
  handover: boolean;
}

export interface Completion {
  date: string;
  engineer: string;
  type: string;
  duration_hrs: number | null;
  completion_notes: string;
  photo_file_ids: string[];
  unit_checks: UnitCheckRow[];
  leak_check: LeakCheckRow | null;
  commissioning: CommissioningRow | null;
  parts_used: PartRow[];
}

export interface JobRecord {
  checks: UnitCheckRow[];
  leak: LeakCheckRow | null;
  commissioning: CommissioningRow | null;
  ordered: PartRow[];
  used: PartRow[];
  /** The engineer's report and photos (a site record linked to the job). */
  report: { text: string; photo_file_ids: string[] } | null;
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export function toJob(r: JobRow & { job_leak_checks?: JobListRow["job_leak_checks"] }): Job {
  return {
    id: r.id,
    systemId: r.system_id,
    type: r.type,
    status: r.status,
    date: r.date ?? "",
    time: r.time?.slice(0, 5) ?? "",
    durationHrs: r.duration_hrs,
    notes: r.notes,
    materialsOrdered: r.materials_ordered,
    leakCheck: { performed: !!one(r.job_leak_checks)?.performed },
  };
}

export const toUnit = (u: UnitRow): Unit => ({
  id: u.id,
  systemId: u.system_id,
  role: u.role,
  indoorType: u.indoor_type ?? "",
  filterType: u.filter_type ?? "",
  controller: u.controller ?? "",
  condensatePump: u.condensate_pump,
});

export const toMaterial = (m: MaterialRow): Material => ({
  id: m.id,
  name: m.name,
  supplier: m.supplier,
  sku: m.sku,
  appliesTo: m.applies_to,
  qtyPer: m.qty_per,
  when: m.needed_when,
  active: m.active,
});

export const toLine = (p: PartRow): MaterialLine => ({
  id: p.material_id ?? "",
  name: p.name,
  sku: p.sku,
  supplier: p.supplier,
  qty: Number(p.qty),
  raw: p.raw_qty ?? Number(p.qty),
  extra: p.extra,
});

export const toPart = (l: MaterialLine): PartRow => ({
  material_id: l.id || null,
  name: l.name,
  sku: l.sku ?? "",
  supplier: l.supplier === "Unassigned" ? "" : (l.supplier ?? ""),
  qty: l.qty,
  raw_qty: l.raw ?? null,
  extra: !!l.extra,
});

const JOB_LIST =
  "*, job_leak_checks(performed), systems(id, name, site_address, site_postcode, access_notes, client_id, clients(name))";

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message);
};

/** userId is the signed-in user, for "my" jobs and calendar. */
export function jobsApi(sb: SupabaseClient, orgId: string, userId = "") {
  return {
    userId,
    orgId,
    /** Every job in the business, soonest first, with its install and client. */
    async jobs(): Promise<JobListRow[]> {
      const { data, error } = await sb
        .from("jobs")
        .select(JOB_LIST)
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("date", { ascending: true })
        .order("time", { ascending: true });
      fail(error);
      return (data ?? []) as JobListRow[];
    },

    async systemJobs(systemId: string): Promise<JobListRow[]> {
      const { data, error } = await sb
        .from("jobs")
        .select(JOB_LIST)
        .eq("system_id", systemId)
        .is("deleted_at", null)
        .order("date", { ascending: false });
      fail(error);
      return (data ?? []) as JobListRow[];
    },

    async job(id: string): Promise<JobListRow | null> {
      const { data, error } = await sb.from("jobs").select(JOB_LIST).eq("id", id).maybeSingle();
      fail(error);
      return data as JobListRow | null;
    },

    async saveJob(
      row: New<Omit<JobRow, "completed_at" | "completion_notes" | "billing" | "materials_ordered">>,
    ) {
      const { id, ...fields } = row;
      const q = id
        ? sb.from("jobs").update(fields).eq("id", id).eq("org_id", orgId).select("id").single()
        : sb
            .from("jobs")
            .insert({ ...fields, org_id: orgId })
            .select("id")
            .single();
      const { data, error } = await q;
      fail(error);
      return (data as { id: string }).id;
    },

    /** Reschedule: a new date, and optionally a new engineer (from dragging on the schedule). */
    async move(id: string, date: string, engineer?: { id: string | null; name: string }): Promise<void> {
      const fields = engineer ? { date, engineer_id: engineer.id, engineer: engineer.name } : { date };
      const { error } = await sb.from("jobs").update(fields).eq("id", id).eq("org_id", orgId);
      fail(error);
    },

    async setStatus(id: string, status: JobRow["status"]): Promise<void> {
      const { error } = await sb.from("jobs").update({ status }).eq("id", id).eq("org_id", orgId);
      fail(error);
    },

    /** Owner only (the database refuses anyone else). */
    async deleteJob(id: string): Promise<void> {
      const { data, error } = await sb
        .from("jobs")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id)
        .eq("org_id", orgId)
        .select("id");
      fail(error);
      if (Array.isArray(data) && data.length === 0) throw new Error("Only an owner can delete a job.");
    },

    /** What was recorded on a job: unit checks, leak check or commissioning, and parts. */
    async record(jobId: string): Promise<JobRecord> {
      const [checks, leak, comm, parts, report] = await Promise.all([
        sb.from("job_unit_checks").select("*").eq("job_id", jobId),
        sb.from("job_leak_checks").select("*").eq("job_id", jobId).maybeSingle(),
        sb.from("job_commissioning").select("*").eq("job_id", jobId).maybeSingle(),
        sb.from("job_parts").select("*").eq("job_id", jobId).order("position"),
        sb
          .from("site_records")
          .select("text, photo_file_ids")
          .eq("job_id", jobId)
          .in("kind", ["Service report", "Install / commissioning report"])
          .order("created_at")
          .range(0, 0),
      ]);
      for (const r of [checks, leak, comm, parts, report]) fail(r.error);
      const all = (parts.data ?? []) as (PartRow & { list: string })[];
      return {
        checks: (checks.data ?? []) as UnitCheckRow[],
        leak: (leak.data as LeakCheckRow | null) ?? null,
        commissioning: (comm.data as CommissioningRow | null) ?? null,
        ordered: all.filter((p) => p.list === "ordered"),
        used: all.filter((p) => p.list === "used"),
        report: ((report.data ?? []) as JobRecord["report"][])[0] ?? null,
      };
    },

    async complete(jobId: string, c: Completion): Promise<void> {
      const { error } = await sb.rpc("complete_job", { p_job: jobId, p: c });
      fail(error);
    },

    async markPartsOrdered(jobId: string, parts: PartRow[]): Promise<void> {
      const { error } = await sb.rpc("mark_parts_ordered", { p_job: jobId, p_parts: parts });
      fail(error);
    },

    async materials(): Promise<MaterialRow[]> {
      const { data, error } = await sb
        .from("materials")
        .select("id, name, supplier, sku, applies_to, qty_per, needed_when, active")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("name");
      fail(error);
      return (data ?? []) as MaterialRow[];
    },

    /** Owner only. */
    async saveMaterial(row: New<MaterialRow>): Promise<void> {
      const { id, ...fields } = row;
      const q = id
        ? sb.from("materials").update(fields).eq("id", id).eq("org_id", orgId).select("id")
        : sb
            .from("materials")
            .insert({ ...fields, org_id: orgId })
            .select("id");
      const { data, error } = await q;
      fail(error);
      if (Array.isArray(data) && data.length === 0) throw new Error("Only an owner can change materials.");
    },

    async deleteMaterial(id: string): Promise<void> {
      const { error } = await sb
        .from("materials")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id)
        .eq("org_id", orgId);
      fail(error);
    },

    /** The team: everyone who can be booked on a job, active first, then by name. */
    async people(): Promise<PersonRow[]> {
      const { data, error } = await sb
        .from("people")
        .select("id, user_id, name, email, phone, fgas_cert, active")
        .eq("org_id", orgId)
        .order("active", { ascending: false })
        .order("name");
      fail(error);
      return (data ?? []) as PersonRow[];
    },

    /** The signed-in user's own row in the team, if they have one. */
    async me(): Promise<PersonRow | null> {
      return (await this.people()).find((x) => x.active && x.user_id === userId) ?? null;
    },

    /** Owners add and edit anyone; people can edit their own phone and F-gas certificate. */
    async savePerson(row: New<Omit<PersonRow, "user_id">>): Promise<string> {
      const { id, name, email, phone, fgas_cert, active } = row;
      const fields = { name, email, phone, fgas_cert, active };
      const q = id
        ? sb.from("people").update(fields).eq("id", id).eq("org_id", orgId).select("id")
        : sb
            .from("people")
            .insert({ ...fields, org_id: orgId })
            .select("id");
      const { data, error } = await q;
      if (error?.message.includes("people_org_email"))
        throw new Error("Someone in the team already has that email address.");
      fail(error);
      const rows = (Array.isArray(data) ? data : data ? [data] : []) as { id: string }[];
      if (!rows[0]) throw new Error("Only an owner can change someone else's details.");
      return rows[0].id;
    },

    /** Owner: an invite link locked to the person's email. A new one replaces any unused one. */
    async invitePerson(personId: string): Promise<string> {
      const { data, error } = await sb.rpc("invite_person", { p_person: personId });
      fail(error);
      return data as string;
    },

    /** The private calendar feed token for a person, or for every job (null, owners only). */
    async calendarToken(personId: string | null, renew = false): Promise<string> {
      const { data, error } = await sb.rpc("calendar_link", {
        p_org: orgId,
        p_person: personId,
        p_new: renew,
      });
      fail(error);
      return data as string;
    },

    async defaultEngineer(): Promise<string> {
      const { data, error } = await sb
        .from("org_settings")
        .select("default_engineer")
        .eq("org_id", orgId)
        .maybeSingle();
      fail(error);
      return (data as { default_engineer?: string } | null)?.default_engineer ?? "";
    },
  };
}

export type JobsApi = ReturnType<typeof jobsApi>;
