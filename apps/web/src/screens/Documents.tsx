// Documents uploaded against an install or one of its units (the original warranty certificate, the
// manufacturer's registration confirmation, manuals), and risk assessments (RAMS) that engineers read and sign
// on site before starting a job. PDFs or photos.
import { formatDate } from "@airledger/domain";
import { useRef, useState } from "react";
import { DOCUMENT_KINDS, type Assets, type DocumentRow, type UnitRow } from "../assets";
import { Icon } from "../icons";
import { ErrorLine, useAction } from "../useAction";
import { useLoad } from "./Assets";

const unitName = (u: UnitRow) =>
  [`#${u.asset_no}`, u.role === "outdoor" ? "Outdoor" : u.indoor_type || "Indoor", u.location]
    .filter(Boolean)
    .join(" · ");

const time = (iso: string) =>
  `${formatDate(iso.slice(0, 10))} ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

/** Opens a stored document in a new tab: the tab opens straight away (phones block one opened after waiting). */
function useOpen(assets: Assets) {
  const act = useAction();
  const open = (d: DocumentRow) => {
    const win = window.open("", "_blank");
    void act.run(async () => {
      const url = await assets.documentUrl(d.file_id);
      if (win) win.location.href = url;
      else window.location.assign(url);
    });
  };
  return { open, error: act.error };
}

function UploadButton(p: { busy: boolean; label: string; onFiles: (files: File[]) => Promise<unknown> }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className="btn">
      <Icon name="plus" size={18} />
      {p.busy ? "Uploading…" : p.label}
      <input
        ref={ref}
        type="file"
        hidden
        aria-label={p.label}
        accept="application/pdf,image/*"
        multiple
        disabled={p.busy}
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          if (files.length) void p.onFiles(files).finally(() => ref.current && (ref.current.value = ""));
        }}
      />
    </label>
  );
}

export function DocumentsCard(p: {
  assets: Assets;
  systemId: string;
  units: UnitRow[];
  /** On a unit's page: only its documents (and new ones go on it). */
  unitId?: string;
  owner: boolean;
}) {
  const docs = useLoad(() => p.assets.documents(p.systemId), [p.assets, p.systemId]);
  const act = useAction();
  const opener = useOpen(p.assets);
  const [forUnit, setForUnit] = useState(p.unitId ?? "");
  const [kind, setKind] = useState<DocumentRow["kind"]>("warranty");
  // A job's own risk assessments are shown on the job.
  const shown = (docs.value ?? []).filter((d) => !d.job_id && (!p.unitId || d.unit_id === p.unitId));
  const units = new Map(p.units.map((u) => [u.id, u]));
  const kinds = (Object.keys(DOCUMENT_KINDS) as DocumentRow["kind"][]).filter(
    (k) => !p.unitId || k !== "rams",
  );

  return (
    <section className="card" aria-label="Documents">
      <h2>Documents</h2>
      <ErrorLine error={docs.error || act.error || opener.error} />
      {shown.length > 0 ? (
        <ul className="rows">
          {shown.map((d) => {
            const u = d.unit_id ? units.get(d.unit_id) : undefined;
            return (
              <li key={d.id}>
                <button type="button" className="item" onClick={() => opener.open(d)}>
                  <Icon name="note" size={18} />
                  <span className="main">
                    <span className="t">{d.name}</span>
                    <span className="m">
                      {[
                        DOCUMENT_KINDS[d.kind],
                        !p.unitId && (u ? unitName(u) : "Whole install"),
                        formatDate(d.created_at.slice(0, 10)),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
                {p.owner && (
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Delete ${d.name}`}
                    disabled={act.busy}
                    onClick={() => {
                      if (!window.confirm(`Delete ${d.name}?`)) return;
                      void act.run(async () => {
                        await p.assets.deleteDocument(d);
                        docs.reload();
                      });
                    }}
                  >
                    Delete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        docs.value && (
          <p className="note">
            Upload the warranty certificate, the manufacturer's registration confirmation, the manual or the
            site's risk assessment, so it's here when you need it.
          </p>
        )
      )}
      <div className="row">
        <select
          aria-label="What it is"
          value={kind}
          onChange={(e) => setKind(e.currentTarget.value as DocumentRow["kind"])}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {DOCUMENT_KINDS[k]}
            </option>
          ))}
        </select>
        {!p.unitId && p.units.length > 0 && kind !== "rams" && (
          <select
            aria-label="Document is for"
            value={forUnit}
            onChange={(e) => setForUnit(e.currentTarget.value)}
          >
            <option value="">Whole install</option>
            {p.units.map((u) => (
              <option key={u.id} value={u.id}>
                {unitName(u)}
              </option>
            ))}
          </select>
        )}
        <UploadButton
          busy={act.busy}
          label="Upload document"
          onFiles={(files) =>
            act.run(async () => {
              for (const f of files)
                await p.assets.uploadDocument(p.systemId, kind === "rams" ? null : forUnit || null, f, kind);
              docs.reload();
            })
          }
        />
      </div>
    </section>
  );
}

