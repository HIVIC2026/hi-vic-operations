# HI VIC Operating Portal V2 — Workflow & Security

The public website stays in Base44. This project is only the operating portal.

## Architecture
- **Database = source of truth** (Lovable Cloud / Postgres). Every business table has RLS.
- **Reads**: browser client, filtered by RLS.
- **Writes**: only through server functions in `src/lib/portal.functions.ts`. Each one checks the caller's job role (`my_job_role` RPC, RLS-backed). It then calls the central modules:
  - `src/lib/workflow.server.ts` handles stage transitions, stage-entry guards (PIESA, deposit, evidence, compliance) and audit logging.
  - `src/lib/quotes.server.ts` handles installer/rectification quote maths and audited adjustments.
  - `src/lib/xero.server.ts` is the Xero boundary: create contact/invoice, sync payments, and `applyPaidAmount`.
  - `src/lib/enquiry.server.ts` upserts enquiries (used by the webhook and the admin form).
- Non-admins have **no direct write policies**, so the database rejects client-side writes.
- `workflow_events` is append-only (enforced by a trigger).

## Stage flow
```text
New Enquiry -> Eligibility Review -> Awaiting Electrician -> Assessment Booking -> Assessment Booked
 -> Assessment Complete -> (rectification?)
    yes: Rectification Required -> Awaiting Owner Rectification Approval -> [Xero invoice]
         -> Awaiting Deposit Payment -> Rectification Scheduling -> Rectification Booked
         -> (PIESA post-rectification pass) -> Ready for Installer Quotes
    no : Ready for Installer Quotes
 -> Awaiting Quote Acceptance -> [Xero invoice] -> Awaiting Deposit Payment -> Installation Scheduling
 -> Installation Booked -> Evidence Outstanding -> AP Review -> Ready for VEEC -> Complete
Exceptions: On Hold (resume to prior stage), Cancelled
```

## Central guards (`stageEntryBlockers`)
| Entering | Blocked unless |
|---|---|
| Rectification Scheduling / Booked | Rectification invoice deposit cleared (paid, or audited admin override) |
| Installation Scheduling / Booked | Installation invoice deposit cleared (paid, or audited admin override) |
| Awaiting Quote Acceptance, Installation Scheduling/Booked, Evidence Outstanding | PIESA window not expired |
| Ready for Installer Quotes | Current PIESA passed |
| AP Review | All required evidence uploaded |
| Ready for VEEC | All required evidence verified and all blocking compliance checks passed |
| Complete | VEEC lodgement submitted or approved |

- **PIESA rule**: `job_piesa_deadlines` view. The deadline is the current PIESA date plus `workflow_settings.piesa_install_window_days` (30). Urgency is green/amber/red/expired. When it expires, the electrician records a reassessment PIESA.
- **Bookings**: installation dates after the PIESA deadline are rejected.

## Payments (Xero)
1. The owner accepts a quote. The job moves to Awaiting Deposit Payment and an `invoices` row is created: 50% deposit due today, balance = total − deposit. The portal then pushes a contact and an AUTHORISED invoice to Xero.
2. If Xero isn't connected, or the push fails, the status becomes `xero_sync_error`, the error is stored, and a `xero_sync_failed` event plus an `external_sync_logs` row are written. Admins can press "Retry Xero push".
3. "Sync from Xero" reads `AmountPaid`. `applyPaidAmount` then sets the deposit or full payment and logs `deposit_paid` / `balance_paid`, and the job automatically unlocks scheduling.
4. Booking the installation sets `balance_due_date` to the installation day and logs `balance_due_set`. The `invoice_payment_state` view derives `balance_due` / `overdue` / `fully_paid`.
5. **Admin override**: needs a reason (at least 5 characters). It is stored in `payment_overrides` and logged as a `payment_override` event.
6. **Simulate payment** (admin, testing only) is disabled once `XERO_API_KEY` exists.

