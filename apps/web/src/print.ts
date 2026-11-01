// Printable sticker and label sheets (spec 03, F7). Same sizes as the live app: blank stickers on Avery L7160
// (21 per A4 sheet, 63.5 × 38.1 mm) and unit labels at 95 × 52 mm. Stickers link to `<app>/u/<code>`, a real
// path that can be redirected for as long as the domain lives (spec 05); old `#u-<code>` stickers still work.
import { fgas, formatDate } from "@airledger/domain";
import qrcode from "qrcode-generator";
import type { SystemRow, UnitRow } from "./assets";

export interface PrintBrand {
  businessName: string;
  phone: string;
  /** Base address QR codes open. Blank = this app's own address. */
  appUrl: string;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

export function unitLink(code: string, appUrl = ""): string {
  const base = (appUrl || window.location.origin).replace(/#.*$/, "").replace(/\/+$/, "");
  return `${base}/u/${code}`;
}

/** A QR code as an SVG string. */
export function qrSvg(text: string): string {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const m = 2;
  const size = n + m * 2;
  let d = "";
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

const doc = (title: string, css: string, body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000}${css}.hint{text-align:center;font:10pt Arial;color:#555;margin:4mm}@media print{.hint{display:none}}</style></head><body>${body}</body></html>`;

/** Reserved codes and their QR links, for a print company to make stickers from. */
export function stickerOrderCsv(codes: string[], appUrl: string): string {
  return ["Code,QR link", ...codes.map((c) => `${c},${unitLink(c, appUrl)}`)].join("\r\n") + "\r\n";
}

/** Blank asset stickers, 21 to an A4 sheet. */
export function stickerSheetHtml(codes: string[], brand: PrintBrand): string {
  const sticker = (code: string) =>
    `<div class="st"><div class="q">${qrSvg(unitLink(code, brand.appUrl))}</div><div class="tx"><div class="br">${esc(brand.businessName.toUpperCase())}</div><div class="id">${esc(code)}</div><div>Scan for service history</div><div class="fg">Contains fluorinated greenhouse gases<br>Gas ______ Charge ______ kg</div>${brand.phone ? `<div><b>${esc(brand.phone)}</b></div>` : ""}</div></div>`;
  const pages: string[] = [];
  for (let i = 0; i < codes.length; i += 21)
    pages.push(
      `<div class="page">${codes
        .slice(i, i + 21)
        .map(sticker)
        .join("")}</div>`,
    );
  return doc(
    "Asset stickers",
    `@page{size:A4;margin:0}.page{width:210mm;height:297mm;padding:15.1mm 7.2mm 0;box-sizing:border-box;display:grid;grid-template-columns:repeat(3,63.5mm);grid-auto-rows:38.1mm;column-gap:2.5mm;page-break-after:always}
    .st{display:flex;gap:2mm;padding:2.5mm;box-sizing:border-box;overflow:hidden;outline:1px dotted #ccc}.q{width:31mm;height:31mm;flex:none}.q svg{width:100%;height:100%}
    .tx{font-size:6pt;line-height:1.3;min-width:0}.br{font-weight:bold;letter-spacing:.4pt;font-size:5.6pt}.id{font:bold 10.5pt monospace;margin:.6mm 0}
    .fg{border:.3mm solid #000;padding:.6mm;margin:.8mm 0;font-size:5.2pt}@media print{.st{outline:none}}`,
    `<div class="hint">Print at 100% (no scaling) on A4 sheets of 21 labels, 63.5 × 38.1 mm (Avery L7160).</div>${pages.join("")}`,
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Labels for registered units, with make, model, refrigerant and service due. */
export function labelSheetHtml(
  units: UnitRow[],
  system: SystemRow,
  nextDue: string | null,
  brand: PrintBrand,
): string {
  const f = fgas({
    refrigerant: system.refrigerant,
    gwp: system.gwp,
    factoryChargeKg: system.factory_charge_kg,
    addedChargeKg: system.added_charge_kg,
  });
  const due = nextDue ? `${MONTHS[Number(nextDue.slice(5, 7)) - 1] ?? ""} ${nextDue.slice(0, 4)}` : "—";
  const label = (u: UnitRow) => {
    const kind = u.role === "indoor" ? u.indoor_type || "Indoor unit" : "Outdoor unit";
    return `<div class="lab"><div class="q">${qrSvg(unitLink(u.sticker_code, brand.appUrl))}</div><div class="tx">
    <div class="br">${esc(brand.businessName.toUpperCase())}</div><div class="id">${esc(u.sticker_code)}</div>
    <div class="ln"><b>${esc(kind)}</b>${u.location ? " · " + esc(u.location) : ""}</div>
    <div class="ln">${esc(u.manufacturer)} ${esc(u.model)}</div>${u.serial ? `<div class="ln">S/N ${esc(u.serial)}</div>` : ""}
    <div class="fg">Contains fluorinated greenhouse gases<br>${esc(system.refrigerant)} · ${f.kg.toFixed(2)} kg · GWP ${f.gwp} · ${f.tonnesCo2e.toFixed(2)} t CO₂e</div>
    <div class="ln">Installed ${esc(system.install_date ? formatDate(system.install_date) : "—")} · Service due ${esc(due)}</div>
    ${brand.phone ? `<div class="ln"><b>Service: ${esc(brand.phone)}</b></div>` : ""}</div></div>`;
  };
  return doc(
    "Unit labels",
    `@page{size:A4;margin:8mm}.sheet{display:grid;grid-template-columns:repeat(2,95mm);gap:4mm;justify-content:center}
    .lab{border:1px dashed #999;height:52mm;padding:3mm;display:flex;gap:3mm;break-inside:avoid;overflow:hidden;box-sizing:border-box}
    .q{width:34mm;height:34mm;flex:none}.q svg{width:100%;height:100%}.tx{font-size:7.6pt;line-height:1.28;min-width:0}
    .br{font-weight:bold;font-size:7pt;letter-spacing:.6pt}.id{font:bold 13pt monospace;margin:.5mm 0}
    .ln{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fg{border:1px solid #000;padding:1mm;margin:1mm 0;font-size:6.6pt}`,
    `<div class="hint">Print at 100% on A4 sticker paper, or laminate. Labels are 95 × 52 mm.</div><div class="sheet">${units.map(label).join("")}</div>`,
  );
}

/**
 * Opens a print window. Call `openPrintWindow()` straight from the click (so it isn't blocked as a pop-up),
 * then `show(html)` once the sheet is ready.
 */
export function openPrintWindow() {
  const w = window.open("", "_blank");
  return {
    show(html: string) {
      if (!w)
        throw new Error("Your browser blocked the print window. Allow pop-ups for this site and try again.");
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 300);
    },
    close: () => w?.close(),
  };
}
