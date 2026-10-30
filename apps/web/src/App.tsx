import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api as makeApi, type Business } from "./api";
import { keys, local } from "./local";
import { SetNewPassword, SignedOut } from "./screens/Auth";
import { Onboard } from "./screens/Onboard";
import { Shell } from "./screens/Shell";
import { supabase } from "./supabase";
import { ErrorLine } from "./useAction";

export function App({ client = supabase }: { client?: SupabaseClient | null }) {
  return (
    <>
      <header className="top">
        <img src="/logo-reverse.svg" alt="Air Ledger" className="logo" />
        <span className="badge">Beta</span>
      </header>
      <main>
        <p className="banner">
          This is the test version of the new Air Ledger. Nothing here changes the live app at
          app.airledger.co.uk.
        </p>
        {client ? <Account client={client} /> : <NotConnected />}
      </main>
    </>
  );
}

function NotConnected() {
  return (
    <section className="card">
      <h1>Not connected</h1>
      <p>This build hasn't been given a database yet (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).</p>
    </section>
  );
}

function Account({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setResetting(true);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  if (session === undefined) return <p className="note">Loading…</p>;
  if (!session) return <SignedOut client={client} />;
  if (resetting) return <SetNewPassword client={client} done={() => setResetting(false)} />;
  return <SignedIn client={client} session={session} />;
}

function SignedIn({ client, session }: { client: SupabaseClient; session: Session }) {
  const api = useMemo(() => makeApi(client), [client]);
  const [businesses, setBusinesses] = useState<Business[] | undefined>(undefined);
  const [currentId, setCurrentId] = useState(() => local.get(keys.business));
  const [pendingInvite, setPendingInvite] = useState(() => !!local.get(keys.invite));
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      api.myBusinesses(session.user.id).then(
        (list) => setBusinesses(list),
        (e: Error) => setError(e.message),
      ),
    [api, session.user.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  function choose(id: string) {
    local.set(keys.business, id);
    setCurrentId(id);
  }

  if (error)
    return (
      <section className="card">
        <ErrorLine error={error} />
      </section>
    );
  if (!businesses) return <p className="note">Loading…</p>;

  const current = businesses.find((b) => b.id === currentId) ?? businesses.at(0);
  if (pendingInvite || !current)
    return (
      <Onboard
        api={api}
        hasBusiness={businesses.length > 0}
        joined={(id) => {
          setPendingInvite(false);
          choose(id);
          void load();
        }}
      />
    );

  return (
    <Shell
      api={api}
      session={session}
      businesses={businesses}
      current={current}
      choose={choose}
      reload={() => void load()}
      signOut={() => void client.auth.signOut()}
    />
  );
}
