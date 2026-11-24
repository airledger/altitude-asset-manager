// Calendar links (/functions/v1/calendar/<token>.ics) that Apple Calendar, Google Calendar and Outlook
// subscribe to. The live app is plain static files on GitHub Pages, which can't answer /cal/<token>.ics like
// the beta site's Worker does, so the live app's links point here instead. The database builds the calendar
// (public.calendar_ics, which anyone holding the private token may call); this only passes it through.
// Deployed with --no-verify-jwt: calendar apps can't send a sign-in.
const TOKEN = /\/([0-9a-f-]{36})(\.ics)?$/i;

Deno.serve(async (req) => {
  const match = TOKEN.exec(new URL(req.url).pathname);
  if (!match || (req.method !== "GET" && req.method !== "HEAD"))
    return new Response("Calendar not found", { status: 404 });
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/calendar_ics`, {
    method: "POST",
    headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", "content-type": "application/json" },
    body: JSON.stringify({ p_token: match[1], p_base: Deno.env.get("APP_URL") || "https://app.airledger.co.uk" }),
  });
  const ics = res.ok ? await res.json() : null;
  if (typeof ics !== "string") return new Response("Calendar not found", { status: 404 });
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="air-ledger.ics"',
      "cache-control": "private, max-age=300",
    },
  });
});
