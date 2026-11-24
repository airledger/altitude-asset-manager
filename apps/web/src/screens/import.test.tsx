import { toCsv } from "@airledger/domain";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { checkRows, guessMapping, parseCsv, parseDate, parseNumber, templateRows } from "../importer";
import { fakeSupabase } from "../test/fakeSupabase";

describe("reading the spreadsheet", () => {
  it("reads CSV with quotes, semicolons and Excel's byte-order mark", () => {
    expect(parseCsv('﻿Name,Address\r\n"Smith, J","1 ""Old"" Rd\nPoole"\r\n\r\n')).toEqual([
      ["Name", "Address"],
      ["Smith, J", '1 "Old" Rd\nPoole'],
    ]);
    expect(parseCsv("Customer;Postcode\nCliff Hotel;BH1 1AA")).toEqual([
      ["Customer", "Postcode"],
      ["Cliff Hotel", "BH1 1AA"],
    ]);
  });

  it("matches other systems' column names, each used once", () => {
    const map = guessMapping([
      "Customer Name",
      "Site Postcode",
      "Postcode",
      "Make",
      "Model No",
      "Serial Number",
      "Last Serviced",
      "Qty",
    ]);
    expect(map).toEqual({
      client_name: 0,
      site_postcode: 1,
      postcode: 2,
      manufacturer: 3,
      model: 4,
      serial: 5,
      last_service: 6,
    });
    // The template's own headings all match.
    const [headers = []] = templateRows();
    expect(Object.keys(guessMapping(headers))).toHaveLength(headers.length);
  });

  it("understands UK dates and numbers with units", () => {
    expect(parseDate("01/03/2026")).toBe("2026-03-01");
    expect(parseDate("1.3.26")).toBe("2026-03-01");
    expect(parseDate("2026-03-01")).toBe("2026-03-01");
    expect(parseDate("1st March 2026")).toBe("2026-03-01");
    expect(parseDate("Mar 2026")).toBe("2026-03-01");
    expect(parseDate("31/02/2026")).toBe("bad");
    expect(parseDate("soon")).toBe("bad");
    expect(parseDate("")).toBeNull();
    expect(parseNumber("3.5kW")).toBe(3.5);
    expect(parseNumber("1,2 kg")).toBe(1.2);
    expect(parseNumber("lots")).toBe("bad");
  });

  it("checks every row and counts what will be added", () => {
    const [headers, example] = templateRows() as [string[], string[]];
    const outdoor = [...example];
    outdoor[16] = "Outdoor";
    outdoor[17] = "";
    const broken = [...example];
    broken[0] = "";
    const odd = [...example];
    odd[0] = "Cliff Hotel";
    odd[1] = "";
    odd[11] = "sometime";
    const c = checkRows([example, outdoor, broken, odd], guessMapping(headers));
    expect(c.rows).toHaveLength(3);
    expect(c.clients).toBe(2);
    expect(c.systems).toBe(2);
    expect(c.units).toBe(3);
    expect(c.problems).toEqual([
      { row: 4, message: "No client name" },
      { row: 5, message: 'Install date "sometime" isn\'t a date we understand' },
    ]);
    expect(c.rows[0]).toMatchObject({
      client: { name: "Harbour Dental", ref: "C-1001", email: "pat@harbourdental.co.uk" },
      system: {
        name: "Surgery",
        install_date: "2025-03-01",
        refrigerant: "R32",
        factory_charge_kg: 1.2,
        service_interval_months: 12,
      },
      unit: { role: "indoor", indoor_type: "Wall mounted", manufacturer: "Daikin", capacity_kw: 2.5 },
      last_service: "2026-03-01",
    });
    expect(c.rows[1]?.unit).toMatchObject({ role: "outdoor", indoor_type: null });
  });
});

const olivia = { id: "u-o", email: "olivia@a.test" };
const org = { id: "org-a", name: "Business A", slug: "a", logo_url: null };
function app(role = "owner", imports: unknown[] = []) {
  const fake = fakeSupabase({
    signedInAs: olivia,
    tables: { members: [{ role, orgs: org, user_id: olivia.id }], imports, clients: [] },
    rpc: { import_rows: { import: "imp-1", clients: 1, systems: 1, units: 1, jobs: 1 } },
  });
  render(<App client={fake.client} />);
  return fake;
}

afterEach(() => {
  cleanup();
  window.location.hash = "";
  vi.restoreAllMocks();
});

describe("the import page", () => {
  it("an owner picks a file, checks the columns and imports", async () => {
    window.location.hash = "#/import";
    const fake = app();
    const file = new File([toCsv(templateRows())], "old system.csv", { type: "text/csv" });
    fireEvent.change(await screen.findByLabelText("Spreadsheet to import"), { target: { files: [file] } });
    expect(await screen.findByText(/1 row ready/)).toBeTruthy();
    expect(screen.getByText("e.g. Harbour Dental")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import 1 row" }));
    expect(await screen.findByText(/Added 1 client, 1 install, 1 unit and 1 last service/)).toBeTruthy();
    const args = fake.calls.find((c) => c.name === "import_rows")?.args as Record<string, unknown>;
    expect(args).toMatchObject({ p_org: "org-a", p_import: null, p_file: "old system.csv" });
    expect((args.p_rows as unknown[])[0]).toMatchObject({ client: { name: "Harbour Dental" } });

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
    await waitFor(() =>
      expect(fake.calls).toContainEqual({ kind: "rpc", name: "undo_import", args: { p_import: "imp-1" } }),
    );
  });

  it("asks for a CSV when given an Excel file", async () => {
    window.location.hash = "#/import";
    app();
    const file = new File(["x"], "clients.xlsx");
    fireEvent.change(await screen.findByLabelText("Spreadsheet to import"), { target: { files: [file] } });
    expect(await screen.findByText(/Save the spreadsheet as CSV first/)).toBeTruthy();
  });

  it("lists past imports, and is for owners only", async () => {
    window.location.hash = "#/import";
    app("owner", [
      {
        id: "i1",
        file_name: "jobs.csv",
        clients: 40,
        systems: 52,
        units: 130,
        jobs: 50,
        created_at: "2026-11-20T10:00:00Z",
        undone_at: null,
      },
    ]);
    expect(await screen.findByText("jobs.csv")).toBeTruthy();
    expect(screen.getByText(/40 clients, 52 installs, 130 units/)).toBeTruthy();
    cleanup();
    window.location.hash = "#/import";
    app("member");
    expect(await screen.findByText("Only the business's owners can import.")).toBeTruthy();
  });
});
