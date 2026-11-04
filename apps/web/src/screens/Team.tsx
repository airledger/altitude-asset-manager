import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Api, Business, Invite, Member } from "../api";
import { Text, readForm } from "../fields";
import type { JobsApi, PersonRow } from "../jobs";
import { PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { appOrigin } from "../native";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function inviteLink(code: string, origin = appOrigin()) {
  return `${origin}/?invite=${encodeURIComponent(code)}`;
}

/** The message that goes with an invite, for email or text. */
export function inviteMessage(name: string, business: string, link: string) {
  const first = name.split(" ")[0] || "there";
  return `Hi ${first},\n\nYou've been added to ${business} on Air Ledger, where you'll see the jobs booked for you. Your details are already filled in: open this link and choose a password.\n\n${link}\n\nThe link works once and lasts 14 days.`;
}

/**
 * The team. Owners add engineers (before they have an account), send them an invite with their details
 * filled in, edit anyone's details, make someone an owner and remove people. Everyone can edit their own
 * phone number and F-gas certificate.
 */
export function Team({
  api,
  jobs,
  business,
  userId,
}: {
  api: Api;
  jobs: JobsApi;
  business: Business;
  userId: string;
}) {
  const owner = business.role === "owner";
  const [members, setMembers] = useState<Member[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [sent, setSent] = useState<{ person: PersonRow; link: string } | null>(null);
  const { busy, error, run } = useAction();

  const refresh = useCallback(async () => {
    const [m, p, i] = await Promise.all([
      api.team(business.id),
      jobs.people(),
      owner ? api.invites(business.id) : Promise.resolve([]),
    ]);
    setMembers(m);
    setPeople(p);
    setInvites(i);
  }, [api, jobs, business.id, owner]);
  useEffect(() => {
    void run(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const memberOf = (p: PersonRow) => members.find((m) => m.userId === p.user_id);
  const inviteFor = (p: PersonRow) => invites.find((i) => i.email && i.email === p.email.toLowerCase());
  const active = people.filter((p) => p.active);
  const past = people.filter((p) => !p.active);

  function sendInvite(p: PersonRow) {
    void run(async () => {
      const code = await jobs.invitePerson(p.id);
      setSent({ person: p, link: inviteLink(code) });
      await refresh();
    });
  }

  function save(e: FormEvent<HTMLFormElement>, p: PersonRow | null) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = readForm(form);
    const invite = !p && f.bool("invite");
    void run(async () => {
      const row = {
        name: f.text("name"),
        email: f.text("email").toLowerCase(),
        phone: f.text("phone"),
        fgas_cert: f.text("fgas_cert"),
        active: true,
      };
      const id = await jobs.savePerson({ ...row, id: p?.id });
      setEditing(null);
      form.reset();
      if (invite && row.email) {
        const code = await jobs.invitePerson(id);
        setSent({ person: { ...row, id, user_id: null }, link: inviteLink(code) });
      }
      await refresh();
    });
  }

  return (
    <>
      <PageHead
        back={{ href: "#/business", label: "Business" }}
        title="Team"
        sub={`Everyone who works for ${business.name}`}
      />
      <ErrorLine error={error} />
      {sent && <InviteSent person={sent.person} link={sent.link} business={business.name} />}
      <section className="card">
        <ul className="list team">
          {active.map((p) => {
            const m = memberOf(p);
            const mine = p.user_id === userId;
            const pending = !p.user_id && inviteFor(p);
            if (editing === p.id)
              return (
                <li key={p.id}>
                  <PersonForm
                    person={p}
                    busy={busy}
                    owner={owner}
                    save={save}
                    cancel={() => setEditing(null)}
                  />
                </li>
              );
            return (
              <li key={p.id}>
                <div>
                  <b>{p.name || p.email || "No name"}</b>
                  {mine && " (you)"}
                  <div className="note">
                    {m?.role === "owner" ? "Owner: sees prices and invoices" : "Engineer"}
                    {!p.user_id &&
                      (pending
                        ? ` · invited ${day(pending.createdAt)}, not joined yet`
                        : " · not invited yet")}
                  </div>
                  <div className="note">
                    {[p.phone, p.email, p.fgas_cert && `F-gas ${p.fgas_cert}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="row">
                  {(owner || mine) && (
                    <button className="btn" disabled={busy} onClick={() => setEditing(p.id)}>
                      Edit
                    </button>
                  )}
                  {owner && !p.user_id && (
                    <button className="btn" disabled={busy || !p.email} onClick={() => sendInvite(p)}>
                      {pending ? "Invite again" : "Send invite"}
                    </button>
                  )}
                  {owner && m && m.role !== "owner" && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`Make ${p.name || m.email} an owner? They'll see prices and invoices.`))
                          void run(async () => {
                            await api.makeOwner(business.id, m.userId);
                            await refresh();
                          });
                      }}
                    >
                      Make owner
                    </button>
                  )}
                  {owner && !mine && (
                    <button
                      className="btn danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            `Remove ${p.name || p.email} from ${business.name}? Jobs they did keep their name.`,
                          )
                        )
                          void run(async () => {
                            if (m) await api.removeMember(business.id, m.userId);
                            else await jobs.savePerson({ ...p, active: false });
                            const inv = inviteFor(p);
                            if (inv) await api.revokeInvite(inv.code);
                            await refresh();
                          });
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {owner && (
        <section className="card">
          <h2>Add an engineer</h2>
          <p className="note">
            Add their details and Air Ledger makes an invite link with everything filled in. They only choose
            a password. You can book jobs for them straight away, before they've joined.
          </p>
          <PersonForm person={null} busy={busy} owner save={save} />
        </section>
      )}

      {owner && past.length > 0 && (
        <section className="card">
          <h2>Past engineers</h2>
          <ul className="list">
            {past.map((p) => (
              <li key={p.id}>
                <div>
                  <b>{p.name || p.email}</b>
                  <div className="note">{p.email}</div>
                </div>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await jobs.savePerson({ ...p, active: true });
                      await refresh();
                    })
                  }
                >
                  Add back
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function PersonForm(p: {
  person: PersonRow | null;
  busy: boolean;
  owner: boolean;
  save: (e: FormEvent<HTMLFormElement>, p: PersonRow | null) => void;
  cancel?: () => void;
}) {
  const x = p.person;
  return (
    <form
      className="form"
      onSubmit={(e) => p.save(e, x)}
      aria-label={x ? `Edit ${x.name}` : "Add an engineer"}
    >
      <div className="grid2">
        <Text name="name" label="Name" value={x?.name} required />
        {p.owner ? (
          <Text name="email" label="Email" type="email" value={x?.email} required={!x} />
        ) : (
          <input type="hidden" name="email" value={x?.email ?? ""} />
        )}
        <Text name="phone" label="Mobile" type="tel" value={x?.phone} />
        <Text name="fgas_cert" label="F-gas certificate number" value={x?.fgas_cert} />
      </div>
      {!x && (
        <label className="check">
          <input name="invite" type="checkbox" defaultChecked />
          Make an invite link for them
        </label>
      )}
      <div className="row">
        <button className="btn pri" type="submit" disabled={p.busy}>
          {x ? "Save" : "Add engineer"}
        </button>
        {p.cancel && (
          <button className="btn" type="button" onClick={p.cancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** The invite, ready to send by email, text or copy. */
function InviteSent({ person, link, business }: { person: PersonRow; link: string; business: string }) {
  const message = inviteMessage(person.name, business, link);
  const subject = `Join ${business} on Air Ledger`;
  return (
    <section className="card banner-card" aria-label="Invite ready">
      <h2>Invite ready for {person.name || person.email}</h2>
      <p className="note">
        Send it from your own email or phone so they know it's from you. Their name and email are filled in
        when they open it.
      </p>
      <div className="copy">
        <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(link)}>
          Copy
        </button>
      </div>
      <div className="row">
        <a
          className="btn pri"
          href={`mailto:${encodeURIComponent(person.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}
        >
          Email it
        </a>
        {person.phone && (
          <a
            className="btn"
            href={`sms:${person.phone.replace(/\s/g, "")}?&body=${encodeURIComponent(message)}`}
          >
            Text it
          </a>
        )}
        {typeof navigator.share === "function" && (
          <button
            type="button"
            className="btn"
            onClick={() => void navigator.share({ title: subject, text: message }).catch(() => undefined)}
          >
            Share…
          </button>
        )}
      </div>
    </section>
  );
}
