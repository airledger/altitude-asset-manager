import {
  dueStatus,
  fgas,
  formatDate,
  parseScan,
  REFRIGERANT_GWP,
  systemInfo,
  type IsoDate,
} from "@airledger/domain";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  CONTROLLERS,
  FILTER_TYPES,
  INDOOR_TYPES,
  PREFERRED_CONTACT,
  toDomain,
  toSettings,
  type Assets,
  type ClientRow,
  type SystemRow,
  type UnitRow,
} from "../assets";
import { Area, Check, Pick, readForm, Text } from "../fields";
import { labelSheetHtml, openPrintWindow, type PrintBrand } from "../print";
import { Icon } from "../icons";
import { Empty, initials, Loading, PageHead } from "../ui";
import { SiteRecords } from "./SiteRecords";
import { SystemJobs } from "./Jobs";
import { toJob, type JobsApi } from "../jobs";
import { ErrorLine, useAction } from "../useAction";

const REFRIGERANTS = [...Object.keys(REFRIGERANT_GWP), "Other"] as const;
export const todayIso = (): IsoDate => new Date().toLocaleDateString("en-CA") as IsoDate;
export const go = (hash: string) => {
  window.location.hash = hash;
};

/** Loads something on mount and when `deps` change; `reload` fetches again. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (v) => live && setValue(v),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { value, error, reload: () => setN((x) => x + 1) };
}

export async function brandFor(assets: Assets, businessName: string): Promise<PrintBrand> {
  const s = await assets.ruleSettings();
  return { businessName, phone: s?.phone ?? "", appUrl: s?.app_url ?? "" };
}

// ---------- clients ----------

export function ClientList({ assets }: { assets: Assets }) {
  const { value: clients, error } = useLoad(() => assets.clients(), [assets]);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = (clients ?? []).filter(
    (c) =>
      !needle || [c.name, c.contact_name, c.postcode, c.email].some((v) => v.toLowerCase().includes(needle)),
  );
  return (
    <>
      <PageHead title="Clients" sub={clients ? plural(clients.length, "client") : " "}>
        <a className="btn" href="#/register">
          Asset register
        </a>
        <a className="btn pri" href="#/client/new">
          <Icon name="plus" size={18} />
          Add client
        </a>
      </PageHead>
      <section className="card">
        <ErrorLine error={error} />
        <input
          type="search"
          className="search"
          aria-label="Search clients"
          placeholder="Search name, contact or postcode"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        {!clients ? (
          <Loading />
        ) : shown.length === 0 ? (
          clients.length ? (
            <Empty icon="clients" title="No clients match" />
          ) : (
            <Empty icon="clients" title="No clients yet">
              Add your first client, then their installs and units.
            </Empty>
          )
        ) : (
          <ul className="rows">
            {shown.map((c) => (
              <li key={c.id}>
                <a href={`#/client/${c.id}`} className="item">
                  <span className="avatar">{initials(c.name)}</span>
                  <span className="main">
                    <span className="t">{c.name}</span>
                    <span className="m">
                      {[c.postcode, plural(c.systems[0]?.count ?? 0, "install")].filter(Boolean).join(" · ")}
                      {c.on_service_plan && " · Service plan"}
                    </span>
                  </span>
                  {c.on_service_plan && <span className="pill green">Plan</span>}
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ClientPage({ assets, id, children }: { assets: Assets; id: string; children?: ReactNode }) {
  const isNew = id === "new";
  const client = useLoad(() => (isNew ? Promise.resolve(null) : assets.client(id)), [assets, id]);
  const systems = useLoad(() => (isNew ? Promise.resolve([]) : assets.systems(id)), [assets, id]);
  const settings = useLoad(() => assets.ruleSettings(), [assets]);
  const [editing, setEditing] = useState(false);

  if (!isNew && client.value === undefined) return <Loading />;
  if (!isNew && !client.value) return <NotFound what="client" />;
  const c = client.value ?? null;

  return (
    <>
      <PageHead
        back={{ href: "#/clients", label: "Clients" }}
        title={c ? c.name : "New client"}
        sub={c ? [c.contact_name, c.postcode].filter(Boolean).join(" · ") || " " : " "}
      >
        {c && !editing && (
          <>
            {c.on_service_plan && <span className="pill green">Service plan</span>}
            <button className="btn" onClick={() => setEditing(true)}>
              <Icon name="edit" size={18} />
              Edit
            </button>
          </>
        )}
      </PageHead>
      {isNew || editing ? (
        <ClientForm
          assets={assets}
          client={c}
          done={(savedId) => {
            setEditing(false);
            if (isNew) go(`#/client/${savedId}`);
            else client.reload();
          }}
          cancel={() => (isNew ? go("#/clients") : setEditing(false))}
        />
      ) : (
        c && (
          <section className="card">
            <dl className="facts">
              <Fact k="Contact" v={c.contact_name} />
              <Fact k="Phone" v={c.phone} />
              <Fact k="Email" v={c.email} />
              <Fact k="Prefers" v={c.preferred_contact} />
              <Fact k="Address" v={[c.billing_address, c.postcode].filter(Boolean).join(", ")} />
              <Fact k="Service plan" v={c.on_service_plan ? "Yes" : "No (out of contract)"} />
              <Fact k="Reminders" v={c.reminders_opt_in ? "Yes" : "No"} />
              <Fact k="Notes" v={c.notes} />
            </dl>
          </section>
        )
      )}
      {c && !editing && children}
      {c && (
        <section className="card">
          <div className="row spread">
            <h2>Installs</h2>
            <a className="btn pri" href={`#/system/new?client=${c.id}`}>
              <Icon name="plus" size={18} />
              Add install
            </a>
          </div>
          {systems.value?.length === 0 && (
            <Empty icon="snow" title="No installs yet">
              Add the system you fitted or service here.
            </Empty>
          )}
          <ul className="rows">
            {(systems.value ?? []).map((s) => {
              const sys = toDomain(s);
              const st = toSettings(settings.value ?? null);
              const status = dueStatus(sys, systemInfo(sys, [], st, todayIso()), st, todayIso());
              return (
                <li key={s.id}>
                  <a href={`#/system/${s.id}`} className="item">
                    <span className="avatar sq">
                      <Icon name="snow" size={18} />
                    </span>
                    <span className="main">
                      <span className="t">{s.name}</span>
                      <span className="m">
                        {[s.site_postcode, s.refrigerant].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className={`pill ${status.tone}`}>{status.label}</span>
                    <Icon name="chevron" size={18} />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

function ClientForm(p: {
  assets: Assets;
  client: ClientRow | null;
  done: (id: string) => void;
  cancel: () => void;
}) {
  const c = p.client;
  const { busy, error, run } = useAction();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    void run(async () => {
      const id = await p.assets.saveClient({
        id: c?.id,
        name: f.text("name"),
        contact_name: f.text("contact_name"),
        phone: f.text("phone"),
        email: f.text("email"),
        preferred_contact: f.text("preferred_contact"),
        billing_address: f.text("billing_address"),
        postcode: f.text("postcode").toUpperCase(),
        on_service_plan: f.bool("on_service_plan"),
        reminders_opt_in: f.bool("reminders_opt_in"),
        notes: f.text("notes"),
      });
      p.done(id);
    });
  }
  return (
    <form className="card form" onSubmit={submit}>
      <h2>{c ? "Edit details" : "Client details"}</h2>
      <ErrorLine error={error} />
      <Text name="name" label="Client or company name" value={c?.name} required />
      <Text name="contact_name" label="Contact name" value={c?.contact_name} />
      <Text name="phone" label="Phone" type="tel" value={c?.phone} />
      <Text name="email" label="Email" type="email" value={c?.email} />
      <Pick
        name="preferred_contact"
        label="Prefers to be contacted by"
        value={c?.preferred_contact ?? "Email"}
        options={PREFERRED_CONTACT}
      />
      <Area name="billing_address" label="Billing address" value={c?.billing_address} />
      <Text name="postcode" label="Postcode" value={c?.postcode} />
      <Check name="on_service_plan" label="On an annual service plan" value={c?.on_service_plan} />
      <Check name="reminders_opt_in" label="Send service reminders" value={c?.reminders_opt_in ?? true} />
      <Area name="notes" label="Notes" value={c?.notes} />
      <FormButtons busy={busy} cancel={p.cancel} />
    </form>
  );
}

// ---------- installs (systems) ----------

export function SystemPage({
  assets,
  jobs,
  id,
  clientId,
  sticker,
  businessName,
  author,
}: {
  assets: Assets;
  jobs: JobsApi;
  id: string;
  clientId: string | null;
  /** A scanned sticker to add to this install (#/system/<id>?sticker=AC-XXXXX). */
  sticker: string | null;
  businessName: string;
  /** Pre-filled "By" on new site records. */
  author: string;
}) {
  const isNew = id === "new";
  const system = useLoad(() => (isNew ? Promise.resolve(null) : assets.system(id)), [assets, id]);
  const units = useLoad(() => (isNew ? Promise.resolve([]) : assets.units(id)), [assets, id]);
  const settings = useLoad(() => assets.ruleSettings(), [assets]);
  const history = useLoad(() => (isNew ? Promise.resolve([]) : jobs.systemJobs(id)), [jobs, id]);
  const ownerId = system.value?.client_id ?? clientId;
  const client = useLoad(() => (ownerId ? assets.client(ownerId) : Promise.resolve(null)), [assets, ownerId]);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const replacing = useAction();
  const printing = useAction();

  if (!isNew && system.value === undefined) return <Loading />;
  if (!isNew && !system.value) return <NotFound what="install" />;
  if (isNew && !clientId) return <NotFound what="client" />;
  // A new install needs its client before Save can work.
  if (isNew && client.value === undefined && !client.error) return <Loading />;
  const s = system.value ?? null;
  const back = client.value && { href: `#/client/${client.value.id}`, label: client.value.name };

  if (isNew || editing)
    return (
      <>
        <PageHead back={back} title={s ? s.name : "New install"} />
        <SystemForm
          assets={assets}
          system={s}
          client={client.value ?? null}
          done={(savedId) => {
            setEditing(false);
            if (isNew) go(`#/system/${savedId}`);
            else system.reload();
          }}
          cancel={() => (isNew ? go(`#/client/${clientId}`) : setEditing(false))}
        />
      </>
    );
  if (!s) return null;

  const sys = toDomain(s);
  const st = toSettings(settings.value ?? null);
  const info = systemInfo(sys, (history.value ?? []).map(toJob), st, todayIso());
  const status = dueStatus(sys, info, st, todayIso());
  const f = info.fgas;
  return (
    <>
      <PageHead
        back={back}
        title={s.name}
        sub={[s.site_address.split("\n")[0], s.site_postcode].filter(Boolean).join(", ") || " "}
      >
        <span className={`pill ${status.tone}`}>{status.label}</span>
        <button className="btn" onClick={() => setEditing(true)}>
          <Icon name="edit" size={18} />
          Edit
        </button>
      </PageHead>
      <section className="card">
        {s.refrigerant && f.kg > 0 && (
          <div className="fgas">
            <div>
              <span className="fgas-n">{s.refrigerant}</span>
              <span className="fgas-l">Refrigerant</span>
            </div>
            <div>
              <span className="fgas-n">{f.kg} kg</span>
              <span className="fgas-l">Charge</span>
            </div>
            <div>
              <span className="fgas-n">{f.tonnesCo2e.toFixed(2)} t</span>
              <span className="fgas-l">CO₂e</span>
            </div>
          </div>
        )}
        <dl className="facts">
          <Fact k="Site" v={[s.site_address, s.site_postcode].filter(Boolean).join(", ")} />
          <Fact k="Installed" v={s.install_date ? formatDate(s.install_date) : "Not set"} />
          <Fact k="Service every" v={plural(info.intervalMonths, "month")} />
          <Fact k="Last service" v={info.lastService ? formatDate(info.lastService) : ""} />
          <Fact k="Next service" v={info.nextDue ? formatDate(info.nextDue) : "Needs an install date"} />
          <Fact k="Warranty to" v={info.warrantyEnd ? formatDate(info.warrantyEnd) : ""} />
          <Fact
            k="Refrigerant"
            v={s.refrigerant ? `${s.refrigerant}, ${f.kg} kg (${f.tonnesCo2e.toFixed(2)} t CO₂e)` : ""}
          />
          <Fact
            k="F-gas leak checks"
            v={
              f.required
                ? `Every ${plural(f.months, "month")}, next ${info.nextLeakCheck ? formatDate(info.nextLeakCheck) : "needs an install date"}`
                : "Not required"
            }
          />
          <Fact k="Access" v={s.access_notes} />
          <Fact k="Notes" v={s.notes} />
        </dl>
      </section>
      {sticker && !adding && (
        <section className="card banner-card">
          <h2>
            New label <span className="uid">{sticker}</span>
          </h2>
          <p>
            Replacing a damaged or missing label? Choose the unit below and its history stays with it.
            Otherwise add it as a new unit.
          </p>
          <ErrorLine error={replacing.error} />
          <ul className="rows">
            {(units.value ?? []).map((u) => (
              <li key={u.id}>
                <div className="item">
                  <span className="main">
                    <span className="t">{unitTitle(u)}</span>
                    <span className="m">
                      Old label {u.sticker_code}
                      {u.location && ` · ${u.location}`}
                    </span>
                  </span>
                </div>
                <button
                  className="btn"
                  disabled={replacing.busy}
                  onClick={() =>
                    void replacing.run(async () => {
                      await assets.replaceSticker(u.id, sticker);
                      go(`#/u/${sticker}`);
                    })
                  }
                >
                  Put label on this unit
                </button>
              </li>
            ))}
          </ul>
          <button className="btn pri" onClick={() => setAdding(true)}>
            Add as a new unit
          </button>
        </section>
      )}
      <section className="card">
        <div className="row spread">
          <h2>Units</h2>
          <div className="row">
            {!!units.value?.length && (
              <button
                className="btn"
                disabled={printing.busy}
                onClick={() => {
                  const win = openPrintWindow();
                  void printing.run(async () => {
                    win.show(
                      labelSheetHtml(
                        units.value ?? [],
                        s,
                        info.nextDue,
                        await brandFor(assets, businessName),
                      ),
                    );
                  });
                }}
              >
                <Icon name="print" size={18} />
                Print unit labels
              </button>
            )}
            {!adding && (
              <button className="btn pri" onClick={() => setAdding(true)}>
                <Icon name="plus" size={18} />
                Add unit
              </button>
            )}
          </div>
        </div>
        <ErrorLine error={printing.error} />
        {adding && (
          <UnitForm
            assets={assets}
            systemId={s.id}
            sticker={sticker}
            unit={null}
            done={() => {
              setAdding(false);
              units.reload();
            }}
            cancel={() => setAdding(false)}
          />
        )}
        {units.value?.length === 0 && !adding && (
          <Empty icon="sticker" title="No units yet">
            Scan the asset label on the unit, or add it here and print one.
          </Empty>
        )}
        <ul className="rows">
          {(units.value ?? []).map((u) => (
            <li key={u.id}>
              <a href={`#/u/${u.sticker_code}`} className="item">
                <span className="assetno">#{u.asset_no}</span>
                <span className="main">
                  <span className="t">{unitTitle(u)}</span>
                  <span className="m">
                    {u.sticker_code} · {u.location || (u.role === "indoor" ? "Indoor" : "Outdoor")}
                  </span>
                </span>
                <Icon name="chevron" size={18} />
              </a>
            </li>
          ))}
        </ul>
      </section>
      <SystemJobs jobs={jobs} systemId={s.id} />
      <SiteRecords assets={assets} systemId={s.id} units={units.value ?? []} author={author} />
    </>
  );
}

