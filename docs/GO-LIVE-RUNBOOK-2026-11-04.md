# Go-live runbook — new job flow (4 Nov 2026)

Short, in order. Each step says what it does and how to undo it. Nothing here sends anything to a customer by itself.
Every SQL file lives in `docs/pending-migrations/`. Run SQL in the Lovable database console, one file at a time, top to bottom.

## 0. Before you start (read-only checks — nothing changes)

Preconditions:
- The PR `new-job-flow-g6` is merged to `main` and the full test run is green.
- It's a day with no real install in the next 48 hours (the SWMS wording and the GO email switch on with this release).
- Jo is around for step 3 (business data) — some of it is her call per business.

Run these SELECTs first and keep the results. They tell you what step 3 must fix BEFORE the switches go on, because the new
insurance / people-on-file gates block bookings, Add a job and the Ready Check picks on day one for anything missing.

```sql
-- a. Is the earlier in-house SQL already live? (Expected: 1 row each. If a row is missing, STOP and ask — the files in step 2 assume these.)
select proname from pg_proc where proname in ('allocate_in_house_batch_job','commit_guarded_stage');
select column_name from information_schema.columns where table_name='businesses' and column_name in ('in_house','rectification_billed_by','piesa_booked_by','public_liability_cover_amount');

-- b. Installer businesses with NO verified workers comp AND no "employs nobody" mark (the 17:40 check found: ALL of them).
select b.id, b.name
from businesses b
where b.is_active and b.onboarding_status='approved'
  and b.workcover_exempt_declared_at is null
  and not exists (select 1 from business_credentials c where c.business_id=b.id and c.kind='workers_comp_insurance' and c.verification='verified' and c.expires_at >= current_date);

-- c. Public liability: verified, unexpired, and the amount on the business record is $5m+ (17:40 check: all 10 fine — confirm nothing lapsed).
select b.id, b.name, b.public_liability_cover_amount, max(c.expires_at) pl_expires
from businesses b left join business_credentials c on c.business_id=b.id and c.kind='public_liability_insurance' and c.verification='verified'
where b.is_active and b.onboarding_status='approved'
group by b.id, b.name, b.public_liability_cover_amount
having coalesce(b.public_liability_cover_amount,0) < 5000000 or max(c.expires_at) is null or max(c.expires_at) < current_date;

-- d. Workers (installers and electricians) missing a mobile or a date of birth — bookings that name them will be refused "Not on file yet".
select w.id, w.full_legal_name, w.trade_role, b.name business, w.mobile, (i.worker_id is not null) has_dob
from partner_workers w join businesses b on b.id=w.business_id
left join partner_worker_identity i on i.worker_id=w.id
where w.removed_at is null and w.approval_status='approved' and (nullif(trim(coalesce(w.mobile,'')),'') is null or i.worker_id is null);

-- e. Team electricians not yet verified by the office (licence + REC + expiry) — their business can't book a safety check / upgrades day.
select w.id, w.full_legal_name, b.name business, w.licence_number, w.rec_number, w.licence_expires_on, w.licence_verified_at
from partner_workers w join businesses b on b.id=w.business_id
where w.removed_at is null and w.trade_role='electrician' and (w.licence_verified_at is null or w.licence_expires_on is null or w.licence_expires_on < current_date);

-- f. Businesses that have NO verified Team electrician at all (every in-house business needs one — G6 ruling).
select b.id, b.name from businesses b
where b.is_active and b.onboarding_status='approved' and b.business_type='eec_installer'
  and not exists (select 1 from partner_workers w where w.business_id=b.id and w.removed_at is null and w.trade_role='electrician' and w.approval_status='approved' and w.licence_verified_at is not null and w.licence_expires_on >= current_date);

-- g. Expiring soon (reminders only go out once INSURANCE_REMINDER_APPROVED is on): Reinsulate PL 19 Nov, Tom Lowe licence 11 Dec, INSolation cert 18 Dec / PL 19 Dec, Silver Spirit cert 20 Nov.
select b.name, c.kind, c.expires_at from business_credentials c join businesses b on b.id=c.business_id
where c.verification='verified' and c.expires_at between current_date and current_date + 45 order by c.expires_at;
```

Then, from a machine with the portal's environment (read-only): `bun scripts/old-flow-inflight-count.ts`.
Every count must be 0 — a job still on an old step keeps its old screen; finish it the old way first (or move that
installer later). Part 4's rule: old-flow fixes jobs at `rectification_scheduling` must be zero.

By hand (Jo 3 Nov 23:20): HV-3682 — book Tom Lowe Electrical's safety check the new way (the old offer path is gone).
HV-3542 — ignore the two stale owner-suggested days.

## 1. Code

1. Merge the PR into `main` (squash is fine).
2. Lovable → Publish. Wait for the publish to finish before step 2.

