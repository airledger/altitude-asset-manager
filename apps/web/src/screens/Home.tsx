// Home: what needs doing today. Services due and overdue across every install, plus quick ways in.
import type { DueStatus } from "@airledger/domain";
import type { Business } from "../api";
import type { Assets } from "../assets";
import { useEffect } from "react";
import { Icon } from "../icons";
import { scheduleReminders } from "../native";
import type { ContractsApi } from "../contracts";
import type { JobsApi } from "../jobs";
import type { PortalApi } from "../portal";
import { jobsToOrder, loadOverview } from "../overview";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine } from "../useAction";
import { todayIso, useLoad } from "./Assets";
import { JobRows } from "./Jobs";
import { RenewalsCard } from "./Contracts";
import { RequestsCard } from "./PortalAdmin";
import { ScanBox } from "./Stickers";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export function Home(p: {
  assets: Assets;
  jobs: JobsApi;
  /** Owners see contracts coming up for renewal. */
  contracts?: ContractsApi;
  /** Visit requests from customers' portals. */
  portal?: PortalApi;
  current: Business;
  businesses: Business[];
  choose: (id: string) => void;
  email: string;
  signOut: () => void;
}) {
  const today = todayIso();
  const data = useLoad(
    () => Promise.all([loadOverview(p.assets, p.jobs, today), p.jobs.me()]),
    [p.assets, p.jobs],
  );
  const o = data.value?.[0];
  const me = data.value?.[1] ?? null;
  // In the phone apps, 8am service-due and leak-check notifications are planned from this load.
  useEffect(() => {
    if (o) void scheduleReminders(o, o.leadDays);
  }, [o]);
  const owner = p.current.role === "owner";
  const rows = (o?.sites ?? []).map((x) => ({
    s: { ...x.system, clients: x.client },
    info: x.info,
    status: x.status,
  }));
  const count = (k: DueStatus["key"]) => rows.filter((r) => r.status.key === k).length;
  const attention = rows
    .filter((r) => r.status.needsAction)
    .sort((a, b) => String(a.info.nextDue).localeCompare(String(b.info.nextDue)));
  // Engineers see their own day; owners see everyone's.
  const todays = (o?.jobs ?? [])
    .filter((j) => j.date === today && j.status !== "cancelled" && (owner || !me || j.engineer_id === me.id))
    .sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
  const toOrder = o ? jobsToOrder(o, 14).length : 0;
  const clientCount = new Set(rows.map((r) => r.s.client_id)).size;

  return (
    <>
      <PageHead
        title={greeting()}
        sub={
          <>
            {p.businesses.length > 1 ? (
              <select
                className="bizpick"
                aria-label="Business"
                value={p.current.id}
                onChange={(e) => p.choose(e.currentTarget.value)}
              >
                {p.businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <b>{p.current.name}</b>
            )}{" "}
            · {p.current.role === "owner" ? "Owner" : "Engineer"}
          </>
        }
      >
        {p.current.logoUrl && <img className="bizlogo" src={p.current.logoUrl} alt="" />}
      </PageHead>
      <ErrorLine error={data.error} />
      <div className="kpis">
        <a className="kpi" href="#/schedule">
          <span className="kpi-n">{o ? todays.length : "–"}</span>
          <span className="kpi-l">{owner ? "Jobs today" : "Your jobs today"}</span>
        </a>
        <a className="kpi amber" href="#/reminders">
          <span className="kpi-n">{o ? count("due") + count("chase") : "–"}</span>
          <span className="kpi-l">Due soon</span>
        </a>
        <a className="kpi red" href="#/reminders">
          <span className="kpi-n">{o ? count("overdue") : "–"}</span>
          <span className="kpi-l">Overdue</span>
        </a>
        <a className="kpi" href="#/orders">
          <span className="kpi-n">{o ? toOrder : "–"}</span>
          <span className="kpi-l">Jobs needing parts</span>
        </a>
      </div>
      <div className="split">
        <section className="card">
          <div className="row spread">
            <h2>{owner ? "Today" : "Your day"}</h2>
            <a className="link" href="#/schedule">
              Schedule
            </a>
          </div>
          {!o ? (
            <Loading />
          ) : (
            <JobRows
              jobs={todays}
              empty={
                <Empty icon="calendar" title="Nothing booked today">
                  {clientCount ? "Book a job from an install or the Jobs tab." : null}
                </Empty>
              }
            />
          )}
        </section>
        <section className="card">
          <div className="row spread">
            <h2>Needs attention</h2>
            {attention.length > 0 && (
              <a className="link" href="#/reminders">
                {attention.length} to contact
              </a>
            )}
          </div>
          {!o ? (
            <Loading />
          ) : attention.length === 0 ? (
            <Empty icon="check" title="All up to date">
              {rows.length
                ? "No services are due in the next few weeks."
                : "Add your clients and their installs, and services due will show here."}
            </Empty>
          ) : (
            <ul className="rows">
              {attention.slice(0, 12).map(({ s, status }) => (
                <li key={s.id}>
                  <a className="item" href={`#/reminders?open=${s.id}`}>
                    <span className="main">
                      <span className="t">{s.clients?.name ?? s.name}</span>
                      <span className="m">{[s.name, s.site_postcode].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className={`pill ${status.tone}`}>{status.label}</span>
                    <Icon name="chevron" size={18} />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {!rows.length && o && (
            <a className="btn pri" href="#/client/new">
              <Icon name="plus" size={18} />
              Add your first client
            </a>
          )}
        </section>
      </div>
      {p.portal && <RequestsCard portal={p.portal} orgId={p.current.id} />}
      {owner && p.contracts && <RenewalsCard contracts={p.contracts} />}
      <div className="split">
        <ScanBox />
        <section className="card linkcard">
          <ul className="rows">
            {[
              ["#/reminders", "Reminders", "Services due and who to contact"],
              ["#/orders", "Parts to order", "For the next week, fortnight or month"],
              ["#/register", "Asset register", "Every unit, with F-gas figures, as PDF or CSV"],
              ["#/reports", "Service reports", "Every report issued, to view, download or resend"],
            ].map(([href, t, m]) => (
              <li key={href}>
                <a className="item" href={href}>
                  <span className="main">
                    <span className="t">{t}</span>
                    <span className="m">{m}</span>
                  </span>
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="signed">
        Signed in as <b>{p.email}</b> ·{" "}
        <a className="link" href="#/account">
          Your account
        </a>{" "}
        ·{" "}
        <button className="link" onClick={p.signOut}>
          Sign out
        </button>
      </p>
    </>
  );
}