function SystemForm(p: {
  assets: Assets;
  system: SystemRow | null;
  client: ClientRow | null;
  done: (id: string) => void;
  cancel: () => void;
}) {
  const s = p.system;
  const { busy, error, run } = useAction();
  const [refrigerant, setRefrigerant] = useState(s?.refrigerant || "R32");
  const known = refrigerant in REFRIGERANT_GWP;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    const clientId = s?.client_id ?? p.client?.id;
    if (!clientId) return;
    void run(async () => {
      const id = await p.assets.saveSystem({
        id: s?.id,
        client_id: clientId,
        name: f.text("name"),
        site_address: f.text("site_address"),
        site_postcode: f.text("site_postcode").toUpperCase(),
        install_date: f.orNull("install_date"),
        commissioned_by: f.text("commissioned_by"),
        service_interval_months: f.num("service_interval_months"),
        warranty_years: f.num("warranty_years"),
        refrigerant: f.text("refrigerant"),
        gwp: known ? null : f.num("gwp"),
        factory_charge_kg: f.num("factory_charge_kg"),
        added_charge_kg: f.num("added_charge_kg"),
        hermetic: f.bool("hermetic"),
        leak_detection: f.bool("leak_detection"),
        access_notes: f.text("access_notes"),
        notes: f.text("notes"),
        inactive: f.bool("inactive"),
      });
      p.done(id);
    });
  }
  const preview = fgas({
    refrigerant,
    gwp: s?.gwp ?? null,
    factoryChargeKg: s?.factory_charge_kg ?? null,
    addedChargeKg: s?.added_charge_kg ?? null,
  });
  return (
    <form className="card form" onSubmit={submit}>
      <h2>{s ? "Edit details" : "Install details"}</h2>
      <ErrorLine error={error} />
      <Text name="name" label="Name (e.g. Office heat pumps)" value={s?.name} required />
      <Area name="site_address" label="Site address" value={s?.site_address ?? p.client?.billing_address} />
      <Text name="site_postcode" label="Site postcode" value={s?.site_postcode ?? p.client?.postcode} />
      <Text name="install_date" label="Install date" type="date" value={s?.install_date} required />
      <Text name="commissioned_by" label="Commissioned by" value={s?.commissioned_by} />
      <Text
        name="service_interval_months"
        label="Service every (months, blank = business default)"
        type="number"
        value={s?.service_interval_months}
      />
      <Text
        name="warranty_years"
        label="Warranty (years, blank = business default)"
        type="number"
        value={s?.warranty_years}
      />
      <label>
        Refrigerant
        <select
          name="refrigerant"
          value={refrigerant}
          onChange={(e) => setRefrigerant(e.currentTarget.value)}
        >
          {REFRIGERANTS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      {!known && <Text name="gwp" label="GWP" type="number" value={s?.gwp} />}
      <Text name="factory_charge_kg" label="Factory charge (kg)" type="number" value={s?.factory_charge_kg} />
      <Text name="added_charge_kg" label="Added on site (kg)" type="number" value={s?.added_charge_kg} />
      <Check name="hermetic" label="Hermetically sealed" value={s?.hermetic} />
      <Check name="leak_detection" label="Leak detection fitted" value={s?.leak_detection} />
      {s && preview.kg > 0 && (
        <p className="note">
          Saved charge: {preview.tonnesCo2e.toFixed(2)} t CO₂e, leak checks{" "}
          {preview.required ? `every ${plural(preview.months, "month")}` : "not required"}.
        </p>
      )}
      <Area name="access_notes" label="Access notes" value={s?.access_notes} />
      <Area name="notes" label="Notes" value={s?.notes} />
      {s && <Check name="inactive" label="Inactive (no reminders)" value={s.inactive} />}
      <FormButtons busy={busy} cancel={p.cancel} />
    </form>
  );
}

