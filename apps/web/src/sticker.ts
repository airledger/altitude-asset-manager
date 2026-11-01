// The sticker designer's artwork. A design is laid out once, in millimetres, as simple shapes, then drawn either
// as SVG (the live preview and A4 sheets) or as a PDF for the sticker manufacturer (one sticker per page, with
// bleed). Both use Helvetica and Courier, so what you see is what gets printed.
import qrcode from "qrcode-generator";

export const STICKER_SIZES = {
  "63x38": { label: "63.5 × 38.1 mm", w: 63.5, h: 38.1, round: false },
  "50x30": { label: "50 × 30 mm", w: 50, h: 30, round: false },
  "75x50": { label: "75 × 50 mm", w: 75, h: 50, round: false },
  "100x50": { label: "100 × 50 mm", w: 100, h: 50, round: false },
  "50round": { label: "50 mm round", w: 50, h: 50, round: true },
  "40round": { label: "40 mm round", w: 40, h: 40, round: true },
} as const;
export type StickerSize = keyof typeof STICKER_SIZES;

export const STICKER_STYLES = { band: "Colour band", solid: "Full colour", outline: "Outline" } as const;
export type StickerStyle = keyof typeof STICKER_STYLES;

export const STICKER_COLOURS = [
  ["Navy", "#0F2238"],
  ["Airflow", "#1597B0"],
  ["Red", "#C8402F"],
  ["Green", "#1E8A5A"],
  ["Orange", "#E07A1F"],
  ["Black", "#111111"],
] as const;

export interface StickerDesign {
  size: StickerSize;
  style: StickerStyle;
  colour: string;
  rounded: boolean;
  logo: boolean;
  name: boolean;
  headline: string;
  phone: boolean;
  website: boolean;
  extra: string;
  fgas: boolean;
}

export const DEFAULT_DESIGN: StickerDesign = {
  size: "63x38",
  style: "band",
  colour: "#0F2238",
  rounded: true,
  logo: true,
  name: true,
  headline: "Scan for service history",
  phone: true,
  website: false,
  extra: "",
  fgas: true,
};

/** A saved design, with anything missing or invalid put back to the default. */
export function readDesign(raw: unknown): StickerDesign {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof StickerDesign, unknown>>;
  const str = (v: unknown, d: string, max = 60) => (typeof v === "string" ? v.slice(0, max) : d);
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    size:
      typeof r.size === "string" && r.size in STICKER_SIZES ? (r.size as StickerSize) : DEFAULT_DESIGN.size,
    style:
      typeof r.style === "string" && r.style in STICKER_STYLES
        ? (r.style as StickerStyle)
        : DEFAULT_DESIGN.style,
    colour:
      typeof r.colour === "string" && /^#[0-9a-f]{6}$/i.test(r.colour) ? r.colour : DEFAULT_DESIGN.colour,
    rounded: bool(r.rounded, DEFAULT_DESIGN.rounded),
    logo: bool(r.logo, DEFAULT_DESIGN.logo),
    name: bool(r.name, DEFAULT_DESIGN.name),
    headline: str(r.headline, DEFAULT_DESIGN.headline),
    phone: bool(r.phone, DEFAULT_DESIGN.phone),
    website: bool(r.website, DEFAULT_DESIGN.website),
    extra: str(r.extra, DEFAULT_DESIGN.extra),
    fgas: bool(r.fgas, DEFAULT_DESIGN.fgas),
  };
}

export interface StickerBrand {
  businessName: string;
  phone: string;
  website: string;
  /** PNG data URL of the logo, and its width ÷ height. */
  logo: { src: string; aspect: number } | null;
}

/** Text width in mm for a font size in points. Pass jsPDF's measure for exact widths. */
export type Measure = (text: string, pt: number, font: Font) => number;
export type Font = "sans" | "sans-bold" | "mono-bold";

// Helvetica's average advance is about 0.55 em (bold 0.6); Courier is fixed at 0.6 em.
export const roughMeasure: Measure = (text, pt, font) =>
  text.length * pt * 0.3528 * (font === "sans" ? 0.53 : 0.6);

export type Shape =
  | {
      t: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      r?: number;
      fill?: string;
      stroke?: string;
      sw?: number;
    }
  | { t: "circle"; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number }
  | {
      t: "text";
      x: number;
      y: number;
      pt: number;
      font: Font;
      fill: string;
      text: string;
      align: "left" | "center";
    }
  | { t: "qr"; x: number; y: number; size: number; data: string }
  | { t: "image"; x: number; y: number; w: number; h: number; src: string };

export interface Artwork {
  w: number;
  h: number;
  round: boolean;
  /** Background colour, also used for the bleed. */
  bg: string;
  shapes: Shape[];
}

