// Clients, installs (systems) and units: the typed tables from stage 2. Rows keep the database's column names;
// toDomain() turns a system into the shape packages/domain's rules read.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Settings, System } from "@airledger/domain";

export const PREFERRED_CONTACT = ["Email", "Phone", "Text message", "WhatsApp"] as const;
export const INDOOR_TYPES = [
  "Wall mounted",
  "Cassette",
  "Ducted",
  "Floor console",
  "Ceiling suspended",
  "Other",
] as const;
export const FILTER_TYPES = ["Washable", "Replaceable", "None"] as const;
export const CONTROLLERS = ["Wireless remote", "Wired controller", "Wi-Fi / app", "None"] as const;

export interface ClientRow {
  id: string;
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  preferred_contact: string;
  billing_address: string;
  postcode: string;
  on_service_plan: boolean;
  reminders_opt_in: boolean;
  notes: string;
}

export interface SystemRow {
  id: string;
  client_id: string;
  name: string;
  site_address: string;
  site_postcode: string;
  install_date: string | null;
  commissioned_by: string;
  service_interval_months: number | null;
  warranty_years: number | null;
  refrigerant: string;
  gwp: number | null;
  factory_charge_kg: number | null;
  added_charge_kg: number | null;
  hermetic: boolean;
  leak_detection: boolean;
  access_notes: string;
  notes: string;
  inactive: boolean;
}

export const SITE_RECORD_KINDS = [
  "Site note",
  "Photos",
  "Install / commissioning report",
  "Service report",
  "Defect / remedial",
  "Customer request",
] as const;

export interface SiteRecordRow {
  id: string;
  system_id: string;
  unit_id: string | null;
  kind: string;
  date: string;
  author: string;
  text: string;
  photo_file_ids: string[];
}

export interface UnitRow {
  id: string;
  /** Numbered 1, 2, 3… within the business by the database. */
  asset_no: number;
  sticker_code: string;
  system_id: string;
  role: "outdoor" | "indoor";
  indoor_type: string | null;
  manufacturer: string;
  model: string;
  serial: string;
  capacity_kw: number | null;
  location: string;
  filter_type: string | null;
  controller: string | null;
  condensate_pump: boolean;
  from_sticker: boolean;
  notes: string;
}

export type StickerRow = Pick<
  UnitRow,
  "id" | "asset_no" | "sticker_code" | "role" | "indoor_type" | "manufacturer" | "model" | "location"
> & {
  created_at: string;
  systems: { id: string; name: string; site_postcode: string; clients: { name: string } | null } | null;
};

export const PROFILE_FIELDS = [
  "trading_as",
  "phone",
  "email",
  "website",
  "address",
  "company_no",
  "vat_no",
  "fgas_cert",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type Profile = Record<ProfileField, string> & { app_url: string; sticker_design: unknown };

export interface StickerBatch {
  id: string;
  quantity: number;
  design: unknown;
  note: string;
  created_at: string;
}

/** The settings the due-date rules read. */
export interface RuleSettings {
  default_interval_months: number;
  reminder_lead_days: number;
  chase_after_days: number;
  warranty_years: number;
  phone: string;
  app_url: string;
}

export interface ContactLogRow {
  id: string;
  system_id: string;
  date: string;
  method: string;
  note: string;
}

export interface ReminderSettings {
  email_subject: string;
  email_body: string;
  sms_body: string;
  phone: string;
  default_engineer: string;
  trading_as: string;
}

/** The live app's wording, used until a business writes its own (Business settings). */
export const DEFAULT_TEMPLATES = {
  email_subject: "Your air conditioning service is due – {site}",
  email_body:
    "Hi {contact},\n\nOur records show the air conditioning at {site} ({units}) is due its annual service on {dueDate}.\n\nRegular servicing keeps the system running efficiently, keeps the air clean and keeps your manufacturer's warranty valid.\n\nJust reply to this email or call us on {phone} and we'll book a time that suits you.\n\nKind regards,\n{engineer}\n{business}",
  sms_body:
    "Hi {contact}, it's {engineer} from {business}. Your air con at {site} is due its annual service ({dueDate}). Reply or call {phone} to book a time. Thanks!",
};

/** Fills {placeholders}; unknown ones are left as they are. */
export const fillTemplate = (t: string, map: Record<string, string>) =>
  t.replace(/\{(\w+)\}/g, (m, k: string) => map[k] ?? m);

export type New<T> = Omit<T, "id"> & { id?: string | undefined };

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message);
};

