// Planned maintenance contracts on a client's page. Everyone sees what's covered and the next visit;
// owners add, change, renew and cancel them, and see the price.
import { formatDate } from "@airledger/domain";
import { useState, type FormEvent } from "react";
import type { Assets, SystemRow } from "../assets";
import {
  BILLING,
  VISITS_PER_YEAR,
  VISIT_TYPES,
  contractState,
  defaultEnd,
  priceText,
  visitDates,
  type Billing,
  type ContractPriceRow,
  type ContractRow,
  type ContractsApi,
} from "../contracts";
import { Area, Check, Pick, readForm, Text } from "../fields";
import { Icon } from "../icons";
import { Empty } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { todayIso, useLoad } from "./Assets";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ContractsCard(p: {
  contracts: ContractsApi;
  assets: Assets;
  clientId: string;
  owner: boolean;
}) {
  const today = todayIso();
  const data = useLoad(async () => {
    const [list, systems] = await Promise.all([
      p.contracts.forClient(p.clientId),
      p.assets.systems(p.clientId),
    ]);
    const ids = list.map((c) => c.id);
    const [prices, next] = await Promise.all([
      p.owner ? p.contracts.prices(ids) : Promise.resolve([] as ContractPriceRow[]),
      p.contracts.nextVisits(ids, today),
    ]);
    return { list, systems, prices: new Map(prices.map((x) => [x.contract_id, x])), next };
  }, [p.contracts, p.assets, p.clientId, p.owner]);
  const [editing, setEditing] = useState<ContractRow | "new" | null>(null);
  const [said, setSaid] = useState("");
  const act = useAction();
  const d = data.value;
  const systems = d?.systems ?? [];
  const sysName = new Map(systems.map((s) => [s.id, s.name]));

  if (editing)
    return (
      <ContractForm
        contracts={p.contracts}
        clientId={p.clientId}
        systems={systems}
        contract={editing === "new" ? null : editing}
        price={editing === "new" ? null : (d?.prices.get(editing.id) ?? null)}
        done={(msg) => {
          setEditing(null);
          setSaid(msg);
          data.reload();
        }}
        cancel={() => setEditing(null)}
      />
    );

  return (
    <section className="card" aria-label="Contracts">
      <div className="row spread">
        <h2>Contracts</h2>
        {p.owner && (
          <button className="btn pri" onClick={() => setEditing("new")}>
            <Icon name="plus" size={18} />
            Add contract
          </button>
        )}
      </div>
      {said && <p className="banner ok">{said}</p>}
      <ErrorLine error={data.error || act.error} />
      {d && d.list.length === 0 && (
        <Empty icon="calendar" title="No contracts">
          {p.owner
            ? "Add a planned maintenance contract and its visits are booked in for the year."
            : "This client isn't on a maintenance contract."}
        </Empty>
      )}
      <ul className="rows">
        {(d?.list ?? []).map((c) => {
          const st = contractState(c, today);
          const price = d?.prices.get(c.id);
          const next = d?.next.get(c.id);
          const covers = c.contract_systems.map((s) => sysName.get(s.system_id)).filter(Boolean);
          return (
            <li key={c.id} className="contract">
              <div className="item">
                <span className="avatar sq">
                  <Icon name="calendar" size={18} />
                </span>
                <span className="main">
                  <span className="t">{c.name}</span>
                  <span className="m">
                    {formatDate(c.start_date)} to {formatDate(c.end_date)} ·{" "}
                    {plural(c.visits_per_year, "visit")} a year
                    {covers.length ? ` · ${covers.join(", ")}` : " · no installs chosen"}
                  </span>
                  {price && <span className="m">{priceText(price)}</span>}
                  {c.status === "active" && (
                    <span className="m">
                      {next ? `Next visit ${formatDate(next)}` : "No visits booked ahead"}
                      {c.auto_renew ? " · renews by itself" : ""}
                    </span>
                  )}
                </span>
                <span className={`pill ${st.tone}`}>{st.label}</span>
              </div>
              {p.owner && c.status === "active" && (
                <div className="row">
                  <button className="btn" onClick={() => setEditing(c)}>
                    <Icon name="edit" size={18} />
                    Edit
                  </button>
                  {(st.label === "Renewal due" || st.label === "Ended") && (
                    <button
                      className="btn pri"
                      disabled={act.busy}
                      onClick={() =>
                        void act.run(async () => {
                          const end = await p.contracts.renew(c.id);
                          setSaid(`Renewed to ${formatDate(end)}. Next year's visits are booked.`);
                          data.reload();
                        })
                      }
                    >
                      Renew
                    </button>
                  )}
                  <button
                    className="btn"
                    disabled={act.busy}
                    onClick={() => {
                      if (
                        !window.confirm(`Cancel ${c.name}? Visits still to come are taken out of the diary.`)
                      )
                        return;
                      void act.run(async () => {
                        await p.contracts.cancel(c.id, today);
                        setSaid("Contract cancelled.");
                        data.reload();
                      });
                    }}
                  >
                    Cancel contract
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ContractForm(p: {
  contracts: ContractsApi;
  clientId: string;
  systems: SystemRow[];
  contract: ContractRow | null;
  price: ContractPriceRow | null;
  done: (msg: string) => void;
  cancel: () => void;
}) {
  const c = p.contract;
  const live = p.systems.filter((s) => !s.inactive);
  const [start, setStart] = useState(c?.start_date ?? todayIso());
  const [end, setEnd] = useState(c?.end_date ?? defaultEnd(todayIso()));
  const [visits, setVisits] = useState(c?.visits_per_year ?? 1);
  const act = useAction();
  const covered = new Set(c ? c.contract_systems.map((s) => s.system_id) : live.map((s) => s.id));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    const systemIds = live.map((s) => s.id).filter((id) => f.bool(`sys_${id}`));
    void act.run(async () => {
      if (end <= start) throw new Error("The end date needs to be after the start date.");
      const billing = f.text("billing") as Billing;
      const { booked } = await p.contracts.save(
        {
          ...(c ? { id: c.id } : {}),
          client_id: p.clientId,
          name: f.text("name") || "Planned maintenance",
          start_date: start,
          end_date: end,
          visits_per_year: visits,
          visit_type: f.text("visit_type"),
          auto_renew: f.bool("auto_renew"),
          notes: f.text("notes"),
        },
        systemIds,
        { price: f.num("price") ?? 0, billing: billing in BILLING ? billing : "yearly" },
      );
      p.done(
        booked
          ? `Saved. ${plural(booked, "visit")} booked in the diary, ready to give to an engineer.`
          : "Saved. Its visits were already booked.",
      );
    });
  }

  const dates = visitDates({ start_date: start, end_date: end, visits_per_year: visits });
  return (
    <form className="card form" onSubmit={submit} aria-label="Contract">
      <h2>{c ? "Edit contract" : "New contract"}</h2>
      <ErrorLine error={act.error} />
      <Text name="name" label="Contract name" value={c?.name ?? "Planned maintenance"} />
      <div className="grid2">
        <label>
          Starts
          <input
            type="date"
            name="start_date"
            value={start}
            required
            onChange={(e) => {
              const v = e.currentTarget.value;
              setStart(v);
              if (!c && v) setEnd(defaultEnd(v));
            }}
          />
        </label>
        <label>
          Renewal date
          <input
            type="date"
            name="end_date"
            value={end}
            required
            onChange={(e) => setEnd(e.currentTarget.value)}
          />
        </label>
        <label>
          Visits a year
          <select
            name="visits_per_year"
            value={visits}
            onChange={(e) => setVisits(Number(e.currentTarget.value))}
          >
            {VISITS_PER_YEAR.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Pick
          name="visit_type"
          label="Each visit is"
          value={c?.visit_type ?? "Annual service"}
          options={VISIT_TYPES}
        />
      </div>
      <p className="note">
        Visits: {dates.map((x) => formatDate(x)).join(", ") || "none in these dates"}. Ones still to come are
        booked in the diary when you save.
      </p>
      <fieldset>
        <legend>Installs covered</legend>
        {live.length === 0 && (
          <p className="note">Add this client's installs first, then choose them here.</p>
        )}
        {live.map((s) => (
          <Check key={s.id} name={`sys_${s.id}`} label={s.name} value={covered.has(s.id)} />
        ))}
      </fieldset>
      <div className="grid2">
        <Text name="price" label="Contract price (£)" type="number" value={p.price?.price ?? ""} />
        <Pick
          name="billing"
          label="Billed"
          value={p.price?.billing ?? "yearly"}
          options={Object.keys(BILLING)}
          labels={BILLING}
        />
      </div>
      <p className="note">
        Only owners see the price. Monthly, every 3 months or once a year: the yearly price is split and a
        draft invoice appears in Invoices when each one is due. Each visit: the price is per visit and goes on
        the visit's invoice.
      </p>
      <Check name="auto_renew" label="Renew by itself at the renewal date" value={c?.auto_renew ?? true} />
      <Area name="notes" label="Notes" value={c?.notes} />
      <div className="row">
        <button className="btn pri" type="submit" disabled={act.busy}>
          {act.busy ? "Saving…" : "Save contract"}
        </button>
        <button className="btn" type="button" onClick={p.cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Home, owners: contracts coming up for renewal in the next 30 days, with Renew. */
export function RenewalsCard(p: { contracts: ContractsApi }) {
  const today = todayIso();
  const data = useLoad(() => p.contracts.renewingSoon(today), [p.contracts]);
  const act = useAction();
  const list = data.value ?? [];
  if (!list.length && !data.error) return null;
  return (
    <section className="card" aria-label="Contracts up for renewal">
      <h2>Contracts up for renewal</h2>
      <ErrorLine error={data.error || act.error} />
      <ul className="rows">
        {list.map((c) => (
          <li key={c.id}>
            <a className="item" href={`#/client/${c.client_id}`}>
              <span className="main">
                <span className="t">{c.clients?.name ?? c.name}</span>
                <span className="m">
                  {c.name} · {c.end_date <= today ? "ended" : "renews"} {formatDate(c.end_date)}
                  {c.auto_renew ? " (renews by itself)" : ""}
                </span>
              </span>
            </a>
            <button
              className="btn"
              disabled={act.busy}
              onClick={() =>
                void act.run(async () => {
                  await p.contracts.renew(c.id);
                  data.reload();
                })
              }
            >
              Renew
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
