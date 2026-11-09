// Refrigerant log: the business's cylinders with what's left in each, and every kilo charged and recovered on
// jobs over a period, with totals by refrigerant and a CSV for the F-gas records.
import { REFRIGERANT_GWP, formatDate, toCsv } from "@airledger/domain";
import { useState, type FormEvent } from "react";
import { Pick, Text, readForm } from "../fields";
import { Icon } from "../icons";
import {
  KIND_LABEL,
  STATUS_LABEL,
  contents,
  fullness,
  levelText,
  logCsvRows,
  totals,
  type Cylinder,
  type CylinderKind,
  type RefrigerantApi,
} from "../refrigerant";
import { download } from "../stickerPdf";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { todayIso, useLoad } from "./Assets";

const GASES = [...Object.keys(REFRIGERANT_GWP), "Other"];

export function RefrigerantPage(p: { refrigerant: RefrigerantApi; owner: boolean }) {
  const cylinders = useLoad(() => p.refrigerant.cylinders(), [p.refrigerant]);
  const today = todayIso();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const log = useLoad(() => p.refrigerant.log(from, to), [p.refrigerant, from, to]);
  const [gas, setGas] = useState("");
  const [editing, setEditing] = useState<"new" | Cylinder | null>(null);
  const [showAll, setShowAll] = useState(false);
  const act = useAction();

  const all = cylinders.value ?? [];
  const shown = showAll ? all : all.filter((c) => c.status === "in_use");
  const code = new Map(all.map((c) => [c.id, c.code || "No number"]));
  const rows = (log.value ?? []).filter((r) => !gas || r.refrigerant === gas);
  const sums = totals(rows);
  const charged = sums.reduce((t, s) => t + s.added, 0);
  const recovered = sums.reduce((t, s) => t + s.recovered, 0);
  const tonnes = sums.reduce((t, s) => t + (s.tonnes ?? 0), 0);
  const gases = [...new Set((log.value ?? []).map((r) => r.refrigerant).filter(Boolean))].sort();
  const reload = () => (cylinders.reload(), log.reload());

  return (
    <>
      <PageHead
        back={{ href: "#/jobs", label: "Jobs" }}
        title="Refrigerant"
        sub="Your cylinders, and every kilo charged and recovered on jobs."
      >
        <button className="btn pri" onClick={() => setEditing("new")}>
          <Icon name="plus" size={18} />
          Add a cylinder
        </button>
      </PageHead>

      {editing && (
        <CylinderForm
          refrigerant={p.refrigerant}
          cylinder={editing === "new" ? null : editing}
          done={() => (setEditing(null), reload())}
          cancel={() => setEditing(null)}
        />
      )}

      <section className="card" aria-label="Cylinders">
        <div className="row spread">
          <h2>Cylinders</h2>
          <label className="check">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.currentTarget.checked)} />
            Show empty and returned
          </label>
        </div>
        <ErrorLine error={cylinders.error || act.error} />
        {!cylinders.value ? (
          <Loading />
        ) : !shown.length ? (
          <Empty icon="jobs" title={all.length ? "No cylinders in use" : "No cylinders yet"}>
            Add the cylinders your engineers carry. When they complete a job they pick which one the gas came
            from or went into, and this keeps the running total.
          </Empty>
        ) : (
          <ul className="rows">
            {shown.map((c) => (
              <li key={c.id}>
                <div className="item">
                  <span className="main">
                    <span className="t">
                      {c.code || "No number"} · {c.refrigerant}{" "}
                      <span className={`pill${c.kind === "recovery" ? " amber" : ""}`}>
                        {KIND_LABEL[c.kind]}
                      </span>
                      {c.status !== "in_use" && <span className="pill">{STATUS_LABEL[c.status]}</span>}
                    </span>
                    <span className="m">
                      {[
                        levelText(c),
                        c.holder && `with ${c.holder}`,
                        c.supplier,
                        c.status === "returned" && c.returned_on
                          ? `returned ${formatDate(c.returned_on)}`
                          : `since ${formatDate(c.received_on)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span
                      className="meter"
                      role="meter"
                      aria-label={`${c.code} level`}
                      aria-valuemin={0}
                      aria-valuemax={c.size_kg}
                      aria-valuenow={contents(c)}
                    >
                      <span style={{ width: `${Math.round(fullness(c) * 100)}%` }} />
                    </span>
                  </span>
                </div>
                <div className="row">
                  <button className="btn" onClick={() => setEditing(c)}>
                    Edit
                  </button>
                  {c.status === "in_use" ? (
                    <>
                      {c.kind === "new" && (
                        <button
                          className="btn"
                          disabled={act.busy}
                          onClick={() =>
                            void act.run(async () => (await p.refrigerant.setStatus(c.id, "empty"), reload()))
                          }
                        >
                          Empty
                        </button>
                      )}
                      <button
                        className="btn"
                        disabled={act.busy}
                        onClick={() =>
                          void act.run(
                            async () => (
                              await p.refrigerant.setStatus(c.id, "returned", todayIso()),
                              reload()
                            ),
                          )
                        }
                      >
                        Returned to supplier
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn"
                      disabled={act.busy}
                      onClick={() =>
                        void act.run(async () => (await p.refrigerant.setStatus(c.id, "in_use"), reload()))
                      }
                    >
                      Back in use
                    </button>
                  )}
                  {p.owner && (
                    <button
                      className="btn"
                      disabled={act.busy}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Delete cylinder ${c.code || ""}? Jobs that used it keep their kilos.`,
                          )
                        )
                          return;
                        void act.run(async () => (await p.refrigerant.remove(c.id), reload()));
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-label="Refrigerant log">
        <h2>Log</h2>
        <div className="grid2 filters">
          <label>
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.currentTarget.value || from)}
            />
          </label>
          <label>
            To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.currentTarget.value || to)} />
          </label>
          <label>
            Refrigerant
            <select value={gas} onChange={(e) => setGas(e.currentTarget.value)}>
              <option value="">All</option>
              {gases.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="kpis three">
          <div className="kpi">
            <span className="kpi-n">{log.value ? round1(charged) : "–"}</span>
            <span className="kpi-l">kg charged</span>
          </div>
          <div className="kpi">
            <span className="kpi-n">{log.value ? round1(recovered) : "–"}</span>
            <span className="kpi-l">kg recovered</span>
          </div>
          <div className="kpi">
            <span className="kpi-n">{log.value ? tonnes.toFixed(2) : "–"}</span>
            <span className="kpi-l">Tonnes CO₂e charged</span>
          </div>
        </div>
        <ErrorLine error={log.error} />
        {sums.length > 1 && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Refrigerant</th>
                  <th>Charged kg</th>
                  <th>Recovered kg</th>
                  <th>CO₂e t</th>
                </tr>
              </thead>
              <tbody>
                {sums.map((s) => (
                  <tr key={s.refrigerant}>
                    <td>{s.refrigerant}</td>
                    <td>{s.added}</td>
                    <td>{s.recovered}</td>
                    <td>{s.tonnes == null ? "" : s.tonnes.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row">
          <button
            className="btn"
            disabled={!rows.length}
            onClick={() =>
              download(
                new Blob([toCsv(logCsvRows(rows, all))], { type: "text/csv" }),
                `refrigerant-log-${from}-to-${to}.csv`,
              )
            }
          >
            <Icon name="download" size={18} />
            Download CSV
          </button>
        </div>
        {!log.value ? (
          !log.error && <Loading />
        ) : !rows.length ? (
          <Empty icon="jobs" title="Nothing charged or recovered">
            Gas added or recovered on a completed job shows here.
          </Empty>
        ) : (
          <ul className="rows">
            {[...rows].reverse().map((r, i) => (
              <li key={r.job_id + r.kind + i}>
                <a className="item" href={`#/job/${r.job_id}`}>
                  <span className="main">
                    <span className="t">
                      {r.kind === "added" ? "Charged" : "Recovered"} {r.kg} kg {r.refrigerant}
                    </span>
                    <span className="m">
                      {[
                        r.date && formatDate(r.date),
                        r.client_name,
                        r.system_name,
                        r.engineer,
                        r.cylinder_id ? `cylinder ${code.get(r.cylinder_id) ?? ""}` : "no cylinder picked",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

const round1 = (n: number) => Math.round(n * 100) / 100;

function CylinderForm(p: {
  refrigerant: RefrigerantApi;
  cylinder: Cylinder | null;
  done: () => void;
  cancel: () => void;
}) {
  const c = p.cylinder;
  const act = useAction();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    const size = f.num("size_kg");
    void act.run(async () => {
      if (!size || size <= 0) throw new Error("Enter the cylinder's size in kg.");
      await p.refrigerant.save(
        {
          code: f.text("code"),
          refrigerant: f.text("gas") === "Other" ? f.text("other") || "Other" : f.text("gas"),
          kind: (f.text("kind") === "recovery" ? "recovery" : "new") as CylinderKind,
          size_kg: size,
          supplier: f.text("supplier"),
          holder: f.text("holder"),
          received_on: f.text("received_on") || todayIso(),
          notes: f.text("notes"),
        },
        c?.id,
      );
      p.done();
    });
  }
  const known = !c || GASES.includes(c.refrigerant);
  return (
    <form className="card form" onSubmit={submit} aria-label="Cylinder">
      <h2>{c ? "Edit cylinder" : "Add a cylinder"}</h2>
      <ErrorLine error={act.error} />
      <div className="grid2">
        <Text name="code" label="Cylinder number" value={c?.code} />
        <Pick
          name="kind"
          label="Type"
          value={c?.kind ?? "new"}
          options={["new", "recovery"]}
          labels={KIND_LABEL}
        />
        <Pick
          name="gas"
          label="Refrigerant"
          value={known ? (c?.refrigerant ?? "R32") : "Other"}
          options={GASES}
        />
        <Text name="other" label="If other, which" value={known ? "" : c?.refrigerant} />
        <Text name="size_kg" label="Size (kg)" type="number" value={c?.size_kg} required />
        <Text name="supplier" label="Supplier" value={c?.supplier} />
        <Text name="holder" label="Who has it" value={c?.holder} />
        <Text name="received_on" label="Received" type="date" value={c?.received_on ?? todayIso()} />
      </div>
      <Text name="notes" label="Notes" value={c?.notes} />
      <div className="row">
        <button className="btn pri" type="submit" disabled={act.busy}>
          {c ? "Save" : "Add cylinder"}
        </button>
        <button type="button" className="btn" onClick={p.cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
