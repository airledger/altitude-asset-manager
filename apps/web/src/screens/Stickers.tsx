// The Stickers section: scan or type a code, print sheets, the way into the designer, and every sticker in use.
import { parseScan } from "@airledger/domain";
import { useState, type FormEvent } from "react";
import type { Business } from "../api";
import type { Assets } from "../assets";
import { Icon } from "../icons";
import { openPrintWindow, stickerSheetHtml } from "../print";
import { decodePhoto } from "../scan";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { artworkSvg, layoutSticker, readDesign } from "../sticker";
import { go, unitTitle, useLoad } from "./Assets";
import { useStickerBrand } from "./StickerDesigner";

const UNREADABLE =
  "Couldn't read a label in that photo. Get closer so the QR code fills the picture, or type the code.";

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
        aria-label="Scan an asset label with the camera"
        onChange={(e) => {
          const input = e.currentTarget;
          void scan.photo(input.files?.[0]).then((ok) => {
            input.value = "";
            if (!ok) go("#/labels?unread=1");
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
    if (!code) return scan.setError("That doesn't look like a label code. They look like AC-7KQ2M.");
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
          <p>Scan the asset label on any indoor or outdoor unit to open its history.</p>
        </div>
      </div>
      <ErrorLine error={error} />
      <label className="btn air wide">
        <Icon name="scan" />
        {scan.reading ? "Reading…" : "Scan a label"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          aria-label="Photo of an asset label"
          onChange={(e) => void scan.photo(e.currentTarget.files?.[0])}
        />
      </label>
      <div className="or">
        <span>or type the code</span>
      </div>
      <div className="codebox">
        <label>
          <span className="sr">Label code or link</span>
          <input name="code" className="mono" placeholder="AC-XXXXX" autoCapitalize="characters" required />
        </label>
        <button className="btn" type="submit">
          Open unit
        </button>
      </div>
    </form>
  );
}

/** Blank stickers in the business's design: codes are reserved on the server first, so no two sheets share one. */
export function BlankStickers({ assets, business }: { assets: Assets; business: Business }) {
  const [sheets, setSheets] = useState(1);
  const { brand, link, profile } = useStickerBrand(assets, business);
  const { busy, error, run } = useAction();
  function print() {
    const win = openPrintWindow();
    void run(async () => {
      try {
        const codes = await assets.reserveStickers(sheets * 21);
        win.show(stickerSheetHtml(codes, readDesign(profile.value?.sticker_design), brand, link));
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
          <h2>Print labels in the office</h2>
          <p className="note">
            Your design on A4 sheets of 21 (Avery L7160, 63.5 × 38.1 mm). Each label gets its own code. Use
            weatherproof labels outdoors.
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
                {n} ({n * 21} labels)
              </option>
            ))}
          </select>
        </label>
        <button className="btn pri" onClick={print} disabled={busy || !profile.value}>
          <Icon name="print" size={18} />
          {busy ? "Preparing…" : "Print labels"}
        </button>
      </div>
    </section>
  );
}

/** The way into the designer, with a small preview of the saved design. */
function DesignCard({ assets, business }: { assets: Assets; business: Business }) {
  const { brand, link, profile } = useStickerBrand(assets, business);
  const owner = business.role === "owner";
  const svg = profile.value
    ? artworkSvg(layoutSticker(readDesign(profile.value.sticker_design), brand, "AC-7KQ2M", link("AC-7KQ2M")))
    : "";
  return (
    <a className="card tool design-card" href="#/labels/design">
      <div className="tool-head">
        <span className="tool-ic">
          <Icon name="palette" />
        </span>
        <div>
          <h2>{owner ? "Design and order asset labels" : "Your label design"}</h2>
          <p className="note">
            {owner
              ? "Design your branded, weatherproof asset label, then get a print-ready PDF of new codes for your manufacturer."
              : "See the label your business uses."}
          </p>
        </div>
        <Icon name="chevron" />
      </div>
      {svg && <div className="mini-preview" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />}
    </a>
  );
}

export function StickersPage(p: { assets: Assets; business: Business; unread: boolean }) {
  const stickers = useLoad(() => p.assets.stickers(), [p.assets]);
  const reserved = useLoad(() => p.assets.reservedCount(), [p.assets]);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = stickers.value ?? [];
  const shown = list.filter(
    (s) =>
      !needle ||
      [
        s.sticker_code,
        `#${s.asset_no}`,
        s.location,
        s.manufacturer,
        s.model,
        s.systems?.name,
        s.systems?.clients?.name,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
  );
  const spare = reserved.value === undefined ? undefined : Math.max(0, reserved.value - list.length);
  return (
    <>
      <PageHead
        title="Asset labels"
        sub="Scan, print and order the QR labels that link each unit to its history."
      />
      <div className="split">
        <div className="stack">
          <ScanBox unread={p.unread} />
          <DesignCard assets={p.assets} business={p.business} />
        </div>
        <div className="stack">
          <div className="kpis two">
            <div className="kpi">
              <span className="kpi-n">{stickers.value ? list.length : "–"}</span>
              <span className="kpi-l">Assets</span>
            </div>
            <div className="kpi">
              <span className="kpi-n">{spare ?? "–"}</span>
              <span className="kpi-l">Spare codes</span>
            </div>
          </div>
          <BlankStickers assets={p.assets} business={p.business} />
        </div>
      </div>
      <section className="card">
        <div className="row spread">
          <h2>Labels in use</h2>
          {list.length > 0 && <span className="pill">{list.length}</span>}
        </div>
        <ErrorLine error={stickers.error} />
        {list.length > 5 && (
          <input
            type="search"
            className="search"
            aria-label="Search labels"
            placeholder="Search code, client, install or location"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
          />
        )}
        {!stickers.value ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon="sticker" title="No labels on units yet">
            Stick one on each unit you fit, then scan it to add the unit.
          </Empty>
        ) : shown.length === 0 ? (
          <Empty icon="sticker" title="No labels match" />
        ) : (
          <ul className="rows">
            {shown.map((s) => (
              <li key={s.id}>
                <a className="item" href={`#/u/${s.sticker_code}`}>
                  <span className="assetno">#{s.asset_no}</span>
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
