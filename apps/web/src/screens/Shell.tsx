import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { Api, Business } from "../api";
import { BusinessSettings } from "./BusinessSettings";
import { Team } from "./Team";

const pages = { "": "Home", team: "Team", business: "Business" } as const;
type Page = keyof typeof pages;

function readHash(): Page {
  const p = window.location.hash.replace(/^#\/?/, "");
  return p in pages ? (p as Page) : "";
}

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
  const [page, setPage] = useState<Page>(readHash);
  useEffect(() => {
    const onHash = () => setPage(readHash());
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
        {(Object.keys(pages) as Page[]).map((p) => (
          <a key={p} href={`#/${p}`} aria-current={p === page ? "page" : undefined}>
            {pages[p]}
          </a>
        ))}
      </nav>
      {page === "" && <Home email={session.user.email ?? ""} signOut={signOut} />}
      {page === "team" && <Team api={api} business={current} userId={session.user.id} />}
      {page === "business" && (
        <BusinessSettings key={current.id} api={api} business={current} saved={reload} />
      )}
    </>
  );
}

function Home({ email, signOut }: { email: string; signOut: () => void }) {
  return (
    <section className="card">
      <h1>Welcome</h1>
      <p>
        Signed in as <b>{email}</b>. Clients, installs, units and jobs arrive in the next stage. For now you
        can try the Team and Business pages.
      </p>
      <button className="btn" onClick={signOut}>
        Sign out
      </button>
    </section>
  );
}
