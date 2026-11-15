// Warranty documents (and later risk assessments) uploaded against an install or one of its units: the original
// warranty certificate, the manufacturer's registration confirmation, manuals. PDFs or photos.
import { formatDate } from "@airledger/domain";
import { useRef, useState } from "react";
import type { Assets, DocumentRow, UnitRow } from "../assets";
import { Icon } from "../icons";
import { ErrorLine, useAction } from "../useAction";
import { useLoad } from "./Assets";

const unitName = (u: UnitRow) =>
  [`#${u.asset_no}`, u.role === "outdoor" ? "Outdoor" : u.indoor_type || "Indoor", u.location]
    .filter(Boolean)
    .join(" · ");

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [forUnit, setForUnit] = useState(p.unitId ?? "");
  const shown = (docs.value ?? []).filter((d) => !p.unitId || d.unit_id === p.unitId);
  const units = new Map(p.units.map((u) => [u.id, u]));

  const upload = (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    void act.run(async () => {
      for (const f of list) await p.assets.uploadDocument(p.systemId, forUnit || null, f, "warranty");
      if (fileRef.current) fileRef.current.value = "";
      docs.reload();
    });
  };
  const open = (d: DocumentRow) => {
    // Open the tab straight away (phones block a tab opened after waiting), then point it at the file.
    const win = window.open("", "_blank");
    void act.run(async () => {
      const url = await p.assets.documentUrl(d.file_id);
      if (win) win.location.href = url;
      else window.location.assign(url);
    });
  };

  return (
    <section className="card" aria-label="Warranty documents">
      <h2>Warranty documents</h2>
      <ErrorLine error={docs.error || act.error} />
      {shown.length > 0 ? (
        <ul className="rows">
          {shown.map((d) => {
            const u = d.unit_id ? units.get(d.unit_id) : undefined;
            return (
              <li key={d.id}>
                <button type="button" className="item" onClick={() => open(d)}>
                  <Icon name="note" size={18} />
                  <span className="main">
                    <span className="t">{d.name}</span>
                    <span className="m">
                      {[
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
            Upload the warranty certificate, the manufacturer's registration confirmation or the manual, so
            it's here when you need it.
          </p>
        )
      )}
      <div className="row">
        {!p.unitId && p.units.length > 0 && (
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
        <label className="btn">
          <Icon name="plus" size={18} />
          {act.busy ? "Uploading…" : "Upload document"}
          <input
            ref={fileRef}
            type="file"
            hidden
            aria-label="Upload document"
            accept="application/pdf,image/*"
            multiple
            disabled={act.busy}
            onChange={(e) => upload(e.currentTarget.files)}
          />
        </label>
      </div>
    </section>
  );
}
