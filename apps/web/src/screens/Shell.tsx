import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import type { Api, Business } from "../api";
import { assets as makeAssets, type Assets } from "../assets";
import { jobsApi, type JobsApi } from "../jobs";
import { Icon, type IconName } from "../icons";
import { Frame } from "../ui";
import { ClientList, ClientPage, SystemPage, UnitPage, useLoad } from "./Assets";
import { AccountPage } from "./Account";
import { BusinessSettings } from "./BusinessSettings";
import { Home } from "./Home";
import { JobPage, JobsPage, MaterialsPage } from "./Jobs";
import { OrdersPage } from "./Orders";
import { OutboxBar } from "./Outbox";
import { RegisterPage } from "./Register";
import { RefrigerantPage } from "./Refrigerant";
import { refrigerantApi } from "../refrigerant";
import { RemindersPage } from "./Reminders";
import { ReportsPage } from "./Reports";
import { InvoicePage, InvoicesPage, PricingPage, ClientBillingCard } from "./Invoices";
import { ContractsCard } from "./Contracts";
import { contractsApi } from "../contracts";
import { portalApi } from "../portal";
import { paymentsApi } from "../payments";
import { PortalCard } from "./PortalAdmin";
import { invoicesApi } from "../invoices";
import { reportsApi } from "../reports";
import { SchedulePage } from "./Schedule";
import { StickerDesigner } from "./StickerDesigner";
import { ScanButton, StickersPage } from "./Stickers";
import { Team } from "./Team";
import { TimesheetsPage } from "./Timesheets";
import { timesApi } from "../timesheets";
import { smsApi } from "../sms";
import { diaryApi } from "../diary";
import { importApi } from "../importer";
import { ImportPage } from "./Import";
import { FormsPage } from "./Forms";
import { formsApi } from "../forms";
import { subsApi } from "../subs";
import { SubPapersCard, SubcontractorsPage } from "./Subs";
import type { SubsApi } from "../subs";

// A subcontractor only has their jobs, their diary and their account.
const subTabs: Record<string, { label: string; icon: IconName }> = {
  jobs: { label: "Your jobs", icon: "jobs" },
  schedule: { label: "Diary", icon: "calendar" },
  account: { label: "Your account", icon: "team" },
};
const SUB_PAGES = ["jobs", "job", "schedule", "account", "system", "u"];
const tabs: Record<string, { label: string; icon: IconName }> = {
  "": { label: "Home", icon: "home" },
  clients: { label: "Clients", icon: "clients" },
  jobs: { label: "Jobs", icon: "jobs" },
  labels: { label: "Asset labels", icon: "sticker" },
  invoices: { label: "Invoices", icon: "report" },
  business: { label: "Business", icon: "business" },
};
type Tab = string;
export interface Route {
  page: string;
  arg: string;
  query: URLSearchParams;
}

