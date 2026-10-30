# 04 Businesses, roles and security

## Tenancy
- Every business record belongs to one business (`org`). A user sees only businesses they are a member of. This must be enforced by the database (row-level security), never only by the UI.
- A user can belong to several businesses, with one role in each.
- Files (photos, signatures, report PDFs) are stored under the business's folder and follow the same rule. Logos are public by design.
- Sign-up is **invite only** (Lewis's decision, 30 Oct 2026). The `platform.require_invite` switch exists in case that changes.

## Roles
| Capability | Owner | Engineer (`member`) | Air Ledger admin |
|---|---|---|---|
| Read clients, systems, units, jobs, materials (names, no prices), site records, orders | ✓ | ✓ | only as a member |
| Create and edit clients, systems, units, site records | ✓ | ✓ | |
| Book, edit, complete jobs; sign-off; send reports | ✓ | ✓ | |
| Delete clients, systems, jobs | ✓ | ✗ (rebuild: owner only) | |
| Read or change prices, quotes, plan prices, invoices | ✓ | ✗ | |
| Materials catalogue page | ✓ | ✗ | |
| Business settings, templates, branding, sign-in link | ✓ | ✗ (rebuild: enforced in the database) | |
| Invite engineers, remove members, make owner | ✓ | ✗ | |
| Restore from backup | ✓ | ✗ (rebuild) | |
| Delete the business | ✓ | ✗ | |
| Create new-business invite codes | | | ✓ |

Rebuild should consider a third role, **office/admin** (sees prices and invoices, can't delete the business), since owners often have office staff. Not required for parity.

## Price confidentiality
- Prices must never be sent to an engineer's device: not in records, not in API responses, not in PDFs, not in CSVs they can download.
- Today this is done by keeping prices in `pricing` and `invoices`, which only owners can read. The rebuild keeps the same principle with separate owner-only tables (or column-level privileges), and tests it.

## Invites
- New-business code: created by an Air Ledger admin; lets one person create one business.
- Team code: created by an owner; lets one person join that business as an engineer; optionally locked to an email address.
- Codes are single use. Rebuild: codes must expire (suggest 14 days), be revocable, and be at least 10 random characters.

## Account and business deletion (required by app stores)
- **Delete my account**: deletes the user's login. Businesses where they are the only member are deleted with all records and files. If they are the only owner of a business that has other members, deletion is refused until they make someone else owner or delete the business.
- **Delete business**: owner only; typed confirmation; removes all records, team, invites, photos, PDFs and logo.
- Rebuild: deletion should run on the server in one place (an edge function with the service role) so files and rows can't get out of step, and should be logged.

## Authentication
- Supabase Auth, email and password. Email confirmation needs custom SMTP (Supabase's built-in mailer only reaches team addresses), so the rebuild should send auth emails through Resend.
- Rebuild should add: password reset, optional magic link, session timeout on shared devices, and rate limiting on sign-in (Supabase default plus captcha if abused).

## Security requirements for the rebuild
1. Every table has RLS on, with tests that prove an engineer can't read prices, a member of business A can't read business B, and a signed-out user can only call the two public lookups.
2. Business logic that grants or moves value (invoice numbers, drafting, deletion, invite redemption) runs on the server.
3. Signed reports are immutable: once issued, the PDF and signatures can't be overwritten by the app's users; a new revision is a new file. Store them in a separate `reports` bucket with insert-only rules for members.
4. Report download links in emails last at most 30 days; the PDF is attached anyway.
5. Edge functions accept requests only from the app's origins and validate input with a schema.
6. No secrets in the repo. The public anon key is fine; the service role key, Resend key and any accounting tokens live in Supabase secrets.
7. Third-party code is bundled at build time with pinned versions (no runtime CDN), with dependency updates through Dependabot.
8. Content Security Policy on the hosted site.
9. An audit log of sensitive actions (prices changed, invoice exported or deleted, member removed, business deleted).
