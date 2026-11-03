# Part 1 — Trade messages on for one business — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While `workflow_settings.trade_messages_paused` is on, a business with `businesses.messages_while_paused = true` gets ALL its trade texts and emails, including those to an electrician linked to it and those about its jobs.

**Architecture:** The rule ("lifted if any related business is flagged") is pure in `trade-pause.core.ts`. `tradeMessagesPausedNow` gains a `jobId` option and works out the related businesses: the given business, installers linked to that electrician business, the job's originating installer, and the job's active assigned businesses. It reads their flags once and applies the rule. Every trade sender passes the ids it already has.

**Tech Stack:** TypeScript, Supabase (supabase-js admin client), Bun test, PGlite practice DB tests.

**Spec:** `docs/superpowers/specs/2026-11-03-deep-first-job-design.md` (Part 1)

## Global Constraints

- Only an exact `true` in `messages_while_paused` lifts the hold. Unknown, null or a read failure keeps it held (fail closed).
- Owner messages, office alerts, sign-in codes and TEST routing are unchanged.
- A held send never claims its once-only key (existing rule, keep it).
- Missing `trade_messages_paused` column = not paused (existing rule, keep it).

## Review Focus

1. A job with no installer yet (HIV lead not given out) → nothing to lift → stays held. Test in Task 2.
2. An electrician linked to TWO installers, only one flagged → lifted (the electrician works for a flagged installer). Test in Task 2.
3. An ended assignment (`active = false`) to a flagged business must NOT lift. Test in Task 2.
4. The `businesses` read fails part-way → held. Test in Task 2.
5. A partner text with neither `jobId` nor `businessId` → held exactly as today. Test in Task 3.

---

### Task 1: Pure rule

**Files:**
- Modify: `src/lib/trade-pause.core.ts`
- Test: `tests/trade-pause.core.test.ts`

**Interfaces:**
- Produces: `pauseLiftedByAny(paused: string | null, flags: readonly (boolean | null | undefined)[]): string | null` returns `null` when `paused` is set and any flag is exactly `true`, else returns `paused`. Keep `businessPauseException` as a thin wrapper: `pauseLiftedByAny(paused, [flag])`.

- [ ] **Step 1: Write failing tests** in a new `describe("pauseLiftedByAny")`:
  - `pauseLiftedByAny("Trade messages paused", [false, true])` → `null`
  - `pauseLiftedByAny("Trade messages paused", [null, undefined, false])` → `"Trade messages paused"`
  - `pauseLiftedByAny("Trade messages paused", [])` → `"Trade messages paused"`
  - `pauseLiftedByAny(null, [true])` → `null`
  - the existing `businessPauseException` tests still pass unchanged
- [ ] **Step 2: Run** `bun test tests/trade-pause.core.test.ts`. Expected: FAIL (`pauseLiftedByAny` not exported).
- [ ] **Step 3: Implement** `pauseLiftedByAny` and rewrite `businessPauseException` on top of it.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(trade-pause): pure "any related business flagged" rule`

### Task 2: Related businesses in `tradeMessagesPausedNow`

**Files:**
- Modify: `src/lib/trade-pause.server.ts`
- Test: `tests/trade-pause-business-exception.pglite.test.ts` (extend; add `partner_relationships` and `job_assignments` tables plus `jobs.originating_installer_business_id` to its practice schema)

**Interfaces:**
- Consumes: `pauseLiftedByAny` (Task 1)
- Produces: `tradeMessagesPausedNow(opts?: { businessId?: string | null; jobId?: string | null }): Promise<string | null>`. The signature stays backward compatible.
- Related set, built only when paused:
  - `businessId`
  - the `installer_business_id` of `partner_relationships` where `electrician_business_id = businessId and active = true`
  - `jobs.originating_installer_business_id` for `jobId`
  - the `business_id` of `job_assignments` where `job_id = jobId and active = true`
- Then one `businesses.select("id, messages_while_paused").in("id", set)` read. Any query error → return the hold.

- [ ] **Step 1: Write failing tests** with the PGlite practice DB, pause ON:
  - `job_lifts_via_originating_installer`: job whose `originating_installer_business_id` is flagged → `tradeMessagesPausedNow({ jobId })` is `null`
  - `job_lifts_via_active_assignment`: an active assignment to a flagged business → `null`; the same assignment with `active=false` → held
  - `electrician_lifts_via_linked_installer`: an electrician business linked (active) to a flagged installer → `tradeMessagesPausedNow({ businessId: electrician })` is `null`; linked to two installers with only one flagged → `null`
  - `unflagged_and_unassigned_stay_held`: a job with no installer → held; a business not flagged → held
  - `read_failure_holds`: the shim makes the `businesses` read return an error → held
- [ ] **Step 2: Run** `bun test tests/trade-pause-business-exception.pglite.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the related-set read in `tradeMessagesPausedNow`, with no extra reads when not paused.
- [ ] **Step 4: Run** the same command. Expected: PASS, and the existing tests in the file still pass.
- [ ] **Step 5: Commit** `feat(trade-pause): lift per job and linked electrician`

