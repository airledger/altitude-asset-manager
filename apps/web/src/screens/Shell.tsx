import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import type { Api, Business } from "../api";
import { assets as makeAssets } from "../assets";
import { Icon, type IconName } from "../icons";
import { Frame } from "../ui";
import { ClientList, ClientPage, SystemPage, UnitPage } from "./Assets";
import { BusinessSettings } from "./BusinessSettings";
import { Home } from "./Home";
import { ScanButton, StickersPage } from "./Stickers";
import { Team } from "./Team";

const tabs: Record<string, { label: string; icon: IconName }> = {
  "": { label: "Home", icon: "home" },
  clients: { label: "Clients", icon: "clients" },
  stickers: { label: "Stickers", icon: "sticker" },
  team: { label: "Team", icon: "team" },
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
  ["client", "system"].includes(page) ? "clients" : page === "u" ? "stickers" : page in tabs ? page : "";

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
    <Frame
      action={<ScanButton />}
      nav={
        <nav className="tabs" aria-label="Sections">
          {Object.keys(tabs).map((t) => (
            <a key={t} href={`#/${t}`} aria-current={t === tabOf(route.page) ? "page" : undefined}>
              <Icon name={tabs[t]?.icon ?? "home"} size={22} />
              <span>{tabs[t]?.label}</span>
            </a>
          ))}
        </nav>
      }
    >
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
      case "stickers":
        return (
          <StickersPage
            assets={assets}
            businessName={current.name}
            owner={current.role === "owner"}
            unread={r.query.has("unread")}
          />
        );
      default:
        return (
          <Home
            assets={assets}
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
