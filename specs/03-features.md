# 03 Features and acceptance criteria

Each section lists what a user can do and the checks a rebuild must pass. "Owner" and "engineer" are defined in [04-tenancy-roles-security.md](04-tenancy-roles-security.md). Where a rule is a calculation, it lives in [02-domain-model.md](02-domain-model.md).

## F1 Signed-out pages
- **Landing page** (PR #4): hero with sign-in panel, feature sections, "Create your business account" buttons that start sign-up. Respects reduced motion; no horizontal scroll at 390 px.
- **Branded sign-in** `?b=<slug>`: shows the business's name and logo (public lookup by slug only).
- **Sign-up with invite** `?invite=<CODE>`: shows what the code is for (new business, or joining a named business) without revealing anything else.
- Sign-in with email and password. Password reset by email (missing today; must be added).

Acceptance: an unknown slug or used code shows a friendly message; nothing about other businesses is revealed.

## F2 Business set-up and switching
- After first sign-up with a new-business code, the user fills in "Set up your business" (name, phone, email, address, logo) and becomes its owner.
- A user who belongs to more than one business can switch between them; the last used one opens next time.
- Owners edit the company profile, upload a logo (shown on reports and branded sign-in), and choose the branded sign-in slug.

## F3 Team
- Owners create invite links for engineers, optionally locked to an email address. Engineers join as `member`.
- Owners see the team, remove members (not themselves), and make another member an owner.
- Air Ledger admins create codes for new businesses.

## F4 Dashboard
- KPI tiles: units on register (and systems), services needing action, overdue services, jobs booked in the next 14 days, jobs with parts to order, and (owners only) invoices waiting to export.
- Quick actions: new client, new install, book a job, export bookings to calendar, print blank stickers.
- Lists: jobs still open from earlier dates; service reminders (needs-action due statuses, soonest first, with Contact and Book buttons and a "Reminders off" tag); coming up (next 14 days); F-gas leak checks due within 60 days.

## F5 Clients
- Searchable list. Client page shows details, plan status, their systems and site records.
- Create, edit, delete. Delete is blocked while the client has systems.
- Owner-only fields: plan billing, plan price, name in accounts software.

## F6 Assets (systems and units)
- Assets page lists systems (or units) with search and due status.
- System page: client, site, F-gas summary (refrigerant, charge, CO₂e, leak check interval, last and next leak check), service due, warranty end, units, job history, contact log, site records, label printing.
- New install: choose client, fill system details, then add units one after another (manufacturer carried forward from the previous unit).
- Unit page: details, QR label, system summary, history. Opening `#u-AC-XXXXX` for an unregistered sticker offers to add it to an install.
- Delete system removes its units but keeps job history and invoices.

## F7 QR stickers and labels
- **Blank stickers**: 1–10 A4 sheets of 21 labels (Avery L7160, 63.5 × 38.1 mm), each with a new unique ID, QR code linking to `<appUrl>#u-<id>`, business name and an F-gas label box.
- **Unit labels**: printed for chosen units with make, model, serial, refrigerant, charge, GWP, CO₂e, install date, service due month and service phone.
- **Scan**: from the header, take a photo of a QR (decoded in the app) or type the ID. On native apps, live camera scanning (PR #7). Scanning to add a unit to an install rejects stickers already registered.
- Rebuild requirement: sticker IDs must be **reserved on the server** when printed, so two devices can't print the same ID, and must be unique across all businesses so a scan never opens the wrong business's unit.

## F8 Reminders and contact
- Contact a client from a due system: email and text built from templates, copy buttons, "Open in Mail", "Open Messages", "Call". Shows preferred method and opt-out.
- Log the contact (method, note) against the system; it drives the due status.
- Rebuild should add: sending reminder emails from the server (Resend) on a schedule, with unsubscribe, honouring `remindersOptIn`.

## F9 Jobs
- Jobs list filtered by Booked / Completed / Cancelled / All.
- Book or edit: system, type, engineer, date, time, duration, notes, and (owner only) a quoted price for installs. Smart defaults: an install for a new system, otherwise Annual service a week ahead, duration 0.5 + 0.5 h per indoor unit.
- "Start service" from a system opens the nearest booked job within 7 days, or creates one for today.
- Job page: visit details, site access notes, units, parts list, actions (complete, add to calendar, reschedule, mark parts ordered, cancel, re-open, delete when cancelled).
- **Complete job**: date, engineer, type, time on site; per-unit checks (pre-ticked for a new completion) and readings; leak check (method, result, refrigerant added and recovered, notes) or, for installs, commissioning (nitrogen test pressure, minutes, held; vacuum microns, decay held; pipe length; charge added; customer name; handover); parts used (service kit pre-filled, quantities editable, any material can be added and is marked "added"); engineer report; photos.
- On completion: installs update the system's install date, added charge and commissioned-by. Notes or photos create a site record. Sign-off opens.
- A completed job can be edited ("Edit record"), which may make the report out of date.

Acceptance: completing a job never shows a price to an engineer; the job moves to "waiting to be invoiced" exactly once.

## F10 Service reports
- Sign-off screen: engineer name, F-gas certificate number (remembered on the device), engineer signature, customer name and email, customer signature or "not available" with reason.
- PDF contents: business logo and details, report reference and revision, client and site, each unit's checks and readings, leak check or commissioning, F-gas details, parts used (no prices), engineer report, photos, both signatures, issue time, small Air Ledger credit.
- The PDF is stored with the job. If automatic email is on and there's a recipient, it's emailed through `send-report` with the customer in To, the office in Cc and replies to the business email. Otherwise a send dialog offers share (phones), download, or a mail link.
- Each send is logged on the report (via, to, when). The job card shows sends and whether the record changed since issue, and allows re-issue as a new revision.
- A customer email typed at sign-off is saved to the client if they had none.

## F11 Materials and orders
- Materials (owner only page): catalogue with supplier, code, quantity rule, when needed, in use; prices (cost, sell, chargeable) saved to the owner-only price list.
- Orders (everyone): parts for booked jobs in the next 7, 14, 30 or 60 days not yet ordered, grouped by supplier; copy as text, download CSV (with costs for owners only), mark all ordered, or per job. Marking ordered freezes the job's parts list.

## F12 Pricing and invoices (owner only)
- Price list in Settings. Part prices on Materials. Plan price per client. Quote per install job.
- Completed jobs become draft invoices automatically by the rules in 02. Plan visits with nothing extra show "Covered by service plan" with "Invoice anyway".
- Invoices list: Draft / Exported / All. Invoice page: lines, totals, VAT, client, job link; edit lines, delete (with a reminder to void in accounts if exported), mark not exported.
- Export: all unexported, or chosen ones, as Xero, QuickBooks or Sage CSV ([05-integrations.md](05-integrations.md)); exported invoices are marked with the date.
- Rebuild requirement: drafting must happen on the server once per job, with atomic per-business invoice numbers.

## F13 Calendar
- Export one job or all booked jobs to **iCloud, Google Calendar and Outlook** (added 30 Oct 2026). Today only iCloud is supported: an `.ics` file (zipped for iPhone Files import) with stable UIDs `<jobId>@altitude-climate` so re-imports update rather than duplicate.
- Google Calendar and Outlook (Outlook.com and Microsoft 365): a plain `.ics` download that imports into either, plus per-job "Add to Google Calendar" and "Add to Outlook" links that open the event pre-filled. The user picks their calendar app once in Settings and the export buttons follow it.
- Rebuild must add a private subscribable calendar feed URL per user (one `https://…/calendar/<token>.ics` that iCloud, Google and Outlook can all subscribe to), so bookings stay in sync without re-importing, and the token can be reset.

## F14 Settings, backup and records
- Owner: company details, service reports, reminders, invoices and accounts, Xero and QuickBooks fields, price list, team, branding, sign-in link.
- Engineer: sees business name and an explanation; can sign out and delete their account.
- Download full backup (JSON), restore from backup (owner only in the rebuild), F-gas register CSV, sign out.
- Delete account / delete business with typed confirmation (see 04).

## F15 Photos
- Add photos to jobs and site records; compressed on the device before upload; shown as thumbnails; open full size.

## F16 Mobile apps (PR #7)
- iOS and Android apps from the same web code via Capacitor, app ID `uk.co.airledger.app`.
- Native QR scanning, share sheet for exports, safe-area layout, 8am local notifications on days a system enters its reminder window, falls due, or needs a leak check.
- Works with no signal: last synced data cached per user, changes queued and sent when back online, with a banner showing pending changes. Cache cleared on sign-out (warn if unsynced).
- Privacy policy and support pages linked from Settings. In-app account deletion (required by both stores).
