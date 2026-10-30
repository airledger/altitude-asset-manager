# 06 Non-functional requirements

## Devices and browsers
- Mobile first: engineers use phones on site, often one-handed, sometimes with gloves. Tap targets at least 44 px.
- Must work on the last two versions of iOS Safari, Chrome (Android and desktop), Edge and Firefox, plus the Capacitor iOS and Android apps.
- Installable as a web app (manifest, icons, theme colour `#0F2238`).

## Offline
- Plant rooms and loft spaces have no signal. An engineer must be able to open a booked job, complete it, take photos and capture signatures offline, and have it all sync when back online.
- Pending changes are visible and survive the app being closed.
- Conflicts are resolved per field, not per record, and the user is told when their change lost.
- Report PDF and email can wait until online; the job must still be marked complete offline.

## Performance
- First load on a mid-range phone over 4G: usable in under 3 seconds.
- Opening a unit from a QR scan: under 1 second once the app is loaded.
- Lists must stay fast with 10,000 units and 50,000 jobs per business: load what the screen needs (paged, filtered on the server), not everything.

## Reliability and data safety
- Separate **staging** and **production** Supabase projects. Nothing is tested on production.
- Daily backups with point-in-time recovery on production (Supabase Pro plan).
- Database changes only through versioned migrations, applied by CI.
- Errors reported to an error tracker (e.g. Sentry) with no personal data in the payload.
- Uptime monitoring on the app and edge functions.

## Accessibility
- WCAG 2.2 AA: labelled form fields, visible focus, keyboard reachable modals, colour contrast (the brand airflow cyan is not used for text on white), status not shown by colour alone (pills have words).

## Privacy and compliance (UK)
- UK GDPR: Air Ledger is a processor for each business's client data and a controller for user accounts. Needs a privacy policy, a data processing agreement for business customers, a record of sub-processors (Supabase, Resend, hosting, error tracker), and data held in the UK/EU (Supabase London, Resend Ireland).
- Right to erasure: account and business deletion (see 04). Exports: backup JSON.
- **F-gas**: records of leak checks, refrigerant added and recovered must be kept for at least 5 years. Deleting a job or system should be a soft delete for F-gas purposes, with permanent deletion only on business deletion.
- PECR: service reminder emails to individuals need an opt-out; `remindersOptIn` must be honoured and every server-sent reminder needs an unsubscribe link.
- VAT: rate is 20% today; store the rate on each invoice so a future change doesn't rewrite history.

## Maintainability
- TypeScript with strict mode, lint and format checks, all enforced in CI.
- Business rules in one tested package used by the app and server.
- Each feature in its own folder so parallel work doesn't collide.
- README for developers, and a short "how to release" runbook.

## Observability for the owner
- Every email sent, invoice exported and report issued is recorded with who and when, visible on the record.