// ---------- units ----------

export const unitTitle = (u: Pick<UnitRow, "role" | "indoor_type" | "manufacturer" | "model">) =>
  [u.role === "indoor" ? u.indoor_type || "Indoor unit" : "Outdoor unit", u.manufacturer, u.model]
    .filter(Boolean)
    .join(" · ");

/** The page a QR sticker opens: #/u/AC-XXXXX. */
export function UnitPage({
  assets,
  code,
  businessName,
  author,
}: {
  assets: Assets;
  code: string;
  businessName: string;
  author: string;
}) {
  const unit = useLoad(() => assets.unitByCode(code), [assets, code]);
  const systemId = unit.value?.system_id;
  const system = useLoad(
    () => (systemId ? assets.system(systemId) : Promise.resolve(null)),
    [assets, systemId],
  );
  const [editing, setEditing] = useState(false);
  const printing = useAction();

  if (unit.error) return <ErrorLine error={unit.error} />;
  if (unit.value === undefined) return <Loading />;
  const u = unit.value;
  if (!u) return <RegisterSticker assets={assets} code={code} />;
  return (
    <>
      <PageHead
        back={system.value && { href: `#/system/${system.value.id}`, label: system.value.name }}
        title={unitTitle(u)}
        sub={
          <>
            <span className="assetno">Asset #{u.asset_no}</span> <span className="uid">{u.sticker_code}</span>
            {u.location && ` · ${u.location}`}
          </>
        }
      >
        {!editing && (
          <>
            {system.value && (
              <button
                className="btn"
                disabled={printing.busy}
                onClick={() => {
                  const sys = system.value;
                  if (!sys) return;
                  const win = openPrintWindow();
                  void printing.run(async () => {
                    const st = toSettings(await assets.ruleSettings());
                    const next = systemInfo(toDomain(sys), [], st, todayIso()).nextDue;
                    win.show(labelSheetHtml([u], sys, next, await brandFor(assets, businessName)));
                  });
                }}
              >
                <Icon name="print" size={18} />
                Print label
              </button>
            )}
            <button className="btn" onClick={() => setEditing(true)}>
              <Icon name="edit" size={18} />
              Edit
            </button>
          </>
        )}
      </PageHead>
      {editing ? (
        <div className="card">
          <UnitForm
            assets={assets}
            systemId={u.system_id}
            unit={u}
            done={() => {
              setEditing(false);
              unit.reload();
            }}
            cancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <section className="card">
          <ErrorLine error={printing.error} />
          <dl className="facts">
            <Fact k="Asset number" v={`#${u.asset_no}`} />
            <Fact k="Asset label" v={u.sticker_code} />
            <Fact k="Location" v={u.location} />
            <Fact k="Serial" v={u.serial} />
            <Fact k="Capacity" v={u.capacity_kw ? `${u.capacity_kw} kW` : ""} />
            <Fact k="Filter" v={u.filter_type ?? ""} />
            <Fact k="Controller" v={u.controller ?? ""} />
            <Fact k="Condensate pump" v={u.role === "indoor" ? (u.condensate_pump ? "Yes" : "No") : ""} />
            <Fact
              k="Install"
              v={
                system.value ? [system.value.name, system.value.site_postcode].filter(Boolean).join(", ") : ""
              }
            />
            <Fact k="Notes" v={u.notes} />
          </dl>
        </section>
      )}
      <SiteRecords assets={assets} systemId={u.system_id} units={[u]} unitId={u.id} author={author} />
    </>
  );
}