const PT = 0.3528; // mm per point
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
};
/** White or navy, whichever reads better on the colour. */
export const inkOn = (hex: string) => (lum(hex) > 0.4 ? "#0F2238" : "#FFFFFF");

/** Lays a sticker out in millimetres. `size` overrides the design's size (A4 sheets use 63.5 × 38.1). */
export function layoutSticker(
  d: StickerDesign,
  brand: StickerBrand,
  code: string,
  link: string,
  measure: Measure = roughMeasure,
  size: { w: number; h: number; round: boolean } = STICKER_SIZES[d.size],
): Artwork {
  const { w, h, round } = size;
  const shapes: Shape[] = [];
  const solid = d.style === "solid";
  const bg = solid ? d.colour : "#FFFFFF";
  const ink = solid ? inkOn(d.colour) : "#0F2238";
  const accent = solid ? ink : lum(d.colour) > 0.6 ? "#0F2238" : d.colour;
  const m = Math.max(2, Math.min(w, h) * 0.06); // safe margin inside the cut line

  /** Largest font size (≤ max) at which the text fits the width. */
  const fit = (text: string, max: number, width: number, font: Font) => {
    const at = measure(text, max, font);
    return at <= width ? max : Math.max(3, (max * width) / at);
  };
  const line = (
    text: string,
    x: number,
    y: number,
    width: number,
    max: number,
    font: Font,
    fill: string,
    align: "left" | "center" = "left",
  ) => {
    if (!text) return 0;
    const pt = fit(text, max, width, font);
    const at = align === "center" ? x + width / 2 : x;
    shapes.push({ t: "text", x: at, y: y + pt * PT * 0.78, pt, font, fill, text, align });
    return pt * PT * 1.18;
  };

  if (d.style === "outline")
    shapes.push(
      round
        ? { t: "circle", cx: w / 2, cy: h / 2, r: w / 2 - 0.9, stroke: d.colour, sw: 1.2 }
        : {
            t: "rect",
            x: 0.9,
            y: 0.9,
            w: w - 1.8,
            h: h - 1.8,
            r: d.rounded ? 2.2 : 0,
            stroke: d.colour,
            sw: 1.2,
          },
    );

  const contact = [d.phone && brand.phone, d.website && brand.website].filter(Boolean) as string[];

  if (round) {
    // Round: name across the top, QR in the middle, code and phone underneath.
    const q = w * 0.46;
    let top = h * 0.12;
    if (d.style === "band") {
      shapes.push({ t: "rect", x: 0, y: 0, w, h: h * 0.3, fill: d.colour });
      top = h * 0.1;
    }
    const headInk = d.style === "band" ? inkOn(d.colour) : accent;
    if (d.name)
      line(brand.businessName.toUpperCase(), w * 0.2, top, w * 0.6, 8, "sans-bold", headInk, "center");
    const qy = h * 0.27;
    shapes.push({
      t: "rect",
      x: (w - q) / 2 - 1.6,
      y: qy - 1.6,
      w: q + 3.2,
      h: q + 3.2,
      r: 1.4,
      fill: "#FFFFFF",
    });
    shapes.push({ t: "qr", x: (w - q) / 2, y: qy, size: q, data: link });
    let y = qy + q + 1.2;
    y += line(code, w * 0.25, y, w * 0.5, 9, "mono-bold", ink, "center");
    if (contact[0]) line(contact[0], w * 0.22, y, w * 0.56, 6, "sans-bold", ink, "center");
    return { w, h, round, bg, shapes };
  }

  // Rectangular: optional colour band with logo and name, QR on the left, details on the right.
  let top = m;
  const hasHead = d.name || (d.logo && !!brand.logo);
  if (hasHead && d.style === "band") {
    const bh = Math.max(7, h * 0.22);
    shapes.push({ t: "rect", x: 0, y: 0, w, h: bh, fill: d.colour });
    head(m, (bh - Math.min(bh * 0.62, 7)) / 2, Math.min(bh * 0.62, 7), inkOn(d.colour));
    top = bh + m * 0.7;
  } else if (hasHead) {
    const hh = Math.min(h * 0.17, 7);
    head(m, m * 0.8, hh, accent);
    top = m * 0.8 + hh + m * 0.6;
  }
  function head(x: number, y: number, hh: number, fill: string) {
    let left = x;
    if (d.logo && brand.logo) {
      const lw = Math.min(hh * brand.logo.aspect, w * 0.4);
      const lh = lw / brand.logo.aspect;
      // On a coloured background the logo sits on a white tab, so dark logos still show.
      const tab = d.style === "band" || solid;
      if (tab)
        shapes.push({ t: "rect", x: x - 0.9, y: y - 0.7, w: lw + 1.8, h: lh + 1.4, r: 1, fill: "#FFFFFF" });
      shapes.push({ t: "image", x, y, w: lw, h: lh, src: brand.logo.src });
      left += lw + (tab ? 3 : 2);
    }
    if (d.name)
      line(
        brand.businessName.toUpperCase(),
        left,
        y + hh * 0.12,
        w - left - m,
        (hh / PT) * 0.62,
        "sans-bold",
        fill,
      );
  }

  const q = Math.min(h - top - m * 0.8, w * 0.45);
  const panel = solid ? 1.8 : 0;
  if (solid)
    shapes.push({
      t: "rect",
      x: m - panel,
      y: top - panel,
      w: q + panel * 2,
      h: q + panel * 2,
      r: 1.2,
      fill: "#FFFFFF",
    });
  shapes.push({ t: "qr", x: m, y: top, size: q, data: link });

  const tx = m + q + panel + Math.max(2, w * 0.035);
  const tw = w - tx - m;
  const lines = h - top - m * 0.8;
  let y = top;
  const big = Math.min(14, (lines / PT) * 0.26);
  y += line(code, tx, y, tw, big, "mono-bold", ink);
  y += line(d.headline, tx, y, tw, Math.min(7.5, big * 0.6), "sans-bold", accent);
  for (const c of contact) y += line(c, tx, y, tw, Math.min(7, big * 0.55), "sans", ink);
  if (d.extra) y += line(d.extra, tx, y, tw, Math.min(6.5, big * 0.5), "sans", ink);
  if (d.fgas) {
    const fh = Math.min(lines * 0.3, 9);
    const fy = Math.max(y + 0.6, top + lines - fh);
    if (fy + fh <= h - m * 0.5) {
      shapes.push({ t: "rect", x: tx, y: fy, w: tw, h: fh, r: 0.6, stroke: ink, sw: 0.3 });
      const p = Math.min(5.5, (fh / PT) * 0.34);
      line("Contains fluorinated greenhouse gases", tx + 1, fy + fh * 0.12, tw - 2, p, "sans-bold", ink);
      line("Gas ______  Charge ______ kg", tx + 1, fy + fh * 0.52, tw - 2, p, "sans", ink);
    }
  }
  return { w, h, round, bg, shapes };
}

