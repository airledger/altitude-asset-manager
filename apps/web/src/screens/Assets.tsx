import {
  dueStatus,
  fgas,
  formatDate,
  parseScan,
  REFRIGERANT_GWP,
  systemInfo,
  type IsoDate,
} from "@airledger/domain";
import { useEffect, useState, type FormEvent } from "react";
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
import {
  labelSheetHtml,
  openPrintWindow,
  stickerOrderCsv,
  stickerSheetHtml,
  type PrintBrand,
} from "../print";
import { decodePhoto } from "../scan";
import { SiteRecords } from "./SiteRecords";
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

// ---------- scan / type a sticker ----------

export function ScanBox() {
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  async function photo(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setError("");
    try {
      const code = parseScan(await decodePhoto(file));
      if (code) go(`#/u/${code}`);
      else
        setError(
          "Couldn't read a sticker in that photo. Get closer so the QR code fills the picture, or type the code.",
        );
    } catch {
      setError("Couldn't read that photo. Type the code instead.");
    } finally {
      setReading(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = parseScan(String(new FormData(e.currentTarget).get("code") ?? ""));
    if (!code) return setError("That doesn't look like a sticker code. They look like AC-7KQ2M.");
    setError("");
    go(`#/u/${code}`);
  }
  return (
    <form className="card" onSubmit={submit}>
      <h1>Find a unit</h1>
      <ErrorLine error={error} />
      <label className="btn pri wide">
        {reading ? "Reading…" : "Scan a sticker"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          aria-label="Photo of a sticker"
          onChange={(e) => void photo(e.currentTarget.files?.[0])}
        />
      </label>
      <label>
        Sticker code or link
        <input name="code" placeholder="AC-XXXXX" autoCapitalize="characters" required />
      </label>
      <button className="btn" type="submit">
        Open unit
      </button>
    </form>
  );
}

/** Blank stickers: codes are reserved on the server first, so no two sheets ever share a code. */
export function BlankStickers({ assets, businessName }: { assets: Assets; businessName: string }) {
  const [sheets, setSheets] = useState(1);
  const { busy, error, run } = useAction();
  function print() {
    const win = openPrintWindow();
    void run(async () => {
      try {
        const [codes, brand] = await Promise.all([
          assets.reserveStickers(sheets * 21),
          brandFor(assets, businessName),
        ]);
        win.show(stickerSheetHtml(codes, brand));
      } catch (e) {
        win.close();
        throw e;
      }
    });
  }
  return (
    <section className="card">
      <h1>Blank stickers</h1>
      <p className="note">
        Each sticker gets its own code. Stick one on every unit you fit, then scan it to add the unit. Prints
        on A4 sheets of 21 (Avery L7160, 63.5 × 38.1 mm); use weatherproof labels outdoors.
      </p>
      <ErrorLine error={error} />
      <div className="row">
        <label>
          Sheets
          <select value={sheets} onChange={(e) => setSheets(Number(e.currentTarget.value))}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} ({n * 21} stickers)
              </option>
            ))}
          </select>
        </label>
        <button className="btn pri" onClick={print} disabled={busy}>
          {busy ? "Preparing…" : "Print stickers"}
        </button>
      </div>
    </section>
  );
}

