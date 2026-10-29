# Installer job path fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the installer job path (Mitti Ready Check, then Complete, then installer price, then quote drafted, held or sent, then what the office and installer see) hold for the office with a reason whenever something is wrong or unclear. It must never complete, quote or send on a guess. This covers all 17 fixes in the spec.

**Architecture:**
- **Reading the form:** the Mitti reader (`mitti.core.ts parseAudit`) returns a new `holdIssues` list for area, access and "Not sure" problems. It also reads the before video as a real video only.
- **Complete rules:** the pure rule `completionPlan` (`mitti-complete.core.ts`) gains a `cancel` result for failed Ready Checks. It holds on `holdIssues`, and it re-checks eligibility before returning `already`.
- **Complete step:** `finishMittiReadyCheck` stops at `ready_check_complete`; the existing send step still moves the stage. A new module `ready-check-failed.server.ts` runs the existing guarded `cancelJobFully` and the existing guarded O6/O69 senders.
- **Hold display:** one pure hold reader (`currentQuoteHold` in `ready-check-chase.core.ts`) feeds three things: the office Quote card, the installer line, and the next step text.
- **Electrician and price:** small server changes in the existing modules. The new button lives in its own module, off the autoAdvance import graph.

**Tech Stack:** TypeScript, TanStack Start, Supabase (`supabaseAdmin`), `bun test`. Fakes are PGlite (`tests/helpers/pglite-postgrest-shim.ts`) or `tests/helpers/memory-postgrest.ts` with `mock.module`. Pure `*.core.ts` modules are tested directly. Server wiring is tested with source-reading tests, as the repo already does.

**Spec:** docs/superpowers/specs/2026-10-29-quote-hold-rvalue-and-status-design.md

## Global Constraints
- The rule throughout: "when something is wrong or unclear, hold for the office and say why. Never complete, quote or send on a guess."
- HIV's electrician costs **$349**. Its owner line comes from retail settings (`piesa_assessment_inc_gst`, 349 when unset). No price or amount changes.
- Removal is **$15/m²** for batts and loose fill alike. Mixed insulation types never hold.
- **8pm rule:** no owner email or text between 8pm and 7am Melbourne time (`smsQuietReason` in `quote-hold.core.ts`). Anything held for this reason is tried again later and goes at most once.
- **No owner messages** come from these fixes, except the fix-1 cancel emails: O6 "Not eligible" and O69 "Job cancelled", HIV leads only, once per job.
- **Reuse existing templates and senders.** O6 uses the existing T7 renderer `renderPreliminaryIneligibleMail` with the per-job key `ineligibleKey(jobId)`. O69 uses `cancelJobFully`, which calls `sendCancelNotices` with key `cancel-notice:v1:{job}:{seq}:owner`. No new templates.
- **Boss only:** the "Use HIV's electrician ($349)" button shows a rate, so it is for the business admin only (`requireMember(userId, businessId, true)`). Staff never see it.
- **No made-up R-value:** "Below R2.0" answers the R-value question, but `existing_r_value` stays empty.
- Pending DB changes go in `docs/pending-migrations/`. They are proven on PGlite in a `*-practice-db.test.ts` and applied live by Jo only after she approves. Record each live run in `docs/pending-migrations/APPLIED_MANUALLY.md`.
- Never force-push, rebase or amend pushed commits (Lovable sync).
- Run `bun scripts/scan-retired-terms.ts` before and after the work.
- Sender modules stay out of the `autoAdvanceJob` import graph. `tests/comms.test.ts` already has 2 failing assertions on the base commit (seen 29 Oct). Do not add new ones.

## Review Focus
1. **The database may refuse `installer_own` on `jobs.electrician_choice`.**
   - Migration 0023 created the column with a CHECK of `('preferred','approved_other','nominated','hivic_organise')`. Migration 0059's `ADD COLUMN IF NOT EXISTS ... CHECK(... 'installer_own' ...)` did nothing, because the column already existed.
   - `mitti.server.ts:310` writes `installer_own` without checking the error, so it may be failing silently today.
   - Test (Task 15): `add-job usual choice writes installer_own and the write error is surfaced`. Task 15 adds the pending migration (confirmed needed), proven on PGlite.
2. **Several fail reasons ticked at once** (for example "Existing insulation is R2.0 or above" plus "Homeowner does not want to proceed"). These give two different job results, so the job must hold and never cancel.
   - Test (Task 7): `mixed fail reasons with different results hold, never cancel`.
3. **The new "clear" event is never loaded.**
   - `needs.server.ts:160` only loads the event types in its `types` list. If `installer_quote_drafted` is missing from it, the office item never clears in production, even though the pure test passes.
   - Test (Task 13): `needs.server loads every event a Mitti rule clears on`.
4. **jsonb re-orders nested keys and drops keys that are `undefined`.** The repeat-history check must compare a canonical form with `undefined` removed, or HV-3519 keeps adding lines.
   - Test (Task 14): `nested key order and undefined keys are the same record`.
5. **A failed check or blocked text at night.**
   - O6/O69 after 8pm must wait. Cancel happens at the next pull after 7am, because the measurement stays a draft and `syncPendingMitti` re-runs the step.
   - A held O6 must be retried by its own path. `sendVerifiedIneligibleEmail` returns "not applicable" on cancelled jobs, so it cannot do this.
   - Tests (Task 10 and Task 11): `failed check at 9pm cancels nothing and sends nothing; at 7:30 cancels and emails once`, and `held O6 retried after 7am through the Ready Check path`.

---
### Task 1: "Under-insulated", the hold list and bad area answers in the Mitti reader (fixes 2, 3, 7)
**Files:**
- Modify: `src/lib/mitti.core.ts`
  - 436–441: area state, "Not sure" issue.
  - 470, 476: `insulated` and `insulation_present`.
  - 474–483: area and removal issues.
  - 533–535: access issue.
  - 642–652: `parseAudit` return.
- Test: `tests/mitti.core.test.ts` (copy the `it_`/`sel` helpers from `tests/lean-ready-check.test.ts`).

**Interfaces:**
- Produces: `export const isUnderInsulatedState = (state: string): boolean` (matches the normalised text "under insulated" and the raw "under-insulated").
- Produces: `parseAudit(audit).holdIssues: string[]`. It holds area-size issues, removal-size issues, invalid Length/Width numbers, the access issue "not recognised", and the "Not sure" issue. It does not hold R-values that differ, mixed types, or a hazard with no photo.

- [ ] Step 1: Write the failing test
```ts
test("older form 'Existing insulation: Under-insulated' counts as insulation present", () => {
  const p = parseAudit(oldAreaAudit({ "Existing insulation": "Under-insulated", "Measured area m2": "80" }));
  expect(p.patch.insulation_present).toBe(true);
  expect(p.areas[0]!.present ?? p.areas[0]!.existing).not.toBe("none");
});
test("holdIssues: invalid area, unreadable access and 'Not sure' only", () => {
  expect(parseAudit(leanAudit({ lengthM: "12m x", access: "Sort of" })).holdIssues).toEqual(expect.arrayContaining([
    expect.stringContaining("measured area was missing or invalid"), "Ceiling access answer not recognised – office review required."]));
  expect(parseAudit(leanAudit({ action: "Not sure" })).holdIssues).toContain("A ceiling area's existing insulation is marked 'Not sure' – office review required.");
});
test("holdIssues never carries differing R-values, mixed batts + loose fill or a hazard with no photo", () => {
  const p = parseAudit(leanAudit({ mixedTypes: true, rValues: ["1.5", "1.8"], hazardEvidence: false }));
  expect(p.issues.length).toBeGreaterThan(0);
  expect(p.holdIssues).toEqual([]);
});
```
- [ ] Step 2: Run `bun test tests/mitti.core.test.ts`. Expected: FAIL (`holdIssues` is undefined, and `insulation_present` is false).
- [ ] Step 3: Implement.
  - Add `isUnderInsulatedState`. Make the fallback state `"under insulated"`, and use the helper at lines 470 and 476.
  - Push each hold-type issue to both `issues` and a local `holdIssues` array, at the same places the issues are raised now.
  - Return `holdIssues`.
- [ ] Step 4: Run `bun test tests/mitti.core.test.ts tests/lean-ready-check.test.ts tests/ready-check-published-2026-10-25.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/mitti.core.ts tests/mitti.core.test.ts && git commit -m "fix(mitti): under-insulated counts as present; parseAudit lists area/access/Not sure hold issues"`

### Task 2: The before video means a real video in the video question (fix 4, Ready Check side)
**Files:**
- Modify: `src/lib/mitti.core.ts`
  - 86–98: `responseValue`.
  - 450: `photos.overview`.