### Task 3: Every trade sender passes its ids

**Files (modify the one `tradeMessagesPausedNow()` call in each):**
- `src/lib/sms.server.ts:98`: `{ businessId: input.businessId ?? null, jobId: input.jobId ?? null }`. This covers every partner text that goes through `sendRealSms`.
- `src/lib/trade-messages.server.ts:48` and `:78`: `{ jobId: c.offer.job_id, businessId: c.offer.business_id }`. Leave `:112` (applicants) unchanged.
- `src/lib/electrician-piesa-copy.server.ts:50`, `src/lib/fixes-times-link.server.ts:38`, `src/lib/boss-price-link.server.ts:40`, `src/lib/install-clearance.server.ts:45`: `{ jobId }`
- `src/lib/installer-planning-notice.server.ts:30`: `{ jobId: i.jobId }`
- `src/lib/crew-reminder.server.ts:55`: `{ jobId: <the booking's job id in remindOne> }`
- `src/lib/swms-sign-text.server.ts:54`: `{ jobId, businessId }` for the job and the crew's business in scope there
- `src/lib/esc-collection-notice-send.server.ts:74`: `{ businessId: <the recipient's business_id in scope> }`
- `src/lib/mitti-invite.server.ts:186`: `{ businessId: <the person's business_id from loadPerson> }`
- `src/lib/trade-access.functions.ts:44`: `{ businessId: w.business_id }`
- `src/lib/rec-onboarding-invite.server.ts:46` and `src/lib/signup-electrician.server.ts:37`: these run once per sweep, not per message. Move the pause check inside the per-invite loop with `{ businessId: <the nominating installer business id> }`.
- Test: `tests/trade-pause-senders.pglite.test.ts` (extend)

**Interfaces:**
- Consumes: `tradeMessagesPausedNow({ businessId, jobId })` (Task 2)

- [ ] **Step 1: Write failing tests**, pause ON:
  - `partner_text_for_flagged_job_sends`: `sendRealSms({ type: <a partner type>, jobId: <job of flagged business>, ... })` → status not `"blocked"` with the pause reason
  - `partner_text_unflagged_held`: the same with an unflagged job → `"blocked"` with "Trade messages paused"
  - `partner_text_no_ids_held`: no jobId and no businessId → `"blocked"` (Review Focus 5)
  - `piesa_offer_text_flagged_sends`: via `trade-messages.server` for an offer to a flagged business → not held
- [ ] **Step 2: Run** `bun test tests/trade-pause-senders.pglite.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the call-site changes listed above.
- [ ] **Step 4: Run** `bun test tests/trade-pause-senders.pglite.test.ts tests/trade-pause-held-paths.test.ts tests/trade-pause-install-tomorrow.test.ts tests/office-email-paused.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the full checks** `bun run lint && bunx tsc --noEmit && bun run test`. Expected: no new failures compared with main.
- [ ] **Step 6: Commit** `feat(trade-pause): senders pass job and business ids`

### Task 4: Open the pull request and switch Reinsulate on

- [ ] **Step 1:** Push the branch `part1-trade-messages-one-business` and open a PR with the `supermatt:pr` body shape. Do not merge; Jo chooses who merges.
- [ ] **Step 2:** After it's merged and live, **ask Jo first**, then run `update businesses set messages_while_paused = true where id = 'a8304d2d-339b-4cbf-bcf1-fb09ce7935b0'` (Reinsulate). Confirm with a select.
