// Invoices, the price list and accounts settings (spec F12). Owners only.
import { formatDate, invoiceTotals, roundPence, type InvoiceLine } from "@airledger/domain";
import { useState, type FormEvent } from "react";
import type { Assets } from "../assets";
import { Check, Pick, readForm, Text } from "../fields";
import { Icon } from "../icons";
import {
  PRICE_FIELDS,
  linesForJob,
  toLines,
  totals,
  type AccountsSettings,
  type InvoiceRow,
  type InvoicesApi,
  type PriceListRow,
  type SyncResult,
  SYSTEM_LABEL,
} from "../invoices";
import type { JobRow, JobsApi } from "../jobs";
import { download } from "../stickerPdf";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { go, todayIso, useLoad } from "./Assets";

const APP_LABEL = { xero: "Xero", quickbooks: "QuickBooks", sage: "Sage 50" } as const;
const FILTERS = { draft: "To export", exported: "Exported", all: "All" } as const;
type Filter = keyof typeof FILTERS;
const money = (n: number) => n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });

// ---------- the list ----------

export function InvoicesPage(p: { invoices: InvoicesApi; jobs: JobsApi; query: URLSearchParams }) {
  const filter: Filter =
    (p.query.get("show") as Filter) in FILTERS ? (p.query.get("show") as Filter) : "draft";
  // Draft any completed jobs first, then load the list.
  const data = useLoad(async () => {
    const contractBills = await p.invoices.billContracts();
    const made = { ...(await p.invoices.draftPending((id) => p.jobs.record(id), todayIso())), contractBills };
    // When connected, bring back what's been paid before listing.
    const connection = await p.invoices.connection().catch(() => null);
    const pulled = connection ? await p.invoices.sync([]).catch((e: Error) => e.message) : null;
    const [list, accounts, covered] = await Promise.all([
      p.invoices.invoices(),
      p.invoices.accounts(),
      p.invoices.jobsBilled("plan"),
    ]);
    return { made, list, accounts, covered, connection, pulled };
  }, [p.invoices, p.jobs]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const act = useAction();
  const d = data.value;
  const shown = (d?.list ?? []).filter((i) => filter === "all" || i.status === filter);
  const toExport = shown.filter((i) => i.status === "draft");
  const chosen = toExport.filter((i) => picked.has(i.id));
  const batch = chosen.length ? chosen : toExport;
  const app = d ? APP_LABEL[d.accounts.accounts_app] : "";
  const live = d?.connection ? SYSTEM_LABEL[d.connection.system] : "";
  const [result, setResult] = useState<SyncResult | null>(null);

  function sendNow() {
    void act.run(async () => {
      setResult(await p.invoices.sync(batch.map((i) => i.id)));
      setPicked(new Set());
      data.reload();
    });
  }

  function exportNow() {
    void act.run(async () => {
      const { csv, app: a } = await p.invoices.exportCsv(batch);
      download(new Blob([csv], { type: "text/csv" }), `invoices-${a}-${todayIso()}.csv`);
      await p.invoices.setExported(
        batch.map((i) => i.id),
        true,
      );
      setPicked(new Set());
      data.reload();
    });
  }

  return (
    <>
      <PageHead
        title="Invoices"
        sub="Drafted from completed jobs and contracts. Check them, then export to your accounts."
      >
        <a className="btn" href="#/pricing">
          Prices and accounts
        </a>
      </PageHead>
      {d && (d.made.drafted > 0 || d.made.covered > 0 || d.made.contractBills > 0) && (
        <p className="banner ok">
          {[
            d.made.drafted &&
              `${d.made.drafted} new draft invoice${d.made.drafted === 1 ? "" : "s"} from completed jobs`,
            d.made.covered &&
              `${d.made.covered} job${d.made.covered === 1 ? "" : "s"} covered by a service plan`,
            d.made.contractBills &&
              `${d.made.contractBills} contract bill${d.made.contractBills === 1 ? "" : "s"}`,
          ]
            .filter(Boolean)
            .join(", ")}
          .
        </p>
      )}
      <section className="card">
        <div className="chips" role="group" aria-label="Show">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <button
              key={f}
              className="chip"
              aria-pressed={f === filter}
              onClick={() => go(f === "draft" ? "#/invoices" : `#/invoices?show=${f}`)}
            >
              {FILTERS[f]}
              {d && ` (${d.list.filter((i) => f === "all" || i.status === f).length})`}
            </button>
          ))}
        </div>
        <ErrorLine error={data.error || act.error} />
        {typeof d?.pulled === "string" && (
          <p className="error">
            Couldn't check payments in {live}: {d.pulled}
          </p>
        )}
        {result && (
          <p className={result.errors.length ? "error" : "banner ok"} role="status">
            {result.sent > 0 && `${result.sent} sent to ${SYSTEM_LABEL[result.system]}. `}
            {result.errors.map((e) => `${e.number}: ${e.error}`).join(" ")}
            {!result.sent && !result.errors.length && "Nothing new to send."}
          </p>
        )}
        {!d ? (
          <Loading />
        ) : !shown.length ? (
          <Empty icon="check" title={filter === "draft" ? "Nothing to export" : "No invoices"}>
            Invoices are drafted here when a job is completed.
          </Empty>
        ) : (
          <>
            {toExport.length > 0 &&
              (live ? (
                <div className="row">
                  <button className="btn pri" disabled={act.busy} onClick={sendNow}>
                    <Icon name="send" size={18} />
                    {act.busy ? "Sending…" : `Send ${batch.length} to ${live}`}
                  </button>
                  <button className="btn" disabled={act.busy} onClick={exportNow}>
                    <Icon name="download" size={18} />
                    CSV instead
                  </button>
                  <span className="note">{chosen.length ? "The ones ticked." : "All waiting."}</span>
                </div>
              ) : (
                <div className="row">
                  <button className="btn pri" disabled={act.busy} onClick={exportNow}>
                    <Icon name="download" size={18} />
                    Export {batch.length} to {app}
                  </button>
                  <span className="note">
                    {chosen.length ? "The ones ticked." : "All waiting."} They're marked exported once
                    downloaded.
                  </span>
                </div>
              ))}
            <ul className="rows invoices">
              {shown.map((i) => {
                const t = totals(i);
                return (
                  <li key={i.id}>
                    <div className="item">
                      {i.status === "draft" && (
                        <input
                          type="checkbox"
                          aria-label={`Choose invoice ${i.number}`}
                          checked={picked.has(i.id)}
                          onChange={(e) => {
                            const next = new Set(picked);
                            if (e.currentTarget.checked) next.add(i.id);
                            else next.delete(i.id);
                            setPicked(next);
                          }}
                        />
                      )}
                      <a className="main" href={`#/invoice/${i.id}`}>
                        <span className="t">
                          {i.number} · {i.clients?.name ?? ""}
                        </span>
                        <span className="m">
                          {[
                            formatDate(i.date),
                            i.reference,
                            i.paid_at
                              ? `paid ${formatDate(i.paid_at)}`
                              : Number(i.amount_paid) > 0
                                ? `${money(Number(i.amount_paid))} paid`
                                : null,
                            i.external_id && i.external_system && i.external_system !== "sage"
                              ? `in ${SYSTEM_LABEL[i.external_system]}`
                              : i.status === "exported" &&
                                i.exported_at &&
                                `exported ${formatDate(i.exported_at.slice(0, 10))}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </a>
                      {i.paid_at && <span className="pill green">Paid</span>}
                      {i.sync_status === "failed" && !i.external_id && (
                        <span className="pill red" title={i.sync_error}>
                          Not sent
                        </span>
                      )}
                      <span className="amount">{money(t.gross)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      {d && d.covered.length > 0 && (
        <section className="card">
          <h2>Covered by a service plan</h2>
          <p className="note">Plan visits with nothing extra to charge. Invoice one anyway if you need to.</p>
          <ul className="rows">
            {d.covered.slice(0, 20).map((j) => (
              <li key={j.id}>
                <a className="item" href={`#/job/${j.id}`}>
                  <span className="main">
                    <span className="t">
                      {j.type} · {j.systems?.clients?.name ?? ""}
                    </span>
                    <span className="m">
                      {[formatDate(j.date), j.systems?.name].filter(Boolean).join(" · ")}
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

// ---------- one invoice ----------

interface EditLine {
  key: number;
  desc: string;
  qty: string;
  unit: string;
}
let lineKey = 0;
const toEdit = (l: InvoiceLine): EditLine => ({
  key: lineKey++,
  desc: l.desc,
  qty: String(l.qty),
  unit: String(l.unit),
});

export function InvoicePage(p: { invoices: InvoicesApi; id: string }) {
  const data = useLoad(() => p.invoices.invoice(p.id), [p.invoices, p.id]);
  if (data.value === undefined) return data.error ? <ErrorLine error={data.error} /> : <Loading />;
  if (!data.value)
    return (
      <section className="card">
        <h1>Not found</h1>
        <p>
          That invoice doesn't exist, or it's been deleted. <a href="#/invoices">Back to invoices</a>
        </p>
      </section>
    );
  return <InvoiceEditor invoices={p.invoices} inv={data.value} reload={data.reload} />;
}

function InvoiceEditor({
  invoices,
  inv,
  reload,
}: {
  invoices: InvoicesApi;
  inv: InvoiceRow;
  reload: () => void;
}) {
  const [lines, setLines] = useState<EditLine[]>(() => toLines(inv.invoice_lines ?? []).map(toEdit));
  const [vat, setVat] = useState(Number(inv.vat_rate) > 0);
  const [saved, setSaved] = useState(false);
  const act = useAction();
  const parsed = lines.map((l) => ({
    desc: l.desc.trim(),
    qty: Number(l.qty) || 0,
    unit: roundPence(Number(l.unit) || 0),
  }));
  const t = invoiceTotals({ lines: parsed, vat });
  const exported = inv.status === "exported";
  const set = (key: number, patch: Partial<EditLine>) => {
    setSaved(false);
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    void act.run(async () => {
      const keep = parsed.filter((l) => l.desc);
      if (!keep.length) throw new Error("An invoice needs at least one line.");
      await invoices.save(
        inv.id,
        {
          date: f.text("date") || inv.date,
          due_date: f.orNull("due_date"),
          reference: f.text("reference"),
          vat,
        },
        keep,
      );
      setSaved(true);
      reload();
    });
  }

  return (
    <>
      <PageHead
        back={{ href: "#/invoices", label: "Invoices" }}
        title={`Invoice ${inv.number}`}
        sub={
          <>
            {inv.clients?.name}
            {inv.jobs && (
              <>
                {" · "}
                <a href={`#/job/${inv.jobs.id}`}>
                  {inv.jobs.type} {formatDate(inv.jobs.date)}
                </a>
              </>
            )}
          </>
        }
      >
        <span className={`pill ${exported ? "green" : "amber"}`}>{exported ? "Exported" : "Draft"}</span>
      </PageHead>
      {exported && (
        <p className="banner">
          Exported {inv.exported_at ? formatDate(inv.exported_at.slice(0, 10)) : ""}. Changes here don't reach
          your accounts: change it there too, or mark it not exported and export it again.
        </p>
      )}
      <form className="card form" onSubmit={submit} aria-label="Invoice">
        <ErrorLine error={act.error} />
        <div className="grid3">
          <Text name="date" label="Date" type="date" value={inv.date} />
          <Text name="due_date" label="Due" type="date" value={inv.due_date ?? ""} />
          <Text name="reference" label="Reference" value={inv.reference} />
        </div>
        <div className="table-scroll">
          <table className="table lines">
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit £</th>
                <th>Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td>
                    <input
                      aria-label={`Line ${i + 1} description`}
                      value={l.desc}
                      onChange={(e) => set(l.key, { desc: e.currentTarget.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Line ${i + 1} quantity`}
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => set(l.key, { qty: e.currentTarget.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Line ${i + 1} unit price`}
                      inputMode="decimal"
                      value={l.unit}
                      onChange={(e) => set(l.key, { unit: e.currentTarget.value })}
                    />
                  </td>
                  <td className="num">{money(roundPence((Number(l.qty) || 0) * (Number(l.unit) || 0)))}</td>
                  <td>
                    <button
                      type="button"
                      className="link"
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => setLines([...lines, { key: lineKey++, desc: "", qty: "1", unit: "0" }])}
        >
          <Icon name="plus" size={18} />
          Add a line
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={vat}
            onChange={(e) => (setSaved(false), setVat(e.currentTarget.checked))}
          />
          Add VAT at 20%
        </label>
        <dl className="facts totals">
          <dt>Net</dt>
          <dd>{money(t.net)}</dd>
          <dt>VAT</dt>
          <dd>{money(t.vat)}</dd>
          <dt>Total</dt>
          <dd>
            <b>{money(t.gross)}</b>
          </dd>
        </dl>
        <div className="row">
          <button className="btn pri" type="submit" disabled={act.busy}>
            Save
          </button>
          {saved && <span className="note">Saved.</span>}
          <button
            type="button"
            className="btn"
            disabled={act.busy}
            onClick={() =>
              void act.run(async () => (await invoices.setExported([inv.id], !exported), reload()))
            }
          >
            {exported ? "Mark not exported" : "Mark exported"}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={act.busy}
            onClick={() =>
              confirm(
                exported
                  ? `Delete invoice ${inv.number}? It's been exported, so void it in your accounts too.`
                  : `Delete invoice ${inv.number}?`,
              ) &&
              void act.run(async () => {
                await invoices.remove(inv.id);
                go("#/invoices?show=all");
              })
            }
          >
            Delete
          </button>
        </div>
      </form>
    </>
  );
}

// ---------- on a job (owners) ----------

/** The job's invoice, "covered by plan" with Invoice anyway, a quote for installs. */
export function JobBillingCard(p: { invoices: InvoicesApi; jobs: JobsApi; job: JobRow }) {
  const j = p.job;
  const data = useLoad(async () => {
    const [inv, quote] = await Promise.all([p.invoices.jobInvoice(j.id), p.invoices.quote(j.id)]);
    return { inv, quote };
  }, [p.invoices, j.id, j.billing]);
  const act = useAction();
  const install = j.type === "Installation" || j.type === "Commissioning";
  if (!data.value) return null;
  const { inv, quote } = data.value;
  return (
    <section className="card">
      <h2>Invoice</h2>
      <ErrorLine error={act.error || data.error} />
      {inv ? (
        <a className="item" href={`#/invoice/${inv.id}`}>
          <span className="main">
            <span className="t">
              Invoice {inv.number} · {money(totals(inv).gross)}
            </span>
            <span className="m">{inv.status === "exported" ? "Exported" : "Draft, waiting to export"}</span>
          </span>
          <Icon name="chevron" size={18} />
        </a>
      ) : j.billing === "plan" ? (
        <div className="row spread">
          <span className="note">Covered by the client's service plan.</span>
          <button
            className="btn"
            disabled={act.busy}
            onClick={() =>
              void act.run(async () => {
                const [pricing, inp] = await Promise.all([
                  p.invoices.pricing(),
                  p.invoices.jobInputs(j, () => p.jobs.record(j.id)),
                ]);
                const lines = linesForJob({ job: j, ...inp, pricing, ignorePlan: true });
                if (!lines.length)
                  throw new Error("Nothing on this job has a price yet. Set your prices first.");
                const id = await p.invoices.create({
                  clientId: inp.system.client_id,
                  jobId: j.id,
                  date: j.date ?? todayIso(),
                  reference: `${j.type} ${inp.system.site_postcode || ""}`.trim(),
                  lines,
                  accounts: pricing.accounts,
                  auto: false,
                });
                go(`#/invoice/${id}`);
              })
            }
          >
            Invoice anyway
          </button>
        </div>
      ) : j.status === "completed" ? (
        <p className="note">
          Waiting to be invoiced. It's drafted when you next open <a href="#/invoices">Invoices</a>.
        </p>
      ) : (
        <p className="note">Drafted automatically when the job is completed.</p>
      )}
      {install && !inv && (
        <form
          className="row"
          aria-label="Quote"
          onSubmit={(e) => {
            e.preventDefault();
            const f = readForm(e.currentTarget);
            void act.run(async () => (await p.invoices.saveQuote(j.id, f.num("quote")), data.reload()));
          }}
        >
          <Text name="quote" label="Quoted price (£, before VAT)" type="number" value={quote ?? ""} />
          <button className="btn" type="submit" disabled={act.busy}>
            Save quote
          </button>
        </form>
      )}
    </section>
  );
}

// ---------- on a client (owners) ----------

export function ClientBillingCard(p: { invoices: InvoicesApi; clientId: string }) {
  const data = useLoad(() => p.invoices.clientBilling(p.clientId), [p.invoices, p.clientId]);
  const [saved, setSaved] = useState(false);
  const act = useAction();
  if (data.value === undefined) return null;
  const b = data.value;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    setSaved(false);
    void act.run(async () => {
      const how = f.text("plan_billing");
      await p.invoices.saveClientBilling({
        client_id: p.clientId,
        plan_price: f.num("plan_price"),
        plan_billing: how === "visit" || how === "separate" ? how : null,
        accounts_name: f.text("accounts_name"),
        sage_ref: f.text("sage_ref"),
      });
      setSaved(true);
    });
  }
  return (
    <form className="card form" onSubmit={submit} aria-label="Billing">
      <h2>Billing</h2>
      <p className="note">Only owners see this.</p>
      <ErrorLine error={act.error || data.error} />
      <div className="grid2">
        <Text
          name="plan_price"
          label="Service plan price per visit (£)"
          type="number"
          value={b?.plan_price ?? ""}
        />
        <label>
          How the plan is paid
          <select name="plan_billing" defaultValue={b?.plan_billing ?? ""}>
            <option value="">Work it out (per visit if there's a price)</option>
            <option value="visit">Invoice the plan price at each service</option>
            <option value="separate">Paid separately (don't invoice plan visits)</option>
          </select>
        </label>
        <Text
          name="accounts_name"
          label="Name in your accounts (if different)"
          value={b?.accounts_name ?? ""}
        />
        <Text name="sage_ref" label="Sage account reference" value={b?.sage_ref ?? ""} />
      </div>
      <div className="row">
        <button className="btn pri" type="submit" disabled={act.busy}>
          Save
        </button>
        {saved && <span className="note">Saved.</span>}
      </div>
    </form>
  );
}

// ---------- prices and accounts ----------

export function PricingPage(p: {
  invoices: InvoicesApi;
  jobs: JobsApi;
  assets: Assets;
  query?: URLSearchParams;
}) {
  const data = useLoad(async () => {
    const [prices, accounts, materials, materialPrices] = await Promise.all([
      p.invoices.priceList(),
      p.invoices.accounts(),
      p.jobs.materials(),
      p.invoices.materialPrices(),
    ]);
    return { prices, accounts, materials, materialPrices };
  }, [p.invoices, p.jobs]);
  const act = useAction();
  const [saved, setSaved] = useState("");
  if (!data.value) return data.error ? <ErrorLine error={data.error} /> : <Loading />;
  const { prices, accounts: a, materials, materialPrices } = data.value;
  const priceOf = new Map(materialPrices.map((m) => [m.material_id, m]));

  function savePrices(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    setSaved("");
    void act.run(async () => {
      await p.invoices.savePriceList(
        Object.fromEntries(PRICE_FIELDS.map(([k]) => [k, f.num(k)])) as unknown as PriceListRow,
      );
      setSaved("prices");
    });
  }
  function saveAccounts(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    setSaved("");
    void act.run(async () => {
      const app = f.text("accounts_app");
      const next: AccountsSettings = {
        accounts_app: app === "quickbooks" || app === "sage" ? app : "xero",
        vat_registered: f.bool("vat_registered"),
        payment_days: f.num("payment_days") ?? 14,
        xero_account_code: f.text("xero_account_code"),
        xero_tax_type: f.text("xero_tax_type"),
        xero_tracking_name: f.text("xero_tracking_name"),
        xero_tracking_option: f.text("xero_tracking_option"),
        qb_item: f.text("qb_item"),
        qb_tax_code: f.text("qb_tax_code"),
        sage_nominal: f.text("sage_nominal"),
        sage_tax_code: f.text("sage_tax_code"),
        sage_no_vat_code: f.text("sage_no_vat_code"),
        prefix: f.text("prefix"),
        next_number: Math.max(1, Math.round(f.num("next_number") ?? a.next_number)),
      };
      await p.invoices.saveAccounts(next);
      setSaved("accounts");
      data.reload();
    });
  }
  function saveParts(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    setSaved("");
    void act.run(async () => {
      for (const m of materials) {
        const row = {
          material_id: m.id,
          cost: f.num(`cost_${m.id}`),
          sell: f.num(`sell_${m.id}`),
          chargeable: f.bool(`charge_${m.id}`),
        };
        const old = priceOf.get(m.id);
        if (old && old.cost === row.cost && old.sell === row.sell && old.chargeable === row.chargeable)
          continue;
        if (!old && row.cost == null && row.sell == null && !row.chargeable) continue;
        await p.invoices.saveMaterialPrice(row);
      }
      setSaved("parts");
      data.reload();
    });
  }

  return (
    <>
      <PageHead
        back={{ href: "#/invoices", label: "Invoices" }}
        title="Prices and accounts"
        sub="What jobs are charged at, and how invoices go into your accounts. Only owners see this."
      />
      <ErrorLine error={act.error} />
      <form className="card form" onSubmit={savePrices} aria-label="Price list">
        <h2>Price list</h2>
        <p className="note">Before VAT. Clients on a service plan have the routine visit covered.</p>
        <div className="grid2">
          {PRICE_FIELDS.map(([k, label]) => (
            <Text key={k} name={k} label={`${label} (£)`} type="number" value={prices?.[k] ?? ""} />
          ))}
        </div>
        <div className="row">
          <button className="btn pri" type="submit" disabled={act.busy}>
            Save prices
          </button>
          {saved === "prices" && <span className="note">Saved.</span>}
        </div>
      </form>

      <form className="card form" onSubmit={saveParts} aria-label="Part prices">
        <h2>Part prices</h2>
        <p className="note">Tick "Charge" for parts that go on the invoice when used.</p>
        {!materials.length ? (
          <p className="note">
            No materials yet. <a href="#/materials">Set up materials</a>
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Cost £</th>
                  <th>Sell £</th>
                  <th>Charge</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => {
                  const pr = priceOf.get(m.id);
                  return (
                    <tr key={m.id}>
                      <td>
                        {m.name}
                        {m.supplier && <div className="note">{m.supplier}</div>}
                      </td>
                      <td>
                        <input
                          name={`cost_${m.id}`}
                          aria-label={`${m.name} cost`}
                          inputMode="decimal"
                          defaultValue={pr?.cost ?? ""}
                        />
                      </td>
                      <td>
                        <input
                          name={`sell_${m.id}`}
                          aria-label={`${m.name} sell price`}
                          inputMode="decimal"
                          defaultValue={pr?.sell ?? ""}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          name={`charge_${m.id}`}
                          aria-label={`Charge for ${m.name}`}
                          defaultChecked={!!pr?.chargeable}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="row">
          <button className="btn pri" type="submit" disabled={act.busy || !materials.length}>
            Save part prices
          </button>
          {saved === "parts" && <span className="note">Saved.</span>}
        </div>
      </form>

      <form className="card form" onSubmit={saveAccounts} aria-label="Accounts">
        <h2>Invoices and accounts</h2>
        <div className="grid2">
          <Pick
            name="accounts_app"
            label="Accounts software"
            value={a.accounts_app}
            options={["xero", "quickbooks", "sage"]}
            labels={APP_LABEL}
          />
          <Text name="payment_days" label="Payment terms (days)" type="number" value={a.payment_days} />
          <Text name="prefix" label="Invoice number prefix" value={a.prefix} />
          <Text name="next_number" label="Next invoice number" type="number" value={a.next_number} />
        </div>
        <Check name="vat_registered" label="VAT registered (adds 20% VAT)" value={a.vat_registered} />
        <details>
          <summary>Codes for {APP_LABEL[a.accounts_app]}</summary>
          <div className="grid2">
            <Text name="xero_account_code" label="Xero account code" value={a.xero_account_code} />
            <Text name="xero_tax_type" label="Xero tax type" value={a.xero_tax_type} />
            <Text name="xero_tracking_name" label="Xero tracking name" value={a.xero_tracking_name} />
            <Text name="xero_tracking_option" label="Xero tracking option" value={a.xero_tracking_option} />
            <Text name="qb_item" label="QuickBooks product/service" value={a.qb_item} />
            <Text name="qb_tax_code" label="QuickBooks tax code" value={a.qb_tax_code} />
            <Text name="sage_nominal" label="Sage nominal code" value={a.sage_nominal} />
            <Text name="sage_tax_code" label="Sage tax code (VAT)" value={a.sage_tax_code} />
            <Text name="sage_no_vat_code" label="Sage tax code (no VAT)" value={a.sage_no_vat_code} />
          </div>
        </details>
        <div className="row">
          <button className="btn pri" type="submit" disabled={act.busy}>
            Save
          </button>
          {saved === "accounts" && <span className="note">Saved.</span>}
        </div>
      </form>
      <LiveConnection invoices={p.invoices} came={p.query?.get("accounts") ?? ""} />
    </>
  );
}

const CAME_BACK: Record<string, [string, string]> = {
  connected: ["ok", "Connected. Invoices can now be sent across from the Invoices page."],
  declined: ["error", "The connection wasn't approved, so nothing changed."],
  expired: ["error", "That took too long. Press Connect again."],
  failed: ["error", "The connection didn't work. Press Connect again, and if it keeps failing, tell us."],
  "no-organisation": ["error", "No company was chosen. Press Connect again and pick your company."],
};

/** Connect Xero or QuickBooks once; after that invoices go across from the Invoices page. */
function LiveConnection(p: { invoices: InvoicesApi; came: string }) {
  const conn = useLoad(() => p.invoices.connection(), [p.invoices]);
  const act = useAction();
  const c = conn.value;
  const back = CAME_BACK[p.came];
  const connect = (system: "xero" | "quickbooks") =>
    void act.run(async () => {
      window.location.assign(await p.invoices.connectUrl(system));
    });
  return (
    <section className="card form" aria-label="Live connection">
      <h2>Live connection</h2>
      {back && <p className={back[0] === "ok" ? "banner ok" : "error"}>{back[1]}</p>}
      <ErrorLine error={conn.error || act.error} />
      {c === undefined ? (
        <Loading />
      ) : c ? (
        <>
          <p>
            Connected to <b>{SYSTEM_LABEL[c.system]}</b>
            {c.tenant_name ? ` (${c.tenant_name})` : ""} since {formatDate(c.connected_at.slice(0, 10))}.
            {c.last_sync_at && ` Last synced ${formatDate(c.last_sync_at.slice(0, 10))}.`}
          </p>
          {c.last_error && <p className="error">Last problem: {c.last_error}</p>}
          <p className="note">
            Invoices you send go into {SYSTEM_LABEL[c.system]}
            {c.system === "xero" ? " as drafts, ready to approve" : ""}, with the customer added if they're
            new. Payments come back here by themselves.
          </p>
          <div className="row">
            <button
              className="btn"
              disabled={act.busy}
              onClick={() => {
                if (!window.confirm(`Disconnect ${SYSTEM_LABEL[c.system]}? You can connect again any time.`))
                  return;
                void act.run(async () => {
                  await p.invoices.disconnect();
                  conn.reload();
                });
              }}
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="note">
            Connect once and invoices go straight into your accounts, with no CSV to download and import.
            You'll sign in to your accounts software and approve Air Ledger.
          </p>
          <div className="row">
            <button className="btn pri" disabled={act.busy} onClick={() => connect("xero")}>
              Connect Xero
            </button>
            <button className="btn pri" disabled={act.busy} onClick={() => connect("quickbooks")}>
              Connect QuickBooks
            </button>
          </div>
          <p className="note">
            Sage 50 runs on your computer with no online connection, so it uses the CSV export.
          </p>
        </>
      )}
    </section>
  );
}
