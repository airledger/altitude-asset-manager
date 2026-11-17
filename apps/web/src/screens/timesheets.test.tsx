import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { flush, outboxItems, resetOutboxForTests } from "../outbox";
import { fakeSupabase } from "../test/fakeSupabase";
import {
  hm,
  hoursBetween,
  nextStage,
  timesheetCsvRows,
  weekTotals,
  type JobTime,
  type TimesheetRow,
} from "../timesheets";
import { todayIso } from "./Assets";
import { weekStart } from "./Timesheets";

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
  duration_hrs: 1,
  engineer: "Ed",
  notes: "",
  materials_ordered: false,
  completed_at: null,
  completion_notes: "",
  billing: "none",
  systems: system,
  job_leak_checks: null,
};
const t = (over: Partial<JobTime>): JobTime => ({
  job_id: "j1",
  user_id: "u-ed",
  name: "Ed Jones",
  travel_at: null,
  arrived_at: null,
  left_at: null,
  ...over,
});

function app(tables: Record<string, unknown[]> = {}, role = "member") {
  const fake = fakeSupabase({
    signedInAs: ed,
    tables: {
      members: [member(role)],
      people: [{ id: "p-ed", user_id: "u-ed", name: "Ed Jones", email: "ed@a.test", active: true }],
      systems: [system],
      units: [],
      jobs: [job],
      documents: [],
      document_signoffs: [],
      job_times: [],
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

describe("timesheet sums", () => {
  it("works out travel and time on site, and what to tap next", () => {
    expect(hoursBetween("2026-11-16T08:00:00Z", "2026-11-16T08:45:00Z")).toBe(0.75);
    expect(hoursBetween("2026-11-16T08:00:00Z", null)).toBe(0);
    expect(hm(1.5)).toBe("1 h 30 min");
    expect(hm(0.25)).toBe("15 min");
    expect(nextStage(null)).toBe("travel");
    expect(nextStage(t({ travel_at: "2026-11-16T08:00:00Z" }))).toBe("arrived");
    expect(nextStage(t({ arrived_at: "2026-11-16T08:00:00Z" }))).toBe("left");
    expect(nextStage(t({ arrived_at: "x", left_at: "y" }))).toBeNull();
    expect(weekStart("2026-11-19")).toBe("2026-11-16");
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(weekStart("2026-11-22")).toBe("2026-11-16");
  });

  it("adds up each person's week and makes the CSV", () => {
    const rows: TimesheetRow[] = [
      {
        ...t({
          travel_at: "2026-11-16T08:00:00Z",
          arrived_at: "2026-11-16T08:30:00Z",
          left_at: "2026-11-16T10:30:00Z",
        }),
        jobs: {
          date: "2026-11-16",
          type: "Annual service",
          systems: { name: "Surgery", clients: { name: "Harbour Dental" } },
        },
      },
      {
        ...t({ job_id: "j2", arrived_at: "2026-11-17T09:00:00Z", left_at: "2026-11-17T10:00:00Z" }),
        jobs: null,
      },
    ];
    expect(weekTotals(rows)).toEqual([{ name: "Ed Jones", travel: 0.5, site: 3, jobs: 2 }]);
    const csv = timesheetCsvRows(rows);
    expect(csv[0]).toContain("Travel hours");
    expect(csv[1]).toEqual(
      expect.arrayContaining(["Ed Jones", "2026-11-16", "Harbour Dental", "0.50", "2.00"]),
    );
  });
});

describe("on a job", () => {
  it("the engineer taps Set off, recorded as themselves at that time", async () => {
    window.location.hash = "#/job/j1";
    const fake = app();
    await waitFor(() => expect(fake.calls.some((c) => c.name === "people.select")).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Set off" }));
    await waitFor(() => expect(fake.calls.some((c) => c.name === "clock")).toBe(true));
    const args = fake.calls.find((c) => c.name === "clock")?.args as Record<string, string>;
    expect(args).toMatchObject({ p_job: "j1", p_stage: "travel", p_name: "Ed Jones" });
    expect(Math.abs(Date.parse(args.p_at ?? "") - Date.now())).toBeLessThan(10_000);
  });

  it("shows where they've got to and offers the next step", async () => {
    window.location.hash = "#/job/j1";
    app({ job_times: [t({ travel_at: "2026-11-16T08:00:00Z", arrived_at: "2026-11-16T08:40:00Z" })] });
    expect(await screen.findByRole("button", { name: "Finished" })).toBeTruthy();
    expect(screen.getByText("Ed Jones (you)")).toBeTruthy();
    expect(screen.getByText(/Travel 40 min/)).toBeTruthy();
  });

  it("with no signal, keeps the tap on the phone with its time and sends it later", async () => {
    window.location.hash = "#/job/j1";
    const fake = app();
    await screen.findByRole("button", { name: "Set off" });
    setOnline(false);
    fireEvent.click(screen.getByRole("button", { name: "Set off" }));
    await waitFor(() => expect(outboxItems()).toHaveLength(1));
    expect(await screen.findByRole("button", { name: "Arrived on site" })).toBeTruthy();
    expect(screen.getByText(/waiting to send/)).toBeTruthy();
    const at = (outboxItems()[0] as { at: string }).at;
    setOnline(true);
    await flush(fake.client);
    expect(fake.calls.find((c) => c.name === "clock")?.args).toMatchObject({ p_stage: "travel", p_at: at });
  });

  it("owners correct someone's times", async () => {
    window.location.hash = "#/job/j1";
    const fake = app(
      {
        job_times: [
          t({
            user_id: "u-other",
            name: "Sam",
            arrived_at: "2026-11-16T09:00:00Z",
            left_at: "2026-11-16T11:00:00Z",
          }),
        ],
      },
      "owner",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Correct times" }));
    fireEvent.change(screen.getByLabelText("Finished (Sam)"), { target: { value: "2026-11-16T12:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.calls.some((c) => c.name === "job_times.update")).toBe(true));
    expect((fake.calls.find((c) => c.name === "job_times.update")?.args as unknown[])[0]).toMatchObject({
      left_at: new Date("2026-11-16T12:30").toISOString(),
    });
  });
});

describe("timesheets page", () => {
  it("shows owners each person's hours for the week", async () => {
    window.location.hash = "#/timesheets?week=2026-11-18";
    app(
      {
        job_times: [
          {
            ...t({
              travel_at: "2026-11-16T08:00:00Z",
              arrived_at: "2026-11-16T08:30:00Z",
              left_at: "2026-11-16T10:30:00Z",
            }),
            jobs: {
              date: "2026-11-16",
              type: "Annual service",
              systems: { name: "Surgery", clients: { name: "Harbour Dental" } },
            },
          },
        ],
      },
      "owner",
    );
    expect(await screen.findByText("Week of 16 Nov 2026")).toBeTruthy();
    expect(await screen.findByText("1 job · travel 30 min · on site 2 h")).toBeTruthy();
    expect(screen.getByText("2 h 30 min")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeTruthy();
  });

  it("is for owners only", async () => {
    window.location.hash = "#/timesheets";
    app();
    expect(await screen.findByText("Timesheets are only shown to the business's owners.")).toBeTruthy();
  });
});
