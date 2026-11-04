import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { linesForJob, type PricingData } from "../invoices";
import { fakeSupabase } from "../test/fakeSupabase";

const olivia = { id: "u-o", email: "olivia@a.test" };
const membership = (role: string) => ({
  role,
  orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null },
});
const system = {
  id: "s1",
  client_id: "c1",
  name: "Surgery",
  site_address: "12 High St",
  site_postcode: "BH1 1AA",
  install_date: "2025-03-01",
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
};
const client = {
  id: "c1",
  name: "Harbour Dental",
  contact_name: "Pat",
  phone: "",
  email: "pat@harbour.test",
  preferred_contact: "Email",
  billing_address: "1 Quay, Poole",
  postcode: "BH15 1AA",
  on_service_plan: false,
  reminders_opt_in: true,
  notes: "",
};
const unit = (id: string, role: "indoor" | "outdoor") => ({
  id,
  asset_no: 1,
  sticker_code: "AC-1",
  system_id: "s1",
  role,
  indoor_type: role === "indoor" ? "Wall" : null,
  manufacturer: "",
  model: "",
  serial: "",
  capacity_kw: null,
  location: "",
  filter_type: null,
  controller: null,
  condensate_pump: false,
  from_sticker: true,
  notes: "",
});
const units = [unit("u1", "indoor"), unit("u2", "indoor"), unit("u3", "outdoor")];
const job = {
  id: "j1",
  system_id: "s1",
  type: "Annual service",
  status: "completed",
  date: "2026-11-03",
  time: null,
  duration_hrs: 1,
  engineer: "Ed",
  engineer_id: null,
  notes: "",
  materials_ordered: false,
  completed_at: "2026-11-03T10:00:00Z",
  completion_notes: "",
  billing: "pending",
};
const record = {
  checks: [],
  leak: null,
  commissioning: null,
  ordered: [],
  used: [
    { material_id: "m1", name: "Coil cleaner", sku: "", supplier: "", qty: 2, raw_qty: null, extra: false },
  ],
  report: null,
};
const pricing: PricingData = {
  prices: {
    labourFirst: 95,
    labourAdditional: 30,
    labourHourly: 60,
    leakCheckCharge: 40,
    refrigerantPerKg: 80,
    calloutCharge: 85,
  },
  materials: [],
  materialPrices: [{ material_id: "m1", cost: 4, sell: 9.5, chargeable: true }],
  accounts: {} as never,
};
const invoice = {
  id: "i1",
  number: "1001",
  client_id: "c1",
  job_id: "j1",
  date: "2026-11-03",
  due_date: "2026-11-17",
  reference: "Annual service BH1 1AA",
  vat_rate: 0.2,
  status: "draft",
  exported_at: null,
  auto: true,
  invoice_lines: [
    { id: "l1", position: 0, description: "Annual service", qty: 1, unit_price: 95 },
    { id: "l2", position: 1, description: "Coil cleaner", qty: 2, unit_price: 9.5 },
  ],
  clients: { name: "Harbour Dental" },
  jobs: { id: "j1", type: "Annual service", date: "2026-11-03" },
};

function app(role: string, tables: Record<string, unknown[]> = {}) {
  const fake = fakeSupabase({
    signedInAs: olivia,
    rpc: { create_invoice: "i-new" },
    tables: {
      members: [membership(role)],
      org_settings: [{ accounts_app: "xero", vat_registered: true, payment_days: 14 }],
      invoice_counters: [{ prefix: "", next_number: 1002 }],
      price_list: [
        {
          labour_first: 95,
          labour_additional: 30,
          labour_hourly: 60,
          leak_check_charge: 40,
          refrigerant_per_kg: 80,
          callout_charge: 85,
        },
      ],
      material_prices: pricing.materialPrices,
      materials: [],
      systems: [system],
      clients: [client],
      units,
      jobs: [job],
      job_parts: record.used.map((u) => ({ ...u, list: "used" })),
      invoices: [invoice],
      ...tables,
    },
  });
  render(<App client={fake.client} />);
  return fake.calls;
}

