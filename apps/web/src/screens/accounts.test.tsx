import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { fakeSupabase } from "../test/fakeSupabase";
import {
  apiError,
  qbInvoice,
  qbPaid,
  qbQuote,
  xeroContact,
  xeroInvoice,
  xeroPaid,
} from "../../../../supabase/functions/accounts/map";

const client = {
  name: "Harbour Dental",
  accounts_name: "",
  email: "pat@harbour.test",
  billing_address: "1 Quay,\nPoole",
  postcode: "BH15 1AA",
  contact_name: "Pat Jones",
  phone: "01202 000000",
};
const invoice = {
  number: "1001",
  date: "2026-11-03",
  due_date: "2026-11-17",
  reference: "Annual service BH15",
  vat_rate: 0.2,
  lines: [
    { position: 1, description: "Coil cleaner", qty: 2, unit_price: 9.5 },
    { position: 0, description: "Annual service", qty: 1, unit_price: 95 },
  ],
};

describe("what goes to Xero", () => {
  it("adds the customer with their address", () => {
    expect(xeroContact(client)).toMatchObject({
      Name: "Harbour Dental",
      EmailAddress: "pat@harbour.test",
      FirstName: "Pat",
      LastName: "Jones",
      Addresses: [
        { AddressType: "POBOX", AddressLine1: "1 Quay", AddressLine2: "Poole", PostalCode: "BH15 1AA" },
      ],
    });
  });
  it("sends the invoice as a draft, lines in order, with Xero's VAT codes", () => {
    const x = xeroInvoice(invoice, "contact-1", { xero_account_code: "200", qb_item: "", qb_tax_code: "" });
    expect(x).toMatchObject({
      Type: "ACCREC",
      Status: "DRAFT",
      InvoiceNumber: "1001",
      LineAmountTypes: "Exclusive",
    });
    expect(x.LineItems.map((l) => [l.Description, l.TaxType])).toEqual([
      ["Annual service", "OUTPUT2"],
      ["Coil cleaner", "OUTPUT2"],
    ]);
    expect(
      xeroInvoice({ ...invoice, vat_rate: 0 }, "c", { xero_account_code: "", qb_item: "", qb_tax_code: "" })
        .LineItems[0],
    ).toMatchObject({ TaxType: "NONE", AccountCode: "200" });
  });
  it("reads payments back", () => {
    expect(
      xeroPaid({ Status: "PAID", AmountPaid: 136.8, FullyPaidOnDate: "/Date(1762300800000+0000)/" }),
    ).toEqual({
      amountPaid: 136.8,
      paidOn: "2025-11-05",
    });
    expect(xeroPaid({ Status: "AUTHORISED", AmountPaid: 50 }).paidOn).toBeNull();
  });
  it("turns Xero's validation errors into a reason", () => {
    expect(
      apiError("xero", 400, { Elements: [{ ValidationErrors: [{ Message: "Invoice # must be unique." }] }] }),
    ).toBe("Invoice # must be unique.");
  });
});

describe("what goes to QuickBooks", () => {
  it("prices each line with the product, VAT code and amount", () => {
    const q = qbInvoice(invoice, "cust-9", { itemId: "1", vatCodeId: "20", noVatCodeId: "5" });
    expect(q).toMatchObject({
      CustomerRef: { value: "cust-9" },
      DocNumber: "1001",
      GlobalTaxCalculation: "TaxExcluded",
    });
    expect(q.Line[1]).toMatchObject({
      Amount: 19,
      SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 2, UnitPrice: 9.5, TaxCodeRef: { value: "20" } },
    });
  });
  it("escapes names in queries and reads what's been paid", () => {
    expect(qbQuote("O'Neill's")).toBe("'O\\'Neill\\'s'");
    expect(
      qbPaid({ TotalAmt: 100, Balance: 0, MetaData: { LastUpdatedTime: "2026-11-04T10:00:00Z" } }),
    ).toEqual({
      amountPaid: 100,
      paidOn: "2026-11-04",
    });
    expect(qbPaid({ TotalAmt: 100, Balance: 40 })).toEqual({ amountPaid: 60, paidOn: null });
  });
});

// ---------- the screens ----------

const olivia = { id: "u-o", email: "olivia@a.test" };
const inv = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  number: id === "i1" ? "1001" : "1002",
  client_id: "c1",
  job_id: null,
  date: "2026-11-03",
  due_date: "2026-11-17",
  reference: "",
  vat_rate: 0,
  status: "draft",
  exported_at: null,
  auto: true,
  invoice_lines: [{ id: "l", position: 0, description: "Service", qty: 1, unit_price: 95 }],
  clients: { name: "Harbour Dental" },
  jobs: null,
  ...extra,
});

function app(connected: boolean, invoices: unknown[] = [inv("i1")]) {
  const fake = fakeSupabase({
    signedInAs: olivia,
    rpc: {
      accounts_connection: connected
        ? [
            {
              system: "xero",
              tenant_name: "Altitude Ltd",
              connected_at: "2026-11-05T10:00:00Z",
              last_sync_at: null,
              last_error: "",
            },
          ]
        : [],
      "fn.accounts": { system: "xero", sent: 1, paid: 0, errors: [], url: "https://login.xero.com/x" },
    },
    tables: {
      members: [{ role: "owner", orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null } }],
      org_settings: [{ accounts_app: "xero", vat_registered: false, payment_days: 14 }],
      invoice_counters: [{ prefix: "", next_number: 1003 }],
      invoices,
      jobs: [],
      materials: [],
      material_prices: [],
      price_list: [],
    },
  });
  render(<App client={fake.client} />);
  return fake.calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("live connection", () => {
  it("offers to connect Xero or QuickBooks from Prices and accounts", async () => {
    window.location.hash = "#/pricing?accounts=connected";
    const calls = app(false);
    expect(await screen.findByRole("button", { name: "Connect QuickBooks" })).toBeTruthy();
    expect(screen.getByText(/Connected. Invoices can now be sent/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect Xero" }));
    await waitFor(() => expect(calls.some((c) => c.name === "fn.accounts")).toBe(true));
    expect((calls.find((c) => c.name === "fn.accounts")?.args as { body: unknown }).body).toMatchObject({
      action: "connect",
      system: "xero",
      orgId: "org-a",
    });
  });

  it("shows who it's connected to", async () => {
    window.location.hash = "#/pricing";
    app(true);
    expect(await screen.findByText(/Altitude Ltd/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("sends the waiting invoices to Xero instead of a CSV, and shows what's paid", async () => {
    window.location.hash = "#/invoices";
    const calls = app(true, [
      inv("i1"),
      inv("i2", { status: "exported", external_system: "xero", external_id: "x2", paid_at: "2026-11-04" }),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Send 1 to Xero" }));
    expect(await screen.findByText(/1 sent to Xero/)).toBeTruthy();
    const sync = calls
      .filter((c) => c.name === "fn.accounts")
      .map((c) => (c.args as { body: Record<string, unknown> }).body);
    expect(sync[0]).toMatchObject({ action: "sync", invoices: [] });
    expect(sync[1]).toMatchObject({ action: "sync", invoices: ["i1"] });
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(await screen.findByText(/paid 4 Nov 2026 · in Xero/)).toBeTruthy();
  });

  it("keeps the CSV export when nothing is connected", async () => {
    window.location.hash = "#/invoices";
    const calls = app(false);
    expect(await screen.findByRole("button", { name: "Export 1 to Xero" })).toBeTruthy();
    expect(calls.some((c) => c.name === "fn.accounts")).toBe(false);
  });
});
