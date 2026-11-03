import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { cachingFetch, isNetworkError } from "./offline";
import { enqueue, enqueuePhotos, flush, outboxItems, resetOutboxForTests, sendOrSave } from "./outbox";
import { todayIso } from "./screens/Assets";
import { fakeSupabase } from "./test/fakeSupabase";
import type { Completion } from "./jobs";

const setOnline = (v: boolean) =>
  Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
const completion: Completion = {
  date: "2026-11-03",
  engineer: "Ed",
  type: "Annual service",
  duration_hrs: 1,
  completion_notes: "All good",
  photo_file_ids: [],
  unit_checks: [],
  leak_check: null,
  commissioning: null,
  parts_used: [],
};

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

describe("outbox", () => {
  it("saves work when there's no signal and sends it, photos first, when it's back", async () => {
    setOnline(false);
    const online = vi.fn();
    const how = await sendOrSave(online, async () => {
      const ids = await enqueuePhotos("org-a", "Annual service", [new Blob(["x"], { type: "image/jpeg" })]);
      await enqueue({
        kind: "complete",
        orgId: "org-a",
        label: "Annual service",
        jobId: "j1",
        completion: { ...completion, photo_file_ids: ["old", ...ids] },
      });
    });
    expect(how).toBe("saved");
    expect(online).not.toHaveBeenCalled();
    expect(outboxItems()).toHaveLength(2);

    setOnline(true);
    const fake = fakeSupabase({});
    await flush(fake.client);
    expect(outboxItems()).toHaveLength(0);
    const names = fake.calls.map((c) => c.name);
    expect(names.indexOf("storage.photos.upload")).toBeLessThan(names.indexOf("complete_job"));
    expect(fake.calls.find((c) => c.name === "complete_job")?.args).toMatchObject({
      p_job: "j1",
      p: { completion_notes: "All good", photo_file_ids: ["old", "new-files"] },
    });
  });

  it("falls back to saving when the connection drops mid-send", async () => {
    const how = await sendOrSave(
      () => Promise.reject(new TypeError("Failed to fetch")),
      () =>
        enqueue({
          kind: "contact",
          orgId: "org-a",
          label: "Harbour Dental",
          row: { system_id: "s1", date: "2026-11-03", method: "Email", note: "" },
        }),
    );
    expect(how).toBe("saved");
    expect(outboxItems()).toHaveLength(1);
  });

  it("keeps something the server turned down, with the reason", async () => {
    await enqueue({ kind: "complete", orgId: "org-a", label: "Annual service", jobId: "j1", completion });
    const fake = fakeSupabase({ rpcErrors: { complete_job: "This job is cancelled. Re-open it first." } });
    await flush(fake.client);
    expect(outboxItems()[0]?.error).toBe("This job is cancelled. Re-open it first.");
  });

  it("tells network failures from refusals", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError({ message: "TypeError: Load failed" })).toBe(true);
    expect(isNetworkError(new Error("permission denied for table jobs"))).toBe(false);
  });
});

describe("saved copies", () => {
  it("answers database reads from the last copy when offline", async () => {
    const store = new Map<string, Response>();
    vi.stubGlobal("caches", {
      open: async () => ({
        put: async (k: string, r: Response) => void store.set(k, r),
        match: async (k: string) => store.get(k)?.clone(),
      }),
      delete: async () => true,
    });
    let up = true;
    const base = vi.fn(async () => {
      if (!up) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify([{ id: "j1" }]), { status: 200 });
    });
    const f = cachingFetch(base as unknown as typeof fetch);
    const url = "https://x.supabase.co/rest/v1/jobs?select=*";
    await (await f(url)).json();
    await new Promise((r) => setTimeout(r, 0));
    up = false;
    expect(await (await f(url)).json()).toEqual([{ id: "j1" }]);
    await expect(f("https://x.supabase.co/rest/v1/clients")).rejects.toThrow("Failed to fetch");
    vi.unstubAllGlobals();
  });
});

describe("completing a job with no signal", () => {
  it("saves it on the phone and says so", async () => {
    const system = {
      id: "s1",
      client_id: "c1",
      name: "Surgery",
      site_address: "",
      site_postcode: "",
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
    };
    const job = {
      id: "j1",
      system_id: "s1",
      type: "Annual service",
      status: "booked",
      date: todayIso(),
      time: null,
      duration_hrs: 1,
      engineer: "Ed",
      engineer_id: null,
      notes: "",
      materials_ordered: false,
      completed_at: null,
      completion_notes: "",
      billing: "none",
      systems: { ...system, clients: { name: "Harbour Dental" } },
      job_leak_checks: null,
    };
    const fake = fakeSupabase({
      signedInAs: { id: "u-ed", email: "ed@a.test" },
      tables: {
        members: [{ role: "member", orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null } }],
        systems: [system],
        units: [],
        jobs: [job],
        materials: [],
        org_settings: [{ default_engineer: "Ed" }],
      },
    });
    window.location.hash = "#/job/j1?do=complete";
    render(<App client={fake.client} />);
    fireEvent.change(await screen.findByLabelText("What was found and done"), {
      target: { value: "Done offline" },
    });
    setOnline(false);
    fireEvent.click(screen.getByRole("button", { name: /Complete job/ }));
    expect(await screen.findByText(/Completed on this phone at/)).toBeTruthy();
    expect(screen.getByText(/1 change saved on this phone/)).toBeTruthy();
    expect(fake.calls.some((c) => c.name === "complete_job")).toBe(false);
    expect(outboxItems()[0]).toMatchObject({
      kind: "complete",
      jobId: "j1",
      completion: { completion_notes: "Done offline" },
    });
    // Back online: it goes.
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(fake.calls.some((c) => c.name === "complete_job")).toBe(true));
  });
});
