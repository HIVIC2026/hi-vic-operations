> HISTORICAL NOTE (21 Oct 2026): "per-area NOT_IMPLEMENTED", "final bounded QA NOT_RUN" and "0214 not applied" statements below are historical. Current status: 2026-10-21-release-reconciliation.md; 0214 is live (2026-10-21-0214-release/applied.md).

# Installer two-route Add Job — consolidated readiness audit (20 Oct 2026, after 11:00 UTC review)

Scope: installer intake, its Ready Check/quote handoffs. Not published. No sends, provider writes, account, role or approval changes. Dad/Deep access on hold. No schema migration (uses existing `jobs.installer_site_check(_date)` and `workflow_events`).
The first slice (a32318bb) is NOT the full redesign. This file lists what is implemented now and what is still blocked.

## Review findings → status
1. **Supporting uploads / file purpose — IMPLEMENTED.** Add job and job-details editor both have a separate "Supporting photos, videos or measure-up (optional)" upload, shown whatever the quote answer. Each file is saved with `purpose: "quote" | "supporting"` (validators in pilot.functions.ts and installer-quote.functions.ts; draft `job_imports.files`). `quoteFileCount` counts only `quote` files. Legacy untagged files count as quote because before this change they could only come from the "Upload your quote" control. Used in the flow, editor and `confirmClaimed`. Extraction runs only on quote files and stays provisional. Attach failures now return an error instead of looking saved.
2. **Ready Check / progress handoffs — IMPLEMENTED.** `installerReadyCheckAction` uses recorded attendance: not attended → Ready Check, even if quoted; attended → none; unknown → new `confirm_attendance` action. Unknown becomes none only when a completed Ready Check booking or an onsite/verified measurement exists, and stays "booked" when one is booked. `installerRcState` reads attendance, completed bookings and the current measurement, and fails closed on read errors. The card shows a retry. `installer-progress.core` nextAction: attended + unquoted → installer prices the same job; quoted + not attended → preliminary, onsite Ready Check; unknown → asks the installer. The progress loader passes attendance. The missing `intakeProgressApplies` helper was restored, so installer-progress.test.ts runs (18/0).
3. **Preliminary estimate — IMPLEMENTED.** Area and proposed R are no longer erased for not attended + not quoted. They stay visible, labelled "Estimated … optional", and are saved as an unverified estimate, never a measurement. Create: the estimate is on the `installer_attendance_answer` event and the proposed R is kept. Edit: when not attended and no measurement exists, an area becomes an `installer_preliminary_estimate` event. `installerIntakeState.preliminaryAreaM2` and `getMyIntakeJob` restore it on reopen; the editor shows "Preliminary estimate … (unverified — not measured)". It is hidden once a real measurement exists.
4. **Onsite requirement / material attendance / dates — IMPLEMENTED.** `installerQuoteReadiness` gained an `onsite` check. Not attended → "No site visit yet — the quote is preliminary until the onsite Ready Check". Unknown → "Site visit not recorded — confirm …". Either one is cleared only by an attended answer or an onsite/verified measurement. This feeds `intakeSendBlockers`, release/accept paths and server-drafted quotes. A Ready Check is never marked complete just to allow a quote. Changing attendance in `installerUpdateIntake` is material, so draft/issued quotes go stale. Visit dates are checked in the Melbourne calendar (`melbourneToday`, `visitDateProblem` with a real-date round trip). A future or impossible date is refused with a message on create and edit, never silently dropped.
5. **Read errors — IMPLEMENTED for the named paths.** `isIntakeJob`, the `installerIntakeState` reads (coordination, measurement, consent, fee, evidence list, estimate), elAccepted, the current measurement in `installerUpdateIntake` and the import file update now throw. A failed read no longer returns empty or no blockers.

**Consequence to note:** older installer jobs with no recorded visit now show "Site visit not recorded" as a quote blocker and a "Have you attended…" prompt, unless an onsite measurement or completed Ready Check exists. This follows the "never assume" rule.

## Tests (sandbox; bun per file; PGlite fixtures for *-db)
PASS: installer-intake-edit-db 18/0 (adds: estimate-only edit → no measurement, restored on reopen, blockers; future/impossible date refused with nothing saved; attendance change marks drafts stale), installer-attendance-handoffs 9/0, installer-ready-check 6/0, installer-progress 18/0, installer-two-route 8/0, installer-ui-repairs 17/0, installer-payer-quote-db 12/0, quote-answer-db 8/0, payer-bypass-db 11/0, import-claim-db 5/0, business-owner-only 19/0, add-job-flow 15/0, installer-intake 14/0, installer-intake-repairs 13/0, installer-intake-review 17/0, installer-quoted-db 1/0, installer-job-facts-db 1/0, add-job-confirmations 4/0, add-job-next-steps 5/0, installer-payer-fees 8/0, intake-quote-details 7/0, installer-led 17/0, installer-journey 4/0, jobfile-financial-privacy 8/0, qa-role-login 5/0. tsgo clean. Retired-terms scan: 0 customer-visible.
Test expectations changed where the approved rule changed: the old "hidden area erased", "unknown → none" and "future date silently dropped" assertions were replaced. Fixtures gained the real `installer_site_check` / `job_assignments` columns and tables, and visited fixtures set attendance = yes.
Browser: /installer-preview loads at 1280 and 390 with no page errors. The supporting upload and estimate fields were not clicked through.