/** `#/client/<id>`, `#/system/new?client=<id>`, `#/u/AC-XXXXX`; old stickers use `#u-AC-XXXXX`. */
export function readHash(hash = window.location.hash): Route {
  const old = hash.match(/^#u-([A-Za-z0-9-]+)/);
  if (old?.[1]) return { page: "u", arg: old[1].toUpperCase(), query: new URLSearchParams() };
  const [path = "", qs = ""] = hash.replace(/^#\/?/, "").split("?");
  const [page = "", arg = ""] = path.split("/");
  return { page, arg: decodeURIComponent(arg), query: new URLSearchParams(qs) };
}

/** Which tab a page belongs under. */
const tabOf = (page: string): Tab =>
  ["client", "system", "register", "import"].includes(page)
    ? "clients"
    : ["job", "schedule", "orders", "reports", "refrigerant", "timesheets"].includes(page)
      ? "jobs"
      : page === "u" || page === "stickers"
        ? "labels"
        : page === "invoice" || page === "pricing"
          ? "invoices"
          : page === "team" ||
              page === "materials" ||
              page === "account" ||
              page === "forms" ||
              page === "subcontractors"
            ? "business"
            : page in tabs
              ? page
              : "";

/** Signed in with a business: header with the business switcher, navigation, and the page. */
export function Shell(props: {
  api: Api;
  session: Session;
  businesses: Business[];
  current: Business;
  choose: (id: string) => void;
  reload: () => void;
  signOut: () => void;
}) {
  const { api, session, businesses, current, choose, reload, signOut } = props;
  const [route, setRoute] = useState<Route>(() => readHash());
  const assets = useMemo(() => makeAssets(api.client, current.id), [api, current.id]);
  const jobs = useMemo(
    () => jobsApi(api.client, current.id, session.user.id),
    [api, current.id, session.user.id],
  );
  const reports = useMemo(() => reportsApi(api.client, current.id), [api, current.id]);
  const invoices = useMemo(() => invoicesApi(api.client, current.id), [api, current.id]);
  const contracts = useMemo(() => contractsApi(api.client, current.id), [api, current.id]);
  const portal = useMemo(() => portalApi(api.client), [api]);
  const payments = useMemo(() => paymentsApi(api.client, current.id), [api, current.id]);
  const refrigerant = useMemo(() => refrigerantApi(api.client, current.id), [api, current.id]);
  const times = useMemo(() => timesApi(api.client, current.id), [api, current.id]);
  const sms = useMemo(() => smsApi(api.client, current.id), [api, current.id]);
  const diary = useMemo(() => diaryApi(api.client, current.id), [api, current.id]);
  const imports = useMemo(() => importApi(api.client, current.id), [api, current.id]);
  const forms = useMemo(() => formsApi(api.client, current.id), [api, current.id]);
  const subs = useMemo(() => subsApi(api.client, current.id), [api, current.id]);
  const owner = current.role === "owner";
  const sub = current.role === "sub";
  useEffect(() => {
    const onHash = () => {
      setRoute(readHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <Frame
      action={<ScanButton />}
      nav={
        <nav className="tabs" aria-label="Sections">
          {sub
            ? Object.entries(subTabs).map(([t, x]) => (
                <a
                  key={t}
                  href={`#/${t}`}
                  aria-current={
                    t === (["schedule", "account"].includes(route.page) ? route.page : "jobs")
                      ? "page"
                      : undefined
                  }
                >
                  <Icon name={x.icon} size={22} />
                  <span>{x.label}</span>
                </a>
              ))
            : Object.keys(tabs)
                .filter((t) => t !== "invoices" || owner)
                .map((t) => (
                  <a key={t} href={`#/${t}`} aria-current={t === tabOf(route.page) ? "page" : undefined}>
                    <Icon name={tabs[t]?.icon ?? "home"} size={22} />
                    <span>{tabs[t]?.label}</span>
                  </a>
                ))}
        </nav>
      }
    >
      <OutboxBar client={api.client} />
      <div className="page" key={current.id + route.page + route.arg}>
        {page(route)}
      </div>
    </Frame>
  );

  function page(r: Route) {
    if (sub && (!SUB_PAGES.includes(r.page) || (r.page === "job" && r.arg === "new")))
      return <JobsPage jobs={jobs} show={null} sub />;
    switch (r.page) {
      case "clients":
        return <ClientList assets={assets} owner={owner} />;
      case "client":
        return (
          <ClientPage assets={assets} id={r.arg}>
            {r.arg !== "new" && (
              <ContractsCard contracts={contracts} assets={assets} clientId={r.arg} owner={owner} />
            )}
            {owner && r.arg !== "new" && (
              <PortalCard portal={portal} assets={assets} clientId={r.arg} businessName={current.name} />
            )}
            {owner && r.arg !== "new" && <ClientBillingCard invoices={invoices} clientId={r.arg} />}
          </ClientPage>
        );
      case "system":
        return (
          <SystemPage
            assets={assets}
            id={r.arg}
            jobs={jobs}
            clientId={r.query.get("client")}
            sticker={r.query.get("sticker")}
            businessName={current.name}
            author={session.user.email ?? ""}
            owner={current.role === "owner"}
          />
        );
      case "u":
        return (
          <UnitPage
            assets={assets}
            code={r.arg}
            businessName={current.name}
            author={session.user.email ?? ""}
            owner={current.role === "owner"}
          />
        );
      case "jobs":
        return <JobsPage jobs={jobs} show={r.query.get("show")} owner={owner} sub={sub} />;
      case "import":
        return owner ? (
          <ImportPage imports={imports} />
        ) : (
          <section className="card">
            <h1>Owners only</h1>
            <p>Only the business's owners can import.</p>
          </section>
        );
      case "subcontractors":
        return owner ? (
          <SubcontractorsPage subs={subs} jobs={jobs} assets={assets} />
        ) : (
          <section className="card">
            <h1>Owners only</h1>
            <p>Only the business's owners can see subcontractors' charges.</p>
          </section>
        );
      case "forms":
        return owner ? (
          <FormsPage forms={forms} />
        ) : (
          <section className="card">
            <h1>Owners only</h1>
            <p>Only the business's owners can set up forms.</p>
          </section>
        );
      case "timesheets":
        return owner ? (
          <TimesheetsPage times={times} week={r.query.get("week")} />
        ) : (
          <section className="card">
            <h1>Owners only</h1>
            <p>Timesheets are only shown to the business's owners.</p>
          </section>
        );
      case "job":
        return (
          <JobPage
            assets={assets}
            jobs={jobs}
            id={r.arg}
            query={r.query}
            business={current}
            userId={session.user.id}
            reports={reports}
            times={times}
            sms={sms}
            forms={forms}
            subs={subs}
            invoices={owner ? invoices : null}
          />
        );
      case "invoices":
      case "invoice":
      case "pricing":
        if (!owner)
          return (
            <section className="card">
              <h1>Owners only</h1>
              <p>Prices and invoices are only shown to the business's owners.</p>
            </section>
          );
        return r.page === "invoices" ? (
          <InvoicesPage invoices={invoices} jobs={jobs} query={r.query} />
        ) : r.page === "invoice" ? (
          <InvoicePage invoices={invoices} id={r.arg} payments={payments} businessName={current.name} />
        ) : (
          <PricingPage invoices={invoices} jobs={jobs} assets={assets} query={r.query} payments={payments} />
        );
      case "reports":
        return <ReportsPage reports={reports} />;
      case "reminders":
        return <RemindersPage assets={assets} jobs={jobs} business={current} query={r.query} sms={sms} />;
      case "orders":
        return <OrdersPage assets={assets} jobs={jobs} query={r.query} />;
      case "refrigerant":
        return <RefrigerantPage refrigerant={refrigerant} owner={owner} />;
      case "register":
        return <RegisterPage assets={assets} jobs={jobs} business={current} />;
      case "schedule":
        return <SchedulePage jobs={jobs} business={current} query={r.query} diary={diary} />;
      case "materials":
        return <MaterialsPage jobs={jobs} business={current} />;
      case "account":
        return (
          <AccountPage api={api} email={session.user.email ?? ""} signOut={signOut}>
            {sub && (
              <MyPapers
                subs={subs}
                assets={assets}
                jobs={jobs}
                businesses={businesses}
                current={current.id}
                choose={choose}
              />
            )}
          </AccountPage>
        );
      case "team":
        return <Team api={api} jobs={jobs} business={current} userId={session.user.id} />;
      case "business":
        return (
          <BusinessSettings
            api={api}
            assets={assets}
            reports={reports}
            sms={sms}
            business={current}
            saved={reload}
          />
        );
      case "stickers":
      case "labels":
        return r.arg === "design" ? (
          <StickerDesigner assets={assets} business={current} />
        ) : (
          <StickersPage assets={assets} business={current} unread={r.query.has("unread")} />
        );
      default:
        return (
          <Home
            assets={assets}
            contracts={contracts}
            portal={portal}
            subs={owner ? subs : undefined}
            jobs={jobs}
            current={current}
            businesses={businesses}
            choose={choose}
            email={session.user.email ?? ""}
            signOut={signOut}
          />
        );
    }
  }
}

/** A subcontractor's account page: the businesses they work for, and their insurance and certificates. */
function MyPapers(p: {
  subs: SubsApi;
  assets: Assets;
  jobs: JobsApi;
  businesses: Business[];
  current: string;
  choose: (id: string) => void;
}) {
  const me = useLoad(() => p.jobs.me(), [p.jobs]);
  return (
    <>
      {p.businesses.length > 1 && (
        <section className="card form">
          <label>
            Working for
            <select value={p.current} onChange={(e) => p.choose(e.currentTarget.value)}>
              {p.businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
      {me.value && <SubPapersCard subs={p.subs} assets={p.assets} personId={me.value.id} />}
    </>
  );
}
