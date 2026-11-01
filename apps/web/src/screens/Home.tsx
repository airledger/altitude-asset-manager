// Home: what needs doing today. Services due and overdue across every install, plus quick ways in.
import { dueStatus, systemInfo, type DueStatus } from "@airledger/domain";
import type { Business } from "../api";
import { toDomain, toSettings, type Assets } from "../assets";
import { Icon } from "../icons";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine } from "../useAction";
import { todayIso, useLoad } from "./Assets";
import { ScanBox } from "./Stickers";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export function Home(p: {
  assets: Assets;
  current: Business;
  businesses: Business[];
  choose: (id: string) => void;
  email: string;
  signOut: () => void;
}) {
  const data = useLoad(
    () => Promise.all([p.assets.allSystems(), p.assets.clients(), p.assets.ruleSettings()]),
    [p.assets],
  );
  const today = todayIso();
  const rows =
    data.value?.[0].map((s) => {
      const sys = toDomain(s);
      const st = toSettings(data.value?.[2] ?? null);
      const info = systemInfo(sys, [], st, today);
      return { s, info, status: dueStatus(sys, info, st, today) };
    }) ?? [];
  const count = (k: DueStatus["key"]) => rows.filter((r) => r.status.key === k).length;
  const attention = rows
    .filter((r) => r.status.needsAction)
    .sort((a, b) => String(a.info.nextDue).localeCompare(String(b.info.nextDue)));

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
        <a className="kpi" href="#/clients">
          <span className="kpi-n">{data.value ? data.value[1].length : "–"}</span>
          <span className="kpi-l">Clients</span>
        </a>
        <a className="kpi" href="#/clients">
          <span className="kpi-n">{data.value ? rows.length : "–"}</span>
          <span className="kpi-l">Installs</span>
        </a>
        <div className="kpi amber">
          <span className="kpi-n">{data.value ? count("due") + count("chase") : "–"}</span>
          <span className="kpi-l">Due soon</span>
        </div>
        <div className="kpi red">
          <span className="kpi-n">{data.value ? count("overdue") : "–"}</span>
          <span className="kpi-l">Overdue</span>
        </div>
      </div>
      <div className="split">
        <section className="card">
          <div className="row spread">
            <h2>Needs attention</h2>
            {attention.length > 0 && <span className="pill amber">{attention.length}</span>}
          </div>
          {!data.value ? (
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
                  <a className="item" href={`#/system/${s.id}`}>
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
          {!rows.length && data.value && (
            <a className="btn pri" href="#/client/new">
              <Icon name="plus" size={18} />
              Add your first client
            </a>
          )}
        </section>
        <ScanBox />
      </div>
      <p className="signed">
        Signed in as <b>{p.email}</b> ·{" "}
        <button className="link" onClick={p.signOut}>
          Sign out
        </button>
      </p>
    </>
  );
}