To go live, connect the Xero connector. It provides `XERO_API_KEY`, and the gateway uses `LOVABLE_API_KEY`. A Xero payment webhook can later call `syncInvoiceFromXero`.

## Base44 webhook
`POST /api/public/enquiry`, with header `x-hivic-signature` = base64 Ed25519 signature of the exact raw UTF-8 body (trusted Base44 public key embedded in `src/lib/enquiry.core.ts`; optional `x-hivic-key-id: base44-v1`). No shared secret. The body follows `enquirySchema` and is idempotent on `external_enquiry_id`; optional `eligibility_outcome`/`eligibility_reason` are preliminary and put the job in Eligibility Review for admin confirmation.

## Roles & bootstrap
- The first person to sign up becomes **admin**.
- Owners are linked automatically when their sign-up email matches `owners.email`.
- Admins grant electrician/installer roles on **Users**, then assign trades per job.
- Property Manager: `app_role.property_manager`, `assignment_role.property_manager` and `properties.managed_by_business_id` already exist. Adding PM access means adding assignments and UI only.

## Security test matrix
| # | Actor | Action | Expected |
|---|---|---|---|
| 1 | Anonymous | Select any table | 0 rows / denied |
| 2 | Electrician A | Read `job_overview` | Only jobs with an active assignment for A |
| 3 | Electrician A | Read job assigned to B by id | 0 rows |
| 4 | Electrician | Read `quote_internals`, `rate_cards`, `rate_card_items`, `pricing_settings`, `compliance_checks`, `veec_lodgements`, `payment_overrides` | 0 rows |
| 5 | Electrician | Read `quotes` | Rectification quotes for assigned jobs only |
| 6 | Installer | Read `quotes` | Accepted installation quote for assigned jobs only |
| 7 | Owner | Read `job_overview` / `quotes` | Own jobs; issued/accepted/declined quotes only; never internals |
| 8 | Owner | Read `messages` / `workflow_events` with `internal=true` | Not returned |
| 9 | Any non-admin | Direct insert/update/delete on any table via the client | Denied by RLS |
| 10 | Owner | Call `createBooking` for installation while deposit unpaid | "Blocked: the 50% deposit has not been paid" |
| 11 | Admin | `overrideDepositGate` without reason | Validation error |
| 12 | Any | Update/delete a `workflow_events` row | Exception (append-only) |
| 13 | Installer | `requestEvidenceUpload` for an electrician requirement | "uploaded by another party" |
| 14 | Non-assignee | `getEvidenceUrl` for another job's file | "Not permitted" (RLS read fails) |
| 15 | Anyone | Fetch a storage object without a signed URL | Denied (private bucket, no public policies) |
| 16 | Installer | `createBooking` installation after PIESA deadline | Rejected with the deadline date |
| 17 | Admin | `markReadyForVeec` with unverified evidence | Blocked, listing the missing items |
| 18 | Webhook | POST without a valid signature | 401 |

## Dummy data
- 6 jobs (HV-1001…HV-1006) at different stages.
- 3 businesses, versioned installer and electrical rate cards, and pricing settings v1.
- HV-1005 has an accepted quote with the deposit paid. Its PIESA is 26 days old (amber/red countdown).
- Sign-in accounts can't be seeded. Sign up, then grant roles on the Users page. To test owner access, sign up with `sarah.nguyen@example.com` (or another seeded owner email).

## Owner Authority (hard compliance gate)

