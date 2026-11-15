import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { findModel, manufacturers, OWN_RANGE, ranges, sizes, type EquipmentModel } from "../catalogue";
import { fakeSupabase } from "../test/fakeSupabase";

const ed = { id: "u-ed", email: "ed@a.test" };
const member = { role: "member", orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null } };
const client = { id: "c1", name: "Harbour Dental", postcode: "BH1 1AA", systems: [] };
const system = {
  id: "s1",
  client_id: "c1",
  name: "Surgery heat pumps",
  site_address: "",
  site_postcode: "BH1 1AA",
  install_date: null,
  commissioned_by: "",
  service_interval_months: null,
  warranty_years: null,
  refrigerant: "R410A",
  gwp: null,
  factory_charge_kg: null,
  added_charge_kg: null,
  hermetic: false,
  leak_detection: false,
  access_notes: "",
  notes: "",
  inactive: false,
};
const e = (over: Partial<EquipmentModel>): EquipmentModel => ({
  id: Math.random().toString(36).slice(2),
  org_id: null,
  manufacturer: "Daikin",
  range: "Perfera",
  model: "",
  role: "indoor",
  indoor_type: "Wall mounted",
  capacity_kw: 2.5,
  refrigerant: "R32",
  charge_kg: null,
  ...over,
});
const catalogue = [
  e({ id: "p25", model: "FTXM25R", capacity_kw: 2.5 }),
  e({ id: "p35", model: "FTXM35R", capacity_kw: 3.5 }),
  e({ id: "rc", range: "Roundflow cassette", indoor_type: "Cassette", capacity_kw: 5 }),
  e({ id: "o35", range: "Perfera", model: "RXM35R", role: "outdoor", indoor_type: null, capacity_kw: 3.5 }),
  e({ id: "me", manufacturer: "Mitsubishi Electric", range: "Zen (MSZ-LN)", capacity_kw: 3.5 }),
  // A model the business typed in before, with the charge from its install.
  e({
    id: "own",
    org_id: "org-a",
    range: "",
    model: "RXM35R",
    role: "outdoor",
    indoor_type: null,
    capacity_kw: 3.5,
    charge_kg: 0.85,
  }),
];

function app(tables: Record<string, unknown[]> = {}) {
  const fake = fakeSupabase({
    signedInAs: ed,
    tables: {
      members: [member],
      clients: [client],
      systems: [system],
      units: [],
      equipment_models: catalogue,
      ...tables,
    },
    rpc: { reserve_stickers: ["AC-NEW23"] },
  });
  render(<App client={fake.client} />);
  return fake.calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("catalogue rules", () => {
  it("lists makes, ranges and sizes for indoor or outdoor units", () => {
    expect(manufacturers(catalogue, "indoor")).toEqual(["Daikin", "Mitsubishi Electric"]);
    expect(ranges(catalogue, "daikin", "indoor")).toEqual(["Perfera", "Roundflow cassette"]);
    expect(sizes(catalogue, "Daikin", "Perfera", "indoor").map((x) => x.model)).toEqual([
      "FTXM25R",
      "FTXM35R",
    ]);
  });
  it("uses the business's own entry for a model it already knows, under the shared range", () => {
    const out = sizes(catalogue, "Daikin", "Perfera", "outdoor");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ org_id: "org-a", charge_kg: 0.85 });
    expect(findModel(catalogue, "DAIKIN", "rxm35r")?.charge_kg).toBe(0.85);
    expect(ranges([e({ org_id: "org-a", range: "", model: "X1" })], "Daikin", "indoor")).toEqual([OWN_RANGE]);
  });
});

describe("adding a unit", () => {
  it("picks make, range and size, which fills in the rest", async () => {
    window.location.hash = "#/system/s1";
    const calls = app();
    fireEvent.click(await screen.findByText("Add unit"));
    await waitFor(() => expect(document.querySelectorAll("#catalogue-makes option").length).toBe(2));
    fireEvent.change(screen.getByLabelText("Manufacturer"), { target: { value: "Daikin" } });
    fireEvent.change(screen.getByLabelText("Range"), { target: { value: "Perfera" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "p35" } });
    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("FTXM35R");
    expect((screen.getByLabelText("Capacity (kW)") as HTMLInputElement).value).toBe("3.5");
    expect((screen.getByLabelText("Indoor type") as HTMLSelectElement).value).toBe("Wall mounted");
    fireEvent.change(screen.getByLabelText("Serial number"), { target: { value: "K123" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(calls.some((c) => c.name === "units.insert")).toBe(true));
    expect((calls.find((c) => c.name === "units.insert")?.args as unknown[])[0]).toMatchObject({
      manufacturer: "Daikin",
      model: "FTXM35R",
      capacity_kw: 3.5,
      indoor_type: "Wall mounted",
      serial: "K123",
    });
  });

  it("offers the install the outdoor model's refrigerant and remembered charge", async () => {
    window.location.hash = "#/system/s1";
    const calls = app();
    fireEvent.click(await screen.findByText("Add unit"));
    fireEvent.click(screen.getByLabelText("Outdoor"));
    await waitFor(() => expect(document.querySelectorAll("#catalogue-makes option").length).toBe(1));
    fireEvent.change(screen.getByLabelText("Manufacturer"), { target: { value: "Daikin" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "RXM35R" } });
    const use = screen.getByLabelText("Set the install's refrigerant to R32 and factory charge to 0.85 kg");
    expect((use as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(calls.some((c) => c.name === "systems.update")).toBe(true));
    expect((calls.find((c) => c.name === "systems.update")?.args as unknown[])[0]).toEqual({
      refrigerant: "R32",
      factory_charge_kg: 0.85,
    });
  });

  it("still takes a make and model typed in by hand", async () => {
    window.location.hash = "#/system/s1";
    const calls = app();
    fireEvent.click(await screen.findByText("Add unit"));
    fireEvent.change(screen.getByLabelText("Manufacturer"), { target: { value: "Acme" } });
    expect(screen.queryByLabelText("Range")).toBeNull();
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "AC-9000" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(calls.some((c) => c.name === "units.insert")).toBe(true));
    expect((calls.find((c) => c.name === "units.insert")?.args as unknown[])[0]).toMatchObject({
      manufacturer: "Acme",
      model: "AC-9000",
    });
    expect(calls.some((c) => c.name === "systems.update")).toBe(false);
  });
});

describe("parts", () => {
  it("adds a common part to the materials list with its usual settings", async () => {
    window.location.hash = "#/materials";
    const fake = fakeSupabase({
      signedInAs: ed,
      tables: {
        members: [{ ...member, role: "owner" }],
        materials: [],
        part_catalogue: [
          { name: "Pipe insulation (per m)", applies_to: "indoor", qty_per: 10, needed_when: "install" },
        ],
      },
    });
    render(<App client={fake.client} />);
    fireEvent.click(await screen.findByRole("button", { name: /Add material/ }));
    fireEvent.change(await screen.findByLabelText("Pick a common part"), {
      target: { value: "Pipe insulation (per m)" },
    });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Pipe insulation (per m)");
    expect((screen.getByLabelText("Needed") as HTMLSelectElement).value).toBe("install");
    expect((screen.getByLabelText("How many each") as HTMLInputElement).value).toBe("10");
    expect(within(screen.getByLabelText("Needed")).getByText("Installs only")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.calls.some((c) => c.name === "materials.insert")).toBe(true));
    expect((fake.calls.find((c) => c.name === "materials.insert")?.args as unknown[])[0]).toMatchObject({
      name: "Pipe insulation (per m)",
      applies_to: "indoor",
      qty_per: 10,
      needed_when: "install",
    });
  });
});
