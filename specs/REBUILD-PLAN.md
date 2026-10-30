# Air Ledger rebuild plan

## In plain English

Air Ledger works today, and the features are right. What isn't right yet is how it's built underneath. It grew quickly as one big web page, and that's fine for one business but risky for a product other businesses pay for and trust with their records.

The main risks today:
- **Invoices are made by whoever's phone happens to open the app.** If two owners are online at once, the same job could be invoiced twice or two invoices could get the same number.
- **Two people editing the same job can overwrite each other** without anyone knowing.
- **The database trusts the app to behave.** An engineer's login is blocked from prices, but not from changing business settings or deleting clients. The app hides those buttons; the database doesn't stop them.
- **Nothing is automatically tested**, and there's only one database, which is the live one. Every change is tested on real data.
- **New businesses can inherit Altitude Climate's details** if they leave a settings field blank.

The rebuild keeps everything you and your engineers see and do, and the same Supabase account and data, but rebuilds the inside properly:
1. **A proper database layout** with real tables for clients, systems, units, jobs and invoices, instead of one table of loose records. The database itself enforces who can see and change what.
2. **The important sums happen on the server**: invoice drafting and numbering, F-gas intervals and due dates are worked out in one place, once, and tested.
3. **Automatic tests** for every rule in these specs (F-gas, due dates, invoice lines, CSV exports, who can see prices), run on every change before it can go live.
4. **A test copy of Air Ledger** (staging) to try changes on before they reach real customers, plus daily backups of the live data.
5. **Works properly offline** for engineers in plant rooms, with changes synced when signal comes back.
6. **Ready for what's next**: calendar export to iCloud, Google and Outlook, Sage alongside Xero and QuickBooks, automatic accounting sync, reminder emails sent for you, and the app store apps.

**How long:** roughly 14 to 18 weeks of build work done in stages, with the current app staying live and in use the whole time. You switch over once the new one matches the old one feature for feature and your data has been copied across and checked.

**What it costs to run:** Supabase Pro (about $25 a month) for daily backups and a staging copy; everything else stays on free or low tiers until you have more customers.

**You can test it as it's built** (Lewis's condition, agreed 30 Oct 2026). From the first stage there is a separate test address, `beta.airledger.co.uk`, running the new app against its own test database filled with a copy of your real records. You use it on your phone alongside the live app, and nothing you do there touches live data. Every change also gets its own preview link before it goes in, so you can try it first.

**What we need from you:** a few decisions (listed at the end), keeping new features on the old app to a minimum during the rebuild, and testing each stage on your phone when it's ready.

---

## Goals
1. Feature parity with [03-features.md](03-features.md), including PRs #4 and #7.
2. Every rule in [02-domain-model.md](02-domain-model.md) implemented once, typed and tested.
3. Security enforced by the database and server, proven by tests ([04](04-tenancy-roles-security.md)).
4. Safe delivery: CI, staging, migrations, preview builds, backups, monitoring ([06](06-non-functional.md)).
5. A codebase several people (or Claude threads) can change in parallel without stepping on each other.

Non-goals for the rebuild: a visual redesign (keep the brand and layout), automatic accounting sync (designed for, built after), new pricing models.

## Target architecture

```
              ┌──────────────── apps/web (React + TypeScript + Vite, PWA) ───────────────┐
 Phones,      │  features/clients  features/assets  features/jobs  features/invoices …  │
 laptops ───▶ │  data layer: TanStack Query + local store (IndexedDB) + outbox for offline│
 iOS/Android  └──────────────────────────────────┬──────────────────────────────────────┘
 (Capacitor wraps the same build)                │ supabase-js (typed, generated)
                                                 ▼
 ┌──────────────────────────────── Supabase (London) ───────────────────────────────────┐
 │ Postgres: typed tables, RLS, SQL functions (invoice drafting + numbering, deletion)  │
 │ Storage: photos (private), reports (insert-only), logos (public)                     │
 │ Edge Functions: send-report, send-reminders (cron), calendar-feed, delete-account,   │
 │                 accounting-sync (later)                                              │
 │ Auth (emails via Resend SMTP)                                                        │
 └──────────────────────────────────────────────────────────────────────────────────────┘
 packages/domain: pure TypeScript rules (F-gas, due status, materials, invoice lines,
                  CSV exports) shared by the web app and edge functions
```

