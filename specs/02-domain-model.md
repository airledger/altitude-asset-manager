# 02 Domain model and rules

Field names below are today's JSON keys, so the data migration can map them. The rebuild should store them as typed columns (see the target schema in [REBUILD-PLAN.md](REBUILD-PLAN.md)). Every record belongs to exactly one business (`org_id`) and has `createdAt` / `updatedAt`.

## Records

### Business settings (`config/settings` today)
| Field | Type | Notes |
|---|---|---|
| businessName, tradingAs | text | Shown on stickers, reminders, reports. Must have **no Altitude defaults** in the rebuild. |
| phone, email, address, website, companyNo, vatNo | text | Company profile. `email` is the reply-to on report emails. |
| engineer | text | Default engineer name on new jobs. |
| fgasCert | text | Company F-gas certificate number, printed on reports. |
| appUrl | url | Base address for QR links. Blank = current address. |
| reportEmail | email | Office copy of every report. Blank = `email`. |
| autoEmailReports | bool | Email reports automatically when signed. |
| defaultInterval | int months | Default 12. |
| reminderLeadDays | int | Default 30. Start showing a system as due this many days before. |
| chaseAfterDays | int | Default 14. Chase if contacted this long ago without a booking. |
| warrantyYears | int | Default 5. |
| emailSubject, emailBody, smsBody | text | Reminder templates with placeholders `{contact} {client} {site} {dueDate} {units} {phone} {engineer} {business}`. |
| accountsApp | `xero` \| `quickbooks` \| `sage` | Chooses the CSV format. Sage added 30 Oct 2026. |
| vatRegistered | bool | Adds VAT at 20%. |
| invoicePrefix, nextInvoiceNo | text, int | Invoice numbering. Default `1001`. |
| paymentDays | int | Default 14. |
| accountCode, taxType, trackingName, trackingOption | text | Xero export fields. Defaults `200`, `20% (VAT on Income)`. |
| qbItem, qbTaxCode | text | QuickBooks export fields. Defaults `Services`, `20.0% S`. |

### Price list (owner only; `pricing/settings`)
`labourFirst` (95), `labourAdditional` (45), `labourHourly` (60), `leakCheckCharge` (40), `refrigerantPerKg` (60), `calloutCharge` (75). All £ ex VAT. Values in brackets are today's defaults and should become empty for new businesses.

Other owner-only price records: `mat:<materialId>` {cost, sell, chargeable}, `client:<clientId>` {planPrice}, `job:<jobId>` {quote}.

### Client (`clients`)
name (required), contactName, phone, email, preferredContact (`Email | Phone | Text message | WhatsApp`), billingAddress, postcode, servicePlan (`None` = out of contract, `Annual service plan`), planBilling (`separate` = paid outside Air Ledger, `visit` = invoice plan price each service; owner only), xeroContactName (owner only; name in accounts software), remindersOptIn (default true), notes.

