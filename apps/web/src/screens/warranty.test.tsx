import { addDays } from "@airledger/domain";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import type { UnitRow } from "../assets";
import { warrantyAlerts, type SiteView } from "../overview";
import { fakeSupabase } from "../test/fakeSupabase";
import { todayIso } from "./Assets";
import { registerCsvRows } from "./Register";

const today = todayIso();
const ed = { id: "u-ed", email: "ed@a.test" };
const member = (role: string) => ({
  role,
  orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null },
});
const system = {
  id: "s1",
  client_id: "c1",
  name: "Surgery heat pumps",
  site_address: "",
  site_postcode: "BH1 1AA",
  install_date: "2024-03-01",
  commissioned_by: "",
  service_interval_months: null,
  warranty_years: 5,
  refrigerant: "R32",
  gwp: null,
  factory_charge_kg: 1.2,
  added_charge_kg: null,
  hermetic: false,
  leak_detection: false,
  access_notes: "",
  notes: "",
  inactive: false,
};
const unit = (over: Partial<UnitRow> = {}): UnitRow => ({
  id: "un1",
  asset_no: 1,
  sticker_code: "AC-AAAA1",
  system_id: "s1",
  role: "outdoor",
  indoor_type: null,
  manufacturer: "Daikin",
  model: "RXM35R",
  serial: "",
  capacity_kw: 3.5,
  location: "Yard",
  filter_type: null,
  controller: null,
  condensate_pump: false,
  from_sticker: true,
  notes: "",
  warranty_end: null,
  warranty_registered: false,
  warranty_ref: "",
  ...over,
});
const site = (install: string | null, warrantyEnd: string | null, units: UnitRow[]) =>
  ({
    system: { ...system, install_date: install },
    client: { name: "Harbour Dental" },
    units,
    info: { warrantyEnd, fgas: { kg: 1.2, tonnesCo2e: 0.81, required: false, months: 0 } },
  }) as unknown as SiteView;

function app(role: string, tables: Record<string, unknown[]> = {}) {
  const fake = fakeSupabase({
    signedInAs: ed,
    tables: {
      members: [member(role)],
      clients: [{ id: "c1", name: "Harbour Dental" }],
      systems: [system],
      units: [unit()],
      documents: [],
      files: [{ id: "f1", path: "org-a/docs/x-cert.pdf" }],
      ...tables,
    },
  });
  render(<App client={fake.client} />);
  return fake.calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("warranty reminders", () => {
  it("flags warranties ending in the next 60 days, and recent units not registered", () => {
    const ending = unit({ id: "a", warranty_end: addDays(today, 20), warranty_registered: true });
    const fresh = unit({ id: "b" });
    const old = unit({ id: "c" });
    const done = unit({ id: "d", warranty_registered: true });
    const out = warrantyAlerts({
      today,
      sites: [
        site(addDays(today, -10), addDays(today, 1800), [ending, fresh, done]),
        site("2020-01-01", addDays(today, 300), [old]),
      ],
    });
    expect(out.map((x) => [x.unit.id, x.why])).toEqual([
      ["b", "unregistered"],
      ["a", "ending"],
    ]);
  });
  it("ignores warranties that have already run out", () => {
    const out = warrantyAlerts({ today, sites: [site(addDays(today, -5), addDays(today, -1), [unit()])] });
    expect(out).toEqual([]);
  });
  it("puts the warranty in the asset register", () => {
    const rows = registerCsvRows([
      {
        unit: unit({ warranty_registered: true, warranty_ref: "SBM-1" }),
        site: site(null, "2029-03-01", []),
      },
    ]);
    expect(rows[0]?.slice(-3)).toEqual(["Warranty to", "Warranty registered", "Warranty reference"]);
    expect(rows[1]?.slice(-3)).toEqual(["01/03/2029", "Yes", "SBM-1"]);
  });
});

describe("on a unit", () => {
  it("records the warranty end and manufacturer registration", async () => {
    window.location.hash = "#/u/AC-AAAA1";
    const calls = app("member");
    expect(await screen.findByText("1 Mar 2029 (the install's)")).toBeTruthy();
    expect(screen.getByText("Not yet registered with the manufacturer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText("Warranty ends (leave blank to use the install's)"), {
      target: { value: "2031-03-01" },
    });
    fireEvent.click(screen.getByLabelText("Registered with the manufacturer"));
    fireEvent.change(screen.getByLabelText("Registration reference"), { target: { value: "SBM-123" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(calls.some((c) => c.name === "units.update")).toBe(true));
    expect((calls.find((c) => c.name === "units.update")?.args as unknown[])[0]).toMatchObject({
      warranty_end: "2031-03-01",
      warranty_registered: true,
      warranty_ref: "SBM-123",
    });
  });

  it("uploads the warranty certificate against the unit", async () => {
    window.location.hash = "#/u/AC-AAAA1";
    const calls = app("member");
    const input = await screen.findByLabelText("Upload document");
    const file = new File(["%PDF"], "Daikin warranty.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(calls.some((c) => c.name === "documents.insert")).toBe(true));
    const path = (calls.find((c) => c.name === "storage.photos.upload")?.args as string[])[0];
    expect(path).toMatch(/^org-a\/docs\/[0-9a-f-]{36}-Daikin-warranty\.pdf$/);
    expect((calls.find((c) => c.name === "files.insert")?.args as unknown[])[0]).toMatchObject({
      kind: "document",
      path,
    });
    expect((calls.find((c) => c.name === "documents.insert")?.args as unknown[])[0]).toMatchObject({
      system_id: "s1",
      unit_id: "un1",
      kind: "warranty",
      name: "Daikin warranty.pdf",
    });
  });

  it("lets owners, not engineers, delete a document", async () => {
    const doc = {
      id: "d1",
      system_id: "s1",
      unit_id: null,
      kind: "warranty",
      name: "Certificate.pdf",
      file_id: "f1",
      created_at: "2026-11-01T10:00:00Z",
    };
    window.location.hash = "#/system/s1";
    app("member", { documents: [doc] });
    expect(await screen.findByText("Certificate.pdf")).toBeTruthy();
    expect(screen.getByText(/Whole install/, { selector: ".m" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete Certificate.pdf" })).toBeNull();
    cleanup();
    window.location.hash = "#/system/s1";
    window.confirm = () => true;
    const calls = app("owner", { documents: [doc] });
    fireEvent.click(await screen.findByRole("button", { name: "Delete Certificate.pdf" }));
    await waitFor(() => expect(calls.some((c) => c.name === "storage.photos.remove")).toBe(true));
    expect(calls.some((c) => c.name === "files.delete")).toBe(true);
  });
});
