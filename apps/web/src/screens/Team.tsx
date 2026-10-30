import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Api, Business, Invite, Member } from "../api";
import { ErrorLine, useAction } from "../useAction";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function inviteLink(code: string, origin = window.location.origin) {
  return `${origin}/?invite=${encodeURIComponent(code)}`;
}

/** Who's in the business. Owners also invite people, remove them and make them owners. */
export function Team({ api, business, userId }: { api: Api; business: Business; userId: string }) {
  const owner = business.role === "owner";
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [newLink, setNewLink] = useState("");
  const { busy, error, run } = useAction();

  const load = useCallback(
    () =>
      run(async () => {
        setMembers(await api.team(business.id));
        setInvites(owner ? await api.invites(business.id) : []);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, business.id, owner],
  );
  useEffect(() => {
    void load();
  }, [load]);

  function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    void run(async () => {
      const code = await api.createInvite(business.id, email);
      setNewLink(inviteLink(code));
      form.reset();
      setInvites(await api.invites(business.id));
    });
  }

  return (
    <>
      <section className="card">
        <h1>Team</h1>
        <ErrorLine error={error} />
        <ul className="list">
          {members.map((m) => (
            <li key={m.userId}>
              <div>
                <b>{m.email || "Unknown email"}</b>
                {m.userId === userId && " (you)"}
                <div className="note">
                  {m.role === "owner" ? "Owner: sees prices and invoices" : "Engineer"}
                </div>
              </div>
              {owner && m.userId !== userId && (
                <div className="row">
                  {m.role !== "owner" && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`Make ${m.email} an owner? They'll see prices and invoices.`))
                          void run(async () => {
                            await api.makeOwner(business.id, m.userId);
                            setMembers(await api.team(business.id));
                          });
                      }}
                    >
                      Make owner
                    </button>
                  )}
                  <button
                    className="btn danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Remove ${m.email} from ${business.name}?`))
                        void run(async () => {
                          await api.removeMember(business.id, m.userId);
                          setMembers(await api.team(business.id));
                        });
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {owner && (
        <form className="card" onSubmit={invite}>
          <h1>Invite someone</h1>
          <p className="note">
            They join as an engineer, so they won't see prices. The link works once and lasts 14 days. Add
            their email to make sure only they can use it.
          </p>
          <label>
            Their email (optional)
            <input name="email" type="email" />
          </label>
          <button className="btn pri" type="submit" disabled={busy}>
            Create invite link
          </button>
          {newLink && (
            <div className="copy">
              <input
                readOnly
                value={newLink}
                aria-label="Invite link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="btn"
                onClick={() => void navigator.clipboard?.writeText(newLink)}
              >
                Copy
              </button>
            </div>
          )}
          {invites.length > 0 && (
            <>
              <h2>Waiting to be used</h2>
              <ul className="list">
                {invites.map((i) => (
                  <li key={i.code}>
                    <div>
                      <b>{i.email ?? "Anyone with the link"}</b>
                      <div className="note">
                        Sent {day(i.createdAt)}, runs out {day(i.expiresAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api.revokeInvite(i.code);
                          setInvites(await api.invites(business.id));
                        })
                      }
                    >
                      Cancel invite
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </form>
      )}
    </>
  );
}
