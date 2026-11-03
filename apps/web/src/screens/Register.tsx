// The asset register: every unit the business looks after, numbered, with its install, client,
// refrigerant, F-gas figures and when it's next due. Filter by client or refrigerant; download as CSV or PDF.
import { formatDate, formatUk, toCsv } from "@airledger/domain";
import { useState } from "react";
import type { Business } from "../api";
import type { Assets, UnitRow } from "../assets";
import { Icon } from "../icons";
import type { JobsApi } from "../jobs";
import { loadOverview, type SiteView } from "../overview";
import { download } from "../stickerPdf";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { todayIso, useLoad } from "./Assets";

export interface RegisterRow {
  unit: UnitRow;
  site: SiteView;
}

const typeOf = (u: UnitRow) => (u.role === "outdoor" ? "Outdoor unit" : u.indoor_type || "Indoor unit");
const co2 = (s: SiteView) => (s.info.fgas.tonnesCo2e ? s.info.fgas.tonnesCo2e.toFixed(2) : "");

/** Rows for the CSV, header first. F-gas figures are per install (the system's refrigerant circuit). */
export function registerCsvRows(rows: RegisterRow[]): string[][] {
  return [
    [
      "Asset no",
      "Label",
      "Client",
      "Install",
      "Site",
      "Postcode",
      "Unit",
      "Location",
      "Manufacturer",
      "Model",
      "Serial",
      "Refrigerant",
      "Charge kg",
      "Tonnes CO2e",
      "Leak check every (months)",
      "Installed",
      "Last service",
      "Next service due",
      "Next leak check",
    ],
    ...rows.map(({ unit: u, site: s }) => [
      String(u.asset_no),
      u.sticker_code,
      s.client?.name ?? "",
      s.system.name,
      s.system.site_address,
      s.system.site_postcode,
      typeOf(u),
      u.location,
      u.manufacturer,
      u.model,
      u.serial,
      s.system.refrigerant,
      s.info.fgas.kg ? String(s.info.fgas.kg) : "",
      co2(s),
      s.info.fgas.required ? String(s.info.fgas.months) : "",
      formatUk(s.system.install_date),
      formatUk(s.info.lastService),
      formatUk(s.info.nextDue),
      formatUk(s.info.nextLeakCheck),
    ]),
  ];
}

export function RegisterPage(p: { assets: Assets; jobs: JobsApi; business: Business }) {
  const data = useLoad(() => loadOverview(p.assets, p.jobs, todayIso()), [p.assets, p.jobs]);
  const [client, setClient] = useState("");
  const [gas, setGas] = useState("");
  const [q, setQ] = useState("");
  const act = useAction();
  const all: RegisterRow[] = (data.value?.sites ?? [])
    .flatMap((site) => site.units.map((unit) => ({ unit, site })))
    .sort((a, b) => a.unit.asset_no - b.unit.asset_no);
  const needle = q.trim().toLowerCase();
  const rows = all.filter(
    ({ unit: u, site: s }) =>
      (!client || s.system.client_id === client) &&
      (!gas || s.system.refrigerant === gas) &&
      (!needle ||
        [u.sticker_code, u.manufacturer, u.model, u.serial, u.location, s.system.name, s.system.site_postcode]
          .join(" ")
          .toLowerCase()
          .includes(needle)),
  );
  const clients = [
    ...new Map(all.map((r) => [r.site.system.client_id, r.site.client?.name ?? ""])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const gases = [...new Set(all.map((r) => r.site.system.refrigerant).filter(Boolean))].sort();
  const sites = new Set(rows.map((r) => r.site.system.id));
  const tonnes = [...sites].reduce(
    (t, id) => t + (rows.find((r) => r.site.system.id === id)?.site.info.fgas.tonnesCo2e ?? 0),
    0,
  );
  const scope = client ? (clients.find(([id]) => id === client)?.[1] ?? "") : "";
  const file = `asset-register${scope ? `-${scope.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""}-${todayIso()}`;

  return (
    <>
      <PageHead
        back={{ href: "#/clients", label: "Clients" }}
        title="Asset register"
        sub="Every unit you look after, with its F-gas figures and when it's due."
      />
      <div className="kpis three">
        <div className="kpi">
          <span className="kpi-n">{data.value ? rows.length : "–"}</span>
          <span className="kpi-l">Assets</span>
        </div>
        <div className="kpi">
          <span className="kpi-n">{data.value ? sites.size : "–"}</span>
          <span className="kpi-l">Installs</span>
        </div>
        <div className="kpi">
          <span className="kpi-n">{data.value ? tonnes.toFixed(1) : "–"}</span>
          <span className="kpi-l">Tonnes CO₂e</span>
        </div>
      </div>
      <section className="card">
        <div className="grid2 filters">
          <label>
            Client
            <select value={client} onChange={(e) => setClient(e.currentTarget.value)}>
              <option value="">All clients</option>
              {clients.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
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
        <input
          type="search"
          className="search"
          aria-label="Search assets"
          placeholder="Search label, make, model, serial, location or postcode"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <div className="row">
          <button
            className="btn"
            disabled={!rows.length}
            onClick={() =>
              download(new Blob([toCsv(registerCsvRows(rows))], { type: "text/csv" }), `${file}.csv`)
            }
          >
            <Icon name="download" size={18} />
            Download CSV
          </button>
          <button
            className="btn"
            disabled={!rows.length || act.busy}
            onClick={() =>
              void act.run(async () => {
                const { registerPdf } = await import("../registerPdf");
                download(await registerPdf(rows, p.business.name, scope), `${file}.pdf`);
              })
            }
          >
            <Icon name="download" size={18} />
            {act.busy ? "Making PDF…" : "Download PDF"}
          </button>
        </div>
        <ErrorLine error={data.error || act.error} />
        {!data.value ? (
          <Loading />
        ) : !rows.length ? (
          <Empty icon="sticker" title="No assets here">
            Units show here once they're added to an install.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table className="table register">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Unit</th>
                  <th>Client and install</th>
                  <th>Make and model</th>
                  <th>Refrigerant</th>
                  <th>CO₂e t</th>
                  <th>Next due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ unit: u, site: s }) => (
                  <tr key={u.id}>
                    <td>
                      <a href={`#/u/${u.sticker_code}`}>#{u.asset_no}</a>
                    </td>
                    <td>
                      {typeOf(u)}
                      <div className="note">{[u.location, u.sticker_code].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td>
                      <a href={`#/system/${s.system.id}`}>{s.client?.name ?? ""}</a>
                      <div className="note">
                        {[s.system.name, s.system.site_postcode].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td>
                      {[u.manufacturer, u.model].filter(Boolean).join(" ")}
                      {u.serial && <div className="note">S/N {u.serial}</div>}
                    </td>
                    <td>
                      {s.system.refrigerant}
                      {s.info.fgas.kg ? <div className="note">{s.info.fgas.kg} kg</div> : null}
                    </td>
                    <td>{co2(s)}</td>
                    <td>
                      {s.info.nextDue ? formatDate(s.info.nextDue) : "–"}
                      {s.info.nextLeakCheck && (
                        <div className="note">Leak check {formatDate(s.info.nextLeakCheck)}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
