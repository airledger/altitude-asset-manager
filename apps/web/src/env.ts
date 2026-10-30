export interface AppEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/** Reads the build-time settings. Returns null when the app hasn't been pointed at a database yet. */
export function readEnv(source: Record<string, string | undefined> = import.meta.env): AppEnv | null {
  const supabaseUrl = source.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = source.VITE_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return { supabaseUrl, supabaseAnonKey };
}
