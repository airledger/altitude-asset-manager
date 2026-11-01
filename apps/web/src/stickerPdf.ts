// The print-ready PDF for the sticker manufacturer: one sticker per page at its real size, with 2 mm bleed.
// jsPDF is loaded only when it's needed, so it doesn't slow down the rest of the app.
import type { jsPDF } from "jspdf";
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

/** One page per code. `link(code)` is what each QR code opens. */
export async function stickerPdf(
  design: StickerDesign,
  brand: StickerBrand,
  codes: string[],
  link: (code: string) => string,
): Promise<Blob> {
  const JsPDF = await load();
  const size = STICKER_SIZES[design.size];
  const W = size.w + BLEED * 2;
  const H = size.h + BLEED * 2;
  const orientation = W >= H ? "landscape" : "portrait";
  const doc = new JsPDF({ unit: "mm", format: [W, H], orientation, compress: true });
  doc.setProperties({
    title: `${brand.businessName} asset labels (${codes.length})`,
    subject: `${size.label}${size.round ? "" : " rectangle"}, ${BLEED} mm bleed. Made by Air Ledger.`,
    creator: "Air Ledger",
  });
  const measure = measureWith(doc);
  const b = BLEED;

  codes.forEach((code, i) => {
    if (i > 0) doc.addPage([W, H], orientation);
    const art = layoutSticker(design, brand, code, link(code), measure);
    doc.setFillColor(art.bg);
    doc.rect(0, 0, W, H, "F");
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
          if (s.r) doc.roundedRect(x + b, y + b, w, h, s.r, s.r, style);
          else doc.rect(x + b, y + b, w, h, style);
          break;
        }
        case "circle":
          if (s.fill) doc.setFillColor(s.fill);
          if (s.stroke) {
            doc.setDrawColor(s.stroke);
            doc.setLineWidth(s.sw ?? 0.3);
          }
          doc.circle(s.cx + b, s.cy + b, s.r, s.fill ? (s.stroke ? "FD" : "F") : "S");
          break;
        case "text":
          doc.setFont(...FONTS[s.font]);
          doc.setFontSize(s.pt);
          doc.setTextColor(s.fill);
          doc.text(s.text, s.x + b, s.y + b, { align: s.align, baseline: "alphabetic" });
          break;
        case "image":
          doc.addImage(s.src, "PNG", s.x + b, s.y + b, s.w, s.h, "logo", "FAST");
          break;
        case "qr": {
          const { n, runs } = qrRuns(s.data);
          const u = s.size / n;
          doc.setFillColor("#000000");
          for (const [r, c, len] of runs)
            doc.rect(s.x + b + c * u, s.y + b + r * u, len * u + 0.01, u + 0.01, "F");
          break;
        }
      }
    }
  });
  return doc.output("blob");
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
