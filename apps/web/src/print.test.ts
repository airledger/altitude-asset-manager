import { describe, expect, it } from "vitest";
import type { SystemRow, UnitRow } from "./assets";
import { DEFAULT_DESIGN } from "./sticker";
import { labelSheetHtml, qrSvg, stickerOrderCsv, stickerSheetHtml, unitLink } from "./print";

const brand = { businessName: "Cool & Co", phone: "01202 000000", appUrl: "https://app.airledger.co.uk/" };

describe("printing", () => {
  it("links stickers to a real path that can be redirected for years", () => {
    expect(unitLink("AC-7KQ2M", "https://app.airledger.co.uk/#/clients")).toBe(
      "https://app.airledger.co.uk/u/AC-7KQ2M",
    );
  });

  it("lists ordered codes for the print company", () => {
    expect(stickerOrderCsv(["AC-7KQ2M", "AC-9XYZ2"], "https://app.airledger.co.uk")).toBe(
      "Code,QR link\r\nAC-7KQ2M,https://app.airledger.co.uk/u/AC-7KQ2M\r\nAC-9XYZ2,https://app.airledger.co.uk/u/AC-9XYZ2\r\n",
    );
  });

  it("draws a QR code", () => {
    expect(qrSvg("https://app.airledger.co.uk/u/AC-7KQ2M")).toMatch(
      /^<svg[^>]+viewBox="0 0 \d+ \d+".*<path d="M/,
    );
  });

  it("puts 21 stickers on each A4 page and escapes the business name", () => {
    const codes = Array.from({ length: 42 }, (_, i) => `AC-${String(i).padStart(5, "2")}`);
    const html = stickerSheetHtml(
      codes,
      DEFAULT_DESIGN,
      { businessName: "Cool & Co", phone: "01202 000000", website: "", logo: null },
      (c) => unitLink(c, brand.appUrl),
    );
    expect(html.match(/class="page"/g)).toHaveLength(2);
    expect(html.match(/class="st"/g)).toHaveLength(42);
    expect(html).toContain("COOL &amp; CO");
    expect(html).toContain("01202 000000");
  });

  it("labels a unit with its F-gas details and service due month", () => {
    const system = {
      refrigerant: "R32",
      gwp: null,
      factory_charge_kg: 1.2,
      added_charge_kg: 0.3,
      install_date: "2025-03-01",
    } as SystemRow;
    const unit = {
      sticker_code: "AC-7KQ2M",
      role: "outdoor",
      manufacturer: "Daikin",
      model: "RXM35",
      serial: "S1",
      location: "Roof",
    } as UnitRow;
    const html = labelSheetHtml([unit], system, "2026-03-01", brand);
    expect(html).toContain("R32 · 1.50 kg · GWP 675 · 1.01 t CO₂e");
    expect(html).toContain("Service due Mar 2026");
    expect(html).toContain("Outdoor unit</b> · Roof");
  });
});
