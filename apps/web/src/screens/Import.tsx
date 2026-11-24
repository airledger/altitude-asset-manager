// Import (owners): bring clients, installs, units and last service dates across from a spreadsheet saved as CSV.
// Pick the file, check the columns are matched, see what will be added, import, and undo if it isn't right.
import { toCsv } from "@airledger/domain";
import { useMemo, useState } from "react";
import {
  checkRows,
  FIELDS,
  guessMapping,
  parseCsv,
  templateRows,
  type FieldKey,
  type ImportApi,
  type Mapping,
} from "../importer";
import { download } from "../stickerPdf";
import { Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { useLoad } from "./Assets";

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const when = (t: string) =>
  new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ImportPage({ imports }: { imports: ImportApi }) {
  const [file, setFile] = useState<{ name: string; headers: string[]; data: string[][] } | null>(null);
  const [map, setMap] = useState<Mapping>({});
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<{
    id: string;
    clients: number;
    systems: number;
    units: number;
    jobs: number;
  } | null>(null);
  const history = useLoad(() => imports.history(), [imports]);
  const act = useAction();
  const checked = useMemo(() => (file ? checkRows(file.data, map) : null), [file, map]);

  function pick(f: File | undefined) {
    if (!f) return;
    setResult(null);
    void act.run(async () => {
      if (/\.(xlsx?|numbers|ods)$/i.test(f.name))
        throw new Error(
          "Save the spreadsheet as CSV first: in Excel, File → Save As → CSV; in Google Sheets, File → Download → CSV.",
        );
      const rows = parseCsv(await f.text());
      if (rows.length < 2) throw new Error("That file has no rows under its headings.");
      const [headers = [], ...data] = rows;
      if (data.length > 20_000) throw new Error("That's more than 20,000 rows. Split it into smaller files.");
      setFile({ name: f.name, headers, data });
      setMap(guessMapping(headers));
    });
  }
  const start = () =>
    void act.run(async () => {
      if (!file || !checked) return;
      setDone(0);
      const r = await imports.run(file.name, checked.rows, setDone);
      setResult(r);
      setFile(null);
      history.reload();
    });
  const undo = (id: string) =>
    void act.run(async () => {
      if (!confirm("Undo this import? Everything it added is taken out again.")) return;
      await imports.undo(id);
      if (result?.id === id) setResult(null);
      history.reload();
    });

  const first = file?.data[0] ?? [];
  const sample = (at: number | undefined) => (at === undefined ? "" : (first[at] ?? ""));
  return (
    <>
      <PageHead
        back={{ href: "#/clients", label: "Clients" }}
        title="Import"
        sub="Bring your clients, installs and units across from another system or a spreadsheet."
      />
      <ErrorLine error={act.error} />
      {result && (
        <section className="card">
          <h2>Imported</h2>
          <p className="ok">
            Added {plural(result.clients, "client")}, {plural(result.systems, "install")},{" "}
            {plural(result.units, "unit")} and {plural(result.jobs, "last service", "last services")}.
          </p>
          <div className="row">
            <a className="btn pri" href="#/clients">
              See your clients
            </a>
            <button type="button" className="btn" disabled={act.busy} onClick={() => undo(result.id)}>
              Undo this import
            </button>
          </div>
        </section>
      )}
      {!file ? (
        <section className="card form">
          <h2>1. Choose your file</h2>
          <p className="note">
            One row per unit (or one per client or install if you don't have unit details). Clients and
            installs that are already in Air Ledger are matched, not added twice, and each new unit gets an
            asset label code. If a row has a last service date, the next service is worked out from it.
          </p>
          <p className="note">
            Save your spreadsheet as CSV first: in Excel, File → Save As → CSV; in Google Sheets, File →
            Download → CSV. Most job software can export clients and assets as CSV too.
          </p>
          <div className="row">
            <label className="btn pri">
              Choose a CSV file
              <input
                type="file"
                accept=".csv,text/csv,.txt"
                hidden
                aria-label="Spreadsheet to import"
                onChange={(e) => pick(e.currentTarget.files?.[0])}
              />
            </label>
            <button
              type="button"
              className="btn"
              onClick={() =>
                download(
                  new Blob([toCsv(templateRows())], { type: "text/csv" }),
                  "air-ledger-import-template.csv",
                )
              }
            >
              Download a template
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="card form">
            <h2>2. Match the columns</h2>
            <p className="note">
              {file.name}: {plural(file.data.length, "row")}. We've matched what we could. Check each one, and
              pick “Not in my file” for anything you don't have.
            </p>
            <div className="mapping">
              {FIELDS.map((f) => (
                <label key={f.key}>
                  <span>
                    {f.label}
                    {"required" in f && f.required ? " (needed)" : ""}
                  </span>
                  <select
                    value={map[f.key] ?? ""}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setMap((m) => {
                        const next: Mapping = Object.fromEntries(
                          Object.entries(m).filter(([k]) => k !== f.key),
                        );
                        if (v !== "") next[f.key as FieldKey] = Number(v);
                        return next;
                      });
                    }}
                  >
                    <option value="">Not in my file</option>
                    {file.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                  <small className="note">{sample(map[f.key]) ? `e.g. ${sample(map[f.key])}` : " "}</small>
                </label>
              ))}
            </div>
          </section>
          {checked && (
            <section className="card">
              <h2>3. Check and import</h2>
              {map.client_name === undefined ? (
                <p className="banner">Pick which column has the client's name.</p>
              ) : (
                <p>
                  {plural(checked.rows.length, "row")} ready: about {plural(checked.clients, "client")},{" "}
                  {plural(checked.systems, "install")}, {plural(checked.units, "unit")} and{" "}
                  {plural(checked.services, "last service", "last services")}. Any already in Air Ledger are
                  matched rather than added again.
                </p>
              )}
              {checked.problems.length > 0 && (
                <>
                  <p className="banner">
                    {plural(checked.problems.length, "thing")} to look at. Rows with no client name are left
                    out; other values we can't read are left blank. Fix them in your spreadsheet and choose it
                    again, or import anyway.
                  </p>
                  <ul className="plain problems">
                    {checked.problems.slice(0, 25).map((p, i) => (
                      <li key={i}>
                        Row {p.row}: {p.message}
                      </li>
                    ))}
                    {checked.problems.length > 25 && <li>…and {checked.problems.length - 25} more</li>}
                  </ul>
                </>
              )}
              <div className="row">
                <button
                  type="button"
                  className="btn pri"
                  disabled={act.busy || !checked.rows.length || map.client_name === undefined}
                  onClick={start}
                >
                  {act.busy
                    ? `Importing… ${done.toLocaleString("en-GB")} of ${checked.rows.length.toLocaleString("en-GB")}`
                    : `Import ${plural(checked.rows.length, "row")}`}
                </button>
                <button type="button" className="btn" disabled={act.busy} onClick={() => setFile(null)}>
                  Choose a different file
                </button>
              </div>
            </section>
          )}
        </>
      )}
      <section className="card">
        <h2>Past imports</h2>
        {history.value === undefined ? (
          <Loading />
        ) : !history.value.length ? (
          <p className="note">Nothing imported yet.</p>
        ) : (
          <ul className="rows">
            {history.value.map((h) => (
              <li key={h.id} className="item">
                <span className="main">
                  <span className="t">{h.file_name || "Import"}</span>
                  <span className="m">
                    {when(h.created_at)} · {plural(h.clients, "client")}, {plural(h.systems, "install")},{" "}
                    {plural(h.units, "unit")}
                    {h.undone_at ? ` · undone ${when(h.undone_at)}` : ""}
                  </span>
                </span>
                {!h.undone_at && (
                  <button type="button" className="btn" disabled={act.busy} onClick={() => undo(h.id)}>
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
