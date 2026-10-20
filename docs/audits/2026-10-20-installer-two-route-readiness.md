# Installer two-route Add Job — readiness audit (20 Oct 2026, 10:55 UTC request)

Base HEAD: c5a04cac (includes save point e96de1e4 two-route work). Not published. No sends, no external writes. Dad/Deep access on hold.

## Source check vs request's "current source verified" claim
The claim describes pre-e96de1e4 code. At HEAD:
- Add Job and job-details editor ask `ATTENDED_QUESTION` and `QUOTE_PREPARED_QUESTION` separately; null attendance stays unknown.
- `applicableIntakeDetails`, `intakeQuotePayload`, `pickIntakeChanges`, removal payload and server serialization no longer clear area/proposed R/removal when "Not yet"; only quote amount/inclusions/removal charge clear.
- Flow sends attendance from the installer's answer (not unconditional `site_check:'no'`); receipt routes on attendance + quote.
- This turn: removed the unused `MEASURED_QUOTED_QUESTION`/`MEASURED_QUOTED_CHOICES` constants.
- No schema migration this turn (attendance uses existing `jobs.installer_site_check`/`installer_site_check_date` + `installer_attendance_answer` events).

## Tests (sandbox, bun, per-file)
PASS: installer-two-route 8/0, installer-intake-edit-db 16/0 (PGlite canonical), installer-ui-repairs 17/0, installer-payer-quote-db 12/0, add-job-flow 15/0. tsgo clean.
Earlier (e96de1e4): browser /installer-preview desktop 1280 + mobile 390 — both questions render, area kept when toggling.

## IMPLEMENTED
Items 1, 2, 3, 5 of the approved flow (attendance/quote split, four combinations, measured+unpriced retention, preliminary-quote labelling, unknown historic stays unknown, recoveredIntakeReceipt keeps null quote null, Office-only own-electrician swap kept).

## NOT BUILT (open)
- Installer quote lifecycle prepared/sent/customer-accepted as history (only prepared yes/not yet today).
- Quote-file vs supporting-evidence classification; provisional extraction linked to original file.
- Prefill of canonical Ready Check from prior assessment with provenance; per-zone mixed-ceiling import.
- Unified evidence requirements with deadlines enforced at removal/start/claim actions (Table 4, PIESA ≥24h, 30-day window, PIISA-before-work).
- "Site conditions differ" variation hold; job-detail readiness panels (quote / before-work / after-install / AP review).
- Removal included-vs-separate and gross/net GST ambiguity hold in combined owner quote.
- Storage: job-files bucket 200 MiB < 250 MB guide max (needs approval).

## NOT_RUN
Authenticated TEST installer save/reopen on preview; live checks; Mitti fake-I/O end-to-end; full portal-qa (not rerun by instruction).
Pre-existing failure: installer-progress.test.ts import `intakeProgressApplies`.

## Addendum 10:58 UTC — attendance now drives the Ready Check and progress handoffs
Coordination: the queued duplicate request is the same approved task; treated as gap coverage only.
- `installer-ready-check.core.ts` `installerReadyCheckAction`: visit needed when `attended === "no"` (even if quoted), or legacy unknown attendance + not quoted. Attended + unquoted → no Ready Check prompt.
- `installer-ready-check.server.ts` `installerRcState`: reads `jobs.installer_site_check` and passes `attended`.
- `installer-progress.core.ts` `nextAction`: attended + unquoted → "You: finish missing assessment details and add your price on this job"; quoted + not attended → preliminary quote, onsite Ready Check required. Unknown attendance keeps previous behaviour.
- `installer-quote.functions.ts` progress loader: reads `installer_site_check` into `attended`.
- New test `tests/installer-attendance-handoffs.test.ts` 9/0 (pure rules; the two loaders were updated but not exercised end to end).
- Re-run: installer-ready-check 6/0, installer-two-route 8/0, installer-ui-repairs 17/0; tsgo clean. installer-progress.test.ts still fails at import (`intakeProgressApplies` missing, pre-existing).
- `scripts/installer-test.ts` deliberately NOT run (it restores snapshots/writes business memberships; sectionC contains old photos/price ⇒ visited checks and external operations).

## Consolidated status
Not live-ready: the signed-in TEST installer save → reload journey on preview has NOT_RUN. Not published. Dad/Deep access on hold. No sends, credential changes or approvals.
