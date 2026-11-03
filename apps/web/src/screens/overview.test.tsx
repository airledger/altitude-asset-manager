import { addDays, addMonths } from "@airledger/domain";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { fakeSupabase } from "../test/fakeSupabase";
import { todayIso } from "./Assets";

const olivia = { id: "u-olivia", email: "olivia@a.test" };
const org = { id: "org-a", name: "Business A", slug: "a", logo_url: null };
const today = todayIso();
const client = {
  id: "c1",
  name: "Harbour Dental",
  contact_name: "Priya Shah",
  phone: "07700 900123",
  email: "priya@harbour.test",
  preferred_contact: "Email",
  billing_address: "",
  postcode: "BH1 1AA",
  on_service_plan: false,
  reminders_opt_in: true,
  notes: "",
  systems: [{ count: 1 }],
};
// Installed a year ago less 10 days, so the annual service is due in 10 days.
const system = {
  id: "s1",
  client_id: "c1",
  name: "Surgery heat pumps",
  site_address: "12 High St, Bournemouth",
  site_postcode: "BH1 1AA",
  install_date: addDays(addMonths(today, -12), 10),
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
  clients: { name: "Harbour Dental" },
};
const unit = (id: string, n: number, role: string) => ({
  id,
  asset_no: n,
  sticker_code: `AC-AAAA${n}`,
  system_id: "s1",
  role,
  indoor_type: role === "indoor" ? "Cassette" : null,
  manufacturer: "Daikin",
  model: "X",
  serial: `S${n}`,
  capacity_kw: null,
  location: role === "indoor" ? "Reception" : "Yard",
  filter_type: null,
  controller: null,
  condensate_pump: false,
  from_sticker: true,
  notes: "",
});
const job = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  system_id: "s1",
  type: "Repair / breakdown",
  status: "booked",
  date,
  time: "09:30:00",
  duration_hrs: 1,
  engineer: "Ed",
  engineer_id: "p-ed",
  notes: "",
  materials_ordered: false,
  completed_at: null,
  completion_notes: "",
  billing: "none",
  systems: { ...system, clients: { name: "Harbour Dental" } },
  job_leak_checks: null,
  ...extra,
});
const material = (
  id: string,
  name: string,
  supplier: string,
  applies_to: string,
  needed_when = "service",
) => ({
  id,
  name,
  supplier,
  sku: id.toUpperCase(),
  applies_to,
  qty_per: 1,
  needed_when,
  active: true,
});

function app(tables: Record<string, unknown[]> = {}) {
  const fake = fakeSupabase({
    signedInAs: olivia,
    tables: {
      members: [{ role: "owner", orgs: org, user_id: olivia.id }],
      org_settings: [
        {
          default_interval_months: 12,
          reminder_lead_days: 30,
          chase_after_days: 14,
          phone: "01202 111222",
          trading_as: "Cool Air",
        },
      ],
      people: [
        {
          id: "p-o",
          user_id: olivia.id,
          name: "Olivia",
          email: olivia.email,
          phone: "",
          fgas_cert: "",
          active: true,
        },
      ],
      clients: [client],
      systems: [system],
      units: [unit("u1", 1, "indoor"), unit("u2", 2, "indoor"), unit("u3", 3, "outdoor")],
      jobs: [job("j1", today)],
      contact_logs: [],
      materials: [
        material("m1", "Coil cleaner", "Refcom", "indoor"),
        material("m2", "Fuse", "", "visit", "any"),
      ],
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

describe("home", () => {
  it("shows today's jobs and what's due", async () => {
    app();
    expect(await screen.findByText(/Repair \/ breakdown · Harbour Dental/)).toBeTruthy();
    const kpi = (name: string) => screen.getByText(name).closest("a")?.querySelector(".kpi-n")?.textContent;
    expect(kpi("Jobs today")).toBe("1");
    expect(kpi("Due soon")).toBe("1");
    expect(screen.getByRole("link", { name: /1 to contact/ }).getAttribute("href")).toBe("#/reminders");
  });
});

describe("reminders", () => {
  it("fills in the reminder and logs the contact", async () => {
    window.location.hash = "#/reminders?open=s1";
    const calls = app();
    const email = (await screen.findByLabelText(
      /^Email: Your air conditioning service is due/,
    )) as HTMLTextAreaElement;
    expect(email.value).toMatch(/^Hi Priya,/);
    expect(email.value).toContain("(1 outdoor + 2 indoor)");
    expect(email.value).toContain("01202 111222");
    expect(email.value).toContain("Cool Air");
    expect(screen.getByRole("link", { name: "Open in Mail" }).getAttribute("href")).toContain(
      "mailto:priya%40harbour.test",
    );
    expect(screen.getByRole("link", { name: /Call 07700 900123/ }).getAttribute("href")).toBe(
      "tel:07700900123",
    );
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "Left a message" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark as contacted" }));
    await waitFor(() => expect(calls.some((c) => c.name === "contact_logs.insert")).toBe(true));
    expect((calls.find((c) => c.name === "contact_logs.insert")?.args as unknown[])[0]).toMatchObject({
      system_id: "s1",
      date: today,
      method: "Email",
      note: "Left a message",
      org_id: "org-a",
    });
  });

  it("shows an install as contacted once it's logged", async () => {
    window.location.hash = "#/reminders?show=contacted";
    app({ contact_logs: [{ id: "l1", system_id: "s1", date: today, method: "Phone call", note: "" }] });
    expect((await screen.findAllByText(/^Contacted /)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Contacted \(1\)/ }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("orders", () => {
  it("adds up parts for booked jobs by supplier and marks them ordered", async () => {
    window.location.hash = "#/orders?days=30";
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const calls = app({
      jobs: [
        job("j1", today, { type: "Annual service" }),
        job("j2", addDays(today, 5), { type: "Annual service" }),
        job("j3", addDays(today, 50), { type: "Annual service" }),
        job("j4", addDays(today, 2), { type: "Annual service", materials_ordered: true }),
      ],
    });
    const refcom = await screen.findByRole("region", { name: "Refcom" });
    // Two jobs in range, two indoor units each.
    expect(within(refcom).getByText("Coil cleaner").closest("tr")?.textContent).toContain("4");
    expect(screen.getByRole("region", { name: "Unassigned" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark all ordered" }));
    await waitFor(() => expect(calls.filter((c) => c.name === "mark_parts_ordered")).toHaveLength(2));
  });
});

describe("asset register", () => {
  it("lists every unit with its F-gas figures", async () => {
    window.location.hash = "#/register";
    app();
    expect(await screen.findByRole("link", { name: "#3" })).toBeTruthy();
    // R410A 3 kg × 2088 = 6.26 t, which needs a yearly leak check.
    expect(screen.getAllByText("6.26")).toHaveLength(3);
  });

  it("downloads the register as a CSV with a row per unit", async () => {
    window.location.hash = "#/register";
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    app();
    await screen.findByRole("link", { name: "#3" });
    fireEvent.click(screen.getByRole("button", { name: /Download CSV/ }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    const csv = await blobs[0]?.text();
    const lines = csv?.trim().split("\r\n") ?? [];
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Tonnes CO2e");
    expect(lines[3]).toMatch(/^3,AC-AAAA3,Harbour Dental,Surgery heat pumps,/);
    expect(lines[3]).toContain(",R410A,3,6.26,12,");
  });
});

describe("asset register PDF", () => {
  it("makes a PDF", async () => {
    const { registerPdf } = await import("../registerPdf");
    const blob = await registerPdf([], "Business A", "Harbour Dental");
    expect(blob.size).toBeGreaterThan(500);
  });
});
