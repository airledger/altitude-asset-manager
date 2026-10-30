# Supabase (rebuild)

- `migrations/`: every database change, in order. CI applies them to a fresh database on every pull request.
  After merging to `main`, **Update beta database** applies new ones to the beta project. Production is never
  changed by CI; it is migrated once, at cut-over (see `specs/REBUILD-PLAN.md`).
- `20261030120000_baseline_live_schema.sql` is today's live schema (the three `supabase-*.sql` files at the repo
  root, in the order they were run), so beta starts identical to production.
- `20261030190000_typed_tables.sql` adds the rebuild's typed tables beside `docs`: one per record in
  `specs/02-domain-model.md`, row-level security per `specs/04-tenancy-roles-security.md`, owner-only price and
  invoice tables, `reserve_stickers` and `create_invoice`, and an audit log. The live app doesn't use them yet.
- `tests/`: pgTAP permission tests (`supabase test db`), run by CI. They prove an engineer can't read prices,
  one business can't see another's records, signed-out users get nothing, and issued reports can't be changed.
- `functions/`: edge functions. `send-report` is still deployed by hand for the live app.

Local: `npx supabase db start` (needs Docker), then `npx supabase db reset --local` to replay migrations and
`npx supabase test db` to run the tests.