/**
 * On a job: the install's risk assessments and the job's own. Each person on the job opens them and signs to
 * say they've read them before starting; who signed and when goes on the report.
 */
export function RamsCard(p: {
  assets: Assets;
  jobId: string;
  systemId: string;
  /** The signed-in person's name, as it goes on the sign-off. */
  me: string;
  userId: string;
  done: boolean;
}) {
  const data = useLoad(() => p.assets.jobRams(p.jobId, p.systemId), [p.assets, p.jobId, p.systemId]);
  const act = useAction();
  const opener = useOpen(p.assets);
  const list = data.value ?? [];
  const todo = list.filter((r) => !r.signed.some((s) => s.user_id === p.userId));
  if (!data.value && !data.error) return null;

  return (
    <section className="card" aria-label="Risk assessments">
      <div className="row spread">
        <h2>Risk assessments</h2>
        {list.length > 0 && (
          <span className={`pill ${todo.length ? "amber" : "green"}`}>
            {todo.length ? `${todo.length} to sign` : "Signed"}
          </span>
        )}
      </div>
      <ErrorLine error={data.error || act.error || opener.error} />
      {list.length === 0 && (
        <p className="note">
          No risk assessment for this job. Upload one for this job here, or for every job at the install on
          the install's page.
        </p>
      )}
      {list.length > 0 && (
        <ul className="rows">
          {list.map(({ doc, signed }) => {
            const mine = signed.some((s) => s.user_id === p.userId);
            return (
              <li key={doc.id}>
                <button type="button" className="item" onClick={() => opener.open(doc)}>
                  <Icon name="note" size={18} />
                  <span className="main">
                    <span className="t">{doc.name}</span>
                    <span className="m">
                      {signed.length
                        ? signed.map((s) => `Signed by ${s.name}, ${time(s.signed_at)}`).join(" · ")
                        : doc.job_id
                          ? "For this job · not signed yet"
                          : "For this install · not signed yet"}
                    </span>
                  </span>
                </button>
                {!mine && !p.done && (
                  <button
                    type="button"
                    className="btn pri"
                    aria-label={`Sign ${doc.name}`}
                    disabled={act.busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Sign "${doc.name}" as ${p.me}? You're confirming you've read it and will follow it.`,
                        )
                      )
                        return;
                      void act.run(async () => {
                        await p.assets.signRams(doc.id, p.jobId, p.me);
                        data.reload();
                      });
                    }}
                  >
                    I've read it
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.length > 0 && todo.length > 0 && !p.done && (
        <p className="note">Open each one and read it, then sign before you start work.</p>
      )}
      {!p.done && (
        <div className="row">
          <UploadButton
            busy={act.busy}
            label="Add a risk assessment for this job"
            onFiles={(files) =>
              act.run(async () => {
                for (const f of files) await p.assets.uploadDocument(p.systemId, null, f, "rams", p.jobId);
                data.reload();
              })
            }
          />
        </div>
      )}
    </section>
  );
}
