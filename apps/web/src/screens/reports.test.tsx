import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { reportPdf } from "../reportPdf";
import { fingerprint, nextRef, reportFileName, snapshot, type ReportRow } from "../reports";
import { fakeSupabase } from "../test/fakeSupabase";
import { todayIso } from "./Assets";

const ed = { id: "u-ed", email: "ed@a.test" };
const member = { role: "member", orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null } };
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
  refrigerant: "R410A",
  gwp: null,
  factory_charge_kg: 3,
  added_charge_kg: 0,
  hermetic: false,
  leak_detection: false,
  access_notes: "",
  notes: "",
  inactive: false,
};
const client = {
  id: "c1",
  name: "Harbour Dental",
  contact_name: "Pat Lee",
  phone: "",
  email: "",
  preferred_contact: "Email",
  billing_address: "1 Quay",
  postcode: "BH1 1AA",
  on_service_plan: false,
  reminders_opt_in: true,
  notes: "",
};
const units = [
  {
    id: "u1",
    asset_no: 1,
    sticker_code: "AC-AAAA1",
    system_id: "s1",
    role: "indoor",
    indoor_type: "Cassette",
    manufacturer: "Daikin",
    model: "X",
    serial: "S1",
    capacity_kw: 3.5,
    location: "Reception",
    filter_type: null,
    controller: null,
    condensate_pump: false,
    from_sticker: true,
    notes: "",
  },
];
const job = {
  id: "j1",
  system_id: "s1",
  type: "Annual service",
  status: "completed",
  date: todayIso(),
  time: null,
  duration_hrs: 1,
  engineer: "Ed Jones",
  engineer_id: "p-ed",
  notes: "",
  materials_ordered: false,
  completed_at: new Date().toISOString(),
  completion_notes: "All good",
  billing: "none",
  systems: { ...system, clients: { name: "Harbour Dental" } },
  job_leak_checks: null,
};
const record = { checks: [], leak: null, commissioning: null, ordered: [], used: [], report: null };
const report = (hash: string): ReportRow => ({
  id: "r1",
  job_id: "j1",
  ref: "SR-261103-ABCD",
  rev: 1,
  hash,
  pdf_file_id: "f1",
  issued_at: "2026-11-03T10:00:00Z",
  report_sends: [{ id: "x1", via: "email", sent_to: "pat@harbour.test", sent_at: "2026-11-03T10:01:00Z" }],
});

function app(tables: Record<string, unknown[]> = {}, opts: { rpcErrors?: Record<string, string> } = {}) {
  const fake = fakeSupabase({
    signedInAs: ed,
    rpcErrors: opts.rpcErrors ?? {},
    tables: {
      members: [member],
      org_settings: [{ default_interval_months: 12, report_email: "office@a.test", email: "hello@a.test" }],
      people: [
        {
          id: "p-ed",
          user_id: "u-ed",
          name: "Ed Jones",
          email: "ed@a.test",
          phone: "",
          fgas_cert: "F123",
          active: true,
        },
      ],
      systems: [system],
      clients: [client],
      units,
      jobs: [job],
      files: [{ id: "f1", path: "org-a/reports/SR-261103-ABCD-rev1.pdf" }],
      ...tables,
    },
  });
  render(<App client={fake.client} />);
  return fake.calls;
}

beforeEach(() => {
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  window.location.hash = "";
  vi.restoreAllMocks();
});

