# Air Ledger (GitHub Pages + Supabase)

The Air Ledger app (formerly the Altitude Climate Asset Manager), adapted to run on GitHub Pages with Supabase for data and photos.

## Files
- `index.html`: the app
- `config.js`: your Supabase project URL and anon key
- `supabase-setup.sql`: run once in Supabase to create the table, sync and photo bucket
- `supabase-multi-business.sql`: run once after that to give each business its own private data, invites and logos
- `business.js`: sign-up, business set-up, company profile, team invites and account deletion
- `service-report.js`: signed PDF service reports (engineer and customer sign on screen; sent to the client and the office)
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
- Set the office address in Settings → Service reports.
