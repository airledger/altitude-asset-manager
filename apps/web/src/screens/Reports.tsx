// Service reports (spec F10): sign-off, the report card on a job, sending, and the Reports list.
import { formatDate, systemInfo } from "@airledger/domain";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Business } from "../api";
import { toDomain, type Assets, type ClientRow, type SystemRow, type UnitRow } from "../assets";
import { Area, Check, readForm, Text } from "../fields";
import { Icon } from "../icons";
import { toJob, type JobListRow, type JobRecord, type JobsApi } from "../jobs";
import {
  fingerprint,
  latest,
  nextRef,
  reportFileName,
  snapshot,
  viaLabel,
  type ReportRow,
  type ReportsApi,
  type SignoffRow,
} from "../reports";
import { download } from "../stickerPdf";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { go, todayIso, useLoad } from "./Assets";

/** What a report is built from. The job page loads most of it already. */
export interface ReportCtx {
  job: JobListRow;
  record: JobRecord;
  system: SystemRow;
  units: UnitRow[];
  history: JobListRow[];
  settings: Parameters<typeof systemInfo>[2];
}

const CERT_KEY = "airledger.engineerCert";
const savedCert = () => {
  try {
    return localStorage.getItem(CERT_KEY) ?? "";
  } catch {
    return "";
  }
};

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// ---------- signature pad ----------

export interface Pad {
  isEmpty(): boolean;
  clear(): void;
  png(): Promise<Blob | null>;
}

/** A box to sign with a finger, stylus or mouse. */
export function SignaturePad({ label, pad }: { label: string; pad: (p: Pad) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [inked, setInked] = useState(false);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ratio = window.devicePixelRatio || 1;
    const fit = () => {
      cv.width = Math.round(cv.clientWidth * ratio) || 600;
      cv.height = Math.round(cv.clientHeight * ratio) || 200;
      const g = cv.getContext("2d");
      if (g) {
        g.lineWidth = 2.2 * ratio;
        g.lineCap = "round";
        g.lineJoin = "round";
        g.strokeStyle = "#0F2238";
      }
    };
    fit();
    let drawing = false;
    let ink = false;
    const at = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return [(e.clientX - r.left) * ratio, (e.clientY - r.top) * ratio] as const;
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      drawing = true;
      cv.setPointerCapture?.(e.pointerId);
      const g = cv.getContext("2d");
      const [x, y] = at(e);
      g?.beginPath();
      g?.moveTo(x, y);
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const g = cv.getContext("2d");
      const [x, y] = at(e);
      g?.lineTo(x, y);
      g?.stroke();
      if (!ink) {
        ink = true;
        setInked(true);
      }
    };
    const up = () => (drawing = false);
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    pad({
      isEmpty: () => !ink,
      clear: () => {
        cv.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
        ink = false;
        setInked(false);
      },
      png: () =>
        ink
          ? new Promise<Blob | null>((ok) => {
              try {
                cv.toBlob(ok, "image/png");
              } catch {
                ok(null);
              }
            })
          : Promise.resolve(null),
    });
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="sigpad">
      <div className="row spread">
        <span className="lbl">{label}</span>
        {inked && (
          <button
            type="button"
            className="link"
            onClick={() => {
              const g = ref.current?.getContext("2d");
              g?.clearRect(0, 0, ref.current?.width ?? 0, ref.current?.height ?? 0);
              setInked(false);
              pad({ isEmpty: () => true, clear: () => undefined, png: () => Promise.resolve(null) });
            }}
          >
            Clear
          </button>
        )}
      </div>
      <canvas ref={ref} aria-label={label} role="img" />
      {!inked && <span className="sig-hint">Sign here</span>}
    </div>
  );
}

// ---------- building and issuing ----------

