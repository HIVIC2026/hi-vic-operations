# Quick taps thanks screen: the installer will call — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After an owner taps "Yes, let's go", My job says the named installer will call them to book.

**Architecture:** The pass `done` view gains `installer` (from the answered batch's `area_batch_sent.installer_name`); a pure helper builds the line; the My job page shows the server's view.

**Tech Stack:** TypeScript, TanStack Start, Supabase, bun:test.

**Spec:** `docs/superpowers/specs/2026-11-02-quick-taps-thanks-installer-calls-design.md`

## Global Constraints
- Named line, verbatim: `Thanks! ${name} will call you soon to book your free Ready Check.`
- Fallback, verbatim: `Thanks! Your installer will call you soon to book your free Ready Check.`
- No other wording changes; decline views stay `{ kind: "done", outcome }` with no `installer` key.
- The installer is not notified on a pass (no new sends anywhere).
- One PR; do not merge.

## Review Focus
- Batch event with `installer_name` blank/whitespace → fallback line (Task 1 test).
- Owner carried into a new batch with an earlier pass (`carried_pass`) → name of the batch they are in now (Task 1 test).
- Owner reloads My job after answering → same named line (Task 1 `quickTapsState` test).
- Old answers (batch sent before `installer_name` existed) → fallback, no crash (covered by blank-name test).
- No SMS/email logged on a pass (Task 1 assertion on the fake senders).

---

### Task 1: Pass view carries the installer name

**Files:**
- Modify: `src/lib/quick-taps.core.ts` (QuickTapsView, QUICK_TAPS_COPY.outcome.pass, new helper)
- Modify: `src/lib/quick-taps.server.ts` (`viewOf`, ~line 96)
- Test: `tests/a48-b2-quick-taps.test.ts`

**Interfaces:**
- Produces: `QuickTapsView` done variant `{ kind: "done"; outcome: FinalOutcome; installer?: string | null }` (`installer` present only when `outcome === "pass"`); `export function quickTapsPassLine(installer: string | null | undefined): string`.

- [ ] **Step 1: Write failing tests**
  - `quickTapsPassLine("RAPID INSULATION")` → `"Thanks! RAPID INSULATION will call you soon to book your free Ready Check."`; `quickTapsPassLine("  ")` and `(null)` → fallback line.
  - Update line 254: `QUICK_TAPS_COPY.outcome.pass` equals the fallback line.
  - Update every pass expectation (lines ~330–443) to `{ kind: "done", outcome: "pass", installer: <the batch's installer_name in that fixture> }`.
  - New: batch sent with `installer_name: ""` → `installer: null`; carried-pass owner → installer of the current batch; after a pass the fake SMS/email senders record nothing new.
- [ ] **Step 2: Run** `bun test tests/a48-b2-quick-taps.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `quickTapsPassLine` and set `outcome.pass` to the fallback line in `quick-taps.core.ts`; in `viewOf`, for a pass, find the `AREA_BATCH_SENT_EVENT` whose batch id is the answered batch (`forBatch`) and return `installer: str(details.installer_name)` (blank → null).
- [ ] **Step 4: Run** `bun test tests/a48-b2-quick-taps.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `feat(quick-taps): pass view carries the installer name`.

### Task 2: My job shows the named line

**Files:**
- Modify: `src/routes/my-job.$token.tsx` (~lines 313–330)
- Test: `tests/a48-b2-quick-taps.test.ts` (source check, as the file already uses `readFileSync`)

**Interfaces:**
- Consumes: `quickTapsPassLine`, done view `installer` (Task 1).

- [ ] **Step 1: Write failing test** — the route source uses `quickTapsPassLine(` for the pass and keeps the view returned by `save` (no locally built `{ kind: "done", outcome: done }` for a pass).
- [ ] **Step 2: Run** the test — expect FAIL.
- [ ] **Step 3: Implement** — keep the server's returned view in state after Save; render `view.outcome === "pass" ? quickTapsPassLine(view.installer) : QUICK_TAPS_COPY.outcome[view.outcome]`.
- [ ] **Step 4: Run** `bun run test` and `bunx tsc --noEmit` — expect all green.
- [ ] **Step 5: Commit** `feat(my-job): thanks screen names the installer who will call`; push branch `quick-taps-thanks-installer-calls`; open PR (body ends with the session attribution); do not merge.
