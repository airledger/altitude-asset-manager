import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { fakeSupabase } from "../test/fakeSupabase";
import { readHash } from "./Shell";

const ed = { id: "u-ed", email: "ed@a.test" };
const member = { role: "member", orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null } };
const client = {
  id: "c1",
  name: "Harbour Dental",
  contact_name: "Priya",
  phone: "",
  email: "",
  preferred_contact: "Email",
  billing_address: "",
  postcode: "BH1 1AA",
  on_service_plan: true,
  reminders_opt_in: true,
  notes: "",
  systems: [{ count: 2 }],
};
const system = {
  id: "s1",
  client_id: "c1",
  name: "Surgery heat pumps",
  site_address: "",
  site_postcode: "BH1 1AA",
  install_date: "2025-03-01",
  commissioned_by: "",
  service_interval_months: null,
  warranty_years: null,
  refrigerant: "R410A",
  gwp: null,
  factory_charge_kg: 3,
  added_charge_kg: 0,
  hermetic: false,
  leak_detection: false,
  access_notes: "",
  notes: "",
  inactive: false,
};
const unit = {
  id: "u1",
  sticker_code: "AC-7KQ2M",
  system_id: "s1",
  role: "indoor",
  indoor_type: "Cassette",
  manufacturer: "Daikin",
  model: "FCAG50B",
  serial: "X1",
  capacity_kw: 5,
  location: "Reception",
  filter_type: "Washable",
  controller: "Wired controller",
  condensate_pump: true,
  from_sticker: false,
  notes: "",
};

