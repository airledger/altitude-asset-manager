// Deletes a business, or the signed-in user's whole account, together with its stored files.
// The records go first, through the same database functions the app has always used (delete_business,
// delete_my_account), called with the user's own token so their checks still apply. Then every file under
// each deleted business's folder is removed with the service key, because issued reports are write-once
// and no signed-in user can delete them. App stores require in-app account deletion; this is it.
// Body: { "business": "<org id>" } to delete one business, or { "account": true } for the whole account.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every file path under a folder, walking sub-folders. */
async function filesUnder(admin: SupabaseClient, bucket: string, folder: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000, offset });
    if (error) throw error;
    for (const f of data ?? []) {
      const path = `${folder}/${f.name}`;
      if (f.id) out.push(path);
      else out.push(...(await filesUnder(admin, bucket, path)));
    }
    if (!data || data.length < 1000) return out;
  }
}

async function purge(admin: SupabaseClient, orgs: string[]): Promise<number> {
  let n = 0;
  for (const org of orgs)
    for (const bucket of ["photos", "logos"]) {
      const paths = await filesUnder(admin, bucket, org);
      for (let i = 0; i < paths.length; i += 500) {
        const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 500));
        if (error) throw error;
      }
      n += paths.length;
    }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return json({ error: "Please sign in again" }, 401);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  let orgs: string[];
  if (b.account === true) {
    const plan = await sb.rpc("account_deletion_plan");
    if (plan.error) return json({ error: plan.error.message }, 409);
    orgs = ((plan.data ?? []) as { org_id: string }[]).map((r) => r.org_id);
    const del = await sb.rpc("delete_my_account");
    if (del.error) return json({ error: del.error.message }, 409);
  } else if (typeof b.business === "string" && UUID.test(b.business)) {
    const del = await sb.rpc("delete_business", { p_org: b.business });
    if (del.error) return json({ error: del.error.message }, 403);
    orgs = [b.business];
  } else return json({ error: "Bad request" }, 400);

  try {
    return json({ deleted: orgs.length, files: await purge(admin, orgs) });
  } catch (e) {
    // The records are already gone; leftover files sit in a folder nobody can reach any more.
    console.error("File clean-up failed", orgs, e);
    return json({ deleted: orgs.length, files: null });
  }
});