beforeEach(() => {
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("pricing a job", () => {
  const base = {
    job: job as never,
    record: record as never,
    system: system as never,
    client: client as never,
    billing: null,
    units: units as never,
    quote: null,
    pricing,
  };

  it("charges labour per unit and chargeable parts when out of contract", () => {
    expect(linesForJob(base)).toEqual([
      {
        desc: "Annual air conditioning service – Surgery, 12 High St BH1 1AA (first indoor unit + outdoor)",
        qty: 1,
        unit: 95,
      },
      { desc: "Additional indoor unit serviced", qty: 1, unit: 30 },
      { desc: "Coil cleaner", qty: 2, unit: 9.5 },
    ]);
  });

  it("covers the routine visit on a plan, and invoices it anyway when asked", () => {
    const plan = { ...base, client: { ...client, on_service_plan: true } as never };
    expect(linesForJob(plan)).toEqual([]);
    expect(linesForJob({ ...plan, ignorePlan: true })[0]?.unit).toBe(95);
    const perVisit = {
      ...plan,
      billing: {
        client_id: "c1",
        plan_price: 120,
        plan_billing: "visit" as const,
        accounts_name: "",
        sage_ref: "",
      },
    };
    expect(linesForJob(perVisit)).toEqual([
      {
        desc: "Annual air conditioning service (service plan) – Surgery, 12 High St BH1 1AA – 2 indoor units",
        qty: 1,
        unit: 120,
      },
    ]);
  });
});

describe("invoices", () => {
  it("drafts completed jobs when an owner opens Invoices, then lists them", async () => {
    window.location.hash = "#/invoices";
    const calls = app("owner");
    expect(await screen.findByText("1001 · Harbour Dental")).toBeTruthy();
    expect(screen.getByText("£136.80")).toBeTruthy();
    const draft = calls.find((c) => c.name === "create_invoice")?.args as Record<string, unknown>;
    expect(draft).toMatchObject({
      p_org: "org-a",
      p_client: "c1",
      p_job: "j1",
      p_date: "2026-11-03",
      p_due_date: "2026-11-17",
      p_vat: true,
      p_auto: true,
    });
    expect((draft.p_lines as unknown[]).length).toBe(3);
    expect(screen.getByText(/1 new draft invoice from completed jobs/)).toBeTruthy();
  });

  it("exports to the accounts software and marks them exported", async () => {
    window.location.hash = "#/invoices";
    const calls = app("owner", { jobs: [] });
    fireEvent.click(await screen.findByRole("button", { name: "Export 1 to Xero" }));
    await waitFor(() => expect(calls.some((c) => c.name === "invoices.update")).toBe(true));
    expect((calls.find((c) => c.name === "invoices.update")?.args as unknown[])[0]).toMatchObject({
      status: "exported",
    });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("edits the lines and saves them in one go", async () => {
    window.location.hash = "#/invoice/i1";
    const calls = app("owner", { jobs: [] });
    fireEvent.change(await screen.findByLabelText("Line 2 quantity"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a line" }));
    fireEvent.change(screen.getByLabelText("Line 3 description"), { target: { value: "Drain pump" } });
    fireEvent.change(screen.getByLabelText("Line 3 unit price"), { target: { value: "45" } });
    expect(screen.getByText("£202.20")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.name === "save_invoice")).toBe(true));
    expect((calls.find((c) => c.name === "save_invoice")?.args as Record<string, unknown>).p_lines).toEqual([
      { desc: "Annual service", qty: 1, unit: 95 },
      { desc: "Coil cleaner", qty: 3, unit: 9.5 },
      { desc: "Drain pump", qty: 1, unit: 45 },
    ]);
  });

  it("keeps invoices from engineers", async () => {
    window.location.hash = "#/invoices";
    const calls = app("member");
    expect(await screen.findByText("Owners only")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Invoices/ })).toBeNull();
    expect(calls.some((c) => c.name === "create_invoice")).toBe(false);
  });

  it("offers Invoice anyway on a plan visit", async () => {
    window.location.hash = "#/job/j1";
    const calls = app("owner", {
      jobs: [
        {
          ...job,
          billing: "plan",
          systems: { ...system, clients: { name: "Harbour Dental" } },
          job_leak_checks: null,
        },
      ],
      invoices: [],
      clients: [{ ...client, on_service_plan: true }],
    });
    fireEvent.click(await screen.findByRole("button", { name: "Invoice anyway" }));
    await waitFor(() => expect(window.location.hash).toBe("#/invoice/i-new"));
    expect((calls.find((c) => c.name === "create_invoice")?.args as Record<string, unknown>).p_auto).toBe(
      false,
    );
  });
});
