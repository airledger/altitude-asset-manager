import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import type { Api, Business } from "../api";
import { assets as makeAssets } from "../assets";
import { jobsApi } from "../jobs";
import { Icon, type IconName } from "../icons";
import { Frame } from "../ui";
import { ClientList, ClientPage, SystemPage, UnitPage } from "./Assets";
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
import { PortalCard } from "./PortalAdmin";
import { invoicesApi } from "../invoices";
import { reportsApi } from "../reports";
import { SchedulePage } from "./Schedule";
import { StickerDesigner } from "./StickerDesigner";
import { ScanButton, StickersPage } from "./Stickers";
import { Team } from "./Team";

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
  ["client", "system", "register"].includes(page)
    ? "clients"
    : ["job", "schedule", "orders", "reports", "refrigerant"].includes(page)
      ? "jobs"
      : page === "u" || page === "stickers"
        ? "labels"
        : page === "invoice" || page === "pricing"
          ? "invoices"
          : page === "team" || page === "materials" || page === "account"
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
  const refrigerant = useMemo(() => refrigerantApi(api.client, current.id), [api, current.id]);
  const owner = current.role === "owner";
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
          {Object.keys(tabs)
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
    switch (r.page) {
      case "clients":
        return <ClientList assets={assets} />;
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
          />
        );
      case "u":
        return (
          <UnitPage
            assets={assets}
            code={r.arg}
            businessName={current.name}
            author={session.user.email ?? ""}
          />
        );
      case "jobs":
        return <JobsPage jobs={jobs} show={r.query.get("show")} />;
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
          <InvoicePage invoices={invoices} id={r.arg} />
        ) : (
          <PricingPage invoices={invoices} jobs={jobs} assets={assets} query={r.query} />
        );
      case "reports":
        return <ReportsPage reports={reports} />;
      case "reminders":
        return <RemindersPage assets={assets} jobs={jobs} business={current} query={r.query} />;
      case "orders":
        return <OrdersPage assets={assets} jobs={jobs} query={r.query} />;
      case "refrigerant":
        return <RefrigerantPage refrigerant={refrigerant} owner={owner} />;
      case "register":
        return <RegisterPage assets={assets} jobs={jobs} business={current} />;
      case "schedule":
        return <SchedulePage jobs={jobs} business={current} query={r.query} />;
      case "materials":
        return <MaterialsPage jobs={jobs} business={current} />;
      case "account":
        return <AccountPage api={api} email={session.user.email ?? ""} signOut={signOut} />;
      case "team":
        return <Team api={api} jobs={jobs} business={current} userId={session.user.id} />;
      case "business":
        return (
          <BusinessSettings api={api} assets={assets} reports={reports} business={current} saved={reload} />
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
