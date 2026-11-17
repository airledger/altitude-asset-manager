import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { onMyWayText, suggestSender, toMobile } from "../sms";
import { fakeSupabase } from "../test/fakeSupabase";
import { todayIso } from "./Assets";

const ed = { id: "u-ed", email: "ed@a.test" };
const member = (role: string) => ({
  role,
  orgs: { id: "org-a", name: "Altitude Climate Ltd", slug: "a", logo_url: null },
});
const system = {
  id: "s1",
  client_id: "c1",
  name: "Surgery heat pumps",
  site_address: "",
  site_postcode: "BH1 1AA",
  access_notes: "",
  clients: { name: "Harbour Dental", contact_name: "Pat Lee", phone: "07700 900123" },
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

function app(opts: { role?: string; jobs?: unknown[]; rpcErrors?: Record<string, string> } = {}) {
  const fake = fakeSupabase({
    signedInAs: ed,
    rpcErrors: opts.rpcErrors ?? {},
    tables: {
      members: [member(opts.role ?? "member")],
      people: [{ id: "p-ed", user_id: "u-ed", name: "Ed Jones", email: "ed@a.test", active: true }],
      systems: [system],
      units: [],
      jobs: opts.jobs ?? [job],
      documents: [],
      document_signoffs: [],
      job_times: [],
      org_settings: [{ org_id: "org-a", sms_sender: "" }],
    },
  });
  render(<App client={fake.client} />);
  return fake;
}

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("text message helpers", () => {
  it("turns what people type into numbers that can get texts", () => {
    expect(toMobile("07700 900123")).toBe("+447700900123");
    expect(toMobile("+44 7700 900123")).toBe("+447700900123");
    expect(toMobile("0044 7700 900123")).toBe("+447700900123");
    expect(toMobile("01202 111222")).toBeNull();
    expect(toMobile("+1 (415) 555-0100")).toBe("+14155550100");
    expect(toMobile("hello")).toBeNull();
  });

  it("suggests a sender name and writes the on-my-way text", () => {
    expect(suggestSender("Altitude Climate Ltd")).toBe("Altitude");
    expect(suggestSender("Cool Air")).toBe("Cool Air");
    expect(onMyWayText({ contact: "Pat Lee", engineer: "Ed", business: "Cool Air", minutes: 20 })).toBe(
      "Hi Pat, it's Ed from Cool Air. I'm on my way and should be with you in about 20 minutes.",
    );
  });
});

describe("on my way", () => {
  it("the engineer picks a time and texts the customer from the job", async () => {
    window.location.hash = "#/job/j1";
    const fake = app();
    const box = (await screen.findByLabelText("Message")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toContain("it's Ed Jones from Altitude Climate Ltd"));
    fireEvent.change(screen.getByRole("combobox", { name: "Be there in about" }), {
      target: { value: "15" },
    });
    expect(box.value).toContain("about 15 minutes");
    fireEvent.click(screen.getByRole("button", { name: /Send “On my way”/ }));
    expect(await screen.findByText("Sent to 07700 900123.")).toBeTruthy();
    const args = fake.calls.find((c) => c.name === "fn.send-sms")?.args as { body: Record<string, string> };
    expect(args.body).toMatchObject({
      orgId: "org-a",
      kind: "on_the_way",
      jobId: "j1",
      systemId: "s1",
      clientId: "c1",
    });
    expect(args.body.message).toMatch(/^Hi Pat, it's Ed Jones/);
  });

  it("says when texts aren't set up yet, and Open Messages still works", async () => {
    window.location.hash = "#/job/j1";
    app({ rpcErrors: { "fn.send-sms": "Text messages aren't set up yet. Use Open Messages for now." } });
    fireEvent.click(await screen.findByRole("button", { name: /Send “On my way”/ }));
    expect(await screen.findByText(/aren't set up yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Messages" }).getAttribute("href")).toMatch(
      /^sms:07700900123/,
    );
  });

  it("isn't offered once the job is done", async () => {
    window.location.hash = "#/job/j1";
    app({ jobs: [{ ...job, status: "completed", completed_at: new Date().toISOString() }] });
    await screen.findByText(/Surgery heat pumps/);
    expect(screen.queryByText("Text the customer")).toBeNull();
  });
});

describe("sender name", () => {
  it("owners set the name texts come from", async () => {
    window.location.hash = "#/business";
    const fake = app({ role: "owner" });
    const input = (await screen.findByLabelText("Texts come from")) as HTMLInputElement;
    expect(input.placeholder).toBe("Altitude");
    fireEvent.change(input, { target: { value: "x!" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(await screen.findByText(/3 to 11 letters/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "Altitude" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(fake.calls.some((c) => c.name === "org_settings.update")).toBe(true));
    expect((fake.calls.find((c) => c.name === "org_settings.update")?.args as unknown[])[0]).toEqual({
      sms_sender: "Altitude",
    });
  });
});
