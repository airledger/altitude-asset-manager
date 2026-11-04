// The print-ready PDF for the sticker manufacturer: one sticker per page at its real size, with 2 mm bleed.
// jsPDF is loaded only when it's needed, so it doesn't slow down the rest of the app.
import type { jsPDF } from "jspdf";
import { isNative, shareFile } from "./native";
import {
  layoutSticker,
  qrRuns,
  STICKER_SIZES,
  type Font,
  type Measure,
  type StickerBrand,
  type StickerDesign,
} from "./sticker";

export const BLEED = 2;

const FONTS: Record<Font, [string, string]> = {
  sans: ["helvetica", "normal"],
  "sans-bold": ["helvetica", "bold"],
  "mono-bold": ["courier", "bold"],
};

const load = () => import("jspdf").then((m) => m.jsPDF);

function measureWith(doc: jsPDF): Measure {
  return (text, pt, font) => {
    doc.setFont(...FONTS[font]);
    doc.setFontSize(pt);
    return doc.getTextWidth(text);
  };
}

/** Exact text widths (the same Helvetica metrics the PDF uses), for the designer's preview. */
export async function loadMeasure(): Promise<Measure> {
  const JsPDF = await load();
  return measureWith(new JsPDF({ unit: "mm" }));
}

/** A logo as a PNG data URL (PDFs can't take SVG), at most 600 px wide. */
export function loadLogo(url: string): Promise<{ src: string; aspect: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const scale = Math.min(1, 600 / img.naturalWidth);
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
        resolve({ src: c.toDataURL("image/png"), aspect: c.width / c.height });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export type PdfLayout = "a4" | "single";

const A4 = { long: 297, short: 210, margin: 5, gap: 2 };

/** How many labels (with their bleed) fit on an A4 sheet, turning the sheet if more fit that way. */
export function a4Grid(design: StickerDesign) {
  const size = STICKER_SIZES[design.size];
  const tw = size.w + BLEED * 2;
  const th = size.h + BLEED * 2;
  const fit = (pw: number, ph: number) => {
    const cols = Math.max(1, Math.floor((pw - A4.margin * 2 + A4.gap) / (tw + A4.gap)));
    const rows = Math.max(1, Math.floor((ph - A4.margin * 2 + A4.gap) / (th + A4.gap)));
    return { pw, ph, cols, rows };
  };
  const portrait = fit(A4.short, A4.long);
  const landscape = fit(A4.long, A4.short);
  const g = landscape.cols * landscape.rows > portrait.cols * portrait.rows ? landscape : portrait;
  const x0 = (g.pw - (g.cols * tw + (g.cols - 1) * A4.gap)) / 2;
  const y0 = (g.ph - (g.rows * th + (g.rows - 1) * A4.gap)) / 2;
  return {
    orientation: g === landscape ? ("landscape" as const) : ("portrait" as const),
    perSheet: g.cols * g.rows,
    at: (i: number) => ({
      x: x0 + (i % g.cols) * (tw + A4.gap),
      y: y0 + Math.floor(i / g.cols) * (th + A4.gap),
    }),
  };
}

/**
 * The print-ready PDF. "a4": as many labels as fit on each A4 sheet, each with its 2 mm bleed and a 2 mm gap.
 * "single": one label per page at its real size plus bleed. `link(code)` is what each QR code opens.
 */
export async function stickerPdf(
  design: StickerDesign,
  brand: StickerBrand,
  codes: string[],
  link: (code: string) => string,
  layout: PdfLayout = "a4",
): Promise<Blob> {
  const JsPDF = await load();
  const size = STICKER_SIZES[design.size];
  const W = size.w + BLEED * 2;
  const H = size.h + BLEED * 2;
  const orientation = W >= H ? "landscape" : "portrait";
  const grid = a4Grid(design);
  const doc =
    layout === "a4"
      ? new JsPDF({ unit: "mm", format: "a4", orientation: grid.orientation, compress: true })
      : new JsPDF({ unit: "mm", format: [W, H], orientation, compress: true });
  doc.setProperties({
    title: `${brand.businessName} asset labels (${codes.length})`,
    subject:
      `${size.label}${size.round ? "" : " rectangle"}, ${BLEED} mm bleed` +
      (layout === "a4" ? `, ${grid.perSheet} per A4 sheet, ${A4.gap} mm apart` : ", one per page") +
      ". Made by Air Ledger.",
    creator: "Air Ledger",
  });
  const measure = measureWith(doc);
  const b = BLEED;

  codes.forEach((code, i) => {
    let ox = 0;
    let oy = 0;
    if (layout === "a4") {
      const slot = i % grid.perSheet;
      if (i > 0 && slot === 0) doc.addPage("a4", grid.orientation);
      ({ x: ox, y: oy } = grid.at(slot));
    } else if (i > 0) doc.addPage([W, H], orientation);
    const art = layoutSticker(design, brand, code, link(code), measure);
    doc.setFillColor(art.bg);
    doc.rect(ox, oy, W, H, "F");
    const X = ox + b;
    const Y = oy + b;
    for (const s of art.shapes) {
      switch (s.t) {
        case "rect": {
          const style = s.fill && s.stroke ? "FD" : s.fill ? "F" : "S";
          if (s.fill) doc.setFillColor(s.fill);
          if (s.stroke) {
            doc.setDrawColor(s.stroke);
            doc.setLineWidth(s.sw ?? 0.3);
          }
          // A colour band reaching the edge runs on into the bleed.
          const x = s.x <= 0 ? -b : s.x;
          const y = s.y <= 0 ? -b : s.y;
          const w = s.x + s.w >= size.w ? size.w + b - x : s.x + s.w - x;
          const h = s.y + s.h >= size.h ? size.h + b - y : s.y + s.h - y;
          if (s.r) doc.roundedRect(x + X, y + Y, w, h, s.r, s.r, style);
          else doc.rect(x + X, y + Y, w, h, style);
          break;
        }
        case "circle":
          if (s.fill) doc.setFillColor(s.fill);
          if (s.stroke) {
            doc.setDrawColor(s.stroke);
            doc.setLineWidth(s.sw ?? 0.3);
          }
          doc.circle(s.cx + X, s.cy + Y, s.r, s.fill ? (s.stroke ? "FD" : "F") : "S");
          break;
        case "text":
          doc.setFont(...FONTS[s.font]);
          doc.setFontSize(s.pt);
          doc.setTextColor(s.fill);
          doc.text(s.text, s.x + X, s.y + Y, { align: s.align, baseline: "alphabetic" });
          break;
        case "image":
          doc.addImage(s.src, "PNG", s.x + X, s.y + Y, s.w, s.h, "logo", "FAST");
          break;
        case "qr": {
          const { n, runs } = qrRuns(s.data);
          const u = s.size / n;
          doc.setFillColor("#000000");
          for (const [r, c, len] of runs)
            doc.rect(s.x + X + c * u, s.y + Y + r * u, len * u + 0.01, u + 0.01, "F");
          break;
        }
      }
    }
  });
  return doc.output("blob");
}

export function download(blob: Blob, name: string) {
  if (isNative()) {
    shareFile(blob, name).catch((e: unknown) => alert(`Couldn't share the file: ${String(e)}`));
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
