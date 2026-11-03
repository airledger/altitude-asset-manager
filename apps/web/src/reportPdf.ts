// The signed service report as an A4 PDF (spec F10). Same layout as the live app's report, built from
// the new typed records. Loaded only when a report is issued.
import { addMonths, formatDate, isInstallType, type SystemInfo } from "@airledger/domain";
import type { jsPDF as JsPdf } from "jspdf";
import type { ClientRow, Profile, SystemRow, UnitRow } from "./assets";
import { ALL_CHECKS, CHECKS, INDOOR_ONLY, INSTALL_CHECKS, type JobListRow, type JobRecord } from "./jobs";
import type { SignoffRow } from "./reports";

export interface ReportPdfInput {
  business: string;
  profile: Profile;
  client: ClientRow | null;
  system: SystemRow;
  units: UnitRow[];
  job: JobListRow;
  record: JobRecord;
  info: SystemInfo;
  signoff: Omit<SignoffRow, "job_id" | "engineer_signature_file_id" | "customer_signature_file_id">;
  images: { logo: Blob | null; engineerSig: Blob | null; customerSig: Blob | null; photos: Blob[] };
  meta: { ref: string; rev: number; issuedAt: string; hash: string };
}

type Rgb = [number, number, number];
const NAVY: Rgb = [15, 34, 56];
const AIR: Rgb = [63, 193, 217];
const SLATE: Rgb = [91, 108, 127];
const LINE: Rgb = [225, 232, 239];
const MIST: Rgb = [244, 247, 250];
const RED: Rgb = [200, 64, 47];
const GREEN: Rgb = [30, 138, 90];

/** The PDF's built-in font only has Latin-1, so swap or drop anything else. */
const T = (v: unknown) =>
  String(v ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₂/g, "2")
    .replace(/…/g, "...")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\xFF]/g, "");

const num = (n: number | null | undefined, dp: number) => (n == null ? "" : String(+Number(n).toFixed(dp)));
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export const unitKind = (u: Pick<UnitRow, "role" | "indoor_type">) =>
  u.role === "outdoor" ? "Outdoor unit" : u.indoor_type ? `${u.indoor_type} (indoor)` : "Indoor unit";

interface Img {
  data: string;
  w: number;
  h: number;
}
/** Draws an image onto a white canvas so the PDF can hold it. Null where the browser can't (or in tests). */
async function toImage(blob: Blob | null, type: "JPEG" | "PNG", max = 1200): Promise<Img | null> {
  if (!blob || typeof createImageBitmap === "undefined") return null;
  try {
    const bmp = await createImageBitmap(blob);
    const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * sc);
    cv.height = Math.round(bmp.height * sc);
    const g = cv.getContext("2d");
    if (!g) return null;
    if (type === "JPEG") {
      g.fillStyle = "#fff";
      g.fillRect(0, 0, cv.width, cv.height);
    }
    g.drawImage(bmp, 0, 0, cv.width, cv.height);
    return {
      data: cv.toDataURL(type === "JPEG" ? "image/jpeg" : "image/png", 0.8),
      w: cv.width,
      h: cv.height,
    };
  } catch {
    return null;
  }
}

