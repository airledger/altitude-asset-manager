import { addDays } from "@airledger/domain";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { fakeSupabase } from "../test/fakeSupabase";
import { todayIso } from "./Assets";

const ed = { id: "u-ed", email: "ed@a.test" };
const member = { role: "member", orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null } };
const owner = { ...member, role: "owner" };
const system = {
  id: "s1",
  client_id: "c1",
  name: "Surgery heat pumps",
  site_address: "12 High St",
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
  access_notes: "Key at reception",
  notes: "",
  inactive: false,
  clients: { name: "Harbour Dental" },
};
const unit = (id: string, n: number, role: "indoor" | "outdoor") => ({
  id,
  asset_no: n,
  sticker_code: `AC-AAAA${n}`,
  system_id: "s1",
  role,
  indoor_type: role === "indoor" ? "Cassette" : null,
  manufacturer: "Daikin",
  model: "X",
  serial: "",
  capacity_kw: null,
  location: role === "indoor" ? "Reception" : "Yard",
  filter_type: null,
  controller: null,
  condensate_pump: false,
  from_sticker: true,
  notes: "",
});
const units = [unit("u1", 1, "indoor"), unit("u2", 2, "outdoor")];
const job = {
  id: "j1",
  system_id: "s1",
  type: "Annual service",
  status: "booked",
  date: todayIso(),
  time: "09:30:00",
  duration_hrs: 1,
  engineer: "Ed",
  notes: "Bring ladders",
  materials_ordered: false,
  completed_at: null,
  completion_notes: "",
  billing: "none",
  systems: { ...system, clients: { name: "Harbour Dental" } },
  job_leak_checks: null,
};
const materials = [
  {
    id: "m1",
    name: "Coil cleaner",
    supplier: "Refcom",
    sku: "CC1",
    applies_to: "indoor",
    qty_per: 1,
    needed_when: "service",
    active: true,
  },
  {
    id: "m2",
    name: "Fuse",
    supplier: "",
    sku: "",
    applies_to: "visit",
    qty_per: 1,
    needed_when: "pick",
    active: true,
  },
];

