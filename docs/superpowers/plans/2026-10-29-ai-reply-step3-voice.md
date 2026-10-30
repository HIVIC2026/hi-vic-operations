# AI Replies Step 3 — Sound Like Jo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each AI job reply is written in Jo's style, learned from her latest sent replies, a bit more detailed, using all the job's facts.

**Architecture:** A server reader picks up to 8 recent office-sent replies; a pure core function turns them into a "style examples — style only" prompt section. Prompt wording changes for length/tone. No new tables.

**Tech Stack:** TypeScript, Supabase, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-29-ai-replies-steps-2-4-design.md` (§ Step 3). Branch from step 2.

## Global Constraints
- Style examples never supply facts: the prompt says not to copy prices, dates, names, links or promises from them; facts come only from this job.
- Examples exclude QA/TEST jobs (`source !== "qa_test"` and job numbers with "TEST") and automatic emails.
- At most 8 examples, each trimmed to 1,200 characters, greeting/sign-off kept.
- Step 1–2 rule checks still apply to every draft.
- Open a PR and stop.

## Review Focus
- An example contains an old rule break (e.g. "Ready Check this week", a phone number) → the draft check/fix still catches anything copied.
- An example names another owner or address → stripped before it goes in the prompt.
- No sent replies yet → prompt works with zero examples.
- Example reader query fails → draft still written, without examples.
- Examples are all about one topic → still fine; pick by topic when possible, else latest.

---

### Task 1: Style examples reader
**Files:** Create `src/lib/ai-style.core.ts`, `src/lib/ai-style.server.ts`; Test `tests/ai-style.test.ts`
**Interfaces — Produces:** `type StyleExample = { theirEmail: string; reply: string; at: string }`; `pickStyleExamples(rows: StyleExample[], topicWords: string[], max = 8): StyleExample[]` (prefer rows sharing words with the owner's email, then newest); `scrubExample(reply: string, owner: { name?: string; address?: string }): string` (replaces names after "Hi", addresses, emails, phone numbers, URLs with placeholders); `loadStyleExamples(jobId: string, ownerEmail: string): Promise<StyleExample[]>` reading `job_communications` (`channel='email'`, `direction='outbound'`, `source_event='email_ai_draft_sent' OR like 'outlook_sync:%'`, non-QA jobs, newest 60) paired with the inbound email before it on the same job; errors → `[]`.
- [ ] Test: picking prefers topic overlap then recency, max 8; scrub removes "Hi Mohamed" → "Hi <name>", URLs → `<link>`, phone numbers and emails; reader returns `[]` on error (fake supabase).
- [ ] FAIL → implement → PASS. Commit `feat(ai-reply): read Jo's recent replies as style examples`

### Task 2: Prompt uses the examples and new length/tone
**Files:** Modify `src/lib/ai-email-reply.core.ts` (`instructionLines`, `buildAiReplyInput`), `src/lib/ai-email-reply.server.ts` (`writeAiReplyDraft`); Test `tests/ai-style.test.ts`
**Interfaces — Consumes:** `loadStyleExamples`, `pickStyleExamples`. **Produces:** `buildAiReplyInput(c, { preRelease, answers, style })` adds "How Jo writes (style only — never copy facts, prices, dates, names or promises from these):" with each example; instructions replace "Short sentences" length rule with "Answer each question fully, explaining the why when it helps, in short sentences. Warm and plain; an occasional :) is fine."
- [ ] Test: section present with examples, absent with none; the "never copy facts" sentence is present; instructions contain the new length line and not the old one; `writeAiReplyDraft` calls `loadStyleExamples` (source check).
- [ ] FAIL → implement → PASS. Commit `feat(ai-reply): replies written in Jo's style`

### Task 3: Pull request
- [ ] Push `feat/ai-reply-voice`, open PR, stop. PR asks Jo to check 5 new drafts on TEST jobs for tone.
