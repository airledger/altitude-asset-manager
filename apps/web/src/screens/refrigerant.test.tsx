import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { contents, levelText, logCsvRows, totals, type Cylinder, type LogRow } from "../refrigerant";
import { fakeSupabase } from "../test/fakeSupabase";

const ed = { id: "u-ed", email: "ed@a.test" };
const membership = (role: string) => ({
  role,
  orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null },
});
const cylinder = (over: Partial<Cylinder>): Cylinder => ({
  id: "y1",
  code: "BOC 1",
  refrigerant: "R32",
  kind: "new",
  size_kg: 9,
  supplier: "BOC",
  holder: "Ed",
  received_on: "2026-10-01",
  status: "in_use",
  returned_on: null,
  notes: "",
  used_kg: 2.7,
  recovered_kg: 0,
  ...over,
});
const row = (over: Partial<LogRow>): LogRow => ({
  job_id: "j1",
  date: "2026-11-02",
  engineer: "Ed",
  job_type: "Repair / breakdown",
  system_id: "s1",
  system_name: "Surgery",
  site_postcode: "BH1 1AA",
  client_name: "Harbour Dental",
  refrigerant: "R32",
  kind: "added",
  kg: 1.2,
  cylinder_id: "y1",
  ...over,
});

function app(role: string, tables: Record<string, unknown[]> = {}) {
  const fake = fakeSupabase({
    signedInAs: ed,
    tables: { members: [membership(role)], cylinder_levels: [], refrigerant_log: [], ...tables },
  });
  render(<App client={fake.client} />);
  return fake.calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  window.location.hash = "";
  vi.restoreAllMocks();
});

describe("refrigerant rules", () => {
  it("shows what's left in new gas, and what's in a recovery cylinder", () => {
    expect(contents(cylinder({}))).toBe(6.3);
    expect(levelText(cylinder({}))).toBe("6.3 of 9 kg left");
    expect(levelText(cylinder({ kind: "recovery", size_kg: 12, used_kg: 0, recovered_kg: 4.2 }))).toBe(
      "4.2 kg recovered into a 12 kg cylinder",
    );
    expect(contents(cylinder({ used_kg: 10 }))).toBe(0);
  });

  it("totals charged and recovered by refrigerant, with CO2e where the GWP is known", () => {
    const t = totals([
      row({}),
      row({ kg: 0.8 }),
      row({ kind: "recovered", kg: 0.5 }),
      row({ refrigerant: "R410A", kg: 1 }),
      row({ refrigerant: "Other", kg: 3 }),
    ]);
    expect(t).toEqual([
      { refrigerant: "Other", added: 3, recovered: 0, tonnes: null },
      { refrigerant: "R32", added: 2, recovered: 0.5, tonnes: 1.35 },
      { refrigerant: "R410A", added: 1, recovered: 0, tonnes: 2.088 },
    ]);
  });

  it("makes a CSV line for each amount, with the cylinder", () => {
    const rows = logCsvRows(
      [row({}), row({ kind: "recovered", kg: 0.5, cylinder_id: null })],
      [cylinder({})],
    );
    expect(rows[0]).toContain("Tonnes CO2e charged");
    expect(rows[1]).toEqual([
      "02/11/2026",
      "Harbour Dental",
      "Surgery",
      "BH1 1AA",
      "Repair / breakdown",
      "Ed",
      "R32",
      675,
      1.2,
      "",
      0.81,
      "BOC 1",
      "New gas",
    ]);
    expect(rows[2]?.slice(8, 13)).toEqual(["", 0.5, "", "", ""]);
  });
});

describe("refrigerant page", () => {
  it("lists cylinders with what's left and the log for the year", async () => {
    window.location.hash = "#/refrigerant";
    const calls = app("member", {
      cylinder_levels: [
        cylinder({}),
        cylinder({ id: "y2", code: "REC 1", kind: "recovery", size_kg: 12, used_kg: 0, recovered_kg: 0.5 }),
        cylinder({ id: "y3", code: "DONE", status: "returned", returned_on: "2026-10-20" }),
      ],
      refrigerant_log: [row({}), row({ kind: "recovered", kg: 0.5, cylinder_id: "y2" })],
    });
    const cyls = await screen.findByRole("region", { name: "Cylinders" });
    expect(await within(cyls).findByText(/6.3 of 9 kg left · with Ed/)).toBeTruthy();
    expect(within(cyls).getByText(/0.5 kg recovered into a 12 kg cylinder/)).toBeTruthy();
    expect(within(cyls).queryByText(/DONE/)).toBeNull();
    fireEvent.click(within(cyls).getByLabelText("Show empty and returned"));
    expect(within(cyls).getByText(/returned 20 Oct 2026/)).toBeTruthy();
    // Engineers can't delete a cylinder.
    expect(within(cyls).queryByRole("button", { name: "Delete" })).toBeNull();

    const log = screen.getByRole("region", { name: "Refrigerant log" });
    expect(await within(log).findByText("Charged 1.2 kg R32")).toBeTruthy();
    expect(within(log).getByText(/cylinder BOC 1/)).toBeTruthy();
    const year = new Date().getFullYear();
    const gte = calls.find((c) => c.name === "refrigerant_log.gte")?.args;
    expect(gte).toEqual(["date", `${year}-01-01`]);
    expect(calls.find((c) => c.name === "refrigerant_log.lte")?.args).toEqual(["date", `${year}-12-31`]);
  });

  it("adds a cylinder", async () => {
    window.location.hash = "#/refrigerant";
    const calls = app("member");
    fireEvent.click(await screen.findByRole("button", { name: "Add a cylinder" }));
    const form = screen.getByRole("form", { name: "Cylinder" });
    fireEvent.change(within(form).getByLabelText("Cylinder number"), { target: { value: "BOC 77" } });
    fireEvent.change(within(form).getByLabelText("Type"), { target: { value: "recovery" } });
    fireEvent.change(within(form).getByLabelText("Refrigerant"), { target: { value: "R410A" } });
    fireEvent.change(within(form).getByLabelText("Size (kg)"), { target: { value: "12" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add cylinder" }));
    await waitFor(() => expect(calls.some((c) => c.name === "cylinders.insert")).toBe(true));
    expect((calls.find((c) => c.name === "cylinders.insert")?.args as unknown[])[0]).toMatchObject({
      code: "BOC 77",
      kind: "recovery",
      refrigerant: "R410A",
      size_kg: 12,
      org_id: "org-a",
    });
  });

  it("marks a cylinder returned to the supplier", async () => {
    window.location.hash = "#/refrigerant";
    const calls = app("owner", { cylinder_levels: [cylinder({})] });
    fireEvent.click(await screen.findByRole("button", { name: "Returned to supplier" }));
    await waitFor(() => expect(calls.some((c) => c.name === "cylinders.update")).toBe(true));
    expect((calls.find((c) => c.name === "cylinders.update")?.args as unknown[])[0]).toMatchObject({
      status: "returned",
    });
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });
});