function app(m: unknown, tables: Record<string, unknown[]> = {}) {
  const fake = fakeSupabase({
    signedInAs: ed,
    tables: {
      members: [m],
      org_settings: [{ default_engineer: "Ed Jones", default_interval_months: 12 }],
      systems: [system],
      units,
      jobs: [job],
      materials,
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

describe("jobs", () => {
  it("lists booked jobs with today's count", async () => {
    window.location.hash = "#/jobs";
    app(member);
    expect(await screen.findByText(/Annual service · Harbour Dental/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Booked" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: /Jobs/ }).getAttribute("aria-current")).toBe("page");
  });

  it("books a service a week ahead from an install, sized for its units", async () => {
    window.location.hash = "#/job/new?system=s1";
    const calls = app(member);
    await waitFor(() => expect((screen.getByLabelText("Allow (hours)") as HTMLInputElement).value).toBe("1"));
    expect((screen.getByLabelText("Engineer") as HTMLInputElement).value).toBe("Ed Jones");
    fireEvent.click(screen.getByRole("button", { name: "Book job" }));
    await waitFor(() => expect(calls.some((c) => c.name === "jobs.insert")).toBe(true));
    const insert = calls.find((c) => c.name === "jobs.insert");
    expect((insert?.args as unknown[])[0]).toMatchObject({
      system_id: "s1",
      type: "Annual service",
      status: "booked",
      date: addDays(todayIso(), 7),
      duration_hrs: 1,
      engineer: "Ed Jones",
      org_id: "org-a",
    });
  });

  it("shows the job with its units and the parts to take", async () => {
    window.location.hash = "#/job/j1";
    app(member);
    expect(await screen.findByText("Key at reception")).toBeTruthy();
    expect(await screen.findByText("Coil cleaner")).toBeTruthy();
    expect(screen.queryByText("Fuse")).toBeNull();
    expect(screen.getAllByText("#1").length).toBeGreaterThan(0);
  });

  it("completes a job with ticked checks, readings, the leak check and parts", async () => {
    window.location.hash = "#/job/j1?do=complete";
    const calls = app(member);
    const reception = await screen.findByRole("group", { name: /Cassette/ });
    expect(
      (within(reception).getByLabelText("Filters cleaned or replaced") as HTMLInputElement).checked,
    ).toBe(true);
    // Outdoor units don't get indoor-only checks.
    const yard = screen.getByRole("group", { name: /Outdoor unit/ });
    expect(within(yard).queryByLabelText("Filters cleaned or replaced")).toBeNull();
    fireEvent.click(within(reception).getByLabelText("Coils cleaned and sanitised"));
    fireEvent.change(within(reception).getByLabelText("Off-coil temp (°C)"), { target: { value: "12.5" } });
    fireEvent.change(screen.getByLabelText("Quantity of Coil cleaner"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Add a part"), { target: { value: "m2" } });
    fireEvent.change(screen.getByLabelText("What was found and done"), { target: { value: "All good" } });
    fireEvent.click(screen.getByRole("button", { name: /Complete job/ }));
    await waitFor(() => expect(calls.some((c) => c.name === "complete_job")).toBe(true));
    const args = calls.find((c) => c.name === "complete_job")?.args as {
      p_job: string;
      p: Record<string, unknown>;
    };
    expect(args.p_job).toBe("j1");
    expect(args.p).toMatchObject({
      type: "Annual service",
      engineer: "Ed",
      completion_notes: "All good",
      commissioning: null,
      leak_check: { performed: true, result: "pass" },
      parts_used: [
        { material_id: "m1", name: "Coil cleaner", qty: 2, extra: false },
        { material_id: "m2", name: "Fuse", qty: 1, extra: true },
      ],
    });
    const checks = args.p.unit_checks as { unit_id: string; checks: string[]; off_coil: number | null }[];
    expect(checks[0]).toMatchObject({ unit_id: "u1", off_coil: 12.5 });
    expect(checks[0]?.checks).not.toContain("coil");
    expect(checks[0]?.checks).toContain("filters");
    expect(checks[1]?.checks).not.toContain("filters");
  });

  it("switches to commissioning for an install", async () => {
    window.location.hash = "#/job/j1?do=complete";
    const calls = app(member, { jobs: [{ ...job, type: "Installation" }] });
    expect(await screen.findByRole("heading", { name: "Commissioning" })).toBeTruthy();
    expect(screen.queryByText("Leak check carried out")).toBeNull();
    fireEvent.change(screen.getByLabelText("Nitrogen pressure test (bar)"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /Complete job/ }));
    await waitFor(() => expect(calls.some((c) => c.name === "complete_job")).toBe(true));
    const args = calls.find((c) => c.name === "complete_job")?.args as { p: Record<string, unknown> };
    expect(args.p).toMatchObject({ leak_check: null, commissioning: { pressure_bar: 40, handover: true } });
  });

  it("lets only an owner delete a cancelled job", async () => {
    window.location.hash = "#/job/j1";
    app(member, { jobs: [{ ...job, status: "cancelled" }] });
    expect(await screen.findByRole("button", { name: "Re-open" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete job" })).toBeNull();
    cleanup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const calls = app(owner, { jobs: [{ ...job, status: "cancelled" }] });
    fireEvent.click(await screen.findByRole("button", { name: "Delete job" }));
    await waitFor(() => expect(calls.some((c) => c.name === "jobs.update")).toBe(true));
    expect((calls.find((c) => c.name === "jobs.update")?.args as unknown[])[0]).toHaveProperty("deleted_at");
  });

  it("marks parts ordered, freezing the list", async () => {
    window.location.hash = "#/job/j1";
    const calls = app(member);
    fireEvent.click(await screen.findByRole("button", { name: "Mark parts ordered" }));
    await waitFor(() => expect(calls.some((c) => c.name === "mark_parts_ordered")).toBe(true));
    expect(calls.find((c) => c.name === "mark_parts_ordered")?.args).toMatchObject({
      p_job: "j1",
      p_parts: [{ material_id: "m1", name: "Coil cleaner", qty: 1 }],
    });
  });
});

describe("asset numbers", () => {
  it("shows the unit's asset number", async () => {
    window.location.hash = "#/u/AC-AAAA1";
    app(member);
    expect(await screen.findByText("Asset #1")).toBeTruthy();
  });
});