export async function reportPdf(r: ReportPdfInput): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc: JsPdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const p = r.profile;
  const s = r.system;
  const c = r.client;
  const j = r.job;
  const inst = isInstallType(j.type);
  const title = inst ? "Installation & Commissioning Report" : "Service Report";
  const PW = 210;
  const PH = 297;
  const M = 15;
  const W = PW - 2 * M;
  const BOTTOM = PH - 22;
  let y = M;

  const font = (size: number, style = "normal", col: Rgb = NAVY) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...col);
  };
  const lh = (size: number) => size * 0.42;
  const newPage = () => {
    doc.addPage();
    y = M;
    font(8, "normal", SLATE);
    doc.text(T(`${r.business} · ${title} · ${r.meta.ref}`), M, y);
    y += 6;
  };
  const ensure = (h: number) => {
    if (y + h > BOTTOM) newPage();
  };
  const wrap = (t: string, w: number) => doc.splitTextToSize(T(t), w) as string[];

  function heading(t: string, keep = 16) {
    ensure(keep);
    y += 4;
    doc.setFillColor(...AIR);
    doc.rect(M, y - 3.6, 1.4, 5, "F");
    font(11.5, "bold");
    doc.text(T(t), M + 4, y);
    y += 4;
  }
  function para(t: string, size = 9.5, style = "normal", col: Rgb = NAVY) {
    font(size, style, col);
    for (const l of wrap(t, W)) {
      ensure(lh(size) + 1);
      doc.text(l, M, y + lh(size));
      y += lh(size) + 0.9;
    }
    y += 1.5;
  }
  /** Label and value rows; rows with no value are left out. */
  function kv(rows: [string, string, boolean?][], labelW = 52) {
    font(9);
    for (const [k, v, warn] of rows) {
      if (v === "") continue;
      const kl = wrap(k, labelW - 4);
      const vl = wrap(v, W - labelW - 4);
      const h = Math.max(kl.length, vl.length) * lh(9) * 1.2 + 2.8;
      ensure(h);
      doc.setDrawColor(...LINE);
      doc.setFillColor(...MIST);
      doc.rect(M, y, labelW, h, "FD");
      doc.rect(M + labelW, y, W - labelW, h, "D");
      font(9, "bold", SLATE);
      doc.text(kl, M + 2, y + 3 + lh(9) * 0.6, { lineHeightFactor: 1.2 });
      font(9, warn ? "bold" : "normal", warn ? RED : NAVY);
      doc.text(vl, M + labelW + 2, y + 3 + lh(9) * 0.6, { lineHeightFactor: 1.2 });
      y += h;
    }
    y += 2;
  }
  function checks(items: [string, boolean][]) {
    const cw = W / 2;
    const rh = 6.2;
    for (let i = 0; i < items.length; i += 2) {
      ensure(rh);
      items.slice(i, i + 2).forEach(([label, done], k) => {
        const x = M + k * cw;
        doc.setDrawColor(...LINE);
        doc.rect(x, y, cw, rh, "D");
        const bx = x + 2.2;
        const by = y + 1.6;
        doc.setDrawColor(...(done ? GREEN : RED));
        doc.setLineWidth(0.35);
        doc.rect(bx, by, 3, 3, "D");
        if (done) {
          doc.line(bx + 0.6, by + 1.6, bx + 1.3, by + 2.4);
          doc.line(bx + 1.3, by + 2.4, bx + 2.5, by + 0.6);
        } else {
          doc.line(bx + 0.6, by + 0.6, bx + 2.4, by + 2.4);
          doc.line(bx + 2.4, by + 0.6, bx + 0.6, by + 2.4);
        }
        doc.setLineWidth(0.2);
        font(8.5, done ? "normal" : "bold", done ? NAVY : RED);
        doc.text(T(label + (done ? "" : " - not completed")), bx + 5, y + 4.2);
      });
      y += rh;
    }
    y += 1.5;
  }
  function table(head: string[], rows: string[][], widths: number[]) {
    const drawHead = () => {
      ensure(8);
      doc.setFillColor(...NAVY);
      doc.rect(M, y, W, 7, "F");
      font(8.5, "bold", [255, 255, 255]);
      let x = M;
      head.forEach((h, i) => {
        doc.text(T(h), x + 2, y + 4.8);
        x += widths[i] ?? 0;
      });
      y += 7;
    };
    drawHead();
    for (const row of rows) {
      font(8.5);
      const cells = row.map((v, i) => wrap(v || "-", (widths[i] ?? 20) - 4));
      const h = Math.max(...cells.map((x) => x.length)) * lh(8.5) * 1.2 + 3.4;
      if (y + h > BOTTOM) {
        newPage();
        drawHead();
      }
      let x = M;
      doc.setDrawColor(...LINE);
      cells.forEach((cl, i) => {
        const w = widths[i] ?? 20;
        doc.rect(x, y, w, h, "D");
        font(8.5);
        doc.text(cl, x + 2, y + 3.2 + lh(8.5) * 0.6, { lineHeightFactor: 1.2 });
        x += w;
      });
      y += h;
    }
    y += 3;
  }

  // ---------- header: business details, report title and reference ----------
  const logo = await toImage(r.images.logo, "PNG", 800);
  let ly = M;
  if (logo) {
    const h = Math.min(24, (70 * logo.h) / logo.w);
    doc.addImage(logo.data, "PNG", M, ly, (h * logo.w) / logo.h, h);
    ly += h + 3;
  }
  font(logo ? 12 : 16, "bold");
  doc.text(T(r.business), M, ly + (logo ? 3 : 5));
  ly += logo ? 5 : 8;
  font(8.5, "normal", SLATE);
  const coLines = [
    p.trading_as ? `Part of ${p.trading_as}` : "",
    ...p.address
      .split(/\n/)
      .map((x) => x.trim())
      .filter(Boolean),
    [p.phone, p.email].filter(Boolean).join("  ·  "),
    p.website,
    p.fgas_cert ? `F-gas company certificate: ${p.fgas_cert}` : "",
  ].filter(Boolean);
  for (const l of coLines) {
    doc.text(T(l), M, ly + 1.5);
    ly += 3.8;
  }
  const rx = PW - M;
  font(16, "bold");
  doc.text(T(title), rx, M + 6, { align: "right" });
  (
    [
      ["Report ref", r.meta.ref + (r.meta.rev > 1 ? ` (rev ${r.meta.rev})` : "")],
      ["Visit date", formatDate(j.date)],
      ["Issued", stamp(r.meta.issuedAt)],
    ] as const
  ).forEach(([k, v], i) => {
    font(9, "bold");
    const vw = doc.getTextWidth(T(v));
    doc.text(T(v), rx, M + 13 + i * 4.6, { align: "right" });
    font(9, "normal", SLATE);
    doc.text(T(`${k}: `), rx - vw - 0.5, M + 13 + i * 4.6, { align: "right" });
  });
  y = Math.max(ly, M + 26) + 2;
  doc.setFillColor(...NAVY);
  doc.rect(M, y, W, 1.2, "F");
  doc.setFillColor(...AIR);
  doc.rect(M, y + 1.2, W, 0.6, "F");
  y += 7;

  // ---------- client and site ----------
  const half = (W - 6) / 2;
  const box = (x: number, head: string, lines: string[]) => {
    let yy = y;
    font(8, "bold", SLATE);
    doc.text(head.toUpperCase(), x, yy);
    yy += 4.5;
    lines.filter(Boolean).forEach((l, i) => {
      font(i ? 9 : 10, i ? "normal" : "bold");
      for (const w of wrap(l, half)) {
        doc.text(w, x, yy);
        yy += 4.2;
      }
    });
    return yy;
  };
  const join = (...parts: string[]) =>
    parts
      .flatMap((x) => x.split(/\n/))
      .map((x) => x.trim())
      .filter(Boolean)
      .join(", ");
  const y1 = box(M, "Client", [
    c?.name ?? "",
    c?.contact_name && c.contact_name !== c.name ? `Contact: ${c.contact_name}` : "",
    join(c?.billing_address ?? "", c?.postcode ?? ""),
    c?.phone ? `Tel: ${c.phone}` : "",
    c?.email ? `Email: ${c.email}` : "",
  ]);
  const y2 = box(M + half + 6, "Site", [
    s.name || "Site",
    join(s.site_address, s.site_postcode),
    s.access_notes ? `Access: ${s.access_notes.replace(/\n/g, ", ")}` : "",
  ]);
  y = Math.max(y1, y2) + 3;

  // ---------- the visit ----------
  const indoor = r.units.filter((u) => u.role === "indoor").length;
  const outdoor = r.units.length - indoor;
  const summary = [outdoor && `${outdoor} outdoor`, indoor && `${indoor} indoor`]
    .filter(Boolean)
    .join(" and ");
  heading("Visit");
  kv([
    ["Job type", j.type],
    ["Date completed", formatDate(j.date)],
    ["Time on site", j.duration_hrs ? `${j.duration_hrs} hours` : ""],
    ["Engineer", r.signoff.engineer_name || j.engineer],
    ["Engineer F-gas cert no.", r.signoff.engineer_cert],
    ["Units attended", r.units.length ? `${summary} unit${r.units.length === 1 ? "" : "s"}` : ""],
  ]);

  heading("Work completed");
  para(
    inst
      ? `Installation and commissioning of ${s.refrigerant || ""} air conditioning system "${s.name}" (${summary} unit${r.units.length === 1 ? "" : "s"}) was completed on ${formatDate(j.date)}. Pressure, vacuum and operational checks are recorded below.`
      : `${j.type} carried out on ${formatDate(j.date)} on ${summary || "the"} unit${r.units.length === 1 ? "" : "s"}. The checks completed on each unit, readings taken and any defects found are recorded below.`,
  );
  if (j.completion_notes) {
    font(9, "bold", SLATE);
    ensure(6);
    doc.text("Engineer's notes", M, y + 3);
    y += 5;
    para(j.completion_notes);
  }

  if (r.units.length) {
    heading("Equipment");
    table(
      ["Asset", "Type", "Make / model", "Serial no.", "Location"],
      r.units.map((u) => [
        `#${u.asset_no} ${u.sticker_code}`,
        unitKind(u),
        [u.manufacturer, u.model].filter(Boolean).join(" ") + (u.capacity_kw ? ` (${u.capacity_kw} kW)` : ""),
        u.serial,
        u.location,
      ]),
      [30, 30, 50, 34, 36],
    );

    heading(inst ? "Installation checks by unit" : "Service checks by unit");
    const list = inst ? INSTALL_CHECKS : CHECKS;
    const byUnit = new Map(r.record.checks.map((x) => [x.unit_id, x]));
    for (const u of r.units) {
      const ck = byUnit.get(u.id);
      const done = new Set(ck?.checks ?? []);
      ensure(14);
      font(9.5, "bold");
      doc.text(T(`#${u.asset_no}  ·  ${unitKind(u)}${u.location ? "  ·  " + u.location : ""}`), M, y + 3.5);
      y += 6;
      checks(
        Object.entries(list)
          .filter(([k]) => u.role === "indoor" || !INDOOR_ONLY.includes(k))
          .map(([k, l]) => [l, done.has(k)]),
      );
      // Anything ticked that isn't on this job type's list (the type changed) still shows.
      const extra = [...done].filter((k) => !(k in list) && ALL_CHECKS[k]);
      if (extra.length) checks(extra.map((k) => [ALL_CHECKS[k] ?? k, true]));
      kv(
        [
          ["Off-coil temperature", ck?.off_coil != null ? `${ck.off_coil} °C` : ""],
          ["On-coil / return temperature", ck?.on_coil != null ? `${ck.on_coil} °C` : ""],
          ["Running current", ck?.amps != null ? `${ck.amps} A` : ""],
          ["Suction pressure", ck?.pressure != null ? `${ck.pressure} bar` : ""],
          ["Notes / defects", ck?.notes ?? ""],
        ],
        70,
      );
    }
  }

  // ---------- F-gas ----------
  const f = r.info.fgas;
  heading("Refrigerant (F-gas)");
  kv([
    ["Refrigerant", s.refrigerant ? `${s.refrigerant} (GWP ${f.gwp})` : ""],
    ["Total system charge", f.kg ? `${num(f.kg, 3)} kg` : ""],
    ["CO2 equivalent", f.kg ? `${num(f.tonnesCo2e, 2)} tonnes` : ""],
    [
      "Leak check frequency",
      f.required ? `Required every ${f.months} months` : "Not mandatory (below threshold)",
    ],
  ]);
  const cm = r.record.commissioning;
  const lc = r.record.leak;
  if (inst && cm)
    kv([
      [
        "Nitrogen pressure test",
        cm.pressure_bar != null
          ? `${cm.pressure_bar} bar for ${cm.pressure_mins ?? "-"} min - ${cm.pressure_held === false ? "FAILED" : "held"}`
          : "",
        cm.pressure_held === false,
      ],
      [
        "Vacuum achieved",
        cm.vacuum_microns != null
          ? `${cm.vacuum_microns} microns${cm.decay_held ? " - decay test held" : ""}`
          : "",
      ],
      ["Pipe run", cm.pipe_m != null ? `${cm.pipe_m} m` : ""],
      ["Additional refrigerant charged", cm.added_kg != null ? `${num(cm.added_kg, 3)} kg` : ""],
      [
        "Handover",
        cm.handover
          ? `Controls demonstrated, manuals and warranty information left with ${cm.customer_name || "the customer"}`
          : "",
      ],
    ]);
  else if (!inst)
    kv([
      ["Leak check carried out", lc?.performed ? `Yes - ${lc.method}` : "No"],
      [
        "Leak check result",
        lc?.performed ? (lc.result === "fail" ? "LEAK FOUND" : "No leaks found") : "",
        lc?.result === "fail",
      ],
      ["Refrigerant added", lc?.added_kg ? `${num(lc.added_kg, 3)} kg` : ""],
      ["Refrigerant recovered", lc?.recovered_kg ? `${num(lc.recovered_kg, 3)} kg` : ""],
      ["Leak check notes", lc?.notes ?? ""],
    ]);

  // ---------- parts (never prices) ----------
  const used = r.record.used.filter((m) => m.qty);
  if (used.length) {
    heading("Parts & materials used");
    table(
      ["Item", "Qty"],
      used.map((m) => [m.name, String(m.qty)]),
      [W - 25, 25],
    );
  }

  const report = r.record.report?.text;
  if (report && report !== j.completion_notes) {
    heading("Engineer's report");
    para(report);
  }

  // ---------- photos ----------
  const photos = (await Promise.all(r.images.photos.map((b) => toImage(b, "JPEG")))).filter(
    (x): x is Img => !!x,
  );
  if (photos.length) {
    heading("Photos", 90);
    const pw = (W - 6) / 2;
    const maxH = 72;
    let col = 0;
    let rowH = 0;
    photos.forEach((im, i) => {
      let w = pw;
      let h = (w * im.h) / im.w;
      if (h > maxH) {
        h = maxH;
        w = (h * im.w) / im.h;
      }
      if (col === 0) ensure(maxH + 8);
      doc.addImage(im.data, "JPEG", M + col * (pw + 6) + (pw - w) / 2, y, w, h);
      font(7.5, "normal", SLATE);
      doc.text(`Photo ${i + 1}`, M + col * (pw + 6), y + h + 3.6);
      rowH = Math.max(rowH, h + 7);
      if (col === 1) {
        y += rowH;
        rowH = 0;
        col = 0;
      } else col = 1;
    });
    if (col === 1) y += rowH;
    y += 2;
  }

  // ---------- next service ----------
  heading(inst ? "First service" : "Next service");
  if (j.date)
    para(
      `${inst ? "First service" : "Next service"} due ${formatDate(addMonths(j.date, r.info.intervalMonths))}. Servicing at the interval recommended by the manufacturer is normally a condition of the manufacturer's warranty; please keep this report as your record of the work.`,
    );

  // ---------- sign-off ----------
  heading("Sign-off", 62);
  para(`I confirm the work recorded in this report was carried out on ${formatDate(j.date)}.`, 9);
  ensure(48);
  const so = r.signoff;
  const sigBox = async (x: number, head: string, name: string, sig: Blob | null, note: string) => {
    doc.setDrawColor(...LINE);
    doc.rect(x, y, half, 38, "D");
    font(8, "bold", SLATE);
    doc.text(head.toUpperCase(), x + 3, y + 5);
    const im = await toImage(sig, "PNG", 900);
    if (im) {
      let h = 20;
      let w = (h * im.w) / im.h;
      if (w > half - 8) {
        w = half - 8;
        h = (w * im.h) / im.w;
      }
      doc.addImage(im.data, "PNG", x + 3, y + 7, w, h);
    } else {
      font(9, "italic", SLATE);
      doc.text(wrap(note || (sig ? "Signed" : "Not signed"), half - 6), x + 3, y + 18);
    }
    doc.setDrawColor(...SLATE);
    doc.line(x + 3, y + 29, x + half - 3, y + 29);
    font(9, "bold");
    doc.text(T(name || "-"), x + 3, y + 33.5);
    font(7.5, "normal", SLATE);
    doc.text(T(`Signed ${stamp(so.signed_at)}`), x + 3, y + 36.8);
  };
  await sigBox(M, "Engineer", so.engineer_name, r.images.engineerSig, "");
  await sigBox(
    M + half + 6,
    "Customer",
    so.customer_name,
    so.customer_absent ? null : r.images.customerSig,
    so.customer_absent ? `Customer not available to sign${so.absent_note ? ": " + so.absent_note : ""}` : "",
  );
  y += 42;

  // ---------- footer on every page ----------
  const n = doc.getNumberOfPages();
  const legal = [
    r.business + (p.trading_as ? ` - part of ${p.trading_as}` : ""),
    p.company_no ? `Company no. ${p.company_no}` : "",
    p.vat_no ? `VAT no. ${p.vat_no}` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  const credit = "Produced with Air Ledger · airledger.co.uk";
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.line(M, PH - 15, PW - M, PH - 15);
    font(7.5, "normal", SLATE);
    doc.text(T(legal), M, PH - 11);
    doc.text(T(`Ref ${r.meta.ref} · Page ${i} of ${n}`), PW - M, PH - 11, { align: "right" });
    font(6.5, "normal", SLATE);
    doc.text(
      T(
        `Record fingerprint ${r.meta.hash.slice(0, 24)} · Original held by ${r.business}; quote the reference to verify.`,
      ),
      M,
      PH - 7.5,
    );
    doc.setTextColor(...AIR);
    doc.textWithLink(credit, PW - M - doc.getTextWidth(credit), PH - 7.5, { url: "https://airledger.co.uk" });
  }
  doc.setProperties({
    title: `${title} ${r.meta.ref}`,
    subject: T(`${c?.name ?? ""} - ${s.name}`),
    author: T(r.business),
    creator: "Air Ledger",
  });
  return doc.output("blob");
}
