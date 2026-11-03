// The asset register as an A4 landscape PDF. Loaded only when someone downloads it.
import { formatUk } from "@airledger/domain";
import type { RegisterRow } from "./screens/Register";

const COLS: { head: string; w: number; cell: (r: RegisterRow) => string }[] = [
  { head: "No", w: 12, cell: (r) => String(r.unit.asset_no) },
  { head: "Label", w: 22, cell: (r) => r.unit.sticker_code },
  { head: "Client", w: 36, cell: (r) => r.site.client?.name ?? "" },
  {
    head: "Install and site",
    w: 46,
    cell: (r) => [r.site.system.name, r.site.system.site_postcode].filter(Boolean).join(", "),
  },
  {
    head: "Unit",
    w: 36,
    cell: (r) =>
      [r.unit.role === "outdoor" ? "Outdoor" : r.unit.indoor_type || "Indoor", r.unit.location]
        .filter(Boolean)
        .join(", "),
  },
  {
    head: "Make, model, serial",
    w: 48,
    cell: (r) =>
      [[r.unit.manufacturer, r.unit.model].filter(Boolean).join(" "), r.unit.serial && `S/N ${r.unit.serial}`]
        .filter(Boolean)
        .join("\n"),
  },
  { head: "Gas", w: 16, cell: (r) => r.site.system.refrigerant },
  { head: "kg", w: 12, cell: (r) => (r.site.info.fgas.kg ? String(r.site.info.fgas.kg) : "") },
  {
    head: "t CO2e",
    w: 15,
    cell: (r) => (r.site.info.fgas.tonnesCo2e ? r.site.info.fgas.tonnesCo2e.toFixed(2) : ""),
  },
  { head: "Last service", w: 21, cell: (r) => formatUk(r.site.info.lastService) },
  { head: "Next due", w: 21, cell: (r) => formatUk(r.site.info.nextDue) },
];

export async function registerPdf(rows: RegisterRow[], business: string, scope: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const left = 10;
  const bottom = 200;
  let y = 0;
  let page = 0;

  const header = () => {
    page++;
    doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(15, 34, 56);
    doc.text(`Asset register${scope ? ` – ${scope}` : ""}`, left, 14);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(91, 108, 127);
    doc.text(
      `${business} · ${rows.length} assets · ${formatUk(new Date().toISOString().slice(0, 10))}`,
      left,
      20,
    );
    doc.text(`Page ${page}`, 287, 20, { align: "right" });
    y = 28;
    doc.setFillColor(238, 242, 246).rect(left, y - 4.5, 277, 7, "F");
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(15, 34, 56);
    let x = left + 1;
    for (const c of COLS) {
      doc.text(c.head, x, y);
      x += c.w;
    }
    y += 6;
    doc.setFont("helvetica", "normal");
  };

  header();
  for (const r of rows) {
    const cells = COLS.map((c) => doc.splitTextToSize(c.cell(r), c.w - 2) as string[]);
    const h = Math.max(...cells.map((l) => l.length)) * 3.6 + 2;
    if (y + h > bottom) {
      doc.addPage();
      header();
    }
    let x = left + 1;
    cells.forEach((lines, i) => {
      doc.text(lines, x, y);
      x += COLS[i]?.w ?? 0;
    });
    y += h;
    doc.setDrawColor(225, 232, 239).line(left, y - 3.5, left + 277, y - 3.5);
  }
  doc.setFontSize(7).setTextColor(140, 150, 160);
  doc.text("F-gas figures are per install (its refrigerant circuit). Made with Air Ledger.", left, 205);
  return doc.output("blob");
}
