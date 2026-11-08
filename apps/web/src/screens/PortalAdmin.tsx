// The business's side of the customer portal: inviting a client's contact (client page, owners), and the
// visit requests customers send (Home, everyone in the team).
import { formatDate } from "@airledger/domain";
import { useState, type FormEvent } from "react";
import type { Assets } from "../assets";
import { Icon } from "../icons";
import { appOrigin } from "../native";
import { jobTypeFor, type PortalApi } from "../portal";
import { ErrorLine, useAction } from "../useAction";
import { useLoad } from "./Assets";

export const portalLink = (code: string, origin = appOrigin()) => `${origin}/?portal=${code}`;

export function PortalCard(p: { portal: PortalApi; assets: Assets; clientId: string; businessName: string }) {
  const data = useLoad(() => p.portal.access(p.clientId), [p.portal, p.clientId]);
  const client = useLoad(() => p.assets.client(p.clientId), [p.assets, p.clientId]);
  const clientName = client.value?.name ?? "";
  const [sent, setSent] = useState<{ link: string; email: string } | null>(null);
  const act = useAction();
  const a = data.value;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    void act.run(async () => {
      const code = await p.portal.createInvite(p.clientId, email);
      setSent({ link: portalLink(code), email });
      data.reload();
    });
  }
  const message = sent
    ? `Hello,\n\n${p.businessName} now has an online portal for ${clientName}. You can see your air conditioning units, ` +
      `upcoming and past visits and your service reports, accept visit times and ask for a service or repair.\n\n` +
      `Set up your sign-in here:\n${sent.link}\n\nThanks,\n${p.businessName}`
    : "";

  return (
    <section className="card" aria-label="Customer portal">
      <h2>Customer portal</h2>
      <p className="note">
        The customer sees their sites, units, visits and service reports, accepts visit times and asks for
        visits. Never prices or your notes.
      </p>
      <ErrorLine error={data.error || act.error} />
      {a && a.users.length > 0 && (
        <ul className="rows">
          {a.users.map((u) => (
            <li key={u.user_id}>
              <div className="item">
                <span className="main">
                  <span className="t">{u.email}</span>
                  <span className="m">Since {formatDate(u.created_at.slice(0, 10))}</span>
                </span>
                <button
                  className="btn"
                  disabled={act.busy}
                  onClick={() => {
                    if (!window.confirm(`Remove ${u.email}'s access to the portal?`)) return;
                    void act.run(
                      async () => (await p.portal.removeAccess(p.clientId, u.user_id), data.reload()),
                    );
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {a && a.invites.length > 0 && !sent && (
        <p className="note">
          Waiting for {a.invites.map((i) => i.email || "someone").join(", ")} to open their link.
        </p>
      )}
      {sent ? (
        <div className="banner-card" aria-label="Portal invite ready">
          <div className="copy">
            <input
              readOnly
              value={sent.link}
              aria-label="Portal link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="btn"
              onClick={() => void navigator.clipboard?.writeText(sent.link)}
            >
              Copy
            </button>
          </div>
          <div className="row">
            <a
              className="btn pri"
              href={`mailto:${encodeURIComponent(sent.email)}?subject=${encodeURIComponent(`Your ${p.businessName} portal`)}&body=${encodeURIComponent(message)}`}
            >
              Email it
            </a>
            <button className="btn" onClick={() => setSent(null)}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="row" onSubmit={submit}>
          <label className="grow">
            Their email
            <input
              name="email"
              type="email"
              required
              defaultValue={client.value?.email ?? ""}
              key={client.value?.email ?? ""}
            />
          </label>
          <button className="btn pri" type="submit" disabled={act.busy}>
            Invite to portal
          </button>
        </form>
      )}
    </section>
  );
}

/** Visit requests from customers, waiting to be booked. */
export function RequestsCard(p: { portal: PortalApi; orgId: string }) {
  const data = useLoad(() => p.portal.openRequests(p.orgId), [p.portal, p.orgId]);
  const act = useAction();
  const list = data.value ?? [];
  if (!list.length && !data.error) return null;
  return (
    <section className="card" aria-label="Visit requests">
      <h2>Visit requests from customers</h2>
      <ErrorLine error={data.error || act.error} />
      <ul className="rows">
        {list.map((r) => {
          const notes = [r.message, r.preferred && `When suits them: ${r.preferred}`]
            .filter(Boolean)
            .join("\n");
          const book = r.system_id
            ? `#/job/new?system=${r.system_id}&type=${encodeURIComponent(jobTypeFor(r.kind))}&request=${r.id}&notes=${encodeURIComponent(notes)}`
            : `#/client/${r.client_id}`;
          return (
            <li key={r.id}>
              <div className="item">
                <span className="main">
                  <span className="t">
                    {r.clients?.name ?? ""} · {r.kind}
                  </span>
                  <span className="m">
                    {[
                      r.systems?.name,
                      r.message,
                      r.preferred && `suits: ${r.preferred}`,
                      `asked ${formatDate(r.created_at.slice(0, 10))}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </div>
              <div className="row">
                <a className="btn pri" href={book}>
                  <Icon name="calendar" size={18} />
                  Book it
                </a>
                <button
                  className="btn"
                  disabled={act.busy}
                  onClick={() => {
                    const reply = window.prompt("Why can't you book it? (the customer sees this)", "");
                    if (reply === null) return;
                    void act.run(async () => (await p.portal.decline(r.id, reply), data.reload()));
                  }}
                >
                  Decline
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Business page, owners: whether customers can book a free morning or afternoon themselves. */
export function PortalSettingsForm(p: { portal: PortalApi; orgId: string }) {
  const data = useLoad(() => p.portal.bookingSettings(p.orgId), [p.portal, p.orgId]);
  const [done, setDone] = useState(false);
  const act = useAction();
  if (!data.value) return <ErrorLine error={data.error} />;
  const v = data.value;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setDone(false);
    void act.run(async () => {
      await p.portal.saveBookingSettings(p.orgId, {
        self_booking: f.get("self_booking") === "on",
        slots: Math.min(20, Math.max(1, Number(f.get("slots")) || 2)),
      });
      setDone(true);
    });
  }
  return (
    <form className="card form" onSubmit={submit} aria-label="Customer portal booking">
      <h2>Customer portal</h2>
      <p className="note">
        Customers can always ask for a visit for you to book. Turn this on to let them pick a free morning or
        afternoon from your diary themselves; it's booked straight away with no engineer, for you to assign.
      </p>
      <ErrorLine error={act.error} />
      {done && <p className="ok">Saved.</p>}
      <label className="check">
        <input type="checkbox" name="self_booking" defaultChecked={v.self_booking} />
        Let customers book a free slot themselves
      </label>
      <label>
        Visits that fit in a morning or an afternoon
        <input type="number" name="slots" min={1} max={20} defaultValue={v.slots} />
      </label>
      <div className="row">
        <button className="btn pri" type="submit" disabled={act.busy}>
          Save
        </button>
      </div>
    </form>
  );
}