/** Owner only: reserve codes in bulk and download them for a print company making durable stickers. */
export function OrderStickers({ assets }: { assets: Assets }) {
  const [count, setCount] = useState(500);
  const [done, setDone] = useState("");
  const { busy, error, setError, run } = useAction();
  function order() {
    if (!Number.isInteger(count) || count < 1 || count > 5000)
      return setError("Choose between 1 and 5,000 stickers.");
    setDone("");
    void run(async () => {
      const [codes, settings] = await Promise.all([assets.reserveStickers(count), assets.ruleSettings()]);
      const csv = stickerOrderCsv(codes, settings?.app_url || "https://app.airledger.co.uk");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = `air-ledger-sticker-codes-${todayIso()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setDone(
        `${codes.length} codes reserved for your business and downloaded. Send the file to your sticker printer.`,
      );
    });
  }
  return (
    <section className="card">
      <h1>Order stickers from a printer</h1>
      <p className="note">
        For durable outdoor stickers made by a print company. Air Ledger reserves the codes for your business
        and gives you a spreadsheet of codes and QR links to send them. Each code works once, in your business
        only.
      </p>
      <ErrorLine error={error} />
      {done && <p className="ok">{done}</p>}
      <div className="row">
        <label>
          How many
          <input
            type="number"
            min={1}
            max={5000}
            value={count}
            onChange={(e) => setCount(Number(e.currentTarget.value))}
          />
        </label>
        <button className="btn pri" onClick={order} disabled={busy}>
          {busy ? "Reserving…" : "Reserve and download"}
        </button>
      </div>
    </section>
  );
}

async function brandFor(assets: Assets, businessName: string): Promise<PrintBrand> {
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
    <section className="card">
      <div className="row spread">
        <h1>Clients</h1>
        <a className="btn pri" href="#/client/new">
          Add client
        </a>
      </div>
      <ErrorLine error={error} />
      <input
        type="search"
        aria-label="Search clients"
        placeholder="Search name, contact or postcode"
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
      />
      {!clients ? (
        <p className="note">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="note">{clients.length ? "No clients match." : "No clients yet. Add your first one."}</p>
      ) : (
        <ul className="list">
          {shown.map((c) => (
            <li key={c.id}>
              <a href={`#/client/${c.id}`} className="item">
                <b>{c.name}</b>
                <span className="note">
                  {[c.postcode, plural(c.systems[0]?.count ?? 0, "install")].filter(Boolean).join(" · ")}
                  {c.on_service_plan && " · Service plan"}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ClientPage({ assets, id }: { assets: Assets; id: string }) {
  const isNew = id === "new";
  const client = useLoad(() => (isNew ? Promise.resolve(null) : assets.client(id)), [assets, id]);
  const systems = useLoad(() => (isNew ? Promise.resolve([]) : assets.systems(id)), [assets, id]);
  const settings = useLoad(() => assets.ruleSettings(), [assets]);
  const [editing, setEditing] = useState(false);

  if (!isNew && client.value === undefined) return <p className="note">Loading…</p>;
  if (!isNew && !client.value) return <NotFound what="client" />;
  const c = client.value ?? null;

  return (
    <>
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
            <div className="row spread">
              <h1>{c.name}</h1>
              <button className="btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            </div>
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
      {c && (
        <section className="card">
          <div className="row spread">
            <h1>Installs</h1>
            <a className="btn pri" href={`#/system/new?client=${c.id}`}>
              Add install
            </a>
          </div>
          {systems.value?.length === 0 && <p className="note">No installs yet.</p>}
          <ul className="list">
            {(systems.value ?? []).map((s) => {
              const sys = toDomain(s);
              const st = toSettings(settings.value ?? null);
              const status = dueStatus(sys, systemInfo(sys, [], st, todayIso()), st, todayIso());
              return (
                <li key={s.id}>
                  <a href={`#/system/${s.id}`} className="item">
                    <b>{s.name}</b>
                    <span className="note">
                      {[s.site_postcode, s.refrigerant].filter(Boolean).join(" · ")}
                    </span>
                  </a>
                  <span className={`pill ${status.tone}`}>{status.label}</span>
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
    <form className="card" onSubmit={submit}>
      <h1>{c ? "Edit client" : "New client"}</h1>
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
  id,
  clientId,
  sticker,
  businessName,
  author,
}: {
  assets: Assets;
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
  const ownerId = system.value?.client_id ?? clientId;
  const client = useLoad(() => (ownerId ? assets.client(ownerId) : Promise.resolve(null)), [assets, ownerId]);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const replacing = useAction();
  const printing = useAction();

  if (!isNew && system.value === undefined) return <p className="note">Loading…</p>;
  if (!isNew && !system.value) return <NotFound what="install" />;
  if (isNew && !clientId) return <NotFound what="client" />;
  const s = system.value ?? null;
  const back = client.value && (
    <a className="back" href={`#/client/${client.value.id}`}>
      ← {client.value.name}
    </a>
  );

  if (isNew || editing)
    return (
      <>
        {back}
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
  const info = systemInfo(sys, [], st, todayIso());
  const status = dueStatus(sys, info, st, todayIso());
  const f = info.fgas;
  return (
    <>
      {back}
      <section className="card">
        <div className="row spread">
          <h1>{s.name}</h1>
          <button className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
        <span className={`pill ${status.tone}`}>{status.label}</span>
        <dl className="facts">
          <Fact k="Site" v={[s.site_address, s.site_postcode].filter(Boolean).join(", ")} />
          <Fact k="Installed" v={s.install_date ? formatDate(s.install_date) : "Not set"} />
          <Fact k="Service every" v={plural(info.intervalMonths, "month")} />
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
          <h1>New sticker {sticker}</h1>
          <p>
            Replacing a damaged or missing sticker? Choose the unit below and its history stays with it.
            Otherwise add it as a new unit.
          </p>
          <ErrorLine error={replacing.error} />
          <ul className="list">
            {(units.value ?? []).map((u) => (
              <li key={u.id}>
                <div className="item">
                  <b>{unitTitle(u)}</b>
                  <span className="note">
                    Old sticker {u.sticker_code}
                    {u.location && ` · ${u.location}`}
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
                  Put sticker on this unit
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
          <h1>Units</h1>
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
                Print labels
              </button>
            )}
            {!adding && (
              <button className="btn pri" onClick={() => setAdding(true)}>
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
        {units.value?.length === 0 && !adding && <p className="note">No units yet.</p>}
        <ul className="list">
          {(units.value ?? []).map((u) => (
            <li key={u.id}>
              <a href={`#/u/${u.sticker_code}`} className="item">
                <b>{unitTitle(u)}</b>
                <span className="note">
                  {u.sticker_code}
                  {u.location && ` · ${u.location}`}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
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
    <form className="card" onSubmit={submit}>
      <h1>{s ? "Edit install" : "New install"}</h1>
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

export const unitTitle = (u: UnitRow) =>
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
  if (unit.value === undefined) return <p className="note">Loading…</p>;
  const u = unit.value;
  if (!u) return <RegisterSticker assets={assets} code={code} />;
  return (
    <>
      {system.value && (
        <a className="back" href={`#/system/${system.value.id}`}>
          ← {system.value.name}
        </a>
      )}
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
          <div className="row spread">
            <h1>{unitTitle(u)}</h1>
            <div className="row">
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
                  Print label
                </button>
              )}
              <button className="btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            </div>
          </div>
          <ErrorLine error={printing.error} />
          <dl className="facts">
            <Fact k="Sticker" v={u.sticker_code} />
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
      <h1>New sticker {code}</h1>
      <p>This sticker isn't on a unit yet. Pick the install it's fitted to, then add the unit's details.</p>
      <ErrorLine error={systems.error} />
      <input
        type="search"
        aria-label="Search installs"
        placeholder="Search client, address or postcode"
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
      />
      <ul className="list">
        {shown.slice(0, 12).map((s) => (
          <li key={s.id}>
            <div className="item">
              <b>{s.clients?.name ?? "No client"}</b>
              <span className="note">{[s.name, s.site_postcode].filter(Boolean).join(" · ")}</span>
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
    if (code === null) return setError("That sticker code doesn't look right. They look like AC-7KQ2M.");
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
        <Text
          name="sticker_code"
          label="Pre-printed sticker code (blank = make a new one)"
          value={p.sticker}
        />
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
