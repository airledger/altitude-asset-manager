import { addDays } from "@airledger/domain";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { busyOn, diaryUrl, jobFromBusy, type BusyBlock } from "../diary";
import { fakeSupabase } from "../test/fakeSupabase";
import { todayIso } from "./Assets";

const today = todayIso();
/** Today at a local time, as the database sends it. */
const at = (h: number, m = 0, iso = today) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setHours(h, m);
  return d.toISOString();
};
const block = (over: Partial<BusyBlock>): BusyBlock => ({
  id: "b1",
  user_id: "u-ed",
  starts_at: at(13),
  ends_at: at(15, 30),
  all_day: false,
  title: "Dentist",
  ...over,
});

const olivia = { id: "u-olivia", email: "olivia@a.test" };
const ed = { id: "u-ed", email: "ed@a.test" };
const bizA = { id: "org-a", name: "Business A", slug: "a", logo_url: null };
const person = (id: string, name: string, user_id: string) => ({
  id,
  user_id,
  name,
  email: "",
  phone: "",
  fgas_cert: "",
  active: true,
});
const job = {
  id: "j1",
  system_id: "s1",
  type: "Annual service",
  status: "booked",
  date: today,
  time: "09:30:00",
  duration_hrs: 1,
  engineer: "Ed Jones",
  engineer_id: "p-ed",
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
    clients: { name: "Harbour Dental" },
  },
  job_leak_checks: null,
};

function app(
  as: typeof ed,
  role: string,
  tables: Record<string, unknown[]> = {},
  rpc: Record<string, unknown> = {},
) {
  const fake = fakeSupabase({
    signedInAs: as,
    rpc,
    tables: {
      members: [{ role, orgs: bizA, user_id: as.id }],
      people: [person("p-o", "Olivia", olivia.id), person("p-ed", "Ed Jones", ed.id)],
      jobs: [job],
      systems: [],
      busy_blocks: [],
      diary_links: [],
      ...tables,
    },
  });
  render(<App client={fake.client} />);
  return fake;
}

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("calendar helpers", () => {
  it("accepts Google, Outlook and iCloud addresses only", () => {
    expect(diaryUrl("webcal://p52-caldav.icloud.com/published/2/abc")).toEqual({
      url: "https://p52-caldav.icloud.com/published/2/abc",
    });
    expect(diaryUrl(" https://calendar.google.com/calendar/ical/x/private-y/basic.ics ")).toHaveProperty(
      "url",
    );
    expect(diaryUrl("https://outlook.office365.com/owa/calendar/a/b/calendar.ics")).toHaveProperty("url");
    expect(diaryUrl("https://example.com/cal.ics")).toHaveProperty("error");
    expect(diaryUrl("")).toHaveProperty("error");
  });

  it("puts busy times on the right days and books a job in one", () => {
    const holiday = block({
      id: "h",
      all_day: true,
      starts_at: `${today}T00:00:00Z`,
      ends_at: `${addDays(today, 2)}T00:00:00Z`,
      title: "Busy",
    });
    expect(busyOn([block({}), holiday], today).map((b) => b.id)).toEqual(["h", "b1"]);
    expect(busyOn([holiday], addDays(today, 1))).toHaveLength(1);
    expect(busyOn([holiday], addDays(today, 2))).toHaveLength(0);
    expect(jobFromBusy(block({}), today, "p-ed")).toBe(
      `#/job/new?date=${today}&engineer=p-ed&time=13%3A00&hours=2.5&notes=Dentist`,
    );
    expect(jobFromBusy(holiday, today, null)).toBe(`#/job/new?date=${today}`);
  });
});

describe("on the schedule", () => {
  it("shows when someone's busy in their lane, and tapping it books a job then", async () => {
    window.location.hash = `#/schedule?view=week&d=${today}`;
    const fake = app(olivia, "owner", { busy_blocks: [block({})] });
    const week = await screen.findByRole("table");
    const edRow = within(week)
      .getByRole("rowheader", { name: "Ed Jones" })
      .closest("[role=row]") as HTMLElement;
    const chip = await within(edRow).findByRole("link", { name: /13:00–15:30 Dentist/ });
    expect(chip.getAttribute("href")).toContain("engineer=p-ed&time=13%3A00&hours=2.5");
    const olRow = within(week)
      .getByRole("rowheader", { name: "Olivia" })
      .closest("[role=row]") as HTMLElement;
    expect(within(olRow).queryByText(/Dentist/)).toBeNull();
    // Opening the schedule refreshes calendars that are out of date.
    expect(fake.calls).toContainEqual({
      kind: "rpc",
      name: "fn.calendar-sync",
      args: { body: { orgId: "org-a" } },
    });
  });

  it("doesn't show a busy time twice when it's already been made a job", async () => {
    window.location.hash = `#/schedule?view=agenda&d=${today}&who=all`;
    app(olivia, "owner", {
      busy_blocks: [block({ starts_at: at(9, 30), ends_at: at(10, 30) }), block({ id: "b2" })],
    });
    expect(await screen.findByRole("link", { name: /Ed Jones · Dentist/ })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Dentist/ })).toHaveLength(1);
  });

  it("an engineer connects their calendar", async () => {
    window.location.hash = "#/schedule?view=agenda";
    const fake = app(ed, "member");
    const box = await screen.findByLabelText("Your calendar's private address");
    fireEvent.change(box, { target: { value: "https://example.com/x.ics" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect my calendar" }));
    expect(await screen.findByText(/doesn't look like a Google, Outlook or iCloud/)).toBeTruthy();
    fireEvent.change(box, { target: { value: "webcal://p52-caldav.icloud.com/published/2/abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect my calendar" }));
    await waitFor(() =>
      expect(fake.calls).toContainEqual({
        kind: "rpc",
        name: "fn.calendar-sync",
        args: { body: { orgId: "org-a", mine: true } },
      }),
    );
    expect((fake.calls.find((c) => c.name === "diary_links.insert")?.args as unknown[])[0]).toEqual({
      org_id: "org-a",
      url: "https://p52-caldav.icloud.com/published/2/abc",
      show_titles: false,
    });
  });

  it("shows a connected calendar and owners see the team's", async () => {
    window.location.hash = "#/schedule?view=agenda";
    app(
      olivia,
      "owner",
      {
        diary_links: [
          {
            id: "l1",
            url: "https://calendar.google.com/calendar/ical/x/private-y/basic.ics",
            show_titles: false,
            synced_at: new Date().toISOString(),
            error: "",
          },
        ],
      },
      {
        diary_status: [{ user_id: "u-ed", synced_at: null, error: "The calendar address no longer works." }],
      },
    );
    expect(await screen.findByText("Google Calendar")).toBeTruthy();
    expect(screen.getByText(/the team just sees “Busy”/)).toBeTruthy();
    expect(await screen.findByText(/Ed Jones: problem: The calendar address no longer works/)).toBeTruthy();
  });
});
