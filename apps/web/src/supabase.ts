import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readEnv } from "./env";

const env = readEnv();

export const supabase: SupabaseClient | null = env
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
