// Jobs: the list, booking, the job page, completing a job, and the materials catalogue the parts lists come from.
import {
  addDays,
  APPLIES_TO,
  formatDate,
  isInstallType,
  jobMaterials,
  JOB_TYPES,
  materialsForJob,
  NEEDED_WHEN,
  systemInfo,
  type MaterialLine,
} from "@airledger/domain";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Business } from "../api";
import { toDomain, toSettings, type Assets, type SystemRow, type UnitRow } from "../assets";
import { Area, Check, Pick, readForm, Text } from "../fields";
import { Icon } from "../icons";
import {
  ALL_CHECKS,
  CHECKS,
  INDOOR_ONLY,
  INSTALL_CHECKS,
  LEAK_METHODS,
  toJob,
  toLine,
  toMaterial,
  toPart,
  toUnit,
  type JobListRow,
  type JobRecord,
  type JobRow,
  type JobsApi,
  type MaterialRow,
  type PersonRow,
  type Completion,
} from "../jobs";
import { enqueue, enqueuePhotos, sendOrSave } from "../outbox";
import { useOutbox } from "./Outbox";
import { ReportCard, SendReport, SignOff, type ReportCtx } from "./Reports";
import type { ReportsApi } from "../reports";
import type { InvoicesApi } from "../invoices";
import { JobBillingCard } from "./Invoices";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { go, todayIso, unitTitle, useLoad } from "./Assets";

const FILTERS = { booked: "Booked", completed: "Completed", cancelled: "Cancelled", all: "All" } as const;
type Filter = keyof typeof FILTERS;

const when = (j: Pick<JobRow, "date" | "time">) =>
  j.date ? `${formatDate(j.date)}${j.time ? ` at ${j.time.slice(0, 5)}` : ""}` : "No date";
const hrs = (n: number | null) => (n ? `${n} h` : "");
const statusPill = (j: JobRow) =>
  j.status === "completed" ? (
    <span className="pill green">Completed</span>
  ) : j.status === "cancelled" ? (
    <span className="pill">Cancelled</span>
  ) : j.date && j.date < todayIso() ? (
    <span className="pill amber">Overdue</span>
  ) : (
    <span className="pill">Booked</span>
  );