/** A scanned sticker that isn't on a unit yet: pick the install it's fitted to. */
function RegisterSticker({ assets, code }: { assets: Assets; code: string }) {
  const systems = useLoad(() => assets.allSystems(), [assets]);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = (systems.value ?? []).filter(
    (s) =>
      !needle ||
      [s.name, s.site_postcode, s.site_address, s.clients?.name ?? ""].some((v) =>
        v.toLowerCase().includes(needle),
      ),
  );
  return (
    <section className="card">
      <h2>
        New label <span className="uid">{code}</span>
      </h2>
      <p>
        This asset label isn't on a unit yet. Pick the install it's fitted to, then add the unit's details.
      </p>
      <ErrorLine error={systems.error} />
      <input
        type="search"
        className="search"
        aria-label="Search installs"
        placeholder="Search client, address or postcode"
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
      />
      <ul className="rows">
        {shown.slice(0, 12).map((s) => (
          <li key={s.id}>
            <div className="item">
              <span className="main">
                <span className="t">{s.clients?.name ?? "No client"}</span>
                <span className="m">
                  {[s.name, s.site_address.split("\n")[0], s.site_postcode].filter(Boolean).join(" · ")}
                </span>
              </span>
            </div>
            <a className="btn pri" href={`#/system/${s.id}?sticker=${code}`}>
              Add here
            </a>
          </li>
        ))}
      </ul>
      {systems.value?.length === 0 && (
        <p className="note">No installs yet. Add a client and an install first.</p>
      )}
      <a className="btn" href="#/client/new">
        It's for a new client
      </a>
    </section>
  );
}

