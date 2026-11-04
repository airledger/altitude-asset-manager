import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { reminderPlan } from "../native";
import type { Overview } from "../overview";
import { fakeSupabase } from "../test/fakeSupabase";

const olivia = { id: "u-o", email: "olivia@a.test" };
const bizA = { id: "org-a", name: "Business A", slug: "a", logo_url: null };

function app(rpc: Record<string, unknown> = {}, rpcErrors: Record<string, string> = {}) {
  const fake = fakeSupabase({
    signedInAs: olivia,
    rpc: { account_deletion_plan: [{ org_id: "org-a", name: "Business A" }], ...rpc },
    rpcErrors,
    tables: { members: [{ role: "owner", orgs: bizA }] },
  });
  render(<App client={fake.client} />);
  return fake.calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("your account", () => {
  it("deletes the account and its business on the server, then signs out", async () => {
    window.location.hash = "#/account";
    const calls = app();
    expect(await screen.findByText(/It also deletes Business A/)).toBeTruthy();
    const del = screen.getByRole("button", { name: "Delete my account" }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "delete" } });
    fireEvent.click(del);
    await waitFor(() => expect(calls.some((c) => c.name === "signOut")).toBe(true));
    expect(calls.find((c) => c.name === "fn.delete-account")?.args).toEqual({ body: { account: true } });
  });

  it("says why when the account can't go yet", async () => {
    window.location.hash = "#/account";
    app({}, { account_deletion_plan: "You're the only owner of Business A." });
    expect(await screen.findByText(/only owner of Business A/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete my account" })).toBeNull();
  });

  it("lets an owner delete the business once its name is typed", async () => {
    window.location.hash = "#/business";
    const calls = app();
    const del = (await screen.findByRole("button", { name: "Delete business" })) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Type the business name to delete it"), {
      target: { value: "Business B" },
    });
    expect(del.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type the business name to delete it"), {
      target: { value: "business a" },
    });
    fireEvent.click(del);
    await waitFor(() =>
      expect(calls.find((c) => c.name === "fn.delete-account")?.args).toEqual({
        body: { business: "org-a" },
      }),
    );
  });
});

describe("phone reminders", () => {
  const site = (id: string, nextDue: string | null, booked: boolean, nextLeakCheck: string | null) => ({
    system: { id, name: `Site ${id}`, inactive: false, site_address: "", site_postcode: "" },
    client: { name: "Harbour Dental" },
    info: { nextDue, booked: booked ? {} : null, nextLeakCheck },
  });
  const o = (sites: unknown[]) => ({ sites, today: "2026-11-04" }) as unknown as Overview;
  const at7am = new Date(2026, 10, 4, 7);

  it("plans one 8am note a day for coming up, due and leak checks", () => {
    const plan = reminderPlan(
      o([site("1", "2026-12-10", false, "2026-11-10"), site("2", "2026-12-10", true, null)]),
      30,
      at7am,
    );
    expect(plan.map((p) => [p.id, p.body])).toEqual([
      [
        20261110,
        "Service due 10 Dec 2026: Harbour Dental · Site 1\nF-gas leak check due: Harbour Dental · Site 1",
      ],
      [20261210, "Service due today: Harbour Dental · Site 1"],
    ]);
    expect(plan[0]?.title).toBe("2 Air Ledger reminders");
    expect(plan[0]?.schedule.at).toEqual(new Date(2026, 10, 10, 8));
  });

  it("skips today once 8am has passed, and anything already past", () => {
    const s = [site("1", "2026-11-04", false, "2026-10-01")];
    expect(reminderPlan(o(s), 30, at7am).map((p) => p.id)).toEqual([20261104]);
    expect(reminderPlan(o(s), 30, new Date(2026, 10, 4, 9))).toEqual([]);
  });
});
