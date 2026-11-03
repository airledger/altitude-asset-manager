import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api as makeApi, type Business } from "./api";
import { keys, local } from "./local";
import { SetNewPassword, SignedOut } from "./screens/Auth";
import { Onboard } from "./screens/Onboard";
import { Shell } from "./screens/Shell";
import { clearSavedCopies, isNetworkError } from "./offline";
import { supabase } from "./supabase";
import { Frame, Loading } from "./ui";
import { ErrorLine } from "./useAction";

export function App({ client = supabase }: { client?: SupabaseClient | null }) {
  return client ? (
    <Account client={client} />
  ) : (
    <Frame narrow>
      <NotConnected />
    </Frame>
  );
}

/** The sign-in Supabase keeps on the device, even if it has expired. */
function savedSession(): Session | null {
  try {
    const key = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k));
    const s = key ? (JSON.parse(localStorage.getItem(key) ?? "null") as Session | null) : null;
    return s?.user ? s : null;
  } catch {
    return null;
  }
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
    void client.auth.getSession().then(({ data, error }) =>
      // With no signal an expired sign-in can't be renewed. Carry on with the one saved on the device:
      // reads come from saved copies and changes wait in the outbox until it's renewed.
      setSession(data.session ?? (error && isNetworkError(error) ? savedSession() : null)),
    );
    const { data } = client.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setResetting(true);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  if (session === undefined)
    return (
      <Frame narrow>
        <Loading />
      </Frame>
    );
  if (!session)
    return (
      <Frame narrow>
        <SignedOut client={client} />
      </Frame>
    );
  if (resetting)
    return (
      <Frame narrow>
        <SetNewPassword client={client} done={() => setResetting(false)} />
      </Frame>
    );
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
      <Frame narrow>
        <section className="card">
          <ErrorLine error={error} />
        </section>
      </Frame>
    );
  if (!businesses)
    return (
      <Frame narrow>
        <Loading />
      </Frame>
    );

  const current = businesses.find((b) => b.id === currentId) ?? businesses.at(0);
  if (pendingInvite || !current)
    return (
      <Frame narrow>
        <Onboard
          api={api}
          hasBusiness={businesses.length > 0}
          email={session.user.email ?? ""}
          signOut={() => void clearSavedCopies().then(() => client.auth.signOut())}
          joined={(id) => {
            setPendingInvite(false);
            choose(id);
            void load();
          }}
        />
      </Frame>
    );

  return (
    <Shell
      api={api}
      session={session}
      businesses={businesses}
      current={current}
      choose={choose}
      reload={() => void load()}
      signOut={() => void clearSavedCopies().then(() => client.auth.signOut())}
    />
  );
}
