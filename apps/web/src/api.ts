// Everything the app asks Supabase for. Screens call these, so tests can pass a fake client.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Role = "owner" | "member";

export interface Business {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  role: Role;
}

export interface Member {
  userId: string;
  email: string;
  role: Role;
  joined: string;
}

export interface Invite {
  code: string;
  email: string | null;
  createdAt: string;
  expiresAt: string;
}

/** Supabase errors come back as objects; turn them into a sentence for the screen. */
const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message);
};

export function api(sb: SupabaseClient) {
  return {
    async myBusinesses(userId: string): Promise<Business[]> {
      const { data, error } = await sb
        .from("members")
        .select("role, orgs(id, name, slug, logo_url)")
        .eq("user_id", userId);
      fail(error);
      type Row = {
        role: Role;
        orgs: { id: string; name: string; slug: string | null; logo_url: string | null } | null;
      };
      return ((data ?? []) as unknown as Row[])
        .flatMap(({ role, orgs: o }) =>
          o ? [{ id: o.id, name: o.name, slug: o.slug, logoUrl: o.logo_url, role }] : [],
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    /** Public: a business's name and logo for its branded sign-in link. */
    async brand(slug: string): Promise<{ name: string; logoUrl: string | null } | null> {
      const { data, error } = await sb.rpc("org_public", { p_slug: slug });
      fail(error);
      const row = (data as { name: string; logo_url: string | null }[] | null)?.[0];
      return row ? { name: row.name, logoUrl: row.logo_url } : null;
    },

    /** Public: what an invite code is for, without revealing anything else. */
    async inviteInfo(code: string): Promise<{ joins: boolean; businessName: string | null } | null> {
      const { data, error } = await sb.rpc("invite_info", { p_code: code });
      fail(error);
      const row = (data as { valid: boolean; joins: boolean; org_name: string | null }[] | null)?.[0];
      return row?.valid ? { joins: row.joins, businessName: row.org_name } : null;
    },

    async createBusiness(name: string, code: string | null): Promise<string> {
      const { data, error } = await sb.rpc("create_business", { p_name: name, p_code: code });
      fail(error);
      return data as string;
    },

    async joinBusiness(code: string): Promise<string> {
      const { data, error } = await sb.rpc("join_business", { p_code: code });
      fail(error);
      return data as string;
    },

    async updateBusiness(id: string, name: string, slug: string, logoUrl: string | null): Promise<string> {
      const { data, error } = await sb.rpc("update_business", {
        p_org: id,
        p_name: name,
        p_slug: slug,
        p_logo_url: logoUrl,
      });
      fail(error);
      return data as string;
    },

    async uploadLogo(orgId: string, file: File): Promise<string> {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${orgId}/logo-${Date.now()}.${ext}`;
      const { error } = await sb.storage
        .from("logos")
        .upload(path, file, { contentType: file.type, upsert: true });
      fail(error);
      return sb.storage.from("logos").getPublicUrl(path).data.publicUrl;
    },

    async team(orgId: string): Promise<Member[]> {
      const { data, error } = await sb
        .from("members")
        .select("user_id, email, role, created_at")
        .eq("org_id", orgId)
        .order("created_at");
      fail(error);
      return (
        (data ?? []) as { user_id: string; email: string | null; role: Role; created_at: string }[]
      ).map((m) => ({
        userId: m.user_id,
        email: m.email ?? "",
        role: m.role,
        joined: m.created_at,
      }));
    },

    async invites(orgId: string): Promise<Invite[]> {
      const { data, error } = await sb
        .from("invites")
        .select("code, email, created_at, expires_at")
        .eq("org_id", orgId)
        .is("used_by", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      fail(error);
      return (
        (data ?? []) as { code: string; email: string | null; created_at: string; expires_at: string }[]
      ).map((i) => ({
        code: i.code,
        email: i.email,
        createdAt: i.created_at,
        expiresAt: i.expires_at,
      }));
    },

    async createInvite(orgId: string, email: string): Promise<string> {
      const { data, error } = await sb.rpc("create_invite", { p_org: orgId, p_email: email || null });
      fail(error);
      return data as string;
    },

    async revokeInvite(code: string): Promise<void> {
      const { error } = await sb.from("invites").delete().eq("code", code);
      fail(error);
    },

    async removeMember(orgId: string, userId: string): Promise<void> {
      const { error } = await sb.from("members").delete().eq("org_id", orgId).eq("user_id", userId);
      fail(error);
    },

    async makeOwner(orgId: string, userId: string): Promise<void> {
      const { error } = await sb.rpc("make_owner", { p_org: orgId, p_user: userId });
      fail(error);
    },
  };
}

export type Api = ReturnType<typeof api>;
