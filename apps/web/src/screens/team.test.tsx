import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { calendarUrls } from "../jobs";
import { fakeSupabase } from "../test/fakeSupabase";
import { mondayOf, monthStart, weeksOf } from "./Schedule";
import { todayIso } from "./Assets";
import { inviteLink, inviteMessage } from "./Team";

const olivia = { id: "u-olivia", email: "olivia@a.test" };
const ed = { id: "u-ed", email: "ed@a.test" };
const bizA = { id: "org-a", name: "Business A", slug: "business-a", logo_url: null };
const person = (id: string, name: string, user_id: string | null, email = "") => ({
  id,
  user_id,
  name,
  email,
  phone: "",
  fgas_cert: "",
  active: true,
});
const people = [
  person("p-o", "Olivia", olivia.id, olivia.email),
  person("p-ed", "Ed Jones", ed.id, ed.email),
  person("p-sam", "Sam Hill", null, "sam@a.test"),
];
const members = [
  { role: "owner", orgs: bizA, user_id: olivia.id, email: olivia.email, created_at: "2026-10-01" },
  { role: "member", orgs: bizA, user_id: ed.id, email: ed.email, created_at: "2026-10-02" },
];
const job = (id: string, engineer_id: string | null, engineer: string, client: string) => ({
  id,
  system_id: "s1",
  type: "Annual service",
  status: "booked",
  date: todayIso(),
  time: "09:30:00",
  duration_hrs: 1,
  engineer,
  engineer_id,
  notes: "",
  materials_ordered: false,
  completed_at: null,
  completion_notes: "",
  billing: "none",
  systems: {
    id: "s1",
    name: "Heat pumps",
    site_address: "",
    site_postcode: "",
    access_notes: "",
    client_id: "c1",
    clients: { name: client },
  },
  job_leak_checks: null,
});
const jobs = [job("j1", "p-ed", "Ed Jones", "Harbour Dental"), job("j2", "p-o", "Olivia", "Cliff Hotel")];