describe("report rules", () => {
  it("keeps the reference for a revision", () => {
    expect(nextRef(job as never, [report("h")], "2026-11-04")).toEqual({ ref: "SR-261103-ABCD", rev: 2 });
    expect(nextRef(job as never, [], "2026-11-04").ref).toMatch(/^SR-261104-[A-Z0-9]{4}$/);
    expect(reportFileName({ ref: "SR-1", rev: 2 }, "Harbour Dental Ltd")).toBe(
      "SR-1-rev2-harbour-dental-ltd.pdf",
    );
  });

  it("changes the fingerprint when the record is edited", async () => {
    const base = {
      job: job as never,
      record,
      system: system as never,
      client: client as never,
      units: units as never,
    };
    const a = await fingerprint(snapshot(base));
    expect(await fingerprint(snapshot(base))).toBe(a);
    expect(
      await fingerprint(snapshot({ ...base, job: { ...job, completion_notes: "Changed" } as never })),
    ).not.toBe(a);
  });

  it("builds the PDF", async () => {
    const pdf = await reportPdf({
      business: "Business A",
      profile: {
        trading_as: "",
        phone: "01202 000000",
        email: "hello@a.test",
        website: "",
        address: "1 Road\nTown",
        company_no: "123",
        vat_no: "",
        fgas_cert: "REF1",
        app_url: "",
        sticker_design: {},
      },
      client: client as never,
      system: system as never,
      units: units as never,
      job: job as never,
      record: {
        ...record,
        checks: [
          {
            unit_id: "u1",
            checks: ["filters"],
            off_coil: 12,
            on_coil: null,
            amps: null,
            pressure: null,
            notes: "",
          },
        ],
        used: [
          {
            material_id: "m1",
            name: "Coil cleaner",
            sku: "",
            supplier: "",
            qty: 1,
            raw_qty: null,
            extra: false,
          },
        ],
      },
      info: {
        intervalMonths: 12,
        fgas: { gwp: 2088, kg: 3, tonnesCo2e: 6.26, months: 12, required: true, threshold: 5 },
      } as never,
      signoff: {
        engineer_name: "Ed Jones",
        engineer_cert: "F123",
        customer_name: "",
        client_email: "",
        customer_absent: true,
        absent_note: "Site closed",
        signed_at: new Date().toISOString(),
      },
      images: { logo: null, engineerSig: null, customerSig: null, photos: [] },
      meta: { ref: "SR-261103-ABCD", rev: 1, issuedAt: new Date().toISOString(), hash: "abc" },
    });
    expect(pdf.type).toBe("application/pdf");
    expect(pdf.size).toBeGreaterThan(2000);
  });
});

