# Quick taps: fewer questions + Mia's fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quick taps stop asking about the roof and the 5 years, and Mia (HV-1405) can answer again.

**Architecture:** The questions and outcomes live in the pure `src/lib/quick-taps.core.ts` (`tapOutcome`, `nextTapStep`, `websiteQuestions`); the page (`src/routes/my-job.$token.tsx`) just follows `nextTapStep`. Removing the two steps there removes them everywhere. Mia's fix is a one-off script (dry run by default, `--apply` writes) like `scripts/repair-quick-taps-sharing.ts`.

**Tech Stack:** TypeScript, TanStack Start, Supabase, bun tests (`bun run test`).

**Spec:** `docs/superpowers/specs/2026-11-03-quick-taps-fewer-questions-design.md`

## Global Constraints

- Question order: name → address → hatch → blank website answers (property_type, top_floor for units, insulation — never over_five_years) → access → go.
- Only "No" to the hatch, or "No thanks", closes a job.
- Old saved answers are never changed (they keep roof / five_years values); the installer screen shows those lines only when answered.
- Mia's text, verbatim: `Hi Mia, it's Home Insulation Victoria. Sorry, we think you may have tapped "flat roof" by mistake. We've fixed it – if you'd still like your free Ready Check, tap here to carry on: {link}`
- Nothing touches the live database or sends a text without Jo saying yes right before that step.
- Always "Home Insulation Victoria" in full in owner wording.

## Review Focus

1. An owner who already answered "Flat" before this change and reloads their page — still sees their old outcome (no re-ask, no crash).
2. An owner whose website left `over_five_years` blank — not asked it, and still reaches "Yes, let's go".
3. Old saved answers sent from an open page (with `roof`/`five_years` in them) — accepted and ignored, not rejected.
4. Mia's set-aside: the area batch row must show "Waiting for owner" again, not "closed".
5. Running Mia's script twice — the second run does nothing (no second reopen, no second text).

---

### Task 1: Remove the roof and 5-year questions from quick taps

**Files:**
- Modify: `src/lib/quick-taps.core.ts` (header comment, `tapOutcome`, `nextTapStep`, `websiteQuestions`, `TapStep`)
- Modify: `src/routes/my-job.$token.tsx` (drop the `roof` and `five_years` step branches ~line 377)
- Test: `tests/a48-b2-quick-taps.test.ts`

**Interfaces:**
- Produces: `tapOutcome(a, blanks)` never returns `"decline_5yr"` from a new answer; `nextTapStep` never returns `"roof"`, `"five_years"` or `"over_five_years"`; `websiteQuestions` never includes `"over_five_years"`. Types `Roof`, `FiveYears`, `QuickTapAnswers.roof/five_years`, `FinalOutcome` incl. `decline_5yr`, and `QUICK_TAPS_COPY.roof/five_years/outcome.decline_5yr` STAY (old answers and the installer screen still read them).

- [ ] **Step 1: Write failing tests** in `tests/a48-b2-quick-taps.test.ts`:
  - `"flat roof no longer closes"`: `tapOutcome({ name: "Mia", address: "17 Hilda Ave, Boronia VIC 3155", hatch: "yes", roof: "flat", access: { who: "owner" }, go: "yes" })` → `"pass"`.
  - `"5 years yes no longer closes"`: same with `five_years: "yes"` → `"pass"`.
  - `"steps skip roof and 5 years"`: `nextTapStep({ name: "A", address: "B", hatch: "yes" })` → `"access"`.
  - `"over 5 years never asked"`: `websiteQuestions({ property_type: null, top_floor: null, over_five_years: null, insulation: null })` → `["property_type", "insulation"]`.
  - `"blank insulation still asked"`: `nextTapStep({ name: "A", address: "B", hatch: "yes" }, ["insulation"])` → `"insulation"`.
  - `"hatch no still closes"`: `tapOutcome({ name: "A", address: "B", hatch: "no" })` → `"decline_access"`.
  - Update/remove existing tests that expect `"roof"`, `"five_years"` steps or a `decline_5yr` / flat `decline_access` outcome.

- [ ] **Step 2: Run** `bun test tests/a48-b2-quick-taps.test.ts` — expect the new tests to FAIL.

- [ ] **Step 3: Implement** in `quick-taps.core.ts`: delete the roof and five_years lines from `tapOutcome` and `nextTapStep`; add `k !== "over_five_years"` to the `websiteQuestions` filter; remove `"roof" | "five_years"` from `TapStep`; update the header comment to the new order. In `my-job.$token.tsx` delete the two step branches.

- [ ] **Step 4: Run** `bun test tests/a48-b2-quick-taps.test.ts` then `bun run test` and `bunx tsc --noEmit` — all PASS. Fix any other test that expected the old steps (grep `"roof"`/`"five_years"` in tests).

- [ ] **Step 5: Commit** `feat: quick taps no longer ask roof or 5 years (Jo 3 Nov)`

### Task 2: Installer screen hides roof / 5-year lines when not answered

**Files:**
- Modify: `src/lib/run-route.core.ts` (`tapRows` comment only, if behaviour already filters)
- Test: `tests/a48-b2-run-portal-books.test.ts`

**Interfaces:** Consumes Task 1's answers shape.

- [ ] **Step 1: Write test** `"tapRows shows only the hatch for a new owner"`: `tapRows({ hatch: "yes" })` → one row `[QUICK_TAPS_COPY.hatch.question, "Yes"]`; and `tapRows({ hatch: "yes", roof: "sloped" })` → two rows (old answer still shown).
- [ ] **Step 2: Run** it. `tapRows` already filters empty rows, so it should PASS; if it does, only update the `tapRows` comment ("roof / 5-year rows appear only on answers saved before 3 Nov 2026").
- [ ] **Step 3: Commit** `test: installer screen shows roof/5-year only for old answers`

### Task 3: One-off script to let Mia (HV-1405) answer again

**Files:**
- Create: `scripts/reask-quick-taps.ts`
- Modify: `src/lib/quick-taps.server.ts` (add `reaskQuickTaps`)
- Test: `tests/quick-taps-reask.test.ts` (pure parts) 

**Interfaces:**
- Produces: `reaskQuickTaps(jobId: string, opts: { apply: boolean; actorId: string; sendText: boolean }): Promise<{ setAside: number; reopened: boolean; texted: boolean; link: string | null }>`

Behaviour, in order (each step skipped if already done, so a second run does nothing):
1. Set aside the job's `quick_taps_answered` event(s) for the current open batch (`tapsBatchId`): change `event_type` to `quick_taps_answered_replaced` and set `details.idempotency_key` to the old key + `:replaced:<ISO time>`. Do not delete. Log a `quick_taps_reask` workflow event (internal) with the batch id and reason "Owner tapped flat roof by mistake (Jo 3 Nov 2026)".
2. If the job is `cancelled`, call `reopenJob(jobId, "Quick taps re-asked: flat roof tapped by mistake", actorId)` (`src/lib/office-actions.server.ts`). Expect stage `ready_check_ready_to_schedule`.
3. If `sendText`, send via `sendRealSms` with type `quick_taps`, the job's owner mobile, idempotency key `quick-taps-reask:v1:<jobId>:<batchId>`, body = the Global Constraints text with `{link}` = the owner's existing my-job link from the last `quick_taps` SMS for the job.

- [ ] **Step 1: Write tests** in `tests/quick-taps-reask.test.ts` for a pure helper `reaskText(name: string, link: string): string` → exact Global Constraints text with "Mia" and the link; and a pure `answersToSetAside(events, batchId)` → only `quick_taps_answered` rows with that batch id.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the two pure helpers in `src/lib/quick-taps.core.ts` and `reaskQuickTaps` in `quick-taps.server.ts`; `scripts/reask-quick-taps.ts` takes `<jobId> [--apply] [--text]`, prints what it would do / did.
- [ ] **Step 4: Run** `bun run test`, `bunx tsc --noEmit` — PASS.
- [ ] **Step 5: Try it on a TEST job** via Test Centre (quick taps answered "Flat" on the old code path, set up by inserting a `quick_taps_answered` event with outcome `decline_access` and cancelling): run `--apply` (no `--text`), open its link → page starts at the name question; answer Yes → job passes and shows "said yes" for Rapid. Run the script again → reports nothing to do.
- [ ] **Step 6: Commit** `feat: one-off re-ask quick taps script (Mia HV-1405)`

### Task 4: Ship and fix Mia (each step needs Jo's yes)

- [ ] **Step 1:** Push branch `quick-taps-fewer-questions`, open the pull request; ask Jo who merges.
- [ ] **Step 2:** After merge and publish, check the live quick taps page on a TEST job asks: name, address, hatch, access, go.
- [ ] **Step 3:** Ask Jo, then run `bun scripts/reask-quick-taps.ts 14c5edc2-b170-49dc-91ae-54aab826714c` (dry run), show output, then `--apply`.
- [ ] **Step 4:** Ask Jo, then run with `--apply --text` (between 7am and 8pm). Confirm the `sms_messages` row is delivered.
