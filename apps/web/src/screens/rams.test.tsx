import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { flush, outboxItems, resetOutboxForTests } from "../outbox";
import { fakeSupabase } from "../test/fakeSupabase";
import { todayIso } from "./Assets";

const ed = { id: "u-ed", email: "ed@a.test" };
const member = (role: string) => ({
  role,
  orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null },
});
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
  refrigerant: "R32",
  gwp: null,
  factory_charge_kg: 1,
  added_charge_kg: 0,
  hermetic: false,
  leak_detection: false,
  access_notes: "",
  notes: "",
  inactive: false,
  clients: { name: "Harbour Dental" },
};
const job = {
  id: "j1",
  system_id: "s1",
  type: "Installation",
  status: "booked",
  date: todayIso(),
  time: "09:30:00",
  duration_hrs: 4,
  engineer: "Ed",
  notes: "",
  materials_ordered: false,
  completed_at: null,
  completion_notes: "",
  billing: "none",
  systems: system,
  job_leak_checks: null,
};
const rams = {
  id: "d1",
  system_id: "s1",
  unit_id: null,
  job_id: null,
  kind: "rams",
  name: "Roof access RAMS.pdf",
  file_id: "f1",
  created_at: "2026-11-15T10:00:00Z",
};

function app(tables: Record<string, unknown[]> = {}, role = "member") {
  const fake = fakeSupabase({
    signedInAs: ed,
    tables: {
      members: [member(role)],
      people: [{ id: "p-ed", user_id: "u-ed", name: "Ed Jones", email: "ed@a.test", active: true }],
      systems: [system],
      units: [],
      jobs: [job],
      documents: [rams],
      document_signoffs: [],
      ...tables,
    },
  });
  render(<App client={fake.client} />);
  lastFake = fake;
  return fake.calls;
}

const setOnline = (v: boolean) =>
  Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
let lastFake: ReturnType<typeof fakeSupabase> | null = null;
beforeEach(() => {
  resetOutboxForTests();
  setOnline(true);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  setOnline(true);
  window.location.hash = "";
});

describe("risk assessments on a job", () => {
  it("the engineer opens the job and signs the install's RAMS as themselves", async () => {
    window.location.hash = "#/job/j1";
    window.confirm = () => true;
    const calls = app();
    expect(await screen.findByText("Roof access RAMS.pdf")).toBeTruthy();
    expect(screen.getByText("1 to sign")).toBeTruthy();
    expect(screen.getByText("For this install · not signed yet")).toBeTruthy();
    await waitFor(() => expect(calls.some((c) => c.name === "people.select")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Sign Roof access RAMS.pdf" }));
    await waitFor(() => expect(calls.some((c) => c.name === "document_signoffs.insert")).toBe(true));
    expect((calls.find((c) => c.name === "document_signoffs.insert")?.args as unknown[])[0]).toEqual({
      org_id: "org-a",
      document_id: "d1",
      job_id: "j1",
      name: "Ed Jones",
    });
  });

  it("shows who signed, and doesn't ask again", async () => {
    window.location.hash = "#/job/j1";
    app({
      document_signoffs: [
        {
          document_id: "d1",
          job_id: "j1",
          user_id: "u-ed",
          name: "Ed Jones",
          signed_at: "2026-11-16T09:12:00Z",
        },
      ],
    });
    expect(await screen.findByText(/Signed by Ed Jones, 16 Nov 2026/)).toBeTruthy();
    expect(screen.getByText("Signed", { selector: ".pill" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign Roof access RAMS.pdf" })).toBeNull();
  });

  it("adds a risk assessment for just this job", async () => {
    window.location.hash = "#/job/j1";
    const calls = app({ documents: [] });
    const input = await screen.findByLabelText("Add a risk assessment for this job");
    fireEvent.change(input, {
      target: { files: [new File(["%PDF"], "Loft RAMS.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() => expect(calls.some((c) => c.name === "documents.insert")).toBe(true));
    expect((calls.find((c) => c.name === "documents.insert")?.args as unknown[])[0]).toMatchObject({
      system_id: "s1",
      job_id: "j1",
      kind: "rams",
      name: "Loft RAMS.pdf",
    });
  });

  it("uploads the site's RAMS from the install, for every job there", async () => {
    window.location.hash = "#/system/s1";
    const calls = app({ documents: [] }, "owner");
    fireEvent.change(await screen.findByLabelText("What it is"), { target: { value: "rams" } });
    fireEvent.change(screen.getByLabelText("Upload document"), {
      target: { files: [new File(["%PDF"], "Site RAMS.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() => expect(calls.some((c) => c.name === "documents.insert")).toBe(true));
    expect((calls.find((c) => c.name === "documents.insert")?.args as unknown[])[0]).toMatchObject({
      kind: "rams",
      job_id: null,
      unit_id: null,
    });
  });

  it("with no signal, keeps the sign-off on the phone with the time they signed, and sends it later", async () => {
    window.location.hash = "#/job/j1";
    window.confirm = () => true;
    const calls = app();
    await screen.findByText("Roof access RAMS.pdf");
    await waitFor(() => expect(calls.some((c) => c.name === "people.select")).toBe(true));
    setOnline(false);
    fireEvent.click(screen.getByRole("button", { name: "Sign Roof access RAMS.pdf" }));
    await waitFor(() => expect(outboxItems()).toHaveLength(1));
    expect(await screen.findByText(/Signed by Ed Jones/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign Roof access RAMS.pdf" })).toBeNull();
    const at = (outboxItems()[0] as { at: string }).at;
    expect(calls.some((c) => c.name === "document_signoffs.insert")).toBe(false);
    setOnline(true);
    if (lastFake) await flush(lastFake.client);
    expect((calls.find((c) => c.name === "document_signoffs.insert")?.args as unknown[])[0]).toEqual({
      org_id: "org-a",
      document_id: "d1",
      job_id: "j1",
      name: "Ed Jones",
      signed_at: at,
    });
  });
});
