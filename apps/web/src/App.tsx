import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "./supabase";

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

  useEffect(() => {
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [client]);

  if (session === undefined) return <p className="note">Loading…</p>;
  if (!session) return <SignIn client={client} />;
  return (
    <section className="card">
      <h1>You're signed in</h1>
      <p>
        Signed in as <b>{session.user.email}</b>. The rest of the app arrives stage by stage; each one will
        show up here for you to try.
      </p>
      <button className="btn" onClick={() => void client.auth.signOut()}>
        Sign out
      </button>
    </section>
  );
}

function SignIn({ client }: { client: SupabaseClient }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const { error: err } = await client.auth.signInWithPassword({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    setBusy(false);
    if (err) setError(err.message);
  }

  return (
    <form className="card" onSubmit={(e) => void submit(e)}>
      <h1>Sign in</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button className="btn pri" type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
