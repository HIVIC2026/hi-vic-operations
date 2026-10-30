# Task 6 — reused Victorian calendar

Task 6 reuses `isBusinessDay` / `VIC_PUBLIC_HOLIDAYS` from `piesa-windows.core.ts`; the date-only `addVicBusinessDays` interface is in the existing `melbourne-time.core.ts`. No second holiday helper or calendar was created. Ready Check becomes overdue on the resulting Melbourne date; PIESA is overdue at accepted_at + 10 calendar days. Install uses the recorded `job_piesa_deadlines.days_remaining`, never a new window calculation.

## Full existing list used

- **2026:** 1 Jan, 26 Jan, 9 Mar, 3 Apr, 4 Apr, 5 Apr, 6 Apr, 25 Apr, 8 Jun, 25 Sep, 3 Nov, 25 Dec, 26 Dec, 28 Dec.
- **2027:** 1 Jan, 26 Jan, 8 Mar, 26 Mar, 27 Mar, 28 Mar, 29 Mar, 25 Apr, **26 Apr**, 14 Jun, 2 Nov, 25 Dec, 26 Dec, 27 Dec, 28 Dec.

## Official-source differences — existing calendar left unchanged

Business Victoria lists no substitute day for ANZAC Day on a weekend: the existing **26 Apr 2027** entry is not in its official list. The existing calendar also has no AFL Grand Final Friday for 2027; Business Victoria currently marks that date as subject to the AFL schedule. Correcting the shared calendar would affect existing owner scheduling outside Task 6 and was not done. Melbourne Cup regional council substitutions are not modeled by the existing statewide calendar.

Sources: [Business Victoria 2026](https://business.vic.gov.au/business-information/public-holidays/victorian-public-holidays-2026), [Business Victoria 2027](https://business.vic.gov.au/business-information/public-holidays/victorian-public-holidays-2027).

## Activation and safety

`docs/pending-migrations/2026-10-30_in_house_partner_pull_back.sql` and its matching undo were tested on PGlite only, not applied live. The service-only, admin-validated transaction ends both active installer/electrician assignments for the held business, writes one actor/reason/assignment-id event, and leaves bookings and stages untouched. A replay with no held assignment is inert. No message, provider, recovery hook or payment guard is involved.

Hosted pull-back is NOT RUN: its pending function is not deployed and qa_test jobs are explicitly excluded. No real home was taken back as a test.