### Choices and why
| Area | Choice | Why |
|---|---|---|
| Language | TypeScript, strict | Catches mistakes before they ship; types generated from the database. |
| UI | React + Vite | The most widely known stack, so any developer (or Claude) can work on it; fast builds; good Capacitor support. |
| Data fetching | TanStack Query with persisted cache | Caching, background refresh and offline persistence without hand-written sync code. |
| Offline writes | Outbox of typed mutations in IndexedDB, replayed in order, per-field patches with `updated_at` checks | Simple, testable; avoids a heavy sync engine. Revisit PowerSync if conflicts become common. |
| Forms and validation | React Hook Form + Zod | One schema validates in the browser and in edge functions. |
| Styling | CSS variables from the brand book + CSS Modules | Keeps the current look; no runtime CSS library. |
| Backend | Keep Supabase | Data is already there, RLS model is sound, London region. |
| Schema changes | Supabase CLI migrations in `supabase/migrations`, applied by CI | History of every change; same on staging and production. |
| Database tests | pgTAP | Proves the RLS rules (engineer can't read prices, business A can't read B). |
| Unit tests | Vitest | Domain rules and components. |
| End-to-end tests | Playwright | Real flows on staging: sign up, add install, complete job offline, sign, invoice, export. |
| PDF | pdf-lib in an edge function, from the stored record | Reports built from what's in the database, consistent on every device, stored write-once. |
| Hosting | Cloudflare Pages (or keep GitHub Pages) | Free; preview URL for every pull request so Lewis can try changes before merging. |
| Errors | Sentry (free tier) | Know about crashes before customers say. |
| Mobile | Capacitor 8, as in PR #7 | Same code for web and stores. |

### Repository layout
```
apps/web/                 React app (also bundled by Capacitor)
apps/mobile/              Capacitor config, iOS and Android projects
packages/domain/          rules + tests (no UI, no network)
packages/db-types/        generated Supabase types
supabase/migrations/      SQL migrations
supabase/tests/           pgTAP tests
supabase/functions/       edge functions (Deno), each with tests
specs/                    these documents
legacy/                   today's app, kept read-only until cut-over
.github/workflows/        CI: lint, typecheck, unit, db tests, e2e, deploy
```

## Target database (summary)
Typed tables, all with `org_id`, `created_at`, `updated_at`, `created_by`, `deleted_at` (soft delete), and RLS by membership.

- `orgs`, `members (role: owner | engineer [| office])`, `invites (expires_at, revoked_at)`, `platform_admins`, `platform`
- `org_settings` (one row per org; profile, reminders, report and export settings; **no Altitude defaults**)
- `clients`, `systems`, `units (sticker_code unique globally)`, `sticker_reservations`
- `contact_logs`, `jobs`, `job_unit_checks`, `job_leak_checks`, `job_commissioning`, `job_parts`
- `site_records`, `files` (metadata for every stored file: kind, path, checksum)
- `service_reports (ref, rev, hash, pdf_file_id, issued_at, issued_by)`, `report_sends`
- `materials` (no prices)
- Owner-only: `price_list`, `material_prices`, `client_plan_prices`, `job_quotes`, `invoices (number unique per org, vat_rate, status, external_id, external_system, sync_status)`, `invoice_lines`, `invoice_counters`
- `audit_log`

Key server functions: `complete_job(job_id, payload)` (validates, saves, queues invoicing), `draft_invoice(job_id)` (idempotent, locks the counter row, uses `packages/domain` rules ported to SQL or called from an edge function), `reserve_stickers(n)`, `delete_account()`, `delete_business(org_id)`.

The engineer-vs-owner split stays as separate owner-only tables, so prices can never leak through a query an engineer can run.

## Delivery stages
Each stage ends with something Lewis can try on a staging link, and a pull request reviewed and merged. Estimates assume one developer (or Claude thread) working steadily; they overlap where noted.

