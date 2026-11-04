import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState, type FormEvent } from "react";
import { api, type InviteInfo } from "../api";
import { keys, local } from "../local";
import { ErrorLine, useAction } from "../useAction";
import { appOrigin } from "../native";

type Mode = "signin" | "signup" | "forgot";

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/** Signed-out screens: sign in, sign up with an invite, and forgotten password. */
export function SignedOut({ client }: { client: SupabaseClient }) {
  const [invite] = useState(() => local.get(keys.invite));
  const [mode, setMode] = useState<Mode>(invite ? "signup" : "signin");
  // undefined while checking, null when the invite has run out.
  const [info, setInfo] = useState<InviteInfo | null | undefined>(undefined);
  useEffect(() => {
    if (invite)
      void api(client)
        .inviteInfo(invite)
        .then(setInfo, () => setInfo(undefined));
  }, [client, invite]);
  return (
    <>
      <Brand client={client} />
      {invite && <InviteNote info={info} />}
      {mode === "signin" && <SignIn client={client} setMode={setMode} canSignUp={!!invite} />}
      {mode === "signup" && (
        <SignUp client={client} setMode={setMode} email={info?.email ?? ""} key={info?.email ?? ""} />
      )}
      {mode === "forgot" && <Forgot client={client} setMode={setMode} />}
    </>
  );
}

/** A business's name and logo when someone arrives from its sign-in link (?b=slug). */
function Brand({ client }: { client: SupabaseClient }) {
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null } | null>(null);
  useEffect(() => {
    const slug = local.get(keys.brand);
    if (slug)
      void api(client)
        .brand(slug)
        .then(setBrand, () => setBrand(null));
  }, [client]);
  if (!brand) return null;
  return (
    <div className="brand">
      {brand.logoUrl && <img src={brand.logoUrl} alt="" />}
      <b>{brand.name}</b>
    </div>
  );
}

function InviteNote({ info }: { info: InviteInfo | null | undefined }) {
  if (info === undefined) return null;
  const hi = info?.name ? `Hi ${info.name.split(" ")[0]}. ` : "";
  const text = !info
    ? "This invite has expired or has already been used. Ask for a new one."
    : info.joins
      ? `${hi}You've been invited to join ${info.businessName ?? "a business"} on Air Ledger.` +
        (info.email ? " Choose a password to get started." : "")
      : "You've been invited to set up your business on Air Ledger.";
  return <p className="banner">{text}</p>;
}

function SignIn({
  client,
  setMode,
  canSignUp,
}: {
  client: SupabaseClient;
  setMode: (m: Mode) => void;
  canSignUp: boolean;
}) {
  const { busy, error, run } = useAction();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void run(async () => {
      const { error: err } = await client.auth.signInWithPassword({
        email: field(form, "email"),
        password: String(form.get("password") ?? ""),
      });
      if (err) throw err;
    });
  }
  return (
    <form className="card" onSubmit={submit}>
      <h1>Sign in</h1>
      <ErrorLine error={error} />
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
      <div className="row">
        <button type="button" className="link" onClick={() => setMode("forgot")}>
          Forgotten your password?
        </button>
        {canSignUp && (
          <button type="button" className="link" onClick={() => setMode("signup")}>
            New here? Create an account
          </button>
        )}
      </div>
    </form>
  );
}

function SignUp({
  client,
  setMode,
  email: invited,
}: {
  client: SupabaseClient;
  setMode: (m: Mode) => void;
  /** The email the invite was sent to, filled in and fixed. */
  email: string;
}) {
  const { busy, error, setError, run } = useAction();
  const [sentTo, setSentTo] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    void run(async () => {
      const email = field(form, "email");
      const { data, error: err } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: appOrigin() },
      });
      if (err) throw err;
      // With email confirmation on there's no session yet: they confirm, then sign in, and the invite is still waiting.
      if (!data.session) setSentTo(email);
    });
  }
  if (sentTo)
    return (
      <section className="card">
        <h1>Check your email</h1>
        <p>
          We've sent a link to <b>{sentTo}</b>. Open it on this device to finish signing up.
        </p>
      </section>
    );
  return (
    <form className="card" onSubmit={submit}>
      <h1>Create your account</h1>
      <ErrorLine error={error} />
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={invited}
          readOnly={!!invited}
        />
      </label>
      <label>
        Password (at least 8 characters)
        <input name="password" type="password" autoComplete="new-password" required />
      </label>
      <button className="btn pri" type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create account"}
      </button>
      <button type="button" className="link" onClick={() => setMode("signin")}>
        Already have an account? Sign in
      </button>
    </form>
  );
}

function Forgot({ client, setMode }: { client: SupabaseClient; setMode: (m: Mode) => void }) {
  const { busy, error, run } = useAction();
  const [sent, setSent] = useState(false);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = field(new FormData(e.currentTarget), "email");
    void run(async () => {
      const { error: err } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: appOrigin(),
      });
      if (err) throw err;
      setSent(true);
    });
  }
  return (
    <form className="card" onSubmit={submit}>
      <h1>Reset your password</h1>
      <ErrorLine error={error} />
      {sent ? (
        <p>If that email has an account, we've sent it a link to choose a new password.</p>
      ) : (
        <>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <button className="btn pri" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </>
      )}
      <button type="button" className="link" onClick={() => setMode("signin")}>
        Back to sign in
      </button>
    </form>
  );
}

/** Shown after someone opens a password-reset link. */
export function SetNewPassword({ client, done }: { client: SupabaseClient; done: () => void }) {
  const { busy, error, setError, run } = useAction();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    void run(async () => {
      const { error: err } = await client.auth.updateUser({ password });
      if (err) throw err;
      done();
    });
  }
  return (
    <form className="card" onSubmit={submit}>
      <h1>Choose a new password</h1>
      <ErrorLine error={error} />
      <label>
        New password (at least 8 characters)
        <input name="password" type="password" autoComplete="new-password" required />
      </label>
      <button className="btn pri" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
