// A stand-in for the Supabase client: canned table rows and RPC results, and a record of what the app asked for.
import type { SupabaseClient } from "@supabase/supabase-js";

type Call = { kind: "rpc" | "from" | "auth"; name: string; args?: unknown };

export function fakeSupabase(opts: {
  signedInAs?: { id: string; email: string };
  tables?: Record<string, unknown[]>;
  rpc?: Record<string, unknown>;
  /** RPCs that fail with this message. */
  rpcErrors?: Record<string, string>;
}) {
  const calls: Call[] = [];
  const session = opts.signedInAs ? { user: opts.signedInAs } : null;
  const result = (data: unknown) => Promise.resolve({ data, error: null });

  function query(table: string) {
    const chain: Record<string, unknown> = {};
    let one = false;
    let wrote = false;
    for (const m of [
      "select",
      "eq",
      "is",
      "in",
      "gt",
      "order",
      "delete",
      "insert",
      "update",
      "upsert",
      "limit",
      "single",
      "maybeSingle",
      "range",
    ])
      chain[m] = (...args: unknown[]) => {
        calls.push({ kind: "from", name: `${table}.${m}`, args });
        if (m === "single" || m === "maybeSingle") one = true;
        if (m === "insert" || m === "update" || m === "upsert") wrote = true;
        return chain;
      };
    const rows = () => opts.tables?.[table] ?? [];
    // Writes answer with a new id; single rows are the table's first row.
    chain.then = (ok: (v: unknown) => unknown) =>
      result(wrote ? { id: `new-${table}` } : one ? (rows()[0] ?? null) : rows()).then(ok);
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
      signOut: () => (calls.push({ kind: "auth", name: "signOut" }), result({})),
    },
    rpc: (name: string, args: unknown) => {
      calls.push({ kind: "rpc", name, args });
      const err = opts.rpcErrors?.[name];
      if (err) return Promise.resolve({ data: null, error: { message: err } });
      return result(opts.rpc?.[name] ?? null);
    },
    from: query,
    functions: {
      invoke: (name: string, args: unknown) => {
        calls.push({ kind: "rpc", name: `fn.${name}`, args });
        const err = opts.rpcErrors?.[`fn.${name}`];
        if (err) return Promise.resolve({ data: null, error: { message: err } });
        return result(opts.rpc?.[`fn.${name}`] ?? { id: "email-1" });
      },
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => (
          calls.push({ kind: "from", name: `storage.${bucket}.upload`, args: [path] }),
          result({})
        ),
        download: (path: string) => (
          calls.push({ kind: "from", name: `storage.${bucket}.download`, args: [path] }),
          result(new Blob(["%PDF-1.3"], { type: "application/pdf" }))
        ),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
        createSignedUrls: (paths: string[]) =>
          result(paths.map((path) => ({ path, signedUrl: `https://signed/${path}` }))),
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}