- Modify: `src/lib/ready-check-lean.core.ts:100`: delete the `beforeVideo` aliases.
- Modify: `src/lib/mitti-forms.core.ts:154`: drop `aliases: al("beforeVideo")`.
- Test: `tests/lean-ready-check.test.ts`.
  - Add cases.
  - Update the expected `Missing:` list at line 291, because old forms really have no before-video question.

**Interfaces:**
- Produces: `export function isVideoMedia(m: unknown): boolean` (in `mitti.core.ts`). It is true only when `file_ext`, the `label` extension or `mime_type`/`content_type` says video (`mp4|mov|m4v|3gp|webm|avi|mkv` or `video/*`). Unknown means false.
- `responseValue` for media now returns `"N video(s)"` when at least one file is a video, and `"N photo(s)"` otherwise.

- [ ] Step 1: Write the failing test
```ts
test("before video: only a video in 'Slow 360° video…' counts", () => {
  const v = (files: object[]) => parseAudit(leanAudit({ beforeVideoMedia: files })).areas[0]!.beforeVideo;
  expect(v([{ media_id: "a", file_ext: "mp4" }])).toBe(true);
  expect(v([{ media_id: "b", file_ext: "jpg" }])).toBe(false);          // photo in the video question
  expect(v([{ media_id: "c" }])).toBe(false);                           // unknown type: never guessed
  expect(parseAudit(leanAudit({ overviewPhotoOnly: true })).areas[0]!.beforeVideo).toBe(false); // overview photo no longer counts
});
test("a missing before video is not a hold issue (quote still goes)", () =>
  expect(parseAudit(leanAudit({ beforeVideoMedia: [] })).holdIssues).toEqual([]));
```
- [ ] Step 2: Run `bun test tests/lean-ready-check.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement.
  - Add `isVideoMedia`, and change the media branch of `responseValue`.
  - At line 450, set `overview` to `/video/.test(find(kids,[LEAN_Q.beforeVideo],{withValue:true})?.value ?? "")`.
  - Remove the aliases.
- [ ] Step 4: Run `bun test tests/lean-ready-check.test.ts tests/mitti-new-answers-23oct.test.ts tests/mitti-ready-check-published-templates.test.ts tests/install-evidence.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/mitti.core.ts src/lib/ready-check-lean.core.ts src/lib/mitti-forms.core.ts tests/lean-ready-check.test.ts && git commit -m "fix(mitti): before video is the 360° video question with a real video"`

### Task 3: Remove "Not sure" from the form, plus the live Mitti paste (fix 3, form side)
**Files:**
- Modify: `src/lib/ready-check-lean.core.ts:129`: `EXISTING_ACTION_OPTIONS = ["Remove", "Top up"] as const`.
- Modify: `src/lib/mitti-forms.core.ts:147`: change the `source` text to "the installer onsite decides; real problems go in the issues question".
- Modify: `docs/MITTI_READY_CHECK_CHATGPT_PROMPT.md:91`: `Pick one: \`Remove\` / \`Top up\``.
- Create: `docs/mitti-paste-A1-A2-not-sure-removed.md`. Copy the shape of `docs/mitti-paste-A1-A2-hatch-optional.md`, with template IDs `01ee0428-be6d-4435-b34d-8b738935f099` and `dbaf67a2-c9c5-4120-8c69-0f4a43c5bd39`.
- Test: `tests/lean-ready-check.test.ts`.

**Interfaces:** Produces the changed `EXISTING_ACTION_OPTIONS` (no new functions).

- [ ] Step 1: Write the failing test
```ts
test("'What is required for the existing insulation?' offers only Remove or Top up", () => {
  expect([...EXISTING_ACTION_OPTIONS]).toEqual(["Remove", "Top up"]);
  expect(readFileSync("docs/MITTI_READY_CHECK_CHATGPT_PROMPT.md", "utf8")).not.toContain("`Not sure`");
});
test("the paste removes 'Not sure' on both A1 and A2 and changes nothing else", () => {
  const b = (readFileSync("docs/mitti-paste-A1-A2-not-sure-removed.md", "utf8").match(/```[\s\S]*?```/g) ?? [])[0]!;
  for (const s of ["01ee0428-be6d-4435-b34d-8b738935f099", "dbaf67a2-c9c5-4120-8c69-0f4a43c5bd39", `"${LEAN_Q.existingAction}"`, `"Not sure"`, "Change nothing else. Publish both."]) expect(b).toContain(s);
});
```
- [ ] Step 2: Run `bun test tests/lean-ready-check.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement the constant, the source text, the prompt line and the paste file. The paste deletes the option "Not sure" from that question on both templates and keeps "Remove" and "Top up" grey. Leave `tests/ready-check-published-2026-10-25.test.ts:97` alone, because it pins a historical fixture.
- [ ] Step 4: Run `bun test tests/lean-ready-check.test.ts tests/ready-check-published-2026-10-25.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/ready-check-lean.core.ts src/lib/mitti-forms.core.ts docs/MITTI_READY_CHECK_CHATGPT_PROMPT.md docs/mitti-paste-A1-A2-not-sure-removed.md tests/lean-ready-check.test.ts && git commit -m "feat(ready-check): remove 'Not sure' from the existing-insulation question (+ Mitti paste)"`

### Task 4: "Below R2.0" counts as the R-value answer (fix 8)
**Files:**
- Modify: `src/lib/scope.core.ts:48-57` (`missingMeasureFields`).
- Modify: `src/lib/portal.functions.ts:312,375`: pass `(m as {zones?: unknown}).zones`.
- Test: `tests/scope.core.test.ts`.

**Interfaces:**
- Produces: `missingMeasureFields(m: MeasurementValues | null | undefined, zones?: readonly { existing?: string | null; rValueBand?: string | null }[] | unknown): MeasureField[]`.
- `existing_r_value` is not missing when every zone with `existing === "present"` has `rValueBand === "below_r2"`, and there is at least one such zone.

- [ ] Step 1: Write the failing test
```ts
test("every insulated area 'Below R2.0' answers the R-value; no number is made up", () => {
  const m = { measured_area_m2: 120, insulation_present: true, existing_r_value: null, removal_required: false, access_difficulty: "easy" as const };
  expect(missingMeasureFields(m)).toEqual(["existing_r_value"]);
  expect(missingMeasureFields(m, [{ existing: "present", rValueBand: "below_r2" }, { existing: "none", rValueBand: null }])).toEqual([]);
  expect(missingMeasureFields(m, [{ existing: "present", rValueBand: "below_r2" }, { existing: "present", rValueBand: null }])).toEqual(["existing_r_value"]);
  expect(m.existing_r_value).toBeNull();
});
```
- [ ] Step 2: Run `bun test tests/scope.core.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement the optional `zones` argument (narrowing unknown input safely) and update both callers in `portal.functions.ts`.
- [ ] Step 4: Run `bun test tests/scope.core.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/scope.core.ts src/lib/portal.functions.ts tests/scope.core.test.ts && git commit -m "fix(scope): Below R2.0 on every insulated area answers the R-value"`

### Task 5: Cleared Mitti answers are written as blanks (fix 6)
**Files:**
- Modify: `src/lib/scope.core.ts:128-146` (`planMeasurementUpdate`).
- Test: `tests/scope.core.test.ts`.

**Interfaces:**
- Unchanged signature.
- When `external?.source === "mitti"`, at least one incoming value is not null, and the current row is absent or is the same Mitti form (`cur.external_source === "mitti" && cur.external_id === external.id`), then `values` carries all six `MEASURE_FIELDS`. Missing fields become `null`.
- Every other path is unchanged.

