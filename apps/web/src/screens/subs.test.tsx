import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { chargeCsvRows, expiringPapers, expiryText, type SubChargeRow, type SubPaper } from "../subs";
import { fakeSupabase } from "../test/fakeSupabase";
import { todayIso } from "./Assets";

const sam = { id: "u-sam", email: "sam@subs.test" };
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
const job = (x: Record<string, unknown> = {}) => ({
  id: "j1",
  system_id: "s1",
  type: "Annual service",
  status: "booked",
  date: todayIso(),
  time: "09:30:00",
  duration_hrs: 2,
  engineer: "Sam",
  engineer_id: "p-sam",
  notes: "",
  materials_ordered: false,
  completed_at: null,
  completion_notes: "",
  billing: "none",
  sub_reply: "",
  sub_reply_note: "",
  systems: system,
  people: { name: "Sam", sub: true },
  job_leak_checks: null,
  ...x,
});
const samRow = {
  id: "p-sam",
  user_id: "u-sam",
  name: "Sam",
  email: "sam@subs.test",
  phone: "",
  fgas_cert: "",
  active: true,
  sub: true,
  company: "Sam Cooling Ltd",
};

function app(role: string, tables: Record<string, unknown[]> = {}) {
  const fake = fakeSupabase({
    signedInAs: role === "owner" ? { id: "u-olivia", email: "olivia@a.test" } : sam,
    tables: {
      members: [member(role)],
      people: [samRow],
      systems: [system],
      units: [],
      jobs: [job()],
      sub_charges: [],
      documents: [],
      ...tables,
    },
  });
  render(<App client={fake.client} />);
  return fake;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("papers and charges", () => {
  const paper = (x: Partial<SubPaper>): SubPaper => ({
    id: "d1",
    person_id: "p-sam",
    kind: "insurance",
    name: "Public liability",
    file_id: "f1",
    expires_on: "2026-12-01",
    created_at: "2025-12-01T10:00:00Z",
    ...x,
  });

  it("flags papers running out within 30 days, unless a newer one replaces them", () => {
    const old = paper({});
    expect(expiringPapers([old], "2026-11-24").map((p) => p.id)).toEqual(["d1"]);
    expect(expiringPapers([old], "2026-10-01")).toEqual([]);
    const renewed = paper({ id: "d2", expires_on: "2027-12-01", created_at: "2026-11-20T10:00:00Z" });
    expect(expiringPapers([old, renewed], "2026-11-24")).toEqual([]);
    expect(expiryText("2026-12-01", "2026-11-24")).toBe("Runs out 1 Dec 2026 (7 days)");
    expect(expiryText("2026-11-01", "2026-11-24")).toBe("Ran out 1 Nov 2026");
    expect(expiryText("2027-06-30", "2026-11-24")).toBe("Valid until 30 Jun 2027");
  });

  it("puts approved charges in a spreadsheet for the bookkeeper", () => {
    const row = (status: SubChargeRow["status"]): SubChargeRow => ({
      id: status,
      job_id: "j1",
      person_id: "p-sam",
      amount: 180,
      note: "",
      their_ref: "INV-7",
      status,
      reply: "",
      submitted_at: "2026-11-24T10:00:00Z",
      decided_at: "2026-11-25T09:00:00Z",
      people: { name: "Sam", company: "Sam Cooling Ltd" },
      jobs: {
        type: "Annual service",
        date: "2026-11-24",
        systems: { name: "Surgery", clients: { name: "Harbour Dental" } },
      },
    });
    const rows = chargeCsvRows([row("approved"), row("rejected")]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual([
      "Sam",
      "Sam Cooling Ltd",
      "INV-7",
      "Annual service",
      "Harbour Dental",
      "Surgery",
      "2026-11-24",
      "180.00",
      "2026-11-25",
      "",
    ]);
  });
});

describe("a subcontractor", () => {
  it("only has their jobs, diary and account", async () => {
    window.location.hash = "#/clients";
    app("sub");
    expect(await screen.findByRole("heading", { name: "Your jobs" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Your jobs", "Diary", "Your account"]);
    expect(screen.queryByRole("link", { name: /Book a job/ })).toBeNull();
  });

  it("accepts a job sent to them", async () => {
    window.location.hash = "#/job/j1";
    const fake = app("sub");
    const card = await screen.findByRole("region", { name: "Can you do this job?" });
    expect(screen.queryByRole("link", { name: /Edit or reschedule/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel job" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Accept the job" }));
    await waitFor(() => expect(fake.calls.some((c) => c.name === "sub_reply")).toBe(true));
    expect(fake.calls.find((c) => c.name === "sub_reply")?.args).toEqual({
      p_job: "j1",
      p_accept: true,
      p_note: "",
    });
  });

  it("declines with a reason", async () => {
    window.location.hash = "#/job/j1";
    const fake = app("sub");
    const card = await screen.findByRole("region", { name: "Can you do this job?" });
    fireEvent.click(within(card).getByRole("button", { name: "I can't do it" }));
    const send = within(card).getByRole("button", { name: "Send" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(card).getByLabelText("Why can't you do it?"), {
      target: { value: "Away that week" },
    });
    fireEvent.click(send);
    await waitFor(() => expect(fake.calls.some((c) => c.name === "sub_reply")).toBe(true));
    expect(fake.calls.find((c) => c.name === "sub_reply")?.args).toMatchObject({
      p_accept: false,
      p_note: "Away that week",
    });
  });

  it("sends their charge once the job is done", async () => {
    window.location.hash = "#/job/j1";
    const fake = app("sub", {
      jobs: [job({ status: "completed", completed_at: "2026-11-24T12:00:00Z", sub_reply: "accepted" })],
    });
    const form = await screen.findByRole("form", { name: "Send your charge" });
    fireEvent.change(within(form).getByLabelText("Amount (£, as you'll invoice it)"), {
      target: { value: "£180.50" },
    });
    fireEvent.change(within(form).getByLabelText("Your invoice number (optional)"), {
      target: { value: "INV-7" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Send charge" }));
    await waitFor(() => expect(fake.calls.some((c) => c.name === "sub_charges.insert")).toBe(true));
    expect((fake.calls.find((c) => c.name === "sub_charges.insert")?.args as unknown[])[0]).toEqual({
      amount: 180.5,
      note: "",
      their_ref: "INV-7",
      status: "submitted",
      org_id: "org-a",
      job_id: "j1",
      person_id: "p-sam",
    });
  });

  it("keeps their insurance on file from their account", async () => {
    window.location.hash = "#/account";
    const fake = app("sub");
    const card = await screen.findByRole("region", { name: "Your insurance and certificates" });
    fireEvent.change(within(card).getByLabelText("Runs out on"), { target: { value: "2027-03-31" } });
    fireEvent.change(within(card).getByLabelText("Upload insurance or certificate"), {
      target: { files: [new File(["%PDF"], "PL cover.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() => expect(fake.calls.some((c) => c.name === "documents.insert")).toBe(true));
    expect((fake.calls.find((c) => c.name === "documents.insert")?.args as unknown[])[0]).toMatchObject({
      person_id: "p-sam",
      system_id: null,
      kind: "insurance",
      name: "PL cover.pdf",
      expires_on: "2027-03-31",
    });
  });
});

describe("owners", () => {
  it("see whether the subcontractor has replied", async () => {
    window.location.hash = "#/job/j1";
    app("owner", { jobs: [job({ sub_reply: "declined", sub_reply_note: "Away that week" })] });
    expect(
      await screen.findByText(
        'Sam (subcontractor) can\'t do this job: "Away that week" Send it to someone else.',
      ),
    ).toBeTruthy();
  });

  it("approve a charge", async () => {
    window.location.hash = "#/job/j1";
    const fake = app("owner", {
      jobs: [job({ status: "completed", completed_at: "2026-11-24T12:00:00Z" })],
      sub_charges: [
        {
          id: "ch1",
          job_id: "j1",
          person_id: "p-sam",
          amount: 180,
          note: "Extra hour on site",
          their_ref: "INV-7",
          status: "submitted",
          reply: "",
          submitted_at: "2026-11-24T13:00:00Z",
          decided_at: null,
        },
      ],
    });
    const card = await screen.findByRole("region", { name: "Subcontractor's charge" });
    expect(within(card).getByText("£180.00")).toBeTruthy();
    expect((within(card).getByRole("button", { name: "Turn down" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fake.calls.some((c) => c.name === "sub_charges.update")).toBe(true));
    expect((fake.calls.find((c) => c.name === "sub_charges.update")?.args as unknown[])[0]).toEqual({
      status: "approved",
      reply: "",
    });
  });

  it("add a subcontractor on the Team page", async () => {
    window.location.hash = "#/team";
    const fake = app("owner", { people: [] });
    const form = await screen.findByRole("form", { name: "Add an engineer" });
    await waitFor(() =>
      expect((within(form).getByRole("button", { name: "Add engineer" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Sam" } });
    fireEvent.change(within(form).getByLabelText("Email"), { target: { value: "sam@subs.test" } });
    fireEvent.change(within(form).getByLabelText("Company (subcontractors)"), {
      target: { value: "Sam Cooling Ltd" },
    });
    fireEvent.click(within(form).getByLabelText(/^Subcontractor:/));
    fireEvent.click(within(form).getByLabelText("Make an invite link for them"));
    fireEvent.click(within(form).getByRole("button", { name: "Add engineer" }));
    await waitFor(() => expect(fake.calls.some((c) => c.name === "people.insert")).toBe(true));
    expect((fake.calls.find((c) => c.name === "people.insert")?.args as unknown[])[0]).toMatchObject({
      name: "Sam",
      sub: true,
      company: "Sam Cooling Ltd",
    });
  });

  it("see who's running out of insurance on the Subcontractors page", async () => {
    window.location.hash = "#/subcontractors";
    app("owner", {
      documents: [
        {
          id: "d1",
          person_id: "p-sam",
          kind: "insurance",
          name: "Public liability",
          file_id: "f1",
          expires_on: "2026-01-01",
          created_at: "2025-01-01T10:00:00Z",
          people: { name: "Sam", company: "" },
        },
      ],
    });
    expect(await screen.findByText(/Public liability: Ran out 1 Jan 2026/)).toBeTruthy();
    expect(screen.getByText("Chase")).toBeTruthy();
  });
});