/** QR modules as horizontal runs, so the artwork has a few hundred rectangles rather than thousands. */
export function qrRuns(data: string): { n: number; runs: [number, number, number][] } {
  const q = qrcode(0, "M");
  q.addData(data);
  q.make();
  const n = q.getModuleCount();
  const runs: [number, number, number][] = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!q.isDark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && q.isDark(r, c)) c++;
      runs.push([r, start, c - start]);
    }
  }
  return { n, runs };
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const FONT: Record<Font, string> = {
  sans: `font-family="Helvetica, Arial, sans-serif"`,
  "sans-bold": `font-family="Helvetica, Arial, sans-serif" font-weight="700"`,
  "mono-bold": `font-family="Courier New, Courier, monospace" font-weight="700"`,
};

/** The artwork as an SVG sized in millimetres. */
export function artworkSvg(a: Artwork, opts: { cutLine?: boolean } = {}): string {
  const clip = a.round
    ? `<circle cx="${a.w / 2}" cy="${a.h / 2}" r="${a.w / 2}"/>`
    : `<rect width="${a.w}" height="${a.h}" rx="${opts.cutLine === false ? 0 : 2}"/>`;
  const id = `c${Math.random().toString(36).slice(2, 8)}`;
  const body = a.shapes
    .map((s) => {
      switch (s.t) {
        case "rect":
          return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r ?? 0}" fill="${s.fill ?? "none"}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.sw ?? 0.3}"` : ""}/>`;
        case "circle":
          return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${s.fill ?? "none"}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.sw ?? 0.3}"` : ""}/>`;
        case "text":
          return `<text x="${s.x}" y="${s.y}" font-size="${(s.pt * PT).toFixed(3)}" ${FONT[s.font]} fill="${s.fill}"${s.align === "center" ? ` text-anchor="middle"` : ""}>${esc(s.text)}</text>`;
        case "image":
          return `<image x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" href="${esc(s.src)}" preserveAspectRatio="xMinYMid meet"/>`;
        case "qr": {
          const { n, runs } = qrRuns(s.data);
          const u = s.size / n;
          const d = runs
            .map(
              ([r, c, len]) =>
                `M${(s.x + c * u).toFixed(3)} ${(s.y + r * u).toFixed(3)}h${(len * u).toFixed(3)}v${u.toFixed(3)}h${(-len * u).toFixed(3)}z`,
            )
            .join("");
          return `<path d="${d}" fill="#000"/>`;
        }
      }
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${a.w} ${a.h}" width="${a.w}mm" height="${a.h}mm"><defs><clipPath id="${id}">${clip}</clipPath></defs><g clip-path="url(#${id})"><rect width="${a.w}" height="${a.h}" fill="${a.bg}"/>${body}</g></svg>`;
}
