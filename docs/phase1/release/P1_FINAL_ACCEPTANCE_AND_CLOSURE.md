# PHASE 1 — FINAL ACCEPTANCE AND CLOSURE

- **Project:** Home Insulation Victoria
- **Phase:** Phase 1
- **Date:** 2026-10-20 (Australia/Melbourne)
- **Mode:** Autonomous execution — remediation + verification, then closure decision
- **Status of this document:** This is the **Phase 1 technical acceptance record**. It states what was
  verified, by what evidence, and what remains outside technical acceptance. It does **not** authorise a
  production deployment.

---

## 1. Final Git SHA

| Item | Value |
|---|---|
| Baseline on entry | `origin/main` = `fa0d1139240738d51105d3e473d7392a579aa356` (confirmed HEAD; no later commits) |
| Correction commit | `c22adf2e468840370bec813d8c76f675e9022869` — `fix(p1): restore Ready Check ownership guard and harden signed snapshots` |
| Files in the correction | 4 (`src/lib/official-forms.core.ts`, `src/lib/ready-check-draft.server.ts`, `src/lib/workflow.server.ts`, `src/components/portal/panels.tsx`) — +65 / −5 |
| Working tree at verification | clean |
| Closure documentation | the commit immediately following `c22adf2e` (this file + release-status update) |

Verified corrections from the earlier Team A pass are already on `origin/main`:
`63ef6cae` (RC-1), `fa0d1139` (RC-4, RC-10). Nothing was force-pushed.

---

## 2. Five-role acceptance verdict

Evidence below is from the isolated local suite (loopback Supabase env, PGlite / disposable Docker stack),
run per file in its own process. **No browser verification was performed in this task**, and no write-path
test was run against the shared Preview/Production Supabase backend.

| Role | Essential workflow | Evidence | Verdict |
|---|---|---|---|
| **Office / Admin** | job visibility, status, next action, assignments, blockers | `office-status` 58/59 · `office-final-uat` 5/9 · `office-list-server-paging` 9/16 · `postintake-health` 3/4 · `BlockersPanel` restored (Ready Check fact + "stage checks only" wording) | **PASS** (remaining cases are stale pins against the owner-directed Enquiries rollback — §4 RC-3) |
| **Installer** | assigned jobs, Ready Check draft → submit, evidence gate, progress | `brief-n-ready-check-success` 37/37 (standalone) · `brief-o-ready-check-delivery` **17/17** · `installer-onboarding-pages` 10/11 · `ffs-field-access.step36` 14/15 | **PASS** |
| **Electrician** | PIESA recording, PIESA completion, authorization, future-date guard | `a4-step80-regulated-result-authz-db` **38/38** · `a4-clearance-guard` **9/9** · `brief-s-f1-piesa-advance` **14/14** · `p1-s64-date-payment-rules` 19/19 · `p1-s64-date-payment-regressions` 19/19 · `piesa-future-date-runtime` **10/10** · `def07-malformed-signed-snapshot` **10/10** | **PASS** |
| **Owner** | job information, quote visibility, terminal-route behaviour | `save-spot-uncertain-delivery` 30/31 · `owner-job-route-terminal` 5/8 · `owner-calculator` 2/3 · `no-size-save-journey` 5/8 | **PASS** (remaining cases are stale copy/source pins — §4 RC-9) |
| **Business Admin** | permissions, least privilege, cross-business isolation | `business-owner-only` **19/19** · `profiles-least-privilege-db` **5/5** · `step82-cross-business-access-db` **6/6** · `trade-job-access-db` **4/4** · `onboarding-security` **21/21** · `security-review` **9/9** · `portal-routing` **4/4** | **PASS** |

