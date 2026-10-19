# PHASE 1 — FULL TEST FAILURE TRIAGE REPORT

- PROJECT: Home Insulation Victoria
- PHASE: Phase 1
- TASK: Full Test Failure Triage — historical "50 Failed Tests"
- MODE: READ-ONLY INVESTIGATION (no application, test, migration or DB changes made)
- DATE: 2026-10-20
- BASELINE UNDER TEST: origin/main = **c5cbd3a3** (`git fetch` at investigation time; advanced from audit baseline 28765b50; only `1e4f6815` docs + `c5cbd3a3` one new passing test file were added)

---

## A. EXECUTIVE SUMMARY

| Item | Value |
|---|---|
| Latest origin/main SHA | `c5cbd3a3` (fetched live; previously audited `28765b50` is 2 commits behind) |
| Local hub HEAD | `c5cbd3a3` (verified via `git log origin/main`) |
| Test command | per-file isolated runs (`bun test --timeout 30000 <file>`, own process per file, loopback-pinned Supabase env) |
| Bun / Node | Bun 1.4.3 / Node v24.13.0 |
| **Current totals** | **374 test files, 3,603 PASS, 160 FAIL, 38 SKIP** |
| Historical totals (brief) | 2,538 PASS / 50 FAIL / 38 SKIP = 2,626 (methodology UNVERIFIED; suite has since grown to 3,801 cases) |
| Failing individual test cases | **160** across **42 files** |
| Distinct root-cause groups | **10** (RC-1 … RC-10) |
| Verified release blockers | **1 P0 (RC-1) + 3 P1 (RC-2, RC-4, RC-10) = 4 verified application defects** |
| New regressions since 28765b50 | **0** — all 160 failures reproduce **identically** (same per-file pass/fail counts) at `28765b50` (targeted historical rerun of the 42 failing files) |
| S64 regression status | `brief-s-f1-piesa-advance.test.ts` = 6 PASS / 8 FAIL before and after S64, and again now — matches the brief's historical evidence exactly (PRE-EXISTING, unchanged) |

Methodology note (honest disclosure): the project runner `bun run test` (scripts/test-isolated.ts) **crashed** with `ERR_STRING_TOO_LONG` (scripts/test-isolated.ts:35) because `tests/register-interest-validation.test.tsx` emits ~2.2 GB of output (TestingLibrary prettyDOM dumps repeated per assertion). The project's own per-file isolation design was therefore replicated by an out-of-repo harness (`/var/folders/.../T/qwenwork/qa-perfile.ts`) that runs each file in its own process with a 20 MB output cap — same semantics, no repo modification. The 50-vs-160 discrepancy vs the historical audit is a methodology/total-count artifact (historical run methodology not recorded in the brief) and is NOT evidence of new regressions: the targeted `28765b50` rerun proves identical results on both commits.

Safety isolation: worktrees `wt-qa-triage-s115` (c5cbd3a3) and `wt-qa-triage-hist` (28765b50) were created fresh; tests ran with `SUPABASE_URL`/`VITE_SUPABASE_URL` pinned to loopback (`http://127.0.0.1:54321`), overriding the tracked `.env` (which contains only a publishable key, no service-role key — verified before the run). No hosted/prod endpoint was contacted; DB fixtures are local PGlite.

---

## B. COMPLETE FAILURE INVENTORY (160 cases, grouped)

Per-case raw evidence (exact errors, stack traces, full diffs) is preserved outside the repo at
`/var/folders/yf/s3c7lzqs5_jbwvq6xwv_8hl00000gn/T/qwenwork/qa-perfile-logs/` (current) and `.../qa-hist-logs/` (28765b50).
Counts below are exact per-file `fail` totals from the current run; every failed case appears exactly once.

### RC-1 — Clearance-recorder authorization guard missing (13 cases) — **P0, GENUINE DEFECT (A)**
| File | Fail |
|---|---|
| tests/a4-step80-regulated-result-authz-db.test.ts | 9 |
| tests/a4-clearance-guard.test.ts | 4 |