async function buildAndIssue(a: {
  reports: ReportsApi;
  assets: Assets;
  business: Business;
  ctx: ReportCtx;
  client: ClientRow | null;
  signoff: Omit<SignoffRow, "job_id">;
  previous: ReportRow[];
}): Promise<ReportRow> {
  const { ctx } = a;
  const hash = await fingerprint(snapshot({ ...ctx, client: a.client }));
  const { ref, rev } = nextRef(ctx.job, a.previous, todayIso());
  const info = systemInfo(toDomain(ctx.system), ctx.history.map(toJob), ctx.settings, todayIso());
  const [profile, logo, engineerSig, customerSig, photos] = await Promise.all([
    a.assets.profile(),
    a.business.logoUrl
      ? fetch(a.business.logoUrl)
          .then((r) => (r.ok ? r.blob() : null))
          .catch(() => null)
      : Promise.resolve(null),
    a.reports.fileBlob(a.signoff.engineer_signature_file_id),
    a.signoff.customer_signature_file_id
      ? a.reports.fileBlob(a.signoff.customer_signature_file_id)
      : Promise.resolve(null),
    Promise.all((ctx.record.report?.photo_file_ids ?? []).map((id) => a.reports.fileBlob(id))),
  ]);
  const { reportPdf } = await import("../reportPdf");
  const pdf = await reportPdf({
    business: a.business.name,
    profile,
    client: a.client,
    system: ctx.system,
    units: ctx.units,
    job: ctx.job,
    record: ctx.record,
    info,
    signoff: a.signoff,
    images: { logo, engineerSig, customerSig, photos: photos.filter((b): b is Blob => !!b) },
    meta: { ref, rev, issuedAt: new Date().toISOString(), hash },
  });
  return a.reports.issue({ jobId: ctx.job.id, ref, rev, hash, pdf });
}

