# 00 Overview

## What Air Ledger is
Air Ledger is an asset register and job manager for small air conditioning businesses in the UK. It keeps a record of every AC system and unit a business looks after, tells the business when each one is due a service or an F-gas leak check, lets engineers complete jobs on site and get a signed report, and turns completed jobs into invoices for Xero or QuickBooks.

It started as Altitude Climate's own tool (Lewis, Altitude Electrical) and now supports other businesses by invitation.

## Who uses it
| Person | What they need |
|---|---|
| **Business owner** (role `owner`) | Everything: clients, assets, jobs, prices, invoices, settings, team, branding. Usually also an engineer. |
| **Engineer** (role `member`) | Clients, assets, jobs, orders, reports. Records work and parts. Never sees prices or invoices. |
| **Customer** (not a user) | Receives reminders and signed service reports by email. May sign on the engineer's device. |
| **Air Ledger admin** (platform admin) | Creates invite codes for new businesses. Today that's Lewis. |

## The main loop
1. Add a **client**, then an **install** (system) at a site, then its **units** (outdoor and indoor), each with a QR sticker `AC-XXXXX`.
2. The dashboard shows systems coming due for service and leak checks. The owner contacts the client (email or text template) and logs the contact.
3. Book a **job**. Parts the job needs are worked out from the materials list; the **Orders** page groups them by supplier.
4. On site the engineer scans the sticker, completes the job (checks and readings per unit, leak check, refrigerant, time, parts used), and the engineer and customer sign.
5. A **service report** PDF is built, stored, and emailed to the customer with the office copied.
6. The owner's app turns the completed job into a **draft invoice** (or marks it "covered by service plan"). Invoices are exported as a CSV for Xero or QuickBooks.

## Glossary
| Term | Meaning |
|---|---|
| Business / org | A company using Air Ledger. All records belong to one business. |
| Client | A customer of the business (person or company), with billing details and plan status. |
| System / install | One AC installation at a site: refrigerant, charge, install date, service interval. Called "install" in the UI. |
| Unit | A physical outdoor or indoor unit belonging to a system, identified by its sticker ID `AC-XXXXX`. |
| Job | A booked or completed visit to a system: service, repair, leak check, install, commissioning or survey. |
| Report (site record) | A note or photo set attached to a client, system, unit or job (site note, defect, customer request, photos). |
| Service report | The signed PDF produced when a job is completed, with reference `SR-YYMMDD-XXXX` (or `CR-` for installs). |
| Material | A catalogue item (filters, cleaner, pumps…) with a rule for how many each job needs. |
| Service plan | A client on a fixed-price plan; routine visits are covered. Otherwise "out of contract" and charged per job. |
| CO₂e | Tonnes of CO₂ equivalent: charge (kg) × GWP ÷ 1000. Drives the F-gas leak check interval. |
| GWP | Global warming potential of a refrigerant (e.g. R32 = 675). |
