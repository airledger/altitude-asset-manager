# Supabase (rebuild)

- `migrations/`: every database change, in order. CI applies them to a fresh database on every pull request.
  After merging to `main`, **Update beta database** applies new ones to the beta project. Production is never
  changed by CI; it is migrated once, at cut-over (see `specs/REBUILD-PLAN.md`).
- `20261030120000_baseline_live_schema.sql` is today's live schema (the three `supabase-*.sql` files at the repo
  root, in the order they were run), so beta starts identical to production.
- `functions/`: edge functions. `send-report` is still deployed by hand for the live app.

Local: `npx supabase db start` (needs Docker), then `npx supabase db reset --local` to replay migrations.
