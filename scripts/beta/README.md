# Beta data

**Refresh beta data** (Actions tab → Refresh beta data → Run workflow) replaces everything in the beta project
with a copy of the live app's records and logins:

1. `export-production.sh` reads production inside a single read-only transaction (Postgres refuses any write).
2. `import-to-beta.sql` empties beta, loads the copy, then runs `scrub.sql`, which swaps client emails and phone
   numbers for dummies (`client-<id>@example.invalid`, `07700 900xxx`) and turns off automatic report emails.
3. If "demo" is ticked (the default), `demo-data.sql` adds made-up clients, installs, units, materials and jobs
   (ids starting `demo-` and stickers `AC-DMZ…`), dated relative to today so the dashboard has something to show.
   `demo-tables.sql` then copies them into the rebuild's typed tables, with made-up prices.
4. The copied files are deleted from the runner.

People sign in to beta with the same email and password as the live app. Photos and report PDFs aren't
copied. Anything done on beta is lost at the next refresh.

Needs secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROD_DB_PASSWORD` and `SUPABASE_BETA_DB_PASSWORD`.