describe("service reports", () => {
  it("asks for sign-off on a completed job with no report", async () => {
    window.location.hash = "#/job/j1";
    app();
    expect(await screen.findByRole("link", { name: /Sign off and make report/ })).toBeTruthy();
  });

  it("signs off with the customer away, stores the report and opens sending", async () => {
    // jsdom has no canvas: draw onto a stand-in and hand back a PNG.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => undefined,
      clearRect: () => undefined,
    } as never);
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob(["png"], { type: "image/png" }));
    };
    window.location.hash = "#/job/j1?do=signoff";
    const calls = app();
    const form = await screen.findByRole("form", { name: "Sign off" });
    expect((screen.getByLabelText("Engineer's F-gas certificate number") as HTMLInputElement).value).toBe(
      "F123",
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign and make report" }));
    expect(await screen.findByText("The engineer needs to sign in the box.")).toBeTruthy();
    const pad = screen.getByRole("img", { name: "Engineer's signature" });
    fireEvent.pointerDown(pad);
    fireEvent.pointerMove(pad);
    fireEvent.click(screen.getByLabelText("The customer wasn't available to sign"));
    fireEvent.change(screen.getByLabelText("Why couldn't they sign?"), { target: { value: "Site closed" } });
    fireEvent.change(screen.getByLabelText("Send the report to"), { target: { value: "Pat@Harbour.test" } });
    fireEvent.submit(form);
    await waitFor(() => expect(window.location.hash).toBe("#/job/j1?do=send"), { timeout: 4000 });
    const signoff = calls.find((c) => c.name === "job_signoffs.upsert")?.args as unknown[];
    expect(signoff[0]).toMatchObject({
      job_id: "j1",
      engineer_name: "Ed Jones",
      engineer_cert: "F123",
      customer_absent: true,
      absent_note: "Site closed",
      client_email: "pat@harbour.test",
      customer_signature_file_id: null,
    });
    // The client had no email, so the one typed at sign-off is kept.
    expect((calls.find((c) => c.name === "clients.update")?.args as unknown[])[0]).toEqual({
      email: "pat@harbour.test",
    });
    const uploads = calls
      .filter((c) => c.name === "storage.photos.upload")
      .map((c) => (c.args as string[])[0]);
    expect(uploads[0]).toMatch(/^org-a\/signatures\/.+\.png$/);
    expect(uploads[1]).toMatch(/^org-a\/reports\/SR-\d{6}-[A-Z0-9]{4}-rev1-.+\.pdf$/);
    expect((calls.find((c) => c.name === "service_reports.insert")?.args as unknown[])[0]).toMatchObject({
      job_id: "j1",
      rev: 1,
      org_id: "org-a",
    });
  });

  it("shows the issued report, who it went to, and when it's out of date", async () => {
    window.location.hash = "#/job/j1";
    app({ service_reports: [report("old-hash")] });
    expect(await screen.findByText("SR-261103-ABCD")).toBeTruthy();
    expect(screen.getByText(/emailed to pat@harbour.test/)).toBeTruthy();
    expect(screen.getByText(/edited since this report was made/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Re-issue as revision 2" }).getAttribute("href")).toBe(
      "#/job/j1?do=signoff",
    );
  });

  it("emails the report to the customer with the office copied, and logs it", async () => {
    window.location.hash = "#/job/j1?do=send";
    const calls = app({
      service_reports: [report("h")],
      job_signoffs: [{ job_id: "j1", engineer_name: "Ed Jones", client_email: "pat@harbour.test" }],
    });
    expect(((await screen.findByLabelText("To")) as HTMLInputElement).value).toBe("pat@harbour.test");
    expect((screen.getByLabelText("Copy to (office)") as HTMLInputElement).value).toBe("office@a.test");
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe(
      "Service report SR-261103-ABCD – BH1 1AA",
    );
    fireEvent.click(screen.getByRole("button", { name: "Email it" }));
    expect(await screen.findByText("Emailed to pat@harbour.test and office@a.test.")).toBeTruthy();
    const sent = calls.find((c) => c.name === "fn.send-report")?.args as { body: Record<string, unknown> };
    expect(sent.body).toMatchObject({
      orgId: "org-a",
      pdf: "org-a/reports/SR-261103-ABCD-rev1.pdf",
      filename: "SR-261103-ABCD-harbour-dental.pdf",
      to: ["pat@harbour.test"],
      cc: ["office@a.test"],
      replyTo: "hello@a.test",
    });
    expect((calls.find((c) => c.name === "report_sends.insert")?.args as unknown[])[0]).toMatchObject({
      report_id: "r1",
      via: "email",
      sent_to: "pat@harbour.test, office@a.test",
    });
  });

  it("says why an email couldn't be sent", async () => {
    window.location.hash = "#/job/j1?do=send";
    app({ service_reports: [report("h")] }, { rpcErrors: { "fn.send-report": "Email isn't set up yet" } });
    fireEvent.change(await screen.findByLabelText("To"), { target: { value: "pat@harbour.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Email it" }));
    expect(await screen.findByText("Email isn't set up yet")).toBeTruthy();
  });

  it("lists every report, to download or send again", async () => {
    window.location.hash = "#/reports";
    const calls = app({
      service_reports: [
        {
          ...report("h"),
          jobs: {
            id: "j1",
            type: "Annual service",
            date: "2026-11-03",
            engineer: "Ed",
            systems: { ...system, clients: { name: "Harbour Dental" } },
          },
        },
      ],
    });
    expect(await screen.findByText("Harbour Dental · Surgery heat pumps")).toBeTruthy();
    expect(screen.getByText(/SR-261103-ABCD · Annual service/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download SR-261103-ABCD" }));
    await waitFor(() => expect(calls.some((c) => c.name === "storage.photos.download")).toBe(true));
    expect(screen.getByRole("link", { name: "Send SR-261103-ABCD" }).getAttribute("href")).toBe(
      "#/job/j1?do=send&report=r1",
    );
  });
});
