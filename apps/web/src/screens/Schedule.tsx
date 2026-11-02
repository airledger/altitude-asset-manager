// The schedule: who's doing what, when. Phones get a day-by-day agenda; the office gets a week with a lane
// per engineer and a month view. Owners drag jobs to another day or engineer. Each person can also put
// their jobs in Apple Calendar, Google Calendar or Outlook with a private link.
import { addDays } from "@airledger/domain";
import { useState, type DragEvent, type ReactNode } from "react";
import type { Business } from "../api";
import { Icon } from "../icons";
import { calendarUrls, type JobListRow, type JobsApi, type PersonRow } from "../jobs";
import { Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { go, todayIso, useLoad } from "./Assets";

type View = "agenda" | "week" | "month";
const VIEWS: Record<View, string> = { agenda: "Agenda", week: "Week", month: "Month" };
const NOBODY = "none";

const utc = (iso: string) => new Date(iso + "T12:00:00Z");
const label = (iso: string, o: Intl.DateTimeFormatOptions) =>
  utc(iso).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
/** Monday of the week `iso` is in. */
export const mondayOf = (iso: string) => addDays(iso, -((utc(iso).getUTCDay() + 6) % 7));
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

const wide = () => typeof window.matchMedia === "function" && window.matchMedia("(min-width: 900px)").matches;

function href(q: { view: View; d: string; who: string }) {
  return `#/schedule?view=${q.view}&d=${q.d}&who=${encodeURIComponent(q.who)}`;
}

export function SchedulePage({
  jobs,
  business,
  query,
}: {
  jobs: JobsApi;
  business: Business;
  query: URLSearchParams;
}) {
  const owner = business.role === "owner";
  const list = useLoad(() => jobs.jobs(), [jobs]);
  const people = useLoad(() => jobs.people(), [jobs]);
  const act = useAction();
  const team = people.value ?? [];
  const me = team.find((x) => x.active && x.user_id === jobs.userId) ?? null;

  const view: View =
    (query.get("view") as View) in VIEWS ? (query.get("view") as View) : wide() ? "week" : "agenda";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(query.get("d") ?? "") ? (query.get("d") as string) : todayIso();
  // Engineers see their own jobs to start with; owners see everyone's.
  const who = query.get("who") ?? (owner || !me ? "all" : me.id);
  const q = { view, d, who };

  if (!list.value || !people.value)
    return (
      <>
        <ErrorLine error={list.error || people.error} />
        <Loading />
      </>
    );

  const forWho = (j: JobListRow) =>
    who === "all" || (who === NOBODY ? !j.engineer_id : j.engineer_id === who);
  const dated = list.value.filter((j) => j.date && forWho(j));
  const onDay = (iso: string, lane?: string) =>
    dated
      .filter((j) => j.date === iso && (lane === undefined || (j.engineer_id ?? NOBODY) === lane))
      .sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));

  // Lanes for the week: everyone active (or just the person chosen), plus anyone who left but still has jobs.
  const lanes: { id: string; name: string }[] =
    who === "all"
      ? [
          ...team
            .filter((x) => x.active || dated.some((j) => j.engineer_id === x.id))
            .map((x) => ({ id: x.id, name: x.name || x.email })),
          { id: NOBODY, name: "Not assigned" },
        ]
      : [{ id: who, name: who === NOBODY ? "Not assigned" : (team.find((x) => x.id === who)?.name ?? "") }];

  const drop = (iso: string, lane?: string) => (e: DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/job");
    const j = list.value?.find((x) => x.id === id);
    if (!j) return;
    const person = lane === undefined ? undefined : team.find((x) => x.id === lane);
    const engineer =
      lane === undefined || lane === (j.engineer_id ?? NOBODY)
        ? undefined
        : { id: person?.id ?? null, name: person?.name ?? "" };
    if (j.date === iso && !engineer) return;
    void act.run(async () => {
      await jobs.move(j.id, iso, engineer);
      list.reload();
    });
  };
  const canDrag = (j: JobListRow) => owner && j.status === "booked";

  const step = view === "month" ? 0 : view === "week" ? 7 : 14;
  const prev = view === "month" ? monthStart(d, -1) : addDays(view === "week" ? mondayOf(d) : d, -step);
  const next = view === "month" ? monthStart(d, 1) : addDays(view === "week" ? mondayOf(d) : d, step);

  return (
    <>
      <PageHead back={{ href: "#/jobs", label: "Jobs" }} title="Schedule" sub={business.name}>
        <a className="btn pri" href={`#/job/new?date=${d >= todayIso() ? d : todayIso()}`}>
          <Icon name="plus" size={18} />
          Book a job
        </a>
      </PageHead>
      <section className="card schedule">
        <div className="sched-bar">
          <div className="chips" role="group" aria-label="View">
            {(Object.keys(VIEWS) as View[]).map((v) => (
              <button
                key={v}
                className="chip"
                aria-pressed={v === view}
                onClick={() => go(href({ ...q, view: v }))}
              >
                {VIEWS[v]}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn" aria-label="Earlier" onClick={() => go(href({ ...q, d: prev }))}>
              ‹
            </button>
            <button className="btn" onClick={() => go(href({ ...q, d: todayIso() }))}>
              Today
            </button>
            <button className="btn" aria-label="Later" onClick={() => go(href({ ...q, d: next }))}>
              ›
            </button>
          </div>
          <label className="who">
            <span className="sr">Whose jobs</span>
            <select value={who} onChange={(e) => go(href({ ...q, who: e.currentTarget.value }))}>
              <option value="all">Everyone</option>
              {team
                .filter((x) => x.active)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.id === me?.id ? `Me (${x.name})` : x.name || x.email}
                  </option>
                ))}
              <option value={NOBODY}>Not assigned</option>
            </select>
          </label>
        </div>
        <ErrorLine error={act.error} />
        <h2 className="sched-title">{title(view, d)}</h2>
        {view === "agenda" && <Agenda from={d} onDay={onDay} />}
        {view === "week" && (
          <div className="week-scroll">
            <div className="week" role="table" aria-label={title(view, d)}>
              <div role="row" className="week-row head">
                <span role="columnheader" />
                {days(mondayOf(d), 7).map((iso) => (
                  <span role="columnheader" key={iso} className={iso === todayIso() ? "today" : undefined}>
                    {label(iso, { weekday: "short", day: "numeric" })}
                  </span>
                ))}
              </div>
              {lanes.map((lane) => (
                <div role="row" className="week-row" key={lane.id}>
                  <span role="rowheader" className="lane">
                    {lane.name}
                  </span>
                  {days(mondayOf(d), 7).map((iso) => (
                    <div
                      role="cell"
                      key={iso}
                      className={`slot${iso === todayIso() ? " today" : ""}`}
                      onDragOver={owner ? (e) => e.preventDefault() : undefined}
                      onDrop={owner ? drop(iso, lane.id) : undefined}
                    >
                      {onDay(iso, lane.id).map((j) => (
                        <JobChip key={j.id} job={j} draggable={canDrag(j)} />
                      ))}
                      <a
                        className="slot-add"
                        href={`#/job/new?date=${iso}${lane.id === NOBODY ? "" : `&engineer=${lane.id}`}`}
                        aria-label={`Book a job on ${label(iso, { weekday: "long", day: "numeric", month: "long" })} for ${lane.name}`}
                      >
                        +
                      </a>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        {view === "month" && (
          <div className="month" role="table" aria-label={title(view, d)}>
            <div role="row" className="month-row head">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((x) => (
                <span role="columnheader" key={x}>
                  {x}
                </span>
              ))}
            </div>
            {weeksOf(d).map((week) => (
              <div role="row" className="month-row" key={week[0]}>
                {week.map((iso) => {
                  const here = onDay(iso);
                  return (
                    <div
                      role="cell"
                      key={iso}
                      className={`mday${iso.slice(0, 7) === d.slice(0, 7) ? "" : " other"}${iso === todayIso() ? " today" : ""}`}
                      onDragOver={owner ? (e) => e.preventDefault() : undefined}
                      onDrop={owner ? drop(iso) : undefined}
                    >
                      <a className="mday-n" href={href({ ...q, view: "week", d: iso })}>
                        {utc(iso).getUTCDate()}
                      </a>
                      {here.slice(0, 3).map((j) => (
                        <JobChip key={j.id} job={j} draggable={canDrag(j)} short />
                      ))}
                      {here.length > 3 && (
                        <a className="more" href={href({ ...q, view: "agenda", d: iso })}>
                          +{here.length - 3} more
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {owner && view !== "agenda" && (
          <p className="note">Drag a job to another day{view === "week" ? " or engineer" : ""} to move it.</p>
        )}
      </section>
      <CalendarLinks jobs={jobs} owner={owner} me={me} team={team} business={business} />
    </>
  );
}

function title(view: View, d: string) {
  if (view === "month") return label(d, { month: "long", year: "numeric" });
  if (view === "week") {
    const m = mondayOf(d);
    return `Week of ${label(m, { day: "numeric", month: "long" })}`;
  }
  return `From ${label(d, { weekday: "long", day: "numeric", month: "long" })}`;
}

/** The 1st of the month `by` months from `iso`'s. */
export function monthStart(iso: string, by: number) {
  const t = utc(iso.slice(0, 8) + "01");
  t.setUTCMonth(t.getUTCMonth() + by);
  return t.toISOString().slice(0, 10);
}

/** The Monday-to-Sunday weeks covering `iso`'s month. */
export function weeksOf(iso: string): string[][] {
  const first = monthStart(iso, 0);
  const last = addDays(monthStart(iso, 1), -1);
  const weeks: string[][] = [];
  for (let m = mondayOf(first); m <= last; m = addDays(m, 7)) weeks.push(days(m, 7));
  return weeks;
}

function JobChip({ job: j, draggable, short }: { job: JobListRow; draggable: boolean; short?: boolean }) {
  const state =
    j.status === "completed"
      ? "done"
      : j.status === "cancelled"
        ? "cancelled"
        : j.date && j.date < todayIso()
          ? "overdue"
          : "";
  const client = j.systems?.clients?.name ?? j.systems?.name ?? "";
  return (
    <a
      className={`jobchip ${state}`}
      href={`#/job/${j.id}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/job", j.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      title={[j.time?.slice(0, 5), j.type, client, j.systems?.site_postcode, j.engineer]
        .filter(Boolean)
        .join(" · ")}
    >
      {j.time && <b>{j.time.slice(0, 5)}</b>} {short ? client || j.type : `${j.type} · ${client}`}
    </a>
  );
}

/** Phones: the next two weeks, day by day, skipping empty days. */
function Agenda({ from, onDay }: { from: string; onDay: (iso: string) => JobListRow[] }) {
  const list = days(from, 14)
    .map((iso) => ({ iso, jobs: onDay(iso) }))
    .filter((x) => x.jobs.length);
  if (!list.length) return <p className="note">Nothing booked in these two weeks.</p>;
  return (
    <div className="agenda">
      {list.map(({ iso, jobs }) => (
        <section key={iso}>
          <h3 className={iso === todayIso() ? "today" : undefined}>
            {iso === todayIso() ? "Today, " : ""}
            {label(iso, { weekday: "long", day: "numeric", month: "long" })}
          </h3>
          <ul className="rows">
            {jobs.map((j) => (
              <li key={j.id}>
                <a className="item" href={`#/job/${j.id}`}>
                  <span className="datebox" aria-hidden="true">
                    <b>{j.time ? j.time.slice(0, 5) : "Day"}</b>
                    {j.duration_hrs ? `${j.duration_hrs} h` : ""}
                  </span>
                  <span className="main">
                    <span className="t">
                      {j.type} · {j.systems?.clients?.name ?? "No client"}
                    </span>
                    <span className="m">
                      {[j.systems?.site_address, j.systems?.site_postcode, j.engineer || "Not assigned"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {j.status !== "booked" && (
                    <span className={`pill${j.status === "completed" ? " green" : ""}`}>
                      {j.status === "completed" ? "Done" : "Cancelled"}
                    </span>
                  )}
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Private links that put jobs in a calendar app. Owners can get anyone's, or everyone's. */
function CalendarLinks(p: {
  jobs: JobsApi;
  owner: boolean;
  me: PersonRow | null;
  team: PersonRow[];
  business: Business;
}) {
  const choices: { id: string | null; name: string }[] = [
    ...(p.me ? [{ id: p.me.id, name: "My jobs" }] : []),
    ...(p.owner
      ? [
          { id: null, name: "Everyone's jobs" },
          ...p.team
            .filter((x) => x.active && x.id !== p.me?.id)
            .map((x) => ({ id: x.id, name: x.name || x.email })),
        ]
      : []),
  ];
  const [whose, setWhose] = useState<string>(choices[0]?.id ?? "");
  const [token, setToken] = useState("");
  const { busy, error, run } = useAction();
  if (!choices.length) return null;
  const chosen = choices.find((c) => (c.id ?? "") === whose) ?? choices[0];
  const name = `${p.business.name}${chosen?.id === p.me?.id ? "" : ` · ${chosen?.name}`}`;
  const urls = token ? calendarUrls(token, `Air Ledger · ${name}`) : null;
  const get = (renew: boolean) =>
    void run(async () => setToken(await p.jobs.calendarToken(chosen?.id ?? null, renew)));

  return (
    <section className="card">
      <h2>Put jobs in your calendar</h2>
      <p className="note">
        Subscribe once and new, moved and cancelled jobs show up in your phone's calendar by themselves. Apple
        Calendar checks about every hour; Google and Outlook can take a few hours.
      </p>
      <ErrorLine error={error} />
      {choices.length > 1 && (
        <label>
          Whose jobs
          <select
            value={whose}
            onChange={(e) => {
              setWhose(e.currentTarget.value);
              setToken("");
            }}
          >
            {choices.map((c) => (
              <option key={c.id ?? "all"} value={c.id ?? ""}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!urls ? (
        <button className="btn pri" disabled={busy} onClick={() => get(false)}>
          <Icon name="calendar" size={18} />
          Get calendar link
        </button>
      ) : (
        <>
          <div className="row wrap">
            <a className="btn pri" href={urls.apple}>
              iPhone / Apple Calendar
            </a>
            <a className="btn" href={urls.google} target="_blank" rel="noreferrer">
              Google Calendar
            </a>
            <a className="btn" href={urls.outlook} target="_blank" rel="noreferrer">
              Outlook
            </a>
            <a className="btn" href={urls.outlookWork} target="_blank" rel="noreferrer">
              Outlook (work or school)
            </a>
          </div>
          <CopyLine value={urls.https} label="Calendar link" />
          <p className="note">
            Keep this link to yourself: anyone who has it can see these jobs.{" "}
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() => {
                if (confirm("Make a new link? Calendars using the old one stop updating.")) get(true);
              }}
            >
              Make a new link
            </button>
          </p>
        </>
      )}
    </section>
  );
}

function CopyLine({ value, label: l }: { value: string; label: string }): ReactNode {
  return (
    <div className="copy">
      <input readOnly value={value} aria-label={l} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(value)}>
        Copy
      </button>
    </div>
  );
}
