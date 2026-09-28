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
`POST /api/public/enquiry`, with header `x-hivic-signature` = hex HMAC-SHA256 of the raw body using the `BASE44_WEBHOOK_SECRET` secret. The body follows `enquirySchema` and is idempotent on `external_enquiry_id`.

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
