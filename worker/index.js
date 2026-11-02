// The beta site's Worker. Everything is static files from apps/web/dist except /cal/<token>.ics, the
// calendar links that Apple Calendar, Google Calendar and Outlook subscribe to. Those are built by the
// database (public.calendar_ics) and passed through here, so calendar apps get a plain .ics address.
const TOKEN = /^\/cal\/([0-9a-f-]{36})\.ics$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = TOKEN.exec(url.pathname);
    if (!match) return env.ASSETS.fetch(request);
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/calendar_ics`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_token: match[1], p_base: url.origin }),
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
  },
};