function app(as: { id: string; email: string }, role: "owner" | "member", rpc: Record<string, unknown> = {}) {
  const fake = fakeSupabase({
    signedInAs: as,
    tables: {
      // The signed-in user's own membership comes first: the fake doesn't filter rows.
      members: [
        ...members.filter((m) => m.user_id === as.id).map((m) => ({ ...m, role })),
        ...members.filter((m) => m.user_id !== as.id),
      ],
      systems: [
        {
          id: "s1",
          client_id: "c1",
          name: "Heat pumps",
          site_postcode: "",
          clients: { name: "Harbour Dental" },
        },
      ],
      people,
      jobs,
      invites: [],
      org_settings: [{ default_engineer: "" }],
    },
    rpc,
  });
  render(<App client={fake.client} />);
  return fake.calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("team", () => {
  it("lets an owner add an engineer and invite them with their details filled in", async () => {
    window.location.hash = "#/team";
    const calls = app(olivia, "owner", { invite_person: "XYZ789" });
    expect(await screen.findByText("Sam Hill")).toBeTruthy();
    expect(screen.getByText(/not invited yet/)).toBeTruthy();
    const form = screen.getByRole("form", { name: "Add an engineer" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Pat Lee" } });
    fireEvent.change(within(form).getByLabelText("Email"), { target: { value: "Pat@A.test" } });
    fireEvent.change(within(form).getByLabelText("Mobile"), { target: { value: "07700 900123" } });
    fireEvent.change(within(form).getByLabelText("F-gas certificate number"), { target: { value: "REF9" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add engineer" }));
    expect(((await screen.findByLabelText("Invite link")) as HTMLInputElement).value).toBe(
      inviteLink("XYZ789"),
    );
    expect((calls.find((c) => c.name === "people.insert")?.args as unknown[])[0]).toMatchObject({
      name: "Pat Lee",
      email: "pat@a.test",
      phone: "07700 900123",
      fgas_cert: "REF9",
      org_id: "org-a",
    });
    expect(calls).toContainEqual({ kind: "rpc", name: "invite_person", args: { p_person: "new-people" } });
    const mail = screen.getByRole("link", { name: "Email it" }).getAttribute("href") ?? "";
    expect(mail).toContain("mailto:pat%40a.test");
    expect(decodeURIComponent(mail)).toContain(inviteLink("XYZ789"));
    expect(screen.getByRole("link", { name: "Text it" }).getAttribute("href")).toMatch(/^sms:07700900123/);
  });

  it("lets an engineer edit only their own details", async () => {
    window.location.hash = "#/team";
    app(ed, "member");
    expect(await screen.findByText("Sam Hill")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Send invite" })).toBeNull();
    expect(screen.queryByText("Add an engineer")).toBeNull();
  });

  it("writes an invite message that names them", () => {
    expect(inviteMessage("Ed Jones", "Business A", "https://x/?invite=A")).toMatch(
      /^Hi Ed,[\s\S]*https:\/\/x\/\?invite=A/,
    );
  });
});

describe("booking to an engineer", () => {
  it("picks the engineer from the team, and puts their name on the job", async () => {
    window.location.hash = "#/job/new?system=s1&engineer=p-sam";
    const calls = app(olivia, "owner");
    const pick = (await screen.findByLabelText("Engineer")) as HTMLSelectElement;
    expect(pick.value).toBe("p-sam");
    fireEvent.change(pick, { target: { value: "p-ed" } });
    fireEvent.click(screen.getByRole("button", { name: "Book job" }));
    await waitFor(() => expect(calls.some((c) => c.name === "jobs.insert")).toBe(true));
    expect((calls.find((c) => c.name === "jobs.insert")?.args as unknown[])[0]).toMatchObject({
      engineer_id: "p-ed",
      engineer: "Ed Jones",
    });
  });

  it("books to you when there's no default engineer", async () => {
    window.location.hash = "#/job/new?system=s1";
    app(ed, "member");
    expect(((await screen.findByLabelText("Engineer")) as HTMLSelectElement).value).toBe("p-ed");
  });
});

describe("schedule", () => {
  it("shows the week with a lane per engineer", async () => {
    window.location.hash = "#/schedule?view=week";
    app(olivia, "owner");
    const week = await screen.findByRole("table");
    expect(within(week).getByRole("rowheader", { name: "Ed Jones" })).toBeTruthy();
    expect(within(week).getByRole("rowheader", { name: "Not assigned" })).toBeTruthy();
    const edRow = within(week)
      .getByRole("rowheader", { name: "Ed Jones" })
      .closest("[role=row]") as HTMLElement;
    expect(within(edRow).getByText(/Harbour Dental/)).toBeTruthy();
    expect(within(edRow).queryByText(/Cliff Hotel/)).toBeNull();
  });

  it("shows an engineer their own jobs to start with", async () => {
    window.location.hash = "#/schedule?view=agenda";
    app(ed, "member");
    expect(await screen.findByText(/Harbour Dental/)).toBeTruthy();
    expect(screen.queryByText(/Cliff Hotel/)).toBeNull();
    expect((screen.getByLabelText("Whose jobs") as HTMLSelectElement).value).toBe("p-ed");
  });

  it("gives an engineer a link for their calendar app", async () => {
    window.location.hash = "#/schedule?view=agenda";
    const token = "11111111-2222-3333-4444-555555555555";
    const calls = app(ed, "member", { calendar_link: token });
    fireEvent.click(await screen.findByRole("button", { name: /Get calendar link/ }));
    const apple = await screen.findByRole("link", { name: "iPhone / Apple Calendar" });
    expect(apple.getAttribute("href")).toBe(`webcal://${window.location.host}/cal/${token}.ics`);
    expect(calls).toContainEqual({
      kind: "rpc",
      name: "calendar_link",
      args: { p_org: "org-a", p_person: "p-ed", p_new: false },
    });
  });

  it("works out weeks and months", () => {
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(monthStart("2026-12-15", 1)).toBe("2027-01-01");
    const w = weeksOf("2026-11-15");
    expect(w[0]?.[0]).toBe("2026-10-26");
    expect(w.at(-1)?.[6]).toBe("2026-12-06");
    expect(calendarUrls("t", "Air Ledger", "https://beta.test").google).toBe(
      "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fbeta.test%2Fcal%2Ft.ics",
    );
  });
});
