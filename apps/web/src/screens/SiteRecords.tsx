import { formatDate } from "@airledger/domain";
import { useState, type FormEvent } from "react";
import { SITE_RECORD_KINDS, type Assets, type SiteRecordRow, type UnitRow } from "../assets";
import { Area, Pick, readForm, Text } from "../fields";
import { shrinkPhoto } from "../photos";
import { ErrorLine, useAction } from "../useAction";
import { todayIso, unitTitle, useLoad } from "./Assets";

/** Notes and photos for an install, or for one unit when `unitId` is given (spec 03, site records). */
export function SiteRecords(p: {
  assets: Assets;
  systemId: string;
  units: UnitRow[];
  unitId?: string;
  author: string;
}) {
  const records = useLoad(() => p.assets.siteRecords(p.systemId), [p.assets, p.systemId]);
  const shown = (records.value ?? []).filter((r) => !p.unitId || r.unit_id === p.unitId);
  const ids = shown.flatMap((r) => r.photo_file_ids);
  const urls = useLoad(() => p.assets.photoUrls(ids), [p.assets, ids.join()]);
  const [editing, setEditing] = useState<SiteRecordRow | "new" | null>(null);
  const unitName = (id: string | null) => {
    const u = p.units.find((x) => x.id === id);
    return u ? `${unitTitle(u)} (${u.sticker_code})` : "";
  };

  return (
    <section className="card">
      <div className="row spread">
        <h2>Site records</h2>
        {!editing && (
          <button className="btn pri" onClick={() => setEditing("new")}>
            Add note or photos
          </button>
        )}
      </div>
      <ErrorLine error={records.error} />
      {editing && (
        <RecordForm
          {...p}
          record={editing === "new" ? null : editing}
          done={() => {
            setEditing(null);
            records.reload();
          }}
          cancel={() => setEditing(null)}
        />
      )}
      {records.value && shown.length === 0 && !editing && (
        <p className="note">Nothing yet. Add notes and photos at install so they're here at every service.</p>
      )}
      <ul className="list records">
        {shown.map((r) => (
          <li key={r.id} className="record">
            <div className="item">
              <b>
                {r.kind} · {formatDate(r.date)}
              </b>
              <span className="note">
                {[r.author, !p.unitId && unitName(r.unit_id)].filter(Boolean).join(" · ")}
              </span>
              {r.text && <p className="pre">{r.text}</p>}
              {r.photo_file_ids.length > 0 && (
                <div className="thumbs">
                  {r.photo_file_ids.map((f) =>
                    urls.value?.[f] ? (
                      <a key={f} href={urls.value[f]} target="_blank" rel="noreferrer">
                        <img src={urls.value[f]} alt={`Photo from ${formatDate(r.date)}`} />
                      </a>
                    ) : (
                      <span key={f} className="thumb-wait" />
                    ),
                  )}
                </div>
              )}
            </div>
            <button className="btn" onClick={() => setEditing(r)}>
              Edit
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecordForm(p: {
  assets: Assets;
  systemId: string;
  units: UnitRow[];
  unitId?: string;
  author: string;
  record: SiteRecordRow | null;
  done: () => void;
  cancel: () => void;
}) {
  const r = p.record;
  const [kept, setKept] = useState<string[]>(r?.photo_file_ids ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const { busy, error, setError, run } = useAction();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    const text = f.text("text");
    if (!text && !kept.length && !files.length) return setError("Add some notes or at least one photo.");
    void run(async () => {
      const uploaded: string[] = [];
      for (const file of files) uploaded.push(await p.assets.uploadPhoto(await shrinkPhoto(file)));
      await p.assets.saveSiteRecord({
        id: r?.id,
        system_id: p.systemId,
        unit_id: f.orNull("unit_id"),
        kind: f.text("kind"),
        date: f.text("date") || todayIso(),
        author: f.text("author"),
        text,
        photo_file_ids: [...kept, ...uploaded],
      });
      p.done();
    });
  }

  return (
    <form className="subform" onSubmit={submit}>
      <h2>{r ? "Edit record" : "New record"}</h2>
      <ErrorLine error={error} />
      <Pick name="kind" label="Type" value={r?.kind ?? "Site note"} options={SITE_RECORD_KINDS} />
      <label>
        Unit
        <select name="unit_id" defaultValue={r ? (r.unit_id ?? "") : (p.unitId ?? "")}>
          <option value="">Whole install</option>
          {p.units.map((u) => (
            <option key={u.id} value={u.id}>
              {unitTitle(u)} ({u.sticker_code})
            </option>
          ))}
        </select>
      </label>
      <Text name="date" label="Date" type="date" value={r?.date ?? todayIso()} />
      <Text name="author" label="By" value={r?.author ?? p.author} />
      <Area name="text" label="Notes" value={r?.text} />
      {kept.length > 0 && (
        <p className="note">
          {kept.length} photo{kept.length === 1 ? "" : "s"} saved.{" "}
          <button type="button" className="link" onClick={() => setKept([])}>
            Remove them
          </button>
        </p>
      )}
      <label className="btn">
        {files.length ? `${files.length} photo${files.length === 1 ? "" : "s"} to add` : "Add photos"}
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="Photos"
          onChange={(e) => setFiles([...files, ...Array.from(e.currentTarget.files ?? [])])}
        />
      </label>
      <div className="row">
        <button className="btn pri" type="submit" disabled={busy}>
          {busy ? (files.length ? "Uploading photos…" : "Saving…") : "Save"}
        </button>
        <button className="btn" type="button" onClick={p.cancel}>
          Cancel
        </button>
        {r && (
          <button
            className="btn danger"
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm("Delete this record?"))
                void run(async () => {
                  await p.assets.deleteSiteRecord(r.id);
                  p.done();
                });
            }}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
