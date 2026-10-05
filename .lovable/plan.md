# AI assistant that learns (plan only, low priority)

Queue position: after trade launch fixes, the Xero dummy-run loop and the office rebuild. Nothing is built until Jo approves.

## What it is
An office helper that makes a suggestion, shows its reasons, and learns from what the office decides. It never decides things that must stay human.

Always human, never AI: AP sign-off, VEEC lodgement, payments, partner approvals, eligibility final say, stage moves past the existing guards. Sending switches are respected: if sending is off, drafts stay drafts.

## The six parts
1. **Decision log**: every suggestion and every human decision is saved. This covers the job, what the AI looked at, its verdict, reason and confidence, what the office decided, any override reason, and later the real outcome (for example, the onsite R-value).
2. **Learns from examples**: before suggesting, it pulls up to 8 similar past cases with Jo's decisions on them. "Similar" means the same task, similar area, insulation, price, region and installer.
3. **Corrections become guidance**: overriding the AI needs a short reason. Pick a common reason or type one. When the same reason comes up 3 or more times in 30 days, it is drafted as a written rule for Jo to approve. Rules are never applied automatically. Approved rules are added to that task's instructions and versioned.
4. **Scorecard per task**: shows how often the AI agreed with the office, by week. Only Jo can switch a task to "AI handles alone within limits", and only when it is above her chosen agreement rate (default 95% over the last 50 cases). If the rate over the last 20 cases drops below that, it switches back to "ask office" by itself, and that change is logged.
5. **Weekly insights**: a short plain-English note in Needs me. Examples: installer quotes compared with estimates by region, where owners drop off, slow trades, and the most common override reasons.
6. **Runs when things happen**: it starts the moment the event happens (a video is uploaded, a quote is held, a message arrives, evidence is submitted). It is not a timed job. The weekly insight is the only scheduled piece.

## First tasks, in order
a) **Manhole video/photo desk check.** Verdict: likely under R2, over R2, or unclear. It feeds the "Needs video check" list, with the suggestion shown in each row.
b) **Held quotes and fix-up quotes.** Suggests "approve within rules" or "keep held", with the rule and number behind it. Example: "Variance 12%, under the 15% limit."
c) **Enquiry and owner replies.** Drafts a reply in approved wording; the office edits and sends. Auto-send for standard replies comes later, only once that task is trusted and sending is on.
d) **Ready Check evidence pre-check.** Lists missing photos and numbers that don't add up, such as room areas that don't match the total m² or a removal area larger than the ceiling.

## Screens
- **Suggestion card**: shown on the job's "Right now" card and in the matching Needs me row. It shows the verdict, confidence, a one-line reason, "Based on 5 similar jobs" (expandable), and Accept / Change.
- **Change**: pick the right answer plus a reason (pick a common one or type), in one step.
- **Draft reply**: an editable text box with Send, which stays greyed out while sending is off.
- **Settings > AI assistant**:
  - a scorecard table per task (agreement %, cases, trend line, mode, threshold)
  - Jo's mode switch
  - suggested rules waiting for approval (Approve / Reject / Edit)
  - the rule history
- **Weekly insights**: a card in Needs me linking to the full note.

## Data tables (new)
- `ai_tasks`: task key, mode (ask office / handles alone), threshold, instructions version.
- `ai_suggestions`: job, task, input snapshot, verdict, reason, confidence, similar case IDs, model, cost, created at.
- `ai_decisions`: suggestion, decided by, decision, agreed yes/no, override reason, decided at.
- `ai_outcomes`: suggestion, real result recorded later, matched yes/no.
- `ai_rule_proposals`: task, proposed text, supporting decisions, status, approved by/at.
- `ai_task_rules`: approved rules per task, versioned.
- `ai_insights`: week, text, figures used.

All tables are office-only. The decision log can't be edited or deleted (a safety rule in the database) and is written into the job history.

## Cost estimate (~500 jobs a month)
| Task | Calls/month | Notes |
|---|---|---|
| Video/photo check | ~300 | 4–6 still frames per video |
| Held/fix-up quotes | ~150 | text only |
| Reply drafts | ~1,000 | short text |
| Evidence pre-check | ~150 | photos + numbers |
| Weekly insights | 4 | summary text |

These numbers are rough and need checking against real usage in stage 1. The total looks like about US$30–80 a month in AI credits, mostly from images. Finding similar cases uses ordinary database searches, so it adds little cost. The bill is kept down by sending still frames instead of full video, sending short case summaries, and asking only once per event.

## Staged rollout
1. **Logging only, task a.** Suggestions are shown, the office decides, everything is logged. Run for 4 weeks.
2. **Add tasks b and d**, plus the override reasons and the rule proposals.
3. **Scorecard and Jo's mode switch.** "Handles alone" covers task a only, and only for confident under-R2 or over-R2 results. Unclear always goes to the office.
4. **Task c drafts**, then weekly insights.
5. **Auto-send standard replies**, only after Jo approves the wording, the scorecard passes, and sending is on.

Each stage is tested on practice data first (TEST jobs only), with screenshots before Jo turns it on.

## Technical details
- Pure rules in `ai-assistant.core.ts`: case similarity, scoring, mode fallback, rule-proposal grouping. Saving to the database in `ai-assistant.server.ts`. Calls from the app in `ai-assistant.functions.ts`.
- Runs off existing triggers: the video upload handler, the quote-hold path, incoming messages, evidence submit. It works through the existing work queue, so a failure shows in Needs me (rule e) instead of being lost.
- Uses Lovable AI with the default model, structured output, and still images for video. If the AI runs out of credits or is refused access, the queue pauses and Needs me shows why.
- Database changes are proven on the practice database with an undo step before they go live.
- In "handles alone" mode the AI only updates its own suggestion status or the video-check verdict. Any stage move still goes through the existing guards.
- AI data is used only for this portal, never for training. Xero data is never sent to the AI.
