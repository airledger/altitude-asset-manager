import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { formRows, formsForJob, formsToDo, missingAnswers, type FormTemplate, type JobForm } from "../forms";
import { flush, outboxItems, resetOutboxForTests } from "../outbox";
import { fakeSupabase } from "../test/fakeSupabase";
import { todayIso } from "./Assets";

const setOnline = (v: boolean) =>
  Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
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
  type: "Annual service",
  status: "booked",
  date: todayIso(),
  time: "09:30:00",
  duration_hrs: 2,
  engineer: "Ed",
  notes: "",
  materials_ordered: false,
  completed_at: null,
  completion_notes: "",
  billing: "none",
  systems: system,
  job_leak_checks: null,
};
const template: FormTemplate = {
  id: "t1",
  name: "Service checklist",
  job_types: ["Annual service"],
  required: true,
  active: true,
  fields: [
    { id: "h", kind: "heading", label: "Indoor units" },
    { id: "a", kind: "check", label: "Filters cleaned", required: true },
    { id: "b", kind: "number", label: "Supply air", unit: "°C" },
    { id: "c", kind: "yesno", label: "Customer shown controls" },
  ],
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
      form_templates: [template],
      job_forms: [],
      ...tables,
    },
  });
  render(<App client={fake.client} />);
  return fake;
}

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

describe("which forms a job needs", () => {
  const other: FormTemplate = { ...template, id: "t2", name: "Breakdown", job_types: ["Repair / breakdown"] };
  const every: FormTemplate = { ...template, id: "t3", name: "Site sign-in", job_types: [], required: false };
  const off: FormTemplate = { ...template, id: "t4", name: "Old", job_types: [], active: false };

  it("lists started forms, then the active ones for this type of job", () => {
    const started: JobForm = {
      id: "jf1",
      job_id: "j1",
      template_id: "t1",
      name: "Service checklist",
      fields: template.fields,
      answers: { a: "pass" },
      completed_at: null,
      completed_by: "",
    };
    const list = formsForJob("Annual service", [template, other, every, off], [started], "j1");
    expect(list.map((f) => f.name)).toEqual(["Service checklist", "Site sign-in"]);
    expect(list[0]?.answers).toEqual({ a: "pass" });
    expect(formsToDo("Annual service", [template, other, every], [started])).toEqual(["Service checklist"]);
    expect(
      formsToDo("Annual service", [template], [{ ...started, completed_at: "2026-11-24T10:00:00Z" }]),
    ).toEqual([]);
  });

  it("says which required questions are unanswered and how answers read on the report", () => {
    const answers = { a: "fail", b: "12", c: "yes" };
    expect(missingAnswers({ fields: template.fields, answers: {} }).map((f) => f.label)).toEqual([
      "Filters cleaned",
    ]);
    expect(formRows({ fields: template.fields, answers })).toEqual([
      ["Filters cleaned", "Fail", true],
      ["Supply air", "12 °C", false],
      ["Customer shown controls", "Yes", false],
    ]);
  });
});

describe("forms on a job", () => {
  it("won't complete the job until the required form is done", async () => {
    window.location.hash = "#/job/j1?do=complete";
    app();
    expect(await screen.findByText(/Before completing this job, fill in: Service checklist/)).toBeTruthy();
  });

  it("the engineer fills it in; required answers are checked, then it's saved as done", async () => {
    window.location.hash = "#/job/j1";
    const fake = app();
    const card = await screen.findByRole("region", { name: "Forms and checklists" });
    expect(within(card).getByText("Needed before the job is completed")).toBeTruthy();
    await waitFor(() => expect(fake.calls.some((c) => c.name === "people.select")).toBe(true));
    fireEvent.click(within(card).getByRole("button", { name: "Fill in" }));
    const form = screen.getByRole("form", { name: "Service checklist" });
    fireEvent.click(within(form).getByRole("button", { name: "Done" }));
    expect(await within(form).findByText(/Still to answer: Filters cleaned/)).toBeTruthy();
    fireEvent.click(within(form).getByRole("radio", { name: "Pass" }));
    fireEvent.change(within(form).getByLabelText("Supply air"), { target: { value: "12.5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(fake.calls.some((c) => c.name === "job_forms.upsert")).toBe(true));
    const [row, opts] = fake.calls.find((c) => c.name === "job_forms.upsert")?.args as [
      Record<string, unknown>,
      unknown,
    ];
    expect(row).toMatchObject({
      org_id: "org-a",
      job_id: "j1",
      template_id: "t1",
      answers: { a: "pass", b: "12.5" },
      completed_by: "Ed Jones",
    });
    expect(row.completed_at).toBeTruthy();
    expect(opts).toEqual({ onConflict: "job_id,template_id" });
  });

  it("with no signal, keeps the form on the phone and sends it later", async () => {
    window.location.hash = "#/job/j1";
    const fake = app();
    const card = await screen.findByRole("region", { name: "Forms and checklists" });
    fireEvent.click(within(card).getByRole("button", { name: "Fill in" }));
    setOnline(false);
    const form = screen.getByRole("form", { name: "Service checklist" });
    fireEvent.click(within(form).getByRole("radio", { name: "Pass" }));
    fireEvent.click(within(form).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(outboxItems()).toHaveLength(1));
    expect(await screen.findByText("Done", { selector: ".pill" })).toBeTruthy();
    setOnline(true);
    await flush(fake.client);
    expect(fake.calls.some((c) => c.name === "job_forms.upsert")).toBe(true);
  });
});

describe("setting up forms", () => {
  it("owners add the ready-made forms", async () => {
    window.location.hash = "#/forms";
    const fake = app({ form_templates: [] }, "owner");
    fireEvent.click(await screen.findByRole("button", { name: /Add ready-made forms/ }));
    await waitFor(() => expect(fake.calls.filter((c) => c.name === "form_templates.insert")).toHaveLength(3));
    const names = fake.calls
      .filter((c) => c.name === "form_templates.insert")
      .map((c) => (c.args as [{ name: string }])[0].name);
    expect(names).toEqual(["Service checklist", "Commissioning checklist", "Breakdown report"]);
  });

  it("engineers can't set them up", async () => {
    window.location.hash = "#/forms";
    app();
    expect(await screen.findByText("Only the business's owners can set up forms.")).toBeTruthy();
  });
});