**Role isolation specifically:** `brief-o` 5a/5b prove cross-business reads are refused by RLS, not by the UI
(assigned installer reads the job's Ready Check, the other business reads nothing); `step82` and
`trade-job-access-db` cover cross-business and trade job access; `profiles-least-privilege-db` covers profile
visibility.

**Known evidence gap (disclosed, not papered over):** `a3-a4-role-isolation-db.test.ts` cannot execute — it
imports `intakeProgressGate` from `src/lib/installer-progress.core.ts`, an export removed by the owner-directed
Enquiries rollback. The file therefore contributes 1 module-load failure and 0 executed cases. Role isolation is
still verified by the four suites listed above, but this file's own cases carry **no** evidence.

**Payment representation:** S64 suites confirm the safety-check payment is represented as simulated/unpaid
(`TEST payment (simulated)`, "not paid", "$0.00 paid to date") and that the future-date guard holds. No real
payment path was exercised.

---

## 3. RC-1 / RC-4 / RC-10 status

| ID | Defect | Status | Evidence |
|---|---|---|---|
| **RC-1** | Manual PIESA could be recorded without electrician authorization | **FIXED AND VERIFIED** (`63ef6cae`) | `clearanceRecorderAllowed` guard wired into `saveAssessment`, `completeAssessment`, `recordPiesa`, `submitDeclaration`, each before any DB access, fail-closed on RPC error. `a4-clearance-guard` 9/9 + `a4-step80` 38/38 = **47/47**. Guard positions independently re-checked this session. |
| **RC-4** | A completed manual PIESA never advanced `piesa_scheduled` | **FIXED AND VERIFIED** (`fa0d1139`) | `advanceSiteRequirements` now dispatches `piesa_scheduled` → `advanceAfterPiesa`, which applies `piesaAdvanceDecision` and the existing `transition("piesa_complete")`. Holds on incomplete assessment / missing outcome / missing current PIESA record. `brief-s-f1-piesa-advance` **14/14**, including the idempotency case ("running again after the move does nothing"). No duplicate transition, structurally proven: `completeAssessment`'s `piesa_scheduled` branch returns before ever calling `advanceSiteRequirements`. |
| **RC-10** | Cancelled FFS field-progress events visible to users and in job packs | **FIXED AND VERIFIED** (`fa0d1139`) | Filter restored at the single presentation boundary: `buildTimeline()` drops `FFS_PROGRESS_EVENT`, which covers the Office timeline, all four role History timelines **and** `timeline.json`/`timeline.csv`; `TimelinePanel` filters the same type for admins. `p1-fa02-ffs-ui-deactivation` **11/11**; `ffs-minimum-results` TEST 9 green. Stored rows and the dormant write path untouched; no FFS feature restored. |

**Two additional defects closed in this task** (both regressions from the same `bdf1da3c` overlay, both
verified):

| ID | Defect | Status | Evidence |
|---|---|---|---|
| **RC-2** | A Mitti-owned Ready Check could be edited/submitted through the portal | **FIXED AND VERIFIED** (`c22adf2e`) | `43dfc9fb` (Brief O) added `readyCheckState()`, the `fromMitti` fact and both refusal guards; `bdf1da3c` deleted exactly those lines (`git log -S` returns only those two commits per symbol). Restored: `saveRcDraft`/`submitRcDraft` refuse a row with `external_mitti_id` before any write; `loadRcDraft`/`readyCheckState` report `fromMitti`; `nextStepBlockers` returns the Ready Check fact and `BlockersPanel` states that a clear stage check is not proof the work is done. `brief-o-ready-check-delivery` **17/17** (was 10 fail). Guard only — no sync, no Mitti calls, no new surface. |
| **RC-8 / DEF-07** | A malformed signed PIESA/PIISA snapshot threw instead of failing closed | **FIXED AND VERIFIED** (`c22adf2e`) | `answersFromDocument` called `doc.filter()` unguarded; seven production callers feed it a database row, including `hazardState`/`hazardBlockers` (the PIESA completion gate), the PIISA evaluator, the prestart check and the form prefill. A damaged or legacy row crashed the statutory gate with a `TypeError`. Now: non-array document → `{}`, malformed rows skipped, `snapshotProblems` reports invalid instead of throwing. Valid snapshots unchanged. `def07-malformed-signed-snapshot` **10/10** (was 6 fail). A prior fix (`188a1ffb`, branch `cloud/p1-s74-def07-remediation`) existed but was never merged; this is the same correction. |

**Blast-radius assessment for RC-8** (the question the acceptance rule asks): malformed snapshot data could
cause (a) **critical workflow failure** — yes, an unhandled `TypeError` on the PIESA completion gate and the
PIISA evaluator; (b) **loss of usable signed evidence** — yes, an unevaluable copy cannot be read or reported;
(c) security exposure or data corruption — no. Because (a) and (b) are real, the defect was fixed rather than
deferred.

---

## 4. Remaining test failures, grouped by root cause

Final measured state: **374 files, 3,727 registered tests, 119 failures across 37 files.** Every failure is
accounted for below; nothing is omitted or reclassified as passing.

| Group | Class | Cases | Files | Why it is not a Phase 1 blocker |
|---|---|---|---|---|
| **RC-3** — owner-directed Enquiries rollback vs stale pins | **C** (obsolete test) / **B** (non-blocking test defect) | 40 | `enquiries-page-performance` 18, `office-list-server-paging` 7, `office-final-uat` 4, `a3-a4-role-isolation-db` 1, `a3-intake-progress-access` 1, `brief-x-piesa-stage-gate` 1, `enquiry-search-postgrest-or` 1, `ffs-field-access.step36` 1, `ffs-minimum-results` 1, `installer-progress` 1, `p1-r1-s104-unified-integration` 1, `postintake-health` 1, `status-label-unify` 1, `transfer-reconcile` 1 | `28765b50` deliberately rolled Enquiries back to the pre-consolidation baseline. Six files fail at import on exports the rollback removed (`intakeProgressGate`, `intakeProgressApplies`, `statusLabel`, `reconcileBase44Transfers`, `ownerStageGateBlockers`); the rest pin markers/copy from the rolled-forward implementation. Re-pinning or restoring would reopen a closed workstream. |
| **RC-5** — register-interest per-field error UX | **C** (obsolete test) | 18 | `register-interest-validation` 18 | The live component validates every field but renders one error banner; the tests assert per-field marks and simultaneous messages. This is a product-UX decision, not a validation defect — the validation logic is present. |
| **RC-6** — agreement / contract copy superseded | **C** (obsolete test) | 26 | `activity48-agreement-signing` 19, `installer-warranty-signing` 5, `rec-onboarding` 1, `no-lead-fee` 1 | `toContain` assertions against clause wording superseded by agreement version `HI-VIC-A48-REC-2.5-2026-10-05`. The generated text is complete and internally consistent; the pins are stale. Re-pinning needs the owner to confirm the approved text. |
| **RC-7** — Communications / Email Templates behaviour drift | **D** (cancelled workstream) | 15 | `group-b-prehandoff` 6, `existing-insulation-send` 2, `lifecycle-emails` 2, `group-b-declaration-routing` 1, `jo-email-size-and-branding` 1, `no-insulation-review` 1, `office-status` 1, `save-spot-uncertain-delivery` 1 | Owner-closed workstreams. The mismatches are in send-gating sequences and catalogue previews; **no failure opened a send path** — they are about blocking/reservation behaviour differing from the pinned sequence. No security issue demonstrated. |
| **RC-9** — miscellaneous stale copy / source pins | **C** (obsolete test) | 19 | `pricing-cohort` 4, `owner-job-route-terminal` 3, `no-size-save-journey` 3, `brief-e-silent-action-feedback` 3, `official-forms` 2, `installer-onboarding-pages` 1, `intake-sequence` 1, `owner-calculator` 1, `partner.core` 1 | `toContain` / `toMatchObject` mismatches on rendered copy and source shape superseded by later refactors. `official-forms` 2 cases are PIISA mapping/template-version pins, unchanged at 43/2 on both baselines. |
| **F** — shared-fixture race | **F** (test infrastructure) | 1 | `brief-n-ready-check-success` 1 | Passes **37/37 standalone**. Under the 8-way concurrent suite its fixture seeding collides on `job_assignments_active_uq` against the shared disposable Docker stack. `brief-o` is affected the same way (0/1 in-suite, 17/17 standalone). |
| **Totals** | | **119** | 37 | 40 + 18 + 26 + 15 + 19 + 1 = 119 — exact |

**No confirmed P0/P1 Phase 1 defect remains.** The four defects the triage classified as must-fix (RC-1, RC-2,
RC-4, RC-10) plus the statutory-path robustness defect (RC-8) are all fixed and verified.

**Not dismissed as "pre-existing":** each group above is classified on current evidence — reproduction, code
inspection and `git log -S` — not on the fact that it predates the latest commits. Two groups that *were*
labelled pre-existing (RC-2, RC-8) turned out to be genuine defects and were fixed.

---

## 5. Test-count reconciliation

The two figures in circulation were **3,609 pass / 138 fail** (the earlier audit) and **3,592 pass / 135 fail**
(after the Team A pass). Neither number was safe to compare directly, because the *registered test total*
varies between runs.

Measured with one instrumented runner (per-file, own process, canonical isolated env, per-file pass/fail/exit
recorded) at four points on the same history:

| Commit | Pass | Fail | Registered total |
|---|---|---|---|
| `63ef6cae` (RC-1 fixed) | 3,579 | 148 | 3,727 |
| `fa0d1139` (RC-4, RC-10 fixed) | 3,592 | 135 | 3,727 |
| `c22adf2e` before RC-2 | 3,598 | 129 | 3,727 |
| `c22adf2e` (final) | **3,608** | **119** | **3,727** |

**The failure count is the reliable metric, and it moves by exactly the number of cases fixed:**

- `63ef6cae` → `fa0d1139`: 148 → 135 = **13** = RC-4 (8) + RC-10 (5). ✔
- `fa0d1139` → before RC-2: 135 → 129 = **6** = RC-8. ✔
- before RC-2 → final: 129 → 119 = **10** = RC-2. ✔
- `63ef6cae` → final: 148 → 119 = **29** = 8 + 5 + 6 + 10. ✔

**Why the PASS count appeared to fall** (3,609 → 3,592, −17): it did not. The registered total moved.

- The project's own runner (`bun ./scripts/test-isolated.ts 8`) reports **3,628 / 119 / total 3,747** at the
  final tree; the instrumented runner reports **3,608 / 119 / total 3,727**. Both agree on **119 failures** and
  on the failing-file set.
- The 20-test difference is in *registration*, not outcome: a file whose test count depends on runtime fixture
  availability (`brief-n-ready-check-success`, 37 cases, or a file that aborts mid-run) contributes differently
  across runs. No file reports zero tests in the instrumented run, so the accounting is complete for that scope.
- The earlier audit's total (3,609 + 138 = **3,747**) matches the project-runner total exactly, i.e. it was a
  scope where 20 more tests registered. Its per-file data was not retained, so its exact composition cannot be
  reconstructed — and its 138 failures are 3 higher than the reproducible 135 at the same commit.
- **Conclusion:** the 3,609 → 3,592 pass "drop" is a registration-scope artifact plus a small measurement
  discrepancy in the earlier audit, **not** lost coverage and **not** a regression. No test file was removed,
  skipped, excluded or re-timed: `tests/` is byte-identical between `63ef6cae` and `fa0d1139`
  (`git diff --stat 63ef6cae..fa0d1139 -- tests/` is empty), and the file count is 374 in every run reported here.

Skips: the suite reports no skipped cases in the final run (0 SKIP). The historical "38 SKIP" figure belongs to
the older triage baseline and is not present in the current run.

---

## 6. Accepted P2/P3 defects

Accepted as non-blocking, with the reason recorded rather than the failure hidden:

1. **RC-3 (40)** — stale pins against the owner-directed Enquiries rollback. Re-pin or archive with the owner.
2. **RC-5 (18)** — single-banner vs per-field error UX. Needs a product decision; validation itself works.
3. **RC-6 (26)** — agreement/warranty clause pins. Needs the owner to confirm the approved agreement text
   (currently `HI-VIC-A48-REC-2.5-2026-10-05`), then re-pin.
4. **RC-7 (15)** — closed Communications / Email Templates workstreams. Recorded only; not reopened.
5. **RC-9 (19)** — miscellaneous stale copy and source pins. Batch re-pin after release.
6. **F (1)** — `brief-n-ready-check-success` fixture race under 8-way concurrency on the shared disposable
   Docker stack. Passes standalone; fix the harness or run it serially.

None of these touches authentication, authorization, role isolation, data integrity, the PIESA/PIISA statutory
path or the payment representation.

---

## 7. TypeScript result

```
bunx tsc --noEmit   →   exit 0, 0 lines of output
```
Run at the final tree (`c22adf2e`), and re-run after each correction.

---

## 8. Production build result

```
env -u NODE_OPTIONS bun run build   →   exit 0
```
Client, SSR and Nitro (cloudflare-module preset) all completed. Artifacts produced and confirmed on disk:
`.output/server/index.mjs`, `.output/public/_headers`, `.output/public/assets`.

Note on the environment: an earlier audit recorded the build as blocked by `CODEBUDDY_BROKER_DENY` during
Nitro's `copyPublicAssets`. That was an artifact of the `NODE_OPTIONS` brokered-`fs` shim injected into the
agent shell, not a repository defect. With `env -u NODE_OPTIONS` the build passes cleanly and reproducibly.

---

## 9. Security verification

| Control | Result |
|---|---|
| Electrician authorization on PIESA writes (RC-1) | Enforced in 4 entry points, before any DB read/write, fail-closed on RPC error — 47/47 tests |
| Role isolation | `step82-cross-business-access-db` 6/6, `trade-job-access-db` 4/4, `profiles-least-privilege-db` 5/5, `brief-o` 5a/5b (RLS refuses cross-business reads) |
| Business-admin permissions | `business-owner-only` 19/19, `onboarding-security` 21/21, `security-review` 9/9, `portal-routing` 4/4 |
| FFS internal data exposure (RC-10) | Filtered at the presentation boundary; no FFS event reaches owner/trade timelines or job packs |
| Malformed statutory input (RC-8) | Fails closed — invalid copy cannot satisfy compliance, cannot progress a job, and no longer raises from a pure core function |
| Ready Check ownership (RC-2) | Portal refuses to write to a Mitti-owned row before any observation is written |
| External integrations | No live Xero, no Mitti calls, no real payments, no customer email/SMS sent during this task |

No authorization, privacy, compliance or data-integrity requirement was weakened to make a test pass. The one
tempting shortcut — adding `businessAdmin` to the `/field` guard to satisfy two source-pin tests — was
**declined**, because that would widen access to a field route; those two cases are classified as stale pins
(§4 RC-3) instead.

---

## 10. Database verification limitations

1. **No production database was read or written in this task.** All evidence is from the local isolated
   environment (loopback Supabase env vars; PGlite; a disposable Docker stack for the Brief N/O harness).
2. **Preview and Production share one Supabase backend** (`wvuffpykgnqliikhodzl`). No write-path UAT was run
   against it, by design.
3. Migration **0149** remains `REPORTED_PRODUCTION` only — never independently verified.
4. Schema presence in production does not prove a complete migration-ledger history.
5. No migration was applied and no production data was modified in this task.
6. The Ready Check / PIESA paths were verified at the server-function boundary with real local rows, not in a
   browser against a deployed environment.

---

## 11. Final technical acceptance verdict

Applying the acceptance rule:

| # | Condition | Result |
|---|---|---|
| 1 | Essential Phase 1 workflows have sufficient verification evidence | **Met** — §2, all five roles |
| 2 | No confirmed P0/P1 Phase 1 defect remains unresolved | **Met** — RC-1, RC-2, RC-4, RC-8, RC-10 all fixed and verified |
| 3 | RC-1, RC-4 and RC-10 verified | **Met** — §3 |
| 4 | Security and role isolation pass | **Met** — §9 |
| 5 | TypeScript passes | **Met** — exit 0 |
| 6 | Production build passes | **Met** — exit 0 |
| 7 | All remaining failures have evidence-based non-blocking dispositions | **Met** — §4, 119/119 accounted for |
| 8 | No critical acceptance requirement remains unverified | **Met**, with the disclosed gaps below |
| 9 | All verified corrections committed and pushed to `main` | **Met** — `63ef6cae`, `fa0d1139`, `c22adf2e` |

**PHASE 1 DEVELOPMENT — CLOSED**
**PHASE 1 TECHNICAL ACCEPTANCE — PASSED**
**PHASE 1 PRODUCTION RELEASE — PENDING OWNER AUTHORIZATION (C13)**

Conditions 8 is met with these **explicit, disclosed gaps** (they do not block technical acceptance; they do
constrain what may be claimed):

- No browser verification was performed in this task. Earlier browser evidence exists for Brief N/O and S64
  Preview, but **the PIESA `piesa_scheduled` → `piesa_complete` transition has never been browser-verified**.
- `a3-a4-role-isolation-db` cannot execute (module-load failure, §2) — its own role-isolation cases have no
  evidence.
- Production-domain running version has never been verified.
- 119 test failures remain, all with a non-blocking disposition (§4); they are **not** zero, and this document
  does not claim a green suite.

---

## 12. Remaining production deployment prerequisites

1. **Owner written approval of release scope and timing (C13)** — administrative gate, not a development task.
2. **Publish Production from the approved commit** — GitHub push does not deploy; Lovable Publish does.
3. **Non-destructive production verification after Publish** — confirm the deployed commit and walk the five
   roles read-only.
4. **One browser pass of the PIESA advance transition** before Publish (currently never done).
5. **Confirm the approved agreement text** so RC-6's 26 pins can be re-pinned.
6. **Decide the register-interest error UX** (single banner vs per-field) so RC-5 can be re-pinned.
7. **Note the shared-backend limitation:** Preview and Production share one Supabase project; there is no
   isolated cloud staging environment. Any Preview write-path testing acts on real database objects.

---

## 13. Explicit C13 authorization status

**C13 — Production release: BLOCKED — OWNER AUTHORIZATION REQUIRED.**

- **Production Publish: NOT PERFORMED.** No deployment, no Publish button, no production data change.
- Technical acceptance closure in this document **is not** production deployment approval and must not be read
  as "READY TO PUBLISH".
- The owner's written approval of final scope and timing remains outstanding, followed by Publish and
  non-destructive production verification.

---

*Historical audit reports and evidence in this directory are preserved unmodified. This document supersedes
only their **current-status** claims; the technical observations in those reports remain valid for the commits
they describe.*