- Table `owner_authorities`: one row per version, linked to job/owner/property. Snapshot fields (wording, scope, AP entity, owner details, address) are immutable (trigger); acceptance evidence (18+, authorised, assistance, typed signature, IP, user agent, timestamps, SHA-256) is immutable once accepted. Rows can't be deleted. Renewals create a new version.
- Statuses: not_requested / sent / viewed / accepted / declined / expired / revoked. Expiry defaults to 3 months (`workflow_settings.authority_validity_months`). Expiry is computed live and marked `expired` with an audit event (on job view / pipeline load).
- Requested automatically when eligibility is set to proceed. The owner accepts in the portal in one step. A locked text record + SHA-256 hash is stored in private storage and listed under Documents.
- Blocks entry to: Assessment Booked, Rectification Scheduling/Booked, Installation Scheduling/Booked, Ready for VEEC. Also blocks every booking and quote acceptance. Blocker text: "Valid Owner Authority required".
- AP compliance check `owner_authority` ("Valid Owner Authority") is blocking.
- Workflow events: authority_requested, authority_resent, authority_renewal_requested, authority_viewed, authority_accepted, authority_declined, authority_expired, authority_revoked. IDs are appended to `owner_authorities.event_ids`.

## Payment order (combined total)

Rectification path: assessment complete → rectification scope approved by owner (no invoice) → final installation quotes are generated with the rectification lines itemised inside → owner accepts one final quote → Xero invoice → 50% deposit PAID → rectification scheduling unlocks → rectification + PIESA pass → installation scheduling → balance due on install day.
No-rectification path: installation quote accepted → Xero invoice → 50% deposit PAID → installation scheduling.
Trades see only a "deposit cleared" yes/no; booking forms stay locked until then. Xero is never faked: without the connection, invoices show "Xero sync error" and gates stay locked (admin override needs a reason and records before/after state).

## Security test matrix – additions

| # | Actor | Action | Expected |
|---|-------|--------|----------|
| 19 | Owner | Read own `owner_authorities` | Allowed |
| 20 | Owner | Read another job's authority | 0 rows |
| 21 | Electrician/installer | Read `owner_authorities` | 0 rows (sees status only via job_overview) |
| 22 | Any | Update wording/accepted evidence, or delete an authority | Rejected by trigger |
| 23 | Admin/electrician | Accept authority on owner's behalf | Rejected (owner only) |
| 24 | Owner | Select `invoices.xero_invoice_id` / `last_sync_error` | Permission denied (column grants) |
| 25 | Trade | Select any invoice row | 0 rows (trade policy removed) |
| 26 | Any non-admin | Read `payment_overrides`, `external_sync_logs` | 0 rows |
| 27 | Any | Book assessment/rectification/installation without valid authority | Server rejects |
| 28 | Any | Book rectification/installation before deposit cleared | Server rejects |

## Test jobs

HV-1002 authority missing · HV-1003 authority expired · HV-1004/1005 valid authority (1005 deposit paid) · HV-1006 authority sent · HV-1007 rectification + deposit unpaid (Xero sync error) · HV-1008 rectification + deposit paid · HV-1009 PIESA expired · HV-1010 evidence missing/unverified.

## QA pass (28 Sep 2026)
Test accounts (password held by HI VIC admin): admin@hivic.test, elec1@hivic.test, elec2@hivic.test, inst1@hivic.test, and owner logins for Daniel Rossi, Sarah Nguyen, Priya Patel and Michael Brown.
All 15 scenarios were exercised against real server actions and the database. Fixes: server actions were running in the browser (factory wrapper); a server-only import crashed every page; quotes could be issued, or half-accepted, while PIESA was expired; the no-rectification path never asked for the PIESA sign-off upload; VEEC could be recorded as lodged before Ready for VEEC; clearer PIESA-expired booking message; electrician's current task is now shown above the locked assessment on mobile.

## Acquisition channels
- **HI VIC-sourced** (default): normal path, 2–3 installer quote options, HI VIC Xero invoice + 50% deposit.
- **Installer-sourced**: submitted by an approved EEC installer ("Submit a job to HI VIC" on My jobs). Originating business/user stored permanently (database trigger blocks any change) and the installer is auto-assigned; admin can reassign, which is audited but never changes attribution. One quote from the installer's rate card — no marketplace. All compliance gates still apply.
- **Invoice route** (`commercial_model`): installer-sourced jobs start as `not_configured`. Until an admin sets `hivic_invoices_owner` (reason required, audited; locked once an invoice exists), quote acceptance, deposit and rectification/installation scheduling are blocked with "Commercial setup required". `installer_invoices_owner` is recordable but stays blocked until that payment model is defined.
- Pipeline shows a source badge and a source filter; job page Overview has a Job source section.

