# Quick taps sharing consent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner's "Yes, let's go" on quick taps saves their OK to share details, instead of being rejected by the database.

**Architecture:** Add a signing method `quick_tap_link` that the database allows only for `trade_contact_share`; quick taps uses it; a one-off repair records the OK for owners who already said yes.

**Tech Stack:** TypeScript (TanStack Start), Supabase Postgres, Bun tests, PGlite practice database.

**Spec:** `docs/superpowers/specs/2026-11-02-quick-taps-sharing-consent.md`

## Global Constraints
- New method value is exactly `quick_tap_link`.
- `quick_tap_link` allowed only when `doc_key = 'trade_contact_share'` (database and `signGateDoc`).
- `link_code` rule unchanged: still needs `verified_channel`, `verified_destination`, `code_id`.
- New SQL lives in `docs/pending-migrations/` with a rollback, proven on PGlite; nothing applied to live without Jo's yes.
- No change to texts, questions, thanks screen, or who is told.

## Review Focus
- Owner taps Yes twice / refreshes → one saved OK only (existing stable id from `quickTapsBatchId` must still apply).
- `quick_tap_link` sent for another document (e.g. `quote_acceptance`) → refused in code and database.
- `link_code` with no code → still refused by database.
- Repair run on an owner who already has a saved OK → does nothing.
- Repair run on a job whose answer was "no" or consent_share false → does nothing.

---

### Task 1: Database rule allows `quick_tap_link` for sharing consent only

**Files:**
- Create: `docs/pending-migrations/quick-tap-link-signing.sql`, `docs/pending-migrations/quick-tap-link-signing.rollback.sql`
- Test: `tests/quick-tap-link-signing-db.test.ts` (PGlite, applies `0121_owner_paperwork.sql` then the new file, same setup as `tests/owner-paperwork-db.test.ts`)

- [ ] **Step 1: Write failing tests**
  - `quick_tap_link` + `doc_key 'trade_contact_share'`, no code fields → inserts.
  - `quick_tap_link` + `doc_key 'quote_acceptance'` → rejects.
  - `link_code` with no code fields → still rejects.
  - SQL applies twice; rollback applies.
- [ ] **Step 2:** `bun test tests/quick-tap-link-signing-db.test.ts` → FAIL (method check rejects `quick_tap_link`).
- [ ] **Step 3: Write the SQL:** drop/recreate `owner_gate_signatures_method_check` as `method IN ('link_code','login','office','quick_tap_link')`; add `owner_gate_signatures_quick_tap_check` = `CHECK (method <> 'quick_tap_link' OR doc_key = 'trade_contact_share')`. Idempotent (`DROP CONSTRAINT IF EXISTS`). Rollback restores the 3-value check and drops the new one.
- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit `fix(quick-taps): database allows tapped-link sharing consent`.

### Task 2: Quick taps signs with `quick_tap_link`

**Files:**
- Modify: `src/lib/owner-gates.server.ts` (`SignInput.method`, guard in `signGateDoc`)
- Modify: `src/lib/quick-taps.server.ts:136` (`method: "quick_tap_link"`)
- Test: `tests/a48-b2-quick-taps.test.ts` (update the two `method: "link_code"` expectations at lines ~349, ~357), new `tests/owner-gates-quick-tap-method.test.ts`

**Interfaces:**
- Produces: `SignInput.method: "link_code" | "login" | "office" | "quick_tap_link"`

- [ ] **Step 1: Write failing tests**
  - quick-taps test expects `method: "quick_tap_link"`.
  - `signGateDoc({ key: "quote_acceptance", method: "quick_tap_link", ... })` throws `WorkflowError`.
  - `signGateDoc({ key: "trade_contact_share", method: "quick_tap_link" })` with no `quickTapsBatchId` throws.
- [ ] **Step 2:** Run both tests → FAIL.
- [ ] **Step 3:** In `signGateDoc`, before the insert: if `method === "quick_tap_link"` and (`key !== "trade_contact_share"` or no `quickTapsBatchId`) → `throw new WorkflowError("This can only be confirmed from the owner's own link.")`. Change quick taps to pass `quick_tap_link`.
- [ ] **Step 4:** Run tests → PASS; `bun run test` full suite → no new failures vs. baseline; `bunx tsc --noEmit` clean.
- [ ] **Step 5:** Commit `fix(quick-taps): save the owner's OK as a tapped link, not a code`.

### Task 3: One-off repair for owners who already said yes

**Files:**
- Create: `scripts/repair-quick-taps-sharing.ts` (dry run by default; `--apply` to write)
- Test: `tests/repair-quick-taps-sharing.test.ts`

**Interfaces:**
- Consumes: `signGateDoc` with `method: "quick_tap_link"`, `quickTapsBatchId` from the `quick_taps_answered` event's `details.batch_id`.
- Produces: `findUnsavedSharing(): Promise<{ jobId: string; jobNumber: string; name: string; batchId: string }[]>`

- [ ] **Step 1: Write failing tests:** picks a job with `quick_taps_answered` outcome `pass` + `consent_share true` and no `trade_contact_share` signature; skips one that has a signature; skips outcome not `pass`; skips `consent_share` false; dry run writes nothing.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; signs with `ip: null, userAgent: "quick-taps repair"`, `signedBy: null`; logs a `quick_taps_share_repaired` internal event per job.
- [ ] **Step 4:** Run → PASS; commit `fix(quick-taps): repair script for saved yes answers`.

### Task 4: Review and hand over
- [ ] Fresh reviewer checks the whole branch against the spec.
- [ ] Open pull request; don't merge (coordinating chat merges).
- [ ] Ask Jo before applying the SQL to the live database; then dry-run the repair (expect HV-2730 only), ask Jo, then `--apply`.
