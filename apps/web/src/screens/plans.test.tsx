import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { billingCsv, dueThisMonth, planState, price, type OrgPlan, type PlatformBusiness } from "../plans";
import { fakeSupabase } from "../test/fakeSupabase";

const olivia = { id: "u-olivia", email: "olivia@a.test" };
const member = (role: string) => ({
  role,
  orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null },
});
const PLANS = [
  {
    code: "starter",
    name: "Starter",
    monthly: 30,
    yearly: 300,
    engineers: 2,
    assets: 250,
    extra_engineer: 8,
    blurb: "",
    sort: 1,
    active: true,
  },
  {
    code: "pro",
    name: "Pro",
    monthly: 50,
    yearly: 500,
    engineers: 5,
    assets: 1000,
    extra_engineer: 8,
    blurb: "",
    sort: 2,
    active: true,
  },
  {
    code: "complete",
    name: "Complete",
    monthly: 75,
    yearly: 750,
    engineers: 10,
    assets: null,
    extra_engineer: 8,
    blurb: "",
    sort: 3,
    active: true,
  },
];
const plan = (x: Partial<OrgPlan> = {}): OrgPlan => ({
  org_id: "org-a",
  plan: "complete",
  billing: "monthly",
  status: "trial",
  trial_ends: "2026-12-08",
  extra_engineers: 0,
  billing_name: "",
  billing_email: "",
  chosen_at: null,
  dd_status: "none",
  dd_ref: "",
  paid_until: null,
  ...x,
});
const iso = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function app(role: string, tables: Record<string, unknown[]> = {}, rpc: Record<string, unknown> = {}) {
  const fake = fakeSupabase({
    signedInAs: olivia,
    rpc,
    tables: {
      members: [member(role)],
      plans: PLANS,
      org_plans: [plan({ trial_ends: iso(10) })],
      platform: [
        {
          require_invite: true,
          dd_setup_url: "https://pay.adfin.example/airledger",
          vat_registered: false,
          trial_days: 14,
        },
      ],
      platform_admins: [],
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

describe("plan rules", () => {
  it("prices plans with extra engineers, monthly or yearly", () => {
    const starter = PLANS[0] as (typeof PLANS)[number];
    expect(price(starter, "monthly", 2)).toBe(46);
    expect(price(starter, "yearly", 1)).toBe(396);
  });

  it("says how long the trial has left, and stops new work once it's ended", () => {
    expect(planState(plan({ trial_ends: "2026-11-30" }), "2026-11-24")).toMatchObject({
      live: true,
      daysLeft: 6,
    });
    const ended = planState(plan({ trial_ends: "2026-11-23" }), "2026-11-24");
    expect(ended.live).toBe(false);
    expect(ended.message).toMatch(/trial has ended/);
    expect(planState(plan({ status: "free" }), "2030-01-01").live).toBe(true);
    expect(planState(plan({ status: "cancelled" }), "2026-11-24").live).toBe(false);
  });

  it("bills paying businesses each month, yearly ones when they're due, as a Xero import", () => {
    const b = (x: Partial<PlatformBusiness>): PlatformBusiness => ({
      ...plan({
        status: "active",
        plan: "starter",
        chosen_at: "2026-11-01T00:00:00Z",
        dd_status: "active",
        dd_ref: "ADF-1",
      }),
      name: "Cool Co",
      created_at: "2026-11-01T00:00:00Z",
      owner_email: "owner@cool.test",
      plan_name: "Starter",
      engineers: 2,
      subcontractors: 0,
      assets: 10,
      amount: 38,
      extra_engineers: 1,
      billing_name: "Cool Co Ltd",
      billing_email: "accounts@cool.test",
      ...x,
    });
    const rows = [
      b({}),
      b({ org_id: "o2", name: "Yearly paid", billing: "yearly", paid_until: "2027-06-30" }),
      b({ org_id: "o3", name: "Free one", status: "free" }),
      b({ org_id: "o4", name: "Trial ending", status: "trial", trial_ends: "2026-12-10" }),
    ];
    const due = dueThisMonth(rows, "2026-12");
    expect(due.map((r) => r.name)).toEqual(["Cool Co", "Trial ending"]);
    const csv = billingCsv(due, "2026-12", false).split("\r\n");
    expect(csv[1]).toBe(
      'Cool Co Ltd,accounts@cool.test,AL-202612-001,Direct Debit ADF-1,01/12/2026,01/12/2026,"Air Ledger Starter plan, December 2026, with 1 extra engineer",1,38.00,200,No VAT,GBP',
    );
  });
});

describe("plan and billing", () => {
  it("an owner chooses a plan, then sets up the Direct Debit", async () => {
    window.location.hash = "#/plan";
    const fake = app("owner");
    const card = await screen.findByRole("region", { name: "Choose a plan" });
    fireEvent.click(within(card).getByRole("radio", { name: /Yearly/ }));
    fireEvent.click(within(card).getByLabelText(/Starter/));
    fireEvent.change(within(card).getByLabelText("Extra engineers (£8 a month each)"), {
      target: { value: "1" },
    });
    expect(within(card).getByText(/Total: £396 a year/)).toBeTruthy();
    fireEvent.change(within(card).getByLabelText("Name on the invoices"), {
      target: { value: "Business A Ltd" },
    });
    fireEvent.change(within(card).getByLabelText("Email invoices to"), {
      target: { value: "accounts@a.test" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Choose Starter" }));
    await waitFor(() => expect(fake.calls.some((c) => c.name === "choose_plan")).toBe(true));
    expect(fake.calls.find((c) => c.name === "choose_plan")?.args).toEqual({
      p_org: "org-a",
      p_plan: "starter",
      p_billing: "yearly",
      p_extra: 1,
      p_name: "Business A Ltd",
      p_email: "accounts@a.test",
    });
  });

  it("shows the Adfin link once a plan is chosen", async () => {
    window.location.hash = "#/plan";
    const fake = app("owner", {
      org_plans: [
        plan({
          trial_ends: iso(10),
          plan: "pro",
          chosen_at: "2026-11-24T10:00:00Z",
          billing_email: "a@a.test",
        }),
      ],
    });
    const dd = await screen.findByRole("region", { name: "Direct Debit" });
    expect(within(dd).getByRole("link", { name: "Set up the Direct Debit" }).getAttribute("href")).toBe(
      "https://pay.adfin.example/airledger",
    );
    fireEvent.click(within(dd).getByRole("button", { name: "I've set it up" }));
    await waitFor(() => expect(fake.calls.some((c) => c.name === "dd_requested")).toBe(true));
  });

  it("tells everyone when the trial has ended", async () => {
    window.location.hash = "#/jobs";
    app("member", { org_plans: [plan({ trial_ends: iso(-1) })] });
    expect(await screen.findByText(/Your free trial has ended/)).toBeTruthy();
    expect(screen.getByText(/Ask the business's owner to choose a plan/)).toBeTruthy();
  });
});

describe("Air Ledger's own page", () => {
  it("lists every business for an admin and changes one", async () => {
    window.location.hash = "#/platform";
    const fake = app(
      "owner",
      {
        platform_admins: [{ user_id: "u-olivia" }],
        org_plans: [plan({ status: "free" })],
      },
      {
        platform_businesses: [
          {
            ...plan({ status: "active", plan: "pro", dd_status: "active" }),
            name: "Cool Co",
            created_at: "2026-11-01T00:00:00Z",
            owner_email: "owner@cool.test",
            plan_name: "Pro",
            engineers: 3,
            subcontractors: 1,
            assets: 120,
            amount: 50,
          },
        ],
      },
    );
    expect(await screen.findByText("Cool Co")).toBeTruthy();
    expect(screen.getByText(/1 business · £50.00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const form = screen.getByRole("form", { name: "Change Cool Co" });
    fireEvent.change(within(form).getByLabelText("Status"), { target: { value: "past_due" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.calls.some((c) => c.name === "platform_set_plan")).toBe(true));
    expect(fake.calls.find((c) => c.name === "platform_set_plan")?.args).toMatchObject({
      p_org: "org-a",
      p: { status: "past_due", plan: "pro" },
    });
  });
});
