# 01 Current architecture (as built)

This describes `main` on 30 October 2026. It exists so the rebuild knows what it is replacing and why.

## Shape
- **Static site** on GitHub Pages at `app.airledger.co.uk` (`CNAME`), deployed on every merge to `main`. No build step.
- **`index.html`** (~1,400 lines): CSS, markup and one inline script holding state, rendering, routing, every screen, forms, invoices, exports, QR, calendar, zip writer and boot.
- **`business.js`**: sign-in, sign-up with invite codes, business set-up, company profile and logo, team invites, account and business deletion (`Biz`).
- **`service-report.js`**: sign-off pad, PDF build with jsPDF (loaded on demand), storage, email/share (`ServiceReport`).
- **`billing.js`**: owner-only price list, moving old prices out of shared records, drafting invoices from completed jobs (`Billing`).
- **`config.js`**: Supabase URL and public anon key (safe to publish; protection comes from sign-in and row-level security).
- **SQL files** pasted by hand into the Supabase SQL editor, in order: `supabase-setup.sql`, `supabase-multi-business.sql`, `supabase-pricing.sql`.
- **Edge function** `supabase/functions/send-report` (Deno) emails a stored PDF through Resend. Deployed by pasting into the Supabase dashboard.
- Third-party scripts from jsDelivr: supabase-js 2.45.4, qrcode-generator 1.4.4, jsQR 1.4.0, jspdf 2.5.1. Google Fonts (Sora, DM Sans, JetBrains Mono).

## Data storage
One generic table holds every business record:

```
docs (org_id uuid, col text, id text, data jsonb, updated_at timestamptz)  primary key (org_id, col, id)
```

`col` is one of `clients, systems, units, jobs, materials, invoices, reports, pricing, config`. `data` is the whole record as JSON. Supporting tables: `orgs, members, invites, platform_admins, platform`. Storage buckets: `photos` (private, `<org_id>/<file>`; also holds report PDFs) and `logos` (public).

## How the client works
1. Boot: create the Supabase client, get the session, resolve the business (`Biz.resolveOrg`), then **download every row for the business** in pages of 1,000 into an in-memory store.
2. Subscribe to Supabase Realtime for `docs` changes in that business and merge them in.
3. Every change re-renders the whole current page by building an HTML string and setting `innerHTML`. Buttons call global functions through inline `onclick`.
4. Saves are `upsert` of the **whole record** (`put(col, id, data)`), last write wins.
5. Routing is the URL hash: `#dashboard`, `#clients`, `#c-<id>`, `#s-<id>`, `#u-AC-XXXXX`, `#j-<id>`, `#i-<id>`, etc.
6. After every render, if the user is an owner, `Billing.tick()` moves legacy prices and drafts invoices for newly completed jobs.

## Problems a rebuild should fix
Ranked roughly by risk to the business.

### Correctness and data integrity
1. **Invoices are drafted by whichever owner's device happens to render next.** If no owner opens the app, nothing is drafted. Two owners online together can both draft the same job. Invoice numbers come from `nextInvoiceNo` in the settings record, read then written, so concurrent drafting can produce duplicate numbers.
2. **Last write wins on whole records.** Two people editing the same job (engineer completing it while the office edits notes) silently overwrite each other.
3. **No schema.** `data` is free JSON with no types, required fields, foreign keys or checks. A bad write (or an old backup restored) can store anything. Deleting a client doesn't protect jobs or invoices that point at it except by the UI checking first.
4. **Business rules live only in the browser** (F-gas intervals, due dates, invoice lines, plan cover). They can't be reused by a server job (reminder emails, accounting sync) and aren't tested.
5. **Settings defaults are Altitude Climate's** (`businessName`, `tradingAs`, `email`, `engineer`, `invoicePrefix "AC-"`). A new business that leaves a field blank prints Altitude's details on its stickers, reminders or reports.
6. **Report fingerprint is computed in the browser**, so it shows accidental edits but isn't evidence against deliberate ones.

### Security
7. **Engineers can write anything outside `pricing` and `invoices`**, including `config/settings` (business details, reminder templates, invoice prefix) and deleting clients, systems and jobs. The UI hides these, the database doesn't stop them.
8. Report download links are signed for **365 days** and sent by email.
9. Invite codes never expire. `send-report` allows any origin (CORS `*`); it relies on the user's token, which is fine, but should be narrowed.
10. Third-party scripts load from a CDN with no Subresource Integrity, on a page that holds a signed-in session.
11. Signatures, photos and report PDFs share one `photos` bucket with the same access rules, so any engineer in the business can overwrite or delete a signed report's files.

### Maintainability
12. One 1,400-line inline script with globals shared across four files. Features touch `index.html`, so parallel work conflicts.
13. No tests, no linting, no type checking, no CI on the web app (PR #7 adds an Android build action).
14. Database changes are hand-pasted SQL with no migration history; nothing records which scripts have run on which project. There is one Supabase project, used as production.
15. The edge function is deployed by pasting into the dashboard.
16. Compatibility code for older data (prices moving out of shared records, `hash2` report fingerprints, unfoldered photos) is mixed in with live logic.

### Performance and scale
17. Every device downloads the whole business on start and keeps it in memory. Fine for hundreds of records; slow for a business with thousands of jobs and years of history.
18. The whole page re-renders on every realtime change.
19. Photos are compressed in the browser (good) but listed through one signed URL request per photo.

## What works well and should be kept
- Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) as the backend, in the London region.
- Row-level security keyed on business membership, with security-definer helper functions.
- Owner-only prices kept in a separate place the engineer's login can't read.
- The calculation rules in [02-domain-model.md](02-domain-model.md): they encode real F-gas and trade knowledge.
- The plain, mobile-first UI and the Air Ledger brand (navy `#0F2238`, airflow `#3FC1D9`, Sora / DM Sans).
- Resend for transactional email from `reports@airledger.co.uk`.
- One codebase for website and app-store builds (Capacitor, PR #7).
