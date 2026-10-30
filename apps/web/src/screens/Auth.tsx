import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { keys, local } from "../local";
import { ErrorLine, useAction } from "../useAction";

type Mode = "signin" | "signup" | "forgot";

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/** Signed-out screens: sign in, sign up with an invite, and forgotten password. */
export function SignedOut({ client }: { client: SupabaseClient }) {
  const [invite] = useState(() => local.get(keys.invite));
  const [mode, setMode] = useState<Mode>(invite ? "signup" : "signin");
  return (
    <>
      <Brand client={client} />
      {invite && <InviteNote client={client} code={invite} />}
      {mode === "signin" && <SignIn client={client} setMode={setMode} canSignUp={!!invite} />}
      {mode === "signup" && <SignUp client={client} setMode={setMode} />}
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

function InviteNote({ client, code }: { client: SupabaseClient; code: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    void api(client)
      .inviteInfo(code)
      .then(
        (info) =>
          setText(
            !info
              ? "This invite has expired or has already been used. Ask for a new one."
              : info.joins
                ? `You've been invited to join ${info.businessName ?? "a business"} on Air Ledger.`
                : "You've been invited to set up your business on Air Ledger.",
          ),
        () => setText(""),
      );
  }, [client, code]);
  return text ? <p className="banner">{text}</p> : null;
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

function SignUp({ client, setMode }: { client: SupabaseClient; setMode: (m: Mode) => void }) {
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
        options: { emailRedirectTo: window.location.origin },
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
        <input name="email" type="email" autoComplete="username" required />
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
        redirectTo: window.location.origin,
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
