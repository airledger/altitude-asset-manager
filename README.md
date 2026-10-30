# Air Ledger (GitHub Pages + Supabase)

The Air Ledger app (formerly the Altitude Climate Asset Manager), adapted to run on GitHub Pages with Supabase for data and photos.

## Files
- `index.html`: the app
- `config.js`: your Supabase project URL and anon key
- `supabase-setup.sql`: run once in Supabase to create the table, sync and photo bucket
- `native.js`, `offline.js`: phone app features and offline support (see `mobile/README.md`)
- `privacy.html`, `support.html`, `legal.css`: privacy policy and support pages (needed for the app stores)
- `mobile/`: the iPhone and Android apps (Capacitor)
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
