// The Stickers section: scan or type a code, print blank sheets, order durable stickers, and every sticker in use.
import { parseScan } from "@airledger/domain";
import { useState, type FormEvent } from "react";
import type { Assets } from "../assets";
import { Icon } from "../icons";
import { openPrintWindow, stickerOrderCsv, stickerSheetHtml } from "../print";
import { decodePhoto } from "../scan";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { brandFor, go, todayIso, unitTitle, useLoad } from "./Assets";

const UNREADABLE =
  "Couldn't read a sticker in that photo. Get closer so the QR code fills the picture, or type the code.";

/** Reads a QR code from a camera photo and opens that unit. */
function useScan() {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  async function photo(file: File | undefined): Promise<boolean> {
    if (!file) return true;
    setReading(true);
    setError("");
    try {
      const code = parseScan(await decodePhoto(file));
      if (code) {
        go(`#/u/${code}`);
        return true;
      }
      setError(UNREADABLE);
    } catch {
      setError("Couldn't read that photo. Type the code instead.");
    } finally {
      setReading(false);
    }
    return false;
  }
  return { reading, error, setError, photo };
}

/** The Scan button in the header. If the photo can't be read, the Stickers page says why. */
export function ScanButton() {
  const scan = useScan();
  return (
    <label className="scanbtn">
      <Icon name="scan" size={18} />
      <span>{scan.reading ? "Reading…" : "Scan"}</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label="Scan a sticker with the camera"
        onChange={(e) => {
          const input = e.currentTarget;
          void scan.photo(input.files?.[0]).then((ok) => {
            input.value = "";
            if (!ok) go("#/stickers?unread=1");
          });
        }}
      />
    </label>
  );
}

/** Scan with the camera, or type a code. */
export function ScanBox({ unread = false }: { unread?: boolean }) {
  const scan = useScan();
  const error = scan.error || (unread ? UNREADABLE : "");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = parseScan(String(new FormData(e.currentTarget).get("code") ?? ""));
    if (!code) return scan.setError("That doesn't look like a sticker code. They look like AC-7KQ2M.");
    scan.setError("");
    go(`#/u/${code}`);
  }
  return (
    <form className="card scanhero" onSubmit={submit}>
      <div className="scanhero-top">
        <span className="scanhero-ic">
          <Icon name="scan" size={26} />
        </span>
        <div>
          <h2>Find a unit</h2>
          <p>Scan the sticker on any indoor or outdoor unit to open its history.</p>
        </div>
      </div>
      <ErrorLine error={error} />
      <label className="btn air wide">
        <Icon name="scan" />
        {scan.reading ? "Reading…" : "Scan a sticker"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          aria-label="Photo of a sticker"
          onChange={(e) => void scan.photo(e.currentTarget.files?.[0])}
        />
      </label>
      <div className="or">
        <span>or type the code</span>
      </div>
      <div className="codebox">
        <label>
          <span className="sr">Sticker code or link</span>
          <input name="code" className="mono" placeholder="AC-XXXXX" autoCapitalize="characters" required />
        </label>
        <button className="btn" type="submit">
          Open unit
        </button>
      </div>
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
    <section className="card tool">
      <div className="tool-head">
        <span className="tool-ic">
          <Icon name="print" />
        </span>
        <div>
          <h2>Print blank stickers</h2>
          <p className="note">
            A4 sheets of 21 (Avery L7160, 63.5 × 38.1 mm). Each sticker gets its own code. Use weatherproof
            labels outdoors.
          </p>
        </div>
      </div>
      <ErrorLine error={error} />
      <div className="tool-foot">
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
          <Icon name="print" size={18} />
          {busy ? "Preparing…" : "Print stickers"}
        </button>
      </div>
    </section>
  );
}

/** Owner only: reserve codes in bulk and download them for a print company making durable stickers. */
export function OrderStickers({ assets, reserved }: { assets: Assets; reserved: () => void }) {
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
      reserved();
    });
  }
  return (
    <section className="card tool">
      <div className="tool-head">
        <span className="tool-ic">
          <Icon name="download" />
        </span>
        <div>
          <h2>Order from a printer</h2>
          <p className="note">
            For durable outdoor stickers. Air Ledger reserves the codes for your business and gives you a
            spreadsheet of codes and QR links for the printer. Each code works once, in your business only.
          </p>
        </div>
      </div>
      <ErrorLine error={error} />
      {done && <p className="ok">{done}</p>}
      <div className="tool-foot">
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
          <Icon name="download" size={18} />
          {busy ? "Reserving…" : "Reserve and download"}
        </button>
      </div>
    </section>
  );
}

export function StickersPage(p: { assets: Assets; businessName: string; owner: boolean; unread: boolean }) {
  const stickers = useLoad(() => p.assets.stickers(), [p.assets]);
  const reserved = useLoad(() => p.assets.reservedCount(), [p.assets]);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = stickers.value ?? [];
  const shown = list.filter(
    (s) =>
      !needle ||
      [s.sticker_code, s.location, s.manufacturer, s.model, s.systems?.name, s.systems?.clients?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
  );
  const spare = reserved.value === undefined ? undefined : Math.max(0, reserved.value - list.length);
  return (
    <>
      <PageHead
        title="Stickers"
        sub="Scan, print and order the QR stickers that link each unit to its history."
      />
      <div className="split">
        <ScanBox unread={p.unread} />
        <div className="kpis two">
          <div className="kpi">
            <span className="kpi-n">{stickers.value ? list.length : "–"}</span>
            <span className="kpi-l">On units</span>
          </div>
          <div className="kpi">
            <span className="kpi-n">{spare ?? "–"}</span>
            <span className="kpi-l">Spare codes</span>
          </div>
          <div className="kpi wide soon">
            <span className="tool-ic">
              <Icon name="palette" />
            </span>
            <div>
              <b>Design your own sticker</b>
              <span className="note">
                Coming soon: design a branded, weatherproof sticker here and order it through Air Ledger.
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="grid2">
        <BlankStickers assets={p.assets} businessName={p.businessName} />
        {p.owner && <OrderStickers assets={p.assets} reserved={reserved.reload} />}
      </div>
      <section className="card">
        <div className="row spread">
          <h2>Stickers in use</h2>
          {list.length > 0 && <span className="pill">{list.length}</span>}
        </div>
        <ErrorLine error={stickers.error} />
        {list.length > 5 && (
          <input
            type="search"
            className="search"
            aria-label="Search stickers"
            placeholder="Search code, client, install or location"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
          />
        )}
        {!stickers.value ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon="sticker" title="No stickers on units yet">
            Stick one on each unit you fit, then scan it to add the unit.
          </Empty>
        ) : shown.length === 0 ? (
          <Empty icon="sticker" title="No stickers match" />
        ) : (
          <ul className="rows">
            {shown.map((s) => (
              <li key={s.id}>
                <a className="item" href={`#/u/${s.sticker_code}`}>
                  <span className="uid">{s.sticker_code}</span>
                  <span className="main">
                    <span className="t">{unitTitle(s)}</span>
                    <span className="m">
                      {[s.systems?.clients?.name, s.systems?.name, s.location].filter(Boolean).join(" · ")}
                    </span>
                  </span>
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
