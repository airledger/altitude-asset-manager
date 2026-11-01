// Sticker designer (#/stickers/design): the business designs its sticker with a live preview, saves it, and
// owners order batches. Air Ledger reserves each batch's codes for the business and makes the print-ready PDF.
import { useEffect, useMemo, useState } from "react";
import type { Business } from "../api";
import type { Assets, StickerBatch } from "../assets";
import { Icon } from "../icons";
import { stickerOrderCsv, unitLink } from "../print";
import {
  artworkSvg,
  layoutSticker,
  readDesign,
  roughMeasure,
  STICKER_COLOURS,
  STICKER_SIZES,
  STICKER_STYLES,
  type Measure,
  type StickerBrand,
  type StickerDesign,
  type StickerSize,
  type StickerStyle,
} from "../sticker";
import { BLEED, download, loadLogo, loadMeasure, stickerPdf } from "../stickerPdf";
import { Empty, Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { todayIso, useLoad } from "./Assets";

const LIVE_APP = "https://app.airledger.co.uk";
const SAMPLE = "AC-7KQ2M";

/** The business's details as they go on a sticker, with the logo ready for a PDF. */
export function useStickerBrand(assets: Assets, business: Business) {
  const profile = useLoad(() => assets.profile(), [assets]);
  const [logo, setLogo] = useState<StickerBrand["logo"]>(null);
  useEffect(() => {
    let live = true;
    if (business.logoUrl) void loadLogo(business.logoUrl).then((l) => live && setLogo(l));
    return () => {
      live = false;
    };
  }, [business.logoUrl]);
  const p = profile.value;
  const brand: StickerBrand = {
    businessName: p?.trading_as || business.name,
    phone: p?.phone ?? "",
    website: (p?.website ?? "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
    logo,
  };
  const appUrl = p?.app_url || LIVE_APP;
  const link = (code: string) => unitLink(code, appUrl);
  return { profile, brand, link, appUrl };
}

export function StickerDesigner({ assets, business }: { assets: Assets; business: Business }) {
  const owner = business.role === "owner";
  const { profile, brand, link, appUrl } = useStickerBrand(assets, business);
  const [edited, setEdited] = useState<StickerDesign | null>(null);
  const [measure, setMeasure] = useState<Measure>(() => roughMeasure);
  const saving = useAction();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadMeasure().then(
      (m) => setMeasure(() => m),
      () => undefined,
    );
  }, []);

  const d = edited ?? (profile.value ? readDesign(profile.value.sticker_design) : null);
  const svg = useMemo(
    () => (d ? artworkSvg(layoutSticker(d, brand, SAMPLE, link(SAMPLE), measure)) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, brand.businessName, brand.phone, brand.website, brand.logo, measure, profile.value?.app_url],
  );

  if (profile.error) return <ErrorLine error={profile.error} />;
  if (!d) return <Loading />;
  const size = STICKER_SIZES[d.size];
  const set = (patch: Partial<StickerDesign>) => {
    setSaved(false);
    setEdited({ ...d, ...patch });
  };
  const missing = [
    d.phone && !brand.phone && "phone number",
    d.website && !brand.website && "website",
    d.logo && !business.logoUrl && "logo",
  ].filter(Boolean);

  return (
    <>
      <PageHead
        back={{ href: "#/labels", label: "Asset labels" }}
        title="Label designer"
        sub="Design your business's QR asset label. Every label you order or print uses it."
      >
        {owner && (
          <button
            className="btn pri"
            disabled={saving.busy}
            onClick={() =>
              void saving.run(async () => {
                await assets.saveProfile({ sticker_design: d });
                setSaved(true);
              })
            }
          >
            <Icon name="check" size={18} />
            {saving.busy ? "Saving…" : "Save design"}
          </button>
        )}
      </PageHead>
      <ErrorLine error={saving.error} />
      {saved && <p className="ok">Design saved. New labels will use it.</p>}
      <div className="designer">
        <section className="card preview-card">
          <div className="preview-stage">
            <div
              className="preview"
              style={{ width: `${size.w * 4.4}px` }}
              role="img"
              aria-label={`Label preview, ${size.label}`}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
          <p className="note centre">
            {size.label} · shown with a sample code. Each label gets its own code and QR.
          </p>
          {missing.length > 0 && (
            <p className="banner">
              Add your {missing.join(", ")} on the <a href="#/business">Business</a> tab to show{" "}
              {missing.length > 1 ? "them" : "it"} on the label.
            </p>
          )}
        </section>
        <fieldset className="card controls" disabled={!owner}>
          {!owner && <p className="note">Only an owner can change the design.</p>}
          <div className="ctl">
            <span className="ctl-l">Size and shape</span>
            <div className="chips">
              {(Object.keys(STICKER_SIZES) as StickerSize[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="chip"
                  aria-pressed={d.size === k}
                  onClick={() => set({ size: k })}
                >
                  {STICKER_SIZES[k].round ? "● " : "▬ "}
                  {STICKER_SIZES[k].label}
                </button>
              ))}
            </div>
          </div>
          <div className="ctl">
            <span className="ctl-l">Style</span>
            <div className="chips">
              {(Object.keys(STICKER_STYLES) as StickerStyle[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="chip"
                  aria-pressed={d.style === k}
                  onClick={() => set({ style: k })}
                >
                  {STICKER_STYLES[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="ctl">
            <span className="ctl-l">Colour</span>
            <div className="swatches">
              {STICKER_COLOURS.map(([name, hex]) => (
                <button
                  key={hex}
                  type="button"
                  className="swatch"
                  style={{ background: hex }}
                  aria-label={name}
                  aria-pressed={d.colour.toLowerCase() === hex.toLowerCase()}
                  onClick={() => set({ colour: hex })}
                />
              ))}
              <label className="swatch custom" title="Your own colour">
                <span className="sr">Your own colour</span>
                <input
                  type="color"
                  value={d.colour}
                  onChange={(e) => set({ colour: e.currentTarget.value })}
                />
              </label>
            </div>
          </div>
          <div className="ctl">
            <span className="ctl-l">Show on the label</span>
            <div className="toggles">
              {(
                [
                  ["logo", "Logo"],
                  ["name", "Business name"],
                  ["phone", "Phone number"],
                  ["website", "Website"],
                  ["fgas", "F-gas box"],
                  ["rounded", "Rounded corners"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="check">
                  <input
                    type="checkbox"
                    checked={d[k]}
                    onChange={(e) => set({ [k]: e.currentTarget.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <label>
            Main line
            <input
              value={d.headline}
              maxLength={40}
              onChange={(e) => set({ headline: e.currentTarget.value })}
              placeholder="Scan for service history"
            />
          </label>
          <label>
            Extra line (optional)
            <input
              value={d.extra}
              maxLength={40}
              onChange={(e) => set({ extra: e.currentTarget.value })}
              placeholder="e.g. 24-hour breakdown cover"
            />
          </label>
        </fieldset>
      </div>
      {owner && <OrderBatch assets={assets} design={d} brand={brand} link={link} appUrl={appUrl} />}
    </>
  );
}

function OrderBatch(p: {
  assets: Assets;
  design: StickerDesign;
  brand: StickerBrand;
  link: (code: string) => string;
  appUrl: string;
}) {
  const batches = useLoad(() => p.assets.stickerBatches(), [p.assets]);
  const [count, setCount] = useState(500);
  const [note, setNote] = useState("");
  const [done, setDone] = useState("");
  const making = useAction();
  const again = useAction();
  const size = STICKER_SIZES[p.design.size];
  const fileName = (n: number, date: string) =>
    `${
      p.brand.businessName
        .replace(/[^\w]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "air-ledger"
    }-asset-labels-${n}-${date}`;

  // One download per tap: browsers (Safari especially) drop a second download started by the same tap.
  async function pdfFile(codes: string[], design: StickerDesign, date: string) {
    download(await stickerPdf(design, p.brand, codes, p.link), `${fileName(codes.length, date)}.pdf`);
  }
  function csvFile(codes: string[], date: string) {
    download(
      new Blob([stickerOrderCsv(codes, p.appUrl)], { type: "text/csv" }),
      `${fileName(codes.length, date)}-codes.csv`,
    );
  }

  function order() {
    if (!Number.isInteger(count) || count < 1 || count > 5000)
      return making.setError("Choose between 1 and 5,000 labels.");
    setDone("");
    void making.run(async () => {
      const id = await p.assets.createStickerBatch(count, p.design, note.trim());
      const codes = await p.assets.batchCodes(id);
      await pdfFile(codes, p.design, todayIso());
      setDone(
        `${codes.length} new codes reserved for your business and the print-ready PDF has downloaded. It's also under Past orders, with the list of codes.`,
      );
      setNote("");
      batches.reload();
    });
  }

  return (
    <div className="grid2">
      <section className="card tool">
        <div className="tool-head">
          <span className="tool-ic">
            <Icon name="download" />
          </span>
          <div>
            <h2>Order asset labels</h2>
            <p className="note">
              Air Ledger creates new codes for your business only and makes a print-ready PDF in this design:
              one label per page, {size.label}, with {BLEED} mm bleed. Send it to your label manufacturer.
            </p>
          </div>
        </div>
        <ErrorLine error={making.error} />
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
          <label>
            Note (optional)
            <input
              value={note}
              maxLength={100}
              placeholder="e.g. Van stock"
              onChange={(e) => setNote(e.currentTarget.value)}
            />
          </label>
        </div>
        <button className="btn pri wide" onClick={order} disabled={making.busy}>
          <Icon name="download" size={18} />
          {making.busy
            ? "Making your PDF…"
            : `Create ${count > 0 ? count.toLocaleString("en-GB") : ""} labels (PDF)`}
        </button>
        <p className="note small">
          For outdoor units, ask for waterproof, UV-resistant vinyl or polyester with a protective laminate,
          cut to the {size.round ? "circle" : "rectangle"}.
        </p>
      </section>
      <section className="card">
        <h2>Past orders</h2>
        <ErrorLine error={again.error} />
        {!batches.value ? (
          <Loading />
        ) : batches.value.length === 0 ? (
          <Empty icon="sticker" title="No orders yet">
            Each order is kept here so you can download its PDF again.
          </Empty>
        ) : (
          <ul className="rows">
            {batches.value.map((b: StickerBatch) => {
              const date = b.created_at.slice(0, 10);
              const bd = readDesign(b.design);
              return (
                <li key={b.id}>
                  <div className="item">
                    <span className="main">
                      <span className="t">
                        {b.quantity.toLocaleString("en-GB")} labels · {STICKER_SIZES[bd.size].label}
                      </span>
                      <span className="m">
                        {new Date(b.created_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        {b.note && ` · ${b.note}`}
                      </span>
                    </span>
                  </div>
                  <button
                    className="btn"
                    disabled={again.busy}
                    onClick={() =>
                      void again.run(async () => pdfFile(await p.assets.batchCodes(b.id), bd, date))
                    }
                  >
                    <Icon name="download" size={18} />
                    PDF
                  </button>
                  <button
                    className="btn"
                    disabled={again.busy}
                    onClick={() => void again.run(async () => csvFile(await p.assets.batchCodes(b.id), date))}
                  >
                    CSV
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