Evidence: `saveAssessment` by a REC business admin **without the electrician app role** returned `{ok:true, savedAt:...}` — the PIESA draft was written (portal.functions.ts:222–235). Expected guard message `CLEARANCE_RECORDER_REFUSED` ("Only a licensed electrician can record this electrical result.", src/lib/clearance-guard.core.ts:9) never fires. `requireClearanceRecorder`/`clearanceRecorderAllowed` is **never invoked anywhere in src/** — `git log -S "requireClearanceRecorder" -- src/lib/portal.functions.ts` on main returns **no commits**: the STEP 73/80 guard has never landed on origin/main. Also: `completeAssessment` returns "Start the assessment first." instead of the license refusal (guard ordering wrong even where behavior coincidentally refuses). Historical: PRE-EXISTING (identical at 28765b50).

### RC-2 — Mitti-owned Ready Check can be overwritten via portal (10 cases) — **P1, GENUINE DEFECT (A)**
| File | Fail |
|---|---|
| tests/brief-o-ready-check-delivery.test.ts | 10 |

Evidence: test 2a "the portal refuses to save onto a Mitti row" — `saveRcDraft` **succeeded** on a row with `external_mitti_id` set ("expected the action to fail, but it succeeded"). `src/lib/ready-check-draft.server.ts`: only `reopenRcDraft` (:96) checks `external_mitti_id`; `saveRcDraft` (:48) and `submitRcDraft` (:71) have **no Mitti guard**, so portal saves/submits silently overwrite Mitti-synced Ready Check data. Related failures in the file (submission blocking, evidence unblocking, Office status fact) share this save/submit path or are inconclusive without the guard fixed. Historical: PRE-EXISTING.

### RC-3 — Enquiries/list rollback: tests pin the rolled-forward implementation (40 cases) — **P2, TEST DEFECT (B)**
| File | Fail |
|---|---|
| tests/enquiries-page-performance.test.ts | 18 |
| tests/office-list-server-paging.test.ts | 7 |
| tests/office-final-uat.test.ts | 4 |
| tests/a3-a4-role-isolation-db.test.ts | 1 |
| tests/a3-intake-progress-access.test.ts | 1 |
| tests/brief-x-piesa-stage-gate.test.ts | 1 |
| tests/enquiry-search-postgrest-or.test.ts | 1 |
| tests/ffs-field-access.step36.test.ts | 1 |
| tests/ffs-minimum-results.p1-s23b.test.ts (TEST 14 only) | 1 |
| tests/installer-progress.test.ts | 1 |
| tests/p1-r1-s104-unified-integration.test.ts | 1 |
| tests/postintake-health.test.ts | 1 |
| tests/status-label-unify.test.ts | 1 |
| tests/transfer-reconcile.test.ts | 1 |

Evidence (verified, three distinct sub-mechanisms, one cause): origin/main `28765b50` "Enquiries: roll back to e5b993bf (no pagination, pre-consolidation baseline)" — an owner-directed rollback.
(a) Missing exports: `intakeProgressGate`/`intakeProgressApplies` (installer-progress.core.ts), `ownerStageGateBlockers` (owner-gates.core.ts), `statusLabel` (enquiry-groups.core.ts), `reconcileBase44Transfers` (office-status.core.ts) — removed by the consolidation/revert commits (`75aa5e9f`, `665c5c3b`, `bdf1da3c`), all ancestors of 28765b50. 6 files fail at import.
(b) Source-pin markers gone: e.g. `matchesTerm(w,` expected in the office loader now lives in `src/lib/list-paging.core.ts`; `resetEnquiryListState` no longer exported from enquiry-groups.server. 9 files.
(c) Component copy/structure drift on the rolled-back UI. All B-class: the pinned features (server paging, snapshot cache, consolidated portal) were deliberately rolled back, not lost. Historical: PRE-EXISTING.

### RC-4 — PIESA advance (F-1) does not advance on a completed result (8 cases) — **P1, GENUINE DEFECT (A)**
| File | Fail |
|---|---|
| tests/brief-s-f1-piesa-advance.test.ts | 8 |

Evidence: `advanceSiteRequirements("job-1","user-1")` returns `{advanced:false}` for a passing completed PIESA (all 6 advance cases + 2 no-advance-on-incomplete-facts characterisation cases also mismatch). This is the known open F-1 item — historically **6 PASS / 8 FAIL before and after S64** (per brief; reproduced now), PRE-EXISTING, unchanged by S64. F-1 was also never browser-verified (documented earlier). Blocks the automatic piesa_scheduled → piesa_complete transition; Office next_action stale.

### RC-5 — Register-interest validation UI tests outdated + harness output explosion (18 cases) — **P2, TEST DEFECT (B) + HARNESS BLOCKER**
| File | Fail |
|---|---|
| tests/register-interest-validation.test.tsx | 18 |

Evidence: the live component (`src/components/portal/register-interest.tsx:82` etc.) still performs full validation (name/email/mobile/consent/postcode) but renders a **single error banner** via `setError(...)`; the tests expect per-field marks, per-input `aria-describedby` wiring and multiple simultaneous messages ("marks every missing answer"). All 18 assertions are TestingLibrary "element not found" against the single-banner DOM. Separately, each failure dumps a full-page prettyDOM, producing **2,202,093,017 bytes** of output per run — this alone crashes `bun run test` (ERR_STRING_TOO_LONG) and is a test-infrastructure defect independent of the assertions. Validation logic itself is present in the component; no evidence of a genuine intake-form defect, but the UX divergence (single vs per-field errors) needs a product decision. Historical: PRE-EXISTING.

### RC-6 — Agreement/contract copy drift (26 cases) — **P2, TEST DEFECT (B), needs one copy verification**
| File | Fail |
|---|---|
| tests/activity48-agreement-signing.test.ts | 19 |
| tests/installer-warranty-signing.test.ts | 5 |
| tests/rec-onboarding.test.ts | 1 |
| tests/no-lead-fee.test.ts | 1 |

Evidence: all are `toContain` assertions against generated agreement text (REC agreement now "HI-VIC-A48-REC-2.5-2026-10-05"); the pinned clauses/wording were superseded by newer agreement versions. The received text is complete, internally consistent and contains the expected topic areas — the pins are stale, not missing sections. Because these are contractual texts, the owner should confirm version 2.5 (and the current installer-warranty/no-fee wording) is the approved text; the tests then get re-pinned. Historical: PRE-EXISTING.

### RC-7 — Communications/delivery-gating behavior drift (15 cases) — **P2, INCONCLUSIVE root cause (E/G), CLOSED workstream**
| File | Fail |
|---|---|
| tests/group-b-prehandoff.test.ts | 6 |
| tests/existing-insulation-send.test.ts | 2 |
| tests/lifecycle-emails.test.ts | 2 |
| tests/group-b-declaration-routing.test.ts | 1 |
| tests/jo-email-size-and-branding.test.ts | 1 |
| tests/no-insulation-review.test.ts | 1 |
| tests/office-status.test.ts | 1 |
| tests/save-spot-uncertain-delivery.test.ts | 1 |

Evidence: assertion mismatches in send-gating sequences (workflow/delivery switch off must block with zero provider calls), lifecycle email catalog previews/labels, and Jo-email copy/branding. The Communications / Email Templates workstreams are CLOSED by the owner, so these are recorded, not reopened. No failure observed here opened a send path (failures are about blocking/reservation behavior differing from the pinned sequence); no security issue demonstrated. Historical: PRE-EXISTING.

### RC-8 — Malformed signed-snapshot throws instead of flagging invalid (6 cases) — **P2, ROBUSTNESS (B/A-boundary)**
| File | Fail |
|---|---|
| tests/def07-malformed-signed-snapshot.test.ts | 6 |

Evidence: `snapshotProblems({})` / null-document inputs **throw** rather than returning "invalid" (T02/T04 `not.toThrow`, T09 error-exposure). Statutory gate tests T06/T07 depend on the graceful path. Note: throwing is still fail-closed (a malformed snapshot cannot satisfy compliance), so no demonstrated unsafe path; the defect is robustness/500-risk on malformed input. Historical: PRE-EXISTING.

### RC-9 — Misc copy/render source-pin drift (19 cases) — **P2, TEST DEFECT (B) / INCONCLUSIVE (G)**
| File | Fail |
|---|---|
| tests/pricing-cohort.test.ts | 4 |
| tests/owner-job-route-terminal.test.tsx | 3 |
| tests/no-size-save-journey.test.ts | 3 |
| tests/brief-e-silent-action-feedback.test.tsx | 3 |
| tests/official-forms.test.ts | 2 |
| tests/installer-onboarding-pages.test.ts | 1 |
| tests/intake-sequence.test.ts | 1 |
| tests/owner-calculator.test.ts | 1 |
| tests/partner.core.test.ts | 1 |

Evidence: `toContain`/`toMatchObject` mismatches on rendered copy (e.g. removal-note wording, "Existing insulation may need to be removed… $15/m²" sentence absent from rendered calculator), source-pin markers (intake enqueue/waitUntil shape), PIISA gate mapping, partner-endpoint error contract. Individually low-value pins superseded by later copy/refactors; no defect demonstrated against an essential Phase 1 requirement. Historical: PRE-EXISTING.

### RC-10 — FFS events leak into user-facing timelines (5 cases) — **P1, GENUINE DEFECT (A)**
| File | Fail |
|---|---|
| tests/p1-fa02-ffs-ui-deactivation.test.ts | 4 |
| tests/ffs-minimum-results.p1-s23b.test.ts (TEST 9) | 1 |

Evidence: `buildTimeline` (src/lib/jobfile.core.ts:201) includes **every** workflow event with no FFS exclusion — test proves an FFS event becomes a timeline item visible to owner/electrician/installer audiences (`Expected false, Received true`), and job-pack export with "Include internal items" does not filter FFS either. P1-FA02 requires the recorded FFS result to be persisted but never user-visible. Internal-only regulated data rendered to customers/trades = data-exposure defect. Historical: PRE-EXISTING.

**Reconciliation: 13+10+40+8+18+26+15+6+19+5 = 160 — equals the runner output. No unresolved failure omitted.**

Skips (38) were not triaged — SKIP is an intentional state and outside the failure inventory.

---

## C. ROOT CAUSE ANALYSIS (summary)

| ID | Root cause | Cases | Class | Release |
|---|---|---|---|---|
| RC-1 | STEP73/80 clearance-recorder (electrician-role) guard never merged to `portal.functions.ts` | 13 | A | **P0** |
| RC-2 | `saveRcDraft`/`submitRcDraft` missing `external_mitti_id` guard | 10 | A | **P1** |
| RC-3 | Owner-directed enquiries rollback on main; 15 test files pin rolled-forward implementation | 40 | B | P2 |
| RC-4 | PIESA F-1 advance returns advanced=false on completed result (piesa-advance path) | 8 | A | **P1** |
| RC-5 | Register-interest tests pin per-field error UX; component uses single error banner; unbounded DOM-dump output breaks the runner | 18 | B + HARNESS | P2 |
| RC-6 | Agreement text superseded (REC 2.5 etc.); stale clause pins | 26 | B | P2 |
| RC-7 | Communications gating/catalog behavior differs from pinned sequences (closed workstream) | 15 | E/G | P2 |
| RC-8 | Malformed snapshot throws instead of flagged-invalid (fail-closed preserved) | 6 | B | P2 |
| RC-9 | Stale copy/source pins across calculators, routes, forms, partner contract | 19 | B/G | P2 |
| RC-10 | `buildTimeline` lacks FFS exclusion (P1-FA02 boundary) | 5 | A | **P1** |

Confirmed shared roots vs suspected: RC-1 (confirmed by code absence + runtime success), RC-2 (confirmed by code inspection of both functions), RC-3 (confirmed: rollback commits + missing exports/markers), RC-10 (confirmed by direct buildTimeline inspection). RC-4 confirmed at behavior level (core-level unit test; root inside piesa-advance not bisected further). RC-7 and RC-9 are groups of individually-inconclusive stale pins — treated as suspected relationships, not confirmed single causes.

## D. HISTORICAL REGRESSION COMPARISON

- **NEW REGRESSIONS: none.** The 42 failing files produce byte-identical per-file pass/fail counts at `28765b50` and `c5cbd3a3`; the only intervening commits are a docs commit and `c5cbd3a3` (adds `tests/piesa-future-date-runtime.test.ts`, 15 PASS / 0 FAIL — a new passing test).
- **PRE-EXISTING: all 160.**
- **CHANGED FAILURES: none observed.**
- **Historical status vs S64:** `brief-s-f1-piesa-advance` (6/8) and the previously-verified regression group match the brief's S64 evidence — unchanged, consistent with S64 acceptance. **Nothing in this report contradicts verified S64 acceptance evidence**: S64 established F-1's 8 failures were not introduced by S64; it did not establish F-1 worked.
- Note: the "50 FAIL" historical figure could not be reproduced or reconciled (its run methodology is not recorded); under the project's own isolation design the honest current count is 160, all pre-existing. This is disclosed rather than forced to match.

## E. PHASE 1 RELEASE BLOCKERS (verified only)

### E-1 (RC-1, P0) — Unlicensed PIESA recording possible on main
- **Defect:** `saveAssessment` (src/lib/portal.functions.ts:222) authorizes only `requireJobRole(..., ["admin","electrician"])` — a job-level assignment — with **no check of the electrician app role / license**. Runtime-proven: an unapproved REC business admin recorded a PIESA outcome (`ok:true`, draft written). Same gap applies to `completeAssessment`/`recordPiesa` (guard ordering wrong).
- **Phase 1 requirement:** Essential safeguards — only a licensed electrician records the statutory PIESA (VEU Activity 48); STEP 73/80 acceptance evidence claims this guard "present at HEAD", but it has never been on origin/main (`git log -S` empty).
- **Why it prevents release:** unauthorized write to a regulated statutory record; contradicts verified acceptance evidence.
- **Minimum correction:** call the already-existing pure guard (`clearanceRecorderAllowed`, src/lib/clearance-guard.core.ts:11 — checks jobRole + hasElectricianRole) at the top of `saveAssessment`, `completeAssessment` and `recordPiesa` in portal.functions.ts, throwing `WorkflowError(CLEARANCE_RECORDER_REFUSED)` before any read/write. No schema change.
- **Required verification:** the 13 RC-1 tests pass; `bunx tsc --noEmit`; manual check that legitimate electricians (with role) are unaffected (the passing 29 cases in a4-step80 cover this).

### E-2 (RC-2, P1) — Portal can overwrite Mitti-owned Ready Checks
- **Defect:** `saveRcDraft` (ready-check-draft.server.ts:48) and `submitRcDraft` (:71) never check `external_mitti_id`; runtime-proven save succeeded on a Mitti row. `reopenRcDraft` (:96) has the correct guard and message.
- **Requirement:** Installer/Office workflow integrity — Mitti-owned Ready Checks must only be corrected in Mitti.
- **Minimum correction:** replicate the reopenRcDraft guard in both functions ("This Ready Check came from Mitti — complete or correct it there.").
- **Verification:** brief-o tests 2a/2b/2c pass; 3a (installer_sourced unaffected) stays green.

### E-3 (RC-4, P1) — PIESA advance (F-1) stuck at piesa_scheduled
- **Defect:** `advanceSiteRequirements` returns `advanced:false` for a complete passing PIESA; job and Office next_action never advance. Known-open item; never browser-verified.
- **Requirement:** Installer workflow — automatic piesa_scheduled → piesa_complete transition.
- **Minimum correction:** diagnose inside `piesa-advance.core.ts` against the 8 failing cases (pure core, unit-testable per project convention); do not widen the fix.
- **Verification:** brief-s 6 PASS / 8 FAIL → 14/14; one browser check of the transition (currently NOT_RUN).

### E-4 (RC-10, P1) — FFS results visible on user-facing timelines/packs
- **Defect:** `buildTimeline` (jobfile.core.ts:201) emits all workflow events; no FFS-type exclusion anywhere in the function.
- **Requirement:** P1-FA02 — FFS result persisted, never user-visible (timeline, packs, admin included).
- **Minimum correction:** filter the canonical FFS event type out of `buildTimeline` output (and pack export path), pinned to the shared constant as the tests specify.
- **Verification:** p1-fa02 (4) + ffs-minimum-results TEST 9 pass; TEST 14 (source pin, RC-3) re-pinned separately.

## F. NON-BLOCKING FAILURES

- RC-3 (40): owner-directed enquiries rollback vs stale pins — re-pin or archive the 15 files with the owner; the rolled-back features (server paging, snapshot cache) were deliberate descoping, not defects.
- RC-5 (18): outdated UI-validation tests + the **harness blocker** (2.2 GB output crashing `bun run test`). At minimum, fix the unbounded prettyDOM output so the project runner can run to completion — this is required to restore reliable whole-suite verification regardless of release.
- RC-6 (26): stale agreement-clause pins — owner confirms current approved agreement versions; re-pin.
- RC-7 (15): closed Communications/Email-Templates workstreams — recorded only; no security issue demonstrated.
- RC-8 (6): malformed-snapshot robustness (fail-closed preserved) — defer; consider wrapping `snapshotProblems` input validation.
- RC-9 (19): stale copy/source pins — batch re-pin after the release.

## G. TEST COVERAGE GAPS (material only)

1. No test currently pins that `recordPiesa`/`completeAssessment`/`saveAssessment` ordering **cannot** be bypassed for a *licensed* electrician across all job-role shapes beyond a4-step80's cases — the RC-1 fix should add the regression tests the brief requires (the existing 13 cover the refusal side).
2. Whole-suite runner reliability: `bun run test` cannot currently complete at all (RC-5 output explosion) — until fixed, "green suite" claims are unverifiable.
3. F-1 has no browser-level verification (journey never reaches piesa_scheduled in UAT) — unit fix must be paired with one browser pass before Publish.

## H. FINAL VERDICT

**TEST RELEASE GATE — BLOCKED**

One verified P0 application defect (RC-1, unlicensed PIESA recording) and three verified P1 application defects (RC-2 Mitti overwrite, RC-4 F-1 stuck advance, RC-10 FFS exposure) remain on latest origin/main. All are pre-existing, small, and precisely fixable; none affect the closed Enquiries/Communications scope.

## I. MINIMUM ACTION PLAN

**MUST FIX BEFORE PRODUCTION**
1. RC-1: wire `clearanceRecorderAllowed` into `saveAssessment` / `completeAssessment` / `recordPiesa` (portal.functions.ts) — smallest possible change, no schema dependency.
2. RC-2: add the `external_mitti_id` refusal to `saveRcDraft` and `submitRcDraft` (ready-check-draft.server.ts).
3. RC-4: fix piesa-advance so a completed PIESA advances piesa_scheduled → piesa_complete (unit-level, core file).
4. RC-10: exclude FFS events from `buildTimeline` and pack export (jobfile.core.ts).

**MUST VERIFY BEFORE PRODUCTION**
5. Re-run the 5 affected test files to green (13 + 10 + 8 + 5 cases) after the fixes; `bunx tsc --noEmit`.
6. Fix the RC-5 output explosion (cap prettyDOM) so `bun run test` completes; then one full-suite run to confirm totals.
7. One browser pass of the PIESA advance transition (currently NOT_RUN anywhere).
8. Owner confirmation that agreement version REC-2.5-2026-10-05 (and current installer-warranty/no-fee wording) is the approved text (RC-6).

**MAY DEFER UNTIL AFTER PRODUCTION**
9. RC-3: re-pin/archive the 15 rollback-pinned test files with the owner.
10. RC-5 assertion set: product decision single-banner vs per-field errors; then re-pin.
11. RC-7/RC-9 stale pins: batch re-pin.
12. RC-8: snapshot-validator graceful handling.

STOP — investigation only. No remediation was implemented; no application, test, migration, DB or production state was modified.

---

## ADDENDUM — POST-TRIAGE OWNER RECONCILIATION (2026-10-20)

The release classifications above were QA triage classifications. The owner's subsequent
C10–C13 decision recovery and Phase 1 scope rulings (see
`docs/phase1/release/P1_C10-C13_CLIENT_DECISION_RECOVERY_2026-10-20.md` and
`docs/phase1/release/P1_PHASE1_RELEASE_STATUS_2026-10-20.md`) supersede the release-priority
column as follows. The technical observations (code evidence, failing tests) remain valid.

| Group | Triage classification | Reconciled status |
|---|---|---|
| RC-1 (clearance-recorder guard missing) | P0 | **OPEN — TARGETED FIX IN PROGRESS** (uncommitted changes observed in a local checkout on 2026-10-20; **not** committed/pushed to main as of reconciliation — verify latest main before relying on this) |
| RC-2 (Mitti Ready Check overwrite) | P1 | **DEFERRED — PHASE 2** (Mitti integration is Phase 2; historical tests reference it but it is not Phase 1 mandatory work) |
| RC-4 (PIESA F-1 advance) | P1 | **NOT YET REVERIFIED** (owner states F-1 was previously resolved; current evidence = 8/14 unit failures + no browser verification — verification required, not automatic reopening) |
| RC-10 (FFS events on user timelines) | P1 | **CANCELLED FEATURE — REMAINING VISIBILITY RISK RECORDED** (FFS functionality is cancelled; current evidence shows `buildTimeline` still emits FFS events to user-facing audiences — residual risk documented in the release register; no code change under the documentation task) |
| RC-3/5/6/7/8/9 | P2 | Non-blocking; owner-closed workstreams (Enquiries, Communications, Email Templates) not reopened |

---

## ADDENDUM — POST-RC1 CORRECTION UPDATE (2026-10-20)

The RC-1 row in the reconciliation table above is now superseded (it was accurate at the time
it was written; later same-day commits changed the state).

- **RC-1 original failures:** 13 (`a4-step80-regulated-result-authz-db.test.ts` 9 + `a4-clearance-guard.test.ts` 4).
- **RC-1 correction:** **VERIFIED FIXED** — commit `63ef6cae4eff42058ce77264117e03d8c1d92d18`
  (`fix(p1): enforce electrician authorization for manual PIESA`), pushed to `origin/main` after this report's
  baseline `c5cbd3a3`. The `clearanceRecorderAllowed` guard is wired into `saveAssessment`, `completeAssessment`,
  `recordPiesa` and `submitDeclaration("electrician_declaration")` before any read/write (fail-closed); the
  `addTeamMember` privilege-escalation path and `switchJobElectricianToHivic` access check are corrected.
- **Targeted RC-1 tests after correction: 47 PASS / 0 FAIL** — independently re-run on `origin/main` @ `63ef6cae`
  in an isolated PGlite/loopback environment on 2026-10-20 (38 in a4-step80 + 9 in a4-clearance-guard).
- **S64 targeted regression tests: PASS** (`piesa-future-date-runtime` 10/10; `p1-s64-date-payment-*` 38/38).
- **TypeScript: PASS** (independently confirmed, 0 errors); **production build: PASS** (per the RC-1 correction report).
- **Full-suite results: NOT RERUN.** The historical totals above (3,603 / 160 / 38 at `c5cbd3a3`) remain the
  measured record. The 160 failures **included the 13 RC-1 failures now corrected**; a current suite total has
  not been measured, so 160 − 13 = 147 is only an arithmetic projection, not a result, and is not claimed as such.
- Correction report of record: `docs/phase1/release/P1-RC1_PIESA_AUTHORIZATION_CORRECTION_2026-10-20.md`.
- Current statuses live in `docs/phase1/release/P1_PHASE1_RELEASE_STATUS_2026-10-20.md` (RC-1 FIXED AND VERIFIED;
  remaining limitations — licence expiry, missing licence records, partner business approval status not enforced
  by the guard — are recorded there as policy/data gaps, not resolved compliance matters).
