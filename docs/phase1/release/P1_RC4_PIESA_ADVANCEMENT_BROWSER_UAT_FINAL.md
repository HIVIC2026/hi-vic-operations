# PHASE 1 — RC-4 PIESA STAGE ADVANCEMENT: COMPLETE BROWSER UAT

**Workstream:** RC-4 / Brief S F-1 (PIESA stage advancement)
**Agent:** R6 — Browser-capable verification agent
**Mode:** Live browser UAT against a running application on an isolated local stack
**Test window:** 2026-10-20, 11:09–11:41 AEDT (00:09–00:41 UTC)
**Report status:** Final

---

## FINAL VERDICT (stated first)

**PASS — BROWSER VERIFIED**

All seven scenarios (A–G) were executed by driving the real application in a real browser. Every scenario produced the expected result, and the primary RC-4 outcome was directly observed: a completed PIESA moved the job `piesa_scheduled → piesa_complete` and set the Office next action, with no duplicate records, no double transition, and no authorisation granted to an unauthorised role.

No release-relevant defect was found in the PIESA advancement workflow.

Four observations are recorded in section 11. None of them blocks the workflow, loses data, exposes data, or mis-authorises a role. One of them is material to how RC-4's closure should be *cited*: the code added by the RC-4 remediation is not reached by any production caller, so the green unit suite must not be presented as production evidence — the browser evidence in this report is the production-behaviour evidence.

---

## 1. Test date, environment and access

| Item | Value |
|---|---|
| Date / time | 2026-10-20, 11:09–11:41 AEDT |
| Application under test | `http://localhost:8080` — the repository's own dev server, built from the tested SHA |
| Database / auth / storage | Disposable local Supabase stack, project id `local-uat-disposable` (Kong `http://127.0.0.1:54331`, Postgres `127.0.0.1:54332`) |
| Browser | Google Chrome 155.0.8059.85, launched with `--remote-debugging-port=9226 --no-sandbox --disable-gpu` and a throwaway profile |
| Automation | Direct Chrome DevTools Protocol over the real browser (no headless shim, no mocked network) |
| Viewport | 1440 × 1000, device pixel ratio 1 |
| Preview / Production | **Not touched.** No request was made to `estimate.homeinsulationvictoria.com.au`, to the Lovable preview, or to the shared Supabase project |

The environment is isolated by construction: the dev server was started with `SUPABASE_URL`, `VITE_SUPABASE_URL`, the anon key and the service-role key all pointing at the disposable stack, and with `ALLOW_PROD_SUPABASE` absent. Every write in this report landed in the disposable database.

## 2. Tested Git SHA and baseline reconciliation

| Item | Value |
|---|---|
| Tested commit (local HEAD) | `f6c99b15297ac8d588d526522c991c99b5397bfb` |
| `origin/main` at test time | `fb3a83fe2c2494a130f4a6d7370a1330a0f6a646` |
| Commits between them | 28 |
| Files changed between them under `src/` and `tests/` | 35 — all in the enquiries / office / save-my-spot area plus `src/integrations/supabase/types.ts` |
| Diff between them in the six PIESA-relevant files | **none** |

The six files that define the workflow under test are byte-identical between the tested commit and `origin/main`:

```
src/lib/requirements.server.ts
src/lib/piesa-advance.core.ts
src/lib/portal.functions.ts
src/lib/workflow.server.ts
src/routes/_authenticated/field.$jobId.tsx
src/components/portal/electrician-manual-result.tsx
```

`git diff --stat HEAD..origin/main -- <those six paths>` returns empty. The verdict therefore holds for `fb3a83fe` as well as for the tested SHA.

## 3. Test data and safety controls

Three fictional jobs were used, all at `piesa_scheduled` with the same electrician assigned, cloned from the existing UAT fixture `UAT-S91-E-0001`:

| Job | Reference | Purpose |
|---|---|---|
| `1e000000-…-0001` | UAT-S91-E-0001 | Scenario A (pass), D (single-record check), E/F/G |
| `1e000000-…-00b2` | UAT-S91-E-0002 | Scenario B (fail + rectification) |
| `1e000000-…-00c3` | UAT-S91-E-0003 | Scenario C (rejections), D (duplicate submit) |

