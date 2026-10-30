// A stand-in for the Supabase client: canned table rows and RPC results, and a record of what the app asked for.
import type { SupabaseClient } from "@supabase/supabase-js";

type Call = { kind: "rpc" | "from" | "auth"; name: string; args?: unknown };

export function fakeSupabase(opts: {
  signedInAs?: { id: string; email: string };
  tables?: Record<string, unknown[]>;
  rpc?: Record<string, unknown>;
}) {
  const calls: Call[] = [];
  const session = opts.signedInAs ? { user: opts.signedInAs } : null;
  const result = (data: unknown) => Promise.resolve({ data, error: null });

  function query(table: string) {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "gt", "order", "delete"])
      chain[m] = (...args: unknown[]) => {
        calls.push({ kind: "from", name: `${table}.${m}`, args });
        return chain;
      };
    chain.then = (ok: (v: unknown) => unknown) => result(opts.tables?.[table] ?? []).then(ok);
    return chain;
  }

  const client = {
    auth: {
      getSession: () => result({ session }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signInWithPassword: (args: unknown) => (calls.push({ kind: "auth", name: "signIn", args }), result({})),
      signUp: (args: unknown) => (
        calls.push({ kind: "auth", name: "signUp", args }),
        result({ session: null })
      ),
      resetPasswordForEmail: (email: string) => (
        calls.push({ kind: "auth", name: "reset", args: email }),
        result({})
      ),
      signOut: () => result({}),
    },
    rpc: (name: string, args: unknown) => {
      calls.push({ kind: "rpc", name, args });
      return result(opts.rpc?.[name] ?? null);
    },
    from: query,
    storage: {
      from: () => ({ upload: () => result({}), getPublicUrl: () => ({ data: { publicUrl: "" } }) }),
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}