### System / install (`systems`)
clientId (required), name (required), siteAddress, sitePostcode (default to client's billing address), installDate (required), commissionedBy, serviceIntervalMonths, warrantyYears, refrigerant (one of the table below or `Other`), gwp (only for Other), factoryChargeKg, addedChargeKg, hermetic (bool), leakDetection (bool), accessNotes, notes, inactive (bool), contactLog: list of {date, method, note}.

### Unit (`units`)
id = sticker ID `AC-XXXXX` (5 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, unique within the business). systemId, role (`outdoor | indoor`), indoorType (`Wall mounted | Cassette | Ducted | Floor console | Ceiling suspended | Other`), manufacturer, model, serial, capacityKw, location, filterType (`Washable | Replaceable | None`), controller (`Wireless remote | Wired controller | Wi-Fi / app | None`), condensatePump (bool), sticker (bool: registered from a pre-printed sticker), notes. Indoor-only fields are cleared for outdoor units.

### Job (`jobs`)
systemId, type (`Annual service | Service + repair | Leak check | Repair / breakdown | Installation | Commissioning | Survey`), status (`booked | completed | cancelled`), date, time, durationHrs, engineer, notes (for the engineer), quote (owner only, installs), materialsOrdered (bool), materialsSnapshot (parts list frozen when ordered).

On completion: completedAt, unitChecks {unitId: {check flags, offCoil, onCoil, amps, pressure, notes}}, leakCheck {performed, method, result `pass|fail`, addedKg, recoveredKg, notes}, commissioning (installs) {pressureBar, pressureMins, pressureHeld, vacuumMicrons, decayHeld, pipeM, addedKg, customerName, handover}, materialsUsed [{id, name, sku, supplier, qty, extra}], completionNotes, signoff {engineerName, engineerCert, engineerSig (file), customerName, clientEmail, customerAbsent, absentNote, customerSig (file), signedAt}, serviceReports [{ref, rev, issuedAt, hash, pdf (file), sent [{via, to, at}]}].

Billing state: toInvoice (completed, waiting to be priced), invoiceId, billing (`plan` covered, `plan-extras`, `charged`).

Service checks: filters, coil, drain, fan, electrical, operation. Install checks: mounted, pipework, drain, electrical, operation, sticker, handoverU. Outdoor units skip filters, drain and handoverU.

### Material (`materials`)
name (required), supplier, sku, appliesTo (see quantity rule), qtyPer (default 1, may be fractional), when (`service | leak | any | pick`), active (default true). Prices live in the price list.

### Invoice (`invoices`, owner only)
clientId, jobId, number, date, dueDate, reference, lines [{desc, qty, unit}], vat (bool), status (`draft | exported`), exportedAt, auto (bool: drafted from a job).

### Site record (`reports`)
systemId, unitId (optional: blank = whole system), jobId (optional), kind (`Service report | Install / commissioning report | Site note | Defect / remedial | Customer request | Photos`), date, author, text, photos [file ids]. Must have text or at least one photo.

## Rules

### Refrigerants and GWP
`R32 675, R410A 2088, R454B 466, R452B 698, R290 3, R407C 1774, R134a 1430, R513A 631, R1234ze 7, R744 1, R22 1810`. `Other` uses the system's own `gwp`.

### F-gas leak check interval
```
kg     = factoryChargeKg + addedChargeKg
tCO2e  = kg × GWP ÷ 1000
threshold = 10 if hermetic else 5
months = 3 if tCO2e ≥ 500; 6 if ≥ 50; 12 if ≥ threshold; otherwise not required
if leakDetection and months: months × 2
```
Next leak check = (last completed job with `leakCheck.performed`, else installDate) + months.

### Service due
- Interval = system's `serviceIntervalMonths`, else `defaultInterval`, else 12.
- Base = date of the last completed job whose type is `Annual service` or `Service + repair`, else installDate.
- Next due = base + interval months. Month addition clamps to the last day of the month (31 Jan + 1 month = 28/29 Feb).
- Warranty end = installDate + warrantyYears (system, else default).

### Due status (first match wins)
1. inactive → **Inactive** (grey)
2. no next due date → **No install date** (grey)
3. a booked service job exists → **Booked <date>** (green)
4. days until due > reminderLeadDays → **Due <date>** (grey)
5. a contact is logged this cycle (on or after the base date, and within 120 days before due): if days since contact ≥ chaseAfterDays → **Chase** (amber, needs action), else **Contacted <date>**
6. overdue → **Overdue Nd – contact** (red, needs action)
7. otherwise → **Due in Nd** / **Due today** (amber, needs action)

### Materials needed for a job
For each active material:
- skip if `when = service` and the job type isn't a service type; if `when = leak` and no leak check is due (job is a Leak check, or the next leak check is on or before job date + 31 days); always skip `pick`.
- count by `appliesTo`: visit = 1; indoor; outdoor; wall / cassette / ducted / console = indoor units of that type; pump = units with a condensate pump; filter = indoor units with replaceable filters; remote = indoor units with a wireless remote (blank counts as wireless).
- qty = ceil(count × qtyPer). Skip if count is 0.

A job's parts list is: the frozen snapshot if parts are marked ordered, else `materialsUsed` if completed, else the calculated list. Orders aggregate booked, not-yet-ordered jobs in the next N days (default 14) by supplier.

### Invoice lines from a completed job
Let `covered` = client is on a service plan **and** the job is a service type or Leak check. `nInd` = max(1, indoor units).
1. covered, plan billed per visit, plan price set → one line: plan service (or leak check) at the plan price.
2. Service types, not covered → `labourFirst` × 1, plus `labourAdditional` × (nInd − 1). `Service + repair` with hours → plus one `labourHourly` line.
3. Leak check, not covered → `leakCheckCharge`.
4. Repair / breakdown → `calloutCharge`, plus `labourHourly` × max(0, hours − 1).
5. Installation / Commissioning with a quote → one line at the quote.
6. Anything else → `labourHourly` × (hours or 1).
7. Service type, not covered, F-gas leak check required and performed → `leakCheckCharge`.
8. Refrigerant added → `refrigerantPerKg` × kg added.
9. Each part used with qty > 0 that is chargeable → sell price × qty, except parts in the service kit when covered (engineer-added extras are still charged).

Unit prices are rounded to pence. Totals: net = Σ round(qty × unit); VAT = round(net × 0.2) if VAT registered; gross = net + VAT.

If there are no lines, the job is marked **Covered by service plan** and no invoice is made. Otherwise a draft invoice gets the next number, date today, due date + paymentDays, reference `<job type> <site postcode>`.

### Service report
- Reference `SR-YYMMDD-XXXX` (installs `CR-`), revision starts at 1; re-issuing keeps the reference and adds a revision.
- Fingerprint: SHA-256 of a stable JSON of the job (minus report and billing fields), key system fields, client contact fields, units and job site records. If the current fingerprint differs from the latest report's, the job page says the record has changed since the report.
- Engineer signature required. Customer signature required unless "customer not available" with a reason.

### Identifiers today
Clients `c` + 9 random, systems `s…`, jobs `j…`, materials `m…`, reports `r…`, invoices for jobs `i<jobId>`. The rebuild should use UUIDs internally and keep `AC-XXXXX` and report references as human-facing codes.
