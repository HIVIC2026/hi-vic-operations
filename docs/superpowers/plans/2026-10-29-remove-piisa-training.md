# Remove PIISA Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installers are never asked for, blocked by, or flagged for "PIISA training" (decision 428).

**Architecture:** Delete the PIISA-training rule from the pure core (`worker-compliance.core.ts`, `readycheck-booking.core.ts`, `installer-onboarding.core.ts`, `partner-profile.core.ts`, `partner-activation.core.ts`), then remove the UI/server pieces that only existed for it. DB columns stay, unread.

**Tech Stack:** TypeScript, TanStack Start server functions, React, Bun tests.

**Spec:** docs/superpowers/specs/2026-10-29-remove-piisa-training-design.md

## Global Constraints

- Do NOT touch the PIISA install-day form (Mitti A5, `piisa-*.ts`, official PIISA docs, crew picker, Final check).
- No migration; `partner_workers.piisa_*` columns stay.
- New copy: "CII certification and public liability insurance (min $5 million)."; office heading "Licences".
- Decision log entry 428.

## Review Focus

- Installer with `piisa_status: "not_done"` already saved → offerable for Ready Checks and allocation (Task 1 test).
- Installer with an uploaded but unverified PIISA certificate → no "to verify" office flag (Task 1 test).
- Sign-up submitted with no PIISA answers → passes validation (Task 2 test).
- Old application data containing `piisa_done`/`piisa_files` → approval still works, nothing copied (Task 2 test).
- Partner profile for an old application with PIISA answers → no PIISA training row or issue lines (Task 2 test).

---

### Task 1: Rules — no PIISA training block or flag

**Files:**
- Modify: `src/lib/worker-compliance.core.ts` (remove `PiisaState`, `piisaState`, piisa fields from `WorkerCompliance`, piisa lines in `approvalFlags`, `workerOfferBlocker`, `missingItems`; `missingItems` return type loses `"piisa"`)
- Modify: `src/lib/readycheck-booking.core.ts` (remove `piisaBlocked` and `INSTALLER_GAP.piisa`)
- Modify: `src/lib/readycheck-booking.server.ts` (stop selecting/reading piisa columns; no `piisaBlocked`)
- Test: `tests/guide-fix-no-piisa-training.test.ts` (new); update `tests/worker-compliance.test.ts`, `tests/esc-collection-notice.test.ts`

**Interfaces:** Produces `missingItems(w): ("licence_expiry" | "esc_notice" | "white_card")[]`; `piisaState` no longer exported (Task 3 must not import it).

- [ ] Step 1: failing tests — `workerOfferBlocker({trade_role:"installer", piisa_status:"not_done"} as never, "2026-10-29")` is `null`; `approvalFlags` for `{piisa_status:"done", piisa_certificate_path:"x"}` contains no string matching `/PIISA/`; `missingItems({trade_role:"installer"})` does not contain `"piisa"`; `installerGapReason` facts no longer accept `piisaBlocked` (source check: `readycheck-booking.core.ts` does not contain `"piisa:"` gap text "PIISA training isn't uploaded").
- [ ] Step 2: run `scratchpad/runone.sh . tests/guide-fix-no-piisa-training.test.ts` → FAIL.
- [ ] Step 3: implement the removals above.
- [ ] Step 4: run the new test + worker-compliance + esc-collection-notice tests → PASS (update old expectations that asserted PIISA training flags/blocks).
- [ ] Step 5: commit.

### Task 2: Sign-up, approval and profile

**Files:**
- Modify: `src/lib/installer-onboarding.core.ts` (drop piisa validation lines ~201–208 and piisa fields on `Installer`)
- Modify: `src/routes/installer-onboarding.tsx` (remove PIISA question, date, warning, upload ~678–683, ~812–813)
- Modify: `src/lib/installer-onboarding.functions.ts` (remove piisa from zod schema and the PIISA certificate upload server fn ~158–185)
- Modify: `src/lib/partner-activation.core.ts` (stop writing `piisa_status`, `piisa_completed_on`, `piisa_certificate_path`)
- Modify: `src/lib/partner-profile.core.ts` (remove `piisa_training` licence row and the 4 issue lines)
- Modify: `src/lib/application-review.core.ts` (copy → "CII certification and public liability insurance (min $5 million).")
- Test: add to `tests/guide-fix-no-piisa-training.test.ts`; update `tests/partner-email.test.ts`, `tests/installer-onboarding-pages.test.ts`, `tests/onboarding-no-repeats.test.ts`, `tests/onboarding-fixes-oct4.test.ts`, `tests/installer-sign-activation.test.ts`

- [ ] Step 1: failing tests — onboarding validation of an installer with no `piisa_done` returns no `installer-0-piisa*` error keys; activation of an application with `piisa_done:"yes"` + `piisa_files` produces a worker row with no `piisa_*` keys; profile of such an application has no licence with `kind === "piisa_training"` and no issue matching `/PIISA/`; review copy equals the new sentence.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run new + listed tests → PASS (update old expectations).
- [ ] Step 5: commit.

### Task 3: Team page, office list, test journey, decision log

**Files:**
- Modify: `src/components/portal/worker-compliance.tsx` (remove PIISA MissingLine, awaiting line, `PiisaForm`; office heading "Licences"; remove Verify/file for PIISA)
- Modify: `src/lib/worker-compliance.functions.ts` (remove `piisaUploadSlot`, `savePiisa`, `officeVerifyPiisa`, `officePiisaFileUrl`, piisa columns and fields)
- Modify: `src/lib/journey-setup.server.ts` (remove PIISA upload/verify step and `piisaState` import)
- Modify: `docs/JO_DECISIONS_LOG.md` (append 428)
- Test: add source checks to `tests/guide-fix-no-piisa-training.test.ts`: `worker-compliance.tsx` has no "PIISA"; `worker-compliance.functions.ts` exports none of the four removed fns.

- [ ] Step 1: failing source-check tests. Step 2: run → FAIL. Step 3: implement. Step 4: `bunx tsc --noEmit` clean for touched files + tests PASS. Step 5: commit.

### Task 4: Whole-suite check

- [ ] Run every test file on this branch vs clean main (`scratchpad/runall.sh`); no file has new failures. Fresh reviewer checks the branch against the spec. Open PR.