/** Sign-off: engineer and customer sign, then the report is made, stored and (if set up) emailed. */
export function SignOff(p: {
  assets: Assets;
  jobs: JobsApi;
  reports: ReportsApi;
  business: Business;
  ctx: ReportCtx;
}) {
  const { ctx } = p;
  const j = ctx.job;
  const data = useLoad(async () => {
    const [signoff, me, client, previous, settings] = await Promise.all([
      p.reports.signoff(j.id),
      p.jobs.me(),
      p.assets.client(ctx.system.client_id),
      p.reports.reports(j.id),
      p.reports.settings(),
    ]);
    return { signoff, me, client, previous, settings };
  }, [p.reports, j.id]);
  const engineerPad = useRef<Pad | null>(null);
  const customerPad = useRef<Pad | null>(null);
  const [absent, setAbsent] = useState(false);
  const [keep, setKeep] = useState(true);
  const { busy, error, run } = useAction();
  const [step, setStep] = useState("");

  if (!data.value) return data.error ? <ErrorLine error={data.error} /> : <Loading />;
  const { signoff: prev, me, client, previous, settings } = data.value;
  const reissue = previous.length > 0;
  const canKeep = reissue && !!prev;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    void run(async () => {
      const reuse = canKeep && keep && prev;
      const customerAbsent = reuse ? prev.customer_absent : absent;
      if (!reuse && engineerPad.current?.isEmpty() !== false)
        throw new Error("The engineer needs to sign in the box.");
      if (!reuse && !customerAbsent && customerPad.current?.isEmpty() !== false)
        throw new Error("Ask the customer to sign, or tick that they weren't available.");
      if (customerAbsent && !(reuse ? prev.absent_note : f.text("absent_note")))
        throw new Error("Say why the customer couldn't sign.");
      setStep("Saving signatures…");
      let engineerSig = reuse ? prev.engineer_signature_file_id : "";
      let customerSig = reuse ? prev.customer_signature_file_id : null;
      if (!reuse) {
        const e1 = await engineerPad.current?.png();
        if (!e1) throw new Error("Couldn't read the engineer's signature. Try signing again.");
        engineerSig = await p.reports.uploadSignature(e1);
        if (!customerAbsent) {
          const c1 = await customerPad.current?.png();
          if (!c1) throw new Error("Couldn't read the customer's signature. Try signing again.");
          customerSig = await p.reports.uploadSignature(c1);
        }
      }
      const cert = f.text("engineer_cert");
      try {
        localStorage.setItem(CERT_KEY, cert);
      } catch {
        // Remembering it is a convenience only.
      }
      const email = f.text("client_email").toLowerCase();
      const row = {
        job_id: j.id,
        engineer_name: f.text("engineer_name"),
        engineer_cert: cert,
        engineer_signature_file_id: engineerSig,
        customer_name: f.text("customer_name"),
        client_email: email,
        customer_absent: customerAbsent,
        absent_note: customerAbsent ? (reuse ? prev.absent_note : f.text("absent_note")) : "",
        customer_signature_file_id: customerAbsent ? null : customerSig,
      };
      await p.reports.saveSignoff(row);
      await p.reports.keepClientEmail(client, email);
      setStep("Making the report…");
      const report = await buildAndIssue({
        reports: p.reports,
        assets: p.assets,
        business: p.business,
        ctx,
        client,
        signoff: { ...row, signed_at: new Date().toISOString() },
        previous,
      });
      const to = email || client?.email || "";
      if (settings.auto_email_reports && to) {
        setStep("Emailing it…");
        try {
          const { path } = await p.reports.pdf(report);
          const d = draft(p.business.name, ctx, client, report, row.engineer_name);
          await p.reports.email({
            report,
            pdfPath: path,
            filename: reportFileName(report, client?.name ?? ""),
            to: [to],
            cc: settings.report_email ? [settings.report_email] : [],
            subject: d.subject,
            message: d.message,
            replyTo: settings.email,
          });
          go(`#/job/${j.id}?sent=${encodeURIComponent(to)}`);
          return;
        } catch {
          // Fall through to the send screen, which shows the reason if it fails again.
        }
      }
      go(`#/job/${j.id}?do=send`);
    }).finally(() => setStep(""));
  }

  return (
    <>
      <PageHead
        back={{ href: `#/job/${j.id}`, label: j.type }}
        title={reissue ? `Re-issue report (revision ${(latest(previous)?.rev ?? 0) + 1})` : "Sign off"}
        sub={`${j.systems?.clients?.name ?? ""} · ${j.systems?.name ?? ""}`}
      />
      <form className="card form narrowform signoff" onSubmit={submit} aria-label="Sign off">
        <ErrorLine error={error} />
        <div className="grid2">
          <Text
            name="engineer_name"
            label="Engineer"
            value={prev?.engineer_name || me?.name || j.engineer}
            required
          />
          <Text
            name="engineer_cert"
            label="Engineer's F-gas certificate number"
            value={prev?.engineer_cert || me?.fgas_cert || savedCert()}
          />
          <Text name="customer_name" label="Customer's name" value={prev?.customer_name ?? ""} />
          <Text
            name="client_email"
            label="Send the report to"
            type="email"
            value={prev?.client_email || client?.email || ""}
          />
        </div>
        {canKeep && (
          <label className="check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.currentTarget.checked)} />
            Use the signatures from the last report
          </label>
        )}
        {!(canKeep && keep) && (
          <>
            <SignaturePad label="Engineer's signature" pad={(x) => (engineerPad.current = x)} />
            <label className="check">
              <input type="checkbox" checked={absent} onChange={(e) => setAbsent(e.currentTarget.checked)} />
              The customer wasn't available to sign
            </label>
            {absent ? (
              <Area name="absent_note" label="Why couldn't they sign?" value="" rows={2} />
            ) : (
              <SignaturePad label="Customer's signature" pad={(x) => (customerPad.current = x)} />
            )}
          </>
        )}
        <p className="note">
          The report is stored once and can't be changed. If the job is edited later, you can issue a new
          revision.
          {settings.auto_email_reports && " It's emailed to the customer as soon as it's made."}
        </p>
        <button className="btn pri" type="submit" disabled={busy}>
          {busy ? step || "Working…" : reissue ? "Re-issue report" : "Sign and make report"}
        </button>
      </form>
    </>
  );
}

// ---------- sending ----------

