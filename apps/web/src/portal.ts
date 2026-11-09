// Customer portal (part 2). Customers only ever reach the business's records through the portal_* database
// functions, which check they belong to the client first; the business's own side (invites, requests) goes
// through the normal tables with row-level security.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MyPortal {
  client_id: string;
  client_name: string;
  org_id: string;
  org_name: string;
  logo_url: string | null;
}

export interface PortalVisit {
  id: string;
  date: string | null;
  time: string | null;
  type: string;
  status: "booked" | "completed" | "cancelled";
  site: string;
  engineer: string;
  customer_response: "accepted" | "change" | null;
  customer_note: string;
}

export interface PortalRequest {
  id: string;
  kind: string;
  message: string;
  preferred: string;
  status: "requested" | "booked" | "declined" | "withdrawn";
  reply: string;
  created_at: string;
  site: string | null;
}

export interface PortalOverview {
  business: { name: string; logo_url: string | null; phone: string; email: string; self_booking: boolean };
  client: { id: string; name: string };
  sites: {
    id: string;
    name: string;
    address: string;
    postcode: string;
    refrigerant: string;
    units: {
      asset_no: number;
      sticker_code: string;
      role: "indoor" | "outdoor";
      indoor_type: string | null;
      manufacturer: string;
      model: string;
      location: string;
    }[];
  }[];
  visits: PortalVisit[];
  reports: {
    id: string;
    ref: string;
    rev: number;
    issued_at: string;
    type: string;
    date: string | null;
    site: string;
    path: string;
  }[];
  contracts: {
    name: string;
    start_date: string;
    end_date: string;
    visits_per_year: number;
    visit_type: string;
  }[];
  requests: PortalRequest[];
}

export interface Slot {
  day: string;
  part: "am" | "pm";
}

/** The business's side: who has access to a client's portal, and links not yet used. */
export interface PortalAccess {
  users: { user_id: string; email: string; created_at: string }[];
  invites: { code: string; email: string; created_at: string; expires_at: string }[];
}

export interface OpenRequest {
  id: string;
  client_id: string;
  system_id: string | null;
  kind: string;
  message: string;
  preferred: string;
  created_at: string;
  clients: { name: string } | null;
  systems: { name: string; site_postcode: string } | null;
}

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message);
};

