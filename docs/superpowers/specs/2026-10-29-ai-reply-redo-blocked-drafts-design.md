# AI replies, step 1 of 4: redo blocked drafts — design

Part of "build the AI responses" (Jo, 29 Oct 2026). Order agreed: 1 redo blocked drafts → 2 answer more questions → 3 sound like Jo, smarter and more specific → 4 send simple ones itself. This spec is step 1 only.

## Problem
A job's AI reply draft is checked against Jo's rules (`aiReplyProblems`: scheme words, phone numbers, "call us", and before release no Ready Check / installer talk). A draft that breaks a rule is still saved, and Send then blocks it with a red note, so Jo has to reword it by hand. Example: HV-1263 (Mohamed), drafted 29 Oct 4:50pm before the pre-release rule was on; Send now blocks "ready check", "installer will".

## Decisions (Jo, 29 Oct 2026)
1. **When a draft is made:** after writing it, the AI's draft is checked. If it breaks a rule, the AI is asked to fix it — up to 2 tries — before it is saved.
2. **When Jo taps Send and it's blocked:** instead of only a red note, the AI fixes **only the bad bits**, keeping Jo's wording and edits. The fixed version is shown in the box and saved as her latest edit. **Nothing is sent** — Jo reads it and taps Send again.
3. **Still breaks a rule after 2 tries:** same as today — the draft stays with the red note for Jo to edit.
4. **Drafts already waiting** (e.g. Mohamed's): no bulk change. They are fixed by point 2 when Jo taps Send.

## Change from step 2 grilling (Jo, 29 Oct, Q18/Q21)
For AI replies only, the pre-release check no longer bans "Ready Check" / installer talk — replies may explain what a released spot means. It still bans any timing promise (e.g. "soon", "shortly", "this week", "next week", "in a few days/weeks", "within N days/weeks", "jump the queue", "move up"). Jo's wait line (step 2 spec) is allowed. Automatic emails, texts and the My job page keep the full decision-388 ban. So `aiReplyProblems` uses a new `aiPreReleaseViolations` (timing only) instead of `preReleaseViolations`, and the pre-release prompt is replaced as set out in the step 2 spec.

## Not in this step
- No-job replies on the Emails tab (they have their own checks) — unchanged.
- No new rules, wording or tone changes (steps 2–3). No auto-send (step 4).

## How
- `ai-email-reply.core.ts`: `AI_FIX_TRIES = 2`; `AI_FIX_INSTRUCTIONS` (change only the words/sentences that break the listed rules, keep everything else word for word, same greeting, no sign-off); `buildAiFixInput(body, problems, preRelease)` (the draft without its sign-off + the problems + for pre-release the allowed spot-only lines).
- `ai-email-reply.server.ts`: `fixUntilClean(body, preRelease, ai)` → `{ body, problems }` (check → fix → re-check, at most `AI_FIX_TRIES` AI calls; an AI error stops and keeps the last version). Used in `writeAiReplyDraft` after the first draft, and by Send.
- `sendAiDraft`: when the checks fail, run `fixUntilClean` on Jo's body. Save the result as a draft edit (`email_ai_draft_edited`) and return `{ status: "rewritten", body, problems }` instead of sending. Scheme words, phone and "call us" are included (they are rule breaks too).
- Screens: Emails tab job card and the job page drafts (`AiReplyDrafts.tsx`): on `rewritten`, put the new body in the box and show "We fixed the reply so it follows your rules — check it and press Send." (or the red note if problems remain).

## Testing
- Unit: `buildAiFixInput` lists the problems and keeps the draft; `fixUntilClean` with a fake AI: clean first time → 0 calls; fixed on try 1 → 1 call; never fixed → 2 calls and problems kept; AI throws → last version kept.
- Source checks: `writeAiReplyDraft` and `sendAiDraft` use `fixUntilClean`; Send never sends a `rewritten` body.
- On a TEST job: a pre-release draft containing "Ready Check" → Send shows a fixed version, nothing sent.
