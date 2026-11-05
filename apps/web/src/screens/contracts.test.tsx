import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { contractState, priceText, visitDates } from "../contracts";
import { fakeSupabase } from "../test/fakeSupabase";

const olivia = { id: "u-o", email: "olivia@a.test" };
const membership = (role: string) => ({
  role,
  orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null },
});
const client = {
  id: "c1",
  name: "Harbour Dental",
  contact_name: "Pat",
  phone: "",
  email: "",
  preferred_contact: "Email",
  billing_address: "",
  postcode: "BH15 1AA",
  on_service_plan: true,
  reminders_opt_in: true,
  notes: "",
};
const system = (id: string, name: string) => ({
  id,
  client_id: "c1",
  name,
  site_address: "",
  site_postcode: "",
  install_date: null,
  commissioned_by: "",
  service_interval_months: null,
  warranty_years: null,
  refrigerant: "R32",
  gwp: null,
  factory_charge_kg: 1,
  added_charge_kg: 0,
  hermetic: false,
  leak_detection: false,
  access_notes: "",
  notes: "",
  inactive: false,
});
const contract = {
  id: "k1",
  client_id: "c1",
  name: "Planned maintenance",
  start_date: "2026-06-01",
  end_date: "2099-06-01",
  visits_per_year: 2,
  visit_type: "Annual service",
  auto_renew: true,
  status: "active",
  notes: "",
  contract_systems: [{ system_id: "s1" }],
};

function app(role: string, tables: Record<string, unknown[]> = {}) {
  const fake = fakeSupabase({
    signedInAs: olivia,
    rpc: { book_contract_visits: 2, bill_due_contracts: 1 },
    tables: {
      members: [membership(role)],
      clients: [client],
      systems: [system("s1", "Surgery"), system("s2", "Office")],
      contracts: [],
      contract_prices: [],
      jobs: [],
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
  vi.restoreAllMocks();
});

describe("contract rules", () => {
  it("spreads the visits evenly through the year", () => {
    expect(visitDates({ start_date: "2026-01-31", end_date: "2027-01-31", visits_per_year: 4 })).toEqual([
      "2026-01-31",
      "2026-04-30",
      "2026-07-31",
      "2026-10-31",
    ]);
  });
  it("says how the price is billed", () => {
    expect(priceText({ price: 1200, billing: "monthly" })).toBe("£1,200.00 a year, billed monthly (£100.00)");
    expect(priceText({ price: 90, billing: "visit" })).toBe("£90.00 a visit");
  });
  it("flags a renewal due in the next 30 days", () => {
    const c = { status: "active" as const, start_date: "2026-01-01", end_date: "2026-12-01" };
    expect(contractState(c, "2026-11-05").label).toBe("Renewal due");
    expect(contractState(c, "2026-12-01").label).toBe("Ended");
    expect(contractState(c, "2026-06-01").label).toBe("Active");
  });
});

describe("contracts on a client", () => {
  it("lets an owner add one, covering the installs chosen, and books its visits", async () => {
    window.location.hash = "#/client/c1";
    const calls = app("owner");
    fireEvent.click(await screen.findByRole("button", { name: "Add contract" }));
    const form = screen.getByRole("form", { name: "Contract" });
    fireEvent.change(within(form).getByLabelText("Starts"), { target: { value: "2026-12-01" } });
    expect((within(form).getByLabelText("Renewal date") as HTMLInputElement).value).toBe("2027-12-01");
    fireEvent.change(within(form).getByLabelText("Visits a year"), { target: { value: "2" } });
    expect(within(form).getByText(/1 Dec 2026, 1 Jun 2027/)).toBeTruthy();
    await waitFor(() => expect(within(form).getByLabelText("Office")).toBeTruthy());
    fireEvent.click(within(form).getByLabelText("Office"));
    fireEvent.change(within(form).getByLabelText("Contract price (£)"), { target: { value: "1200" } });
    fireEvent.change(within(form).getByLabelText("Billed"), { target: { value: "monthly" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save contract" }));
    expect(await screen.findByText(/2 visits booked in the diary/)).toBeTruthy();
    expect((calls.find((c) => c.name === "contracts.upsert")?.args as unknown[])[0]).toMatchObject({
      client_id: "c1",
      start_date: "2026-12-01",
      end_date: "2027-12-01",
      visits_per_year: 2,
      org_id: "org-a",
    });
    const covered = (calls.find((c) => c.name === "contract_systems.insert")?.args as unknown[])[0];
    expect(covered).toEqual([{ contract_id: "new-contracts", system_id: "s1", org_id: "org-a" }]);
    expect((calls.find((c) => c.name === "contract_prices.upsert")?.args as unknown[])[0]).toMatchObject({
      price: 1200,
      billing: "monthly",
    });
    expect(calls.find((c) => c.name === "book_contract_visits")?.args).toEqual({
      p_contract: "new-contracts",
    });
  });

  it("shows engineers what's covered and the next visit, but not the price", async () => {
    window.location.hash = "#/client/c1";
    const calls = app("member", {
      contracts: [contract],
      contract_prices: [{ contract_id: "k1", price: 1200, billing: "monthly", next_bill_date: null }],
      jobs: [{ contract_id: "k1", date: "2099-01-10" }],
    });
    const card = await screen.findByRole("region", { name: "Contracts" });
    expect(await within(card).findByText(/Next visit 10 Jan 2099/)).toBeTruthy();
    expect(within(card).getByText(/Surgery/)).toBeTruthy();
    expect(within(card).queryByText(/a year, billed/)).toBeNull();
    expect(within(card).queryByRole("button", { name: "Add contract" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(calls.some((c) => c.name === "contract_prices.select")).toBe(false);
  });

  it("drafts the contract bills that are due when an owner opens Invoices", async () => {
    window.location.hash = "#/invoices";
    const calls = app("owner", {
      org_settings: [{ accounts_app: "xero", vat_registered: true, payment_days: 14 }],
      invoice_counters: [{ prefix: "", next_number: 1001 }],
      invoices: [],
    });
    expect(await screen.findByText(/1 contract bill/)).toBeTruthy();
    expect(calls.find((c) => c.name === "bill_due_contracts")?.args).toEqual({ p_org: "org-a" });
  });
});
