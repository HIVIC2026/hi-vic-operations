# AI Replies Step 4 — Send Simple Ones Itself Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once Jo has seen samples and tapped "Turn on auto-send", the AI sends three kinds of simple job replies itself (job status, resend a link, photos/files received), outside 8pm–7am; everything else stays a draft.

**Architecture:** The AI labels each draft's kind in its machine block (`KIND:`). A pure core rule decides eligibility. The on/off switch is append-only `workflow_events` (`ai_auto_send_switched`, latest wins) — no new table. Eligible drafts are sent through the existing `sendAiDraft` path with no office actor; quiet-hours ones wait and a 15-minute sweep sends them from 7am.

**Tech Stack:** TypeScript, Supabase, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-29-ai-replies-steps-2-4-design.md` (§ Step 4). Branch from step 3.

## Global Constraints
- Auto-send kinds: `job_status`, `resend_link`, `files_received` only. Plain "thanks" stays NO_REPLY.
- Never auto-send when: switch off, kind not allowed, any `aiReplyProblems` after the fix loop, `needs_answer` non-empty, `needs_you`, any proposed action (note/size), job is TEST/QA unless the test sender redirects, owner opted out, 8pm–7am Melbourne (held to 7am, re-checked then; skipped if a newer email arrived or the draft was sent/discarded).
- Default is OFF. The switch can only be turned on from the AI answers page after the 10 samples are shown.
- `AI_EMAIL_AUTO_SEND_ENABLED` constant is removed (it was never read).
- Auto-send must check the draft with `aiReplyProblems(body, { preRelease, aiDraft: true })` (or rely on the saved `details.problems`, which uses aiDraft) — never the plain Send path, which skips the "fixes"/"safety check" rules for Jo's own typed words (Jo, 30 Oct).
- Open a PR and stop.

## Review Focus
- Two inbound emails from one owner within minutes → at most one auto-reply; the second waits as a draft.
- Switch turned off while a held (quiet-hours) reply waits → it is not sent at 7am.
- AI labels a payment complaint as `job_status` → any `needs_*`, action or problem still blocks; complaint wording ("refund", "damage", "unhappy", "mess", "cancel") also forces a draft.
- Send fails (Outlook down) → draft stays for Jo, marked "Auto-send failed".
- Job moved stage between draft and 7am send → status reply is re-written from current facts before sending, or left as a draft if that fails.

---

### Task 1: Kind label and eligibility rule
**Files:** Modify `src/lib/ai-email-reply.core.ts` (instructions, `splitAiOutput`); Test `tests/ai-auto-send.test.ts`
**Interfaces — Produces:** `type AiAutoKind = "job_status" | "resend_link" | "files_received" | "other"`; `splitAiOutput` returns `kind`; `AUTO_SEND_KINDS`; `COMPLAINT_WORDS` regex; `autoSendDecision(d: { switchOn: boolean; kind: AiAutoKind; problems: string[]; needsAnswer: string[]; needsYou: boolean; hasActions: boolean; optedOut: boolean; ownerEmail: string; nowIso: string }): { send: "now" | "at7am" | "no"; reason: string }`.
- [ ] Test each blocker returns `no` with a plain reason; eligible at 2pm → `now`; eligible at 9pm → `at7am`; complaint words in owner email → `no`.
- [ ] FAIL → implement → PASS. Commit `feat(ai-reply): which replies may send themselves`

### Task 2: Switch + samples on the AI answers page
**Files:** Create/modify `src/lib/ai-auto-send.server.ts`, `src/lib/ai-answers.functions.ts`, `src/routes/_authenticated/admin.ai-answers.tsx`; Test `tests/ai-auto-send.test.ts`
**Interfaces — Produces:** `autoSendOn(): Promise<boolean>` (latest `ai_auto_send_switched` event `details.on`; error → false); `switchAutoSend(on: boolean, actorId)` (requireAdmin); `autoSendSamples()` → latest 10 drafts with an auto kind (body, kind, owner first name, sent/edited state).
- [ ] Test: no events → off; latest wins; error → off; "Turn on auto-send" button is only shown after the samples list renders and asks "Turn on? Simple replies will send without you." before switching; "Turn off" always available.
- [ ] FAIL → implement → PASS. Commit `feat(ai-reply): auto-send switch with samples`

### Task 3: Send eligible drafts, hold quiet-hours ones
**Files:** Modify `src/lib/ai-email-reply.server.ts` (`writeAiReplyDraft`, `sendAiDraft` accepts `actorId: string | null` and `via: "office" | "ai"`); Create sweep in `src/lib/ai-auto-send.server.ts` wired into the existing 15-minute tick (find the tick that runs owner email work, e.g. `outlook-sync` sweep); Test `tests/ai-auto-send.test.ts`
**Interfaces — Produces:** draft `details.auto: { decision, reason, kind }`; sent event `details.via = "ai"`; job history shows "Sent by AI"; `sweepHeldAutoReplies(now)`.
- [ ] Test (fake supabase + mocked send): `now` → sent once with `via:"ai"`, idempotent on re-run; `at7am` → not sent at 9pm, sent by sweep at 7:05am, not sent if switch off / newer inbound / already handled; send failure → draft kept with "Auto-send failed".
- [ ] FAIL → implement → PASS. Commit `feat(ai-reply): send simple replies automatically`

### Task 4: Morning report count + screens
**Files:** Modify `src/lib/daily-brief.server.ts`, `src/lib/daily-brief.core.ts`, `src/components/portal/AiReplyDrafts.tsx`, `EmailsScreen.tsx`; Test `tests/ai-auto-send.test.ts`
**Interfaces — Produces:** `DailyBrief.aiAutoSent: number` (yesterday, non-QA) shown as "AI replies sent by themselves: N"; sent drafts show "Sent by AI" label.
- [ ] Test brief count and labels. FAIL → implement → PASS.
- [ ] Ruling to confirm with Jo in the PR: the portal's daily brief runs at 7am; if her "6am report" is a different report, add the same line there.
- [ ] Commit `feat(ai-reply): show what the AI sent`

### Task 5: Pull request
- [ ] Push `feat/ai-reply-auto-send`, open PR, stop. Switch stays OFF after merge until Jo turns it on.
