// Timesheets: on a job, each person taps Set off, Arrived on site and Finished (saved on the phone with no
// signal, with the time it was tapped). Owners see everyone's hours for the week, correct them and download
// them as CSV.
import { addDays, formatDate, toCsv } from "@airledger/domain";
import { useState, type FormEvent } from "react";
import { enqueue, sendOrSave, type OutboxItem } from "../outbox";
import { download } from "../stickerPdf";
import {
  hm,
  nextStage,
  siteHours,
  STAGE_LABEL,
  timesheetCsvRows,
  travelHours,
  weekTotals,
  type JobTime,
  type Stage,
  type TimesApi,
} from "../timesheets";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { todayIso, useLoad } from "./Assets";
import { useOutbox } from "./Outbox";

const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "–";

/** For a datetime-local box: the time in the phone's own time zone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/** A server row with taps still waiting to send laid over it, in order. */
function withWaiting(row: JobTime | undefined, waiting: { stage: Stage; at: string }[], base: JobTime) {
  let t: JobTime = row ?? base;
  for (const w of waiting)
    t =
      w.stage === "travel"
        ? { ...t, travel_at: w.at, arrived_at: null, left_at: null }
        : w.stage === "arrived"
          ? { ...t, arrived_at: w.at, left_at: null }
          : { ...t, left_at: w.at };
  return t;
}

