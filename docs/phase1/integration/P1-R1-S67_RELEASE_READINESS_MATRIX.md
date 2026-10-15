# P1-R1-S67 · RELEASE READINESS MATRIX (S72 audit)

**Step:** P1-R1-S72-S67-FINAL-INTEGRATION-AUDIT-AND-HANDOFF-01 · **Executor:** R2 · **Date:** 2026-10-16 AEDT
**Branch:** `integration/p1-rc1-s67` · **HEAD:** `38fb2a47ab322f7f0b5b26aed33267f9498b1107` · **tree clean**
Milestones are kept **separate** — IMPLEMENTED ≠ TESTED ≠ BROWSER_VERIFIED ≠ PRODUCTION_DEPLOYED.

## 1. Component integration status (verified against git + source, not summaries)

| Component | Source commit(s) | In HEAD? | Integration evidence | Status |
|---|---|---|---|---|
| **COM04** Save-My-Spot comms safety | baseline `d49af17e` + guard `9a0adf29` | ✅ | `realSendingOn()` requires `save_my_spot_real_send_enabled && customer_comms_enabled` (both default OFF); `0205` migration default false; runtime guards enforced | **INTEGRATED** |
| **COM08** eight Jo email templates | `b2dcc567` | ✅ | `src/lib/jo-email-templates.core.ts` (renderers + `selectJoTemplate` deterministic routing, saved-pricing snapshot); part of 3188-pass suite | **INTEGRATED / TESTED** |
| **COM09** Personal Estimate + Ready Check CTA | `b7298214` (impl) + `499ffe758d` (report) | ✅ | `/my-estimate/{token}` route, `estimate.$token.*`, `personal-estimate.{core,functions,server}` token-validated read-only resolver + Template-8 snapshot builder | **INTEGRATED**; send **NOT WIRED** (see §3) |
| **S65** Enquiry environment remediation | `57637837` + `aee3bc05` | ✅ | `src/lib/enquiry.server.ts` present (qa_test + base44 intake/consent path integrated onto baseline) | **INTEGRATED (code)** |
| **S64** Electrician basic result | `53b44d4d` (branch `r2/p1-rc1-electrician-basic-result`) | ❌ **NOT_INTEGRATED** | not an ancestor of HEAD; no `ElectricianManualResult` in `src` | **ABSENT** |
| **S66** DEF07 invalid PIESA snapshot | — | ❌ | no commit in any ref | **NOT COMPLETED / ABSENT** |
| **S69** Migration reconciliation | `18305b56`,`1b2f495b`,`38fb2a47` (cp of `afe67dd9`,`590b8379`) | ✅ | docs + `0205` `ADD COLUMN IF NOT EXISTS`; journal untouched idx148; 0149/0202=REPORTED_PRODUCTION | **INTEGRATED** |
| **S70** Tracked `.env` hygiene | `976fef82`,`1eac14db` (cp of `2958aa56`) | ✅ | `.gitignore` rules + `.env.example`; `.env` still tracked (untrack deferred) | **INTEGRATED (partial: untrack deferred)** |

## 2. Release-readiness dimensions

| Dimension | Automated evidence | Browser evidence | Blockers | Release readiness |
|---|---|---|---|---|
| Code integration completeness (COM04/08/09/S65/S69/S70) | tsc PASS; build PASS; suite 3188/3 | none | S64 & S66 not integrated; COM09 send not wired | **PARTIAL** |
| Communications safety (COM04) | suite incl. s20r01 OFF/backlog-worker tests | not run | 3 s20r01 tests outdated vs guard (prod is safer) | **IMPLEMENTED + TESTED (fail-closed preserved)** |
| RLS / authorization / consent | consent + idempotency + suppression tests pass | not run | S66 statutory-snapshot item open | **PARTIAL** |
| Migrations (0149/0202/0203/0205) | isolated rehearsal PASS | n/a | prod not independently verified; 0203/0205 not applied | **STAGED / NOT READY** |
| Production configuration | `.env` public-only (S70) | n/a | `.env` untrack deferred (Lovable Cloud dependency) | **NOT DEPLOYED** |
| Local UAT environment | — | — | **no env-guard + hosted `.env`** → startup unsafe; S64 launcher absent | **BLOCKED** (see §4) |
| Browser acceptance | — | **NOT EXECUTED** | needs safe local stack + fixtures | **NOT STARTED** |

## 3. COM09 Template 8 — IMPLEMENTED vs WIRED vs BROWSER_VERIFIED
- **IMPLEMENTED:** read-only personal-estimate route/resolver + immutable Template-8 saved-pricing snapshot
  builder (`personal-estimate.server.ts`), token authorization + expiry, frozen saved pricing (no
  recalculation), no automatic booking on open, no duplicate Ready Check acceptance — all present in code.
- **WIRED:** **NO** — the send orchestration (`jo-email-templates` / `hot-leads*` / `lead-email-routing`)
  does **not** import/call the new snapshot builder; Template 8 delivery is not connected to it. This matches
  COM09's own caveat.
- **BROWSER_VERIFIED:** **NO** (no browser execution this task).

## 4. Local UAT startup assessment (action §6)
**Local application start is NOT currently safe on this worktree:**
- `src/integrations/supabase/env-guard.ts` is **absent** in this branch, and the tracked `.env` resolves to
  the **hosted** `wvuffpykgnqliikhodzl.supabase.co` (production). A plain `vite dev`/preview against it would
  repoint the app at **production** — exactly the prohibited condition.
- No verified loopback-only runtime config exists here; the running local Supabase stack is the shared
  prod-ref deployment and **must not** be reset/reused.
- Communication switches are confirmed OFF (`customer_comms_enabled=false`, `save_my_spot_real_send_enabled`
  default false / `0205` not applied) → real sends are gated, but that does **not** make startup safe.
- S64 launcher (`P1-R1-S64_LOCAL_LAUNCH_SCRIPT.sh`) not present in HEAD (S64 not integrated).
- **Conclusion:** browser UAT requires a freshly-provisioned, isolated loopback runtime (dedicated
  Supabase stack on non-colliding ports + local migrations + synthetic fixtures), coordinated so it does not
  touch the shared stack. That setup does **not** exist for this HEAD → **LOCAL_UAT_ENVIRONMENT = BLOCKED**.

## 5. Milestone verdicts (kept separate)
- **INTEGRATION COMPLETE?** NO — PARTIAL (S64, S66 absent; COM09 send not wired).
- **LOCAL UAT READY?** NO — blocked (unsafe startup env, fixtures/migrations not stood up).
- **BROWSER ACCEPTED?** NO — not executed.
- **PRODUCTION RELEASE READY?** NO — migrations unverified in prod; `.env` untrack deferred; deployment out of scope.

**Verdict: `S67_INTEGRATION_PARTIAL` / `S67_INTEGRATION_COMPLETE_UAT_BLOCKED`** (see final response).
