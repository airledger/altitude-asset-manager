// The customer portal: what a business's customer sees when they sign in. Their sites and units, visits to
// come (accept, or ask for another time), past visits and service reports, contracts, and asking for a visit
// (also straight from scanning a unit's label, which opens #/u/AC-XXXXX here).
import { formatDate } from "@airledger/domain";
import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "../icons";
import {
  slotLabel,
  type MyPortal,
  type PortalApi,
  type PortalOverview,
  type PortalVisit,
  type Slot,
} from "../portal";
import { Empty, Frame, Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { useLoad } from "./Assets";

const when = (v: { date: string | null; time: string | null }) =>
  v.date
    ? new Date(v.date + "T12:00:00Z").toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }) + (v.time ? `, ${v.time.slice(0, 5)}` : "")
    : "Date to be arranged";

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function Portal(p: { api: PortalApi; portals: MyPortal[]; email: string; signOut: () => void }) {
  const [clientId, setClientId] = useState(p.portals[0]?.client_id ?? "");
  const current = p.portals.find((x) => x.client_id === clientId) ?? p.portals[0];
  return (
    <Frame narrow>
      {current ? (
        <PortalHome key={current.client_id} api={p.api} portal={current} />
      ) : (
        <Empty icon="clients" title="No portal yet">
          Ask the business that looks after your air conditioning for a portal link.
        </Empty>
      )}
      <p className="signed">
        {p.portals.length > 1 && (
          <>
            <select
              className="bizpick"
              aria-label="Portal"
              value={current?.client_id}
              onChange={(e) => setClientId(e.currentTarget.value)}
            >
              {p.portals.map((x) => (
                <option key={x.client_id} value={x.client_id}>
                  {x.client_name} ({x.org_name})
                </option>
              ))}
            </select>{" "}
            ·{" "}
          </>
        )}
        Signed in as <b>{p.email}</b> ·{" "}
        <button className="link" onClick={p.signOut}>
          Sign out
        </button>
      </p>
    </Frame>
  );
}