function app(tables: Record<string, unknown[]>, rpc: Record<string, unknown> = {}) {
  const fake = fakeSupabase({ signedInAs: ed, tables: { members: [member], ...tables }, rpc });
  render(<App client={fake.client} />);
  return fake.calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("clients", () => {
  it("lists clients and filters them by search", async () => {
    window.location.hash = "#/clients";
    app({
      clients: [client, { ...client, id: "c2", name: "Quay Bakery", postcode: "SO1 2BB", systems: [] }],
    });
    expect(await screen.findByText("Harbour Dental")).toBeTruthy();
    expect(screen.getByText(/2 installs · Service plan/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search clients"), { target: { value: "so1" } });
    expect(screen.queryByText("Harbour Dental")).toBeNull();
    expect(screen.getByText("Quay Bakery")).toBeTruthy();
  });

  it("adds a client for the current business", async () => {
    window.location.hash = "#/client/new";
    const calls = app({});
    fireEvent.change(await screen.findByLabelText("Client or company name"), {
      target: { value: "Quay Bakery" },
    });
    fireEvent.change(screen.getByLabelText("Postcode"), { target: { value: "so1 2bb" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(window.location.hash).toBe("#/client/new-clients"));
    const insert = (calls.find((c) => c.name === "clients.insert")?.args as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(insert).toMatchObject({
      name: "Quay Bakery",
      postcode: "SO1 2BB",
      org_id: "org-a",
      reminders_opt_in: true,
    });
  });
});

describe("installs", () => {
  it("shows the service and F-gas dates worked out by the rules", async () => {
    window.location.hash = "#/system/s1";
    app({ systems: [system], units: [unit], clients: [client] });
    expect(await screen.findByText("Surgery heat pumps")).toBeTruthy();
    // 3 kg of R410A = 6.26 t CO₂e, so leak checks every 12 months from install.
    expect(screen.getByText(/R410A, 3 kg \(6.26 t CO₂e\)/)).toBeTruthy();
    expect(screen.getByText(/Every 12 months, next 1 Mar 2026/)).toBeTruthy();
    expect(screen.getByText("Cassette · Daikin · FCAG50B")).toBeTruthy();
  });

  it("reserves a sticker code for a new unit without a pre-printed sticker", async () => {
    window.location.hash = "#/system/s1";
    const calls = app(
      { systems: [system], units: [], clients: [client] },
      { reserve_stickers: ["AC-NEW23"] },
    );
    fireEvent.click(await screen.findByText("Add unit"));
    fireEvent.click(screen.getByLabelText("Outdoor"));
    fireEvent.change(screen.getByLabelText("Manufacturer"), { target: { value: "Mitsubishi" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(calls.some((c) => c.name === "units.insert")).toBe(true));
    expect(calls).toContainEqual({
      kind: "rpc",
      name: "reserve_stickers",
      args: { p_org: "org-a", p_count: 1 },
    });
    const insert = (calls.find((c) => c.name === "units.insert")?.args as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(insert).toMatchObject({
      sticker_code: "AC-NEW23",
      role: "outdoor",
      indoor_type: null,
      from_sticker: false,
    });
  });
});

describe("site records", () => {
  it("shows notes and photos for an install", async () => {
    window.location.hash = "#/system/s1";
    app({
      systems: [system],
      units: [unit],
      clients: [client],
      site_records: [
        {
          id: "r1",
          system_id: "s1",
          unit_id: "u1",
          kind: "Install / commissioning report",
          date: "2025-03-01",
          author: "Ed",
          text: "Pipe run behind the ceiling tiles",
          photo_file_ids: ["f1"],
        },
      ],
      files: [{ id: "f1", path: "org-a/f1.jpg" }],
    });
    expect(await screen.findByText("Pipe run behind the ceiling tiles")).toBeTruthy();
    expect(screen.getByText(/Ed · Cassette · Daikin · FCAG50B \(AC-7KQ2M\)/)).toBeTruthy();
    const img = (await screen.findByAltText("Photo from 1 Mar 2025")) as HTMLImageElement;
    expect(img.src).toBe("https://signed/org-a/f1.jpg");
  });

  it("adds a note, and needs notes or a photo", async () => {
    window.location.hash = "#/system/s1";
    const calls = app({ systems: [system], units: [unit], clients: [client], site_records: [] });
    fireEvent.click(await screen.findByText("Add note or photos"));
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("Add some notes or at least one photo.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Isolator on the left of the condenser" },
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(calls.some((c) => c.name === "site_records.insert")).toBe(true));
    const insert = (calls.find((c) => c.name === "site_records.insert")?.args as unknown[])[0];
    expect(insert).toMatchObject({
      system_id: "s1",
      kind: "Site note",
      text: "Isolator on the left of the condenser",
      author: "ed@a.test",
      photo_file_ids: [],
    });
  });

  it("uploads photos into the business's own folder", async () => {
    window.location.hash = "#/system/s1";
    const calls = app({ systems: [system], units: [], clients: [client], site_records: [] });
    fireEvent.click(await screen.findByText("Add note or photos"));
    const photo = new File(["jpeg"], "condenser.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Photos"), { target: { files: [photo] } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(calls.some((c) => c.name === "site_records.insert")).toBe(true));
    const path = (calls.find((c) => c.name === "storage.photos.upload")?.args as string[])[0];
    expect(path).toMatch(/^org-a\/[0-9a-f-]{36}\.jpg$/);
    const insert = (calls.find((c) => c.name === "site_records.insert")?.args as unknown[])[0];
    expect(insert).toMatchObject({ photo_file_ids: ["new-files"] });
  });
});

describe("stickers", () => {
  it("offers installs for a sticker that isn't on a unit yet, and opens the unit form with its code", async () => {
    window.location.hash = "#/u/AC-NEW99";
    app({ units: [], systems: [{ ...system, clients: { name: "Harbour Dental" } }] });
    expect(await screen.findByRole("heading", { name: "New sticker AC-NEW99" })).toBeTruthy();
    const add = await screen.findByRole("link", { name: "Add here" });
    expect(add.getAttribute("href")).toBe("#/system/s1?sticker=AC-NEW99");
  });

  it("adds a scanned sticker to an install", async () => {
    window.location.hash = "#/system/s1?sticker=AC-NEW99";
    app({ systems: [system], units: [], clients: [client] });
    fireEvent.click(await screen.findByText("Add as a new unit"));
    expect(((await screen.findByLabelText(/Pre-printed sticker code/)) as HTMLInputElement).value).toBe(
      "AC-NEW99",
    );
  });

  it("moves an existing unit onto a replacement sticker", async () => {
    window.location.hash = "#/system/s1?sticker=AC-NEW99";
    const calls = app({ systems: [system], units: [unit], clients: [client] });
    expect(await screen.findByText("Old sticker AC-7KQ2M · Reception")).toBeTruthy();
    fireEvent.click(screen.getByText("Put sticker on this unit"));
    await waitFor(() => expect(window.location.hash).toBe("#/u/AC-NEW99"));
    expect(calls).toContainEqual({
      kind: "from",
      name: "units.update",
      args: [{ sticker_code: "AC-NEW99", from_sticker: true }],
    });
  });

  it("opens a unit from a typed code", async () => {
    app({ units: [unit], systems: [system] });
    fireEvent.change(await screen.findByLabelText("Sticker code or link"), { target: { value: "ac7kq2m" } });
    fireEvent.click(screen.getByText("Open unit"));
    expect(await screen.findByText("Cassette · Daikin · FCAG50B")).toBeTruthy();
    expect(window.location.hash).toBe("#/u/AC-7KQ2M");
  });

  it("lists the stickers in use on the Stickers page", async () => {
    window.location.hash = "#/stickers";
    app({
      units: [
        { ...unit, created_at: "2025-03-01", systems: { ...system, clients: { name: "Harbour Dental" } } },
      ],
    });
    const row = await screen.findByRole("link", { name: /AC-7KQ2M/ });
    expect(row.getAttribute("href")).toBe("#/u/AC-7KQ2M");
    expect(screen.getByText("Harbour Dental · Surgery heat pumps · Reception")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Stickers" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows overdue services on Home", async () => {
    app({ systems: [{ ...system, clients: { name: "Harbour Dental" } }], clients: [client] });
    expect(await screen.findByText("Needs attention")).toBeTruthy();
    const row = await screen.findByRole("link", { name: /Harbour Dental/ });
    expect(row.getAttribute("href")).toBe("#/system/s1");
    expect(row.textContent).toMatch(/Overdue/);
  });

  it("reads new and old sticker links", () => {
    expect(readHash("#/u/AC-7KQ2M")).toMatchObject({ page: "u", arg: "AC-7KQ2M" });
    expect(readHash("#u-ac-7kq2m")).toMatchObject({ page: "u", arg: "AC-7KQ2M" });
    const r = readHash("#/system/new?client=c1");
    expect([r.page, r.arg, r.query.get("client")]).toEqual(["system", "new", "c1"]);
  });
});
