// How Air Ledger's invoices and clients look to Xero and QuickBooks. Plain functions with no Deno or network
// calls, so the web app's tests can check them.

export type System = "xero" | "quickbooks";

export interface SyncClient {
  name: string;
  accounts_name: string;
  email: string;
  billing_address: string;
  postcode: string;
  contact_name: string;
  phone: string;
}

export interface SyncLine {
  position: number;
  description: string;
  qty: number;
  unit_price: number;
}

export interface SyncInvoice {
  number: string;
  date: string;
  due_date: string | null;
  reference: string;
  vat_rate: number;
  lines: SyncLine[];
}

export interface SyncSettings {
  xero_account_code: string;
  qb_item: string;
  qb_tax_code: string;
}

/** The customer's name in the accounts: the name set for the accounts, else the client's name. */
export const contactName = (c: SyncClient) => (c.accounts_name || c.name).trim().slice(0, 255);

/** Billing address lines, split on commas and new lines as the CSV exports do. */
export function addressLines(c: SyncClient): string[] {
  return c.billing_address
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const sorted = (lines: SyncLine[]) => [...lines].sort((a, b) => a.position - b.position);
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- Xero ----------

export function xeroContact(c: SyncClient) {
  const lines = addressLines(c);
  const [first, ...rest] = (c.contact_name || "").trim().split(/\s+/);
  return {
    Name: contactName(c),
    ...(c.email ? { EmailAddress: c.email } : {}),
    ...(first ? { FirstName: first, LastName: rest.join(" ") } : {}),
    ...(c.phone ? { Phones: [{ PhoneType: "DEFAULT", PhoneNumber: c.phone }] } : {}),
    Addresses: [
      {
        AddressType: "POBOX",
        ...Object.fromEntries(lines.slice(0, 4).map((l, i) => [`AddressLine${i + 1}`, l])),
        PostalCode: c.postcode,
        Country: "United Kingdom",
      },
    ],
  };
}

/** Sent as a draft, so the business can still check it in Xero before it goes to the customer. */
export function xeroInvoice(inv: SyncInvoice, contactId: string, s: SyncSettings) {
  const vat = Number(inv.vat_rate) > 0;
  return {
    Type: "ACCREC",
    Contact: { ContactID: contactId },
    InvoiceNumber: inv.number,
    Reference: inv.reference,
    Date: inv.date,
    DueDate: inv.due_date ?? inv.date,
    LineAmountTypes: "Exclusive",
    Status: "DRAFT",
    LineItems: sorted(inv.lines).map((l) => ({
      Description: l.description,
      Quantity: Number(l.qty),
      UnitAmount: round2(Number(l.unit_price)),
      AccountCode: s.xero_account_code || "200",
      // Xero's codes for "20% (VAT on Income)" and "No VAT".
      TaxType: vat ? "OUTPUT2" : "NONE",
    })),
  };
}

export interface Paid {
  amountPaid: number;
  paidOn: string | null;
}

/** Xero dates come as "/Date(1730764800000+0000)/" or ISO. */
export function xeroDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const ms = /\/Date\((\d+)/.exec(v)?.[1];
  const d = ms ? new Date(Number(ms)) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function xeroPaid(x: { Status?: string; AmountPaid?: number; FullyPaidOnDate?: string }): Paid {
  return {
    amountPaid: Number(x.AmountPaid ?? 0),
    paidOn: x.Status === "PAID" ? xeroDate(x.FullyPaidOnDate) : null,
  };
}

// ---------- QuickBooks ----------

/** QuickBooks queries use single quotes; a quote in a name is escaped with a backslash. */
export const qbQuote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export function qbCustomer(c: SyncClient) {
  const lines = addressLines(c);
  return {
    DisplayName: contactName(c).replace(/:/g, " ").slice(0, 100),
    ...(c.email ? { PrimaryEmailAddr: { Address: c.email } } : {}),
    ...(c.phone ? { PrimaryPhone: { FreeFormNumber: c.phone } } : {}),
    BillAddr: {
      ...Object.fromEntries(lines.slice(0, 5).map((l, i) => [`Line${i + 1}`, l])),
      PostalCode: c.postcode,
      Country: "United Kingdom",
    },
  };
}

export function qbInvoice(
  inv: SyncInvoice,
  customerId: string,
  refs: { itemId: string; vatCodeId: string; noVatCodeId: string },
) {
  const vat = Number(inv.vat_rate) > 0;
  return {
    CustomerRef: { value: customerId },
    DocNumber: inv.number.slice(0, 21),
    TxnDate: inv.date,
    DueDate: inv.due_date ?? inv.date,
    ...(inv.reference ? { PrivateNote: inv.reference } : {}),
    GlobalTaxCalculation: "TaxExcluded",
    Line: sorted(inv.lines).map((l) => ({
      DetailType: "SalesItemLineDetail",
      Description: l.description,
      Amount: round2(Number(l.qty) * Number(l.unit_price)),
      SalesItemLineDetail: {
        ItemRef: { value: refs.itemId },
        Qty: Number(l.qty),
        UnitPrice: round2(Number(l.unit_price)),
        TaxCodeRef: { value: vat ? refs.vatCodeId : refs.noVatCodeId },
      },
    })),
  };
}

export function qbPaid(q: { TotalAmt?: number; Balance?: number; MetaData?: { LastUpdatedTime?: string } }): Paid {
  const total = Number(q.TotalAmt ?? 0);
  const balance = Number(q.Balance ?? total);
  return {
    amountPaid: round2(total - balance),
    paidOn: total > 0 && balance <= 0 ? (q.MetaData?.LastUpdatedTime ?? "").slice(0, 10) || null : null,
  };
}

/** A short, readable reason from an accounts system's error reply. */
export function apiError(system: System, status: number, body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (system === "xero") {
    const elements = (b.Elements as { ValidationErrors?: { Message?: string }[] }[] | undefined) ?? [];
    const v = elements.flatMap((e) => e.ValidationErrors ?? []).map((e) => e.Message).filter(Boolean);
    if (v.length) return v.join("; ");
    if (typeof b.Message === "string") return b.Message;
    if (typeof b.Detail === "string") return b.Detail;
  } else {
    const f = (b.Fault as { Error?: { Message?: string; Detail?: string }[] } | undefined)?.Error ?? [];
    const m = f.map((e) => e.Detail || e.Message).filter(Boolean);
    if (m.length) return m.join("; ");
  }
  if (status === 401 || status === 403) return "The connection has expired. Connect again from Prices and accounts.";
  if (status === 429) return "Too many requests just now. Try again in a minute.";
  return `${system === "xero" ? "Xero" : "QuickBooks"} said no (error ${status}).`;
}
