# P1-S77 — One Jo-approved template source for homeowner enquiry emails

Date: 19 Oct 2026 · Code commit on `main`: `962ae95c` (fast-forward from `b73723ce`, no force push)

## State summary (six separate states)

| State | Result |
|---|---|
| IMPLEMENTED | Yes — every homeowner enquiry email path renders only Jo's T1–T8; superseded templates removed from Office surfaces; T7 link defect and four template defects fixed; ENQ_00 predicts sender holds. |
| TESTED | Yes — unit/integration (mocked provider, no DB/network). Full suite vs `b73723ce`: 0 new failures, 4 previously failing files now pass, new 11-case suite. `tsc` clean, `vite build` passes. Rendered T1/T3/T5/T7/T8 HTML visually checked in a headless browser. |
| PUSHED | Yes — `origin/main` = `962ae95c` (verified by fetch). |
| DEPLOYED | **No.** The live bundle (`/assets/admin.templates-LytjQC0m.js`, fetched 19 Oct 08:40 UTC) still contains the old T1/T2 subject text and the literal `[Contact us]` footer, so Production is running an earlier commit. Publishing is Jo/Zhe's action. |
| SENT | **None.** No email of any kind was sent. |
| DELIVERED | **None.** |

## What was wrong on `main` before this commit

1. **Office and follow-up paths still used superseded copy** — `prepareOfficeSaveSpot` (three-variant Office copy) and `sendExistingInsulationSaveSpot` (Step 3 save-spot + removal) never used Jo's templates; previews fell back to the legacy renderer when no Jo template applied.
2. **Every automatic ineligible reply (T7) was refused** — `33d114e8` required a secure estimate link for T7, but Gate 1 never allows (and `syncStep3` revokes) a link for an ineligible job. Proven by `tests/s20r01-automatic-enquiry-emails.test.ts` (8 failures on `b73723ce`).
3. **Held Save-my-spot sends left a `sending` reservation** that could never be retried.
4. **`sendInitialEstimateEmail` still fell back to `renderEstimateEmail`.**
5. **Template defects** — T1/T2 subject read "you could save on your VEU rebate on ceiling insulation"; footer showed literal "[Contact us] · [Privacy] · [Remove my enquiry]"; T7 "Open the calculator" had no link; section cards rendered as empty boxes.
6. **Competing Office surfaces** — `/admin/templates` still listed six superseded entries; `/admin/communications` allowed editing/approving superseded drafts; `/admin/campaign-emails` allowed saving superseded campaign copy; `/step3-email-preview` and `/campaign-preview` previewed superseded emails.

T8 already used the customer's personal estimate link on `main` (the "known incorrect URL" was only in the unmerged S64 branch, which is superseded and must not be pushed).

## Active homeowner email paths after this commit

| Path | Template |
|---|---|
| Automatic Group A (`maybeAutoRouteLeadEmail` → `sendSaveMySpot`) | T1 / T2 |
| Automatic Group B (`sendAutomaticInsulationDetails`) | T5 / T6 |
| Automatic / Office ineligible (`sendPreliminaryIneligibleEmail`, Office copy) | T7 |
| Step 3 outcome email (`sendInitialEstimateEmail`) | T1–T6, else held |
| Office "Prepare email to copy" (variants) | T1 / T2 / T3–T4 |
| Existing-insulation follow-up (reviewed below R2) | T3 / T4 |
| Ready Check invitation (Office) | T8 |
| Office enquiry-group drafts | T1/T2, T5/T6, T7 |

No Jo template ⇒ held for manual review; nothing sent; no legacy fallback anywhere.

Emails outside Jo's eight that remain active (not enquiry outcome emails): 3-day reminder, area-unavailable, spot-saved confirmation, later-stage lifecycle drafts, partner emails.

## Backlog — not executed (needs Production access)

No Production database access exists here, so no counts are given. `supabase/manual_sql/ENQ_00_RECONCILE_ALL.sql` (read-only) now also outputs `sender_hold` and `disposition_total`, so AUTO_SEND counts only rows the current code would actually send.

Known sender rules that will hold backlog rows even after enqueue:

* **Typical-size hold** — A/C rows with no owner-entered size (T1/T5) are held by `no-size-estimate.core.ts` (`initialReplyQualifies()` returns false).
* **T7 backlog suppression** — ineligible replies older than 14 days, before `customer_delivery_settings.jobs_created_after`, or with that cutoff unset, are suppressed by `emailsafety.core.ts`.

## Actions required from Jo / Zhe

1. Publish `main` (`962ae95c`) to Production in Lovable.
2. Run `ENQ_00_RECONCILE_ALL.sql` (read-only) in the Supabase SQL editor and share the output.
3. Decide: release the typical-size hold for T1/T5 automatic sends? (Jo's T1/T5 copy discloses the 150 m² assumption.)
4. Decide: should historical ineligible enquiries (>14 days / before cutoff) receive T7? Today the sender suppresses them by design.
5. Confirm: "Remove my enquiry" uses the secure opt-out link.
6. Confirm: an owner's below-R2 declaration without reviewed media is held (T3/T4 says the photos were reviewed).
7. Only after 1–4: run `ENQ_01_ENQUEUE_SAFE.sql`, monitor with `ENQ_02_VERIFY.sql`, abort with `ENQ_03_ABORT.sql`.
