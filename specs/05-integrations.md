# 05 Integrations

## Supabase (project `txtdydgflwvzxjrfdbly`, London)
- **Postgres**: all records, with row-level security (see 04).
- **Auth**: email and password sign-in; sessions persisted on the device.
- **Storage**: `photos` (private; photos, signatures and report PDFs under `<org_id>/`), `logos` (public; `<org_id>/…`).
- **Realtime**: live updates between a user's phone and laptop and between team members.
- **Edge Functions**: `send-report` today. Rebuild adds functions for invoice drafting (or a database function), deletion, reminder emails and accounting sync.
- Public RPCs callable without sign-in: `org_public(slug)`, `invite_info(code)`. Everything else needs a signed-in user.

## Resend (email)
- Domain `airledger.co.uk` verified (DKIM `resend._domainkey`, MX and TXT at `send`), separate from Google Workspace mail records, which must not be touched.
- Sender `"<Business name>" <reports@airledger.co.uk>`, reply-to the business email.
- `send-report` contract (POST, user's token required):
  `{orgId, pdf (storage path under orgId/), filename, to[], cc[], subject, message, replyTo}` → `{id, sentBy}`. At most 5 recipients in total; addresses validated; the PDF is read with the user's own token so storage rules apply.
- Secrets: `RESEND_API_KEY`, optional `REPORT_FROM`. Never in the repo.
- Rebuild: also send auth emails, reminder emails and (later) invoice emails through Resend; handle bounces and complaints by webhook so a bad client email is flagged.

## Xero (CSV today)
One row per invoice line. Columns:
`*ContactName, EmailAddress, POAddressLine1–4, POCity, PORegion, POPostalCode, POCountry, *InvoiceNumber, Reference, *InvoiceDate, *DueDate, InventoryItemCode, *Description, *Quantity, *UnitAmount, Discount, *AccountCode, *TaxType, TrackingName1, TrackingOption1, TrackingName2, TrackingOption2, Currency, BrandingTheme`
- ContactName = client's name in accounts, else client name. Address lines split from billing address on commas and new lines. Country "United Kingdom".
- Dates `DD/MM/YYYY`. UnitAmount to 2 dp. TaxType = setting when VAT registered, else `No VAT`. Tracking from settings.

## QuickBooks Online UK (CSV today)
One row per line, grouped by invoice number. Columns:
`*InvoiceNo, *Customer, *InvoiceDate, *DueDate, Terms, Location, Memo, Item(Product/Service), ItemDescription, ItemQuantity, ItemRate, *ItemAmount, *ItemTaxCode, ItemTaxAmount, Currency, Service Date`
- Item = `qbItem` setting; TaxCode = `qbTaxCode` or `No VAT`; ItemAmount = round(qty × rate); ItemTaxAmount = round(amount × 0.2) when VAT; Currency GBP.

## Sage 50 (CSV today, PR #13)
Sage 50 audit trail import, chosen by `accountsApp = sage`. One `SI` (sales invoice) row per line. Columns:
`Type, Account Reference, Nominal A/C Ref, Department Code, Date, Reference, Details, Net Amount, Tax Code, Tax Amount, Exchange Rate, Extra Reference, User Name, Project Refn, Cost Code Refn`
- Account Reference = client's `sageRef`, else the first 8 letters and digits of the name in capitals (the app warns before exporting with a made-up one). Nominal from `sageNominal` (default 4000). Tax code `sageTaxCode` (T1) when VAT, else `sageNoVatCode` (T9).
- Details is the line description cut to 60 characters. Net Amount = round(qty × rate); Tax Amount = round(net × 0.2) when VAT. Extra Reference = invoice reference.
- Sage Business Cloud Accounting uses a different import and isn't supported yet.

All three exports have golden-file tests (`packages/domain/test/golden/`): a fixed set of invoices must produce byte-identical CSV to today's output.

## Automatic accounting sync (deferred, planned)
Lewis wants this later, for Xero, QuickBooks and Sage. Approach: register Intuit, Xero and Sage developer apps; OAuth connect per business from Settings; tokens stored encrypted server-side; an edge function pushes approved invoices and maps clients to contacts; status and errors shown on each invoice. The rebuild's invoice model must have `external_id`, `external_system` and `sync_status` fields from day one so this slots in.

## Calendar
- `.ics` with `Europe/London` timezone, event per job: summary `<type> – <client> (<postcode>)`, location, description with units, materials, notes, link to job; alarms 1 day and 1 hour before. UIDs `<jobId>@altitude-climate` (kept for continuity).
- Zipped for iPhone (Files → unzip → Add All).
- Google Calendar and Outlook: the same `.ics` imports into both (unzipped). Per-job links: Google `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=…&details=…&location=…&ctz=Europe/London`; Outlook `https://outlook.office.com/calendar/deeplink/compose?subject=…&startdt=…&enddt=…&body=…&location=…` (or `outlook.live.com` for personal accounts).
- Rebuild: subscribable feed (`webcal://` URL with a per-user secret token) served by an edge function; works for iCloud, Google ("From URL") and Outlook ("Subscribe from web"). Note Google refreshes subscribed feeds slowly (up to about a day).

## QR stickers
- Payload: `<appUrl>#u-AC-XXXXX`. The scanner also accepts a bare `AC-XXXXX` or old claude.ai links (it extracts the ID).
- Stickers printed before the move to app.airledger.co.uk point at the old claude.ai artifact; the app's own scanner still reads them. The rebuild must keep reading every past format.
- Rebuild: the URL should become `https://app.airledger.co.uk/u/AC-XXXXX` (a real path), with the hash form redirected.

## App stores (PR #7)
- Capacitor, app ID `uk.co.airledger.app`. Plugins: barcode scanner, local notifications, filesystem, share.
- Needs: Apple Developer (organisation, D-U-N-S), Google Play Console, privacy policy with company name, number and registered address, a support mailbox.

## Fonts and libraries
Google Fonts (Sora, DM Sans, JetBrains Mono). Rebuild: self-host fonts and bundle libraries (supabase-js, a QR generator, a QR decoder, a PDF library) so the app works offline and has no runtime third-party script loading.
