# AI Replies Step 2 — Answer More Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI job replies use an editable list of Jo's standard answers, flag questions they can't answer, offer to save Jo's answer, quote R6/R7 prices, and propose an installer note / new ceiling size that is applied only when Jo sends.

**Architecture:** New staged table `ai_reply_answers` (server-only), with the seed list as a core constant used when the table is missing or empty. The AI reply ends with a small machine block (`NEEDS_JO:` lines, `ACTIONS:` JSON) that core code parses off before the body is shown. Installer notes are `workflow_events` (`installer_note`), so no extra table.

**Tech Stack:** TypeScript, TanStack Start, Supabase, PGlite tests, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-29-ai-replies-steps-2-4-design.md` (§ Step 2). Builds on step 1 (`2026-10-29-ai-reply-step1-redo-blocked.md`) — branch from it.

## Global Constraints
- The new table ships as a **staged migration** in `docs/pending-migrations/` (+ rollback + README bullet + PGlite proof test). It is **not applied**: Jo is asked in chat before it goes on the live database. Until then the AI uses the seed constant and the AI answers page says "Waiting for the database change".
- Wording copied verbatim from the spec table §2c; "electrical safety check (PIESA)" on first mention; "the government's rebate rules"; "electrical upgrades"; no scheme words; Jo's wait line verbatim.
- The rebate does not depend on R-value (`wholeVeecDiscount` is area + location only): R6/R7 prices use the same rebate as R5.
- Actions (installer note, new size) change nothing until Jo taps Send; each can be unticked.
- Drafts with `NEEDS_JO` or "Needs you" are never auto-sent (step 4 relies on this flag).
- Open a PR and stop.

## Review Focus
- AI forgets the machine block or writes malformed JSON → body still shown, no actions, no crash.
- AI puts `NEEDS_JO` text inside the email body → it must never reach the owner (stripped before save and checked on Send).
- New size of 0, 5,000 m² or "about 90" → only whole numbers 10–1000 accepted as an action; otherwise no action.
- Answers table empty or missing → seed list used, never an empty rule set.
- Jo edits an answer while a draft is being written → next draft uses the new one; the in-flight one is fine with either.

---

### Task 1: Seed answers and the prompt uses them
**Files:** Modify `src/lib/ai-email-reply.core.ts`; Create `src/lib/ai-answers.core.ts`; Test `tests/ai-answers.test.ts`
**Interfaces — Produces:** `type AiAnswer = { topic: string; answer: string }`; `AI_SEED_ANSWERS: AiAnswer[]` (today's `AI_BUSINESS_RULES` updated per spec + every row of spec table §2c + standing wording rules); `rulesFromAnswers(rows: AiAnswer[] | null): string[]` (falls back to seed when null/empty); `buildAiReplyInput(c, { preRelease, answers })`.
- [ ] Test: seed contains topics Payment plan, Low income, Cheaper quote, Existing electrical certificate, Own electrician for electrical upgrades, Garage/flat roof/cathedral/no manhole, R6.0/R7.0, Underfloor/walls, Cancel, Rental, Paying by card, Home on install day, Other languages, Tenant, Installer access; no seed text matches `/\bVEECs?\b|\bVEU\b|Victorian Energy Upgrades|Activity 48|never quote/i`; `rulesFromAnswers(null)` and `([])` equal seed lines; `buildAiReplyInput` with custom answers lists those, not the seed; old "Never quote an R6.0 or R7.0 price" line is gone from the instructions.
- [ ] Run `bun test tests/ai-answers.test.ts` — FAIL. Implement. Run — PASS. Run `bun test tests/ai-email-reply*.test.ts` — PASS (update assertions on the old rules list with a ledgered ruling).
- [ ] Commit `feat(ai-reply): Jo's standard answers as the AI's rules`

### Task 2: Staged table + read path
**Files:** Create `docs/pending-migrations/ai-reply-answers.sql`, `ai-reply-answers.rollback.sql`, README bullet; Create `src/lib/ai-answers.server.ts`; Test `tests/ai-reply-answers-db.test.ts` (PGlite, pattern of `tests/emails-tab-nojob-events-practice-db.test.ts`)
**Interfaces — Produces:** table `ai_reply_answers(id uuid pk default gen_random_uuid(), topic text not null, answer text not null, active boolean not null default true, sort int not null default 0, updated_at timestamptz default now(), updated_by uuid null)`, service-role only (REVOKE anon/authenticated, RLS on, no policies); `loadAiAnswers(): Promise<{ answers: AiAnswer[]; available: boolean }>` (missing table via `isMissingDbObject` → `{ seed, available: false }`; empty → seed).
- [ ] Test (PGlite): SQL applies; anon/authenticated can't select; rollback drops it. Test (fake supabase): missing table → seed + `available:false`; rows → rows in `sort` order, inactive skipped.
- [ ] FAIL → implement → PASS. `writeAiReplyDraft` passes `loadAiAnswers()` to `buildAiReplyInput`.
- [ ] Commit `feat(ai-reply): staged ai_reply_answers table (not applied)`

### Task 3: AI answers page
**Files:** Create `src/lib/ai-answers.functions.ts`, `src/routes/_authenticated/admin.ai-answers.tsx`; Modify `src/config/office-nav.ts` (`EMAIL_PATHS` add `/admin/ai-answers`), `src/components/portal/EmailsScreen.tsx` (an "AI answers" link button after the `PageHeader`); Test `tests/ai-answers-page.test.ts`
**Interfaces — Produces:** server fns `listAiAnswers` (GET), `saveAiAnswer({ id?, topic, answer, active })`, `removeAiAnswer({ id })` — all `requireAdmin`; when table unavailable, list returns seed read-only with `available:false`, saves throw "Waiting for the database change".
- [ ] Test: functions validate (topic 2–80 chars, answer 2–2000), call `requireAdmin`; route exists; Emails screen links to `/admin/ai-answers`; nav highlights Emails for it. Copy the `admin.electrician-rates.tsx` pattern; works at phone width.
- [ ] FAIL → implement → PASS. Commit `feat(ai-reply): AI answers page`

### Task 4: Needs your answer + Save as a standard answer
**Files:** Modify `ai-email-reply.core.ts` (instructions + parser), `ai-email-reply.server.ts` (`writeAiReplyDraft` details, `listAiDrafts`), `src/lib/emails-tab.core.ts` (`JobEmailCard`), `EmailsScreen.tsx` (`JobCard`), `AiReplyDrafts.tsx`; Test `tests/ai-reply-needs-answer.test.ts`
**Interfaces — Produces:** instruction: "If a question isn't covered by the rules or facts, still write the rest, and after the email add a line `NEEDS_JO: <their question>` for each."; complaint after install → `NEEDS_YOU: complaint`. `splitAiOutput(raw): { body: string; needsAnswer: string[]; needsYou: boolean; actions: AiActions }` (Task 5 fills actions). Draft `details.needs_answer: string[]`, `details.needs_you: boolean`. `aiReplyProblems` adds a problem if the body contains `NEEDS_JO`/`NEEDS_YOU`/`ACTIONS:`.
- [ ] Test: parser strips marker lines from body, returns them; body with leftover marker is a problem; `listAiDrafts` and `JobEmailCard` carry `needsAnswer`/`needsYou`; both screens show "Needs your answer: <q>" / "Needs you"; after a successful Send of a draft with `needsAnswer`, `JobCard`/`DraftCard` keep the card with a "Save as a standard answer" form (topic prefilled with the question, answer prefilled with Jo's sent body minus greeting/sign-off) calling `saveAiAnswer`, plus "Skip".
- [ ] FAIL → implement → PASS. Commit `feat(ai-reply): flag unknown questions and save Jo's answer`