| # | Stage | What's done at the end | Weeks |
|---|---|---|---|
| 0 | **Foundations** | `beta.airledger.co.uk` + staging database with a copy of real data for Lewis to test on, new repo layout, CI (lint, typecheck, tests), staging Supabase project, migrations tooling, preview deploys, Sentry, decisions below made. Current app moved to `legacy/` and still deployed as-is. | 1 |
| 1 | **Domain rules** | `packages/domain` with every rule in spec 02, and golden tests generated by running today's functions over a copy of real data (anonymised) so new = old. CSV golden files. | 1–2 |
| 2 | **Database** | Typed schema, RLS, server functions, pgTAP tests for every permission in spec 04, seed data for staging. | 2 |
| 3 | **Shell, sign-in, businesses, team** | App shell and navigation, landing page (port PR #4), sign-in, invite sign-up, business set-up, switching, team, branding, password reset, auth emails via Resend. | 1–2 |
| 4 | **Clients, assets, QR** | Clients, systems, units, labels, blank stickers with server reservation, scanning (photo and typed), site records, photos. | 2 |
| 5 | **Jobs, dashboard, orders, offline** | Booking, completion, materials, orders, dashboard, reminders and contact log, calendar export (iCloud, Google, Outlook), offline outbox. | 2–3 |
| 6 | **Service reports** | Sign-off, server-built PDF, write-once storage, send-report v2, revisions, send log. | 1–2 |
| 7 | **Pricing and invoices** | Price list, plan pricing, server-side drafting and numbering, invoice editing, Xero, QuickBooks and Sage CSV, audit log. | 2 |
| 8 | **Mobile apps** | Port PR #7 to the new app: Capacitor, native scan, notifications, share, privacy and support pages, account deletion. | 1 |
| 9 | **Migration and cut-over** | Migration script from `docs` to typed tables, dry runs on staging, parallel running for a week, switch, keep the old data read-only. | 1 |

Total: about 14–18 weeks. Stages 3 and 4 can run alongside stage 2 once the schema is agreed; stage 8 alongside 6–7.

After cut-over, the next features in order: server reminder emails (F8), calendar feed for iCloud/Google/Outlook (F13), automatic Xero/QuickBooks/Sage sync, office role.

## How Lewis tests the rebuild while it happens
Lewis has agreed to the rebuild on condition that he can test it throughout. This is part of the plan, not an extra:
- **Stage 0 sets it up first**: a staging Supabase project and `beta.airledger.co.uk` (a DNS record Lewis adds once at Squarespace, like the `app` one). The live app at `app.airledger.co.uk` is untouched.
- **Real data, safely**: staging is refreshed from a copy of production on request (with client emails and phone numbers swapped for test ones, so no real customer gets a reminder or report from the test app). Report emails from staging go to Lewis only.
- **Preview link per change**: every pull request builds its own preview against staging. Lewis tries it, then it merges into beta.
- **Each stage ends with a short test script** (5–10 steps in plain English, e.g. "scan a sticker, complete the job offline, sign, check the invoice") posted in the thread, plus a side-by-side check that the new app gives the same due dates, F-gas intervals and invoice totals as the live one.
- **Engineers can join beta** with their own logins once stage 5 lands, so offline use is tested on real sites.
- Nothing switches over until Lewis has signed off the final side-by-side week.

## Data migration
1. Freeze schema of the old app (no new fields) once stage 2 starts.
2. Write `migrate_docs_to_tables.sql`, idempotent, mapping each `docs` collection to its tables per the field list in spec 02. IDs: keep old IDs in a `legacy_id` column; unit sticker codes stay as they are.
3. Copy production into staging, run the migration, run checks: record counts per business, every unit links to a system, every job to a system, every invoice total matches, F-gas next-due dates and due statuses match the old app's for every system, sample report PDFs still download.
4. Lewis and one engineer use staging for a week on real (copied) data.
5. Cut-over in a quiet window: put the old app in read-only mode, take a backup, run the migration on production, point `app.airledger.co.uk` at the new build, smoke test.
6. Rollback: the old `docs` table is untouched; switching the domain back restores the old app. Keep it for 90 days, then archive.
7. Old QR stickers keep working: the new app accepts `#u-AC-XXXXX`, `/u/AC-XXXXX`, bare codes and old claude.ai links.

## Quality bar (definition of done for every pull request)
- Typecheck, lint and all tests pass in CI.
- New rules have unit tests; new permissions have pgTAP tests; new flows have a Playwright test.
- Preview link posted for Lewis to try.
- No secrets, no prices in engineer-visible paths, no hard-coded business details.
- Migrations reversible or with a documented rollback.
- Spec updated if behaviour changed.

## Risks
| Risk | Mitigation |
|---|---|
| New app behaves differently from the old on a rule | Golden tests built from today's code and real data; side-by-side week on staging. |
| Feature work on the old app during the rebuild | Freeze to bug fixes only; any must-have goes into the specs and the new app first. |
| Offline sync conflicts | Per-field patches, server timestamps, visible conflict messages; Playwright tests with network off. |
| Migration loses or mangles data | Idempotent script, counts and checksums, dry runs, untouched old table, rollback by DNS. |
| App store review delays | Submit the old-app build from PR #7 now if needed; the new build replaces it later under the same app ID. |
| Cost creep | Supabase Pro is the only new fixed cost; others on free tiers until there are paying customers. |

## Decisions for Lewis
1. ~~Rebuild in stages with the old app live~~ **Decided 30 Oct 2026:** go ahead, staged, with Lewis testing on beta throughout.
2. **Freeze new features on the old app** during the rebuild, apart from bug fixes. Recommended.
3. **Upgrade Supabase to Pro** (about $25/month) for daily backups and a staging project. Recommended before more businesses join.
4. **PR #4 (landing page)**: merge now; it's self-contained and will be ported. **PR #7 (apps)**: merge now if you want to start store submission; otherwise wait for stage 8.
5. **Hosting**: move to Cloudflare Pages for preview links on every change (recommended), or stay on GitHub Pages.
6. **Engineers deleting records**: rebuild makes deleting clients, systems and jobs owner-only. Confirm that's what you want.