function UnitForm(p: {
  assets: Assets;
  systemId: string;
  sticker?: string | null;
  unit: UnitRow | null;
  done: () => void;
  cancel: () => void;
}) {
  const u = p.unit;
  const { busy, error, setError, run } = useAction();
  const [role, setRole] = useState<"indoor" | "outdoor">(u?.role ?? "indoor");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = readForm(e.currentTarget);
    const typed = f.text("sticker_code");
    const code = typed ? parseScan(typed) : "";
    if (code === null) return setError("That label code doesn't look right. They look like AC-7KQ2M.");
    void run(async () => {
      await p.assets.saveUnit({
        id: u?.id,
        system_id: p.systemId,
        sticker_code: u?.sticker_code ?? code,
        from_sticker: u?.from_sticker ?? !!code,
        role,
        indoor_type: f.orNull("indoor_type"),
        manufacturer: f.text("manufacturer"),
        model: f.text("model"),
        serial: f.text("serial"),
        capacity_kw: f.num("capacity_kw"),
        location: f.text("location"),
        filter_type: f.orNull("filter_type"),
        controller: f.orNull("controller"),
        condensate_pump: f.bool("condensate_pump"),
        notes: f.text("notes"),
      });
      p.done();
    });
  }
  return (
    <form className="subform" onSubmit={submit}>
      <h2>{u ? `Edit ${u.sticker_code}` : "New unit"}</h2>
      <ErrorLine error={error} />
      {!u && (
        <Text name="sticker_code" label="Pre-printed label code (blank = make a new one)" value={p.sticker} />
      )}
      <div className="row" role="radiogroup" aria-label="Unit type">
        {(["indoor", "outdoor"] as const).map((r) => (
          <label key={r} className="check">
            <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
            {r === "indoor" ? "Indoor" : "Outdoor"}
          </label>
        ))}
      </div>
      {role === "indoor" && (
        <Pick name="indoor_type" label="Indoor type" value={u?.indoor_type} options={INDOOR_TYPES} blank="" />
      )}
      <Text name="manufacturer" label="Manufacturer" value={u?.manufacturer} />
      <Text name="model" label="Model" value={u?.model} />
      <Text name="serial" label="Serial number" value={u?.serial} />
      <Text name="capacity_kw" label="Capacity (kW)" type="number" value={u?.capacity_kw} />
      <Text name="location" label="Location (e.g. Office 2)" value={u?.location} />
      {role === "indoor" && (
        <>
          <Pick name="filter_type" label="Filter" value={u?.filter_type} options={FILTER_TYPES} blank="" />
          <Pick name="controller" label="Controller" value={u?.controller} options={CONTROLLERS} blank="" />
          <Check name="condensate_pump" label="Condensate pump" value={u?.condensate_pump} />
        </>
      )}
      <Area name="notes" label="Notes" value={u?.notes} />
      <FormButtons busy={busy} cancel={p.cancel} />
    </form>
  );
}

// ---------- bits ----------

function Fact({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function FormButtons({ busy, cancel }: { busy: boolean; cancel: () => void }) {
  return (
    <div className="row">
      <button className="btn pri" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button className="btn" type="button" onClick={cancel}>
        Cancel
      </button>
    </div>
  );
}

function NotFound({ what }: { what: string }) {
  return (
    <section className="card">
      <h1>Not found</h1>
      <p>
        That {what} doesn't exist in this business, or it's been deleted.{" "}
        <a href="#/clients">Back to clients</a>
      </p>
    </section>
  );
}