function PortalHome({ api, portal }: { api: PortalApi; portal: MyPortal }) {
  const data = useLoad(() => api.overview(portal.client_id), [api, portal.client_id]);
  const hash = useHash();
  const o = data.value;
  if (data.error) return <ErrorLine error={data.error} />;
  if (!o) return <Loading />;
  const upcoming = o.visits
    .filter((v) => v.status === "booked")
    .sort((a, b) => `${a.date ?? "9"}${a.time ?? ""}`.localeCompare(`${b.date ?? "9"}${b.time ?? ""}`));
  const past = o.visits.filter((v) => v.status === "completed");
  const focus = /^#\/visit\/([0-9a-f-]{36})/.exec(hash)?.[1] ?? null;
  const scanned = /^#\/u\/(AC-[A-Z0-9]{5})/i.exec(hash)?.[1]?.toUpperCase() ?? null;

  return (
    <>
      <PageHead
        title={o.client.name}
        sub={
          <>
            Your air conditioning, looked after by <b>{o.business.name}</b>
            {o.business.phone ? ` · ${o.business.phone}` : ""}
          </>
        }
      >
        {o.business.logo_url && <img className="bizlogo" src={o.business.logo_url} alt="" />}
      </PageHead>

      <section className="card" aria-label="Visits to come">
        <h2>Visits to come</h2>
        {!upcoming.length && <p className="note">Nothing booked at the moment.</p>}
        <ul className="rows">
          {upcoming.map((v) => (
            <UpcomingVisit key={v.id} api={api} v={v} focused={v.id === focus} done={data.reload} />
          ))}
        </ul>
      </section>

      <RequestVisit api={api} o={o} scanned={scanned} done={data.reload} />

      {o.requests.some((r) => r.status === "requested") && (
        <section className="card" aria-label="Your requests">
          <h2>Waiting to be booked</h2>
          <ul className="rows">
            {o.requests
              .filter((r) => r.status === "requested")
              .map((r) => (
                <li key={r.id}>
                  <div className="item">
                    <span className="main">
                      <span className="t">
                        {r.kind}
                        {r.site ? ` · ${r.site}` : ""}
                      </span>
                      <span className="m">
                        Asked {formatDate(r.created_at.slice(0, 10))}
                        {r.message ? ` · ${r.message}` : ""}
                      </span>
                    </span>
                    <WithdrawButton api={api} id={r.id} done={data.reload} />
                  </div>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="card" aria-label="Your sites">
        <h2>Your sites and units</h2>
        {!o.sites.length && <p className="note">No sites recorded yet.</p>}
        {o.sites.map((s) => (
          <div key={s.id} className="site">
            <h3>{s.name}</h3>
            <p className="note">
              {[s.address, s.postcode].filter(Boolean).join(", ")}
              {s.refrigerant ? ` · ${s.refrigerant}` : ""}
            </p>
            <ul className="rows">
              {s.units.map((u) => (
                <li key={u.sticker_code}>
                  <div className="item">
                    <span className="avatar sq">
                      <Icon name="snow" size={18} />
                    </span>
                    <span className="main">
                      <span className="t">
                        Asset #{u.asset_no} ·{" "}
                        {u.role === "outdoor" ? "Outdoor unit" : (u.indoor_type ?? "Indoor unit")}
                      </span>
                      <span className="m">
                        {[u.manufacturer, u.model, u.location].filter(Boolean).join(" · ") || u.sticker_code}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="card" aria-label="Service reports">
        <h2>Service reports</h2>
        {!o.reports.length && <p className="note">Reports appear here after each visit.</p>}
        <ul className="rows">
          {o.reports.map((r) => (
            <li key={r.id}>
              <div className="item">
                <span className="main">
                  <span className="t">
                    {r.type} · {r.site}
                  </span>
                  <span className="m">
                    {formatDate(r.date)} · {r.ref}
                    {r.rev > 1 ? ` (revision ${r.rev})` : ""}
                  </span>
                </span>
                <ReportButton api={api} path={r.path} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {past.length > 0 && (
        <section className="card" aria-label="Past visits">
          <h2>Past visits</h2>
          <ul className="rows">
            {past.slice(0, 30).map((v) => (
              <li key={v.id}>
                <div className="item">
                  <span className="main">
                    <span className="t">
                      {v.type} · {v.site}
                    </span>
                    <span className="m">{when(v)}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {o.contracts.length > 0 && (
        <section className="card" aria-label="Your contracts">
          <h2>Maintenance contract</h2>
          {o.contracts.map((k) => (
            <p key={k.name + k.end_date}>
              <b>{k.name}</b>: {k.visits_per_year} visit{k.visits_per_year === 1 ? "" : "s"} a year, from{" "}
              {formatDate(k.start_date)} to {formatDate(k.end_date)}. Visits are booked for you.
            </p>
          ))}
        </section>
      )}
    </>
  );
}

function UpcomingVisit(p: { api: PortalApi; v: PortalVisit; focused: boolean; done: () => void }) {
  const { v } = p;
  const [asking, setAsking] = useState(false);
  const act = useAction();
  return (
    <li className={p.focused ? "focus" : undefined}>
      <div className="item">
        <span className="avatar sq">
          <Icon name="calendar" size={18} />
        </span>
        <span className="main">
          <span className="t">
            {v.type} · {v.site}
          </span>
          <span className="m">
            {when(v)}
            {v.engineer ? ` · ${v.engineer}` : ""}
          </span>
        </span>
        {v.customer_response === "accepted" && <span className="pill green">Accepted</span>}
        {v.customer_response === "change" && <span className="pill amber">Asked to change</span>}
      </div>
      <ErrorLine error={act.error} />
      {!v.customer_response && !asking && v.date && (
        <div className="row">
          <button
            className="btn pri"
            disabled={act.busy}
            onClick={() => void act.run(async () => (await p.api.respond(v.id, "accepted"), p.done()))}
          >
            <Icon name="check" size={18} />
            Accept
          </button>
          <button className="btn" onClick={() => setAsking(true)}>
            Ask for another time
          </button>
        </div>
      )}
      {asking && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const note = String(new FormData(e.currentTarget).get("note") ?? "").trim();
            void act.run(async () => {
              await p.api.respond(v.id, "change", note);
              setAsking(false);
              p.done();
            });
          }}
        >
          <label>
            What times suit you?
            <textarea name="note" rows={2} required />
          </label>
          <div className="row">
            <button className="btn pri" type="submit" disabled={act.busy}>
              Send
            </button>
            <button className="btn" type="button" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {v.customer_response === "change" && v.customer_note && (
        <p className="note">You said: {v.customer_note}. They'll be in touch with a new time.</p>
      )}
    </li>
  );
}

function RequestVisit(p: { api: PortalApi; o: PortalOverview; scanned: string | null; done: () => void }) {
  const { o } = p;
  const fromScan = (() => {
    if (!p.scanned) return null;
    for (const s of o.sites) {
      const u = s.units.find((x) => x.sticker_code === p.scanned);
      if (u) return { site: s.id, unit: u };
    }
    return null;
  })();
  const [open, setOpen] = useState(!!fromScan);
  const slots = useLoad(
    () => (o.business.self_booking && open ? p.api.slots(o.client.id) : Promise.resolve([] as Slot[])),
    [p.api, o.client.id, o.business.self_booking, open],
  );
  const [kind, setKind] = useState(fromScan ? "Repair" : "Service");
  const [said, setSaid] = useState("");
  const act = useAction();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "").trim();
    const slotValue = get("slot");
    const slot = slotValue ? ({ day: slotValue.slice(0, 10), part: slotValue.slice(11) } as Slot) : null;
    void act.run(async () => {
      const out = await p.api.request({
        clientId: o.client.id,
        systemId: get("site") || null,
        kind,
        message: get("message"),
        preferred: get("preferred"),
        slot,
      });
      setSaid(
        out.job
          ? `Booked for ${slot ? slotLabel(slot) : "the time you chose"}. ${o.business.name} will confirm who's coming.`
          : `Sent to ${o.business.name}. They'll book a time and email you to accept it.`,
      );
      setOpen(false);
      if (p.scanned) window.history.replaceState(null, "", window.location.pathname + window.location.search);
      p.done();
    });
  }

  return (
    <section className="card" aria-label="Ask for a visit">
      <div className="row spread">
        <h2>Ask for a visit</h2>
        {!open && (
          <button className="btn pri" onClick={() => (setOpen(true), setSaid(""))}>
            <Icon name="plus" size={18} />
            Ask for a visit
          </button>
        )}
      </div>
      {said && <p className="banner ok">{said}</p>}
      {open && (
        <form className="form" onSubmit={submit} aria-label="Visit request">
          <ErrorLine error={act.error} />
          {fromScan && (
            <p className="note">
              For asset #{fromScan.unit.asset_no}
              {fromScan.unit.location ? ` (${fromScan.unit.location})` : ""}, the unit you scanned.
            </p>
          )}
          <fieldset className="chips" aria-label="What do you need?">
            {(["Service", "Repair", "Other"] as const).map((k) => (
              <button
                type="button"
                key={k}
                className="chip"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {k === "Service" ? "A service" : k === "Repair" ? "A repair" : "Something else"}
              </button>
            ))}
          </fieldset>
          <label>
            Site
            <select name="site" defaultValue={fromScan?.site ?? o.sites[0]?.id ?? ""}>
              {o.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {kind === "Repair" ? "What's wrong?" : "Anything we should know?"}
            <textarea
              name="message"
              rows={3}
              required={kind !== "Service"}
              defaultValue={
                fromScan
                  ? `Asset #${fromScan.unit.asset_no}${fromScan.unit.location ? `, ${fromScan.unit.location}` : ""}: `
                  : ""
              }
            />
          </label>
          {o.business.self_booking && (slots.value?.length ?? 0) > 0 ? (
            <label>
              Pick a time
              <select name="slot" defaultValue="">
                <option value="">Let {o.business.name} choose</option>
                {(slots.value ?? []).map((s) => (
                  <option key={`${s.day}-${s.part}`} value={`${s.day}-${s.part}`}>
                    {slotLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            When suits you?
            <input name="preferred" placeholder="e.g. weekday mornings" />
          </label>
          <div className="row">
            <button className="btn pri" type="submit" disabled={act.busy}>
              {act.busy ? "Sending…" : "Send request"}
            </button>
            <button className="btn" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function WithdrawButton(p: { api: PortalApi; id: string; done: () => void }) {
  const act = useAction();
  return (
    <button
      className="btn"
      disabled={act.busy}
      onClick={() => void act.run(async () => (await p.api.withdraw(p.id), p.done()))}
    >
      Withdraw
    </button>
  );
}

function ReportButton(p: { api: PortalApi; path: string }) {
  const act = useAction();
  return (
    <button
      className="btn"
      disabled={act.busy}
      title={act.error || undefined}
      onClick={() =>
        void act.run(async () => {
          window.open(await p.api.reportUrl(p.path), "_blank", "noopener");
        })
      }
    >
      <Icon name="download" size={18} />
      PDF
    </button>
  );
}
