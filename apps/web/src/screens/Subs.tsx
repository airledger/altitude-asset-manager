// Subcontractors on screen: their reply to a job, their charge for it, their insurance and certificates, and
// the owners' Subcontractors page (#/subcontractors) with charges to approve and papers running out.
import { toCsv } from "@airledger/domain";
import { useState } from "react";
import type { Assets } from "../assets";
import { Area, Text } from "../fields";
import type { JobsApi } from "../jobs";
import { download } from "../stickerPdf";
import {
  CHARGE_LABEL,
  PAPER_KINDS,
  chargeCsvRows,
  expiringPapers,
  expiryText,
  type PaperKind,
  type SubCharge,
  type SubPaperRow,
  type SubsApi,
} from "../subs";
import { Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { todayIso, useLoad } from "./Assets";

const money = (n: number) =>
  `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const stamp = (t: string) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** A subcontractor's answer to a job sent to them. */
export function SubReplyCard(p: {
  subs: SubsApi;
  jobId: string;
  reply: "" | "accepted" | "declined";
  note: string;
  business: string;
  saved: () => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [why, setWhy] = useState("");
  const act = useAction();
  const send = (accept: boolean) =>
    void act.run(async () => {
      await p.subs.reply(p.jobId, accept, accept ? "" : why);
      setDeclining(false);
      p.saved();
    });
  if (p.reply === "accepted") return null;
  return (
    <section className="card" aria-label="Can you do this job?">
      {p.reply === "declined" ? (
        <p className="banner">
          You told {p.business} you can't do this job{p.note ? `: "${p.note}"` : "."} They'll send it to
          someone else, or change it and ask you again.
        </p>
      ) : (
        <>
          <h2>Can you do this job?</h2>
          <p className="note">{p.business} has sent you this job. Let them know if you can do it.</p>
        </>
      )}
      <ErrorLine error={act.error} />
      {declining ? (
        <div className="form">
          <label>
            Why can't you do it?
            <textarea value={why} onChange={(e) => setWhy(e.currentTarget.value)} rows={2} />
          </label>
          <div className="row">
            <button
              type="button"
              className="btn pri"
              disabled={act.busy || !why.trim()}
              onClick={() => send(false)}
            >
              Send
            </button>
            <button type="button" className="btn" onClick={() => setDeclining(false)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="btn pri" disabled={act.busy} onClick={() => send(true)}>
            {p.reply === "declined" ? "I can do it after all" : "Accept the job"}
          </button>
          {p.reply !== "declined" && (
            <button type="button" className="btn" disabled={act.busy} onClick={() => setDeclining(true)}>
              I can't do it
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Owners: where a subcontracted job stands. */
export function subReplyText(reply: string, note: string, name: string): string {
  if (reply === "accepted") return `${name} (subcontractor) accepted this job.`;
  if (reply === "declined")
    return `${name} (subcontractor) can't do this job${note ? `: "${note}"` : "."} Send it to someone else.`;
  return `Sent to ${name} (subcontractor). They haven't replied yet.`;
}

/**
 * The subcontractor's charge for a completed job: they send it (and can change it until it's approved); owners
 * approve it or turn it down with a reason.
 */
export function SubChargeCard(p: {
  subs: SubsApi;
  jobId: string;
  personId: string;
  owner: boolean;
  name: string;
}) {
  const charge = useLoad(() => p.subs.charge(p.jobId), [p.subs, p.jobId]);
  const [editing, setEditing] = useState(false);
  const [why, setWhy] = useState("");
  const act = useAction();
  const c = charge.value;
  if (charge.value === undefined) return null;
  if (p.owner && !c)
    return (
      <section className="card" aria-label="Subcontractor's charge">
        <h2>Subcontractor's charge</h2>
        <p className="note">{p.name} hasn't sent their charge for this job yet.</p>
      </section>
    );
  return (
    <section className="card" aria-label="Subcontractor's charge">
      <h2>{p.owner ? `${p.name}'s charge` : "Your charge for this job"}</h2>
      <ErrorLine error={act.error || charge.error} />
      {c && !editing && (
        <>
          <p>
            <b>{money(c.amount)}</b>
            {c.their_ref && ` · their invoice ${c.their_ref}`} ·{" "}
            <span
              className={`pill${c.status === "approved" ? " green" : c.status === "rejected" ? " red" : " amber"}`}
            >
              {CHARGE_LABEL[c.status]}
            </span>
          </p>
          {c.note && <p className="note">{c.note}</p>}
          {c.status === "rejected" && c.reply && <p className="banner">Turned down: {c.reply}</p>}
          <p className="note">
            Sent {stamp(c.submitted_at)}
            {c.decided_at
              ? ` · ${c.status === "approved" ? "approved" : "turned down"} ${stamp(c.decided_at)}`
              : ""}
          </p>
        </>
      )}
      {p.owner && c && c.status === "submitted" && (
        <div className="form">
          <label>
            Reason, if you're turning it down
            <input value={why} onChange={(e) => setWhy(e.currentTarget.value)} />
          </label>
          <div className="row">
            <button
              type="button"
              className="btn pri"
              disabled={act.busy}
              onClick={() =>
                void act.run(async () => {
                  await p.subs.decide(c.id, true);
                  charge.reload();
                })
              }
            >
              Approve
            </button>
            <button
              type="button"
              className="btn"
              disabled={act.busy || !why.trim()}
              onClick={() =>
                void act.run(async () => {
                  await p.subs.decide(c.id, false, why);
                  setWhy("");
                  charge.reload();
                })
              }
            >
              Turn down
            </button>
          </div>
        </div>
      )}
      {!p.owner && (!c || editing) && (
        <ChargeForm
          subs={p.subs}
          jobId={p.jobId}
          personId={p.personId}
          charge={c ?? null}
          done={() => {
            setEditing(false);
            charge.reload();
          }}
        />
      )}
      {!p.owner && c && c.status !== "approved" && !editing && (
        <button type="button" className="btn" onClick={() => setEditing(true)}>
          {c.status === "rejected" ? "Change and send again" : "Change it"}
        </button>
      )}
    </section>
  );
}

