# PHASE 1 — RELEASE STATUS REGISTER (CURRENT)

**Date:** 2026-10-20 (Australia/Melbourne)
**Baseline:** `origin/main` = `c5cbd3a3f0b7c8557c227763f8a1e264e927424a`
**Status of this document:** This is the **single current authoritative Phase 1 release-status
summary**. It supersedes any conflicting current-status claim in older reports; dated historical
reports themselves are preserved unmodified (supersession notes were added where an older report
stated a now-outdated *current* status). Production deployment has **NOT** been performed.

**Sources of record (all verified 2026-10-20):**
- `P1_C10-C13_CLIENT_DECISION_RECOVERY_2026-10-20.md` (decision recovery, this directory)
- `P1-QA_PHASE1_FULL_TEST_FAILURE_TRIAGE_REPORT.md` (full test triage, this directory; + addendum)
- `P1-R1_P0_S64_INTEGRATION_AND_PHASE1_DEFECT_FIXES.md` §H (`S64 — CLOSED / PREVIEW VERIFIED / PRODUCTION RELEASE PENDING`)
- `docs/phase1/uat/PIESA_S64_VERIFICATION_2026-10-20.md` (final-status table)
- `P1-R1-S69_PRODUCTION_MIGRATION_RECONCILIATION.md` (DATABASE RELEASE GATE — PASS header; 0149/0202 remain `REPORTED_PRODUCTION`)
- `06_DEPLOYMENT_NOTES.md` / `07_CLIENT_DECISIONS_REQUIRED.md` (2026-10-10 handover package, outside the Git repository at the workspace root)

---

## A. Governance decision gates (C10–C13)

| Gate | Status | Evidence & limitations |
|---|---|---|
| **C10 — Source merge** | **NON-BLOCKING — IMPLEMENTED** | `origin/lovable-sync` is an ancestor of `main`; 5,561 Lovable-side commits retained; agreement/warranty/onboarding/QA work preserved in `src/`. **Limitation:** formal written nomination of the merge owner was never independently verified — recorded as a historical documentation gap only; it does not reopen the gate. |
| **C11 — Isolated test environment** | **NON-BLOCKING (for current isolated tests) — ALTERNATIVE MITIGATION ACCEPTED** | Local PGlite-based isolation + forced-local env + zero-outbound-network assertion allow the automated suite to run without production access. **Standing limitation:** Lovable Preview and Production still share the same Supabase backend (`wvuffpykgnqliikhodzl`); no separate cloud staging Supabase project exists; local isolation is NOT equivalent to a staging project; write-path Preview UAT acts on real database objects. Retained as a known limitation (§E). No new Supabase project created. |
| **C12 — Production migrations** | **NON-BLOCKING — DATABASE RELEASE GATE PASS** (on existing verification evidence) | Required Phase 1 schema changes reported present in production (Lovable AI production database check report); no outstanding required Phase 1 migration identified. **Evidence limits preserved:** migration **0149 remains `REPORTED_PRODUCTION`** (not independently verified); schema presence does not prove complete migration-ledger history; no new production database inspection has been performed. |
| **C13 — Production release** | **BLOCKED — OWNER APPROVAL REQUIRED** (administrative release gate, not a development task) | Requires: owner approval of final release scope and timing, Production Publish, then non-destructive production verification. **Production Publish is NOT authorized** and has NOT been performed. The `waitUntil` hosting question is mitigated in code (`background.server.ts` degrades to `queue_only`) but that mitigation is not proof that production background processing has been fully verified. Do not recommend publishing an outdated commit without checking newer technical findings (§B). |

## B. Technical release gates (current evidence)