export function portalApi(sb: SupabaseClient) {
  const notify = (body: Record<string, string>) =>
    void Promise.resolve()
      .then(() => sb.functions.invoke("portal-notify", { body }))
      .catch((e: unknown) => console.warn("Email not sent", e));

  return {
    // ---------- customers ----------
    async mine(): Promise<MyPortal[]> {
      const { data, error } = await sb.rpc("my_portals");
      fail(error);
      return (data ?? []) as MyPortal[];
    },
    async inviteInfo(code: string): Promise<{ orgName: string; clientName: string; email: string } | null> {
      const { data, error } = await sb.rpc("portal_invite_info", { p_code: code });
      fail(error);
      const row = (
        data as { valid: boolean; org_name: string; client_name: string; email: string }[] | null
      )?.[0];
      return row?.valid ? { orgName: row.org_name, clientName: row.client_name, email: row.email } : null;
    },
    async accept(code: string): Promise<string> {
      const { data, error } = await sb.rpc("accept_portal_invite", { p_code: code });
      fail(error);
      return data as string;
    },
    async overview(clientId: string): Promise<PortalOverview> {
      const { data, error } = await sb.rpc("portal_overview", { p_client: clientId });
      fail(error);
      return data as PortalOverview;
    },
    async slots(clientId: string): Promise<Slot[]> {
      const { data, error } = await sb.rpc("portal_slots", { p_client: clientId });
      fail(error);
      return (data ?? []) as Slot[];
    },
    async request(a: {
      clientId: string;
      systemId: string | null;
      kind: string;
      message: string;
      preferred: string;
      slot: Slot | null;
    }): Promise<{ request: string; job: string | null }> {
      const { data, error } = await sb.rpc("portal_request", {
        p_client: a.clientId,
        p_system: a.systemId,
        p_kind: a.kind,
        p_message: a.message,
        p_preferred: a.preferred,
        p_slot_date: a.slot?.day ?? null,
        p_slot_part: a.slot?.part ?? null,
      });
      fail(error);
      const out = data as { request: string; job: string | null };
      notify({ request: out.request });
      return out;
    },
    async respond(jobId: string, response: "accepted" | "change", note = ""): Promise<void> {
      const { error } = await sb.rpc("portal_respond", { p_job: jobId, p_response: response, p_note: note });
      fail(error);
    },
    async withdraw(requestId: string): Promise<void> {
      const { error } = await sb.rpc("portal_withdraw", { p_request: requestId });
      fail(error);
    },
    async reportUrl(path: string): Promise<string> {
      const { data, error } = await sb.storage.from("photos").createSignedUrl(path, 600);
      fail(error);
      return (data as { signedUrl: string }).signedUrl;
    },

    // ---------- the business ----------
    async access(clientId: string): Promise<PortalAccess> {
      const [u, i] = await Promise.all([
        sb
          .from("portal_users")
          .select("user_id, email, created_at")
          .eq("client_id", clientId)
          .order("created_at"),
        sb
          .from("portal_invites")
          .select("code, email, created_at, expires_at")
          .eq("client_id", clientId)
          .is("used_by", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at"),
      ]);
      fail(u.error);
      fail(i.error);
      return {
        users: (u.data ?? []) as PortalAccess["users"],
        invites: (i.data ?? []) as PortalAccess["invites"],
      };
    },
    async createInvite(clientId: string, email: string): Promise<string> {
      const { data, error } = await sb.rpc("create_portal_invite", { p_client: clientId, p_email: email });
      fail(error);
      return data as string;
    },
    async removeAccess(clientId: string, userId: string): Promise<void> {
      const { error } = await sb
        .from("portal_users")
        .delete()
        .eq("client_id", clientId)
        .eq("user_id", userId);
      fail(error);
    },
    async cancelInvite(code: string): Promise<void> {
      const { error } = await sb.from("portal_invites").delete().eq("code", code);
      fail(error);
    },
    async bookingSettings(orgId: string): Promise<{ self_booking: boolean; slots: number }> {
      const { data, error } = await sb
        .from("org_settings")
        .select("portal_self_booking, portal_slots_per_half")
        .eq("org_id", orgId)
        .maybeSingle();
      fail(error);
      const r = (data ?? {}) as { portal_self_booking?: boolean; portal_slots_per_half?: number };
      return { self_booking: !!r.portal_self_booking, slots: Number(r.portal_slots_per_half ?? 2) };
    },
    async saveBookingSettings(orgId: string, v: { self_booking: boolean; slots: number }): Promise<void> {
      const { data, error } = await sb
        .from("org_settings")
        .update({ portal_self_booking: v.self_booking, portal_slots_per_half: v.slots })
        .eq("org_id", orgId)
        .select("org_id");
      fail(error);
      if (Array.isArray(data) && data.length === 0) throw new Error("Only an owner can change this.");
    },
    async openRequests(orgId: string): Promise<OpenRequest[]> {
      const { data, error } = await sb
        .from("service_requests")
        .select(
          "id, client_id, system_id, kind, message, preferred, created_at, clients(name), systems(name, site_postcode)",
        )
        .eq("org_id", orgId)
        .eq("status", "requested")
        .order("created_at")
        .limit(50);
      fail(error);
      return (data ?? []) as never;
    },
    async decline(requestId: string, reply: string): Promise<void> {
      const { error } = await sb
        .from("service_requests")
        .update({ status: "declined", reply })
        .eq("id", requestId);
      fail(error);
    },
  };
}

export type PortalApi = ReturnType<typeof portalApi>;

/** "Tue 10 Nov, morning" */
export const slotLabel = (s: Slot) =>
  `${new Date(s.day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}, ${s.part === "am" ? "morning" : "afternoon"}`;

/** What a portal request becomes when it's booked. */
export const jobTypeFor = (kind: string) => (kind === "Service" ? "Annual service" : "Repair / breakdown");