function ChargeForm(p: {
  subs: SubsApi;
  jobId: string;
  personId: string;
  charge: SubCharge | null;
  done: () => void;
}) {
  const act = useAction();
  return (
    <form
      className="form"
      aria-label="Send your charge"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const amount = Number(String(f.get("amount") ?? "").replace(/[£,\s]/g, ""));
        void act.run(async () => {
          if (!Number.isFinite(amount) || amount < 0)
            throw new Error("Enter the amount, like 180 or 180.50.");
          await p.subs.sendCharge({
            id: p.charge?.id,
            job_id: p.jobId,
            person_id: p.personId,
            amount,
            their_ref: String(f.get("their_ref") ?? ""),
            note: String(f.get("note") ?? ""),
          });
          p.done();
        });
      }}
    >
      <div className="grid2">
        <Text
          name="amount"
          label="Amount (£, as you'll invoice it)"
          value={p.charge ? String(p.charge.amount) : ""}
          required
        />
        <Text name="their_ref" label="Your invoice number (optional)" value={p.charge?.their_ref} />
      </div>
      <Area name="note" label="Anything to explain (optional)" value={p.charge?.note} />
      <ErrorLine error={act.error} />
      <button className="btn pri" type="submit" disabled={act.busy}>
        {act.busy ? "Sending…" : "Send charge"}
      </button>
    </form>
  );
}

/** A subcontractor's own insurance and certificates (on their Account page). */
export function SubPapersCard(p: { subs: SubsApi; assets: Assets; personId: string }) {
  const papers = useLoad(() => p.subs.papers(p.personId), [p.subs, p.personId]);
  return (
    <section className="card" aria-label="Your insurance and certificates">
      <h2>Your insurance and certificates</h2>
      <p className="note">
        The business you work for sees these, and you're both reminded before anything runs out.
      </p>
      <PaperList papers={papers.value} assets={p.assets} error={papers.error} who={false} />
      <PaperForm subs={p.subs} personId={p.personId} added={papers.reload} />
    </section>
  );
}

