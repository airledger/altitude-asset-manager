// Reminders (spec F8): installs whose service is due, overdue or needs chasing, with the client's
// details and a ready-made email and text. Logging a contact sets the due status ("Contacted", then
// "Chase" after the business's chase-after days).
import { formatDate } from "@airledger/domain";
import { useState } from "react";
import type { Business } from "../api";
import type { Assets } from "../assets";
import { Icon } from "../icons";
import type { JobsApi } from "../jobs";
import { enqueue, sendOrSave } from "../outbox";
import { loadOverview, reminderMessages, type Overview, type SiteView } from "../overview";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { go, todayIso, useLoad } from "./Assets";

const METHODS = ["Email", "Text message", "Phone call", "WhatsApp", "Voicemail"] as const;
const FILTERS = { action: "To contact", contacted: "Contacted", all: "Everything due" } as const;
type Filter = keyof typeof FILTERS;

export function RemindersPage(p: {
  assets: Assets;
  jobs: JobsApi;
  business: Business;
  query: URLSearchParams;
}) {
  const data = useLoad(() => loadOverview(p.assets, p.jobs, todayIso()), [p.assets, p.jobs]);
  const me = useLoad(() => p.jobs.me(), [p.jobs]);
  const filter: Filter =
    (p.query.get("show") as Filter) in FILTERS ? (p.query.get("show") as Filter) : "action";
  const open = p.query.get("open");
  const o = data.value;
  const due = (o?.sites ?? [])
    .filter((s) => ["due", "overdue", "chase", "contacted"].includes(s.status.key))
    .sort((a, b) => String(a.info.nextDue).localeCompare(String(b.info.nextDue)));
  const shown = due.filter((s) =>
    filter === "all" ? true : filter === "contacted" ? s.status.key === "contacted" : s.status.needsAction,
  );
  return (
    <>
      <PageHead
        back={{ href: "#/", label: "Home" }}
        title="Reminders"
        sub="Services due, and who to contact."
      />
      <section className="card">
        <div className="chips" role="group" aria-label="Show">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <button
              key={f}
              className="chip"
              aria-pressed={f === filter}
              onClick={() => go(f === "action" ? "#/reminders" : `#/reminders?show=${f}`)}
            >
              {FILTERS[f]}
              {o &&
                ` (${due.filter((s) => (f === "all" ? true : f === "contacted" ? s.status.key === "contacted" : s.status.needsAction)).length})`}
            </button>
          ))}
        </div>
        <ErrorLine error={data.error} />
        {!o ? (
          <Loading />
        ) : !shown.length ? (
          <Empty icon="check" title="Nobody to contact">
            Installs show here when their service is due within the reminder window.
          </Empty>
        ) : (
          <ul className="rows reminders">
            {shown.map((s) => (
              <li key={s.system.id}>
                <a
                  className="item"
                  href={
                    open === s.system.id
                      ? hrefFor(filter)
                      : `${hrefFor(filter)}${filter === "action" ? "?" : "&"}open=${s.system.id}`
                  }
                  aria-expanded={open === s.system.id}
                >
                  <span className="main">
                    <span className="t">{s.client?.name ?? s.system.name}</span>
                    <span className="m">
                      {[
                        s.system.name,
                        s.system.site_postcode,
                        s.client?.preferred_contact && `prefers ${s.client.preferred_contact.toLowerCase()}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className={`pill ${s.status.tone}`}>{s.status.label}</span>
                  <Icon name="chevron" size={18} />
                </a>
                {open === s.system.id && (
                  <Contact
                    site={s}
                    o={o}
                    business={p.business}
                    engineer={me.value?.name ?? ""}
                    assets={p.assets}
                    done={data.reload}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

const hrefFor = (f: Filter) => (f === "action" ? "#/reminders" : `#/reminders?show=${f}`);

function Contact(p: {
  site: SiteView;
  o: Overview;
  business: Business;
  engineer: string;
  assets: Assets;
  done: () => void;
}) {
  const c = p.site.client;
  const msg = reminderMessages(p.site, p.o.templates, p.business.name, p.engineer);
  const [email, setEmail] = useState(msg.email);
  const [sms, setSms] = useState(msg.sms);
  const [method, setMethod] = useState<string>(
    METHODS.find((m) => m === c?.preferred_contact) ??
      (c?.preferred_contact === "Phone" ? "Phone call" : "Email"),
  );
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction();
  const tel = (c?.phone ?? "").replace(/\s/g, "");
  const copy = (t: string) => void navigator.clipboard?.writeText(t);
  const log = (thenBook: boolean) =>
    void run(async () => {
      const row = { system_id: p.site.system.id, date: todayIso(), method, note: note.trim() };
      await sendOrSave(
        () => p.assets.logContact(row),
        () =>
          enqueue({
            kind: "contact",
            orgId: p.business.id,
            label: p.site.client?.name ?? p.site.system.name,
            row,
          }),
      );
      if (thenBook) go(`#/job/new?system=${p.site.system.id}`);
      else p.done();
    });

  return (
    <div className="contact">
      {c?.reminders_opt_in === false && (
        <p className="banner">This client has asked not to get service reminders.</p>
      )}
      <p className="note">
        {[c?.contact_name, c?.email || "no email", c?.phone || "no phone"].filter(Boolean).join(" · ")}
        {p.site.info.nextDue && ` · service due ${formatDate(p.site.info.nextDue)}`}
      </p>
      <label>
        Email: {msg.subject}
        <textarea rows={8} value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
      </label>
      <div className="row">
        <button type="button" className="btn" onClick={() => copy(`Subject: ${msg.subject}\n\n${email}`)}>
          Copy email
        </button>
        {c?.email && (
          <a
            className="btn"
            href={`mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(email)}`}
          >
            Open in Mail
          </a>
        )}
      </div>
      <label>
        Text message
        <textarea rows={3} value={sms} onChange={(e) => setSms(e.currentTarget.value)} />
      </label>
      <div className="row">
        <button type="button" className="btn" onClick={() => copy(sms)}>
          Copy text
        </button>
        {tel && (
          <>
            <a className="btn" href={`sms:${tel}?&body=${encodeURIComponent(sms)}`}>
              Open Messages
            </a>
            <a className="btn" href={`tel:${tel}`}>
              Call {c?.phone}
            </a>
          </>
        )}
      </div>
      <h3>Log it</h3>
      <ErrorLine error={error} />
      <div className="grid2">
        <label>
          Contacted by
          <select value={method} onChange={(e) => setMethod(e.currentTarget.value)}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        </label>
      </div>
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => log(false)}>
          Mark as contacted
        </button>
        <button type="button" className="btn pri" disabled={busy} onClick={() => log(true)}>
          Booked: add the job
        </button>
      </div>
      {p.site.contacts.length > 0 && (
        <>
          <h3>Contact history</h3>
          <ContactHistory site={p.site} />
        </>
      )}
    </div>
  );
}

export function ContactHistory({ site }: { site: SiteView }) {
  return (
    <ul className="list history">
      {[...site.contacts].reverse().map((c) => (
        <li key={c.id}>
          <div>
            <b>{formatDate(c.date)}</b> · {c.method}
            {c.note && <div className="note">{c.note}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
