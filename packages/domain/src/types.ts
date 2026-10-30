// Record shapes as the live app stores them today (the JSON in `docs.data`). Field names match
// specs/02-domain-model.md so the data migration can map them to typed columns later.
// Number fields are `number | string` where the live app's forms can leave a string behind.

import type { IsoDate } from "./dates";

export type Num = number | string | null | undefined;

export const SERVICE_TYPES = ["Annual service", "Service + repair"] as const;
export const INSTALL_TYPES = ["Installation", "Commissioning"] as const;
export const JOB_TYPES = [
  "Annual service",
  "Service + repair",
  "Leak check",
  "Repair / breakdown",
  "Installation",
  "Commissioning",
  "Survey",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const isServiceType = (type: string | undefined): boolean =>
  (SERVICE_TYPES as readonly string[]).includes(type ?? "");
export const isInstallType = (type: string | undefined): boolean =>
  (INSTALL_TYPES as readonly string[]).includes(type ?? "");

export interface Settings {
  defaultInterval?: Num;
  reminderLeadDays?: Num;
  chaseAfterDays?: Num;
  warrantyYears?: Num;
  vatRegistered?: boolean;
  invoicePrefix?: string;
  nextInvoiceNo?: Num;
  paymentDays?: Num;
  accountsApp?: "xero" | "quickbooks" | "sage" | string;
  accountCode?: string;
  taxType?: string;
  trackingName?: string;
  trackingOption?: string;
  qbItem?: string;
  qbTaxCode?: string;
  sageNominal?: string;
  sageTaxCode?: string;
  sageNoVatCode?: string;
  appUrl?: string;
}

/** Owner-only price list (`pricing/settings`). */
export interface PriceList {
  labourFirst?: Num;
  labourAdditional?: Num;
  labourHourly?: Num;
  leakCheckCharge?: Num;
  refrigerantPerKg?: Num;
  calloutCharge?: Num;
}

export interface Client {
  id: string;
  name?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  billingAddress?: string;
  postcode?: string;
  servicePlan?: string;
  planBilling?: "separate" | "visit" | string;
  xeroContactName?: string;
  sageRef?: string;
}

export interface ContactLogEntry {
  date: IsoDate;
  method?: string;
  note?: string;
}

export interface System {
  id: string;
  clientId?: string;
  name?: string;
  siteAddress?: string;
  sitePostcode?: string;
  installDate?: IsoDate | null;
  serviceIntervalMonths?: Num;
  warrantyYears?: Num;
  refrigerant?: string;
  gwp?: Num;
  factoryChargeKg?: Num;
  addedChargeKg?: Num;
  hermetic?: boolean;
  leakDetection?: boolean;
  accessNotes?: string;
  inactive?: boolean;
  contactLog?: ContactLogEntry[];
}

export interface Unit {
  id: string;
  systemId?: string;
  role?: "outdoor" | "indoor" | string;
  indoorType?: string;
  manufacturer?: string;
  model?: string;
  serial?: string;
  location?: string;
  filterType?: string;
  controller?: string;
  condensatePump?: boolean;
}

/** A line on a job's parts list. */
export interface MaterialLine {
  id: string;
  name: string;
  sku?: string;
  supplier?: string;
  qty: number;
  raw?: number;
  /** Added by the engineer on top of the service kit. */
  extra?: boolean;
  // Older jobs carry prices on the line; the price list wins when the material still exists.
  cost?: Num;
  sell?: Num;
  chargeable?: boolean;
}

export interface LeakCheck {
  performed?: boolean;
  addedKg?: Num;
}

export interface Job {
  id: string;
  systemId?: string;
  type?: string;
  status?: "booked" | "completed" | "cancelled" | string;
  date?: IsoDate;
  time?: string;
  durationHrs?: Num;
  notes?: string;
  materialsOrdered?: boolean;
  materialsSnapshot?: MaterialLine[] | null;
  materialsUsed?: MaterialLine[];
  leakCheck?: LeakCheck;
  [key: string]: unknown;
}

export interface Material {
  id: string;
  name?: string;
  supplier?: string;
  sku?: string;
  appliesTo?: string;
  qtyPer?: Num;
  when?: "service" | "leak" | "any" | "pick" | string;
  active?: boolean;
  // Prices stored on the material before they moved to the owner-only price list.
  cost?: Num;
  sell?: Num;
  chargeable?: boolean;
}

/** Owner-only price for a material (`pricing/mat:<id>`). */
export interface MaterialPrice {
  cost?: Num;
  sell?: Num;
  chargeable?: boolean;
}

export interface InvoiceLine {
  desc: string;
  qty: Num;
  unit: Num;
}

export interface Invoice {
  id?: string;
  clientId?: string;
  jobId?: string;
  number?: string;
  date?: IsoDate;
  dueDate?: IsoDate;
  reference?: string;
  lines: InvoiceLine[];
  vat?: boolean;
  status?: "draft" | "exported" | string;
}

export interface SiteRecord {
  id?: string;
  jobId?: string;
  kind?: string;
  date?: IsoDate;
  author?: string;
  text?: string;
  photos?: string[];
  unitId?: string;
  createdAt?: string;
}

/** Number() with the live app's "blank or junk is 0" behaviour. */
export const toNum = (v: Num): number => Number(v) || 0;