| # | Test | Expected | Result |
|---|---|---|---|
| 29 | Electrician calls submitInstallerJob | Denied | PASS |
| 30 | Installer submits job | Installer-sourced, attribution stored, installer assigned, not_configured | PASS |
| 31 | Direct DB update of channel/originating installer | Rejected by trigger | PASS |
| 32 | Installer sets invoice route | Denied (admin only) | PASS |
| 33 | Owner accepts quote while route not configured / installer-invoices | Blocked, quote stays issued, no invoice | PASS |
| 34 | Installer-sourced quote generation | Exactly 1 option | PASS |
| 35 | Route changed after invoice exists | Blocked | PASS |

## Two-requirement site model (measure-up + electrical/PIESA)
The site pathway has two independent requirements with separate trade responsibilities:
- **A · Free Ready Check / ceiling and eligibility measure-up** — completed by the assigned insulation installer and stored in `ceiling_measurements` (status draft / needs_review / complete / rejected; historical `source_role` values remain preserved). One `is_current` row per job drives quoting; older/rejected rows are kept as history.
- **B · Electrical assessment / PIESA** — `assessments` (electrical fields, PIESA outcome, date) + `piesa_records`; 30-day window unchanged.

**Visit scope** is derived only by `deriveScope` (`src/lib/scope.core.ts`), loaded server-side by `jobScope` (`requirements.server.ts`) and exposed to the UI via `getJobScope`:
| Scope | When | Who |
|---|---|---|
| Split | no measure-up and no current PIESA | installer completes the free Ready Check measure-up; electrician completes PIESA |
| Electrical only | accepted measure-up exists | electrician completes PIESA; measure-up is read-only and may be flagged for review |
| Measure-up only | current PIESA, no accepted measure-up | installer completes the Ready Check measure-up |
| Installer measure-up completion | partial or needs-review measure-up | installer completes missing or flagged fields; original provenance is retained |
| Requirements complete | both done | – |

Rules: `completeAssessment` completes only the electrical/PIESA requirement; `completeMeasurement` completes the installer measure-up; `reviewMeasurement` (admin) accepts / needs review / rejects; `flagMeasurement` marks an accepted one for review. Either completion calls `advanceSiteRequirements`, which moves Assessment Booked → Assessment Complete only when BOTH are satisfied (also enforced in `stageEntryBlockers`), otherwise sets next_action to exactly what is missing. Quote generation reads only the accepted current measurement (`quoteInputsFromMeasurement`) and is blocked with a clear message otherwise. Measure-up evidence is uploaded by the installer responsible for the Ready Check.

Mitti: PIESA and installer measure-up use separate configured templates and audits record `mitti_scope`. Electrical sync writes only to `assessments`; measure-up sync writes through `planMeasurementUpdate` and never overwrites an accepted measurement. Measure-up Mitti needs `workflow_settings.mitti_measureup_template_id`; if empty the admin sees a configuration blocker and no ID is invented. Sync never completes a requirement, approves compliance or issues quotes.

Backfill (migration 0011): every existing assessment with a measured area produced one current measurement (source electrician, Mitti ref kept, complete if the assessment was complete). `assessments.measured_area_m2` is deprecated for quoting.

Tests: `tests/scope.core.test.ts` (scopes, planning, quote inputs, business-unit, trade view) and `tests/guards.test.ts` (central stage guards on a fake database: measurement gate, PIESA expiry, commercial gate, Owner Authority, deposit).