- [ ] Step 1: Write the failing test
```ts
test("Mitti update writes all six fields, blanks included (removal m² cleared after switching to Top up)", () => {
  const cur = { id: "m1", status: "draft" as const, source_role: "installer", external_source: "mitti", external_id: "a1", removal_m2: 40, removal_required: true };
  const p = planMeasurementUpdate({ scope: "SPLIT", current: cur, incoming: { measured_area_m2: 90, removal_required: false }, source: "installer", external: { source: "mitti", id: "a1" } });
  expect(p).toMatchObject({ action: "update", values: { measured_area_m2: 90, removal_required: false, removal_m2: null, insulation_present: null, existing_r_value: null, access_difficulty: null } });
});
test("blanks never overwrite another source's row, and an all-blank form still skips", () => {
  const other = { id: "m2", status: "draft" as const, source_role: "installer", external_source: "bulk_import", external_id: "r1", removal_m2: 40 };
  expect(planMeasurementUpdate({ scope: "SPLIT", current: other, incoming: { measured_area_m2: 90 }, source: "installer", external: { source: "mitti", id: "a1" } })).toMatchObject({ values: { measured_area_m2: 90 } });
  expect((planMeasurementUpdate({ scope: "SPLIT", current: other, incoming: { measured_area_m2: 90 }, source: "installer", external: { source: "mitti", id: "a1" } }) as { values: object }).values).not.toHaveProperty("removal_m2");
  expect(planMeasurementUpdate({ scope: "SPLIT", current: null, incoming: {}, source: "installer", external: { source: "mitti", id: "a1" } }).action).toBe("skip");
});
```
- [ ] Step 2: Run `bun test tests/scope.core.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement as described.
- [ ] Step 4: Run `bun test tests/scope.core.test.ts tests/mitti-e2e-repairs.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/scope.core.ts tests/scope.core.test.ts && git commit -m "fix(scope): Mitti updates clear answers the installer cleared"`

### Task 6: `completionPlan` holds on bad answers and checks again after Complete (fixes 2, 3, 5, 8)
**Files:**
- Modify: `src/lib/mitti-complete.core.ts:5-32`.
- Test: `tests/mitti-complete.test.ts`.

**Interfaces:**
- `CompletionInput` gains `holdIssues: string[]` and `zones: unknown`.
- `completionPlan` runs the eligibility and fail checks before the `m.status === "complete"` return.
  - If the measurement is already complete and any reason exists, it returns `{ kind: "hold", reasons, recheck: true }`.
  - Otherwise it returns `{ kind: "already" }`.
- No "no removal" fill when `holdIssues` has the "Not sure" issue.
- `missingMeasureFields({...m,...fill}, i.zones)`.

- [ ] Step 1: Write the failing test
```ts
test("invalid area or unreadable access holds; never completes on an old area", () => {
  const r = completionPlan({ ...base, holdIssues: ["A room's measured area was missing or invalid – whole-house area not taken from Mitti; office review required."], zones: [], measurement: m({ measured_area_m2: 137.61 }) as never });
  expect(r).toMatchObject({ kind: "hold" });
});
test("'Not sure' (old form) holds and is never turned into 'no removal'", () => {
  const r = completionPlan({ ...base, holdIssues: ["A ceiling area's existing insulation is marked 'Not sure' – office review required."], zones: [], measurement: m({ insulation_present: true, existing_r_value: 1.5 }) as never });
  expect(r.kind).toBe("hold");
});
test("edit to 'Above R2.0' after Complete holds (re-check), otherwise already", () => {
  const done = m({ status: "complete" });
  expect(completionPlan({ ...base, holdIssues: [], zones: [], entries: [{ label: LEAN_Q.rValue, value: "Above R2.0" }], measurement: done as never })).toMatchObject({ kind: "hold", recheck: true });
  expect(completionPlan({ ...base, holdIssues: [], zones: [], measurement: done as never })).toEqual({ kind: "already" });
});
test("Below R2.0 on every insulated area completes with existing_r_value still empty", () =>
  expect(completionPlan({ ...base, holdIssues: [], zones: [{ existing: "present", rValueBand: "below_r2" }], measurement: m({ insulation_present: true, existing_r_value: null, removal_required: false }) as never }).kind).toBe("complete"));
test("differing R-values below R2.0 and mixed insulation types do not hold", () =>
  expect(completionPlan({ ...base, holdIssues: [], zones: [{ existing: "present", rValueBand: "below_r2" }, { existing: "present", rValueBand: "below_r2" }], measurement: m({ insulation_present: true, existing_r_value: 1.5, removal_required: true, removal_m2: 40 }) as never }).kind).toBe("complete"));
```
- [ ] Step 2: Run `bun test tests/mitti-complete.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement. Add `holdIssues: [], zones: []` to the existing `base` in the test file.
- [ ] Step 4: Run `bun test tests/mitti-complete.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/mitti-complete.core.ts tests/mitti-complete.test.ts && git commit -m "fix(complete): hold on bad area/access/Not sure; re-check eligibility after Complete"`

### Task 7: Failed Ready Check rules (fix 1, pure)
**Files:**
- Modify: `src/lib/mitti-complete.core.ts`.
- Test: `tests/mitti-complete.test.ts`.

**Interfaces:**
- Produces:
```ts
export const READY_CHECK_FAIL_O6_LINES: Record<string, string>; // FAIL_REASON_OPTIONS[0..2] → the three O6 lines
export type FailResult = { reason: "Not eligible" | "No safe access" | "Owner declined"; email: "O6" | "O69" | null; o6Line: string | null };
export function readyCheckFailPlan(entries: { label: string; value: unknown }[], ourLead: boolean): { kind: "pass" } | { kind: "cancel"; result: FailResult; installerReasons: string[] } | { kind: "hold"; reasons: string[] };
```
- `CompletionPlan` gains `| { kind: "cancel"; result: FailResult; installerReasons: string[] }`. `completionPlan` calls `readyCheckFailPlan` first.
  - Cancel is only possible when the measurement is not complete yet. On a complete measurement it becomes `hold` with `recheck: true`.
- Rules:
  - The outcome is `OUTCOME_FAILED`. Fail reasons are split with `splitSelected`.
  - All selected reasons share one result → cancel. The O6 line is the first selected reason in `FAIL_REASON_OPTIONS` order. `email` is null when `!ourLead`.
  - These all hold: no reasons ticked, mixed results, "Homeowner has not agreed to be contacted", and "Other – explain in a note". The hold line is `Ready Check failed: <reasons>`.

- [ ] Step 1: Write the failing test
```ts
const failed = (...why: string[]) => [{ label: LEAN_Q.outcome, value: OUTCOME_FAILED }, { label: LEAN_Q.failReasons, value: why.join(", ") }];
test.each([
  ["Existing insulation is R2.0 or above", "Not eligible", "O6", "At the Ready Check, the installer found the insulation already in your ceiling is R2.0 or above."],
  ["Ceiling or roof built or replaced in the last 5 years", "Not eligible", "O6", "At the Ready Check, the installer found your ceiling or roof was built or replaced in the last 5 years."],
  ["No safe access to the ceiling", "No safe access", "O6", "At the Ready Check, the installer found there's no safe way into your ceiling space."],
  ["Homeowner does not want to proceed", "Owner declined", "O69", null],
])("%s → Cancelled · %s, email %s on an HIV lead; none on the installer's own customer", (why, reason, email, line) => {
  expect(readyCheckFailPlan(failed(why), true)).toEqual({ kind: "cancel", result: { reason, email, o6Line: line }, installerReasons: [why] });
  expect(readyCheckFailPlan(failed(why), false)).toMatchObject({ kind: "cancel", result: { reason, email: null } });
});
test("no contact permission / Other / none ticked hold with the installer's reasons", () => {
  for (const w of [["Homeowner has not agreed to be contacted"], ["Other – explain in a note"], []]) expect(readyCheckFailPlan(failed(...w), true).kind).toBe("hold");
});
test("mixed fail reasons with different results hold, never cancel", () =>
  expect(readyCheckFailPlan(failed("Existing insulation is R2.0 or above", "Homeowner does not want to proceed"), true).kind).toBe("hold"));
test("a failed form never completes, even with eligible answers", () =>
  expect(completionPlan({ ...base, holdIssues: [], zones: [], entries: failed("Existing insulation is R2.0 or above"), measurement: m() as never }).kind).toBe("cancel"));
```
- [ ] Step 2: Run `bun test tests/mitti-complete.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement as described.
- [ ] Step 4: Run `bun test tests/mitti-complete.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/mitti-complete.core.ts tests/mitti-complete.test.ts && git commit -m "feat(complete): failed Ready Check cancels or holds by fail reason (pure)"`

### Task 8: Edits after Complete keep the answers filled at Complete (fix 5, refresh)
**Files:**
- Modify: `src/lib/mitti-completed-refresh.core.ts:7-16`.
- Modify: `src/lib/mitti-completed-refresh.server.ts:8-27`: read the latest `measurement_completed` event for the audit and pass `details.filled`.
- Test: `tests/mitti-completed-refresh.test.ts`.

**Interfaces:**
- `completedRefreshPlan(i: … & { filled?: Record<string, unknown> | null })`.
- Each field becomes `i.values[k] ?? i.filled?.[k] ?? null`.

- [ ] Step 1: Write the failing test
```ts
test("'no removal' filled at Complete is kept when the edit leaves removal blank", () =>
  expect(completedRefreshPlan({ ...input, values: { measured_area_m2: 75, access_difficulty: "easy" }, filled: { removal_required: false } })).toMatchObject({ removal_required: false, removal_m2: null }));