export function toDomain(s: SystemRow): System {
  return {
    id: s.id,
    clientId: s.client_id,
    name: s.name,
    siteAddress: s.site_address,
    sitePostcode: s.site_postcode,
    installDate: s.install_date,
    serviceIntervalMonths: s.service_interval_months,
    warrantyYears: s.warranty_years,
    refrigerant: s.refrigerant,
    gwp: s.gwp,
    factoryChargeKg: s.factory_charge_kg,
    addedChargeKg: s.added_charge_kg,
    hermetic: s.hermetic,
    leakDetection: s.leak_detection,
    accessNotes: s.access_notes,
    inactive: s.inactive,
  };
}

export function toSettings(r: RuleSettings | null): Settings {
  return {
    defaultInterval: r?.default_interval_months ?? 12,
    reminderLeadDays: r?.reminder_lead_days ?? 30,
    chaseAfterDays: r?.chase_after_days ?? 14,
    warrantyYears: r?.warranty_years ?? 5,
  };
}

export function assets(sb: SupabaseClient, orgId: string) {
  async function save(
    table: string,
    row: { id?: string | undefined } & Record<string, unknown>,
  ): Promise<string> {
    const { id, ...fields } = row;
    const q = id
      ? sb.from(table).update(fields).eq("id", id).eq("org_id", orgId).select("id").single()
      : sb
          .from(table)
          .insert({ ...fields, org_id: orgId })
          .select("id")
          .single();
    const { data, error } = await q;
    fail(error);
    return (data as { id: string }).id;
  }

  return {
    orgId,
    async clients(): Promise<(ClientRow & { systems: { count: number }[] })[]> {
      const { data, error } = await sb
        .from("clients")
        .select("*, systems(count)")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("name");
      fail(error);
      return (data ?? []) as (ClientRow & { systems: { count: number }[] })[];
    },

    async client(id: string): Promise<ClientRow | null> {
      const { data, error } = await sb.from("clients").select("*").eq("id", id).maybeSingle();
      fail(error);
      return data as ClientRow | null;
    },

    saveClient: (row: New<ClientRow>) => save("clients", row),

    async systems(clientId: string): Promise<SystemRow[]> {
      const { data, error } = await sb
        .from("systems")
        .select("*")
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .order("name");
      fail(error);
      return (data ?? []) as SystemRow[];
    },

    async system(id: string): Promise<SystemRow | null> {
      const { data, error } = await sb.from("systems").select("*").eq("id", id).maybeSingle();
      fail(error);
      return data as SystemRow | null;
    },

    saveSystem: (row: New<SystemRow>) => save("systems", row),

    async units(systemId: string): Promise<UnitRow[]> {
      const { data, error } = await sb
        .from("units")
        .select("*")
        .eq("system_id", systemId)
        .order("created_at");
      fail(error);
      return (data ?? []) as UnitRow[];
    },

    async unitByCode(code: string): Promise<UnitRow | null> {
      const { data, error } = await sb
        .from("units")
        .select("*")
        .eq("org_id", orgId)
        .eq("sticker_code", code)
        .maybeSingle();
      fail(error);
      return data as UnitRow | null;
    },

    /** A new unit without a pre-printed sticker gets a code reserved on the server, so it's unique. */
    async saveUnit(row: New<Omit<UnitRow, "asset_no">>): Promise<string> {
      let code = row.sticker_code;
      if (!row.id && !code) {
        const { data, error } = await sb.rpc("reserve_stickers", { p_org: orgId, p_count: 1 });
        fail(error);
        code = (data as string[])[0] ?? "";
      }
      const indoor = row.role === "indoor";
      await save("units", {
        ...row,
        sticker_code: code,
        indoor_type: indoor ? row.indoor_type : null,
        filter_type: indoor ? row.filter_type : null,
        controller: indoor ? row.controller : null,
        condensate_pump: indoor && row.condensate_pump,
      });
      return code;
    },

    /** Every sticker on a unit in this business, newest first, with where it is. */
    async stickers(): Promise<StickerRow[]> {
      const { data, error } = await sb
        .from("units")
        .select(
          "id, asset_no, sticker_code, role, indoor_type, manufacturer, model, location, created_at, systems(id, name, site_postcode, clients(name))",
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
      fail(error);
      return (data ?? []) as unknown as StickerRow[];
    },

    /** How many codes this business has reserved in all (printed, ordered or put on units). */
    async reservedCount(): Promise<number> {
      const { count, error } = await sb
        .from("sticker_reservations")
        .select("code", { count: "exact", head: true })
        .eq("org_id", orgId);
      fail(error);
      return count ?? 0;
    },

    /** Reserves new sticker codes for printing (1–210 for anyone, up to 5,000 for owners). */
    async reserveStickers(count: number): Promise<string[]> {
      const { data, error } = await sb.rpc("reserve_stickers", { p_org: orgId, p_count: count });
      fail(error);
      return data as string[];
    },

    /** Installs to pick from when registering a sticker: newest first, with the client's name. */
    async allSystems(): Promise<(SystemRow & { clients: { name: string } | null })[]> {
      const { data, error } = await sb
        .from("systems")
        .select("*, clients(name)")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .eq("inactive", false)
        .order("created_at", { ascending: false });
      fail(error);
      return (data ?? []) as (SystemRow & { clients: { name: string } | null })[];
    },

    async siteRecords(systemId: string): Promise<SiteRecordRow[]> {
      const { data, error } = await sb
        .from("site_records")
        .select("id, system_id, unit_id, kind, date, author, text, photo_file_ids")
        .eq("system_id", systemId)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });
      fail(error);
      return (data ?? []) as SiteRecordRow[];
    },

    saveSiteRecord: (row: New<SiteRecordRow>) => save("site_records", row),

    async deleteSiteRecord(id: string): Promise<void> {
      const { error } = await sb.from("site_records").delete().eq("id", id).eq("org_id", orgId);
      fail(error);
    },

    /** Uploads a photo into the business's own folder and records it. Returns the file id. */
    async uploadPhoto(file: Blob): Promise<string> {
      const path = `${orgId}/${crypto.randomUUID()}.jpg`;
      const up = await sb.storage
        .from("photos")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      fail(up.error);
      const { data, error } = await sb
        .from("files")
        .insert({
          org_id: orgId,
          bucket: "photos",
          path,
          kind: "photo",
          content_type: file.type,
          size_bytes: file.size,
        })
        .select("id")
        .single();
      fail(error);
      return (data as { id: string }).id;
    },

    /** Short-lived links for showing photos (the bucket is private). */
    async photoUrls(fileIds: string[]): Promise<Record<string, string>> {
      if (!fileIds.length) return {};
      const { data, error } = await sb.from("files").select("id, path").in("id", fileIds);
      fail(error);
      const rows = (data ?? []) as { id: string; path: string }[];
      if (!rows.length) return {};
      const signed = await sb.storage.from("photos").createSignedUrls(
        rows.map((r) => r.path),
        3600,
      );
      fail(signed.error);
      const byPath = new Map((signed.data ?? []).map((x) => [x.path, x.signedUrl]));
      return Object.fromEntries(
        rows.flatMap((r) => (byPath.get(r.path) ? [[r.id, byPath.get(r.path) ?? ""]] : [])),
      );
    },

    /** Moves a unit onto a new sticker (the old one was lost or damaged). The unit keeps all its history. */
    async replaceSticker(unitId: string, code: string): Promise<void> {
      const { error } = await sb
        .from("units")
        .update({ sticker_code: code, from_sticker: true })
        .eq("id", unitId)
        .eq("org_id", orgId);
      fail(error);
    },

    /** The business's contact details and saved sticker design. */
    async profile(): Promise<Profile> {
      const { data, error } = await sb
        .from("org_settings")
        .select(`${PROFILE_FIELDS.join(", ")}, app_url, sticker_design`)
        .eq("org_id", orgId)
        .maybeSingle();
      fail(error);
      const row = (data ?? {}) as Partial<Profile>;
      return {
        ...(Object.fromEntries(PROFILE_FIELDS.map((k) => [k, row[k] ?? ""])) as Record<ProfileField, string>),
        app_url: row.app_url ?? "",
        sticker_design: row.sticker_design ?? {},
      };
    },

    /** Owner only (the database refuses anyone else). */
    async saveProfile(fields: Partial<Record<ProfileField, string>> & { sticker_design?: unknown }) {
      const { data, error } = await sb
        .from("org_settings")
        .update(fields)
        .eq("org_id", orgId)
        .select("org_id");
      fail(error);
      if (Array.isArray(data) && data.length === 0) throw new Error("Only an owner can change this.");
    },

    async stickerBatches(): Promise<StickerBatch[]> {
      const { data, error } = await sb
        .from("sticker_batches")
        .select("id, quantity, design, note, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
      fail(error);
      return (data ?? []) as StickerBatch[];
    },

    /** Owner only: reserves `count` new codes as one batch, printed in `design`. Returns the batch id. */
    async createStickerBatch(count: number, design: unknown, note: string): Promise<string> {
      const { data, error } = await sb.rpc("create_sticker_batch", {
        p_org: orgId,
        p_count: count,
        p_design: design,
        p_note: note,
      });
      fail(error);
      return data as string;
    },

    /** A batch's codes, in order (fetched 1,000 at a time). */
    async batchCodes(batchId: string): Promise<string[]> {
      const codes: string[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb
          .from("sticker_reservations")
          .select("code")
          .eq("batch_id", batchId)
          .order("code")
          .range(from, from + 999);
        fail(error);
        const rows = (data ?? []) as { code: string }[];
        codes.push(...rows.map((r) => r.code));
        if (rows.length < 1000) return codes;
      }
    },

    /** Every unit in the business (for orders and the asset register). */
    async allUnits(): Promise<UnitRow[]> {
      const { data, error } = await sb.from("units").select("*").eq("org_id", orgId).order("asset_no");
      fail(error);
      return (data ?? []) as UnitRow[];
    },

    /** Every contact logged against an install, oldest first. */
    async contactLogs(): Promise<ContactLogRow[]> {
      const { data, error } = await sb
        .from("contact_logs")
        .select("id, system_id, date, method, note")
        .eq("org_id", orgId)
        .order("date")
        .order("created_at");
      fail(error);
      return (data ?? []) as ContactLogRow[];
    },

    async logContact(row: Omit<ContactLogRow, "id">): Promise<void> {
      const { error } = await sb.from("contact_logs").insert({ ...row, org_id: orgId });
      fail(error);
    },

    /** Reminder templates and the details they fill in. */
    async reminderSettings(): Promise<ReminderSettings> {
      const { data, error } = await sb
        .from("org_settings")
        .select("email_subject, email_body, sms_body, phone, default_engineer, trading_as")
        .eq("org_id", orgId)
        .maybeSingle();
      fail(error);
      const r = (data ?? {}) as Partial<ReminderSettings>;
      return {
        email_subject: r.email_subject || DEFAULT_TEMPLATES.email_subject,
        email_body: r.email_body || DEFAULT_TEMPLATES.email_body,
        sms_body: r.sms_body || DEFAULT_TEMPLATES.sms_body,
        phone: r.phone ?? "",
        default_engineer: r.default_engineer ?? "",
        trading_as: r.trading_as ?? "",
      };
    },

    async ruleSettings(): Promise<RuleSettings | null> {
      const { data, error } = await sb
        .from("org_settings")
        .select(
          "default_interval_months, reminder_lead_days, chase_after_days, warranty_years, phone, app_url",
        )
        .eq("org_id", orgId)
        .maybeSingle();
      fail(error);
      return data as RuleSettings | null;
    },
  };
}

export type Assets = ReturnType<typeof assets>;