export function draft(
  business: string,
  ctx: Pick<ReportCtx, "job" | "system">,
  client: ClientRow | null,
  r: Pick<ReportRow, "ref">,
  engineer: string,
) {
  const install = ctx.job.type === "Installation" || ctx.job.type === "Commissioning";
  const what = install ? "installation and commissioning" : "service";
  const site = ctx.system.site_postcode || ctx.system.name;
  const first = (client?.contact_name || "").split(" ")[0] || "there";
  return {
    subject: `${install ? "Installation & commissioning" : "Service"} report ${r.ref} – ${site}`,
    message: `Hi ${first},\n\nPlease find attached your ${what} report for ${ctx.system.name || "your air conditioning"}${ctx.system.site_postcode ? ` at ${ctx.system.site_postcode}` : ""}, completed on ${formatDate(ctx.job.date)}. It lists the work carried out on each unit and is signed by our engineer. Please keep it for your records, as it's evidence of servicing for any warranty claim.\n\nReport reference: ${r.ref}\n\nKind regards,\n${engineer}\n${business}`,
  };
}

/** Email it (from the business, through Air Ledger), share it, download it, or open it in Mail. */
export function SendReport(p: {
  assets: Assets;
  reports: ReportsApi;
  business: Business;
  ctx: Pick<ReportCtx, "job" | "system">;
  reportId?: string | null;
}) {
  const j = p.ctx.job;
  const data = useLoad(async () => {
    const [list, signoff, client, settings] = await Promise.all([
      p.reports.reports(j.id),
      p.reports.signoff(j.id),
      p.assets.client(p.ctx.system.client_id),
      p.reports.settings(),
    ]);
    return { list, signoff, client, settings };
  }, [p.reports, j.id]);
  const { busy, error, run } = useAction();
  const [done, setDone] = useState("");
  if (!data.value) return data.error ? <ErrorLine error={data.error} /> : <Loading />;
  const { list, signoff, client, settings } = data.value;
  const r = list.find((x) => x.id === p.reportId) ?? latest(list);
  if (!r)
    return (
      <section className="card">
        <p>No report yet. Sign the job off first.</p>
      </section>
    );
  const report = r;
  const d = draft(p.business.name, p.ctx, client, report, signoff?.engineer_name || j.engineer);
  const file = reportFileName(report, client?.name ?? "");
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const getPdf = () => p.reports.pdf(report);
  const emails = (s: string) =>
    s
      .split(/[,;\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);

  function email(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    void run(async () => {
      const to = emails(f.text("to"));
      const cc = emails(f.text("cc"));
      if (!to.length) throw new Error("Who should it go to?");
      const { path } = await getPdf();
      await p.reports.email({
        report,
        pdfPath: path,
        filename: file,
        to,
        cc,
        subject: f.text("subject"),
        message: f.text("message"),
        replyTo: settings.email,
      });
      setDone(`Emailed to ${[...to, ...cc].join(" and ")}.`);
      data.reload();
    });
  }

  return (
    <>
      <PageHead
        back={{ href: `#/job/${j.id}`, label: j.type }}
        title={`Send report ${report.ref}${report.rev > 1 ? ` rev ${report.rev}` : ""}`}
        sub={`${client?.name ?? ""} · ${p.ctx.system.name}`}
      />
      {done && <p className="banner ok">{done}</p>}
      <form className="card form narrowform" onSubmit={email} aria-label="Email the report">
        <ErrorLine error={error} />
        <div className="grid2">
          <Text name="to" label="To" value={signoff?.client_email || client?.email || ""} />
          <Text name="cc" label="Copy to (office)" value={settings.report_email} />
        </div>
        <Text name="subject" label="Subject" value={d.subject} />
        <Area name="message" label="Message" value={d.message} rows={9} />
        <p className="note">
          Sent from “{p.business.name}” at reports@airledger.co.uk, with the PDF attached. Replies go to{" "}
          {settings.email || "your business email (set it in Business)"}.
        </p>
        <div className="row">
          <button className="btn pri" type="submit" disabled={busy}>
            <Icon name="send" size={18} />
            {busy ? "Sending…" : "Email it"}
          </button>
          {canShare && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const { blob } = await getPdf();
                  const pdf = new File([blob], file, { type: "application/pdf" });
                  try {
                    await navigator.share({ files: [pdf], title: d.subject, text: d.message });
                  } catch (e) {
                    if ((e as Error).name === "AbortError") return;
                    throw e;
                  }
                  await p.reports.logSend(report.id, "share");
                  data.reload();
                })
              }
            >
              Share
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { blob } = await getPdf();
                download(blob, file);
                await p.reports.logSend(report.id, "download");
                data.reload();
              })
            }
          >
            <Icon name="download" size={18} />
            Download
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const form = document.querySelector<HTMLFormElement>('form[aria-label="Email the report"]');
                const f = form ? readForm(form) : null;
                const to = f?.text("to") ?? "";
                const cc = f?.text("cc") ?? "";
                const q = [
                  cc && `cc=${encodeURIComponent(cc)}`,
                  `subject=${encodeURIComponent(f?.text("subject") ?? d.subject)}`,
                  `body=${encodeURIComponent(f?.text("message") ?? d.message)}`,
                ]
                  .filter(Boolean)
                  .join("&");
                await p.reports.logSend(report.id, "mail-app", emails(`${to},${cc}`));
                window.location.href = `mailto:${encodeURIComponent(to)}?${q}`;
              })
            }
          >
            Open in Mail
          </button>
        </div>
      </form>
      <SendLog report={report} />
    </>
  );
}