```
- [ ] Step 2: Run `bun test tests/mitti-completed-refresh.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement the new `filled` field and the server read.
- [ ] Step 4: Run `bun test tests/mitti-completed-refresh.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/mitti-completed-refresh.core.ts src/lib/mitti-completed-refresh.server.ts tests/mitti-completed-refresh.test.ts && git commit -m "fix(refresh): keep answers filled at Complete when a completed form is edited"`

### Task 9: Wire the Complete step: hold issues, zones, re-check, and no early quote stage (fixes 2, 5, 13)
**Files:**
- Modify: `src/lib/mitti-complete.server.ts`.
  - 43: `FinishResult`. Remove `"stage_ready"`.
  - 45: input gains `holdIssues?: string[]` and `now?: Date`.
  - 57: also select `zones`.
  - 62–64: pass `holdIssues` and `zones`. On `hold` with `recheck`, also call `recordNeedsOffice(jobId, null, null, reasons)` (from `ready-check-quote.server`), so `officeQuoteBlockers` refuses Send.
  - 86–93: loop over `["ready_check_complete"]` only.
  - 98: `return { done: r.sent ? "sent" : "held", reasons: r.reasons }`.
  - 112: pass `holdIssues: parseAudit(a).holdIssues`.
- Modify: `src/lib/mitti.server.ts:555` (pass `holdIssues: plan.holdIssues`).
- Modify: `src/lib/portal.functions.ts:509-516` (pass `holdIssues`).
- Test: `tests/mitti-complete.test.ts` (a source-reading wiring test, the style already at line 41).

**Interfaces:**
- Consumes: `held` from `auto-quote-send.server`, `recordNeedsOffice` from `ready-check-quote.server`.
- The quote stage move stays only in `releaseQuoteToOwner` (`office-quote-review.server.ts:55-59`).

