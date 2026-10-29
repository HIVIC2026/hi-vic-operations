# Activity 48 Batch 1 — Safety Checks Enforce the Official Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A safety check (PIESA) that breaks the DEECA form's own rules stops the job; the install-day form stops assuming safety; life support is sorted before the visit; the electrical certificate is checked.

**Architecture:** One pure rule-to-blocker function on top of the existing `evaluatePiesa`, enforced at the three places the PIESA result is used; existing event / Needs me / guarded-sender patterns; the existing AI gateway for the certificate read.

**Tech Stack:** TypeScript, TanStack Start, Supabase admin client, Lovable AI gateway (`LOVABLE_API_KEY`), Bun test.

**Spec:** `docs/superpowers/specs/2026-10-29-a48-batch1-safety-checks-design.md`

## Global Constraints

- Branch `fix/a48-batch1-safety-checks`; never push to `main`; never rewrite pushed commits. Ends with an open PR — no merge, no publish. No live database change without Jo's yes.
- Electrician message exactly: `Hi {name}, the safety check for {job} at {address} can't go ahead yet: {reason}. Please correct the form in Mitti or book the repairs. Thanks, Home Insulation Victoria` — `{reason}` only from the REASON table below (Jo approves the table with this plan).
- "On site at the start" (B1 option 3) is valid only for Part 2–3 problems; any Part 4 No / Part 5 Yes / Part 6 prohibited luminaire needs rectification (B1 option 2).
- Office-only wording: Needs me rows "Safety check breaks the official rules — {reason}" and "Check electrical certificate — {why}".
- TEST (`qa_test`) jobs → test-send. Sends once per PIESA form version (idempotency key `piesa-rules:v1:<jobId>:<formVersion>`).
- Server functions literal `createServerFn(...).middleware(...).inputValidator(...).handler(...)`. `bun scripts/scan-retired-terms.ts` → 0.

**REASON table (rule → `{reason}`):**
| Rule(s) from `evaluatePiesa` | `{reason}` |
|---|---|
| `P2P3-NO` | a switchboard or solar answer is No, so repairs are needed (or you must be on site at the start) |
| `RECT-REQUIRED:*`, `B1-NOT-POSSIBLE-PART4-6` | wiring, safety switch (RCD) or downlight problems must be repaired before the install |
| `P2-SWITCH-OVERALL` | the main switch answer must be No when any switchboard item is No |
| `B1-NOT-POSSIBLE-SCOPE` | "not possible" was chosen but no switchboard or solar answer is No |
| `B1-ONE`, `B1-B2`, `B2-ONLY-IF-RECT` | the repairs list doesn't match the repairs answer |
| `P1-LIFE-SUPPORT` | life support is ticked but no consent or medical plan is attached |
| `P7-DESCRIBE`, `P7-ROW-INCOMPLETE`, `P7-OTHER-INCOMPLETE` | an appliance or hazard row is incomplete |
| required-field misses (`requiredMissing`) | some required answers are blank |
Not blocking here (handled elsewhere): `COPY-24H`, `P7-NOT-EFFECTIVE`, next actions.

## Review Focus

1. A corrected PIESA (new form version) clears the block and does not re-send the message for the old version (Task 2 `corrected form clears`).
2. Mitti re-syncs the same form version many times → one event, one message, one row (Task 2 `resync once`).
3. Part 2–3 only problem + "on site at the start" still allowed; with an added Part 6 non-IC downlight → blocked (Task 2).
4. AI gateway down / no key → the certificate goes to the office row, never auto-ticked (Task 5 `ai error`).
5. Life support "unknown" counts like "yes" for the visit block; a PIESA "No" answer never clears an owner "yes" (Task 4).

---

### Task 1: Blocking rules with plain reasons

**Files:** Modify `src/lib/official-forms.core.ts` (export `piesaRuleBlockers`, `PIESA_RULE_REASON`). Test `tests/a48-b1-piesa-rules.test.ts`.

**Interfaces — Produces:** `piesaRuleBlockers(answers: OfficialAnswers): { rule: string; reason: string }[]` (deduplicated by reason, REASON table order); `PIESA_RULE_REASON: Record<string, string>`.

- [ ] Failing tests from DEECA cases: switchboard No + B1 "not required" → `[{rule:"P2P3-NO", reason: table}]`; non-IC downlight (p6) + B1 "not possible" → RECT/B1-NOT-POSSIBLE-PART4-6 reason; Part 2 No only + B1 "not possible" → `[]`; all clear + "not required" → `[]`; life support yes without attachment → life-support reason; blank required field → "some required answers are blank"; `COPY-24H` / `P7-NOT-EFFECTIVE` never returned; exact reason strings = table.
- [ ] RED → implement (wrap `evaluatePiesa(...).blockers`, map by rule prefix) → GREEN (+ `tests/official-forms.test.ts`) → commit `feat(piesa): official form rule failures with plain reasons`.

### Task 2: Enforce the rules; electrician message; Needs me

