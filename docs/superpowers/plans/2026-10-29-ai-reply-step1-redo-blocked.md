# AI Replies Step 1 — Redo Blocked Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI job-reply drafts that break Jo's rules are fixed by the AI (at draft time and on a blocked Send) instead of only showing a red note; before release, AI replies may talk about the Ready Check but never promise timing.

**Architecture:** Pure helpers in `ai-email-reply.core.ts` (fix prompt, timing-only pre-release check). One server loop `fixUntilClean` used by `writeAiReplyDraft` and `sendAiDraft`. `sendAiDraft` returns `{ status: "rewritten" }` instead of sending when it had to fix. Both draft screens show the fixed body.

**Tech Stack:** TypeScript, TanStack Start server functions, Supabase, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-29-ai-reply-redo-blocked-drafts-design.md`

## Global Constraints
- At most `AI_FIX_TRIES = 2` AI fix calls per draft or per Send.
- A rewritten body is **never sent** in the same Send; Jo must tap Send again.
- Jo's edits are kept: the fix prompt changes only the words/sentences that break a rule.
- Automatic emails, texts and My job pages keep the full decision-388 ban (`preReleaseViolations` unchanged for them).
- No-job replies unchanged.
- Open a pull request and stop; do not merge unless Jo says so in chat.

## Review Focus
- AI fix call throws or times out on Send → Jo gets her own body back with the red note, nothing sent, no crash.
- Fix returns empty text or NO_REPLY_NEEDED → treated as a failed try; previous body kept.
- Fix returns text with a sign-off → `finishAiReply` leaves exactly one sign-off.
- Two quick Send taps on a blocked draft → second call sees the saved rewritten edit; still nothing sent without a clean body.
- Wait line ("as soon as your spot is released", "demand is high", "as quickly as we can") must pass the AI pre-release check.

---

### Task 1: Timing-only pre-release check for AI replies

**Files:**
- Modify: `src/lib/ai-email-reply.core.ts` (`aiReplyProblems`)
- Test: `tests/ai-reply-redo.test.ts` (new)

**Interfaces:**
- Produces: `aiPreReleaseViolations(text: string): string[]`; `aiReplyProblems(body, { preRelease })` uses it instead of `preReleaseViolations`.

- [ ] **Step 1: Write the failing tests**
```ts
expect(aiPreReleaseViolations("When your spot is released, an installer will text you times for your free Ready Check.")).toEqual([]);
expect(aiPreReleaseViolations("We're bringing on more certified installers, but demand is high … as quickly as we can … we'll be in touch as soon as your spot is released.")).toEqual([]);
for (const bad of ["soon", "shortly", "this week", "next week", "in a few weeks", "within 10 days", "jump the queue", "move up the list"]) expect(aiPreReleaseViolations(`We'll call ${bad}.`).length).toBeGreaterThan(0);
expect(aiReplyProblems("Hi Jo,\n\nYour free Ready Check is next.\n\nCheers, the Home Insulation Victoria team", { preRelease: true })).toEqual([]);
expect(aiReplyProblems("Hi Jo,\n\nYour Ready Check is this week.", { preRelease: true }).join(" ")).toContain("this week");
```
- [ ] **Step 2: Run** `bun test tests/ai-reply-redo.test.ts` — expect FAIL (not exported).
- [ ] **Step 3: Implement** `aiPreReleaseViolations` with a timing-only regex: `\bsoon\b` except in "as soon as your spot is released", `shortly`, `this week`, `next week`, `in a (few|couple of) (days|weeks)`, `within \d+ (days|weeks)`, `jump the queue`, `move up`. Problem text: `Take out “…” — we can't promise timing before their spot is released.`
- [ ] **Step 4: Run** — expect PASS; also run `bun test tests/decision-388-spot-only.test.ts tests/owner-email-auto-reply.test.ts` — expect PASS (they cover the unchanged automatic-message ban). If any existing AI-reply test asserts the old Ready Check ban, update it to the new rule and ledger a ruling.
- [ ] **Step 5: Commit** `feat(ai-reply): before release, AI replies may explain the Ready Check but never promise timing`

### Task 2: Pre-release prompt follows the new rule

**Files:**
- Modify: `src/lib/ai-email-reply.core.ts` (`NEXT_STEP_PRE_RELEASE`, `AI_BUSINESS_RULES_PRE_RELEASE`)
- Test: `tests/ai-reply-redo.test.ts`