function SendLog({ report }: { report: ReportRow }) {
  const sends = [...(report.report_sends ?? [])].sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  if (!sends.length) return null;
  return (
    <section className="card">
      <h2>Sent</h2>
      <ul className="list history">
        {sends.map((s) => (
          <li key={s.id}>
            <div>
              <b>{viaLabel(s.via)}</b>
              {s.sent_to && ` to ${s.sent_to}`} · {stamp(s.sent_at)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- the report card on a job ----------

/** On a completed job: sign it off, or the issued report with its sends, and whether it's out of date. */
export function ReportCard(p: {
  assets: Assets;
  reports: ReportsApi;
  ctx: ReportCtx;
  sentTo?: string | null;
}) {
  const j = p.ctx.job;
  const data = useLoad(async () => {
    const [list, client] = await Promise.all([
      p.reports.reports(j.id),
      p.assets.client(p.ctx.system.client_id),
    ]);
    const now = await fingerprint(snapshot({ ...p.ctx, client }));
    return { list, now, client };
  }, [p.reports, p.ctx]);
  const { busy, error, run } = useAction();
  if (!data.value)
    return (
      <section className="card">
        <h2>Service report</h2>
        {data.error ? <ErrorLine error={data.error} /> : <Loading />}
      </section>
    );
  const { list, now, client } = data.value;
  const r = latest(list);
  if (!r)
    return (
      <section className="card">
        <h2>Service report</h2>
        <p className="note">Get the engineer's and customer's signatures, and Air Ledger makes the report.</p>
        <a className="btn pri" href={`#/job/${j.id}?do=signoff`}>
          <Icon name="edit" size={18} />
          Sign off and make report
        </a>
      </section>
    );
  const edited = r.hash !== now;
  const sends = r.report_sends ?? [];
  const last = [...sends].sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0];
  return (
    <section className="card">
      <div className="row spread">
        <h2>Service report</h2>
        <span className="pill green">
          {r.ref}
          {r.rev > 1 && ` rev ${r.rev}`}
        </span>
      </div>
      {p.sentTo && <p className="banner ok">Emailed to {p.sentTo}.</p>}
      {edited && (
        <p className="banner">
          The job has been edited since this report was made. Re-issue it so the customer has the right
          record.
        </p>
      )}
      <ErrorLine error={error} />
      <p className="note">
        Issued {stamp(r.issued_at)}
        {last
          ? ` · ${viaLabel(last.via).toLowerCase()}${last.sent_to ? ` to ${last.sent_to}` : ""} ${stamp(last.sent_at)}`
          : " · not sent yet"}
        {list.length > 1 && ` · ${list.length} revisions`}
      </p>
      <div className="row">
        <a className="btn pri" href={`#/job/${j.id}?do=send`}>
          <Icon name="send" size={18} />
          Send
        </a>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const { blob } = await p.reports.pdf(r);
              download(blob, reportFileName(r, client?.name ?? ""));
            })
          }
        >
          <Icon name="download" size={18} />
          Download
        </button>
        {edited && (
          <a className="btn" href={`#/job/${j.id}?do=signoff`}>
            Re-issue as revision {r.rev + 1}
          </a>
        )}
      </div>
    </section>
  );
}

// ---------- the Reports section ----------

export function ReportsPage(p: { reports: ReportsApi }) {
  const data = useLoad(() => p.reports.allReports(), [p.reports]);
  const [q, setQ] = useState("");
  const { busy, error, run } = useAction();
  const needle = q.trim().toLowerCase();
  const rows = (data.value ?? []).filter(
    (r) =>
      !needle ||
      [
        r.ref,
        r.jobs?.systems?.clients?.name,
        r.jobs?.systems?.name,
        r.jobs?.systems?.site_postcode,
        r.jobs?.type,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
  );
  return (
    <>
      <PageHead
        back={{ href: "#/jobs", label: "Jobs" }}
        title="Reports"
        sub="Every service report issued, as the PDF the customer got."
      />
      <section className="card">
        <input
          type="search"
          className="search"
          aria-label="Search reports"
          placeholder="Search reference, client, install or postcode"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <ErrorLine error={data.error || error} />
        {!data.value ? (
          <Loading />
        ) : !rows.length ? (
          <Empty icon="check" title={needle ? "No reports match" : "No reports yet"}>
            Reports show here once a completed job is signed off.
          </Empty>
        ) : (
          <ul className="rows">
            {rows.map((r) => {
              const sends = [...(r.report_sends ?? [])].sort((a, b) => b.sent_at.localeCompare(a.sent_at));
              const last = sends[0];
              return (
                <li key={r.id}>
                  <div className="item">
                    <a className="main" href={`#/job/${r.job_id}`}>
                      <span className="t">
                        {r.jobs?.systems?.clients?.name ?? ""} · {r.jobs?.systems?.name ?? ""}
                      </span>
                      <span className="m">
                        {[
                          `${r.ref}${r.rev > 1 ? ` rev ${r.rev}` : ""}`,
                          r.jobs?.type,
                          formatDate(r.jobs?.date ?? null),
                          last
                            ? `${viaLabel(last.via).toLowerCase()}${last.sent_to ? ` to ${last.sent_to}` : ""}`
                            : "not sent",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </a>
                    <button
                      className="btn sm"
                      aria-label={`Download ${r.ref}${r.rev > 1 ? ` rev ${r.rev}` : ""}`}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const { blob } = await p.reports.pdf(r);
                          download(blob, reportFileName(r, r.jobs?.systems?.clients?.name ?? ""));
                        })
                      }
                    >
                      <Icon name="download" size={18} />
                    </button>
                    <a
                      className="btn sm"
                      href={`#/job/${r.job_id}?do=send&report=${r.id}`}
                      aria-label={`Send ${r.ref}`}
                    >
                      <Icon name="send" size={18} />
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

/** Owner settings: the office copy and automatic emailing. */
export function ReportSettingsForm({ reports }: { reports: ReportsApi }) {
  const s = useLoad(() => reports.settings(), [reports]);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  if (!s.value) return <ErrorLine error={s.error} />;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    setSaved(false);
    void run(async () => {
      await reports.saveSettings({
        report_email: f.text("report_email").toLowerCase(),
        auto_email_reports: f.bool("auto_email_reports"),
      });
      setSaved(true);
    });
  }
  return (
    <form className="card form" onSubmit={submit} aria-label="Service reports">
      <h2>Service reports</h2>
      <ErrorLine error={error} />
      <Text
        name="report_email"
        label="Office copy (Cc on every report)"
        type="email"
        value={s.value.report_email}
      />
      <Check
        name="auto_email_reports"
        label="Email the report to the customer as soon as the job is signed off"
        value={s.value.auto_email_reports}
      />
      <div className="row">
        <button className="btn pri" type="submit" disabled={busy}>
          Save
        </button>
        {saved && <span className="note">Saved.</span>}
      </div>
    </form>
  );
}