## Customer Acceptance & VEEC Assignment (replaces Owner Authority gate)
Workflow: enquiry → eligibility → assessment booking → PIESA + measure-up → quote → **Customer Acceptance & VEEC Assignment** → Xero invoice → 50% deposit → rectification → installation → installer final declaration → AP review → VEEC-ready.
- Assessment booking no longer needs Owner Authority. Old authority records are kept as read-only history.
- The customer signs once, at installation-quote acceptance (quote snapshot/version, property, consumer, product, area, installer, fees, before-VEU/benefit/final price, consumer info, declarations, typed signature, IP/user agent). A signed copy is stored privately and listed in Documents.
- Statuses: draft → consumer_signed_pending_install → installer_signed_pending_install / final_details_pending → effective_complete; variation_required when installer/product/area (>5%)/price (>$1)/scope changes – customer reconfirms.
- Scheduling needs a signed acceptance; Ready for VEEC needs effective_complete.
- Official wording is pasted and approved by an admin at /admin/compliance (versioned, immutable). Nothing is signable until approved. Retention: 7 years.

## Pipeline lanes & auto-progression
Board lanes group detailed stages (`PIPELINE_PHASES`): Enquiries · Site assessment · Quote & approval · Deposit · Rectification · Installation · Evidence/AP/VEEC · Complete; On hold/Cancelled are a separate toggle. Cards keep the exact stage, next action and a "Waiting on" signal.
`autoAdvanceJob` runs after every state-changing action and on Pipeline load (`autoAdvancePipeline`, portal state only). Always manual: ambiguous Gate 1 eligibility (clear cases are auto-decided by `evaluateGate1`, audited, admin-overridable), choosing electrician/installer, customer quote acceptance, measure-up review, AP/compliance judgement, deposit override, VEEC data entry.

## Gate 1 Property Intelligence (information only)
Ruleset `A48-2026.1` – VEU Specifications 2018 v25.0 / Ceiling Insulation Amendment Regulations 2026. Runs automatically after a new enquiry is committed (webhook never fails because of it); repeat syncs re-run only on address change, stale flag or >90 days; admin "Re-run property intelligence" / "Review evidence". Installation date changes re-evaluate the 5-year test from stored facts.

Sources (read-only, 8s timeout, 1 retry, each isolated): Vicmap Address, Vicmap Property (identifier only), Vicmap Planning zones – via the Victorian open-data WFS. The `vicmap.land.vic.gov.au` MapServer endpoints only allow map images (no query), so they are not used. Vicmap Features building polygons are not treated as residential footprints (no residential attribute). Floor plan / listing / historical imagery: provider slot, not configured → "No sourced floor plan found".

What remote checks can and cannot prove: address/Victoria – direct. Planning zone – indicator only, never NCC class. Ceiling age – only dated historical imagery with the same footprint (or a direct record) is strong; listing "year built" is supporting only; current footprint is never age proof. Flat/low-slope roof → onsite confirmation, not a fail. Insulation, luminaires, PIESA, measured area – always onsite. Hard "does not appear eligible" only on direct evidence (not VIC, confirmed not Class 1/2 SOU, direct <5y, direct no relevant ceiling). Never fabricate; unknown stays unknown.

Area hierarchy: A partner measured → B sourced floor plan → C verified footprint → D listing floor area → E aerial → F owner estimate. Parcel area never used. Weaker never replaces stronger; all estimates kept. Onsite `ceiling_measurements` remain the only quote/VEEC area.

## ESC pre-install notification (hard gate)
Owner Reg 23A consent (`esc_consent` template, admin-approved wording only) is signed inside Customer Acceptance. Booking an installation creates/regenerates the ESC notice (due = start − 24h); date/address/owner-contact changes make the old notice STALE. Bookings <24h ahead are rejected. Status `sent` only via a configured adapter (none yet) or an admin-recorded external submission with reference + confirmation. Additional Activity Guide fields: versioned `esc_notification_config` (Compliance page); unconfigured = configuration required. READY TO INSTALL (required before installation can be recorded): consent ≥24h, ESC notice sent ≥24h, signed PIESA copy delivered to owner AND installer ≥24h, PIESA within 30 days.
