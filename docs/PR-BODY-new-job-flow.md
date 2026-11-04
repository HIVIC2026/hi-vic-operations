# PR: New job flow — Parts 1–11 join + go-live fixes (`new-job-flow-g6` → `main`)

Base: `main` @ 6b56fb31 (Part 3 wording approved, #138). Head: `new-job-flow-g6` (fb6ba265 join step 7 + the G6 go-live wave).
~350 commits, the joined work of Parts 1–10, Part 9 compliance gates, the J1–J5 fix waves, the 4 Nov wording wave and the
final Part 9 review fixes. Runbook: `docs/GO-LIVE-RUNBOOK-2026-11-04.md`. Approvals ledger: `.superpowers/sdd/JO-APPROVAL-LIST.md` (not in git).

## Summary

```
Owner (My job)            Installer (phone)                 Electrician (/e/ link)        Office (Needs me)
─────────────────         ─────────────────────────────     ──────────────────────        ─────────────────────────
enquiry / own customer ─► Add a job ─► Ready Check (A1)     ...                           Quotes to check (read-only)
   quote by itself ◄───── boss enters price ──────────────  ...                           ...
accept + $349 ──────────► PIESA booked by the business ───► A3 in Mitti ──► auto-complete  piesa_auto_complete_held
   (consent, PIESA copy)   (Team electrician, verified)     upgrades → A4 + certificate    ESC notice / withdraw rows
10% deposit ────────────► install booked ─► Lead Installer  ...                           GO check 2pm / 6:30am
   "booked" email          confirm + SWMS (lock 5pm)        ...                           DON'T START → Needs me
install day ────────────► A5 ─► All done ─► Money page      ...                           Payouts (no upgrades line)
VEEC sign ──────────────► ...                               ...                           VEEC gate ($200, product)
```

Gates run everywhere the same way and fail closed: insurance (public liability verified, $5m+ from the business record,
workers comp or exempt), people on file (DOB, mobile, verified CII / licence+REC), ESC 24h/5-day timing, PIISA within 30
days of the PIESA, the certificate before the start, the deposit before the booking.

## Before / after

| | Before (main today) | After (this PR) |
|---|---|---|
| Installer's own jobs | office books the electrician by offers; quote needs office steps | the business books its own Team electrician; boss enters the price; quote goes by itself |
| Electricians | needed a login | no login: `/e/` link, Mitti A3/A4, certificate upload |
| Upgrades | HIV quoted and paid "electrical fixes" | the electrician bills the owner; no HIV payout line anywhere (`electricianBillsUpgrades()`) |
| Pre-start | one 12pm check, office only | GO check 2pm day before + 6:30am (6:00am for early starts); GO / DON'T START email to the installer office; crashed runs still record a failed row |
| Insurance | expiry only | hard block: on file, verified, $5m+ (business record), workers comp / exempt — bookings, Add a job, Ready Check picks, offers, own-job picks |
| ESC | notice tasks only | withdraw on cancel / can't-do / address change, derived from the notices too; no-ESC marker for real runs |
| Money | payouts on form completion | trade payout gate + office approval + 7 days; NO_FORM_NO_PAY_V2 wording live; refund-after-VEEC flag incl. Xero reversals |
| My electricians page | installer adds electricians there | REMOVED — Team is the only way (Jo 4 Nov 19:35) |

Evidence: full named suite green at fb6ba265 (join step 7); this wave's tests — `new-flow-09-*`, `prestart.*`, `esc-*`,
`office-money-*`, `trade-payout-gate`, `journey-a1`, `go-live-sql-order`, `commit-in-house-visit-v2-rollback`,
`my-electricians-*`, `installer-business-settings` — green; `tsc` clean; `vite build` OK; retired-terms scan 0.
Phone screenshots: `.superpowers/pictures/pack1`, `pack2` (Jo's approved samples under `docs/approved-samples/2026-11-04-pack1`).

## Merge danger (read before merging)

1. **Pending SQL (11 files) must be applied right after publish**, in the runbook's order — the code falls back or refuses
   until they are (in-house bookings use the inline path, the DOB gate blocks bookings, Team electricians can't be
   verified). Two of the files MAY already be live (`2026-11-01_in_house_electrician.sql`, `2026-11-03_electrician_job_links.sql`
   — the generated types list their objects); both are now safe to run over an existing copy. Step 0 of the runbook checks.
2. **Day-one blocks on real businesses**: no live business has a verified workers comp row or an "employs nobody" mark, and
   several workers have no DOB / mobile — until step 3 of the runbook is done, bookings / Add a job / Ready Check picks /
   REC offers for those businesses are refused with the plain line. This is by design (fail closed) but it is loud.
3. **Switches that must flip with this release** (code constants, see runbook step 4): `UPGRADES_NEEDED_EMAIL_APPROVED`,
   `CLEAR_TO_INSTALL_EMAIL_APPROVED`, `ALL_DONE_V2_APPROVED`, `AFTER_INSTALL_REMINDERS_APPROVED` — the old owner senders are
   gone (Part 4), so with these off installs hold at the owner-confirmation gate and owners get no completion email.
   `GO_EMAIL_APPROVED`, `INSURANCE_REMINDER_APPROVED`, `ENTER_PRICE_EMAIL_APPROVED`, the upgrades chasers, `SWMS_NOV2_WORDING_ON`
   (+ `PDF_LOOK_APPROVED.swms`) and `OWN_CUSTOMER_COBRAND_APPROVED` are approved and should flip too. Cutovers
   `QUOTE_30_DAY_FROM_ISO` / `ELECTRICIAN_LINK_SWEEP_FROM_ISO` = the publish instant; `WEBSITE_CONSENT_LIVE_FROM_ISO` only
   once Tom confirms the website line.
4. **Old-flow jobs**: `bun scripts/old-flow-inflight-count.ts` must be 0 everywhere (old screens are gone); HV-3682 and
   HV-3542 need the hand steps in the runbook.
5. **Mitti**: the live templates are the morning (4 Nov) versions after Jo's rollback; the portal readers accept them
   through the alias layer. The A3/A4/A5 changes go back one form at a time (Part 11) — don't re-paste the old prompts.
6. **Merge mechanics**: the join history contains an intermediate merge commit (e0f98174 main2) whose tree is not
   releasable on its own — merge or squash the whole branch, never cherry-pick it.
7. **Pre-existing reds not in scope** (same at fb6ba265): `brief-x-piesa-stage-gate` (missing export), `payment-receipt-once-practice-db`,
   `batch3b-fixes-invoice`. Snapshot files for `trade-money-speed` / `trade-money-waves` were re-recorded in S8 (the Fixes rows
   went; the live Part 9 T10 "No GO for this install" line was already missing from them).

## Pending SQL in this PR (apply in this order — runbook step 2)

1. `installer-portal-roles.sql` ↔ `.rollback.sql`
2. `installer-worker-identity-dob.sql` ↔ `.rollback.sql`
3. `installer-business-settings.sql` ↔ `.rollback.sql` (idempotent over main's live `piesa_booked_by`; rollback keeps the column)
4. `2026-11-01_in_house_electrician.sql` ↔ `.undo.sql`
5. `2026-11-03_allocate_team_electrician_v2.sql` ↔ `_rollback.sql`
6. `2026-11-01_in_house_saved_work.sql` ↔ `.undo.sql`
7. `2026-11-04_commit_in_house_visit_v2.sql` ↔ `.rollback.sql` (exact prior body)
8. `2026-11-03_electrician_job_links.sql` ↔ `.undo.sql`
9. `2026-11-03_installer_added_electricians.sql` ↔ `.undo.sql`
10. `customer-agreement-v1-3.sql` ↔ `.rollback.sql`
11. `add-installer-job-atomic.sql` ↔ `.undo.sql`
12. OPTIONAL `2026-11-02-credential-amount-insured.sql` — not needed for go-live (the amount comes from `businesses.public_liability_cover_amount`).

Proven in this order (forward, undo in reverse, forward again) by `tests/go-live-sql-order.pglite.test.ts`.

## This wave's commits (G6, final Part 9 review "ship with fixes")

B1 PL amount from the business record · S1 GO email retried until claimed · S2 crashed slot run → failed row + office
event + email · S3 ESC-withdraw row derived from notices · S4 read-error classifier · S5 trade-safe DON'T START lines ·
S6 offers + own-job pick on the insurance block · S7 PIESA deadline on the Melbourne day · S8 no upgrades payout ·
S9 refund flag never silent, Xero reversals · N1 6:30am starts · N3 esc_details_changed listed · N4 v2 rollback + test ·
N5 no-esc timeout · SQL idempotency + undo files + order test · runbook · My electricians page retired (Jo 19:35).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01CfFAPGAixUWY5ZMZjarFVh