Undo: Lovable → publish the previous version (the one before this merge). Nothing in step 2 depends on the publish order, but
the new code reads the new SQL, so undo code and SQL together if you go back.

## 2. Pending SQL — this exact order (each with its undo file beside it)

Proven to apply in this order on a practice database by `tests/go-live-sql-order.pglite.test.ts` (and to undo in reverse).
Every file is safe to run twice.

| # | Run this | Undo with |
|---|---|---|
| 1 | `installer-portal-roles.sql` | `installer-portal-roles.rollback.sql` |
| 2 | `installer-worker-identity-dob.sql` | `installer-worker-identity-dob.rollback.sql` |
| 3 | `installer-business-settings.sql` — `piesa_booked_by` is ALREADY live (main's file); this only adds the audit trigger | `installer-business-settings.rollback.sql` (keeps the column) |
| 4 | `2026-11-01_in_house_electrician.sql` — safe if the columns are already there | `2026-11-01_in_house_electrician.undo.sql` |
| 5 | `2026-11-03_allocate_team_electrician_v2.sql` | `2026-11-03_allocate_team_electrician_v2_rollback.sql` |
| 6 | `2026-11-01_in_house_saved_work.sql` | `2026-11-01_in_house_saved_work.undo.sql` |
| 7 | `2026-11-04_commit_in_house_visit_v2.sql` | `2026-11-04_commit_in_house_visit_v2.rollback.sql` |
| 8 | `2026-11-03_electrician_job_links.sql` — safe if the table is already there | `2026-11-03_electrician_job_links.undo.sql` |
| 9 | `2026-11-03_installer_added_electricians.sql` | `2026-11-03_installer_added_electricians.undo.sql` |
| 10 | `customer-agreement-v1-3.sql` | `customer-agreement-v1-3.rollback.sql` |
| 11 | `add-installer-job-atomic.sql` | `add-installer-job-atomic.undo.sql` |
| — | OPTIONAL `2026-11-02-credential-amount-insured.sql` — NOT needed: the portal reads the public liability amount from the business record. Skip unless you want to type amounts per certificate. | `2026-11-02-credential-amount-insured.rollback.sql` |

If a file errors: stop, copy the error, run that file's undo, and don't continue. Files 1–11 don't change any customer data.

## 3. Business data (Jo's call per business) — do this BEFORE step 4

For each installer business (Partners page, or SQL):
1. Switch it to in-house: `in_house = true` (Partners › business › in-house). Every installer goes in-house for this release.
2. Set `rectification_billed_by = 'partner'` for every in-house business (electricians bill upgrades — we don't pay upgrades).
3. Workers comp: upload + verify the certificate (with expiry), OR tick "employs nobody" (`workcover_exempt_declared_at`) for a sole trader. The list from 0.b must be empty.
4. Dates of birth + mobiles for every installer and electrician on 0.d (the boss adds DOB on Team; the office can too).
5. Team electricians: verify licence + REC + expiry for everyone on 0.e; every business on 0.f needs at least one.
6. No Gap: enter their PIESA rate (rate card) — otherwise their own-customer quotes hold "Your PIESA price isn't set yet".
7. `workflow_settings.trade_messages_paused = false` (trade texts/emails are paused until this — nothing goes to installers while it's true).

Undo: set `in_house = false` again (the business goes back to the old screens); the rest is just data and can stay.

## 4. Switches (these are code constants — one small commit + publish; flip in this order)

Must go ON with this release (installs hold or owners get no email otherwise):
1. `UPGRADES_NEEDED_EMAIL_APPROVED` — owner + installer "upgrades needed" PIESA copy; also releases the deposit request on a fail result.
2. `CLEAR_TO_INSTALL_EMAIL_APPROVED` — owner "clear to install" email.
3. `ALL_DONE_V2_APPROVED` — owner "all done" email (O44 v2).
4. `AFTER_INSTALL_REMINDERS_APPROVED` — the VEEC-sign reminders after the install.
5. `GO_EMAIL_APPROVED` — the 2pm / 6:30am GO and DON'T START emails to the installer office (approved 14:40).
6. `INSURANCE_REMINDER_APPROVED` — the 30/7-day insurance and licence expiry emails (approved 14:50).
7. `ENTER_PRICE_EMAIL_APPROVED` — the "Enter your price" email to the boss after a Ready Check (approved 14:05).
8. `UPGRADES_NUDGE_TEXT_APPROVED` → then `UPGRADES_OFFICE_EMAIL_APPROVED` → then `UPGRADES_RED_FLAG_EMAIL_APPROVED` (approved 13:55; this order, the office email needs a recorded nudge first).
9. `SWMS_NOV2_WORDING_ON` together with `PDF_LOOK_APPROVED.swms` (approved 14:18; only on a day with no install in the next 48h).
10. `OWN_CUSTOMER_COBRAND_APPROVED` — own-customer quote email / page / invoice with the VEU voluntary line (approved 14:18).
11. `NO_FORM_NO_PAY_V2_APPROVED` — already ON in the code (Jo 14:12 / 16:44).

Cutover dates (set to the publish instant, UTC ISO, in the same commit):
- `QUOTE_30_DAY_FROM_ISO` — quotes sent from now get 30 days (older ones keep 14).
- `ELECTRICIAN_LINK_SWEEP_FROM_ISO` — the electrician link texts only go for assignments made from now (never old jobs).
- `WEBSITE_CONSENT_LIVE_FROM_ISO` — ONLY once Tom confirms the new website consent line is live; otherwise leave null.

Stay OFF (Jo hasn't seen or approved the words yet): `ELECTRICIAN_LINK_TEXT_APPROVED`, `ELECTRICIAN_CANT_DO_EMAIL_APPROVED`,
`ELECTRICIAN_ACCESS_ROWS_APPROVED`, `ACCESS_PERSON_TEXTS_APPROVED`, `LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED`, `PIESA_BOOKED_EMAIL_APPROVED`,
`OWNER_BOOKED_PIESA_APPROVED`, `OWNER_BOOKED_INSTALL_APPROVED`, `OWNER_BOOKED_READY_CHECK_APPROVED`, `OWNER_WILL_CALL_APPROVED`,
`VISIT_CANCELLED_OWNER_APPROVED`, `TENANT_NOTICE_APPROVED`, `RENTAL_TAPS_APPROVED`, `OWN_CUSTOMER_RENTAL_TAPS_APPROVED`,
`OWN_CUSTOMER_SEND_ON_PRESS_ENABLED`, `OWNER_QUOTE_EMAIL_V4_APPROVED`, `INSTALLER_ACCEPTED_V2_APPROVED`, `INSTALL_NO_ACCESS_V2_APPROVED`,
`IT_IS_YOUR_TURN_V2_APPROVED`, `PIESA_OWNER_CONFIRM_EMAIL_APPROVED`, `PIESA_OWNER_CONFIRM_SMS_APPROVED`, `READY_CHECK_CHASE_EMAIL_APPROVED`,
`NON_COMPLIANCE_NOTICE_APPROVED`, `HOLD_NOTICE_WORDING_APPROVED`, `AUTO_QUOTE_SEND_ENABLED`, `MITTI_AUTO_INVITE_ENABLED`, `PARTNER_RATE_OFFER_EMAIL_ENABLED`.
Anything held by one of these is recorded as a "held" event on the job, so nothing is lost — it goes when the switch flips.

Undo: flip the switch back and publish. Held sends are not re-sent.

## 5. First TEST job (before any real one)

Use the TEST business (it can book in-house now) and the test sender — nothing reaches a real person.
1. Add a job on the TEST installer's phone → Ready Check in Mitti → press Complete → the boss gets the price text (+ email) → enter the price → quote goes to the TEST owner.
2. TEST owner accepts on My job → pays the $349 (test card) → the job moves on by itself.
3. Book the safety check for the TEST Team electrician → the /e/ link text (test) → electrician's A3 in Mitti → Complete → PIESA completes by itself (or a "Needs me" row says what's missing).
4. Book the install (10% deposit, test card) → Lead Installer confirm → SWMS signed → the 2pm GO check runs (or press "Run check" on the job) → GO / DON'T START email arrives in the test inbox.
5. A5 in Mitti → Complete → All done → Money page shows the payouts (no "Electrical fixes" line anywhere).
Stop at the first screen that doesn't do this and read the job history — every hold is written there.

## 6. The hourly watch (first day)

Every hour, 9am–6pm, look at:
1. Office › Needs me — anything new under ESC, GO check failed, "could not be checked", VEEC refund, complaints.
2. Job history on every real job touched today — rows ending "held:" (wording off, comms off, trade pause, sender blocked).
3. Trade pause: `workflow_settings.trade_messages_paused` must be false.
4. The 15-minute tick is running (the latest `prestart_*` / `esc_reminder` / in-house events keep appearing).
5. `select count(*) from workflow_events where event_type in ('go_email_held','electrician_link_text_held','in_house_form_sync_failed','enter_price_email_held') and created_at > now() - interval '1 hour';` — anything above 0: open the job and read why.
6. At 2pm: every install booked for tomorrow has its GO row (`pre_start_checks` trigger `day_before_2pm`) and the office email went.

## 7. Undo, step by step

- Switches (4): flip back, publish. Nothing else needed.
- Business data (3): `in_house = false` puts a business back on the old screens; nothing else needs undoing.
- SQL (2): run the undo files in REVERSE order (11 → 1), each one on its own; stop at the first error. The undo files never
  drop `piesa_booked_by` (main's live column). Data written while live (bookings, events, links) stays as history.
- Code (1): publish the previous Lovable version. Do this together with the SQL undo, not alone.
