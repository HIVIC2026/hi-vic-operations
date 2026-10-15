# P1-R1-S67 · PENDING INTEGRATIONS (S72 audit)

**Step:** P1-R1-S72-S67-FINAL-INTEGRATION-AUDIT-AND-HANDOFF-01 · **Executor:** R2 · **Date:** 2026-10-16 AEDT
Items NOT yet integrated into `integration/p1-rc1-s67` @ `38fb2a47`, each with the exact evidence and the
safe next step. **No production writes / deploy / push / merge.**

## P1 — S64 Electrician basic result — **NOT_INTEGRATED**
- **Actual implementation commit:** `53b44d4d` "P1-R2-S64: Electrician basic … capture without Mitti (G-E1)"
  on branch `r2/p1-rc1-electrician-basic-result` (worktree `wt-r2-p1-electrician-basic-result`).
- **Evidence of absence in HEAD:** `git merge-base --is-ancestor 53b44d4d HEAD` = NO; `grep ElectricianManualResult src` = none.
- **Prereq before integrating:** locate + read the S64 implementation report
  (`wt-r2-p1-electrician-basic-result/docs/phase1/run2/P1-R2-S64_ELECTRICIAN_BASIC_RESULT_IMPLEMENTATION.md`),
  re-run its authorization/db + render tests, and verify it preserves the Mitti-linked flow + PIESA stage
  + compliance gates, **then** cherry-pick onto an isolated branch. Owner/R1 to authorize the code integration
  (this audit is verification-only). Recommended executor: R1 (integration owner), source author R2.
- **Browser:** R5 electrician browser UAT has **NOT** been assigned by the owner — do not mark started/completed.

## P2 — S66 DEF07 invalid PIESA snapshot — **NOT COMPLETED / NOT_INTEGRATED**
- No commit or branch for S66/DEF07 exists in any ref. Statutory signed-copy snapshot id
  `82000000-0000-4000-8000-0000000002a1` must **not** be fabricated or edited without a separately authorized,
  reviewed S66 remediation. **Blocker:** the S66 work itself is not present. Recommended executor: R1/owner.

## P3 — COM09 Template 8 send orchestration — **IMPLEMENTED, NOT WIRED**
- Read-only resolver + snapshot builder are in HEAD, but no send path calls the builder. To wire it: a minimal,
  authorized integration into the existing fail-closed manual send workflow (no new automatic-send flow, no
  real delivery). Needs an explicit owner decision + separate authorization. Recommended executor: R3 (comms).

## P4 — S69 migration apply to production — **DEFERRED (prod not verified)**
- `0149`/`0202` are **REPORTED_PRODUCTION** (owner manual applies) — **not** independently verified (no prod read
  access here). `0203` (profiles least-privilege) and `0205` (save-my-spot switch) are **STAGED / NOT_APPLIED**.
  `0205` idempotency now repaired (`IF NOT EXISTS`). Do not mark `0149`/`0202` VERIFIED_PRODUCTION without an
  owner-run independent production schema check. Recommended executor: owner + Lovable AI (controlled apply).

## P5 — `rec_offer_batch_lock` disposition — **UNKNOWN**
- No such migration file exists anywhere in git history; it is a stale 10-Oct label for `0203` (now
  `profiles_least_privilege`). Do **not** reuse/renumber; needs an owner decision to reconcile labels.
  (Numbering hazards `0131`, `0147`, `0110` and the `0149+` staged band require full-filename identification.)

## P6 — S70 `.env` untrack — **DEFERRED (dependency unresolved)**
- `.gitignore` rules + `.env.example` integrated (`976fef82`); `.env` **remains tracked**. The untrack
  (`git rm --cached .env`) is blocked on confirming whether **Lovable Cloud** provides
  `VITE_SUPABASE_URL/project-id/publishable` to its build independently of the committed `.env` (the client
  fails closed without them and the repo has no other source). Resolve that dependency, then untrack and
  confirm `.env` persists on disk. Recommended executor: owner + R3/Lovable.

## P7 — Outdated S20-R01 email tests — **TEST FIX (needs authorization)**
- The 3 red tests assert pre-COM04 behavior; production is correct/more-fail-closed. Smallest safe remediation
  is a **test-only** update (set the COM04 dual switches explicitly per scenario). Requires authorization;
  do **not** relax the runtime guard to force green. See `P1-R1-S67_EMAIL_TEST_FAILURE_ANALYSIS.md`.

## P8 — Local UAT runtime — **NOT ESTABLISHED**
- This worktree has no `env-guard.ts` and a hosted `.env`; a safe browser-UAT stack (isolated loopback Supabase
  on non-colliding ports + migrations + synthetic fixtures) must be provisioned without touching the shared
  prod-ref stack or resetting the shared DB. Required before any browser testing. Recommended executor: R5/R1.

## Summary of pending executors
| Item | Blocks | Next executor |
|---|---|---|
| P1 S64 integrate | code+tests not in HEAD | R1 (+R2 source) |
| P2 S66 DEF07 | work absent | R1/owner |
| P3 COM09 send wiring | not wired | R3 |
| P4 migration prod apply | prod unverified | owner + Lovable AI |
| P5 rec_offer label | unknown disposition | owner |
| P6 `.env` untrack | Lovable Cloud dependency unresolved | owner + R3 |
| P7 stale email tests | red suite | R1 (auth) |
| P8 local UAT stack | unsafe startup env | R5/R1 |