**Files:** Modify `src/lib/piesa-complete.server.ts` (`completePiesaAssessment`), `src/lib/official-piesa-issue.server.ts` (`issueOfficialPiesa`), `src/lib/workflow.server.ts` (`stageEntryBlockers` for `piesa_complete`, `installation_*`), `src/lib/official-short.core.ts` (`deriveRectificationOutcome`), `src/lib/fixes-times.core.ts` (`onsiteStartOnly`), `src/lib/mitti.server.ts` (on PIESA sync: record + notify), office-needs core/server + `needs-cards.core.ts` `CARD_OF`. Create `src/lib/piesa-rules-notice.server.ts` (`notifyPiesaRuleFailure(jobId, formVersion, reasons)`). Test `tests/a48-b1-piesa-enforce.test.ts`.

**Interfaces — Consumes:** Task 1. **Produces:** event `piesa_rules_failed {form_version, rules, reasons}`; `piesaRulesBlockerFor(jobId): Promise<string | null>` (null when the newest PIESA version has no blocking rules or a signed Section C covers it).

- [ ] Failing tests: synced PIESA with P2P3-NO → `completePiesaAssessment` refuses, `issueOfficialPiesa` refuses, `stageEntryBlockers("installation_booked")` contains "Safety check breaks the official rules"; one `piesa_rules_failed` event; electrician text + email with the exact message and reason (test-send on TEST); one Needs me row; `resync once` (same version ×3 → 1 event, 1 send); `corrected form clears` (new version, rules pass → blocker null, row gone, no new send); signed Section C covering the items → clears; `deriveRectificationOutcome` with Part 6 non-IC + "on site at start" → outcome "rectification required"; `onsiteStartOnly` false in that case; Part 2–3 only + on site → still allowed.
- [ ] RED → implement → GREEN (+ `tests/*piesa*`, `tests/fixes-times*`, `tests/*mitti*`, `tests/*needs*`) → commit `fix(piesa): a safety check that breaks the official rules stops the job`.

### Task 3: Install-day form stops assuming safety

**Files:** Modify `src/lib/install-day.core.ts` (`piesaPart5Answers`). Test `tests/a48-b1-piisa-part5.test.ts`.

- [ ] Failing tests: PIESA Part 4–6 all clear → Part 5 items "Yes" (unchanged); B1 "not required" with Part 4 No → those items left blank (not "Yes"); B1 "not possible" → Part 5 blank; rectification with signed Section C confirming the item → "Yes"; Section C missing → blank, so `P5-CANNOT-COMMENCE` can fire (assert via `piisaGate`).
- [ ] RED → implement → GREEN (+ `tests/install-day*`, `tests/*piisa*`) → commit `fix(piisa): Part 5 only marked safe when the safety check confirms it`.

### Task 4: Life support before the safety check visit

**Files:** Modify `src/lib/compliance-timeline.core.ts` (`complianceRecordBlockers`: life-support plan required for `piesa_scheduled`, replacing `assessment_booked`), `src/lib/mitti.server.ts` (PIESA sync: life-support "Yes" → `jobs.life_support = true`, never cleared). Test `tests/a48-b1-life-support.test.ts`.

- [ ] Failing tests: `life_support` yes → `piesa_scheduled` blocked until the plan/consent record exists (owner upload and office record both clear it); `unknown` → same; `no` → not blocked; PIESA sync with life support Yes on a "no" job → flag set + block applies before install; PIESA "No" never clears an owner "yes".
- [ ] RED → implement → GREEN (+ `tests/*life-support*`, `tests/compliance-timeline*`, `tests/*piesa-scheduled*`) → commit `fix(life-support): consent or plan needed before the safety check visit`.

### Task 5: Electrical certificate check (AI first, office second)

**Files:** Create `src/lib/coes-check.core.ts` (`coesVerdictFromModel(text): CoesVerdict`, prompt constant), `src/lib/coes-check.server.ts` (`checkCoes(jobId, fileRef)`); call it from the CoES upload paths (`src/lib/fixes-day.server.ts`, PIESA evidence q45 handling); office Tick/Reject server fn in `src/lib/coes-check.functions.ts`; Needs me row + `CARD_OF`; gate in `workflow.server.ts` `stageEntryBlockers("installation_booked")` when rectification happened. Test `tests/a48-b1-coes.test.ts`.

**Interfaces — Produces:** `type CoesVerdict = { verdict: "ceiling_work" | "not_ceiling" | "unsure"; quote: string | null }`; events `coes_checked {by: "ai" | "office", verdict}`, `coes_rejected {by, note}`.

- [ ] Failing tests (gateway stubbed): `ceiling_work` → `coes_checked {by:"ai"}`, no row, install not blocked by it; `unsure` / `not_ceiling` → row "Check electrical certificate — {why}", install blocked until office Tick; office Reject → `coes_rejected`, still blocked; `ai error` (no key / throw) → office row, never auto-ticked; no rectification → no check needed; new certificate upload re-runs the check.
- [ ] RED → implement (multimodal input: PDF/image; model as in `ai-email-reply.server.ts`) → GREEN (+ `tests/fixes-day*`, `tests/piesa-evidence*`, `tests/*needs*`) → commit `feat(coes): certificate checked by AI, office decides when unsure`.

### Task 6: Whole-branch check
- [ ] Full suite per file vs baseline; tsc (only xlsx); retired scan 0; final whole-branch review + one fix wave; push; open the PR (REST API). Stop — no merge, no publish.
