// Orders (spec F11): the parts every booked job in the next week, fortnight, month or two will need,
// added up and split by supplier, ready to copy into an email or download. Marking them ordered freezes
// each job's parts list.
import { formatDate, toCsv, type MaterialLine } from "@airledger/domain";
import type { Assets } from "../assets";
import { Icon } from "../icons";
import { toPart, type JobsApi } from "../jobs";
import { bySupplier, jobsToOrder, loadOverview } from "../overview";
import { download } from "../stickerPdf";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { go, todayIso, useLoad } from "./Assets";

const RANGES = [7, 14, 30, 60] as const;

const lineText = (l: MaterialLine) => `${l.qty} × ${l.name}${l.sku ? ` (${l.sku})` : ""}`;

export function OrdersPage(p: { assets: Assets; jobs: JobsApi; query: URLSearchParams }) {
  const data = useLoad(() => loadOverview(p.assets, p.jobs, todayIso()), [p.assets, p.jobs]);
  const days = RANGES.find((d) => String(d) === p.query.get("days")) ?? 14;
  const act = useAction();
  const list = data.value ? jobsToOrder(data.value, days) : [];
  const suppliers = bySupplier(list);

  function csv() {
    const rows = [["Supplier", "Code", "Item", "Quantity"]];
    for (const [s, lines] of suppliers)
      for (const l of lines) rows.push([s, l.sku ?? "", l.name, String(l.qty)]);
    download(new Blob([toCsv(rows)], { type: "text/csv" }), `parts-order-${todayIso()}.csv`);
  }
  function markAll() {
    if (!confirm(`Mark the parts for ${list.length} job${list.length === 1 ? "" : "s"} as ordered?`)) return;
    void act.run(async () => {
      for (const x of list) await p.jobs.markPartsOrdered(x.job.id, x.lines.map(toPart));
      data.reload();
    });
  }

  return (
    <>
      <PageHead
        back={{ href: "#/jobs", label: "Jobs" }}
        title="Parts to order"
        sub="For booked jobs whose parts aren't ordered yet."
      />
      <section className="card">
        <div className="chips" role="group" aria-label="Jobs in the next">
          {RANGES.map((d) => (
            <button
              key={d}
              className="chip"
              aria-pressed={d === days}
              onClick={() => go(`#/orders?days=${d}`)}
            >
              {d} days
            </button>
          ))}
        </div>
        <ErrorLine error={data.error || act.error} />
        {!data.value ? (
          <Loading />
        ) : !list.length ? (
          <Empty icon="check" title="Nothing to order">
            No booked jobs in the next {days} days need parts that aren't ordered yet.
          </Empty>
        ) : (
          <div className="row">
            <button className="btn" onClick={csv}>
              <Icon name="download" size={18} />
              Download CSV
            </button>
            <button className="btn pri" disabled={act.busy} onClick={markAll}>
              Mark all ordered
            </button>
          </div>
        )}
      </section>
      {suppliers.map(([supplier, lines]) => (
        <section className="card" key={supplier} aria-label={supplier}>
          <div className="row spread">
            <h2>{supplier}</h2>
            <button
              className="btn"
              onClick={() =>
                void navigator.clipboard?.writeText(
                  `Order for ${supplier}\n\n${lines.map(lineText).join("\n")}`,
                )
              }
            >
              Copy list
            </button>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Code</th>
                <th className="qty">Qty</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id || l.name}>
                  <td>{l.name}</td>
                  <td>{l.sku}</td>
                  <td className="qty">{l.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {list.length > 0 && (
        <section className="card">
          <h2>Jobs in this order</h2>
          <ul className="rows">
            {list.map(({ job: j, lines }) => (
              <li key={j.id}>
                <a className="item" href={`#/job/${j.id}`}>
                  <span className="main">
                    <span className="t">
                      {formatDate(j.date)} · {j.type} · {j.systems?.clients?.name ?? ""}
                    </span>
                    <span className="m">
                      {[j.systems?.name, j.engineer, `${lines.length} part${lines.length === 1 ? "" : "s"}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