export function JobRows({ jobs, empty }: { jobs: JobListRow[]; empty: ReactNode }) {
  if (!jobs.length) return <>{empty}</>;
  return (
    <ul className="rows">
      {jobs.map((j) => (
        <li key={j.id}>
          <a className="item" href={`#/job/${j.id}`}>
            <span className="datebox" aria-hidden="true">
              {j.date ? (
                <>
                  <b>{new Date(j.date).getDate()}</b>
                  {new Date(j.date).toLocaleDateString("en-GB", { month: "short" })}
                </>
              ) : (
                "–"
              )}
            </span>
            <span className="main">
              <span className="t">
                {j.type} · {j.systems?.clients?.name ?? "No client"}
              </span>
              <span className="m">
                {[j.time?.slice(0, 5), j.systems?.name, j.systems?.site_postcode, j.engineer]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            {statusPill(j)}
            <Icon name="chevron" size={18} />
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---------- list ----------

export function JobsPage({ jobs, show }: { jobs: JobsApi; show: string | null }) {
  const list = useLoad(() => jobs.jobs(), [jobs]);
  const filter: Filter = show && show in FILTERS ? (show as Filter) : "booked";
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const all = list.value ?? [];
  const shown = all
    .filter((j) => filter === "all" || j.status === filter)
    .filter(
      (j) =>
        !needle ||
        [j.type, j.engineer, j.systems?.name, j.systems?.site_postcode, j.systems?.clients?.name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle)),
    );
  // Booked jobs soonest first; history newest first.
  if (filter !== "booked") shown.reverse();
  const today = todayIso();
  const weekEnd = addDays(today, 7);
  const booked = all.filter((j) => j.status === "booked");
  return (
    <>
      <PageHead title="Jobs" sub="Book, complete and look back over every visit.">
        <a className="btn" href="#/schedule">
          <Icon name="calendar" size={18} />
          Schedule
        </a>
        <a className="btn" href="#/orders">
          Parts to order
        </a>
        <a className="btn" href="#/reports">
          <Icon name="report" size={18} />
          Reports
        </a>
        <a className="btn pri" href="#/job/new">
          <Icon name="plus" size={18} />
          Book a job
        </a>
      </PageHead>
      <div className="kpis three">
        <div className="kpi">
          <span className="kpi-n">{list.value ? booked.filter((j) => j.date === today).length : "–"}</span>
          <span className="kpi-l">Today</span>
        </div>
        <div className="kpi">
          <span className="kpi-n">
            {list.value ? booked.filter((j) => j.date && j.date >= today && j.date <= weekEnd).length : "–"}
          </span>
          <span className="kpi-l">Next 7 days</span>
        </div>
        <div className="kpi amber">
          <span className="kpi-n">
            {list.value ? booked.filter((j) => j.date && j.date < today).length : "–"}
          </span>
          <span className="kpi-l">Overdue</span>
        </div>
      </div>
      <section className="card">
        <div className="chips" role="group" aria-label="Show">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <button
              key={f}
              className="chip"
              aria-pressed={f === filter}
              onClick={() => go(f === "booked" ? "#/jobs" : `#/jobs?show=${f}`)}
            >
              {FILTERS[f]}
            </button>
          ))}
        </div>
        <ErrorLine error={list.error} />
        {all.length > 8 && (
          <input
            type="search"
            className="search"
            aria-label="Search jobs"
            placeholder="Search client, install, postcode or engineer"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
          />
        )}
        {!list.value ? (
          <Loading />
        ) : (
          <JobRows
            jobs={shown}
            empty={
              <Empty icon="calendar" title={filter === "booked" ? "Nothing booked" : "No jobs here"}>
                {filter === "booked" ? "Book a job, or start a service from an install." : null}
              </Empty>
            }
          />
        )}
      </section>
    </>
  );
}

// ---------- the job's install, units and parts ----------

function useJobContext(assets: Assets, jobs: JobsApi, systemId: string | null | undefined) {
  return useLoad(async () => {
    if (!systemId) return null;
    const [system, units, history, materials, settings] = await Promise.all([
      assets.system(systemId),
      assets.units(systemId),
      jobs.systemJobs(systemId),
      jobs.materials(),
      assets.ruleSettings(),
    ]);
    if (!system) return null;
    return { system, units, history, materials, settings: toSettings(settings) };
  }, [assets, jobs, systemId]);
}
type Ctx = NonNullable<ReturnType<typeof useJobContext>["value"]>;

/** The parts list: frozen when ordered, what was used once completed, otherwise worked out from the catalogue. */
function partsFor(j: JobRow, ctx: Ctx, record: JobRecord | undefined): MaterialLine[] {
  const job = {
    ...toJob(j),
    materialsSnapshot: record?.ordered.length ? record.ordered.map(toLine) : null,
    ...(record && j.status === "completed" ? { materialsUsed: record.used.map(toLine) } : {}),
  };
  return jobMaterials(job, () =>
    materialsForJob(
      job,
      ctx.units.map(toUnit),
      systemInfo(toDomain(ctx.system), ctx.history.map(toJob), ctx.settings, todayIso()),
      ctx.materials.map(toMaterial),
      todayIso(),
    ),
  );
}

// ---------- the job page ----------

export function JobPage(p: {
  assets: Assets;
  jobs: JobsApi;
  id: string;
  query: URLSearchParams;
  business: Business;
  userId: string;
  reports: ReportsApi;
  /** Owners only. */
  invoices?: InvoicesApi | null;
}) {
  const isNew = p.id === "new";
  const job = useLoad(() => (isNew ? Promise.resolve(null) : p.jobs.job(p.id)), [p.jobs, p.id]);
  const record = useLoad(() => (isNew ? Promise.resolve(undefined) : p.jobs.record(p.id)), [p.jobs, p.id]);
  const j = job.value ?? null;
  const ctx = useJobContext(p.assets, p.jobs, j?.system_id ?? p.query.get("system"));
  const mode = p.query.get("do");
  const act = useAction();
  const owner = p.business.role === "owner";
  const { items: outbox } = useOutbox();
  const waiting = outbox.find((i) => i.kind === "complete" && i.jobId === p.id);
  const reportCtx = useMemo<ReportCtx | null>(
    () =>
      job.value && record.value && ctx.value
        ? {
            job: job.value,
            record: record.value,
            system: ctx.value.system,
            units: ctx.value.units,
            history: ctx.value.history,
            settings: ctx.value.settings,
          }
        : null,
    [job.value, record.value, ctx.value],
  );

  if (isNew)
    return (
      <>
        <PageHead back={{ href: "#/jobs", label: "Jobs" }} title="Book a job" />
        <BookJob {...p} job={null} ctx={ctx.value ?? null} />
      </>
    );
  if (job.error) return <ErrorLine error={job.error} />;
  if (job.value === undefined) return <Loading />;
  if (!j)
    return (
      <section className="card">
        <h1>Not found</h1>
        <p>
          That job doesn't exist in this business, or it's been deleted. <a href="#/jobs">Back to jobs</a>
        </p>
      </section>
    );
  const back = { href: `#/job/${j.id}`, label: j.type };
  const reload = () => {
    go(`#/job/${j.id}`);
    job.reload();
    record.reload();
    ctx.reload();
  };
  if (mode === "edit")
    return (
      <>
        <PageHead back={back} title="Edit booking" />
        <BookJob {...p} job={j} ctx={ctx.value ?? null} />
      </>
    );
  if (mode === "signoff" || mode === "send") {
    if (j.status !== "completed") return <ErrorLine error="Complete the job first." />;
    if (!reportCtx) return <Loading />;
    return mode === "signoff" ? (
      <SignOff assets={p.assets} jobs={p.jobs} reports={p.reports} business={p.business} ctx={reportCtx} />
    ) : (
      <SendReport
        assets={p.assets}
        reports={p.reports}
        business={p.business}
        ctx={reportCtx}
        reportId={p.query.get("report")}
      />
    );
  }
  if (mode === "complete") {
    if (!ctx.value || !record.value) return <Loading />;
    return (
      <>
        <PageHead
          back={back}
          title={j.status === "completed" ? "Edit record" : "Complete job"}
          sub={`${j.systems?.clients?.name ?? ""} · ${j.systems?.name ?? ""}`}
        />
        <CompleteJob
          assets={p.assets}
          jobs={p.jobs}
          job={j}
          ctx={ctx.value}
          record={record.value}
          done={(how) => {
            // Straight on to sign-off after a first completion; an edit goes back to the job,
            // where the report card says if the report needs re-issuing.
            if (how === "sent" && j.status !== "completed") {
              go(`#/job/${j.id}?do=signoff`);
              job.reload();
              record.reload();
              ctx.reload();
            } else reload();
          }}
        />
      </>
    );
  }

  const parts = ctx.value ? partsFor(j, ctx.value, record.value) : [];
  const s = j.systems;
  const run = (f: () => Promise<void>) => void act.run(async () => (await f(), reload()));
  return (
    <>
      <PageHead
        back={{ href: "#/jobs", label: "Jobs" }}
        title={j.type}
        sub={
          <>
            {s?.clients?.name} · <a href={`#/system/${j.system_id}`}>{s?.name}</a>
          </>
        }
      >
        {statusPill(j)}
      </PageHead>
      <ErrorLine error={act.error || ctx.error || record.error} />
      {waiting && (
        <p className="banner">
          {waiting.error
            ? `Completed on this phone but not saved: ${waiting.error}`
            : `Completed on this phone at ${new Date(waiting.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. It sends by itself when there's signal.`}
        </p>
      )}
      <section className="card">
        <div className="pgactions">
          {j.status === "booked" && (
            <>
              <a className="btn pri" href={`#/job/${j.id}?do=complete`}>
                <Icon name="check" size={18} />
                Complete job
              </a>
              <a className="btn" href={`#/job/${j.id}?do=edit`}>
                <Icon name="edit" size={18} />
                Edit or reschedule
              </a>
              {!j.materials_ordered && parts.length > 0 && (
                <button
                  className="btn"
                  disabled={act.busy}
                  onClick={() => run(() => p.jobs.markPartsOrdered(j.id, parts.map(toPart)))}
                >
                  Mark parts ordered
                </button>
              )}
              <button
                className="btn"
                disabled={act.busy}
                onClick={() => confirm("Cancel this job?") && run(() => p.jobs.setStatus(j.id, "cancelled"))}
              >
                Cancel job
              </button>
            </>
          )}
          {j.status === "completed" && (
            <a className="btn" href={`#/job/${j.id}?do=complete`}>
              <Icon name="edit" size={18} />
              Edit record
            </a>
          )}
          {j.status === "cancelled" && (
            <>
              <button
                className="btn pri"
                disabled={act.busy}
                onClick={() => run(() => p.jobs.setStatus(j.id, "booked"))}
              >
                Re-open
              </button>
              {owner && (
                <button
                  className="btn danger"
                  disabled={act.busy}
                  onClick={() =>
                    confirm("Delete this job for good?") &&
                    void act.run(async () => {
                      await p.jobs.deleteJob(j.id);
                      go("#/jobs");
                    })
                  }
                >
                  Delete job
                </button>
              )}
            </>
          )}
        </div>
        <dl className="facts">
          <dt>When</dt>
          <dd>{when(j)}</dd>
          {j.duration_hrs ? (
            <>
              <dt>{j.status === "completed" ? "Time on site" : "Allow"}</dt>
              <dd>{hrs(j.duration_hrs)}</dd>
            </>
          ) : null}
          {j.engineer && (
            <>
              <dt>Engineer</dt>
              <dd>{j.engineer}</dd>
            </>
          )}
          {s && (
            <>
              <dt>Site</dt>
              <dd>{[s.site_address, s.site_postcode].filter(Boolean).join(", ") || "Not set"}</dd>
            </>
          )}
          {s?.access_notes && (
            <>
              <dt>Access</dt>
              <dd>{s.access_notes}</dd>
            </>
          )}
          {j.notes && (
            <>
              <dt>Notes</dt>
              <dd>{j.notes}</dd>
            </>
          )}
        </dl>
      </section>
      {j.status === "completed" && reportCtx && !waiting && (
        <ReportCard assets={p.assets} reports={p.reports} ctx={reportCtx} sentTo={p.query.get("sent")} />
      )}
      {p.invoices && j.status !== "cancelled" && (
        <JobBillingCard invoices={p.invoices} jobs={p.jobs} job={j} />
      )}
      {j.status === "completed" && record.value && ctx.value && (
        <RecordView job={j} record={record.value} units={ctx.value.units} />
      )}
      {j.status !== "completed" && (
        <section className="card">
          <h2>Units</h2>
          {!ctx.value ? (
            <Loading />
          ) : ctx.value.units.length === 0 ? (
            <p className="note">No units on this install yet.</p>
          ) : (
            <ul className="rows">
              {ctx.value.units.map((u) => (
                <li key={u.id}>
                  <a className="item" href={`#/u/${u.sticker_code}`}>
                    <span className="assetno">#{u.asset_no}</span>
                    <span className="main">
                      <span className="t">{unitTitle(u)}</span>
                      <span className="m">
                        {u.sticker_code}
                        {u.location && ` · ${u.location}`}
                      </span>
                    </span>
                    <Icon name="chevron" size={18} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {j.status !== "completed" && (
        <section className="card">
          <div className="row spread">
            <h2>Parts to take</h2>
            {j.materials_ordered && <span className="pill green">Ordered</span>}
          </div>
          <PartsTable parts={parts} />
          {!parts.length && ctx.value && (
            <p className="note">
              Nothing from the materials list for this job.{" "}
              {owner && <a href="#/materials">Set up materials</a>}
            </p>
          )}
        </section>
      )}
    </>
  );
}

function PartsTable({ parts }: { parts: MaterialLine[] }) {
  if (!parts.length) return null;
  return (
    <ul className="rows">
      {parts.map((m, i) => (
        <li key={m.id + m.name + i}>
          <div className="item">
            <span className="qty">{m.qty}×</span>
            <span className="main">
              <span className="t">
                {m.name} {m.extra && <span className="pill">Added</span>}
              </span>
              <span className="m">
                {[m.supplier === "Unassigned" ? "" : m.supplier, m.sku].filter(Boolean).join(" · ")}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** What was recorded on a completed job. */
function RecordView({ job, record, units }: { job: JobRow; record: JobRecord; units: UnitRow[] }) {
  const byUnit = new Map(record.checks.map((c) => [c.unit_id, c]));
  const lc = record.leak;
  const cm = record.commissioning;
  return (
    <>
      <section className="card">
        <h2>Work done</h2>
        <ul className="rows">
          {units.map((u) => {
            const c = byUnit.get(u.id);
            const readings = [
              c?.off_coil != null && `Off-coil ${c.off_coil} °C`,
              c?.on_coil != null && `On-coil ${c.on_coil} °C`,
              c?.amps != null && `${c.amps} A`,
              c?.pressure != null && `${c.pressure} bar`,
            ].filter(Boolean);
            return (
              <li key={u.id}>
                <div className="item">
                  <span className="assetno">#{u.asset_no}</span>
                  <span className="main">
                    <span className="t">{unitTitle(u)}</span>
                    <span className="m">
                      {c
                        ? [c.checks.map((k) => ALL_CHECKS[k] ?? k).join(", "), readings.join(", "), c.notes]
                            .filter(Boolean)
                            .join(" · ") || "Nothing ticked"
                        : "Not recorded"}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <dl className="facts">
          {lc && (
            <>
              <dt>Leak check</dt>
              <dd>
                {lc.performed
                  ? [
                      lc.result === "fail" ? "Leak found" : "No leaks found",
                      lc.method,
                      lc.added_kg ? `${lc.added_kg} kg added` : "",
                      lc.recovered_kg ? `${lc.recovered_kg} kg recovered` : "",
                      lc.notes,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "Not carried out"}
              </dd>
            </>
          )}
          {cm && (
            <>
              <dt>Commissioning</dt>
              <dd>
                {[
                  cm.pressure_bar != null &&
                    `Nitrogen test ${cm.pressure_bar} bar${cm.pressure_mins ? ` for ${cm.pressure_mins} min` : ""}, ${cm.pressure_held ? "held" : "did not hold"}`,
                  cm.vacuum_microns != null &&
                    `Vacuum ${cm.vacuum_microns} microns${cm.decay_held ? ", decay test held" : ""}`,
                  cm.pipe_m != null && `${cm.pipe_m} m pipe`,
                  cm.added_kg ? `${cm.added_kg} kg added` : "",
                  cm.handover && `Handed over${cm.customer_name ? ` to ${cm.customer_name}` : ""}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </dd>
            </>
          )}
          {record.report?.text && (
            <>
              <dt>Engineer's report</dt>
              <dd>{record.report.text}</dd>
            </>
          )}
          {job.completed_at && (
            <>
              <dt>Completed</dt>
              <dd>{new Date(job.completed_at).toLocaleString("en-GB")}</dd>
            </>
          )}
        </dl>
      </section>
      <section className="card">
        <h2>Parts used</h2>
        {record.used.length ? (
          <PartsTable parts={record.used.map(toLine)} />
        ) : (
          <p className="note">No parts recorded.</p>
        )}
      </section>
    </>
  );
}

// ---------- booking ----------

/** Who a new job goes to: the business's default engineer if they're in the team, otherwise you. */
export function defaultPerson(people: PersonRow[], defaultName: string, userId: string) {
  const name = defaultName.trim().toLowerCase();
  return (
    (name && people.find((x) => x.active && x.name.trim().toLowerCase() === name)) ||
    people.find((x) => x.active && x.user_id === userId) ||
    null
  );
}

function BookJob(p: {
  assets: Assets;
  jobs: JobsApi;
  query: URLSearchParams;
  job: JobListRow | null;
  ctx: Ctx | null;
  userId: string;
}) {
  const j = p.job;
  const systems = useLoad(() => p.assets.allSystems(), [p.assets]);
  const engineer = useLoad(() => p.jobs.defaultEngineer(), [p.jobs]);
  const people = useLoad(() => p.jobs.people(), [p.jobs]);
  const [systemId, setSystemId] = useState(j?.system_id ?? p.query.get("system") ?? "");
  // Kept outside the form, so a choice survives the form resetting its defaults when the install loads.
  const [picked, setPicked] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  // Smart defaults: an install for a new system, otherwise an annual service a week ahead.
  const ctx = p.ctx && p.ctx.system.id === systemId ? p.ctx : null;
  const isNewSystem = !!ctx && !ctx.system.install_date && ctx.units.length === 0;
  const indoor = ctx?.units.filter((u) => u.role === "indoor").length ?? 0;
  const type = j?.type ?? p.query.get("type") ?? (isNewSystem ? "Installation" : "Annual service");
  const date = j?.date ?? p.query.get("date") ?? (isNewSystem ? todayIso() : addDays(todayIso(), 7));
  const team = people.value ?? [];
  const engineerId =
    picked ??
    (j
      ? (j.engineer_id ?? "")
      : (p.query.get("engineer") ?? defaultPerson(team, engineer.value ?? "", p.userId)?.id ?? ""));
  // A job booked to someone who has since left still shows them.
  const choices = team.filter((x) => x.active || x.id === engineerId);
  const duration = j?.duration_hrs ?? (ctx ? 0.5 + 0.5 * Math.max(1, indoor) : null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    void run(async () => {
      const id = await p.jobs.saveJob({
        id: j?.id,
        system_id: systemId,
        type: f.text("type"),
        status: j?.status ?? "booked",
        date: f.orNull("date"),
        time: f.orNull("time"),
        duration_hrs: f.num("duration_hrs"),
        engineer_id: f.orNull("engineer_id"),
        engineer: team.find((x) => x.id === f.text("engineer_id"))?.name ?? "",
        notes: f.text("notes"),
      });
      go(`#/job/${id}`);
    });
  }
  if ((engineer.value === undefined && !engineer.error) || (people.value === undefined && !people.error))
    return <Loading />;
  return (
    <form className="card form narrowform" onSubmit={submit} key={`${systemId}-${ctx ? "ctx" : "none"}`}>
      <ErrorLine error={error || systems.error || people.error} />
      <label>
        Install
        <select
          name="system_id"
          required
          value={systemId}
          onChange={(e) => {
            setSystemId(e.currentTarget.value);
            go(`#/job/new?system=${e.currentTarget.value}`);
          }}
          disabled={!!j}
        >
          <option value="">Choose an install</option>
          {(systems.value ?? []).map((s: SystemRow & { clients: { name: string } | null }) => (
            <option key={s.id} value={s.id}>
              {[s.clients?.name, s.name, s.site_postcode].filter(Boolean).join(" · ")}
            </option>
          ))}
        </select>
      </label>
      <div className="grid2">
        <Pick name="type" label="Job type" value={type} options={JOB_TYPES} />
        <label>
          Engineer
          <select name="engineer_id" value={engineerId} onChange={(e) => setPicked(e.currentTarget.value)}>
            <option value="">Not assigned yet</option>
            {choices.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name || x.email}
                {x.active ? "" : " (left)"}
              </option>
            ))}
          </select>
        </label>
        <Text name="date" label="Date" type="date" value={date} required />
        <Text name="time" label="Time (optional)" type="time" value={j?.time?.slice(0, 5)} />
        <Text name="duration_hrs" label="Allow (hours)" type="number" value={duration} />
      </div>
      <Area name="notes" label="Notes for the engineer" value={j?.notes} />
      <div className="row">
        <button className="btn pri" type="submit" disabled={busy || !systemId}>
          {busy ? "Saving…" : j ? "Save" : "Book job"}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => go(j ? `#/job/${j.id}` : systemId ? `#/system/${systemId}` : "#/jobs")}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------- completing ----------

function CompleteJob(p: {
  assets: Assets;
  jobs: JobsApi;
  job: JobListRow;
  ctx: Ctx;
  record: JobRecord;
  done: (how: "sent" | "saved") => void;
}) {
  const { job: j, ctx, record } = p;
  const wasDone = j.status === "completed";
  const [type, setType] = useState(j.type);
  const install = isInstallType(type);
  const checks = install ? INSTALL_CHECKS : CHECKS;
  const info = systemInfo(toDomain(ctx.system), ctx.history.map(toJob), ctx.settings, todayIso());
  const leakDue =
    type === "Leak check" ||
    (info.fgas.required && !!info.nextLeakCheck && info.nextLeakCheck <= addDays(j.date || todayIso(), 31));
  const [parts, setParts] = useState<MaterialLine[]>(() => partsFor(j, ctx, record).map((m) => ({ ...m })));
  const [photos, setPhotos] = useState<File[]>([]);
  const { busy, error, run } = useAction();
  const prior = new Map(record.checks.map((c) => [c.unit_id, c]));
  const lc = record.leak;
  const cm = record.commissioning;
  const engineer = useLoad(() => p.jobs.defaultEngineer(), [p.jobs]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = readForm(form);
    const data = new FormData(form);
    void run(async () => {
      const kept = record.report?.photo_file_ids ?? [];
      const completion: Completion = {
        date: f.text("date") || todayIso(),
        engineer: f.text("engineer"),
        type,
        duration_hrs: f.num("duration_hrs"),
        completion_notes: f.text("completion_notes"),
        photo_file_ids: kept,
        unit_checks: ctx.units.map((u) => ({
          unit_id: u.id,
          checks: Object.keys(checks).filter((k) => data.get(`ck-${u.id}-${k}`) === "on"),
          off_coil: f.num(`off-${u.id}`),
          on_coil: f.num(`on-${u.id}`),
          amps: f.num(`amps-${u.id}`),
          pressure: f.num(`pressure-${u.id}`),
          notes: f.text(`notes-${u.id}`),
        })),
        leak_check: install
          ? null
          : {
              performed: f.bool("lc_performed"),
              method: f.text("lc_method"),
              result: f.text("lc_result") === "fail" ? "fail" : "pass",
              added_kg: f.num("lc_added"),
              recovered_kg: f.num("lc_recovered"),
              notes: f.text("lc_notes"),
            },
        commissioning: install
          ? {
              pressure_bar: f.num("cm_pressure"),
              pressure_mins: f.num("cm_mins"),
              pressure_held: f.bool("cm_held"),
              vacuum_microns: f.num("cm_vacuum"),
              decay_held: f.bool("cm_decay"),
              pipe_m: f.num("cm_pipe"),
              added_kg: f.num("cm_added"),
              customer_name: f.text("cm_customer"),
              handover: f.bool("cm_handover"),
            }
          : null,
        parts_used: parts.map(toPart),
      };
      const label = [type, j.systems?.clients?.name].filter(Boolean).join(" · ");
      const how = await sendOrSave(
        async () => {
          const uploaded: string[] = [];
          for (const file of photos) uploaded.push(await p.assets.uploadPhoto(file));
          await p.jobs.complete(j.id, { ...completion, photo_file_ids: [...kept, ...uploaded] });
        },
        async () => {
          // No signal: keep it on the phone and send it when the connection's back.
          const local = await enqueuePhotos(p.jobs.orgId, label, photos);
          await enqueue({
            kind: "complete",
            orgId: p.jobs.orgId,
            label,
            jobId: j.id,
            completion: { ...completion, photo_file_ids: [...kept, ...local] },
          });
        },
      );
      p.done(how);
    });
  }

  const addable = ctx.materials.filter((m) => m.active && !parts.some((x) => x.id === m.id));
  if (engineer.value === undefined && !engineer.error) return <Loading />;
  return (
    <form className="stack complete" onSubmit={submit}>
      <section className="card">
        <h2>Visit</h2>
        <div className="grid2">
          <Text name="date" label="Date" type="date" value={j.date ?? todayIso()} required />
          <Text name="engineer" label="Engineer" value={j.engineer || engineer.value} />
          <label>
            Job type
            <select name="type" value={type} onChange={(e) => setType(e.currentTarget.value)}>
              {JOB_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <Text name="duration_hrs" label="Time on site (hours)" type="number" value={j.duration_hrs} />
        </div>
      </section>

      <section className="card">
        <h2>Units</h2>
        {ctx.units.length === 0 && <p className="note">No units on this install yet.</p>}
        {ctx.units.map((u) => {
          const c = prior.get(u.id);
          const ticked = (k: string) => (c ? c.checks.includes(k) : !wasDone);
          return (
            <fieldset key={u.id + type} className="unitcheck">
              <legend>
                <span className="assetno">#{u.asset_no}</span> {unitTitle(u)}
                {u.location && <span className="note"> · {u.location}</span>}
              </legend>
              <div className="ticks">
                {Object.entries(checks)
                  .filter(([k]) => u.role === "indoor" || !INDOOR_ONLY.includes(k))
                  .map(([k, label]) => (
                    <Check key={k} name={`ck-${u.id}-${k}`} label={label} value={ticked(k)} />
                  ))}
              </div>
              <div className="grid2">
                {u.role === "indoor" ? (
                  <>
                    <Text name={`off-${u.id}`} label="Off-coil temp (°C)" type="number" value={c?.off_coil} />
                    <Text
                      name={`on-${u.id}`}
                      label="On-coil / return temp (°C)"
                      type="number"
                      value={c?.on_coil}
                    />
                  </>
                ) : (
                  <>
                    <Text name={`amps-${u.id}`} label="Running current (A)" type="number" value={c?.amps} />
                    <Text
                      name={`pressure-${u.id}`}
                      label="Suction pressure (bar)"
                      type="number"
                      value={c?.pressure}
                    />
                  </>
                )}
              </div>
              <Text name={`notes-${u.id}`} label="Notes or defects" value={c?.notes} />
            </fieldset>
          );
        })}
      </section>

      {install ? (
        <section className="card">
          <h2>Commissioning</h2>
          <div className="grid2">
            <Text
              name="cm_pressure"
              label="Nitrogen pressure test (bar)"
              type="number"
              value={cm?.pressure_bar}
            />
            <Text name="cm_mins" label="Held for (minutes)" type="number" value={cm?.pressure_mins} />
            <Text
              name="cm_vacuum"
              label="Vacuum achieved (microns)"
              type="number"
              value={cm?.vacuum_microns}
            />
            <Text name="cm_pipe" label="Pipe run (m)" type="number" value={cm?.pipe_m} />
            <Text
              name="cm_added"
              label="Extra refrigerant charged (kg)"
              type="number"
              value={cm?.added_kg ?? ctx.system.added_charge_kg}
            />
            <Text name="cm_customer" label="Customer name (handover)" value={cm?.customer_name} />
          </div>
          <div className="ticks">
            <Check name="cm_held" label="Pressure test held" value={cm?.pressure_held ?? true} />
            <Check name="cm_decay" label="Vacuum decay test held" value={cm?.decay_held ?? true} />
            <Check
              name="cm_handover"
              label="Controls shown, manuals and warranty left with the customer"
              value={cm?.handover ?? true}
            />
          </div>
          <p className="note">Saving sets the install date, extra charge and who commissioned it.</p>
        </section>
      ) : (
        <section className="card">
          <div className="row spread">
            <h2>Leak check</h2>
            {info.fgas.required && (
              <span className="pill amber">Required every {info.fgas.months} months</span>
            )}
          </div>
          <Check name="lc_performed" label="Leak check carried out" value={lc ? lc.performed : leakDue} />
          <div className="grid2">
            <Pick
              name="lc_method"
              label="Method"
              value={lc?.method || LEAK_METHODS[0]}
              options={LEAK_METHODS}
            />
            <label>
              Result
              <select name="lc_result" defaultValue={lc?.result ?? "pass"}>
                <option value="pass">No leaks found</option>
                <option value="fail">Leak found</option>
              </select>
            </label>
            <Text name="lc_added" label="Refrigerant added (kg)" type="number" value={lc?.added_kg} />
            <Text
              name="lc_recovered"
              label="Refrigerant recovered (kg)"
              type="number"
              value={lc?.recovered_kg}
            />
          </div>
          <Text name="lc_notes" label="Leak notes" value={lc?.notes} />
        </section>
      )}

      <section className="card">
        <h2>Parts used</h2>
        {parts.length === 0 && <p className="note">No parts on the list.</p>}
        <ul className="rows parts">
          {parts.map((m, i) => (
            <li key={m.id + m.name + i}>
              <div className="item">
                <span className="main">
                  <span className="t">
                    {m.name} {m.extra && <span className="pill">Added</span>}
                  </span>
                  <span className="m">
                    {[m.supplier === "Unassigned" ? "" : m.supplier, m.sku].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <input
                  className="qtyin"
                  type="number"
                  min="0"
                  step="any"
                  aria-label={`Quantity of ${m.name}`}
                  value={m.qty}
                  onChange={(e) => {
                    const qty = Number(e.currentTarget.value);
                    setParts((ps) => ps.map((x, k) => (k === i ? { ...x, qty, raw: qty } : x)));
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
        {addable.length > 0 && (
          <label>
            Add a part
            <select
              value=""
              onChange={(e) => {
                const m = ctx.materials.find((x) => x.id === e.currentTarget.value);
                if (m)
                  setParts((ps) => [
                    ...ps,
                    { id: m.id, name: m.name, sku: m.sku, supplier: m.supplier, qty: 1, raw: 1, extra: true },
                  ]);
              }}
            >
              <option value="">Choose from materials</option>
              {addable.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="card">
        <h2>Engineer's report</h2>
        <Area
          name="completion_notes"
          label="What was found and done"
          value={record.report?.text ?? j.completion_notes}
        />
        <label className="btn">
          <Icon name="plus" size={18} />
          {photos.length ? `${photos.length} photo${photos.length > 1 ? "s" : ""} added` : "Add photos"}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            aria-label="Photos"
            onChange={(e) => setPhotos([...photos, ...Array.from(e.currentTarget.files ?? [])])}
          />
        </label>
        {!!record.report?.photo_file_ids.length && (
          <p className="note">{record.report.photo_file_ids.length} photo(s) already on this job are kept.</p>
        )}
      </section>

      <div className="card sticky-actions">
        <ErrorLine error={error} />
        <div className="row">
          <button className="btn pri" type="submit" disabled={busy}>
            <Icon name="check" size={18} />
            {busy ? "Saving…" : wasDone ? "Save record" : "Complete job"}
          </button>
          <a className="btn" href={`#/job/${j.id}`}>
            Cancel
          </a>
        </div>
      </div>
    </form>
  );
}

// ---------- on an install's page ----------

/** An install's jobs, with Book a job and Start service. */
export function SystemJobs({ jobs, systemId }: { jobs: JobsApi; systemId: string }) {
  const list = useLoad(() => jobs.systemJobs(systemId), [jobs, systemId]);
  const act = useAction();
  const all = list.value ?? [];
  const booked = all.filter((j) => j.status === "booked").reverse();
  const done = all.filter((j) => j.status === "completed");
  function startService() {
    // The nearest booked job within a week, or a new service for today.
    const today = todayIso();
    const near = booked
      .filter((j) => j.date && Math.abs(Date.parse(j.date) - Date.parse(today)) <= 7 * 864e5)
      .sort(
        (a, b) =>
          Math.abs(Date.parse(a.date ?? "") - Date.parse(today)) -
          Math.abs(Date.parse(b.date ?? "") - Date.parse(today)),
      )[0];
    void act.run(async () => {
      const me = near ? null : await jobs.me();
      const id =
        near?.id ??
        (await jobs.saveJob({
          system_id: systemId,
          type: "Annual service",
          status: "booked",
          date: today,
          time: null,
          duration_hrs: null,
          engineer_id: me?.id ?? null,
          engineer: me?.name ?? (await jobs.defaultEngineer()),
          notes: "",
        }));
      go(`#/job/${id}?do=complete`);
    });
  }
  return (
    <section className="card">
      <div className="row spread">
        <h2>Jobs</h2>
        <div className="row">
          <a className="btn" href={`#/job/new?system=${systemId}`}>
            <Icon name="plus" size={18} />
            Book a job
          </a>
          <button className="btn pri" onClick={startService} disabled={act.busy}>
            <Icon name="check" size={18} />
            Start service
          </button>
        </div>
      </div>
      <ErrorLine error={act.error || list.error} />
      {!list.value ? (
        <Loading />
      ) : (
        <JobRows
          jobs={[...booked, ...done]}
          empty={
            <Empty icon="calendar" title="No jobs yet">
              Book the next visit, or start a service now.
            </Empty>
          }
        />
      )}
    </section>
  );
}

// ---------- materials ----------

export function MaterialsPage({ jobs, business }: { jobs: JobsApi; business: Business }) {
  const list = useLoad(() => jobs.materials(), [jobs]);
  const owner = business.role === "owner";
  const [editing, setEditing] = useState<MaterialRow | "new" | null>(null);
  const act = useAction();
  return (
    <>
      <PageHead
        back={{ href: "#/business", label: "Business" }}
        title="Materials"
        sub="The service kit each job's parts list is worked out from."
      >
        {owner && !editing && (
          <button className="btn pri" onClick={() => setEditing("new")}>
            <Icon name="plus" size={18} />
            Add material
          </button>
        )}
      </PageHead>
      {editing && (
        <MaterialForm
          jobs={jobs}
          material={editing === "new" ? null : editing}
          done={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
      <section className="card">
        <ErrorLine error={list.error || act.error} />
        {!list.value ? (
          <Loading />
        ) : list.value.length === 0 ? (
          <Empty icon="note" title="No materials yet">
            {owner
              ? "Add the parts you take on services, like filters, coil cleaner and drain tablets. Each job's parts list is then worked out for you."
              : "Ask an owner to add the service kit."}
          </Empty>
        ) : (
          <ul className="rows">
            {list.value.map((m) => (
              <li key={m.id}>
                <div className="item">
                  <span className="main">
                    <span className="t">
                      {m.name} {!m.active && <span className="pill">Not in use</span>}
                    </span>
                    <span className="m">
                      {[
                        `${m.qty_per} ${APPLIES_TO[m.applies_to as keyof typeof APPLIES_TO]?.toLowerCase() ?? m.applies_to}`,
                        NEEDED_WHEN[m.needed_when as keyof typeof NEEDED_WHEN],
                        m.supplier,
                        m.sku,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </div>
                {owner && (
                  <button className="btn" onClick={() => setEditing(m)}>
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function MaterialForm({
  jobs,
  material,
  done,
}: {
  jobs: JobsApi;
  material: MaterialRow | null;
  done: () => void;
}) {
  const m = material;
  const { busy, error, run } = useAction();
  const appliesKeys = Object.keys(APPLIES_TO) as (keyof typeof APPLIES_TO)[];
  const whenKeys = Object.keys(NEEDED_WHEN) as (keyof typeof NEEDED_WHEN)[];
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    void run(async () => {
      await jobs.saveMaterial({
        id: m?.id,
        name: f.text("name"),
        supplier: f.text("supplier"),
        sku: f.text("sku"),
        applies_to: f.text("applies_to"),
        qty_per: f.num("qty_per") || 1,
        needed_when: f.text("needed_when"),
        active: f.bool("active"),
      });
      done();
    });
  }
  return (
    <form className="card form narrowform" onSubmit={submit}>
      <h2>{m ? `Edit ${m.name}` : "New material"}</h2>
      <ErrorLine error={error} />
      <Text name="name" label="Name" value={m?.name} required />
      <div className="grid2">
        <Text name="supplier" label="Supplier" value={m?.supplier} />
        <Text name="sku" label="Supplier code" value={m?.sku} />
        <label>
          Counted
          <select name="applies_to" defaultValue={m?.applies_to ?? "visit"}>
            {appliesKeys.map((k) => (
              <option key={k} value={k}>
                {APPLIES_TO[k]}
              </option>
            ))}
          </select>
        </label>
        <Text name="qty_per" label="How many each" type="number" value={m?.qty_per ?? 1} />
        <label>
          Needed
          <select name="needed_when" defaultValue={m?.needed_when ?? "service"}>
            {whenKeys.map((k) => (
              <option key={k} value={k}>
                {NEEDED_WHEN[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Check name="active" label="In use" value={m?.active ?? true} />
      <p className="note">Prices come later, in the owner-only price list.</p>
      <div className="row">
        <button className="btn pri" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn" type="button" onClick={done}>
          Cancel
        </button>
        {m && (
          <button
            className="btn danger"
            type="button"
            disabled={busy}
            onClick={() =>
              confirm(`Remove ${m.name}? Past jobs keep their parts lists.`) &&
              void run(async () => {
                await jobs.deleteMaterial(m.id);
                done();
              })
            }
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}
