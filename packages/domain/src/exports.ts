// Invoice exports for Xero, QuickBooks Online (UK) and Sage 50. Formats: specs/05-integrations.md.
// These must stay byte-identical to the live app's files (see the golden tests).

import { formatUk, roundPence } from "./format";
import type { Client, Invoice, Settings } from "./types";

export type AccountsApp = "xero" | "quickbooks" | "sage";
export type Cell = string | number | null | undefined;

export const accountsApp = (s: Settings): AccountsApp =>
  s.accountsApp === "quickbooks" || s.accountsApp === "sage" ? s.accountsApp : "xero";

/** CSV with CRLF line ends; cells quoted only when they contain a comma, quote or line break. */
export function toCsv(rows: readonly (readonly Cell[])[]): string {
  const cell = (v: Cell) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

type ClientOf = (id: string | undefined) => Client | undefined;

const XERO_HEADER = [
  "*ContactName",
  "EmailAddress",
  "POAddressLine1",
  "POAddressLine2",
  "POAddressLine3",
  "POAddressLine4",
  "POCity",
  "PORegion",
  "POPostalCode",
  "POCountry",
  "*InvoiceNumber",
  "Reference",
  "*InvoiceDate",
  "*DueDate",
  "InventoryItemCode",
  "*Description",
  "*Quantity",
  "*UnitAmount",
  "Discount",
  "*AccountCode",
  "*TaxType",
  "TrackingName1",
  "TrackingOption1",
  "TrackingName2",
  "TrackingOption2",
  "Currency",
  "BrandingTheme",
];

export function xeroRows(list: readonly Invoice[], st: Settings, clientOf: ClientOf): Cell[][] {
  const rows: Cell[][] = [XERO_HEADER];
  for (const i of list) {
    const c = clientOf(i.clientId) ?? ({ id: "" } as Client);
    const a = (c.billingAddress || "")
      .split(/\n|,/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const l of i.lines)
      rows.push([
        c.xeroContactName || c.name || "",
        c.email || "",
        a[0] || "",
        a[1] || "",
        a[2] || "",
        a[3] || "",
        "",
        "",
        c.postcode || "",
        "United Kingdom",
        i.number,
        i.reference || "",
        formatUk(i.date),
        formatUk(i.dueDate),
        "",
        l.desc,
        l.qty,
        Number(l.unit).toFixed(2),
        "",
        st.accountCode,
        i.vat ? st.taxType : "No VAT",
        st.trackingName,
        st.trackingName ? st.trackingOption : "",
        "",
        "",
        "GBP",
        "",
      ]);
  }
  return rows;
}

/** One row per line, grouped by InvoiceNo. */
export function quickbooksRows(list: readonly Invoice[], st: Settings, clientOf: ClientOf): Cell[][] {
  const rows: Cell[][] = [
    [
      "*InvoiceNo",
      "*Customer",
      "*InvoiceDate",
      "*DueDate",
      "Terms",
      "Location",
      "Memo",
      "Item(Product/Service)",
      "ItemDescription",
      "ItemQuantity",
      "ItemRate",
      "*ItemAmount",
      "*ItemTaxCode",
      "ItemTaxAmount",
      "Currency",
      "Service Date",
    ],
  ];
  for (const i of list) {
    const c = clientOf(i.clientId) ?? ({ id: "" } as Client);
    for (const l of i.lines) {
      const amt = roundPence((Number(l.qty) || 0) * (Number(l.unit) || 0));
      rows.push([
        i.number,
        c.xeroContactName || c.name || "",
        formatUk(i.date),
        formatUk(i.dueDate),
        "",
        "",
        i.reference || "",
        st.qbItem,
        l.desc,
        l.qty,
        Number(l.unit).toFixed(2),
        amt.toFixed(2),
        i.vat ? st.qbTaxCode : "No VAT",
        i.vat ? roundPence(amt * 0.2).toFixed(2) : "0.00",
        "GBP",
        "",
      ]);
    }
  }
  return rows;
}

/** The client's Sage account reference, or one made up from the name (8 letters and digits). */
export const sageRef = (c: Client): string =>
  c.sageRef ||
  (c.name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);

/** Sage 50 audit trail import: one SI (sales invoice) row per line, grouped by Reference. */
export function sageRows(list: readonly Invoice[], st: Settings, clientOf: ClientOf): Cell[][] {
  const rows: Cell[][] = [
    [
      "Type",
      "Account Reference",
      "Nominal A/C Ref",
      "Department Code",
      "Date",
      "Reference",
      "Details",
      "Net Amount",
      "Tax Code",
      "Tax Amount",
      "Exchange Rate",
      "Extra Reference",
      "User Name",
      "Project Refn",
      "Cost Code Refn",
    ],
  ];
  for (const i of list) {
    const c = clientOf(i.clientId) ?? ({ id: "" } as Client);
    for (const l of i.lines) {
      const amt = roundPence((Number(l.qty) || 0) * (Number(l.unit) || 0));
      rows.push([
        "SI",
        sageRef(c),
        st.sageNominal,
        "",
        formatUk(i.date),
        i.number,
        String(l.desc || "").slice(0, 60),
        amt.toFixed(2),
        i.vat ? st.sageTaxCode : st.sageNoVatCode,
        i.vat ? roundPence(amt * 0.2).toFixed(2) : "0.00",
        "",
        i.reference || "",
        "",
        "",
        "",
      ]);
    }
  }
  return rows;
}

const ROWS = { xero: xeroRows, quickbooks: quickbooksRows, sage: sageRows };

/** The CSV file for the business's accounts app. */
export function exportInvoicesCsv(list: readonly Invoice[], st: Settings, clientOf: ClientOf): string {
  return toCsv(ROWS[accountsApp(st)](list, st, clientOf));
}