function PaperList(p: {
  papers: SubPaperRow[] | undefined;
  assets: Assets;
  error?: string | undefined;
  who: boolean;
}) {
  const act = useAction();
  const today = todayIso();
  if (p.error) return <ErrorLine error={p.error} />;
  if (!p.papers) return <Loading />;
  if (!p.papers.length) return <p className="note">Nothing on file yet.</p>;
  const soon = new Set(expiringPapers(p.papers, today).map((x) => x.id));
  return (
    <>
      <ErrorLine error={act.error} />
      <ul className="rows">
        {p.papers.map((d) => (
          <li key={d.id} className="item">
            <span className="main">
              <span className="t">
                {p.who && d.people ? `${d.people.name}: ` : ""}
                {d.name}
              </span>
              <span className="m">
                {PAPER_KINDS[d.kind].split(" (")[0]} · {expiryText(d.expires_on, today)}
              </span>
            </span>
            {soon.has(d.id) && <span className="pill red">Renew</span>}
            <button
              type="button"
              className="btn"
              disabled={act.busy}
              onClick={() =>
                void act.run(async () => {
                  window.open(await p.assets.documentUrl(d.file_id), "_blank", "noopener");
                })
              }
            >
              Open
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function PaperForm(p: { subs: SubsApi; personId: string; added: () => void }) {
  const [kind, setKind] = useState<PaperKind>("insurance");
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("");
  const [key, setKey] = useState(0);
  const act = useAction();
  return (
    <div className="form">
      <h3>Add one</h3>
      <div className="grid2">
        <label>
          What it is
          <select value={kind} onChange={(e) => setKind(e.currentTarget.value as PaperKind)}>
            {Object.entries(PAPER_KINDS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input
            value={name}
            placeholder={kind === "insurance" ? "e.g. Public liability £5m" : "e.g. F-gas Category 1"}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <label>
          Runs out on
          <input type="date" value={expires} onChange={(e) => setExpires(e.currentTarget.value)} />
        </label>
      </div>
      <ErrorLine error={act.error} />
      <label className="btn">
        {act.busy ? "Uploading…" : "Upload the document"}
        <input
          key={key}
          type="file"
          hidden
          accept="application/pdf,image/*"
          aria-label="Upload insurance or certificate"
          disabled={act.busy}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f)
              void act.run(async () => {
                await p.subs.addPaper(p.personId, kind, name, expires || null, f);
                setName("");
                setExpires("");
                setKey((k) => k + 1);
                p.added();
              });
          }}
        />
      </label>
    </div>
  );
}

/** Owners: who's a subcontractor, their papers, and their charges. */
export function SubcontractorsPage({ subs, jobs, assets }: { subs: SubsApi; jobs: JobsApi; assets: Assets }) {
  const data = useLoad(() => Promise.all([jobs.people(), subs.papers(), subs.charges()]), [jobs, subs]);
  const [people, papers, charges] = data.value ?? [];
  const today = todayIso();
  const team = (people ?? []).filter((x) => x.active && x.sub);
  const waiting = (charges ?? []).filter((c) => c.status === "submitted");
  const done = (charges ?? []).filter((c) => c.status !== "submitted");
  return (
    <>
      <PageHead
        back={{ href: "#/business", label: "Business" }}
        title="Subcontractors"
        sub="Outside engineers you send jobs to. They see only those jobs, never your prices or other clients."
      />
      <ErrorLine error={data.error} />
      {!data.value ? (
        <Loading />
      ) : (
        <>
          <section className="card">
            <h2>Charges to approve</h2>
            {!waiting.length ? (
              <p className="note">Nothing waiting.</p>
            ) : (
              <ul className="rows">
                {waiting.map((c) => (
                  <li key={c.id}>
                    <a className="item" href={`#/job/${c.job_id}`}>
                      <span className="main">
                        <span className="t">
                          {c.people?.name ?? "Subcontractor"}: {money(c.amount)}
                        </span>
                        <span className="m">
                          {[
                            c.jobs?.type,
                            c.jobs?.systems?.clients?.name,
                            c.jobs?.date,
                            c.their_ref && `invoice ${c.their_ref}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="pill amber">Check</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h2>Subcontractors and their papers</h2>
            {!team.length ? (
              <p className="note">
                No subcontractors yet. Add one on the <a href="#/team">Team</a> page and tick “Subcontractor”.
              </p>
            ) : (
              <ul className="list">
                {team.map((x) => {
                  const mine = (papers ?? []).filter((d) => d.person_id === x.id);
                  const soon = expiringPapers(mine, today);
                  return (
                    <li key={x.id}>
                      <div>
                        <b>{x.name}</b>
                        {x.company && ` · ${x.company}`}
                        <div className="note">
                          {!mine.length
                            ? "No insurance or certificates on file"
                            : soon.length
                              ? `${soon.map((d) => `${d.name}: ${expiryText(d.expires_on, today)}`).join("; ")}`
                              : `${mine.length} on file, all in date`}
                        </div>
                      </div>
                      {(!mine.length || soon.length > 0) && <span className="pill red">Chase</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            {(papers ?? []).length > 0 && (
              <details>
                <summary>Everything on file</summary>
                <PaperList papers={papers} assets={assets} who />
              </details>
            )}
          </section>
          <section className="card">
            <div className="row spread">
              <h2>Past charges</h2>
              {done.some((c) => c.status === "approved") && (
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    download(
                      new Blob([toCsv(chargeCsvRows(done))], { type: "text/csv" }),
                      `subcontractor-charges-${today}.csv`,
                    )
                  }
                >
                  Download approved (CSV)
                </button>
              )}
            </div>
            {!done.length ? (
              <p className="note">None yet.</p>
            ) : (
              <ul className="rows">
                {done.map((c) => (
                  <li key={c.id}>
                    <a className="item" href={`#/job/${c.job_id}`}>
                      <span className="main">
                        <span className="t">
                          {c.people?.name ?? "Subcontractor"}: {money(c.amount)}
                        </span>
                        <span className="m">
                          {[c.jobs?.type, c.jobs?.systems?.clients?.name, c.jobs?.date]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className={`pill${c.status === "approved" ? " green" : " red"}`}>
                        {CHARGE_LABEL[c.status]}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}

/** Owners' Home: charges waiting and papers running out. */
export function SubsAlert({ subs }: { subs: SubsApi }) {
  const data = useLoad(() => Promise.all([subs.charges(), subs.papers()]).catch(() => null), [subs]);
  if (!data.value) return null;
  const [charges, papers] = data.value;
  const waiting = charges.filter((c) => c.status === "submitted").length;
  const soon = expiringPapers(papers, todayIso()).length;
  if (!waiting && !soon) return null;
  return (
    <a className="card banner-card item" href="#/subcontractors">
      <span className="main">
        <span className="t">Subcontractors</span>
        <span className="m">
          {[
            waiting && `${waiting} charge${waiting === 1 ? "" : "s"} to approve`,
            soon && `${soon} insurance or certificate${soon === 1 ? "" : "s"} running out`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    </a>
  );
}
