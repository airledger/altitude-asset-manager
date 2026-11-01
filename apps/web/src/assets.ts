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

export interface UnitRow {
  id: string;
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

/** The settings the due-date rules read. */
export interface RuleSettings {
  default_interval_months: number;
  reminder_lead_days: number;
  chase_after_days: number;
  warranty_years: number;
}

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
    async saveUnit(row: New<UnitRow>): Promise<string> {
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

    async ruleSettings(): Promise<RuleSettings | null> {
      const { data, error } = await sb
        .from("org_settings")
        .select("default_interval_months, reminder_lead_days, chase_after_days, warranty_years")
        .eq("org_id", orgId)
        .maybeSingle();
      fail(error);
      return data as RuleSettings | null;
    },
  };
}

export type Assets = ReturnType<typeof assets>;
