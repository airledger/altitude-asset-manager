import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readEnv } from "./env";
import { cachingFetch } from "./offline";

const env = readEnv();

export const supabase: SupabaseClient | null = env
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
      // Reads are kept on the device so the app still works with no signal (offline.ts).
      global: { fetch: cachingFetch() },
    })
  : null;