## NOT_RUN
- Add job create → read → edit → read for all four combinations through the real `confirmClaimed` on a canonical-schema fixture. No PGlite harness covers the full job-building body; the create path is tested at payload/unit level only.
- Signed-in TEST installer save → reload on preview (desktop/mobile). **Not live-ready until this is run.**
- `scripts/installer-test.ts`: deliberately not run (snapshot restore, membership writes, obsolete photos/price ⇒ visited checks, external operations).
- Full portal-qa and Office/email suites: not rerun, by instruction.

## STILL NOT BUILT (exact remaining blockers)
- Installer quote lifecycle history (prepared / sent / customer already accepted): only prepared Yes/Not yet exists.
- Prefill of the canonical Ready Check from prior assessment with provenance, and per-zone (mixed ceiling) import.
- Evidence gates at the action boundary from Guide V1.2: Table 4 pp23–25 per-zone 360° before/after video, depth/markings, isolation, packaging, zone plan; 3.4.1–3.4.3 PIESA ≤30 days and ≥24h copy, life-support consent before PIESA, consent ≥24h, notification 24h–5d; 3.5.1 PIISA before work; HIVIC original-condition-before-removal safeguard; prestart uploads before "Start work"; final AP gate on verified items. Mitti/official mappings stay unapproved, so those gates stay held.
- Job-page readiness panels (quote readiness / before-work / after-install / AP review with who, due and missing-only).
- "Site conditions differ" discrepancy hold through variation/Office review.
- Removal included vs separately priced, and gross/net/GST ambiguity hold. Existing canonical quote arithmetic was not changed or re-verified this turn.
- Storage: the job-files bucket limit is 200 MiB, below the guide's 250 MB video maximum. Raising it needs Jo's approval.

## Dad-trial focused verification — 20 Oct 2026 (base revision 7075a22a + this pass)
Verified on actual call sites + real handlers (`installerUpdateIntake` -> `installerIntakeState`) on PGlite:
- Unvisited/unpriced saves; not ready; Ready Check still required. Attended + customer-quoted (with explicit pricing record) has no blockers. Measured/unpriced keeps the m². Unvisited + quoted is blocked as preliminary until the onsite Ready Check. Unknown history + quote stays null and is blocked "Site visit not recorded — confirm…" (no visit assumed). (`tests/installer-dad-trial-db.test.ts` 6/0, `installer-commercial-db` 16/0, edit-db 18/0, receipt 32/0, handoff/progress/next-step suites pass; typecheck clean.)
- Add Job supporting uploader sits outside the quote branch (available with no quote); quote-purpose files use a separate uploader and are kept apart from roof media (`installer-intake-flow.tsx` data-supporting-files / data-quote-branch).
- Confirmed-quote release/approve/accept all go through `intakeSendBlockers` (readiness incl. pricing record).

Defects found and fixed this pass:
1. `field.$jobId` MittiOnly ready_check fell back to the PIESA assessment's Mitti id. Now `mittiFormId` (`src/lib/mitti-form-link.core.ts`) uses only the Ready Check measurement's Mitti id; test `tests/mitti-form-link.test.ts` 2/0.
2. `intakeNextAction` told unknown-visit + quoted jobs the owner quote would be prepared. Now asks to confirm the visit; regression test in `installer-dad-trial-db`.

NOT_RUN / incomplete blockers:
- Create path (`confirmClaimed`) has no canonical-schema harness: create->read verified only via the shared edit/read handlers, not the first-create insert.
- Signed-in browser save/reopen: NOT_RUN. The available session is not a TEST installer, and saving would create a real record; no installer TEST account other than the excluded Deep account.
- Evidence deadlines at action boundaries (Guide V1.2 timing, per-zone before/after, original condition before removal): NOT IMPLEMENTED — no deadline guard exists in intake/readiness code.
- Per-zone prefill, site-variation holds, Office display of pricing record: not built.
- `trade-view.server.ts` install-day Mitti link reuses the assessment id; not changed (outside Ready Check scope) — review.
- Video storage cap 200 MiB < 250 MB legal maximum; needs approval.
