# Air Ledger (GitHub Pages + Supabase)

The Air Ledger app (formerly the Altitude Climate Asset Manager), adapted to run on GitHub Pages with Supabase for data and photos.

## Files
- `index.html`: the app
- `config.js`: your Supabase project URL and anon key
- `supabase-setup.sql`: run once in Supabase to create the table, sync and photo bucket
- `supabase-multi-business.sql`: run once after that to give each business its own private data, invites and logos
- `business.js`: sign-up, business set-up, company profile, team invites and account deletion
- `service-report.js`: signed PDF service reports (engineer and customer sign on screen; sent to the client and the office)
- `billing.js`: the owner-only price list, and draft invoices built automatically from completed jobs
- `calendar.js`: "Add to calendar" for iPhone/iCloud, Google Calendar and Outlook
- `supabase-pricing.sql`: run once after `supabase-multi-business.sql` so only owners can see prices and invoices
- `manifest.json`, `icon-*.png`, `favicon-32.png`, `logo-reverse.svg`: Air Ledger branding and "Add to Home Screen" support

## Supabase setup (once)
1. Create a project at supabase.com (region: London).
2. SQL Editor → New query → paste `supabase-setup.sql` → Run.
3. Authentication → Users → Add user → enter your email and a password (tick "Auto confirm").
4. Authentication → Sign In / Providers → turn off "Allow new users to sign up".
5. Project Settings → API: copy the Project URL and the anon public key into `config.js`.

## Moving data across from claude.ai
1. In the claude.ai app: Settings → Download full backup (JSON).
2. In this app: Settings → Restore from backup → choose that file.

Photos stay in the claude.ai version (the backup only holds their IDs), so older job photos won't show here.

## QR stickers
Stickers already printed point at the claude.ai link. Scanning them with the app's own Scan button still works because it reads the AC-XXXXX code. Scanning with the iPhone camera opens the claude.ai version until labels are reprinted.

## Other businesses (invite only)
Each business has its own private records, photos and logo; the database only shows people the businesses they belong to.
- Air Ledger admins create a code for a new business in Settings → Invite a new business, and send the link.
- The new user creates an account with the code, then fills in "Set up your business".
- Business owners invite their engineers from Settings → Team, and share their branded sign-in link (`?b=their-name`).
- Settings → Delete account removes a user's login, or a whole business with its records and photos.

To turn on: run `supabase-multi-business.sql`, then in Supabase Authentication turn on "Allow new users to sign up" and set the Site URL to the app's address.

## Service reports
When a job is completed the app asks the engineer, and the customer if they're there, to sign on screen. It then builds a PDF with the business's logo and details, the client and site, every unit's checks and readings, F-gas details, parts used, photos and both signatures.
- Each report gets a reference (`SR-YYMMDD-XXXX`, or `CR-` for installs) and a fingerprint of the record. If the job is edited afterwards, the job page says so and the report can be re-issued as a new revision.
- The PDF is stored with the job's photos. "Send report" shares it from a phone's share sheet, or opens an email to the client with the office copied and a download link that lasts a year.
- Set the business address that receives every report in Settings → Service reports → "Reports sent to". The engineer types the customer's email on the sign-off screen.

### Emailing reports automatically (once)
`supabase/functions/send-report` emails the PDF from reports@airledger.co.uk through Resend, with the client in To, the office in Cc and replies going to the business email.
1. Sign up at resend.com (the free plan allows 3,000 emails a month). Domains → Add domain → `airledger.co.uk`, region Ireland (eu-west-1).
2. Squarespace Domains → airledger.co.uk → DNS → Custom records: add the records Resend lists (a TXT at `resend._domainkey`, plus an MX and a TXT at `send`). They sit on their own names, so the Google Workspace email records stay as they are. Then press Verify in Resend.
3. Resend → API Keys → Create (sending access) and copy the key.
4. Supabase → Edge Functions → Secrets: add `RESEND_API_KEY` with that key.
5. Supabase → Edge Functions → Deploy a new function → Via editor: name it `send-report`, paste `supabase/functions/send-report/index.ts`, and deploy (leave "Verify JWT" on).
6. In the app: Settings → Service reports → fill in "Reports sent to" and tick "Email reports automatically when signed".

The function only sends a PDF from the signed-in user's own business folder, to at most 5 addresses.

## Prices, engineers and invoices
Owners set the price list in Settings → Price list, and part prices on the Materials page. Prices are kept in their own collection that only owners can read (`supabase-pricing.sql`), so an engineer's login never receives them.
- Invite engineers from Settings → Team. They see clients, assets, jobs and orders, but not prices, invoices or the Materials page.
- When booking a client in, set Billing to **Service plan** or **Out of contract**. For a plan, choose whether it's paid monthly/yearly outside Air Ledger or invoiced at the plan price each service.
- The engineer completes the job: checks, leak check, refrigerant, time on site, and the parts used (the service kit is filled in; they can add any item from Materials).
- The next time an owner has the app open, each newly completed job becomes a draft invoice. On a plan, the routine service, its leak check and the service kit are covered; repairs, call-outs, refrigerant and parts the engineer added are charged. Out of contract, everything is charged from the price list. A plan visit with nothing extra is marked "Covered by service plan" with no invoice.