export function TimesCard(p: {
  times: TimesApi;
  orgId: string;
  jobId: string;
  userId: string;
  /** The signed-in person's name, as it goes on the timesheet. */
  me: string;
  owner: boolean;
  /** Shown in the outbox, e.g. "Annual service · Harbour Dental". */
  label: string;
  /** Completed or cancelled jobs can't be clocked on to (owners can still correct them). */
  open: boolean;
}) {
  const rows = useLoad(() => p.times.forJob(p.jobId), [p.times, p.jobId]);
  const { items } = useOutbox();
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const waiting = items
    .filter((i): i is OutboxItem & { kind: "time" } => i.kind === "time" && i.jobId === p.jobId && !i.error)
    .map((i) => ({ stage: i.stage, at: i.at }));
  const list = rows.value ?? [];
  const base: JobTime = {
    job_id: p.jobId,
    user_id: p.userId,
    name: p.me,
    travel_at: null,
    arrived_at: null,
    left_at: null,
  };
  const mine = withWaiting(
    list.find((r) => r.user_id === p.userId),
    waiting,
    base,
  );
  const shown = [
    ...list.filter((r) => r.user_id !== p.userId),
    ...(mine.travel_at || mine.arrived_at ? [mine] : []),
  ];
  const next = nextStage(mine);

  const tap = (stage: Stage) =>
    void act.run(async () => {
      const at = new Date().toISOString();
      const save = () =>
        enqueue({ kind: "time", orgId: p.orgId, label: p.label, jobId: p.jobId, stage, at, name: p.me });
      // Earlier taps still waiting go first, so this one waits behind them.
      if (waiting.length) await save();
      else await sendOrSave(() => p.times.clock(p.jobId, stage, at, p.me), save);
      rows.reload();
    });

  if (!rows.value && !rows.error) return null;
  if (!p.open && !shown.length) return null;
  return (
    <section className="card" aria-label="Time on this job">
      <div className="row spread">
        <h2>Time</h2>
        {p.owner && list.length > 0 && !editing && (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Correct times
          </button>
        )}
      </div>
      <ErrorLine error={rows.error || act.error} />
      {editing ? (
        <CorrectTimes
          rows={list}
          busy={act.busy}
          cancel={() => setEditing(false)}
          save={(fixed) =>
            void act.run(async () => {
              for (const t of fixed) await p.times.correct(t);
              setEditing(false);
              rows.reload();
            })
          }
        />
      ) : (
        shown.length > 0 && (
          <ul className="rows">
            {shown.map((t) => (
              <li key={t.user_id}>
                <div className="item">
                  <span className="main">
                    <span className="t">{t.user_id === p.userId ? `${t.name || p.me} (you)` : t.name}</span>
                    <span className="m">
                      Set off {hhmm(t.travel_at)} · Arrived {hhmm(t.arrived_at)} · Finished {hhmm(t.left_at)}
                    </span>
                    <span className="m">
                      {[
                        t.travel_at && t.arrived_at && `Travel ${hm(travelHours(t))}`,
                        t.arrived_at && t.left_at && `On site ${hm(siteHours(t))}`,
                        t.user_id === p.userId && waiting.length > 0 && "waiting to send",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
      {p.open && !editing && (
        <div className="row">
          {next && (
            <button type="button" className="btn pri" disabled={act.busy} onClick={() => tap(next)}>
              {STAGE_LABEL[next]}
            </button>
          )}
          {next === "arrived" && (
            <button type="button" className="btn" disabled={act.busy} onClick={() => tap("travel")}>
              Set off again
            </button>
          )}
          {!next && <span className="note">Your time on this job is recorded.</span>}
        </div>
      )}
    </section>
  );
}

function CorrectTimes(p: {
  rows: JobTime[];
  busy: boolean;
  cancel: () => void;
  save: (rows: JobTime[]) => void;
}) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => fromLocalInput(String(f.get(k) ?? ""));
    p.save(
      p.rows.map((r) => ({
        ...r,
        travel_at: get(`${r.user_id}-travel`),
        arrived_at: get(`${r.user_id}-arrived`),
        left_at: get(`${r.user_id}-left`),
      })),
    );
  }
  return (
    <form className="subform" aria-label="Correct times" onSubmit={submit}>
      {p.rows.map((r) => (
        <fieldset key={r.user_id} className="plain">
          <legend>{r.name || "Someone"}</legend>
          {(
            [
              ["travel", "Set off", r.travel_at],
              ["arrived", "Arrived", r.arrived_at],
              ["left", "Finished", r.left_at],
            ] as const
          ).map(([k, label, v]) => (
            <label key={k}>
              {label} ({r.name || "someone"})
              <input type="datetime-local" name={`${r.user_id}-${k}`} defaultValue={toLocalInput(v)} />
            </label>
          ))}
        </fieldset>
      ))}
      <div className="row">
        <button className="btn pri" type="submit" disabled={p.busy}>
          {p.busy ? "Saving…" : "Save"}
        </button>
        <button className="btn" type="button" onClick={p.cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Monday of the week the date is in. */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return addDays(iso, -((d.getDay() + 6) % 7));
}

/** Owners: everyone's travel and time on site for a week, with a CSV download. */
export function TimesheetsPage(p: { times: TimesApi; week: string | null }) {
  const from = weekStart(p.week && /^\d{4}-\d{2}-\d{2}$/.test(p.week) ? p.week : todayIso());
  const to = addDays(from, 7);
  const data = useLoad(() => p.times.week(from, to), [p.times, from]);
  const rows = data.value ?? [];
  const totals = weekTotals(rows);
  return (
    <>
      <PageHead
        back={{ href: "#/jobs", label: "Jobs" }}
        title="Timesheets"
        sub={`Week of ${formatDate(from)}`}
      >
        <a className="btn" href={`#/timesheets?week=${addDays(from, -7)}`}>
          Previous week
        </a>
        <a className="btn" href={`#/timesheets?week=${to}`}>
          Next week
        </a>
        {rows.length > 0 && (
          <button
            className="btn"
            onClick={() =>
              download(
                new Blob([toCsv(timesheetCsvRows(rows))], { type: "text/csv" }),
                `timesheet-${from}.csv`,
              )
            }
          >
            Download CSV
          </button>
        )}
      </PageHead>
      <ErrorLine error={data.error} />
      {!data.value ? (
        !data.error && <Loading />
      ) : rows.length === 0 ? (
        <section className="card">
          <Empty icon="calendar" title="No times this week">
            Engineers tap Set off, Arrived on site and Finished on each job, and their hours show here.
          </Empty>
        </section>
      ) : (
        <>
          <section className="card" aria-label="Hours this week">
            <h2>Hours this week</h2>
            <ul className="rows">
              {totals.map((t) => (
                <li key={t.name}>
                  <div className="item">
                    <span className="main">
                      <span className="t">{t.name || "Someone"}</span>
                      <span className="m">
                        {t.jobs} job{t.jobs === 1 ? "" : "s"} · travel {hm(t.travel)} · on site {hm(t.site)}
                      </span>
                    </span>
                    <b>{hm(t.travel + t.site)}</b>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="card" aria-label="Each job">
            <h2>Each job</h2>
            <ul className="rows">
              {rows.map((r) => (
                <li key={`${r.job_id}-${r.user_id}`}>
                  <a className="item" href={`#/job/${r.job_id}`}>
                    <span className="main">
                      <span className="t">
                        {r.name} · {r.jobs?.type} · {r.jobs?.systems?.clients?.name ?? r.jobs?.systems?.name}
                      </span>
                      <span className="m">
                        {formatDate(new Date(r.arrived_at ?? "").toLocaleDateString("en-CA"))} · arrived{" "}
                        {hhmm(r.arrived_at)} · finished {hhmm(r.left_at)} · travel {hm(travelHours(r))} · on
                        site {hm(siteHours(r))}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