Fictional accounts (all `@uat.example.test`, seeded into the disposable stack, password set through that stack's own GoTrue admin API):

| Account | Role used in the test |
|---|---|
| `electrician@uat.example.test` | assigned electrician |
| `electrician.pending@uat.example.test` | electrician with no assignment on the job |
| `installer@uat.example.test` | installer assigned as installer |
| `owner.a@uat.example.test` | homeowner |
| `office.admin@uat.example.test` | office admin |

Safety controls actually exercised:

- No production Publish, no migration, no deploy.
- No real payment, no Xero call, no Mitti call, no email or SMS. The only outbound calls were to the local stack.
- The only file uploaded was a 408-byte PDF containing the words "UAT TEST — PIESA sign-off — fictional".
- One fictional `ffs_progress_result` row was inserted into the disposable database to prove the presentation boundary hides it (section 9). It contains no customer data.

## 4. Scenario A — a successful PIESA advances to `piesa_complete`

**Job:** UAT-S91-E-0001 · **Actor:** assigned electrician · **Start stage:** `piesa_scheduled`

Actions performed in the browser: tapped `OK` (switchboard), `Yes` (RCDs present), `No` (life support), `Yes` (no rectification required), `Pass` (PIESA outcome), set the assessment date to the field's own maximum (2026-10-20), uploaded the sign-off PDF through the evidence panel, then pressed **Complete PIESA**.

| Observation | Result |
|---|---|
| Save indicator after the choices | `Saved 11:10 am` |
| Evidence row after upload | `PIESA / electrical safety sign-off — Awaiting verification — piesa-signoff-TEST.pdf` |
| Toast on completion | `PIESA complete` |
| Page after completion | `WAITING ON HOME INSULATION VICTORIA` · `Office is checking the safety check` · `Install must start by Thu, 19 Nov` · `30 days left` |
| Journey line | `Safety check done – next step being set up · since Tue 20 Oct` |
| Editable form after completion | gone; replaced by `Safety check complete.` |
| **Persisted stage** | **`piesa_complete`** |
| **Persisted next action** | **`Reconcile PIESA scope against allowance`** |
| `assessments` | `status=complete`, `piesa_outcome=pass`, `switchboard_condition=ok`, `rcds_present=t`, `life_support_confirmed=f`, `no_rectification_confirmed=t`, `assessed_on=2026-10-20`, `assessor_id` = the electrician |
| `piesa_records` | exactly **1** row, `is_current=true`, `kind=initial`, `outcome=pass`, `signed_off_by` = the electrician |
| `evidence_requirements.piesa_signoff` | `uploaded` (1 file) |
| Workflow events | `evidence_uploaded`, `electrical_assessment_complete`, `stage_changed → piesa_complete` |

The 30-day install deadline (`Thu, 19 Nov`) is derived from the recorded `assessed_on`, which confirms the date the electrician entered is the one the deadline runs from.

**Result: PASS.** Screenshots `A-01-before.png` … `A-04-after.png`; log `scenario-a.log`.

## 5. Scenario B — a failed PIESA with rectification must not authorise installation

**Job:** UAT-S91-E-0002 · **Actor:** assigned electrician · **Start stage:** `piesa_scheduled`

Actions: `Upgrade needed`, `No` (RCDs), `No` (life support), `Fail` (outcome), assessment date 2026-10-20; added one priced "Other" rectification item (`TEST - replace faulty RCD (fictional)`, qty 1, $120 inc GST, with a required explanation); the page then revealed the **Rectification time and hours** section; entered 2 hours and picked three windows on three different days (Thu 22 Oct, Fri 23 Oct, Mon 26 Oct → `3 of 5 chosen`); the Complete button was enabled; pressed **Complete PIESA**.

| Observation | Result |
|---|---|
| Toast | `PIESA complete` |
| Rectification item listed on the page | `TEST - replace faulty RCD (fictional) × 1 @ $120.00` |
| Persisted stage | `piesa_complete` |
| Persisted next action | `Reconcile PIESA scope against allowance` |
| `assessments` | `status=complete`, `piesa_outcome=fail`, `switchboard_condition=upgrade_required` |
| `piesa_records` | exactly 1 row, `is_current=true`, `outcome=fail` |
| `rectification_items` | 1 row, `status=required`, `$120.00`, `needs_office_pricing=false` |
| **`compliance_checks.electrical_assessment`** | **`pending`** — electrical clearance NOT granted |
| `compliance_checks.rectification` | `pending` |
| Evidence `piesa_signoff` | `outstanding` (a fail does not require the pass sign-off) |
| Workflow events | `rectification_other_added`, `electrical_assessment_complete (fail)`, `stage_changed → piesa_complete`, `rectification_windows_given (3 windows, 2 h)` |
| Auto-advance past `piesa_complete` | **did not happen** — `planStep("piesa_complete")` stops while rectification items are open |
| Installation scheduling or booking surface | none offered on the job |

The stage advancing to `piesa_complete` on a fail is correct by design: the stage means "the PIESA visit is complete", not "the PIESA passed" (`piesa-advance.core.ts`, header comment). What must not happen is clearance or installation authorisation, and it did not: the electrical compliance check stayed `pending`, the rectification item stayed `required`, and the job did not move on.

**Result: PASS.** Screenshots `B-01-item.png`, `B-02-plan.png`, `B-03-after.png`; log `scenario-b.log`.

## 6. Scenario C — an incomplete assessment is rejected

**Job:** UAT-S91-E-0003 · **Actor:** assigned electrician · three separate attempts, each rejected with a specific reason and no state change.

| # | State at submit | Message shown to the electrician |
|---|---|---|
| C1 | nothing filled | `Still needed: switchboard condition, RCDs present, life support confirmation, PIESA outcome, assessment date` |
| C2 | all fields filled, outcome `Pass`, no sign-off file | `Upload evidence first: PIESA / electrical safety sign-off` |
| C3 | sign-off uploaded, no rectification decision | `Add the rectification items for today's quote, or tick "No rectification required", before completing the PIESA.` |

After all three rejections the job was still at `piesa_scheduled` with the assessment `in_progress`, and no `piesa_records` row existed — the gate chain rejects before any write.

The three messages match the documented order of the chain: required fields → future-date guard → sign-off evidence for a pass → unpriced items → the same-day rectification rule.

**Result: PASS.** Screenshots `C-00-open-form.png` … `C-03-no-rect-decision.png`; log `scenario-cd.log`.

## 7. Scenario D — a duplicate submission is safe

**Job:** UAT-S91-E-0003, after the scenario C rejections.

A second browser tab was opened on the same job while the assessment was still open, and both tabs were filled in. Tab 1 submitted first and succeeded (`PIESA complete`). Tab 2 still held the stale open form and was then submitted — the realistic double-submit a person produces with two tabs.

| Observation | Result |
|---|---|
| Tab 1 (first submit) | `PIESA complete` — job moved to `piesa_complete` |
| Tab 2 (duplicate submit) | `Electrical assessment is already complete.` |
| Second `piesa_records` row | **none** — the job has exactly 1 row, `is_current=true` |
| Second stage transition | **none** |
| Second `electrical_assessment_complete` event | **none** |

Event timestamps make the duplicate provable rather than inferred: the single real completion produced `electrical_assessment_complete` at `00:20:20.597` and `stage_changed → piesa_complete` at `00:20:20.616`; the duplicate submit at `00:20:28` produced neither. (The job's earlier `00:17:50` pair belongs to a prior run of the same scenario, before the fixture was reset — the disposable stack's event log is append-only, so it cannot be deleted and is disclosed here rather than hidden.)

**Result: PASS.** Screenshots `D-01-first-submit.png`, `D-02-duplicate.png`; log `scenario-cd.log`.

## 8. Scenario E — role authorisation

**Job:** UAT-S91-E-0001 (now at `piesa_complete`), plus the office job file for the same job.

| Actor | Surface | What the browser showed | Verdict |
|---|---|---|---|
| Assigned electrician | `/field/<job>` | job opens; `Office is checking the safety check`; no editable form, no **Complete PIESA** button | **permitted, correctly read-only after completion** |
| Unassigned electrician (`electrician.pending`) | `/field/<job>` | `This job isn't available to you. If it's a new offer, accept it from My work first.` | **denied** |
| Installer (assigned as installer) | `/field/<job>` | same denial text; no PIESA form, no Complete button | **denied the electrician flow** |
| Homeowner | `/field/<job>` | redirected away from the field surface to `/owner`, the homeowner's own home | **denied** |
| Office admin | `/admin/jobs/<job>` | office job file opens; no PIESA entry form, no Complete button | **view-only for PIESA data** |

The denial is enforced server-side and surfaced as a plain refusal rather than an error page: the URL stays the same and the person is told what to do next.

**Result: PASS.**

## 9. Scenario F — cross-role state consistency and FFS visibility

After scenario A completed the PIESA on UAT-S91-E-0001, the same job was read through four different surfaces in four separate signed-in sessions.

| Surface | What it reported |
|---|---|
| Electrician `/field/<job>` | `PIESA complete` in the journey; `Office is checking the safety check`; `Safety check complete.`; history panel opened without error |
| Installer `/field/<job>` | denial text (the installer is not on the electrician flow for this job) |
| Homeowner `/owner/<job>` | `PIESA Complete`; `Home Insulation Victoria to action: Reconcile PIESA scope against allowance`; `Since Tue, 20 Oct, 11:10 am`; `30 days to install` |
| Office `/admin/jobs/<job>` | job file opens; PIESA recorded as `PIESA 20 Oct 2026`; `PIESA +30 days` deadline line |

All four surfaces agree on the same state. No surface offers a stale action.

**FFS visibility.** One fictional `ffs_progress_result` workflow event was inserted into the disposable database for this job, carrying the summary `TEST FFS progress result (fictional fixture – must never be shown to a portal user)`. The event exists in `workflow_events` and was then searched for in the rendered text of every surface above, including the expanded electrician history panel. It was not present on any of them (`ffs: false` on all four probes), and the page text contained no `FFS` or `ffs_progress_result` string at all.

**Result: PASS.** Screenshots `F-electrician-history.png`, `F-office-jobfile.png`, `F-owner-job.png`; logs `scenario-ef.log`, `scenario-f2.log`.

## 10. Scenario G — persistence and error handling

| Check | Result |
|---|---|
| Hard reload with cache bypass after completion | state unchanged: `piesa_complete`, `Office is checking the safety check`, no Complete button, no editable form |
| Full sign-out, sign in as another role, sign back in as the electrician, reopen the job | state unchanged, identical to the previous read |
| Browser console errors during every scenario | **none** (`consoleErrors: []`) |
| Uncaught page exceptions | **none** (`pageErrors: []`) |
| Failed network requests | only `Fetch net::ERR_ABORTED`, i.e. in-flight fetches cancelled by the navigations the test itself performed — no failed data load, no 4xx/5xx |

Every rejection in scenario C and the duplicate in scenario D arrived as an ordinary toast on a page that stayed usable; no gate produced an unhandled error or a blank screen.

**Result: PASS.** Screenshots `G-01-after-reload.png`, `G-02-after-relogin.png`; log `scenario-g.log`.

## 11. Observations, remediation efficacy and final verdict

### OBS-1 — the code added by the RC-4 remediation is not reachable from production (P3, no behavioural impact)

`advanceAfterPiesa` (the `piesa_scheduled` branch added to `advanceSiteRequirements` in `fa0d1139`) requires the job to be at `piesa_scheduled`. No production caller can reach it there:

- `completeAssessment` handles `piesa_scheduled` in its **own** branch and returns before the `else` that calls `advanceSiteRequirements` (`src/lib/portal.functions.ts:568-571`).
- `saveMeasurement` and `completeMeasurement` throw unless the stage is in `SITE_STAGES = ["ready_check_scheduled", "assessment_booking", "assessment_booked"]` (`portal.functions.ts:220, 267, 301`); `piesa_scheduled` is not in that list.
- The measure-up accept path only calls `advanceSiteRequirements` when the stage is in `SITE_STAGES` (`portal.functions.ts:382`).
- The auto-advance planner never emits a `complete_site` step — the step type exists in `autoadvance.core.ts:30` and is consumed at line 121, but no `planStep` branch ever returns it, so `deps.completeSite` is never invoked.

Consequently the advance observed in scenario A is performed by `completeAssessment`'s own `transition(...)`, not by the remediation. That same branch was already present at the pre-fix baseline `63ef6cae` (`git show 63ef6cae:src/lib/portal.functions.ts` lines 557 and 568), so the browser cannot attribute the fix to the RC-4 change.

This does not make the workflow wrong — it is correct and verified — but it does mean the `brief-s-f1-piesa-advance` suite (14/14) proves a function contract on a branch no user reaches, and must not be cited as production evidence for RC-4. The browser evidence in this report is that evidence. If the F-1 symptom is ever reported again, the investigation should start from the caller, not from `advanceSiteRequirements`.

### OBS-2 — two bookkeeping writes are skipped on the UI path (P3, pre-existing)

Because the unreachable branch is the only writer of these two rows, the UI path leaves them stale:

- after a **pass** with no rectification, `compliance_checks.electrical_assessment` stays `pending` instead of `pass` (observed on UAT-S91-E-0001 and -0003);
- after a **fail** with rectification items, `evidence_requirements.rectification_completion` stays `required=false / not_required` (observed on UAT-S91-E-0002).

Neither row gates anything: `stageEntryBlockers` does not consult `compliance_checks` for the installation stages, and the installation PIESA gate reads `piesa_records` through `piesaStatus`. The compliance row is corrected later by the Gate 6 automated review, which derives it from `piesa_outcome === "pass"` (`portal.functions.ts:1148`). Impact is an Office-facing status that reads `pending` on a passed PIESA until Gate 6 runs.

### OBS-3 — the homeowner sees internal next-action wording (P3, pre-existing design)

The homeowner job page renders `Home Insulation Victoria to action: Reconcile PIESA scope against allowance`. The framing ("to action") is deliberate, but the sentence is office jargon. Recorded because it was observed on a customer-facing surface during this UAT; no data is exposed beyond a status phrase.

### OBS-4 — the journey marks electrical fixes as "Not needed" on a job that needs them (P2, pre-existing, customer-facing)

On UAT-S91-E-0002 (a failed PIESA with a $120 required rectification item) the journey rendered `Electrical fixes (if any)` as skipped and `Fix costs paid — Not needed`.

Cause: `fixesNeeded` in `src/lib/job-status.core.ts:114` is true only when a rectification booking is completed/confirmed or the stage is one of the rectification stages. At `piesa_complete` with open items and no booking yet, both are false, so `jobTimeline` skips the two rows (lines 121–122). The label is therefore wrong for the window between the PIESA and the rectification booking.

This is a display rule, not a gate: the office rectification quote flow is driven by `rectification_items`, not by this label, and nothing about money or authorisation changes. It is pre-existing and was not introduced by RC-4. It is recorded at P2 rather than P3 because it is customer-facing and states the opposite of the truth about money and scope. If the release bar treats customer-facing status inaccuracies as blocking, this should be re-classified and fixed before the next customer-visible release; on the RC-4 criteria it does not block.

### What was not done

- No production Publish, no deploy, no migration, no change to the shared Supabase project.
- No real payment, Xero, Mitti, email or SMS interaction.
- No security assertion was weakened and no test was modified to obtain a pass.
- No unit-test, source-reading or earlier-report result is presented here as a browser result.

### Evidence index

`docs/phase1/release/evidence/rc4-browser-uat-2026-10-20/` — 23 screenshots (`A-*`, `B-*`, `C-*`, `D-*`, `E-*`, `F-*`, `G-*`) and the six raw driver logs (`scenario-a.log`, `scenario-b.log`, `scenario-cd.log`, `scenario-ef.log`, `scenario-f2.log`, `scenario-g.log`) from which every quoted message, toast and timestamp in this report is taken.

---

## FINAL VERDICT

**PASS — BROWSER VERIFIED**

RC-4's user-facing requirement — a completed PIESA moves the job from `piesa_scheduled` to `piesa_complete`, sets the Office next action, records exactly one current PIESA record, rejects incomplete and duplicate submissions, grants no clearance to a failed PIESA, and respects every role boundary — was observed directly in a real browser against a running application, with no release-relevant defect found.

Two follow-ups are carried forward and should not be read as RC-4 failures: the remediation's own code path is unreachable and must not be cited as production evidence (OBS-1, with OBS-2 as its consequence), and a pre-existing journey label misstates electrical fixes as "Not needed" (OBS-4).
