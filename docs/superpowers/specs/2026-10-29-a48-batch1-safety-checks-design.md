# Activity 48 batch 1 — safety checks enforce the official rules (design)

Date: 29 Oct 2026 · Owner: Jo · Branch `fix/a48-batch1-safety-checks`. Ends with an open PR (no merge, no publish). Any live database change only after Jo says yes.
Source: the 29 Oct Activity 48 audit (R5, R40, R42, R55, R56, R59). Later batches: 2 eligibility, 3 VEEC claim details, 4 owner documents & money, 5 smaller items.

## In plain words

| | Today | After |
|---|---|---|
| Electrician's safety check (PIESA) answers clash with the official rules — e.g. a switchboard/isolation problem but "no repairs needed"; "on site at the start" used for problems the form says must be repaired first (wiring, RCD/protection, non-IC downlights) | The official rule check only writes to a log. The job carries on to the install | The job can't move on (no install booking, no completion). The electrician gets a message. Needs me row "Safety check breaks the official rules — {reason}". Clears when a corrected form arrives or the repairs are signed off |
| Install-day form (PIISA) Part 5 (downlights IC, RCD, wiring, basic protection) | Ticked "Yes" automatically when the safety check said "no repairs" or "on site at start" | Only "Yes" when the safety check really confirms it (Part 4–6 all clear, or repairs signed off in Section C) |
| Life support (owner says yes / not sure) | Only blocks the install | The safety check visit can't be booked until the consent or medical plan is uploaded (owner or office). If the electrician finds life support on site, the job is marked life support and the same block applies |
| Electrical safety certificate (CoES) after repairs | Kept, never checked | AI reads it on upload. Clearly describes the ceiling repair work → ticked. Not sure / doesn't → the install waits and the office gets a Needs me row to tick or reject |

**Electrician message (approved by Jo 29 Oct), text + email:**
"Hi {name}, the safety check for {job} at {address} can't go ahead yet: {reason}. Please correct the form in Mitti or book the repairs. Thanks, Home Insulation Victoria"
`{reason}` is a short plain line per rule (office-reviewed list in the plan; no other new wording).

## Technical detail

**1 Rule failures become blockers.** `official-forms.core.ts` `evaluatePiesa` already holds the rules (P2P3-NO, RECT-REQUIRED, B1-NOT-POSSIBLE-PART4-6, P6 prohibited luminaires, life-support STOP, …). New pure `piesaRuleBlockers(answers)` returns the blocking subset with a plain reason each. Run it where the PIESA result is used: `piesa-complete.server.ts` `completePiesaAssessment`, `official-piesa-issue.server.ts` `issueOfficialPiesa`, and `workflow.server.ts` `stageEntryBlockers` for `piesa_complete` and `installation_*`. `official-short.core.ts` `deriveRectificationOutcome` / `fixes-times.core.ts` `onsiteStartOnly`: "on site at the start" is only valid for Part 2–3 problems; with any Part 4–6 problem the outcome is "rectification required". A blocked PIESA records `piesa_rules_failed {rules, reasons}` (once per form version), sends the electrician message once per form version (existing guarded sender; TEST → test-send; switch like other trade texts), and raises one Needs me row (`CARD_OF` mapped). A later PIESA sync/correction or a signed Section C re-evaluates and clears.

**2 PIISA Part 5 no longer assumed.** `install-day.core.ts` `piesaPart5Answers` returns "Yes" only when the PIESA facts support it: Part 4–6 all clear, or Section C confirms the item after repairs. Otherwise the field is left for the installer, so `P5-CANNOT-COMMENCE` can stop the install.

**3 Life support before the visit.** `compliance-timeline.core.ts` `complianceRecordBlockers`: the life-support plan/consent is required for `piesa_scheduled` (replacing retired `assessment_booked`) when `jobs.life_support` is yes or unknown. Owner upload uses the existing life-support upload; office upload via the existing record. On PIESA sync, a life-support "yes" answer sets `jobs.life_support = true` (never clears it).

**4 CoES check.** On CoES upload (`fixes-day.server.ts` / PIESA evidence q45), the file is read by the existing AI gateway (`LOVABLE_API_KEY`, as `ai-email-reply.server.ts`) with a fixed prompt returning `{ verdict: "ceiling_work" | "not_ceiling" | "unsure", quote }`. `ceiling_work` → `coes_checked {by:"ai"}`. Otherwise (or AI unavailable/error) → Needs me row "Check electrical certificate — {why}" with office Tick / Reject. Reject asks the electrician for a new certificate via the office's existing message tools (no new owner wording). Gate: when rectification happened, `installation_booked` needs `coes_checked` (AI or office).

## Testing
Test-first per item. Rule cases from the DEECA form: switchboard "No" + "no repairs" → blocked; non-IC downlights + "on site at start" → blocked; Part 2–3 only + "on site at start" → allowed; corrected form → clears; message sent once per form version; PIISA Part 5 not auto-ticked unless confirmed; life support yes/unknown blocks `piesa_scheduled` until upload; electrician-found life support sets the flag; CoES AI verdicts (stubbed) → tick / office row; AI error → office row. Existing PIESA/PIISA/fixes/mitti tests; full suite vs baseline; tsc; retired scan.
