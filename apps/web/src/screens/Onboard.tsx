import { useEffect, useState, type FormEvent } from "react";
import type { Api } from "../api";
import { keys, local } from "../local";
import { ErrorLine, useAction } from "../useAction";

type Info = { joins: boolean; businessName: string | null } | null;

/**
 * Signed in, with an invite waiting or no business yet: join the team the invite is for, or set up a business.
 * `joined` gets the business id once there is one.
 */
export function Onboard({
  api,
  hasBusiness,
  joined,
}: {
  api: Api;
  hasBusiness: boolean;
  joined: (id: string) => void;
}) {
  const [code, setCode] = useState(() => local.get(keys.invite));
  const [info, setInfo] = useState<Info | undefined>(code ? undefined : null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (code) void api.inviteInfo(code).then(setInfo, () => setInfo(null));
  }, [api, code]);

  function forget() {
    local.set(keys.invite, null);
    setCode(null);
    setInfo(null);
  }

  if (code && info === undefined) return <p className="note">Checking your invite…</p>;

  if (code && info?.joins)
    return (
      <section className="card">
        <h1>Join {info.businessName ?? "the business"}</h1>
        <p>You've been invited to join {info.businessName ?? "this business"} on Air Ledger.</p>
        <ErrorLine error={error} />
        <button
          className="btn pri"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const id = await api.joinBusiness(code);
              local.set(keys.invite, null);
              joined(id);
            })
          }
        >
          {busy ? "Joining…" : "Join"}
        </button>
        {hasBusiness && (
          <button className="btn" onClick={forget}>
            Not now
          </button>
        )}
      </section>
    );

  if (code && !info && !hasBusiness)
    return (
      <section className="card">
        <h1>That invite has run out</h1>
        <p>Invites last 14 days and work once. Ask whoever invited you to send a new one.</p>
        <button className="btn" onClick={forget}>
          I have a different code
        </button>
      </section>
    );

  if (!code && hasBusiness) return null;
  return <SetUpBusiness api={api} code={info && !info.joins ? code : null} joined={joined} done={forget} />;
}

function SetUpBusiness({
  api,
  code,
  joined,
  done,
}: {
  api: Api;
  code: string | null;
  joined: (id: string) => void;
  done: () => void;
}) {
  const { busy, error, run } = useAction();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const typed = String(form.get("code") ?? "").trim();
    void run(async () => {
      const id = await api.createBusiness(name, code ?? (typed || null));
      done();
      joined(id);
    });
  }
  return (
    <form className="card" onSubmit={submit}>
      <h1>Set up your business</h1>
      <p className="note">
        Joining someone else's team? Ask the owner to invite you from their Team page, and open the link they
        send.
      </p>
      <ErrorLine error={error} />
      <label>
        Business name
        <input name="name" required autoComplete="organization" />
      </label>
      {!code && (
        <label>
          Invite code
          <input name="code" autoCapitalize="characters" />
        </label>
      )}
      <button className="btn pri" type="submit" disabled={busy}>
        {busy ? "Setting up…" : "Set up business"}
      </button>
    </form>
  );
}
