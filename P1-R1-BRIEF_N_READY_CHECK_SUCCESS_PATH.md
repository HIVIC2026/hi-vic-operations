# P1-R1-BRIEF N — Ready Check success path, end-to-end verification

| | |
|---|---|
| Brief | N — Ready Check successful path end-to-end |
| Priority | P1 |
| Mode | INVESTIGATE → REUSE LOCAL TEST ENVIRONMENT → VERIFY WORKFLOW → TEST → REPORT |
| Worktree | `wt-r1-brief-n-ready-check` |
| Branch | `r1/brief-n-ready-check-success` |
| Baseline | `07d7e56a` = `origin/main` (no merge, no cherry-pick, no rebase) |
| Date | 17 Oct 2026 |
| **Final classification** | **B — SERVICE/API/DB END-TO-END PASS · BROWSER VERIFICATION PARTIAL (B–D, F in a real browser; A and E at service level, E's form is Mitti-hosted)** |

---

## 1. Outcome in one page

The Ready Check success path **works end to end across all four roles** — homeowner, Office, installer, Office again — on the disposable local stack, with the application's own service functions and the real database (RLS, guards, append-only audit, stage machine all live).

What was proven, and how:

| Stage | What it means | Verified by | Result |
|---|---|---|---|
| **A** Homeowner availability | owner gives 3–5 two-hour times | service functions + DB assertions | PASS (11 assertions) |
| **B** Office dispatch | Office reviews candidates and sends the Ready Check offer | **real browser** + service/DB | PASS (6 browser checks + 5 service) |
| **C** Installer receives | offer appears on the installer's phone, address withheld | **real browser** + real RLS | PASS (4 browser checks + 3 service) |
| **D** Installer accepts | first-in takes the slot, gets the job and the contact details | **real browser** + DB | PASS (3 browser checks + 5 service) |
| **E** Installer executes Ready Check | answers + evidence + submit | service functions + DB | PASS (5 service tests) — **not reachable in the UI for this job's channel** |
| **F** Office receives the result | Office sees submitted state and the next step | **real browser** + service/DB | PASS (6 browser checks + 5 service) |

Totals:

* service/API/DB suite `tests/brief-n-ready-check-success.test.ts` — **37 pass / 0 fail / 224 expect**, ~1.3 s, run 4× today, identical result each time.
* real-browser journey — **22 checks / 0 fail**, run **twice** from a clean fixture reset, Chrome headless against the local Vite dev server.
* regression `tests/offer-dispatch.test.ts` — **6 pass / 0 fail / 17 expect**.
* `npx tsc --noEmit` — **exit 0**, 42 s.

Nothing outside the disposable local stack was touched: no push, no merge, no deploy, no production migration, no real customer data, no real email/SMS, no real webhook, no Mitti API call, no credential change.

---

## 2. Scope and authority

Authority read before testing: `HI_VIC_Phase1_AI_Guardrails/01_PHASE1_SCOPE_AND_EXCLUSIONS.md`.

In scope for this brief (and used to bound the test):

* §2.3 — Ready Check → measured quote → acceptance is a required Phase 1 flow.
* §2.4 — the installer must be able to record completion and hand a next action back to Office.
* §2.5 — Office must see the assigned/responsible person, the outstanding item and the next action.

Explicitly **out** of scope, and therefore not implemented or faked here:

* the advanced electrical assessment and the statutory PIESA forms;
* the full Mitti integration (form creation, result webhook, `external_mitti_id` round-trip);
* the automated evidence-pack assembly.

The brief's safety rules were treated as hard limits. In particular: no synthetic row was written anywhere except the verified disposable database, and no shared record (`HV-1417`) was read for write or modified.

---

## 3. Environment: the disposable stack, and how isolation was proven

Reused the existing one-off stack — **no new database was created** (brief §5).

| Component | Container | Port | State at test time |
|---|---|---|---|
| API gateway (Kong) | `supabase_kong_hivic-uat-disposable` | **54331** | up 42 h (healthy) |
| Postgres | `supabase_db_hivic-uat-disposable` | **54332** | up 42 h (healthy) |
| GoTrue (auth) | `supabase_auth_hivic-uat-disposable` | 9999 (internal) | up 42 h (healthy), `v2.197.0` |
| PostgREST | `supabase_rest_hivic-uat-disposable` | 3000 (internal) | up 42 h |
| Storage | `supabase_storage_hivic-uat-disposable` | 5000 (internal) | up 42 h, bucket `job-files` exists (private) |
| Studio | `supabase_studio_hivic-uat-disposable` | 54333 | up 42 h (healthy) |
| Mail catcher (inbucket) | `supabase_inbucket_hivic-uat-disposable` | 54334 | up 42 h (healthy) |

`public` schema holds **148 tables**. The Ready Check primitives the path depends on were confirmed present before any write: `accept_ready_check_offer`, `can_access_job`, `has_role`, `is_admin`, `is_business_member`, `is_job_owner`, `my_job_role`, `job_assignment_role`, `enqueue_external_action`.

**Isolation, positively established:**

1. Every URL used by the harness is `http://localhost:54331`; `installEnv()` overrides the process environment at module load, before any Supabase client is constructed.
2. `assertLocalOnly()` runs in `beforeAll` and throws on anything that is not `localhost`/`127.0.0.1`; it also hard-rejects the production project ref `wvuffpykgnqliikhodzl`.
3. `assertAppClientIsReal()` proves the app's own `supabaseAdmin` client resolves to the same local URL.
4. The production stack (`54321`/`54322`) was never connected to in this session.
5. `.env` in the repo still points at production; it was **not** edited. The browser run used a separate, untracked `.env.local` (see §15) that the harness deletes after the run.

---

## 4. Code baseline

```
branch              r1/brief-n-ready-check-success
local HEAD          07d7e56a
origin/main         07d7e56a   ("Brief G: controlled integration of the verified Brief E UI fix")
divergence          0 ahead / 0 behind at the time of testing
working tree        clean except the new Brief N files (tests + evidence dir)
```

No unrelated branch was merged or cherry-picked. `git fetch` was run before the baseline was recorded and `origin/main` had not moved.

---

## 5. The real workflow, mapped to source

Every step below was read in the source before it was tested; nothing in this section is inferred from the brief.

### A — homeowner availability

`src/lib/readycheck-booking.server.ts:44` `submitReadyCheckWindows(jobId, picks)`
→ validates through `src/lib/piesa-windows.core.ts` (3–5 windows, each exactly 2 h, on ≥3 distinct days, ≥2 business days lead time, ≤21 day horizon, slots `8-10 / 10-12 / 12-14 / 14-16`)
→ inserts `ready_check_windows` (`round`, `status='open'`)
→ sets `jobs.next_action = "Waiting for an installer to take one of the owner's Ready Check times"`.

### B — Office reviews and dispatches

`src/lib/readycheck-booking.server.ts:86` `installerCandidatesFor(jobId)`
→ for each business: trade match, approved + active, area coverage, rate, capacity, open offers, accept history; each candidate may carry a `blocker`.
`src/lib/readycheck-booking.core.ts:40` `readyCheckStartBlockers({stage, hasInstaller, openWindows, hasOpenOffers})` gates the send.
`src/lib/readycheck-booking.server.ts:161` `startReadyCheckOffers(jobId, userId, businessIds)`
→ `partner_offers` rows (`kind='ready_check'`, `batch=1`, `status='pending'`, 24 h expiry)
→ `trade_chosen_by_office` event.
UI: `src/components/portal/choose-trade.tsx` `ChooseTradePanel`, mounted at `src/routes/_authenticated/admin.jobs.$jobId.tsx:130`.

### C — installer receives

`src/lib/trade-view.server.ts:50` `tradeHome(userId)` lists live offers;
`:116` `tradeOffer(offerId, userId)` renders the offer with the owner's times and **withholds the address** while `contactHidden`;
`readyCheckOfferWindows(jobId)` supplies the times.
RLS on `partner_offers` = `is_admin() OR is_business_member(business_id)`; on `ready_check_windows` = `is_admin()` only.

### D — installer accepts

`src/lib/trade-view.server.ts:148` `tradeTakeTime(offerId, userId, windowId)`
→ `accept_ready_check_offer` (`drizzle/migrations/0098_ready_check_windows.sql:24`, SECURITY DEFINER, service-role only, `pg_advisory_xact_lock(hashtext('offer:'||job_id||':ready_check'))`)
→ outcomes `not_found / wrong_kind / already_<status> / expired / not_member / partner_not_approved / not_qualified / out_of_area / job_not_ready / already_assigned / slot_unavailable / accepted`, mapped to copy in `src/lib/allocation.core.ts:188` `ACCEPT_OUTCOME_MESSAGE`
→ `job_assignments` (role `installer`, `active`), window `taken`, sibling windows `closed`, `bookings` row, `contact_releases` row, `ready_check_window_taken` event, stage → `ready_check_scheduled`.

### E — installer performs the Ready Check

`src/lib/trade-view.server.ts:268` `confirmHivicReadyCheckPricing` (pricing-acknowledgement event, required before the form)
→ `src/lib/ready-check-draft.server.ts` `saveRcDraft` / `submitRcDraft`
→ canonical field model `src/lib/readycheck.core.ts:89` (`READY_CHECK_FIELDS`, 8 required answers, `RC_EVIDENCE_GATE='assessment'`)
→ `rcSubmitBlockers` produces `Answer needed: … / Photo or video needed: … / Rejected — upload again: …`
→ `ready_checks` (status `submitted`, `external_mitti_id` null for a portal submission) + `ready_check_observations` + `ready_check_draft_saved` / `ready_check_submitted` events. **Submission is deliberately not a stage change.**

### F — Office receives the result

`src/lib/office.server.ts` `loadOffice(userId)` → facts (`rcBookingAt`, `rcSubmittedAt`, `measurementStartedAt`)
→ `src/lib/office-status.core.ts:187` maps stage `ready_check_complete` to `ready_check.evidence_in` when `rcSubmittedAt` exists, else `ready_check.done`; `ready_check.booked` while scheduled
→ `src/lib/nextstep.core.ts` derives the next step and owner from live facts (stored free-text `next_action` is never rendered as the step)
→ `src/lib/workflow.server.ts:17` `TRANSITIONS` allows `ready_check_scheduled → ready_check_complete → measured_estimate_ready`.

---

## 6. Business precondition matrix

Each row: the exact rule, where it lives, the database column, the value the rule needs, the value the fixture uses, and how confident we are.

| # | Rule | Source | DB column | Required value | Fixture value | Confidence |
|---|---|---|---|---|---|---|
| 1 | Owner times only on a job that is ready for them | `readycheck-booking.server.ts:44` | `jobs.stage` | `preliminary_estimate_ready` | same | verified |
| 2 | 3–5 windows, 2 h each, ≥3 distinct days, ≥2 business days lead | `piesa-windows.core.ts` | `ready_check_windows.starts_at/ends_at` | rule satisfied | 3 windows on 3 Melbourne days, slots 10-12 / 12-14 / 8-10 | verified |
| 3 | Office may send only when the job has open windows and no open offer | `readycheck-booking.core.ts:40` | `ready_check_windows.status`, `partner_offers.status` | ≥1 `open`, 0 `pending` | 3 open, 0 pending | verified |
| 4 | Candidate must be an approved, active insulation installer covering the postcode | `readycheck-booking.server.ts:86` | `businesses.onboarding_status`, `business_areas`, `installer_levels` | `approved` + active + area hit | biz A `approved`, covers 3121 | verified |
| 5 | Unapproved partner is listed but cannot be ticked | same | `businesses.onboarding_status` | not `approved` | biz "Unapproved" → blocker `"Installer business is not approved and active."` | verified |
| 6 | TEST jobs may only be offered to TEST partners | `offerPairBlocker` | `jobs.source`, `businesses.onboarding_notes` | `qa_test` ↔ `[TEST PARTNER]` | both | verified |
| 7 | Offer expires after 24 h | `startReadyCheckOffers` | `partner_offers.expires_at` | now + 24 h | set | verified |
| 8 | Acceptor must be a member of the offered business | `0098_ready_check_windows.sql:24` | `business_members` | membership row | A and B both members of their own business only | verified |
| 9 | Acceptor's business must still be approved and qualified | same | `businesses.onboarding_status`, `eligibility_verifications` | `approved` + EEC cert | set | verified |
| 10 | Slot must still be open; only one assignment per job | same | `ready_check_windows.status`, `job_assignments` | `open`, none | open, none | verified |
| 11 | Gate A contact consent must exist before dispatch | `owner-gates.server.ts:68` | `owner_contact_consents` | `granted`, source `onsite_ready_check` | set for all 6 jobs | verified |
| 12 | Ready Check cannot be submitted with an outstanding assessment-gate requirement | `readycheck.core.ts:89`, `ready-check-draft.server.ts` | `evidence_requirements.status` | no `outstanding` | moved to `uploaded` during the test | verified |
| 13 | All 8 answers required | `READY_CHECK_FIELDS` | `ready_check_observations` | 8 rows | 8 rows | verified |
| 14 | Office status after submission | `office-status.core.ts:187` | `ready_checks.submitted_at` | non-null | non-null | verified |

---

## 7. Synthetic fixtures

Created by `tests/brief-n/harness.ts` (`seedFixtures`), entirely inside the disposable database, FK-safe order: `contact_releases → ready_check_observations → ready_checks → partner_offers → ready_check_windows → bookings → job_assignments → ceiling_measurements → evidence_files → eligibility_verifications`, then people/roles/businesses/workers/certs/levels/members, owner, property, jobs.

No real names, phones, addresses, recipients or partner identities are used. Every job is `source='qa_test'`, `job_number='BRIEF-N-…'`, address `1 Brief N Street, Richmond VIC 3121`, owner `Brief N Owner`, phone `0400000000`, email `owner@brief-n.test`. Businesses carry `[TEST PARTNER]` in `onboarding_notes`, which is what keeps them inside the test-partner rule.

| Fixture | Id | Purpose |
|---|---|---|
| `jobFlow` | `fa300000-…-001` | the success path, start to finish |
| `jobRepeat` | `fa300000-…-002` | second run of the same path (repeatability) |
| `jobWrongStage` | `fa300000-…-003` | negative: owner times on the wrong stage |
| `jobNoWindows` | `fa300000-…-004` | negative: dispatch without owner times |
| `jobAssigned` | `fa300000-…-005` | negative: dispatch when an installer is already assigned |
| `jobOpenOffer` | `fa300000-…-006` | negative: a second open offer is refused |
| installer A / B | `…-f2` / `…-f3` | competing businesses |
| unapproved partner | `…-b3` | approval guard |

Fixture preparation is kept explicitly separate from the business actions under test: seeding writes rows directly; every assertion about the workflow is then produced by calling the application's own service functions.

---

## 8. Stage A — homeowner availability

Driven through `submitReadyCheckWindows` (the function the owner's link handler delegates to).

* **A1/A2** — 3 picks → 3 `ready_check_windows`, `round=1`, `status='open'`, each exactly 2 h long.
* **A3** — the three windows fall on **3 distinct Melbourne calendar days** (asserted with `melbourneYmd`, not UTC date slicing — a UTC slice collapses them).
* **A4** — `jobs.next_action` becomes `"Waiting for an installer to take one of the owner's Ready Check times"`.
* **A5** — four invalid submissions are refused with the real copy: `tooFewTimes`, `notEnoughDays`, `duplicateTime`, `outsideAllowedDays`. Rules stack (two picks also breaks the 3-day rule; a repeated pick also breaks the 3-day rule), so the assertions use `toContain` and say so in the test.
* **A6** — zero rows in `external_action_outbox`: giving times notifies nobody.

**Result: PASS.**

---

## 9. Stage B — Office reviews and dispatches the offer

Service level:

* preconditions report the job as dispatchable (open windows, no installer, no open offer);
* `installerCandidatesFor` returns A and B as matching, and the unapproved partner **with an explicit blocker** (`"Installer business is not approved and active."`) rather than being silently dropped — this is what the office needs in order to understand why a trade cannot be picked;
* `startReadyCheckOffers` writes one `partner_offers` row: `kind='ready_check'`, `batch=1`, `status='pending'`, summary containing job number, suburb, postcode, visit type, `office_choice`, and the unpaid note; plus a `trade_chosen_by_office` event;
* **stage does not move**, and `external_action_outbox` stays empty.

Real browser (`#choose-trade` on `/admin/jobs/fa300000-…-001`):

* B1 Office password sign-in lands on `/admin/needs-me`.
* B2 the Ready Check section renders **Choose trades for this job**.
* B3 installer A is listed as a matching approved trade and its checkbox is enabled.
* B4 the button reads **"Send offer to 1 trade"** — it counts only the ticked trade.
* B5 after the click the row reads **"Already offered · pending"** for A.
* B6 installer B is still tickable — it was not offered.

**Result: PASS** (5 service assertions + 6 browser checks).

---

## 10. Stage C — Installer receives the offer

* `tradeHome` lists the offer; `tradeOffer` renders the three owner times; `readyCheckOfferWindows` returns them ascending and in the future.
* **Real RLS**, through PostgREST with a signed `authenticated` JWT: business A sees exactly 1 offer row; business B sees 0; anon sees 0; `can_access_job` is **false** for A before acceptance; the installer cannot read `ready_check_windows` at all.
* Asking for B's offer as A returns the real message `"This offer was made to a different business."`

Real browser (installer A, 420×900 phone viewport):

* C1 sign-in lands on `/field` ("My work").
* C2 the offer appears as **"Ready Check in Richmond"** with a **View offer** link.
* C3 the offer page shows the owner's three times (TUE 20 10am–12, WED 21 12–2pm, THU 22 8–10am).
* C4 the page says **"Address shows once you accept."** and the address string is absent from the DOM.

**Result: PASS** (3 service assertions + 4 browser checks).

---

## 11. Stage D — Installer accepts and gets job access

Service level:

* `tradeTakeTime` → offer `accepted`; one `job_assignments` row (role `installer`, `active`, `first_response_at`, `booking_confirmed_at`); the chosen window `taken`; the other two `closed`; a `bookings` row; a `contact_releases` row; a `ready_check_window_taken` event; stage → `ready_check_scheduled`.
* RLS flips: `can_access_job` becomes true, the installer can read the job and the released contact details; business B still cannot.
* Accepting the same offer twice returns `tooSlow: true` and still leaves exactly one assignment.
* Business B trying to accept A's offer gets `differentBusiness`, the offer stays `pending`, and A can still accept it afterwards.

Real browser:

* D1 clicking a time produces **"Job accepted"**.
* D2 the accepted window is echoed back (**"TUE 20 · 10am–12"**, **"Booked"**).
* D3 the address **"1 Brief N Street, Richmond VIC 3121"** and **Call owner** appear only now.

**Result: PASS** (5 service assertions + 3 browser checks).

---

## 12. Stage E — Installer performs and submits the Ready Check

* **E1/E2** `confirmHivicReadyCheckPricing` records `installer_hivic_pricing_acknowledged`.
* **E3** invalid answers are refused by the canonical field model — `"Measurement method: choose an option"`, `"Measured eligible ceiling area (m²): enter a number"` — and nothing is persisted.
* **E4** a partial draft is durable and re-reads correctly.
* **E5** submitting an incomplete form is refused with the exact copy: `Not ready to submit: Answer needed: Attended at … Photo or video needed: Ceiling measurement evidence`.
* **E6–E8** after the visit evidence is recorded, the full form submits: one `ready_checks` row (`job_id`, `installer_user_id`, `installer_business_id`, `submitted_at`, `external_mitti_id` **null**), 8 `ready_check_observations`, `ready_check_draft_saved` and `ready_check_submitted` events.
* **E9** submission does **not** move the stage (still `ready_check_scheduled`) and writes nothing to `external_action_outbox`.
* **E10** the installer's own day view flips to `outcome = {kind:"quoted"}`; a submitted Ready Check cannot be edited afterwards (`"This Ready Check was already submitted — ask Home Insurance Victoria to reopen it."`).

**Result: PASS at service/DB level.**

**Important qualification (see §17):** in this build the installer's on-site Ready Check **form is Mitti-hosted** for `hivic_sourced` jobs, so this stage could not be driven through the UI. The browser run stops at *"Your form is being set up."* — which is the correct, intended screen when no Mitti form exists, and the brief forbids calling the real Mitti API.

---

## 13. Stage F — Office receives and reviews the result

Service level:

* `loadOffice` facts drive the office state: `rcSubmittedAt` / `rcBookingAt` present → `ready_check.booked` while scheduled; after `recordMeasureUpDraft` (a recorded fact, not a flag) → `ready_check.onsite_started`.
* `nextStep` returns **"Ready Check booked"** / **"Installer to complete Ready Check"**, `waitingOn = "Installer"` — derived from live facts, never from the stored free-text `next_action`.
* **"Confirm eligible" is refused by the stricter evidence gate**: `"Eligible needs all mandatory Ready Check evidence."`, with 0 rows written.
* `transition` → `ready_check_complete` → status `ready_check.evidence_in` (action *"Confirm eligible"*), `nextStep` **"Ready Check Complete"** / **"Measured estimate generates automatically"** / owner **"Home Insulation Victoria"**; other jobs untouched; `external_action_outbox` still empty.

Real browser:

* F1 the office job page shows **"Already offered · accepted"** against installer A.
* F2 the header names **"Installer Brief N Installer A"**.
* F3 before submission: **"Ready Check status: Not started"**.
* F4 before submission the office is told **"Reopening is only available once the installer has submitted the Ready Check."**
* F5 after submission: **"Ready Check status: Submitted"**.
* F6 the **Reopen Ready Check** control is now offered.

**Result: PASS** (5 service assertions + 6 browser checks).

---

## 14. Negative and security tests

| # | Case | Result |
|---|---|---|
| 1 | Office dispatch with no owner windows | refused (`offerNoWindows`) |
| 2 | Office dispatch on the wrong stage | refused (`offerWrongStage`) |
| 3 | Office dispatch when an installer is already assigned | refused (`offerAssigned`) |
| 4 | A second open offer / re-sending to the same trade | refused (`offerAlreadyOpen`); `newRecipients` de-duplicates |
| 5 | Unapproved partner offered a job | refused at the candidate level (blocker) and again on send |
| 6 | Cross-business acceptance | `differentBusiness`, offer stays pending, real owner can still accept |
| 7 | Anonymous read of `jobs`, `partner_offers`, `ready_checks`, `owners` | all empty |
| 8 | Anonymous call of `accept_ready_check_offer` | error, no write |
| 9 | Failed dispatch leaves partial rows | none |
| 10 | Submitted Ready Check edited afterwards | refused |
| 11 | Office "Confirm eligible" without mandatory evidence | refused, 0 rows |
| 12 | *(browser)* signed-out visit to `/admin/jobs/<id>` | redirected to `/auth?next=…`, no job data in the DOM |
| 13 | *(browser)* installer B's own My-work list | no offer for this job |
| 14 | *(browser)* installer B opening `/field/<jobId>` | **"This job isn't available to you."** |

---

## 15. Real-browser verification

**Environment.** Local Vite dev server on `http://localhost:8080` (this worktree) against the disposable stack on `:54331`, driven by Playwright + the installed Google Chrome (headless, `channel="chrome"`).

Setup required (all untracked / gitignored, removed afterwards):

* `.env.local` — `VITE_SUPABASE_URL=http://localhost:54331`, `VITE_SUPABASE_PUBLISHABLE_KEY=<local anon JWT>`, plus the server-side `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` exports in the dev-server shell.
* GoTrue users created in the **local** auth service only, with fixed ids that match the fixtures: `office@brief-n.test`, `installer-a@brief-n.test`, `installer-b@brief-n.test` (password `BriefN-Test-Pass-1`, `email_confirm: true`). Sign-in goes through the real `signInWithPassword` path.

**Sequence per run** (`BRIEF_N_READY_CHECK_EVIDENCE/browser/run.sh`):

```
0  bun tests/brief-n/prep-browser.ts          reset fixtures + owner availability (stage A, service level)
B  python journey.py <run> send               Office sends the Ready Check offer
C  python journey.py <run> accept             Installer opens the offer and takes a time
F1 python journey.py <run> booked             Office sees the booked Ready Check
E  bun tests/brief-n/submit-rc.ts             installer submits the Ready Check (form is Mitti-hosted)
F2 python journey.py <run> review             Office sees the submitted Ready Check
N  python journey.py <run> security           signed-out + cross-business denial
```

**Results.** Run 1: **22 pass / 0 fail**. Run 2 (from a fresh fixture reset): **22 pass / 0 fail**. Screenshots for both runs are in the evidence directory (`shots-1/`, `shots-2/`), and the raw office page text after each state is stored as `office-booked-*.txt` / `office-after-*.txt`.

**Exact gap, stated plainly:** stage A (owner's own time-picker page) and stage E (installer's Ready Check form) were **not** exercised through the browser. A's UI needs a customer estimate link, which the fixture does not have; E's UI is a Mitti form for this job's channel. Everything else in the path — the Office dispatch, the installer's offer view, the acceptance, and the office hand-back — ran in a real browser against the real app.

---

## 16. Repeatability

* The service suite was run 4× today: **37 pass / 0 fail / 224 expect** every time (≈1.0–1.3 s).
* The browser journey was run **twice from a clean reset**: 22/22 both times.
* `seedFixtures` is re-entrant: running it again restores the exact starting state and **preserves append-only history** (previous events, offers and submissions remain as superseded rows — nothing is deleted).
* The success path itself was run on a **second job** (`jobRepeat`) and landed in the same terminal state, proving the path is not job-specific.
* `bun` shares `mock.module` across files in one process, so the Brief N suite is run as its own file; the regression suite is run separately. Commands are recorded in §18.

---

## 17. Defects and observations

**No blocking defect was found.** The workflow behaves as specified at every stage that could be exercised. Three observations are recorded for the owner, none of which is a claim of a bug:

1. **The installer's Ready Check form is Mitti-hosted for `hivic_sourced` jobs.**
   `src/routes/_authenticated/field.day.$jobId.tsx:76` renders *"Your form is being set up"* until `data.mittiId` exists, and the only in-app form (`ReadyCheckDraft`) is rendered for `job.channel === "installer_sourced"` (`field.$jobId.tsx:93`). The portal submission path behind it (`ready-check-draft.server.ts`) has **no channel guard** — it is fully functional for any assigned job, as the service tests prove. So the capability exists; it is only the UI entry point that is channel-specific.
   *Impact:* for HIV-sourced Ready Checks the installer cannot complete the form inside the app today; that step depends on Mitti, which the brief places outside Phase 1. This is the one stage that keeps the classification at B rather than A.
   *Recommendation:* owner decision — either accept Mitti as the Phase 1 vehicle for HIV-sourced Ready Checks, or expose `ReadyCheckDraft` for `hivic_sourced` as well (no schema change, no new server work).

2. **The office page says "Nothing blocking the move to Ready Check Complete" while the Ready Check status is still "Not started".** This string comes from the stage-transition hint in `src/components/portal/panels.tsx:63` (it reads `TRANSITIONS`), not from the entry-blocker evaluation, so it is a **hint**, not a guard. The actual transition is guarded server-side. Not tested further, because moving the job would have disturbed the run; flagged so nobody reads the hint as permission.

3. **Console noise in dev:** five `404` resource errors per page load (static asset fetches in the dev server). They do not affect the workflow and did not appear to affect rendering.

---

## 18. Verification log — exact commands, counts, exit codes

All commands run from `/Users/jet.zhang/CopilotWorkspace/Loveable/wt-r1-brief-n-ready-check`.

| # | Command | Result | Exit | Time |
|---|---|---|---|---|
| 1 | `bun test tests/brief-n-ready-check-success.test.ts` | 37 pass / 0 fail / 224 expect | 0 | 1.28 s |
| 2 | `bun test tests/offer-dispatch.test.ts` | 6 pass / 0 fail / 17 expect | 0 | 0.83 s |
| 3 | `npx tsc --noEmit` | no type errors | 0 | 42 s |
| 4 | `bun run build` | failed before compiling — see note below | **1** | 96 s |
| 5 | `bun tests/brief-n/prep-browser.ts` | fixtures reset + 3 open windows | 0 | ~2 s |
| 6 | `python journey.py 1 send` | 6/6 browser checks | 0 | ~25 s |
| 7 | `python journey.py 1 accept` | 7/7 browser checks | 0 | ~35 s |
| 8 | `python journey.py 1 booked` | 4/4 browser checks | 0 | ~25 s |
| 9 | `bun tests/brief-n/submit-rc.ts` | Ready Check submitted | 0 | ~2 s |
| 10 | `python journey.py 1 review` | 2/2 browser checks | 0 | ~25 s |
| 11 | `python journey.py 1 security` | 3/3 browser checks | 0 | ~30 s |
| 12 | `./run.sh 2` (full sequence again) | 22 pass / 0 fail | 0 | ~2 min |

**Build note (honest, not a pass).** `bun run build` exited **1**, but not on a code error: it failed inside Vite's `vite:prepare-out-dir` hook, where the environment's safe-delete guard refuses to remove 547 stale files under `node_modules/.nitro/vite/services/ssr/assets` (bulk-delete guard, threshold 50). The build therefore never reached a verdict on the source. This report does **not** claim a passing production build; the type check (row 3) is the compile-level evidence used here, and the dev server compiled and served every route exercised in §15.

**Test-type honesty.** Rows 1, 2, 5, 9 are service/API/database tests (real functions, real Postgres, real RLS). Rows 6–8, 10–11 are **real browser** tests. No test in this brief mocks a business rule; the only thing removed is the external boundary (no Mitti token, no mail/SMS transport), which is absent rather than stubbed.

---

## 19. Evidence index, limits, and classification

**Evidence directory:** `BRIEF_N_READY_CHECK_EVIDENCE/`

```
browser/journey.py                     the Playwright phase driver (send / accept / booked / review / security)
browser/run.sh                         one full run: reset → B → C/D → F1 → E → F2 → N
browser/results-1.json, results-2.json 22 machine-readable checks per run, with timings
browser/shots-1/, shots-2/             B-office-sent, C-offer, D-accepted, E1-office-booked,
                                       F-office-after, N1-signed-out, N2-installer-b, N3-installer-b-job
browser/office-booked-1.txt …          raw office page text at each state (before/after submission)
browser/prep-1.log, prep-2.log         fixture reset output for each run
tests/brief-n/harness.ts               synthetic fixtures + the admin / asUser / asAnon access layers
tests/brief-n/messages.ts              every user-facing string asserted, in one place
tests/brief-n/prep-browser.ts          stage-A preparation for a browser run
tests/brief-n/submit-rc.ts             stage-E submission for a browser run
tests/brief-n-ready-check-success.test.ts   37 tests / 224 assertions
```

**Limits, stated so they are not mistaken for passes:**

* Browser coverage is **B, C, D, F**. A and E were verified at service/DB level only, for the reasons in §15.
* The Ready Check *form* is not verified in any UI: it is Mitti-hosted for this job's channel, and calling Mitti is out of scope and forbidden.
* Evidence upload was recorded as an `evidence_files` row plus a requirement status change, not a real object-storage upload (the local stack has a `job-files` bucket but the fixture deliberately does not push a binary through it).
* The office "Confirm eligible" path was tested for its refusal case; the successful eligibility verification flow is a different brief.
* The 24-hour offer expiry was verified as a value and a rule, not by waiting 24 hours.
* No production configuration, shared database, real partner account or credential was touched.

**Classification: B — SERVICE/API/DB END-TO-END PASS, BROWSER VERIFICATION PARTIAL.**

Every stage of the workflow was executed and verified against real code and a real database, and four of the six stages were additionally driven through a real browser. The two exceptions are structural, not failures: the owner's time-picker page needs a customer link the fixture does not carry, and the installer's Ready Check form is Mitti-hosted in this build.

**Not claimed:** Phase 1 UAT PASS. No push, no merge, no deploy was performed, and no further agent or task was started.
