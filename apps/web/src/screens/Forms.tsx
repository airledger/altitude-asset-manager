// Forms and checklists: filled in on the job (FormsCard), and set up by owners (FormsPage, #/forms).
import { JOB_TYPES } from "@airledger/domain";
import { useState } from "react";
import {
  CHECK_ANSWERS,
  KIND_LABEL,
  missingAnswers,
  newFieldId,
  readyMade,
  type FieldKind,
  type FormField,
  type FormsApi,
  type FormTemplate,
  type JobForm,
} from "../forms";
import { enqueue, sendOrSave } from "../outbox";
import { Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { useLoad } from "./Assets";

const stamp = (t: string) =>
  new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** On the job: the forms for its type, to fill in. Saves with no signal too. */
export function FormsCard(p: {
  forms: FormsApi;
  orgId: string;
  label: string;
  /** The job's forms, already worked out (saved, waiting to send and not yet started). */
  list: JobForm[];
  required: string[];
  me: string;
  saved: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!p.list.length) return null;
  const key = (f: JobForm) => f.template_id ?? f.id ?? f.name;
  return (
    <section className="card" aria-label="Forms and checklists">
      <h2>Forms and checklists</h2>
      <ul className="rows">
        {p.list.map((f) => (
          <li key={key(f)}>
            {open === key(f) ? (
              <FillForm
                form={f}
                forms={p.forms}
                orgId={p.orgId}
                label={p.label}
                me={p.me}
                close={() => setOpen(null)}
                saved={() => {
                  setOpen(null);
                  p.saved();
                }}
              />
            ) : (
              <div className="item">
                <span className="main">
                  <span className="t">{f.name}</span>
                  <span className="m">
                    {f.completed_at
                      ? `Done by ${f.completed_by || "someone"}, ${stamp(f.completed_at)}`
                      : Object.keys(f.answers).length
                        ? "Started"
                        : p.required.includes(f.name)
                          ? "Needed before the job is completed"
                          : "Not started"}
                  </span>
                </span>
                <span
                  className={`pill${f.completed_at ? " green" : p.required.includes(f.name) ? " amber" : ""}`}
                >
                  {f.completed_at ? "Done" : "To do"}
                </span>
                <button type="button" className="btn" onClick={() => setOpen(key(f))}>
                  {f.completed_at ? "View or change" : "Fill in"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FillForm(p: {
  form: JobForm;
  forms: FormsApi;
  orgId: string;
  label: string;
  me: string;
  close: () => void;
  saved: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(p.form.answers);
  const { busy, error, run } = useAction();
  const set = (id: string, v: string) => setAnswers((a) => ({ ...a, [id]: v }));
  const save = (done: boolean) =>
    void run(async () => {
      const form: JobForm = {
        ...p.form,
        answers,
        completed_at: done ? new Date().toISOString() : p.form.completed_at,
        completed_by: done ? p.me : p.form.completed_by,
      };
      if (done) {
        const missing = missingAnswers(form);
        if (missing.length) throw new Error(`Still to answer: ${missing.map((m) => m.label).join(", ")}`);
      }
      await sendOrSave(
        () => p.forms.saveForJob(form),
        () => enqueue({ kind: "form", orgId: p.orgId, label: `${p.form.name} · ${p.label}`, form }),
      );
      p.saved();
    });
  return (
    <form
      className="form fill"
      aria-label={p.form.name}
      onSubmit={(e) => {
        e.preventDefault();
        save(true);
      }}
    >
      <h3>{p.form.name}</h3>
      {p.form.fields.map((f) => (
        <Question key={f.id} field={f} value={answers[f.id] ?? ""} set={(v) => set(f.id, v)} />
      ))}
      <ErrorLine error={error} />
      <div className="row">
        <button className="btn pri" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Done"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => save(false)}>
          Save for later
        </button>
        <button type="button" className="btn" disabled={busy} onClick={p.close}>
          Close
        </button>
      </div>
    </form>
  );
}

function Question({ field: f, value, set }: { field: FormField; value: string; set: (v: string) => void }) {
  const label = `${f.label}${f.required ? " *" : ""}`;
  if (f.kind === "heading") return <h4 className="form-heading">{f.label}</h4>;
  if (f.kind === "check" || f.kind === "yesno") {
    const opts: [string, string][] =
      f.kind === "check"
        ? Object.entries(CHECK_ANSWERS)
        : [
            ["yes", "Yes"],
            ["no", "No"],
          ];
    return (
      <fieldset className="plain answer">
        <legend>{label}</legend>
        <div className="chips" role="radiogroup" aria-label={f.label}>
          {opts.map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={value === v}
              className={`chip${value === v && v === "fail" ? " bad" : ""}`}
              onClick={() => set(value === v ? "" : v)}
            >
              {l}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }
  if (f.kind === "number")
    return (
      <label>
        {label}
        <span className="with-unit">
          <input
            inputMode="decimal"
            aria-label={f.label}
            value={value}
            onChange={(e) => set(e.currentTarget.value)}
          />
          {f.unit && <span>{f.unit}</span>}
        </span>
      </label>
    );
  if (f.kind === "choice")
    return (
      <label>
        {label}
        <select value={value} onChange={(e) => set(e.currentTarget.value)}>
          <option value="">Choose…</option>
          {(f.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  return (
    <label>
      {label}
      <textarea rows={2} value={value} onChange={(e) => set(e.currentTarget.value)} />
    </label>
  );
}

// ---------- owners: setting forms up ----------

export function FormsPage({ forms }: { forms: FormsApi }) {
  const list = useLoad(() => forms.templates(), [forms]);
  const [editing, setEditing] = useState<(Omit<FormTemplate, "id"> & { id?: string }) | null>(null);
  const act = useAction();
  const addReady = () =>
    void act.run(async () => {
      const have = new Set((list.value ?? []).map((t) => t.name));
      for (const t of readyMade()) if (!have.has(t.name)) await forms.saveTemplate(t);
      list.reload();
    });

  if (editing)
    return (
      <EditForm
        forms={forms}
        start={editing}
        done={() => {
          setEditing(null);
          list.reload();
        }}
      />
    );
  return (
    <>
      <PageHead
        back={{ href: "#/business", label: "Business" }}
        title="Forms and checklists"
        sub="Filled in by engineers on the job, and printed on the service report."
      >
        <button
          type="button"
          className="btn pri"
          onClick={() => setEditing({ name: "", job_types: [], required: false, active: true, fields: [] })}
        >
          New form
        </button>
      </PageHead>
      <section className="card">
        <ErrorLine error={act.error || list.error} />
        {!list.value ? (
          <Loading />
        ) : (
          <>
            {list.value.length > 0 && (
              <ul className="rows">
                {list.value.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="item" onClick={() => setEditing(t)}>
                      <span className="main">
                        <span className="t">{t.name}</span>
                        <span className="m">
                          {[
                            t.job_types.length ? t.job_types.join(", ") : "Every job",
                            `${t.fields.filter((f) => f.kind !== "heading").length} questions`,
                            t.required ? "needed before completing" : "",
                            t.active ? "" : "switched off",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {readyMade().some((r) => !list.value?.some((t) => t.name === r.name)) && (
              <p>
                <button type="button" className="btn" disabled={act.busy} onClick={addReady}>
                  Add ready-made forms (service, commissioning, breakdown)
                </button>
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}

function EditForm(p: {
  forms: FormsApi;
  start: Omit<FormTemplate, "id"> & { id?: string };
  done: () => void;
}) {
  const [t, setT] = useState(p.start);
  const { busy, error, run } = useAction();
  const setField = (i: number, patch: Partial<FormField>) =>
    setT((x) => ({ ...x, fields: x.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const move = (i: number, by: number) =>
    setT((x) => {
      const fields = [...x.fields];
      const [f] = fields.splice(i, 1);
      if (f) fields.splice(Math.max(0, Math.min(fields.length, i + by)), 0, f);
      return { ...x, fields };
    });
  const save = () =>
    void run(async () => {
      if (!t.name.trim()) throw new Error("Give the form a name.");
      if (!t.fields.some((f) => f.kind !== "heading")) throw new Error("Add at least one question.");
      if (t.fields.some((f) => !f.label.trim())) throw new Error("Every question needs its wording.");
      await p.forms.saveTemplate({ ...t, fields: t.fields.map((f) => ({ ...f, label: f.label.trim() })) });
      p.done();
    });
  const remove = () =>
    void run(async () => {
      if (!t.id || !confirm(`Delete “${t.name}”? Forms already filled in on jobs are kept.`)) return;
      await p.forms.deleteTemplate(t.id);
      p.done();
    });
  return (
    <>
      <PageHead back={{ href: "#/forms", label: "Forms" }} title={t.id ? t.name || "Form" : "New form"} />
      <section className="card form">
        <label>
          Name
          <input value={t.name} onChange={(e) => setT({ ...t, name: e.currentTarget.value })} />
        </label>
        <fieldset className="plain">
          <legend>Used on (none ticked: every job)</legend>
          <div className="chips">
            {JOB_TYPES.map((type) => (
              <label key={type} className="check">
                <input
                  type="checkbox"
                  checked={t.job_types.includes(type)}
                  onChange={(e) =>
                    setT({
                      ...t,
                      job_types: e.currentTarget.checked
                        ? [...t.job_types, type]
                        : t.job_types.filter((x) => x !== type),
                    })
                  }
                />
                {type}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="check">
          <input
            type="checkbox"
            checked={t.required}
            onChange={(e) => setT({ ...t, required: e.currentTarget.checked })}
          />
          Must be done before the job can be completed
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={t.active}
            onChange={(e) => setT({ ...t, active: e.currentTarget.checked })}
          />
          In use
        </label>
        <h3>Questions</h3>
        <ol className="form-fields">
          {t.fields.map((f, i) => (
            <li key={f.id}>
              <div className="grid2">
                <label>
                  Question {i + 1}
                  <input value={f.label} onChange={(e) => setField(i, { label: e.currentTarget.value })} />
                </label>
                <label>
                  Answer
                  <select
                    value={f.kind}
                    onChange={(e) => setField(i, { kind: e.currentTarget.value as FieldKind })}
                  >
                    {(Object.keys(KIND_LABEL) as FieldKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {f.kind === "number" && (
                <label>
                  Unit (optional)
                  <input
                    value={f.unit ?? ""}
                    onChange={(e) => setField(i, { unit: e.currentTarget.value })}
                  />
                </label>
              )}
              {f.kind === "choice" && (
                <label>
                  Choices, separated by commas
                  <input
                    value={(f.options ?? []).join(", ")}
                    onChange={(e) =>
                      setField(i, {
                        options: e.currentTarget.value
                          .split(",")
                          .map((o) => o.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              )}
              <div className="row">
                {f.kind !== "heading" && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!f.required}
                      onChange={(e) => setField(i, { required: e.currentTarget.checked })}
                    />
                    Must be answered
                  </label>
                )}
                <button
                  type="button"
                  className="btn"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Move question ${i + 1} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={i === t.fields.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move question ${i + 1} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setT({ ...t, fields: t.fields.filter((_, j) => j !== i) })}
                  aria-label={`Remove question ${i + 1}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
        <p>
          <button
            type="button"
            className="btn"
            onClick={() =>
              setT({ ...t, fields: [...t.fields, { id: newFieldId(), kind: "check", label: "" }] })
            }
          >
            Add a question
          </button>
        </p>
        <ErrorLine error={error} />
        <div className="row">
          <button type="button" className="btn pri" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save form"}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={p.done}>
            Cancel
          </button>
          {t.id && (
            <button type="button" className="btn" disabled={busy} onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </section>
    </>
  );
}
