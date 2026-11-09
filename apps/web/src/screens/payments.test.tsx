import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { payLink, payParams } from "../payments";
import { fakeSupabase } from "../test/fakeSupabase";

const TOKEN = "f0000000-0000-4000-8000-000000000001";
const olivia = { id: "u-o", email: "olivia@a.test" };
const membership = { role: "owner", orgs: { id: "org-a", name: "Business A", slug: "a", logo_url: null } };
const info = {
  number: "1001",
  business: "Business A",
  client: "Harbour Dental",
  total: 137.98,
  paid: 0,
  due: 137.98,
  canPay: true,
};
const invoice = {
  id: "i1",
  number: "1001",
  client_id: "c1",
  job_id: null,
  date: "2026-11-03",
  due_date: "2026-11-17",
  reference: "",
  vat_rate: 0.2,
  status: "exported",
  exported_at: null,
  auto: false,
  amount_paid: 0,
  pay_token: TOKEN,
  invoice_lines: [{ id: "l1", position: 0, description: "Annual service", qty: 1, unit_price: 95 }],
  clients: { name: "Harbour Dental", email: "pat@harbour.test" },
  jobs: null,
};

function owner(opts: { status?: unknown[]; received?: unknown[] } = {}) {
  const fake = fakeSupabase({
    signedInAs: olivia,
    rpc: { payment_status: opts.status ?? [], "fn.payments": { url: "https://connect.stripe.test/setup" } },
    tables: {
      members: [membership],
      invoices: [invoice],
      card_payments: opts.received ?? [],
      org_settings: [{ accounts_app: "xero", vat_registered: true, payment_days: 14 }],
      price_list: [],
      materials: [],
      material_prices: [],
    },
  });
  render(<App client={fake.client} />);
  return fake.calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  window.location.hash = "";
  window.history.replaceState(null, "", "/");
});

describe("pay links", () => {
  it("are the app's own address", () => {
    expect(payLink(TOKEN, "https://app.airledger.co.uk")).toBe(`https://app.airledger.co.uk/?pay=${TOKEN}`);
    expect(payParams(`?pay=${TOKEN}`)).toEqual({ token: TOKEN, paid: false });
    expect(payParams(`?paid=${TOKEN}`)).toEqual({ token: TOKEN, paid: true });
    expect(payParams("?pay=nonsense")).toBeNull();
  });

  it("show the customer the invoice and take them to pay, with no sign-in", async () => {
    window.history.replaceState(null, "", `/?pay=${TOKEN}`);
    const fake = fakeSupabase({ rpc: { "fn.payments": info } });
    render(<App client={fake.client} />);
    expect(await screen.findByRole("heading", { name: "Invoice 1001 from Business A" })).toBeTruthy();
    expect(fake.calls.find((c) => c.name === "fn.payments")?.args).toEqual({
      body: { action: "invoice", token: TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pay £137.98 by card" }));
    await waitFor(() =>
      expect(
        fake.calls.some((c) => (c.args as { body: { action: string } }).body?.action === "checkout"),
      ).toBe(true),
    );
    const checkout = fake.calls.find(
      (c) => (c.args as { body: { action: string } }).body?.action === "checkout",
    );
    expect((checkout?.args as { body: Record<string, string> }).body).toMatchObject({ token: TOKEN });
    expect(screen.queryByRole("button", { name: /Sign in/ })).toBeNull();
  });

  it("thank the customer when Stripe sends them back", async () => {
    window.history.replaceState(null, "", `/?paid=${TOKEN}`);
    const fake = fakeSupabase({ rpc: { "fn.payments": info } });
    render(<App client={fake.client} />);
    expect(await screen.findByText("Thank you. Your payment has gone through.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Pay £/ })).toBeNull();
  });

  it("say so when the business isn't taking cards", async () => {
    window.history.replaceState(null, "", `/?pay=${TOKEN}`);
    const fake = fakeSupabase({ rpc: { "fn.payments": { ...info, canPay: false } } });
    render(<App client={fake.client} />);
    expect(await screen.findByText(/isn't taking card payments online yet/)).toBeTruthy();
  });
});

describe("card payments for the business", () => {
  it("are set up from Prices and accounts", async () => {
    window.location.hash = "#/pricing";
    const calls = owner();
    fireEvent.click(await screen.findByRole("button", { name: "Set up card payments" }));
    await waitFor(() => expect(calls.some((c) => c.name === "fn.payments")).toBe(true));
    expect(
      (calls.find((c) => c.name === "fn.payments")?.args as { body: Record<string, string> }).body,
    ).toMatchObject({
      action: "connect",
      orgId: "org-a",
    });
  });

  it("give each invoice a pay link to copy or email", async () => {
    window.location.hash = "#/invoice/i1";
    owner({ status: [{ connected: true, charges_enabled: true, details_submitted: true }] });
    const card = await screen.findByRole("region", { name: "Card payment" });
    expect((within(card).getByLabelText("Pay link") as HTMLInputElement).value).toBe(
      `${window.location.origin}/?pay=${TOKEN}`,
    );
    const mail = within(card).getByRole("link", { name: "Email it" }).getAttribute("href") ?? "";
    expect(mail).toMatch(/^mailto:pat%40harbour\.test\?subject=Invoice%201001/);
    expect(decodeURIComponent(mail)).toContain("£114.00");
  });

  it("show card payments received, and no link once it's paid", async () => {
    window.location.hash = "#/invoice/i1";
    const fake = fakeSupabase({
      signedInAs: olivia,
      rpc: { payment_status: [{ connected: true, charges_enabled: true, details_submitted: true }] },
      tables: {
        members: [membership],
        invoices: [{ ...invoice, amount_paid: 114, paid_at: "2026-11-10" }],
        card_payments: [{ amount: 114, paid_at: "2026-11-10T10:00:00Z" }],
      },
    });
    render(<App client={fake.client} />);
    const card = await screen.findByRole("region", { name: "Card payment" });
    expect(within(card).getByText("£114.00 paid by card")).toBeTruthy();
    expect(within(card).queryByLabelText("Pay link")).toBeNull();
  });

  it("shows nothing on an invoice until card payments are on", async () => {
    window.location.hash = "#/invoice/i1";
    owner();
    expect(await screen.findByDisplayValue("Annual service")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Card payment" })).toBeNull();
  });
});
