# P1-R1-S81 — S67 Recovery, S74 DEF-07 Integration & RC1 UAT Handoff

**Step:** P1-R1-S81 (attempt 01) · **Executor:** R1 (Lead Developer)
**Date:** 2026-10-16 AEDT · **Priority:** P0
**Integration branch / worktree:** `integration/p1-rc1-s67` @ `wt-p1-rc1-s67-integration`

## A. Recovered S67 baseline (verified, not assumed)
- **Actual pre-task HEAD:** `61dc22140d110588a93753fa3de1fc6bfeebf885` (verified via `git rev-parse`; the brief's
  caution to re-verify was honoured — it had **not** moved beyond the historical `61dc2214`).
- **Working tree:** clean (0 uncommitted changes) — no other agent's active work at risk.
- **Prior integrated commits (ancestry from COM04 `d49af17e`):** `b2dcc567`(COM08) → `b7298214`+`499ffe758d`(COM09)
  → `57637837`+`aee3bc05`(S65) → `976fef82`+`1eac14db`(S70) → `18305b56`+`1b2f495b`+`38fb2a47`(S69) → `61dc2214`(S72 audit).
- **Branch safe to modify:** YES — it is R1's own integration branch and this step (S81) is explicitly authorised for
  controlled local cherry-picks + local commits on it. (Not `main`; not another agent's worktree.)

## B. Original S67 completion evidence (preserved, not overwritten)
`docs/phase1/integration/P1-R1-S67_RC1_INTEGRATION_AND_RELEASE_READINESS.md` retains the S67 body + the S70 and S69
addendum sections + the S72 master status (§15–20). Not retrospectively altered; new work is recorded here under S81.

## C. Actual pre-task HEAD: `61dc2214` (see A).

## D. S74 integration decision — INTEGRATE (was absent)
- Verified `188a1ffb` exists; **not** an ancestor of S67; `src/lib/official-forms.core.ts` lacked the guard;
  `tests/def07-…` absent. `188a1ffb`'s parent == S67 HEAD `61dc2214`, so a clean cherry-pick was compatible.
- **No conflicting later change** to `official-forms.core.ts` on the branch. → **Cherry-picked.**

## E. S74 source commit: `188a1ffb8188ff952589b827d4b98fd1622adcec` (branch `cloud/p1-s74-def07-remediation`).

## F. New integration commit: `035ad23c` — `git cherry-pick -x 188a1ffb` (clean, provenance preserved).
Carried in: `src/lib/official-forms.core.ts` (DEF-07 guards), `tests/def07-malformed-signed-snapshot.test.ts`,
`docs/phase1/runcloud/P1-CLOUD-S74_…md`.

## G. DEF-07 regression results (on the integration branch, this execution)
- `bun test tests/def07-malformed-signed-snapshot.test.ts` → **10 pass / 0 fail** (T01–T10).
- Verified fail-closed for: undefined/null/non-array/`{}` document → `{}` (no throw); malformed rows skipped;
  missing/unknown form key → `snapshotProblems` reports invalid (no throw); **valid round-trip intact**;
  `evaluatePiesa({})`/`evaluatePiisa({})` yield `REQ:*` blockers → an invalid snapshot **cannot** satisfy
  statutory compliance or progress a job; no fabricated content; pure/deterministic (no input mutation).
- S74 tests **not** modified to force a pass.

## H. Email test root-cause analysis (s20r01 — 3 failures)
**Finding: an unresolved specification conflict — NOT a fail-closed regression. Correction intentionally NOT
applied (§7 STOP rule).**
- Commit `9a0adf29` "enforce runtime guards for save my spot sends" **replaced** `realSendingOn()` from
  `return SAVE_SPOT_REAL_SEND_APPROVED` (hard-coded true → Save-my-spot sent even with the master switch OFF)
  to `return save_my_spot_real_send_enabled === true && customer_comms_enabled === true` (fail-closed).
- The three failing tests all assert the **Save-my-spot outcome sends while `customer_comms_enabled=false`**:
  1. "automatic enquiry emails OFF (production today) › only the already-approved Save my spot goes"
     — expects `L.sent=true`/`calls=[KEYS.L]`; actual `sent=false`, 0 calls.
  2. "automatic enquiry emails ON – new enquiry › each outcome sends its email ONCE" — expects `L.sent=true`;
     actual false (L is first in the loop, so B/I assertions never reached).
  3. "…a repeated decision never sends a second email" — expects `calls.length==3`; actual 2 (L never sent).
- **Conflict:** the **locked S20-R01** rule (src/lib AGENTS.md) says the router's Save-my-spot outcome *may go with
  the master switch OFF* while `customer_delivery_settings.enabled=true`; **COM-04 `9a0adf29`** now requires the
  master **and** the save-my-spot switch. These two authoritative rules disagree specifically about Save-my-spot.
  (Group-B/ineligible and all OFF/backlog/suppression/idempotency assertions are consistent and pass.)
- **Direction is safe:** the guard makes the app send **less** (more fail-closed); it is not a communications-safety
  hole. The tests still encode the pre-COM-04 exemption.
- **Resolution requires an owner/Jo decision:** either (a) Save-my-spot is now gated by both switches → update the
  3 test expectations + the S20-R01 rule wording, or (b) Save-my-spot must remain a master-OFF exception → the
  COM-04 guard must be amended (a security-control change). I will **not** guess a communications-authorization
  behaviour, weaken a guard, or edit comms assertions to force green. **Recorded as an explicit blocker.**

## I. Additional local corrections: none (email tests left untouched by design; see H).

## J. Full test results (THIS execution — not reused from S74)
- **TypeScript** `bunx tsc --noEmit`: **PASS**.
- **Build** `bun run build`: **PASS**.
- **Full isolated suite** `bun run test`: **335 files · 3198 pass · 3 fail · 0 skipped · ~169s**.
  Sole failing file: `tests/s20r01-automatic-enquiry-emails.test.ts` (the 3 tests in H). DEF-07 (10), and all
  PIESA/PIISA/official/auth/comms/idempotency/backlog tests pass.

## K. Remaining release blockers (classified; verified against actual refs)
| Blocker | Status | Evidence / next owner |
|---|---|---|
| S64 Electrician basic result | **NOT_INTEGRATED** | `53b44d4d` on `r2/p1-rc1-electrician-basic-result`; not an ancestor. R1 to verify+cherry-pick. |
| S66 DEF07 | **CLOSED by S74** | S74 integrated (`035ad23c`); no separate S66 exists. |
| S69 migrations → production | **BLOCKED (prod unverified)** | 0149/0202 = REPORTED_PRODUCTION (not independently verified); 0203/0205 staged. Owner + Lovable controlled apply. |
| S70 `.env` untrack | **BLOCKED (dependency unresolved)** | `.env` still tracked; untrack deferred on Lovable Cloud build-env confirmation. |
| S75 UAT env readiness | **UNKNOWN / IN-PROGRESS** | branch `r2/p1-rc1-s75-uat-env-readiness` exists, not integrated; no handoff evidence → readiness NOT claimed. |
| S77 UAT preparation | **UNKNOWN** | branch `uat/p1-r6-s77-prep` exists; no completion evidence → NOT claimed. |
| S63 quote UAT | **UNKNOWN** | branch `r6/p1-s63-quote-uat`; not integrated; no claim. |
| 3 email tests (s20r01) | **BLOCKED_PENDING_DECISION** | S20-R01 vs COM-04 spec conflict (H). Needs Jo/owner decision. |
| Shared-local-DB fixture `82000000-…02a1` | **NOT MODIFIED (correctly)** | §10 below; owner-approved isolated fixture recommended. |
| Local UAT startup | **BLOCKED** | this branch has no `env-guard.ts` and tracked `.env` → hosted; a plain dev start would repoint to production. |

## L. UAT entry criteria (for the frozen RC1 candidate)
Recommended before formal browser UAT (which uses **only R6**, on this same frozen SHA):
1. Provision an **isolated** local Supabase (non-colliding ports) with an explicit loopback config — never the
   shared/prod-ref stack (`:54321/:54322`) and never `vite dev` against the hosted `.env`.
2. Confirm `customer_comms_enabled=false` and `save_my_spot_real_send_enabled=false` (COM04 OFF) in the UAT DB.
3. Apply the required local migrations (0149/0202/0203/0205 state) to the isolated DB (not shared).
4. Use an **isolated synthetic valid** PIESA/PIISA signed fixture + the malformed fixture for fail-closed checks
   (do not touch the shared `82000000-…02a1` row).
5. Owner resolves the s20r01 Save-my-spot spec conflict (or accepts it as a known non-green with documented intent).
6. S64 electrician integrated + authenticated/owner-account-linking flow verified end-to-end.
7. R6 signs the UAT entry checklist; task labelled **REQUIRES BROWSER ACCESS**.

## M. Final candidate SHA (RC1, docs-only S81 commit on top of the S74 code integration)
`035ad23cd2d458169cdcd0ef80758b8c27efec47` is the code-frozen candidate (COM04/COM08/COM09/S65/S69/S70/S74);
the S81 report commit sits atop it (docs-only, no runtime change). Formal browser UAT must pin this SHA.

## N. Files changed (S81)
- Report only: `docs/phase1/runr1/P1-R1-S81_S67_RECOVERY_S74_INTEGRATION_AND_RC1_HANDOFF.md` (NEW).
- Code/tests came in via the S74 cherry-pick `035ad23c` (already in the branch): `src/lib/official-forms.core.ts`,
  `tests/def07-malformed-signed-snapshot.test.ts`, `docs/phase1/runcloud/P1-CLOUD-S74_…md`. No other code change.

## O. Production-write confirmation
**ZERO.** No production DB writes/DDL/DCL/migration, no production config change, no real email/SMS, COM04 real
sending left OFF, no shared-local-DB modification (fixture `82000000-…02a1` untouched), no statutory record
altered, PIESA/PIISA gates intact.

## P. Push/deployment confirmation
**NONE.** No git push, no merge to main, no deployment. All work is local commits on `integration/p1-rc1-s67`.
(Reminder honoured: browser access is R6-only; no browser UAT started by R1.)

## D1 (owner read-only production verification, per S81 §9)
Owner independently confirmed live production `link_confirmed_owner_account(uuid,text)`: owner `postgres`,
SECURITY DEFINER true, body md5(prosrc) `7c71bae1479e5c5b9288afe9b05cf110`, **anon EXECUTE=false,
authenticated EXECUTE=false, service_role EXECUTE=true**, ACL `{postgres=X/postgres,service_role=X/postgres}`,
both auth triggers (`on_auth_user_created`→`handle_new_user`, `on_auth_user_email_confirmed`→
`handle_user_email_confirmed`) enabled and definer-bound. This matches the validated remediation target
(sha `a55a3fa5…`). **D1_STATUS = D1_PRODUCTION_SECURITY_VERIFIED.** No S68 forward SQL required/executed;
production permissions were not modified by R1. Functional authentication regression remains for unified UAT.

## Final verdict
**RC1_INTEGRATED_WITH_BLOCKERS** — S67 baseline recovered, S74 DEF-07 cleanly integrated and verified
(10/10), tsc + build green, full suite 3198/3 (only the s20r01 comms spec-conflict). Not declaring
READY_FOR_UNIFIED_UAT: S64/S75/S77/S63 not integrated/verified, safe isolated UAT runtime not provisioned,
the s20r01 Save-my-spot conflict awaits an owner decision, and migrations remain REPORTED-only in production.