| Item | Status |
|---|---|
| RC-1 — PIESA manual-entry authorization (server-side) | **OPEN — TARGETED FIX IN PROGRESS.** Triage evidence (`P1-QA_…TRIAGE_REPORT.md` RC-1): the STEP 73/80 clearance-recorder guard has never been on `origin/main`; a non-electrician REC business admin could record PIESA results. Uncommitted correction changes were observed in a local checkout on 2026-10-20 but are **not verified and not pushed**. Status must be re-evaluated against the latest `origin/main` before any release decision — never mark FIXED solely because an agent is assigned. |
| RC-4 — PIESA stage advancement (F-1) | **VERIFICATION REQUIRED — NOT YET REVERIFIED.** Owner states F-1 was previously resolved; current evidence is mixed (8/14 unit-level failures, unchanged 6 PASS/8 FAIL before and after S64) and no browser verification exists. Reopen only with current evidence; not modified by this documentation task. |
| RC-10 — FFS internal timeline events | **CANCELLED FUNCTIONALITY — REMAINING VISIBILITY RISK.** FFS was cancelled (owner decision 2026-10-14, `docs/phase1/final-delivery/P1-FA02_FFS_UI_DEACTIVATION.md`). No FFS feature will be restored. Residual risk: current test evidence shows the cancelled internal FFS event type is still emitted by `buildTimeline` (`src/lib/jobfile.core.ts`) into user-facing timelines/job packs (4+1 failing cases in the triage report). Recorded as a visibility risk for the release owner to weigh; not treated as a restored Phase 1 requirement. |
| Test suite | 3,603 PASS / 160 FAIL / 38 SKIP (all 160 pre-existing; 0 new regressions at `c5cbd3a3` vs `28765b50`; see triage report). The 160 failures are dominated by stale pins against the owner-directed Enquiries rollback (RC-3, 40), superseded agreement copy (RC-6, 26), and closed Communications streams (RC-7, 15) — none reopened. |
| Database release gate | **PASS** (C12 above, evidence limits preserved). |
| S64 verification | **CLOSED / PREVIEW VERIFIED / PRODUCTION RELEASE PENDING.** Production-domain running version NOT verified. |

## C. Deferred to Phase 2

- **RC-2 — Mitti Ready Check ownership guard:** DEFERRED — PHASE 2 (Mitti integration is Phase 2; not Phase 1 mandatory work despite historical tests).
- Mitti live integration, Xero live tenant, VEEC automation, advanced PIESA scheduling (per `P1-R1_PHASE1_RELEASE_RECOVERY.md` §C-6 and deployment notes).

## D. Cancelled functionality (not restored, not a Phase 1 requirement)

- **FFS** — cancelled by owner decision 2026-10-14; UI deactivation implemented; backend artifacts preserved unchanged; see RC-10 residual visibility risk in §B.

## E. Known limitations (documented, non-blocking)

1. Preview and Production share one Supabase backend (`wvuffpykgnqliikhodzl`); no isolated cloud staging project (C11 residual).
2. Migration 0149 status is `REPORTED_PRODUCTION` only (C12 residual).
3. `waitUntil` fallback mitigates but does not verify production background processing (C13 sub-item).
4. Production-domain running version has never been verified (S64 residual).
5. Test-harness: `bun run test` crashes on unbounded output from `register-interest-validation.test.tsx` (triage report RC-5); per-file harness used for the 2026-10-20 totals.
6. Enquiries/list performance source-pin tests (RC-3, 40 cases) pin the rolled-forward implementation that the owner deliberately rolled back on main.

## F. Production deployment authorization

- **Production Publish: NOT PERFORMED and NOT authorized by any documentation task.**
- Deployment is gated solely on **C13**: owner's written approval of release scope and timing, followed by Publish and non-destructive production verification.
- **Overall verdict: PRODUCTION RELEASE PENDING — NOT READY TO PUBLISH** while RC-1 (in-scope PIESA authorization defect, fix unverified on main) remains open and C13 owner approval is outstanding. This register must not be read as "READY TO PUBLISH".

*Historical reports with superseded current-status statements retain their original text; supersession references have been added to `P1-R1-S67_RC1_INTEGRATION_AND_RELEASE_READINESS.md`, `P1-R1-S69_PRODUCTION_MIGRATION_RECONCILIATION.md`, `P1-R1_P0_S64_INTEGRATION_AND_PHASE1_DEFECT_FIXES.md`, `docs/phase1/uat/PIESA_S64_VERIFICATION_2026-10-20.md` and `docs/phase1/final-delivery/P1-FA02_FFS_UI_DEACTIVATION.md`.*
