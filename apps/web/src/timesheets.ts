// Timesheets (part 2): each person on a job taps Set off, Arrived and Finished. Travel is set off to arrived,
// time on site is arrived to finished. Owners see the hours per person per week and can correct them.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Stage = "travel" | "arrived" | "left";

export interface JobTime {
  job_id: string;
  user_id: string;
  name: string;
  travel_at: string | null;
  arrived_at: string | null;
  left_at: string | null;
}

/** A timesheet row with the job it's for. */
export interface TimesheetRow extends JobTime {
  jobs: {
    date: string | null;
    type: string;
    systems: { name: string; clients: { name: string } | null } | null;
  } | null;
}

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message);
};

/** Hours between two times, to the nearest minute; 0 when either is missing. */
export function hoursBetween(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  const mins = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
  return Math.max(0, mins) / 60;
}

export const travelHours = (t: JobTime) => hoursBetween(t.travel_at, t.arrived_at);
export const siteHours = (t: JobTime) => hoursBetween(t.arrived_at, t.left_at);

/** "1 h 25 min", "40 min" */
export function hm(hours: number): string {
  const mins = Math.round(hours * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** What the next tap is, from where someone's got to. */
export function nextStage(t: JobTime | null | undefined): Stage | null {
  if (!t || (!t.travel_at && !t.arrived_at)) return "travel";
  if (!t.arrived_at) return "arrived";
  if (!t.left_at) return "left";
  return null;
}

export const STAGE_LABEL: Record<Stage, string> = {
  travel: "Set off",
  arrived: "Arrived on site",
  left: "Finished",
};

/** Hours per person for the week, plus a total. */
export function weekTotals(rows: JobTime[]) {
  const by = new Map<string, { name: string; travel: number; site: number; jobs: number }>();
  for (const r of rows) {
    const cur = by.get(r.user_id) ?? { name: r.name, travel: 0, site: 0, jobs: 0 };
    cur.travel += travelHours(r);
    cur.site += siteHours(r);
    cur.jobs += 1;
    if (r.name) cur.name = r.name;
    by.set(r.user_id, cur);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA") : "");

/** The week's timesheet as CSV rows, header first. */
export function timesheetCsvRows(rows: TimesheetRow[]): string[][] {
  return [
    [
      "Name",
      "Date",
      "Job",
      "Client",
      "Install",
      "Set off",
      "Arrived",
      "Finished",
      "Travel hours",
      "On site hours",
    ],
    ...rows.map((r) => [
      r.name,
      day(r.arrived_at ?? r.travel_at) || (r.jobs?.date ?? ""),
      r.jobs?.type ?? "",
      r.jobs?.systems?.clients?.name ?? "",
      r.jobs?.systems?.name ?? "",
      clock(r.travel_at),
      clock(r.arrived_at),
      clock(r.left_at),
      travelHours(r).toFixed(2),
      siteHours(r).toFixed(2),
    ]),
  ];
}

export function timesApi(sb: SupabaseClient, orgId: string) {
  const cols = "job_id, user_id, name, travel_at, arrived_at, left_at";
  return {
    async forJob(jobId: string): Promise<JobTime[]> {
      const { data, error } = await sb.from("job_times").select(cols).eq("job_id", jobId).order("name");
      fail(error);
      return (data ?? []) as JobTime[];
    },
    /** The signed-in person's tap, at the time it was made. */
    async clock(jobId: string, stage: Stage, at: string, name: string): Promise<void> {
      const { error } = await sb.rpc("clock", { p_job: jobId, p_stage: stage, p_at: at, p_name: name });
      fail(error);
    },
    /** Owners correct someone's times. */
    async correct(t: JobTime): Promise<void> {
      const { error } = await sb
        .from("job_times")
        .update({ travel_at: t.travel_at, arrived_at: t.arrived_at, left_at: t.left_at })
        .eq("org_id", orgId)
        .eq("job_id", t.job_id)
        .eq("user_id", t.user_id);
      fail(error);
    },
    /** Everyone's times that started in [from, to) (ISO dates). */
    async week(from: string, to: string): Promise<TimesheetRow[]> {
      const { data, error } = await sb
        .from("job_times")
        .select(`${cols}, jobs(date, type, systems(name, clients(name)))`)
        .eq("org_id", orgId)
        .gte("arrived_at", new Date(`${from}T00:00:00`).toISOString())
        .lt("arrived_at", new Date(`${to}T00:00:00`).toISOString())
        .order("arrived_at");
      fail(error);
      return (data ?? []) as unknown as TimesheetRow[];
    },
  };
}

export type TimesApi = ReturnType<typeof timesApi>;
