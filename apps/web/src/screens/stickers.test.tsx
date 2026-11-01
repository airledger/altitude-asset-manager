import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { DEFAULT_DESIGN, layoutSticker, readDesign, STICKER_SIZES, type StickerSize } from "../sticker";
import { a4Grid, stickerPdf } from "../stickerPdf";
import { fakeSupabase } from "../test/fakeSupabase";

const lewis = { id: "u-lewis", email: "lewis@a.test" };
const owner = { role: "owner", orgs: { id: "org-a", name: "Cool & Co", slug: "a", logo_url: null } };
const engineer = { ...owner, role: "member" };
const settings = {
  trading_as: "",
  phone: "01202 555000",
  email: "",
  website: "https://cool.example/",
  address: "",
  company_no: "",
  vat_no: "",
  fgas_cert: "",
  app_url: "",
  sticker_design: { size: "50round", style: "solid", colour: "#C8402F" },
};

function app(member: unknown, tables: Record<string, unknown[]> = {}, rpc: Record<string, unknown> = {}) {
  const fake = fakeSupabase({
    signedInAs: lewis,
    tables: { members: [member], org_settings: [settings], ...tables },
    rpc,
  });
  render(<App client={fake.client} />);
  return fake.calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("sticker artwork", () => {
  const brand = { businessName: "Cool & Co", phone: "01202 555000", website: "cool.example", logo: null };

  it("keeps everything on the sticker at every size and style", () => {
    for (const size of Object.keys(STICKER_SIZES) as StickerSize[])
      for (const style of ["band", "solid", "outline"] as const) {
        const a = layoutSticker(
          { ...DEFAULT_DESIGN, size, style },
          brand,
          "AC-7KQ2M",
          "https://x/u/AC-7KQ2M",
        );
        for (const s of a.shapes) {
          if (s.t === "qr") {
            expect(s.size, `${size} ${style} QR`).toBeGreaterThan(a.round ? 15 : 18);
            expect(s.x + s.size).toBeLessThanOrEqual(a.w);
            expect(s.y + s.size).toBeLessThanOrEqual(a.h);
          }
          if (s.t === "text") expect(s.y, `${size} ${style} "${s.text}"`).toBeLessThanOrEqual(a.h);
        }
      }
  });

  it("falls back to the default for a broken saved design", () => {
    expect(readDesign({ size: "huge", colour: "red", headline: 7 })).toEqual(DEFAULT_DESIGN);
    expect(readDesign({ size: "40round" }).size).toBe("40round");
  });

  it("fits labels with their bleed onto A4 sheets", async () => {
    expect(a4Grid({ ...DEFAULT_DESIGN, size: "63x38" }).perSheet).toBe(16);
    expect(a4Grid({ ...DEFAULT_DESIGN, size: "50round" }).perSheet).toBe(15);
    const codes = Array.from({ length: 20 }, (_, i) => `AC-${String(i).padStart(5, "2")}`);
    const text = await (
      await stickerPdf(DEFAULT_DESIGN, brand, codes, (c) => `https://x/u/${c}`, "a4")
    ).text();
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2);
  });

  it("makes a print-ready PDF with one page per code", async () => {
    const blob = await stickerPdf(
      DEFAULT_DESIGN,
      brand,
      ["AC-7KQ2M", "AC-9XYZ2", "AC-3HXP9"],
      (c) => `https://x/u/${c}`,
      "single",
    );
    const text = await blob.text();
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(3);
  });
});

describe("sticker designer", () => {
  it("opens the saved design and saves changes", async () => {
    window.location.hash = "#/labels/design";
    const calls = app(owner);
    expect(await screen.findByRole("img", { name: "Label preview, 50 mm round" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /75 × 50 mm/ }));
    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    fireEvent.click(screen.getByLabelText("F-gas box"));
    fireEvent.click(screen.getByText("Save design"));
    expect(await screen.findByText(/Design saved/)).toBeTruthy();
    const update = calls.find((c) => c.name === "org_settings.update");
    expect((update?.args as unknown[])[0]).toMatchObject({
      sticker_design: { size: "75x50", style: "outline", colour: "#C8402F", fgas: false },
    });
  });

  it("orders a batch and downloads the PDF and the code list", async () => {
    window.location.hash = "#/labels/design";
    const urls: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (urls.push(b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    const calls = app(
      owner,
      {
        sticker_reservations: [{ code: "AC-7KQ2M" }, { code: "AC-9XYZ2" }],
        sticker_batches: [
          { id: "batch-1", quantity: 2, design: {}, note: "", created_at: "2026-11-01T10:00:00Z" },
        ],
      },
      {
        create_sticker_batch: "batch-1",
      },
    );
    fireEvent.change(await screen.findByLabelText("How many"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "Van stock" } });
    fireEvent.click(screen.getByRole("button", { name: /Create 2 labels/ }));
    expect(await screen.findByText(/2 new codes reserved/, {}, { timeout: 5000 })).toBeTruthy();
    expect(calls).toContainEqual({
      kind: "rpc",
      name: "create_sticker_batch",
      args: {
        p_org: "org-a",
        p_count: 2,
        p_design: expect.objectContaining({ size: "50round", style: "solid" }),
        p_note: "Van stock",
      },
    });
    // One download per tap: the PDF now, the code list from Past orders.
    expect(urls.map((b) => b.type)).toEqual(["application/pdf"]);
    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    await waitFor(() => expect(urls).toHaveLength(2));
    expect(urls[1]?.type).toBe("text/csv");
    expect(await urls[1]?.text()).toContain("AC-9XYZ2,https://app.airledger.co.uk/u/AC-9XYZ2");
  });

  it("shows engineers the design without letting them change or order", async () => {
    window.location.hash = "#/labels/design";
    app(engineer);
    expect(await screen.findByText("Only an owner can change the design.")).toBeTruthy();
    expect(screen.queryByText("Save design")).toBeNull();
    expect(screen.queryByText("Order stickers")).toBeNull();
  });
});

describe("business details", () => {
  it("saves the contact details used on stickers and reports", async () => {
    window.location.hash = "#/business";
    const calls = app(owner);
    fireEvent.change(await screen.findByLabelText("VAT number"), { target: { value: "GB123456789" } });
    fireEvent.click(screen.getByText("Save details"));
    await waitFor(() => expect(calls.some((c) => c.name === "org_settings.update")).toBe(true));
    const update = calls.find((c) => c.name === "org_settings.update");
    expect((update?.args as unknown[])[0]).toMatchObject({ vat_no: "GB123456789", phone: "01202 555000" });
  });
});