### Task 5: R6/R7 prices and proposed actions
**Files:** Modify `ai-email-reply.core.ts`, `ai-email-reply.server.ts` (`estimateFacts`, `writeAiReplyDraft`, `sendAiDraft`), `src/lib/emails-tab.server.ts`, both screens, `src/routes/_authenticated/field.$jobId.tsx` (`InstallerFlow`), `src/lib/installer-texts.core.ts` (`readyCheckBookedInstallerText`), `src/lib/ready-check-times.core.ts` (`readyCheckOfferText`); Test `tests/ai-reply-actions.test.ts`
**Interfaces — Produces:**
- `higherRFacts(areaM2: number, r5Cost: { before: number; rebate: number }, ownerR5IncPerM2: number): string[]` → "R6.0 for N m²: $X after the $R rebate ($B before)" and same for R7.0, using `ownerRateForR` and the same rebate; added to facts when a saved price exists.
- Instruction: after the email, optionally `ACTIONS: {"installer_note":"…","new_area_m2":90}`; `type AiActions = { installerNote?: string; newAreaM2?: number }` (area accepted only as integer 10–1000; note ≤ 200 chars).
- Draft `details.actions`; screens show each as a ticked checkbox ("Add note for the installer: …", "Update ceiling size to 90 m²"); `sendAiDraft(eventId, body, actorId, { applyNote: boolean, applyArea: boolean })` applies after a successful send: note → `workflow_events` `installer_note` `{ note, source: "ai_reply" }`; area → `jobs.estimated_area_m2` + `estimated_area_unknown=false` + a `workflow_events` log. Prices for a new size: when the first draft's `actions.newAreaM2` differs from the saved size, `writeAiReplyDraft` adds facts for that size (`whatIfEstimate` for R5 + `higherRFacts`) and writes the draft once more, so the reply quotes the owner's size.
- `installerNotes(jobId)` shown on the installer job page; `readyCheckBookedInstallerText(..., notes?: string[])` and `readyCheckOfferText(..., notes?)` append `Note: <latest note>` (one, ≤ 100 chars).
- [ ] Test: `higherRFacts(90, {before:3398, rebate:840}, 30)` → R7 line "$3,008 after the $840 rebate ($3,848 before)" and R6 "$2,828 after the $840 rebate ($3,668 before)" (Mohamed); malformed ACTIONS → none; area 5 / 5000 / 90.5 → no area action; send with both ticked writes note event and updates area; unticked writes nothing; nothing is applied when send fails or is `rewritten`; installer texts include the note; installer page lists notes.
- [ ] FAIL → implement → PASS. Commit `feat(ai-reply): R6/R7 prices, installer notes and ceiling size on Send`

### Task 6: Prompt tests from the samples
**Files:** Test `tests/ai-reply-samples.test.ts`
- [ ] For samples 1, 2, 3, 4, 6, 8, 9, 14, 15, 23 (spec "Samples"): `buildAiReplyInput` for that email + facts contains the matching seed answer and (pre-release) the wait line/release line; `aiReplyProblems(<agreed sample text>, { preRelease })` is `[]` for each agreed sample text pasted verbatim from the chat (store them in `tests/fixtures/ai-reply-samples.ts`).
- [ ] Run — PASS (fix rules, not samples, if a sample fails). Commit `test(ai-reply): Jo's agreed samples pass the rules`

### Task 7: Pull request
- [ ] Push `feat/ai-reply-more-answers`, open PR, stop. PR says the migration is staged, not applied, and asks for Jo's go-ahead before applying.