**Interfaces:**
- Produces: `AI_WAIT_LINE: string` (Jo's wait line, verbatim from the steps 2–4 spec §2d) and `AI_RELEASE_MEANS: string` ("When your spot is released, it's your turn: an installer will text and email you some times for your free Ready Check.").

- [ ] **Step 1: Test** — `aiReplyInstructions({ preRelease: true })` contains `AI_RELEASE_MEANS` and "never promise", and no longer contains "Say nothing else about what happens after their spot is released"; `buildAiReplyInput(ctx, { preRelease: true })` business rules contain `AI_WAIT_LINE`; `aiPreReleaseViolations(AI_WAIT_LINE)` and `aiPreReleaseViolations(AI_RELEASE_MEANS)` are `[]`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — pre-release next step: if spot saved, explain release with `AI_RELEASE_MEANS`; if they ask about timing use `AI_WAIT_LINE`; never give a date, timeframe or speed. Add both lines to `AI_BUSINESS_RULES_PRE_RELEASE`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(ai-reply): pre-release replies explain release and use Jo's wait line`

### Task 3: Fix prompt and fix loop

**Files:**
- Modify: `src/lib/ai-email-reply.core.ts`, `src/lib/ai-email-reply.server.ts`
- Test: `tests/ai-reply-redo.test.ts`

**Interfaces:**
- Produces (core): `AI_FIX_TRIES = 2`; `AI_FIX_INSTRUCTIONS: string`; `buildAiFixInput(body: string, problems: string[], preRelease: boolean): string`; `fixUntilClean(body: string, preRelease: boolean, ai: (input: string, instructions: string) => Promise<string>): Promise<{ body: string; problems: string[]; tries: number }>` (pure apart from the injected `ai`, so it lives in core).

- [ ] **Step 1: Tests** (fake `ai`)
  - clean body → `tries 0`, body unchanged, `ai` not called.
  - body with "VEEC" → fake returns fixed text → `tries 1`, `problems []`, body ends with exactly one `AI_SIGN_OFF`.
  - fake always returns the bad text → `tries 2`, problems kept, body = last version.
  - fake throws on first call → `tries 1`, original body and problems kept.
  - fake returns "" or `NO_REPLY_NEEDED` → counts as a try, previous body kept.
  - `buildAiFixInput` contains every problem line and the body without its sign-off; `AI_FIX_INSTRUCTIONS` says to change only what breaks the listed rules and keep everything else word for word.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — loop: `problems = aiReplyProblems(body, { preRelease })`; while problems and tries < 2: call `ai(buildAiFixInput(...), AI_FIX_INSTRUCTIONS)`, `finishAiReply` the result, re-check.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(ai-reply): fix loop for drafts that break a rule`

### Task 4: Use the loop when a draft is written and on Send

**Files:**
- Modify: `src/lib/ai-email-reply.server.ts` (`writeAiReplyDraft` ~line 80, `sendAiDraft` ~line 175), `src/lib/emails-tab.server.ts` (`sendJobEmailReply` passes the result through)
- Test: `tests/ai-reply-redo.test.ts` (source checks, same style as `tests/my-job-spot-saved.test.ts`)

**Interfaces:**
- Consumes: `fixUntilClean` (Task 3), `aiText`.
- Produces: `sendAiDraft(...)` returns `{ status: "sent" | ... } | { status: "rewritten"; body: string; problems: string[] }`; on `rewritten` it saves the body via the existing `saveDraftEdit(eventId, body, actorId)`.

- [ ] **Step 1: Tests** — source checks: `writeAiReplyDraft` calls `fixUntilClean(` after `finishAiReply(raw)`; `sendAiDraft` calls `fixUntilClean(` and `saveDraftEdit(` and returns `status: "rewritten"` before any send call; the old `throw new Error(problems.join(" "))` paths in `sendAiDraft` are gone; `sendJobEmailReply` returns the `rewritten` result unchanged (no "Reply sent" event for it).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** both call sites. In `sendAiDraft`, run the basic + pre-release checks together; if any problems → `fixUntilClean`, save edit, return `rewritten` (even if problems remain — the screen shows them).
- [ ] **Step 4: Run** the new tests plus `bun test tests/*ai*email* tests/emails-tab*` — PASS.
- [ ] **Step 5: Commit** `feat(ai-reply): blocked Send rewrites the draft for Jo to check`

### Task 5: Screens show the rewritten draft

**Files:**
- Modify: `src/components/portal/EmailsScreen.tsx` (`JobCard`), `src/components/portal/AiReplyDrafts.tsx`
- Test: `tests/ai-reply-redo.test.ts` (source checks)

**Interfaces:**
- Consumes: `rewritten` result (Task 4).
- Produces: shared copy `AI_REWRITTEN_NOTE = "We fixed the reply so it follows your rules — check it and press Send."` in `ai-email-reply.core.ts`.

- [ ] **Step 1: Tests** — both components reference `status === "rewritten"`, set the box to the returned `body`, and show `AI_REWRITTEN_NOTE`, or the returned problems in the existing red error style when problems remain; the card is not removed / `onDone` not called on `rewritten`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** in both screens.
- [ ] **Step 4: Run** all AI reply tests — PASS. Type-check what's possible (`bunx tsc --noEmit` if node_modules installs; otherwise ledger that it couldn't run).
- [ ] **Step 5: Commit** `feat(ai-reply): show the fixed draft after a blocked Send`

### Task 6: Pull request
- [ ] Push branch `feat/ai-reply-redo-blocked`, open the PR (REST API), stop. Note in the PR: full suite/tsc status and the TEST-job check to do after publish (pre-release draft with "this week" → Send shows a fixed version, nothing sent).
