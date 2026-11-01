import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import type { Api, Business } from "../api";
import { assets as makeAssets } from "../assets";
import {
  BlankStickers,
  ClientList,
  OrderStickers,
  ClientPage,
  ScanBox,
  SystemPage,
  UnitPage,
} from "./Assets";
import { BusinessSettings } from "./BusinessSettings";
import { Team } from "./Team";

const tabs = { "": "Home", clients: "Clients", team: "Team", business: "Business" } as const;
type Tab = keyof typeof tabs;

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
  ["client", "system", "u"].includes(page) ? "clients" : page in tabs ? (page as Tab) : "";

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
  useEffect(() => {
    const onHash = () => {
      setRoute(readHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <>
      <div className="bizbar">
        {current.logoUrl && <img src={current.logoUrl} alt="" />}
        {businesses.length > 1 ? (
          <select aria-label="Business" value={current.id} onChange={(e) => choose(e.currentTarget.value)}>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : (
          <b>{current.name}</b>
        )}
        <span className="note">{current.role === "owner" ? "Owner" : "Engineer"}</span>
      </div>
      <nav className="tabs">
        {(Object.keys(tabs) as Tab[]).map((t) => (
          <a key={t} href={`#/${t}`} aria-current={t === tabOf(route.page) ? "page" : undefined}>
            {tabs[t]}
          </a>
        ))}
      </nav>
      <div className="page" key={current.id + route.page + route.arg}>
        {page(route)}
      </div>
    </>
  );

  function page(r: Route) {
    switch (r.page) {
      case "clients":
        return <ClientList assets={assets} />;
      case "client":
        return <ClientPage assets={assets} id={r.arg} />;
      case "system":
        return (
          <SystemPage
            assets={assets}
            id={r.arg}
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
      case "team":
        return <Team api={api} business={current} userId={session.user.id} />;
      case "business":
        return <BusinessSettings api={api} business={current} saved={reload} />;
      default:
        return (
          <>
            <ScanBox />
            {current.role === "owner" && <OrderStickers assets={assets} />}
            <BlankStickers assets={assets} businessName={current.name} />
            <Home email={session.user.email ?? ""} signOut={signOut} />
          </>
        );
    }
  }
}

function Home({ email, signOut }: { email: string; signOut: () => void }) {
  return (
    <section className="card">
      <h1>Welcome</h1>
      <p>
        Signed in as <b>{email}</b>. Clients, installs and units are under Clients. Jobs, reminders and the
        dashboard arrive in the next stage.
      </p>
      <button className="btn" onClick={signOut}>
        Sign out
      </button>
    </section>
  );
}
