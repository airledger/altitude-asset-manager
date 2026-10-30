# Air Ledger specifications

These documents describe what Air Ledger does today (as of 30 October 2026, `main` after PR #11) and how it should be rebuilt. They are the source of truth for the rebuild: if the new app behaves differently from a rule written here, either the app or this spec must change on purpose.

| File | What it covers |
|---|---|
| [00-overview.md](00-overview.md) | What the product is, who uses it, words we use |
| [01-current-architecture.md](01-current-architecture.md) | How the app is built today, and the problems a rebuild should fix |
| [02-domain-model.md](02-domain-model.md) | Records, fields and the calculation rules (F-gas, due dates, materials, invoice lines) |
| [03-features.md](03-features.md) | Every screen and action, with acceptance criteria |
| [04-tenancy-roles-security.md](04-tenancy-roles-security.md) | Businesses, owners and engineers, invites, data isolation, account deletion |
| [05-integrations.md](05-integrations.md) | Supabase, Resend email, Xero, QuickBooks and Sage, iCloud/Google/Outlook calendars, QR stickers, app stores |
| [06-non-functional.md](06-non-functional.md) | Offline use, performance, accessibility, privacy, compliance, browsers |
| [REBUILD-PLAN.md](REBUILD-PLAN.md) | The plan to rebuild Air Ledger to a high engineering standard, starting with a plain-English summary |

## Conventions
- "Must" is a requirement for the rebuild. "Should" is strongly preferred. "Today" describes current behaviour that may change.
- Money is GBP. Prices in the price list are ex VAT.
- No secrets belong in these files. Keys live in Supabase secrets or the hosting provider's settings.

## Work in flight when this was written
- PR #4: signed-out landing page (`landing.js`, `landing.css`). Open.
- PR #7: iPhone and Android apps through Capacitor, offline queue, native QR scanning, local reminders, privacy and support pages. Open; needs company details for the privacy policy, a support mailbox and a D-U-N-S number for Apple.
- Deferred: automatic invoice sync to Xero, QuickBooks and Sage (today it's CSV export).
- Being built in other threads (30 Oct 2026): calendar export to Google and Outlook, and Sage export. These specs describe the target either way.

Both open PRs are specified here as features, so the rebuild covers them whether or not they merge first.