- [ ] Step 1: Write the failing test
```ts
test("Complete stops at Ready Check complete; only the send moves to the quote stage (no 'Owner to accept quote' before a quote is sent)", () => {
  const s = readFileSync("src/lib/mitti-complete.server.ts", "utf8");
  expect(s).toContain('for (const to of ["ready_check_complete"] as const)');
  expect(s).not.toContain('"measured_estimate_ready"] as const');
  expect(s).not.toContain("stage_ready");
  expect(readFileSync("src/lib/office-quote-review.server.ts", "utf8")).toContain('await wf.transition(jobId, "measured_estimate_ready"');
});
test("every caller passes parseAudit's holdIssues; re-check holds also block Send", () => {
  expect(readFileSync("src/lib/mitti.server.ts", "utf8")).toContain("holdIssues: plan.holdIssues");
  expect(readFileSync("src/lib/portal.functions.ts", "utf8")).toContain("holdIssues: parseAudit(audit).holdIssues");
  const s = readFileSync("src/lib/mitti-complete.server.ts", "utf8");
  expect(s).toContain("holdIssues: parseAudit(a).holdIssues");
  expect(s).toMatch(/recheck[\s\S]{0,200}recordNeedsOffice\(jobId, null, null/);
});
```
- [ ] Step 2: Run `bun test tests/mitti-complete.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement as described. Keep `stageEntryBlockers` for `ready_check_complete`.
- [ ] Step 4: Run `bun test tests/mitti-complete.test.ts tests/boss-price-link.test.ts tests/mitti-ready-check-stage.test.ts tests/auto-quote-send.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/mitti-complete.server.ts src/lib/mitti.server.ts src/lib/portal.functions.ts tests/mitti-complete.test.ts && git commit -m "fix(complete): no quote stage before the quote is sent; hold on bad answers and edits"`

### Task 10: Run the failed Ready Check: guarded cancel plus O6 or O69 (fix 1, server)
**Files:**
- Create: `src/lib/ready-check-failed.server.ts`.
- Modify: `src/lib/mitti-complete.server.ts`, right after the `completionPlan` call. On `cancel`, call `applyReadyCheckFail`. Return early when `job.stage === "cancelled"`.
- Test: `tests/ready-check-failed.test.ts`.
  - Use `memoryPostgrest` with `mock.module` for `@/integrations/supabase/client.server`, `../src/lib/office-actions.server` (spy on `cancelJobFully`), `../src/lib/verified-ineligible-email.server` (spy) and `../src/lib/boss-price-link.server`.
  - Copy the pattern of `tests/xero-poll-eligible.test.ts`.

**Interfaces:**
- Produces:
```ts
export const READY_CHECK_FAILED_EVENT = "ready_check_failed_cancelled";
export async function applyReadyCheckFail(jobId: string, i: { auditId: string; modifiedAt: string | null; result: FailResult; installerReasons: string[]; now?: Date }): Promise<"cancelled" | "waiting_quiet_hours" | "already">;
```
- Order:
  1. If `result.email` is set and `smsQuietReason(now)` → `held(jobId, \`failed-wait:${auditId}\`, ["Ready Check failed — cancels after 7am (no owner emails after 8pm)"])` and return `waiting_quiet_hours`.
  2. Log `READY_CHECK_FAILED_EVENT` `{ audit_id, result, installer_reasons }`.
  3. Call `cancelJobFully(jobId, result.reason, null, { note: installerReasons.join(", "), tell: { owner: result.email === "O69", installer: false } })`.
  4. If `email === "O6"`, call `sendReadyCheckFailedOwnerEmail(jobId)` (Task 11).
- Never throws to the sync, and nothing is charged.

- [ ] Step 1: Write the failing test
```ts
test.each([["Existing insulation is R2.0 or above", "Not eligible", "O6"], ["No safe access to the ceiling", "No safe access", "O6"], ["Homeowner does not want to proceed", "Owner declined", "O69"]])(
  "%s on an HIV lead: Cancelled · %s with %s", async (why, reason, email) => {
    seed({ channel: "hivic_sourced", stage: "ready_check_scheduled" });
    await finishMittiReadyCheck(J, { ...complete, entries: failed(why), ourLead: true, now: at("2026-10-29T02:00:00Z") });
    expect(cancels).toEqual([{ jobId: J, reason, tell: { owner: email === "O69", installer: false } }]);
    expect(o6Sends).toBe(email === "O6" ? 1 : 0);
  });
test("installer's own customer: same result, no HIV email", async () => { /* ourLead:false → tell.owner false, o6Sends 0 */ });
test("email never sent twice: a second sync on the cancelled job does nothing", async () => { /* run twice → cancels.length 1, o6Sends 1 */ });
test("failed check at 9pm cancels nothing and sends nothing; at 7:30 cancels and emails once", async () => {
  await finishMittiReadyCheck(J, { ...complete, entries: failed("Existing insulation is R2.0 or above"), ourLead: true, now: at("2026-10-29T10:00:00Z") });
  expect([cancels.length, o6Sends]).toEqual([0, 0]);
  await finishMittiReadyCheck(J, { ...complete, entries: failed("Existing insulation is R2.0 or above"), ourLead: true, now: at("2026-10-29T20:30:00Z") });
  expect([cancels.length, o6Sends]).toEqual([1, 1]);
});
test("'Other' failed outcome holds, nothing cancelled or sent", async () => { /* held event, cancels 0, o6Sends 0 */ });
```
- [ ] Step 2: Run `bun test tests/ready-check-failed.test.ts`. Expected: FAIL (the module is missing).
- [ ] Step 3: Implement `applyReadyCheckFail` and the call in `finishMittiReadyCheck`, as described.
- [ ] Step 4: Run `bun test tests/ready-check-failed.test.ts tests/mitti-complete.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/ready-check-failed.server.ts src/lib/mitti-complete.server.ts tests/ready-check-failed.test.ts && git commit -m "feat(complete): failed Ready Check cancels through the guarded cancel; O6/O69 once, after 7am"`

### Task 11: The O6 sender for a failed Ready Check, and its retry (fix 1, email)
**Files:**
- Modify: `src/lib/verified-ineligible-email.server.ts`.
  - Add the new sender.
  - In `retryHeldVerifiedIneligibleEmails` (line 65), send jobs that have a `ready_check_failed_cancelled` event with `result.email === "O6"` to the new sender.
- Test: `tests/verified-ineligible-email.test.ts` (it already uses tables and mocks).

**Interfaces:**
- Produces: `export async function sendReadyCheckFailedOwnerEmail(jobId: string, now: Date = new Date()): Promise<string>`.
  - It reads the reason line from the event, so a retry needs nothing else.
  - Key: `ineligibleKey(jobId)`.
  - It checks the quiet hours (`smsQuietReason`). A hold is recorded through the existing `recordNotSent(jobId, key, hadPrior, "held: …")`.
  - It checks `assertCustomerDeliveryAllowed`.
  - Content comes from `renderPreliminaryIneligibleMail(jobId, o6Line, ref)`.
  - TEST jobs or partners go to `sendTestEmail`. Real jobs go to `sendGuardedOwnerEmail({ …, retryAfterDefiniteFailure: true })`.

- [ ] Step 1: Write the failing test
```ts
test("O6 from a failed Ready Check: sent once with the approved reason line", async () => { /* event result.o6Line = R2 line → deliveries 1, mail text contains the line; 2nd call → "already attempted", deliveries 1 */ });
test("held O6 retried after 7am through the Ready Check path", async () => {
  expect(await sendReadyCheckFailedOwnerEmail(J, new Date("2026-10-29T10:00:00Z"))).toMatch(/^held/);
  await retryHeldVerifiedIneligibleEmails(20); // clock 07:30 Melbourne via injected now
  expect(deliveries).toBe(1);
});
```
- [ ] Step 2: Run `bun test tests/verified-ineligible-email.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement. Thread an optional `now` through `retryHeldVerifiedIneligibleEmails(limit, now?)`.
- [ ] Step 4: Run `bun test tests/verified-ineligible-email.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/verified-ineligible-email.server.ts tests/verified-ineligible-email.test.ts && git commit -m "feat(email): O6 for a failed Ready Check on the T7 key, after-8pm hold retried"`

### Task 12: "Held means held": next step, office card and history wording (fix 14)
**Files:**
- Modify: `src/lib/auto-quote-send.core.ts`: add the pure line.
- Modify: `src/lib/auto-quote-send.server.ts:63-67`: `held()` also writes `next_action`. Add the clear helper.
- Modify: `src/lib/installer-quote.server.ts`.
  - 124: the `installer_quote_held` branch calls `markQuoteOnHold`.
  - 179: after `installer_quote_drafted`, call `clearQuoteOnHold`.
- Modify: `src/lib/ready-check-quote.server.ts:42`: after `mitti_a2_quote_drafted`, call `clearQuoteOnHold`.
- Modify: `src/lib/ready-check-basics.server.ts`.
  - 48: the summary becomes `"Ready Check basics in"`.
  - 55–64: `keepNeedsFinishingFor` never replaces a `Quote on hold ·` line.
- Modify: `src/lib/ready-check-chase.core.ts`: add `currentQuoteHold`.
- Modify: `src/lib/office-job-page.server.ts`.
  - 46: also read hold events.
  - 107: set `held` from `currentQuoteHold` when there is no sent quote.
- Test: `tests/ready-check-chase.test.ts`, `tests/auto-quote-send.test.ts`, `tests/office-stage-cards.test.ts`.

**Interfaces:**
- Produces:
```ts
// auto-quote-send.core.ts
export const QUOTE_ON_HOLD_PREFIX = "Quote on hold · ";
export const quoteOnHoldNextAction = (reasons: string[]): string;            // "Quote on hold · a · b"
// auto-quote-send.server.ts
export async function markQuoteOnHold(jobId: string, reasons: string[]): Promise<void>;   // skips when a quote is sent or the text is unchanged
export async function clearQuoteOnHold(jobId: string): Promise<void>;                     // only replaces a "Quote on hold ·" line, with READY_CHECK_BASICS_DONE
// ready-check-chase.core.ts
export type QuoteHold = { reasons: string[]; notOnboardedName: string | null; since: string };
export function currentQuoteHold(events: Ev[]): QuoteHold | null; // latest uncleared quote_auto_send_held / installer_quote_held / ready_check_needs_office (same RULES clear lists)
```

- [ ] Step 1: Write the failing test
```ts
test("next step reads 'Quote on hold · <reason>'", () => expect(quoteOnHoldNextAction(["Electrician not onboarded: Bright spark"])).toBe("Quote on hold · Electrician not onboarded: Bright spark"));
test("held with no draft: office card 'Held · <reason>' from the hold event", () => {
  const h = currentQuoteHold([ev("j1", "installer_quote_held", 2, { details: { blockers: ["Electrician not onboarded: Bright spark"], electrician_not_onboarded: { name: "Bright spark" } } })]);
  expect(h).toMatchObject({ reasons: ["Electrician not onboarded: Bright spark"], notOnboardedName: "Bright spark" });
  const card = buildStageCards({ ...facts, quote: { ...facts.quote, sentAt: null, held: h!.reasons.join(" · ") } });
  expect(card.find((c) => c.key === "quote")!.lines[0]!.value).toBe("Held · Electrician not onboarded: Bright spark");
});
test("'Quote being prepared' never overwrites a hold; history says 'Ready Check basics in'", () => {
  const s = readFileSync("src/lib/ready-check-basics.server.ts", "utf8");
  expect(s).toContain('"Ready Check basics in"');
  expect(s).not.toContain("quote drafted for office check");
  expect(s).toContain("QUOTE_ON_HOLD_PREFIX");
});
test("held() writes the next step once (PGlite)", async () => { /* add jobs.next_action col; held(J,…) twice → next_action "Quote on hold · …", 1 event */ });
```
- [ ] Step 2: Run `bun test tests/ready-check-chase.test.ts tests/auto-quote-send.test.ts tests/office-stage-cards.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement as described.
- [ ] Step 4: Run the Step 2 command, then `bun test tests/ready-check-basics.test.ts tests/mitti-pickup-auto.test.ts tests/office-job-page-info.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/auto-quote-send.core.ts src/lib/auto-quote-send.server.ts src/lib/installer-quote.server.ts src/lib/ready-check-quote.server.ts src/lib/ready-check-basics.server.ts src/lib/ready-check-chase.core.ts src/lib/office-job-page.server.ts tests/ready-check-chase.test.ts tests/auto-quote-send.test.ts tests/office-stage-cards.test.ts && git commit -m "fix(quote): held means held — next step, office Quote card and history wording"`

### Task 13: The installer sees why, and the office "Quote held" item clears (fixes 15, 16)
**Files:**
- Modify: `src/lib/installer-quote-status.core.ts:26-41`.
- Modify: `src/lib/installer-quote-status.server.ts`.
  - 16, 29, 76: when there is no Ready Check quote but `currentQuoteHold` is set, return `applies: true, quote: null, held: true, holdLine`.
  - 37–40, 78–81: on unsent quotes, also set `holdLine`.
- Modify: `src/lib/installer-home.core.ts:86`: a line starting with `QUOTE_ON_HOLD_PREFIX` gives `{ group: "progress", next: \`Next: nothing yet — ${line}\` }`.
- Modify: `src/lib/ready-check-chase.core.ts:71`: add `"installer_quote_drafted", "quote_sent_automatically", "quote_sent_by_office"` to the `quote_held_review` clear list.
- Modify: `src/lib/needs.server.ts:160`: add `"installer_quote_drafted"` to `types`.
- Check: `src/lib/mitti-job-presentation.server.ts:18` and `src/lib/installer-job-summary.functions.ts:35` must handle `quote: null`. `src/lib/my-owner-quote.server.ts:12` already does.
- Test: `tests/installer-quote-status.test.ts`, `tests/ready-check-chase.test.ts`.

**Interfaces:**
- Produces: `export function installerHoldLine(h: { reasons: string[]; notOnboardedName: string | null }): string`.
- `InstallerQuoteFacts.holdLine?: string | null`. `installerQuoteLine` returns `holdLine` first when the quote is not sent.

- [ ] Step 1: Write the failing test
```ts
test("installer card shows the hold in plain words", () => {
  expect(installerHoldLine({ reasons: ["Electrician not onboarded: Bright spark"], notOnboardedName: "Bright spark" })).toBe("Quote on hold · your electrician Bright spark needs to finish signing up with HIV");
  expect(installerQuoteLine({ sent: false, accepted: false, declined: false, held: true, holdLine: "Quote on hold · x" })).toBe("Quote on hold · x");
  expect(installerQuoteLine({ sent: true, accepted: false, declined: false, held: false, holdLine: "Quote on hold · x" })).toBe(QUOTE_SENT_LINE);
});
test("office 'Quote held' clears once a quote is drafted or sent", () => {
  for (const clear of ["installer_quote_drafted", "quote_sent_automatically", "quote_sent_by_office"]) expect(codes([ev("j3", "installer_quote_held", 3), ev("j3", clear, 1)])).toEqual([]);
});
test("needs.server loads every event a Mitti rule clears on", () => {
  const s = readFileSync("src/lib/needs.server.ts", "utf8");
  for (const t of ["installer_quote_drafted", "quote_sent_automatically", "quote_sent_by_office"]) expect(s).toContain(`"${t}"`);
});
```
- [ ] Step 2: Run `bun test tests/installer-quote-status.test.ts tests/ready-check-chase.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement as described.
- [ ] Step 4: Run the Step 2 command, then `bun test tests/piesa-fee-onboarded-rec.test.ts tests/installer-home.test.ts tests/one-status-line.test.ts tests/installer-states.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/installer-quote-status.core.ts src/lib/installer-quote-status.server.ts src/lib/installer-home.core.ts src/lib/ready-check-chase.core.ts src/lib/needs.server.ts tests/installer-quote-status.test.ts tests/ready-check-chase.test.ts && git commit -m "fix(quote): installer sees the hold reason; office Quote held item clears on draft/send"`

### Task 14: No repeated history lines (fix 17)
**Files:**
- Create: `src/lib/stable-json.core.ts`.
- Modify: `src/lib/insulation-product.server.ts:22`.
- Modify: `src/lib/usual-electrician.server.ts:50-52`.
- Test: `tests/insulation-product.test.ts`.

**Interfaces:**
- Produces: `export function sameJson(a: unknown, b: unknown): boolean`. It drops `undefined`, sorts keys at every level and keeps array order.

- [ ] Step 1: Write the failing test
```ts
test("nested key order and undefined keys are the same record", () => {
  expect(sameJson({ a: 1, p: { y: 2, x: 1 }, u: undefined }, { p: { x: 1, y: 2 }, a: 1 })).toBe(true);
  expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
});
test("product and electrician 'recorded' lines are written once per change", () => {
  for (const f of ["src/lib/insulation-product.server.ts", "src/lib/usual-electrician.server.ts"]) expect(readFileSync(f, "utf8")).toContain("sameJson(");
});
```
- [ ] Step 2: Run `bun test tests/insulation-product.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement `sameJson`. In both servers, replace the `JSON.stringify` and `signature` comparisons with `!sameJson(prev?.details ?? null, details)`.
- [ ] Step 4: Run `bun test tests/insulation-product.test.ts tests/usual-electrician-no-price.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/stable-json.core.ts src/lib/insulation-product.server.ts src/lib/usual-electrician.server.ts tests/insulation-product.test.ts && git commit -m "fix(history): electrician/product recorded once per change"`

### Task 15: One electrician choice on the job (fix 9)
**Files:**
- Modify: `src/lib/job-electrician.server.ts:8-17`.
- Modify: `src/lib/onsite-ready-check.server.ts:61` (pass `electricianChoice`).
- Test: `tests/electrician-choice.test.ts` (`memoryPostgrest` with `mock.module` for the client and `workflow.server`).
- Create (required — checked live 29 Oct: `jobs_electrician_choice_check` allows only preferred, approved_other, nominated, hivic_organise, so `installer_own` writes fail today): `docs/pending-migrations/jobs-electrician-choice-installer-own.sql` and `.rollback.sql`, with `tests/jobs-electrician-choice-practice-db.test.ts`.

**Interfaces:**
- `recordJobElectricianChoice(jobId, installerBusinessId, plan, actorId, addJobChoice?: ElectricianChoice | null)`.
  - With no `mine` plan: `addJobChoice === "usual"` gives `installer_own`; otherwise `hivic_organise`.
  - It throws a `WorkflowError` on an update error.

- [ ] Step 1: Write the failing test
```ts
test("Add a job 'my usual electrician' → installer_own; HIV's → hivic_organise", async () => {
  await recordJobElectricianChoice(J, B, null, U, "usual"); expect(job().electrician_choice).toBe("installer_own");
  await recordJobElectricianChoice(J2, B, null, U, "hivic"); expect(job(J2).electrician_choice).toBe("hivic_organise");
});
test("add-job usual choice writes installer_own and the write error is surfaced", async () => { /* fake update error → rejects */ });
test("Add a job passes the one choice", () => expect(readFileSync("src/lib/onsite-ready-check.server.ts", "utf8")).toContain("recordJobElectricianChoice(job.id, businessId, electrician, userId, electricianChoice)"));
```
- [ ] Step 2: Run `bun test tests/electrician-choice.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement the new parameter, the error surfacing and the caller change.
- [ ] Step 4: Write the pending SQL (live constraint confirmed 29 Oct: `CHECK (electrician_choice IS NULL OR electrician_choice = ANY (ARRAY['preferred','approved_other','nominated','hivic_organise']))`).
  - Drop the old CHECK and add one that allows the union of all values the code writes (`preferred, approved_other, nominated, hivic_organise, installer_own, hivic_matched, installer_own_hivic_books`), plus a rollback.
  - Prove it on PGlite: an `installer_own` update succeeds, an unknown value is refused, and the rollback restores the old rule.
  - Jo applies it only after she approves.
- [ ] Step 5: Run `bun test tests/electrician-choice.test.ts tests/onsite-ready-check-7oct.test.ts tests/job-electrician-7oct.test.ts`, plus the practice-db test if it was created. Expected: PASS.
- [ ] Step 6: Commit: `git add src/lib/job-electrician.server.ts src/lib/onsite-ready-check.server.ts tests/electrician-choice.test.ts docs/pending-migrations/jobs-electrician-choice-installer-own*.sql tests/jobs-electrician-choice-practice-db.test.ts && git commit -m "fix(electrician): job field matches the Add a job choice"`

### Task 16: The "Use HIV's electrician ($349)" button for the boss (fix 10)
**Files:**
- Create: `src/lib/held-quote-electrician.server.ts`. It is off the autoAdvance graph because it reaches `mitti.server`.
- Modify: `src/lib/rec-auto-link.server.ts:13`: export `redraftFromMitti`.
- Modify: `src/lib/electrician-choice.core.ts:37`: add `"switched_to_hivic"` to `ElectricianChoiceRecord["source"]`.
- Modify: `src/lib/job-electrician.functions.ts`: add `useHivElectricianFn`, written as a literal `createServerFn(...).middleware([requireSupabaseAuth]).inputValidator(...).handler(...)` chain.
- Modify: `src/components/trade/job-intake.tsx` (near line 153): add `UseHivElectricianButton`.
- Modify: `src/lib/trade-view.server.ts:903`: `quote` carries `electricianNotOnboarded`.
- Modify: `src/routes/_authenticated/field.$jobId.tsx:414`: render the button when `page.boss && page.quote?.electricianNotOnboarded`.
- Test: `tests/held-quote-electrician.test.ts`.

**Interfaces:**
- Produces: `export async function switchHeldQuoteToHivic(jobId: string, userId: string): Promise<{ status: "switched" | "already"; quoteReady: boolean | null }>`.
- Order:
  1. Call `requireMember(userId, originating_installer_business_id, true)`.
  2. Require a current not-onboarded hold (`currentQuoteHold(...).notOnboardedName`).
  3. Call `payerChangeBlocker`.
  4. If the latest choice is already `hivic`, return `already`.
  5. Otherwise set `jobs.electrician_choice = "hivic_organise"`, then call `recordElectricianChoice(jobId, businessId, userId, "hivic", "switched_to_hivic")`.
  6. Call `redraftFromMitti(jobId, userId)`.
- It is one-way. It never sends.

- [ ] Step 1: Write the failing test
```ts
test("button pressed: choice recorded once, quote redrafted, hold clears", async () => {
  expect(await switchHeldQuoteToHivic(J, BOSS)).toMatchObject({ status: "switched" });
  expect(await switchHeldQuoteToHivic(J, BOSS)).toMatchObject({ status: "already" });
  expect(events("electrician_choice_set").map((e) => e.details.choice)).toEqual(["hivic"]);
  expect(job().electrician_choice).toBe("hivic_organise");
  expect(redrafts).toEqual([J]);
});
test("boss only (it shows a rate); refused without a not-onboarded hold", async () => {
  await expect(switchHeldQuoteToHivic(J, STAFF)).rejects.toThrow("Only your business admin can do this.");
  await expect(switchHeldQuoteToHivic(J_NO_HOLD, BOSS)).rejects.toThrow();
});
test("job page: button text, boss-only render", () => {
  expect(readFileSync("src/components/trade/job-intake.tsx", "utf8")).toContain("Use HIV's electrician ($349)");
  expect(readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8")).toContain("page.boss && page.quote?.electricianNotOnboarded");
});
```
- [ ] Step 2: Run `bun test tests/held-quote-electrician.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement as described. The button calls the server function, then refetches the page query.
- [ ] Step 4: Run `bun test tests/held-quote-electrician.test.ts tests/electrician-choice.test.ts tests/comms.test.ts`. Expected: PASS, except the 2 `comms.test.ts` failures that already exist.
- [ ] Step 5: Commit: `git add src/lib/held-quote-electrician.server.ts src/lib/rec-auto-link.server.ts src/lib/electrician-choice.core.ts src/lib/job-electrician.functions.ts src/components/trade/job-intake.tsx src/lib/trade-view.server.ts "src/routes/_authenticated/field.\$jobId.tsx" tests/held-quote-electrician.test.ts && git commit -m "feat(installer): boss can switch a held quote to HIV's electrician (\$349)"`

### Task 17: The price is saved on the job (fix 11)
**Files:**
- Modify: `src/lib/installer-price-set.server.ts:77-79`.
- Test: `tests/installer-price.test.ts` (`memoryPostgrest`; mock `pilot.server` `requireMember` and `mitti.server`).

**Interfaces:**
- After the event, `jobs.installer_quoted_price_inc_gst = record.price_inc_gst` and `jobs.installer_price_includes = priceCardLines(record).included`.
- An update error throws `WorkflowError("The price was not saved on the job.")`.

- [ ] Step 1: Write the failing test
```ts
test("boss enters the price → saved on the job (price and what's included)", async () => {
  await setInstallerPrice(J, BOSS, { price_inc_gst: 4200, included: ["Ceiling insulation - supply & install"], included_other: null });
  expect(job()).toMatchObject({ installer_quoted_price_inc_gst: 4200, installer_price_includes: "Ceiling insulation - supply & install" });
});
```
- [ ] Step 2: Run `bun test tests/installer-price.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement the job update after the event.
- [ ] Step 4: Run `bun test tests/installer-price.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/installer-price-set.server.ts tests/installer-price.test.ts && git commit -m "fix(price): boss price saved on the job"`

### Task 18: The price-link text is tried again if blocked (fix 12)
**Files:**
- Modify: `src/lib/boss-price-link.server.ts:15-52`.
- Test: `tests/boss-price-link.test.ts`.
  - Add behaviour tests: `memoryPostgrest`; mock `sms.server`, `installer-price.server` and `workflow.server.logEvent`.
  - Update the source test at line 68 on purpose: the event now follows a send.

**Interfaces:**
- `textBossPriceLink(jobId, i: { …; now?: Date })`.
  1. `smsQuietReason(now)` gives `"waiting: quiet hours"`, with no event and no send.
  2. Send under the same `bossPriceLinkKey`.
  3. Log `BOSS_PRICE_LINK_EVENT` with `{ …, status }` only when the status is `sent`, `sent_unknown` or `already` (or TEST `sent`). Any other result logs nothing, so the next sweep tries again.
- Old events still count as texted.

- [ ] Step 1: Write the failing test
```ts
test("blocked price-link text: retried later, never sent twice", async () => {
  expect(await textBossPriceLink(J, { ...i, now: at("2026-10-29T10:00:00Z") })).toBe("waiting: quiet hours");   // 9pm Melbourne
  smsResult = { status: "blocked", detail: "switch off", sid: null };
  await textBossPriceLink(J, { ...i, now: at("2026-10-29T21:00:00Z") });
  expect(events(BOSS_PRICE_LINK_EVENT)).toHaveLength(0);
  smsResult = { status: "sent", detail: "ok", sid: "SM1" };
  await textBossPriceLink(J, { ...i, now: at("2026-10-29T21:15:00Z") });
  await textBossPriceLink(J, { ...i, now: at("2026-10-29T21:30:00Z") });
  expect([sends.length, events(BOSS_PRICE_LINK_EVENT).length]).toEqual([2, 1]); // 2 attempts (1 held + 1 sent), 1 counted send
});
```
- [ ] Step 2: Run `bun test tests/boss-price-link.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement as described.
- [ ] Step 4: Run `bun test tests/boss-price-link.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/boss-price-link.server.ts tests/boss-price-link.test.ts && git commit -m "fix(sms): price-link text counts only once sent; quiet-hours holds retried"`

### Task 19: Install-day before video for areas missing one (fix 4, install side)
**Files:**
- Modify: `src/lib/install-day.core.ts`, after `INSTALL_DAY_RULER_*` (lines 91–151).
- Modify: `src/lib/install-evidence.core.ts`.
  - 213–240: `readInstallEvidence` adds `beforeVideos`.
  - 430–437: before-video check.
- Modify: `src/lib/mitti.server.ts:739`: add the prefill using `jobUpgradeZones(jobId)`.
- Modify: `src/lib/mitti-form-schema.core.ts:18`: advisory missing-questions, like the ruler photos.
- Create: `docs/mitti-paste-A5-before-video.md`. A5 template `1f325828-3f71-4b1a-988f-083c83414f95`. Copy the shape of `docs/mitti-paste-A5-ruler-photos.md`.
- Test: `tests/install-evidence.test.ts`, `tests/install-day.test.ts`.

**Interfaces:**
- Produces:
```ts
export const INSTALL_DAY_BEFORE_VIDEO_Q = { needed: "Does any ceiling area still need its before video?", areas: "Ceiling areas that still need a before video", video: "Before video of this area (film before you start)" } as const;
export const INSTALL_DAY_BEFORE_VIDEO_PAGE = "Before videos (film before you start)";
export function installDayBeforeVideos(audit: unknown): { onForm: boolean; copies: MittiMediaFile[][] }; // repeat copies in form order
export function installDayBeforeVideoPrefill(template: unknown, missingAreaNames: string[], choiceOption: (t: unknown, itemId: string, label: string) => { id: string; label: string } | null): PrefillItem[]; // Yes/No + names text
```
- Rules:
  - Copy *k* belongs to the *k*-th zone with `beforeVideo !== true`, in Ready Check order.
  - A copy counts only with a video file (`isVideoMedia`) that passes `mediaProblems(..., { min: 1, video: true, workStartAt, phase: "before" })`.
  - Any zone still without a counted video stays in `before`, worded: `Before video missing for <names> — film it on the install day form before work starts`.
- **Template shape:** the page sits at the top of the A5. It has the prefilled yes/no, the prefilled names text, and one repeat section ("Add a ceiling area"). The video question is inside the repeat section and shows only when the yes/no is Yes.

- [ ] Step 1: Write the failing test
```ts
test("photo-only before video: quote still goes; install-day form asks for that area's before video only", () => {
  const items = installDayBeforeVideoPrefill(beforeVideoTemplate(), ["Garage"], choiceOption);
  expect(items.map((x) => x.responses)).toEqual([{ selected: [{ id: expect.any(String), label: "Yes" }] }, { text: "Garage" }]);
  expect(installDayBeforeVideoPrefill(beforeVideoTemplate(), [], choiceOption)[0]!.responses).toEqual({ selected: [{ id: expect.any(String), label: "No" }] });
});
test("install-day before video filmed before work start counts; after work start or a photo does not", () => {
  const zones = [rcZones[0]!, { ...rcZones[1]!, beforeVideo: false }];
  const ok = evalDay({ beforeVideoCopies: [[vid("2026-11-03T19:50:00Z")]] }, { zones }, T0);
  expect(ok.prestartBlockers.join()).not.toContain("Before video missing");
  expect(evalDay({ beforeVideoCopies: [[vid("2026-11-03T20:30:00Z")]] }, { zones }, T0).blockers.join()).toContain("taken after work started");
  expect(evalDay({ beforeVideoCopies: [[photoFile()]] }, { zones }, T0).blockers.join()).toContain("Before video missing for Garage");
});
test("the A5 paste adds only the before-video page at the top", () => { /* code block contains template id, the three labels, "Change nothing else" */ });
```
- [ ] Step 2: Run `bun test tests/install-evidence.test.ts tests/install-day.test.ts`. Expected: FAIL.
- [ ] Step 3: Implement as described. Keep the new questions out of `INSTALL_DAY_QUESTIONS` (no renumbering of Q1–48, the same as the ruler photos).
- [ ] Step 4: Run `bun test tests/install-evidence.test.ts tests/install-day.test.ts tests/decision-396-a5-ruler-photos.test.ts tests/mitti-form-schema.test.ts`. Expected: PASS.
- [ ] Step 5: Commit: `git add src/lib/install-day.core.ts src/lib/install-evidence.core.ts src/lib/mitti.server.ts src/lib/mitti-form-schema.core.ts docs/mitti-paste-A5-before-video.md tests/install-evidence.test.ts tests/install-day.test.ts && git commit -m "feat(install-day): before video caught up on the A5 for areas missing one"`

### Task 20: HV-3519 real answers, end to end (spec Tests list)
**Files:**
- Create: `tests/fixtures/mitti-ready-check/hv3519-completed.json`.
- Create: `tests/hv3519-quote-hold.test.ts`.

**Interfaces:**
- Consumes: `completionPlan`, `currentQuoteHold`, `quoteOnHoldNextAction`, `installerHoldLine`, `buildStageCards`.

- [ ] Step 1: Build the fixture.
  - Fetch it read-only with Lovable `query_database`: `select raw_snapshot, zones, measured_area_m2, insulation_present, existing_r_value, removal_required, removal_m2, access_difficulty, status, external_id from ceiling_measurements where job_id=(select id from jobs where job_number='HV-3519') and is_current;` plus the latest `installer_quote_held` details.
  - Replace the owner name, phone, email and address with TEST values.
- [ ] Step 2: Write the failing test
```ts
test("HV-3519: completes (R-value answered), then held only for 'electrician not onboarded', right wording for office and installer", () => {
  expect(completionPlan({ auditId: f.external_id, completed: true, modifiedAt: null, entries: f.raw_snapshot, ourLead: false, holdIssues: [], zones: f.zones, websiteFacts: null, measurement: { ...f, status: "draft", external_source: "mitti" } }).kind).toBe("complete");
  const h = currentQuoteHold([f.heldEvent])!;
  expect(h.reasons).toEqual([`Electrician not onboarded: ${h.notOnboardedName}`]);
  expect(quoteOnHoldNextAction(h.reasons)).toBe(`Quote on hold · Electrician not onboarded: ${h.notOnboardedName}`);
  expect(installerHoldLine(h)).toBe(`Quote on hold · your electrician ${h.notOnboardedName} needs to finish signing up with HIV`);
});
```
- [ ] Step 3: Run `bun test tests/hv3519-quote-hold.test.ts`. Expected: PASS on the new code (it fails on the base commit). If it fails, fix the owning task, not the test.
- [ ] Step 4: Commit: `git add tests/fixtures/mitti-ready-check/hv3519-completed.json tests/hv3519-quote-hold.test.ts && git commit -m "test: HV-3519 completes and holds only for the electrician, with the right wording"`

### Task 21: Data fix, HV-3117 and HV-3497 back to Ready Check complete (fix 13)
**Files:**
- Create: `docs/pending-migrations/hv3117-hv3497-back-to-ready-check-complete.sql` (data only; copy the shape of `jo-27oct-pause-test-trades.sql`).
- Create: `tests/hv3117-hv3497-back-practice-db.test.ts` (PGlite, the pattern in `tests/test-trade-pause-practice-db.test.ts`).

**Interfaces:**
- In one transaction:
  - **STOP** unless both job numbers exist.
  - **STOP** if any installation quote on either job has `sent_at` set.
  - Then, for each job still at `measured_estimate_ready`, set `stage='ready_check_complete'` and `next_action='Measured estimate generates automatically'` (the stored text for that stage).
  - Insert one `stage_changed` workflow event (`from_stage`, `to_stage`, summary `Back to Ready Check complete — no quote was sent (Jo, 29 Oct 2026)`, `internal=false`).
- Nothing is sent. Running it again does nothing.
- The next pull rewrites the next step to `Quote on hold · …` (Task 12).

- [ ] Step 1: Write the failing test
```ts
test("HV-3117 and HV-3497 go back to Ready Check complete; nothing sent; repeat is inert", async () => {
  await db.exec(sql); expect(stages()).toEqual({ "HV-3117": "ready_check_complete", "HV-3497": "ready_check_complete" });
  expect(count("stage_changed")).toBe(2); await db.exec(sql); expect(count("stage_changed")).toBe(2);
  expect(otherJobsUnchanged()).toBe(true);
});
test("STOP when a quote on either job was sent", async () => { /* set sent_at → db.exec rejects /STOP/, stages unchanged */ });
```
- [ ] Step 2: Run `bun test tests/hv3117-hv3497-back-practice-db.test.ts`. Expected: FAIL (the file is missing).
- [ ] Step 3: Write the SQL.
- [ ] Step 4: Run the Step 2 command. Expected: PASS.
- [ ] Step 5: Commit: `git add docs/pending-migrations/hv3117-hv3497-back-to-ready-check-complete.sql tests/hv3117-hv3497-back-practice-db.test.ts && git commit -m "data: pending fix moving HV-3117/HV-3497 back to Ready Check complete (not applied)"`
- [ ] Step 6: Only after Jo approves, she runs it in the Supabase SQL editor. Record the run in `docs/pending-migrations/APPLIED_MANUALLY.md` and commit.

### Task 22: Full checks, then sandbox QA
- [ ] Step 1: Run `bun run test` (= `bun ./scripts/test-isolated.ts 8`). Expected: no new failures. `tests/comms.test.ts` keeps exactly its 2 failures from before.
- [ ] Step 2: Run `bun scripts/scan-retired-terms.ts`. Expected: exit 0.
- [ ] Step 3: Run `bunx tsc --noEmit` (`package.json` has no typecheck script) and `bun run lint`. Expected: no new errors.
- [ ] Step 4: Push to the connected branch (no force-push).
- [ ] Step 5: In the Lovable sandbox, run `bun run journey` and `bun run portal-qa`. This cloud session can't sign in, so the run happens in Lovable and the results are recorded here. On a TEST job, cover:
  - a failed Ready Check, for each reason;
  - a photo-only before video;
  - the held quote, and the boss button switching to HIV's electrician;
  - the price link after 8pm.

  Anything not reached is marked NOT_RUN.
- [ ] Step 6: Ask Jo to approve, each separately:
  - (a) the three O6 reason lines;
  - (b) `docs/mitti-paste-A1-A2-not-sure-removed.md`, pasted and published;
  - (c) `docs/mitti-paste-A5-before-video.md`, pasted and published;
  - (d) the Task 21 data fix;
  - (e) the Task 15 constraint migration.
- [ ] Step 7: Commit: `git commit --allow-empty -m "chore: installer job path fixes verified (tests, scan, typecheck; sandbox QA recorded)"`

---

## Self-review notes
- **Fix 1, several fail reasons:** the spec doesn't say what to do when more than one is ticked. The plan cancels only when every ticked reason gives the same job result, and holds otherwise. When R2.0 and the 5-year reason are both ticked, the O6 line is the first in option order. Jo should confirm both choices.
- **Fix 1, the installer's note for "Other":** I couldn't find where Mitti stores the note that goes with an answer. `responseValue` reads no note field. The hold shows the ticked reasons only until the note's place in a real audit is confirmed.
- **Fix 1, timing:** the plan delays the cancel until after 7am when an email is due, so O6 and O69 follow the 8pm rule (`cancelJobFully`'s O69 path has no check for quiet hours). Also, the boss price-link text still fires on a failed A1 Complete. The spec doesn't cover that, so it is left unchanged.
- **Fix 4, how a video looks in Mitti:** every fixture only shows photos (`file_ext: "jpg"`), so I couldn't confirm what Mitti returns for a video. `isVideoMedia` follows the "hold, don't guess" rule: an unknown file type is not counted. Check it against a real audit (for example HV-3519) before release.
- **Fix 4, the A5 page shape:** a Mitti template is the same for every job, so it can't show a question for only some areas without a controlling question. The plan adds a prefilled yes/no and a prefilled list of area names, with the video question inside a repeat section shown only on Yes. That shape is my design; Jo should OK it with the paste.
- **Fix 9, the database rule:** the CHECK on `jobs.electrician_choice` may refuse `installer_own`, judging from the order of migrations 0023 and 0059. Confirmed live on 29 Oct: it does refuse `installer_own`, so Task 15's migration is required.
- **Fix 10, where the code goes:** the spec names `switchJobToHivic` in `job-electrician.server.ts`. That function refuses intake jobs, requires the assigned installer user and sits on the autoAdvance graph. So the button's server code is a new module that reuses `payerChangeBlocker` and the exported `redraftFromMitti`. Nothing in the job page imports `JobElectricianCard`, so the button goes in a new component rendered from `field.$jobId.tsx`.
- **Fix 14, clearing the hold text:** the plan replaces "Quote on hold" with the existing "Ready Check basics in — quote being prepared" once a quote is drafted (installer and A2 paths). The spec says only that the hold must not be overwritten. Without this step the next-step text would stay stale after the hold is sorted.
- **Fix 13, timing of stage checks:** with the early stage move removed, the stage-entry checks for `measured_estimate_ready` (for example eligibility) now run only at Send, through `releaseQuoteToOwner`. They no longer run at Complete. A problem is still caught before anything goes to the owner, just later.

### Critical Files for Implementation
- /home/claude/hi-vic-operations/src/lib/mitti-complete.core.ts
- /home/claude/hi-vic-operations/src/lib/mitti-complete.server.ts
- /home/claude/hi-vic-operations/src/lib/mitti.core.ts
- /home/claude/hi-vic-operations/src/lib/ready-check-chase.core.ts
- /home/claude/hi-vic-operations/src/lib/install-evidence.core.ts